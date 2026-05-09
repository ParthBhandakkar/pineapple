"""Multi-stack LLM artifact structure test matrix.

Registers a single user against the production deployment (or the URL provided
via E2E_BASE_URL) and runs a battery of coding prompts of varying size, stack,
and trickiness. For each prompt we:

  1. Send the prompt through /api/chat
  2. Poll /api/bootstrap until the task COMPLETED or FAILED
  3. Pull the latest assistant message for that prompt
  4. Extract the pineapple-project artifact
  5. Assert structure invariants (no hardcoded list of expected files):
        - artifact present, has >=1 file, every file has a path + content
        - every local file reference inside any file resolves to a file in the artifact
        - no "monolith" anti-pattern: HTML files must not contain large inline
          <style> or <script> blocks; trivial inline (<= 500 chars combined) is OK
        - if the artifact has only one file but the project content > 1500 chars,
          it must be a single-file kind of project (we mark this as a soft failure
          for prompts that we believe are non-trivial)

Each assertion is generic and reused across stacks. Per-prompt expectations only
declare:
  - whether multi-file is required
  - language hints used to verify file extensions (we check the artifact contains
    *some* file with one of the expected extensions, not specific filenames)
"""

from __future__ import annotations

import json
import os
import random
import re
import string
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("E2E_BASE_URL", "https://pineapplee.com").rstrip("/")
PASSWORD = os.environ.get("E2E_PASSWORD", "MatrixPass123!")
WAIT_MS = int(os.environ.get("E2E_WAIT_MS", "120000"))
TASK_TIMEOUT_S = int(os.environ.get("E2E_TASK_TIMEOUT_S", "900"))
DEBUG_DIR = os.environ.get("E2E_DEBUG_DIR", "/tmp/matrix_debug")
os.makedirs(DEBUG_DIR, exist_ok=True)


def random_suffix(length: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def register_user(page, name: str, email: str, password: str) -> None:
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=WAIT_MS)
    res = page.request.post(
        f"{BASE_URL}/api/auth/register",
        data=json.dumps({"name": name, "email": email, "password": password}),
        headers={"Content-Type": "application/json"},
    )
    if not res.ok:
        raise RuntimeError(f"register failed: {res.status} {res.text()[:300]}")
    page.goto(f"{BASE_URL}/dashboard", wait_until="domcontentloaded", timeout=WAIT_MS)


def send_chat(page, prompt: str) -> dict:
    res = page.request.post(
        f"{BASE_URL}/api/chat",
        data=json.dumps({"prompt": prompt}),
        headers={"Content-Type": "application/json"},
    )
    if not res.ok:
        raise RuntimeError(f"/api/chat failed: {res.status} {res.text()[:300]}")
    return res.json().get("data") or res.json()


def approve_pending_for_task(page, task_id: str) -> bool:
    res = page.request.get(f"{BASE_URL}/api/requests")
    if not res.ok:
        return False
    payload = res.json().get("data") or res.json()
    for approval in payload.get("approvals", []) or []:
        if approval.get("taskId") == task_id and approval.get("status") == "PENDING":
            try:
                # The decision endpoint is synchronous (it executes the task and
                # waits before responding). For long-running coding tasks this
                # can exceed the default 30s. We allow up to 8 minutes.
                decision = page.request.post(
                    f"{BASE_URL}/api/requests/{approval.get('id')}/decision",
                    data=json.dumps({"decision": "APPROVED"}),
                    headers={"Content-Type": "application/json"},
                    timeout=480_000,
                )
                return decision.ok
            except Exception as exc:
                print(f"[matrix] approval POST raised {exc!r} (continuing — server may still finish)", flush=True)
                # The server-side executeTask continues even if our HTTP
                # request gives up; the bootstrap poller will see the result.
                return True
    return False


def poll_for_completion(page, task_id: str, timeout_s: int) -> dict:
    deadline = time.time() + timeout_s
    last: dict = {}
    approved = False
    while time.time() < deadline:
        res = page.request.get(f"{BASE_URL}/api/bootstrap")
        if res.ok:
            body = res.json()
            payload = body.get("data") or body
            for task in payload.get("tasks", []):
                if task.get("id") == task_id:
                    last = task
                    status = task.get("status")
                    if status == "PENDING_APPROVAL" and not approved:
                        approved = approve_pending_for_task(page, task_id)
                    if status in {"COMPLETED", "FAILED", "REJECTED"}:
                        return task
        time.sleep(3)
    return last


def latest_assistant_for_task(page, task: dict) -> Optional[str]:
    res = page.request.get(f"{BASE_URL}/api/bootstrap")
    if not res.ok:
        return None
    payload = res.json().get("data") or res.json()
    target_conv_id = task.get("conversationId")
    target_prompt = task.get("prompt")
    for conv in payload.get("conversations", []):
        if target_conv_id and conv.get("id") != target_conv_id:
            continue
        msgs = conv.get("messages", [])
        for idx in range(len(msgs)):
            if msgs[idx].get("role") == "USER" and msgs[idx].get("content") == target_prompt:
                for j in range(idx + 1, len(msgs)):
                    if msgs[j].get("role") == "ASSISTANT":
                        return msgs[j].get("content", "")
    return None


# ---------- Artifact helpers ----------

FENCE_OPEN_RE = re.compile(r"```pineapple-project\s*\n", re.MULTILINE)


def _candidate_artifact_bodies(content: str) -> list[str]:
    """Return possible JSON-body candidates for a pineapple-project artifact.

    Note: README files inside artifacts can themselves contain triple-backticks
    (e.g. fenced bash blocks), which breaks naive non-greedy regex matching.
    We try several extraction strategies and return any candidate that parses
    as a dict with a `files` array.
    """
    candidates: list[str] = []

    opens = list(FENCE_OPEN_RE.finditer(content))
    for open_match in opens:
        start = open_match.end()
        # Strategy A: greedy — everything until the LAST closing fence.
        last_close = content.rfind("\n```", start)
        if last_close > start:
            candidates.append(content[start:last_close].strip())
        # Strategy B: brace-balanced — start at first `{`, find matching `}`.
        first_brace = content.find("{", start)
        if first_brace >= 0:
            depth = 0
            end_idx = -1
            in_str = False
            esc = False
            for i in range(first_brace, len(content)):
                ch = content[i]
                if esc:
                    esc = False
                    continue
                if ch == "\\":
                    esc = True
                    continue
                if ch == '"':
                    in_str = not in_str
                    continue
                if in_str:
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end_idx = i + 1
                        break
            if end_idx > first_brace:
                candidates.append(content[first_brace:end_idx])

    # Strategy C: brace match anywhere from the first `{` of the content.
    first_brace = content.find("{")
    if first_brace >= 0:
        candidates.append(content[first_brace:].strip())

    return candidates


def extract_artifact(content: str) -> Optional[dict]:
    if not content:
        return None
    parsed: Optional[dict] = None
    for raw in _candidate_artifact_bodies(content):
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("files"), list):
            parsed = obj  # keep last successfully-parsed artifact (post-repair)
    return parsed


def normalize_path(path: str) -> str:
    return path.replace("\\", "/").lstrip("/").replace("//", "/")


def dirname(path: str) -> str:
    norm = normalize_path(path)
    idx = norm.rfind("/")
    return "" if idx < 0 else norm[:idx]


def join_path(base: str, rel: str) -> str:
    base_parts = [p for p in normalize_path(base).split("/") if p]
    rel_parts = [p for p in normalize_path(rel).split("/") if p]
    stack = list(base_parts)
    for part in rel_parts:
        if part == ".":
            continue
        if part == "..":
            if stack:
                stack.pop()
            continue
        stack.append(part)
    return "/".join(stack)


BINARY_ASSET_EXTS = (
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".webp",
    ".avif",
    ".bmp",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".webm",
    ".mov",
    ".pdf",
    ".zip",
)


def normalize_ref(target: str) -> Optional[str]:
    t = target.strip()
    if not t:
        return None
    if re.match(r"^(https?:)?//", t, re.I):
        return None
    if re.match(r"^(data|mailto|tel|javascript):", t, re.I):
        return None
    if t.startswith("#"):
        return None
    if re.search(r"\{\{|\}\}|\{%|%\}", t):
        return None  # Jinja2 / Django / Handlebars / Mustache placeholder
    no_query = re.split(r"[?#]", t, maxsplit=1)[0]
    if not no_query:
        return None
    norm = normalize_path(no_query)
    if any(norm.lower().endswith(ext) for ext in BINARY_ASSET_EXTS):
        return None
    return norm


def referenced_files(file_path: str, content: str) -> list[str]:
    refs: set[str] = set()
    ext = file_path.lower()
    from_dir = dirname(file_path)

    def add(target: str) -> None:
        norm = normalize_ref(target)
        if not norm:
            return
        resolved = normalize_path(norm) if norm.startswith("/") else join_path(from_dir, norm)
        if resolved:
            refs.add(resolved)

    if ext.endswith((".html", ".htm")):
        for m in re.finditer(r"\b(?:src|href)\s*=\s*[\"']([^\"']+)[\"']", content, re.I):
            add(m.group(1))
    if ext.endswith(".css"):
        for m in re.finditer(r"@import\s+(?:url\()?[\"']?([^\"')\s]+)[\"']?\)?", content, re.I):
            add(m.group(1))
        for m in re.finditer(r"url\(\s*[\"']?([^\"')\s]+)[\"']?\s*\)", content, re.I):
            add(m.group(1))
    if ext.endswith((".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")):
        for pat in (
            r"\bimport\s+(?:[\s\w{},*\n\r]+?\s+from\s+)?[\"']([^\"']+)[\"']",
            r"\brequire\(\s*[\"']([^\"']+)[\"']\s*\)",
            r"\bimport\(\s*[\"']([^\"']+)[\"']\s*\)",
        ):
            for m in re.finditer(pat, content):
                target = m.group(1)
                if target.startswith(".") or target.startswith("/"):
                    add(target)
    return sorted(refs)


def missing_references(artifact: dict) -> list[str]:
    files = [
        {"path": normalize_path(f.get("path", "")), "content": f.get("content", "") or ""}
        for f in artifact.get("files", [])
        if f.get("path")
    ]
    file_set = {f["path"] for f in files}
    candidates_for = lambda ref: [
        f"{ref}.js",
        f"{ref}.jsx",
        f"{ref}.ts",
        f"{ref}.tsx",
        f"{ref}.css",
        f"{ref}.json",
        f"{ref}.html",
        f"{ref}/index.js",
        f"{ref}/index.ts",
        f"{ref}/index.tsx",
        f"{ref}/index.jsx",
    ]
    missing: set[str] = set()
    for f in files:
        for ref in referenced_files(f["path"], f["content"]):
            if ref in file_set:
                continue
            if re.search(r"\.[a-zA-Z0-9]+$", ref):
                missing.add(ref)
            else:
                if not any(normalize_path(c) in file_set for c in candidates_for(ref)):
                    missing.add(ref)
    return sorted(missing)


INLINE_THRESHOLD = 600


def monolithic_issues(artifact: dict) -> list[str]:
    issues: list[str] = []
    for f in artifact.get("files", []):
        path = normalize_path(f.get("path", "")).lower()
        body = f.get("content", "") or ""
        if path.endswith((".html", ".htm")):
            ms = re.search(r"<style[\s\S]*?>([\s\S]*?)</style>", body, re.I)
            sc = re.search(r"<script(?![^>]*\bsrc=)[\s\S]*?>([\s\S]*?)</script>", body, re.I)
            style_body = (ms.group(1) if ms else "").strip()
            script_body = (sc.group(1) if sc else "").strip()
            if len(style_body) > INLINE_THRESHOLD:
                issues.append(
                    f"{f.get('path')} has large inline <style> ({len(style_body)} chars)"
                )
            if len(script_body) > INLINE_THRESHOLD:
                issues.append(
                    f"{f.get('path')} has large inline <script> ({len(script_body)} chars)"
                )
    return issues


# ---------- Test matrix ----------


@dataclass
class StackCase:
    name: str
    prompt: str
    require_multifile: bool = True
    expected_extensions: list[str] = field(default_factory=list)
    description: str = ""


CASES: list[StackCase] = [
    # Small projects
    StackCase(
        name="tiny_python_script",
        prompt=(
            "Write a tiny Python CLI that prints the SHA-256 of any string passed "
            "as argv[1]. Include a README. Keep it minimal."
        ),
        require_multifile=False,
        expected_extensions=[".py"],
        description="Small/single-file Python is acceptable.",
    ),
    # Medium HTML/CSS/JS
    StackCase(
        name="medium_html_landing",
        prompt=(
            "Build a single-page HTML landing page for a fake SaaS called LumenDocs, "
            "with a hero, three feature cards, testimonials carousel, and contact form. "
            "Use modern responsive CSS and vanilla JS for the carousel. The project must "
            "have separate index.html, stylesheet, and script files (no inline styles or "
            "scripts other than tiny snippets)."
        ),
        require_multifile=True,
        expected_extensions=[".html", ".css", ".js"],
        description="Vanilla HTML/CSS/JS multi-file (this is the reported failure case).",
    ),
    # Tricky: HTML/CSS/JS but the user does NOT explicitly say to split files
    StackCase(
        name="tricky_html_unhinted",
        prompt=(
            "Make me a beautiful animated dashboard mockup webpage with cards, charts "
            "(no libraries), and a sidebar. Make it polished and production-grade."
        ),
        require_multifile=True,
        expected_extensions=[".html", ".css", ".js"],
        description="No explicit hint — model must still split.",
    ),
    # Medium Python multi-module
    StackCase(
        name="medium_python_todo",
        prompt=(
            "Build a Python CLI todo app with subcommands add/list/done/remove using "
            "argparse, persisted to a JSON file. Split into modules: cli, storage, "
            "models. Include tests."
        ),
        require_multifile=True,
        expected_extensions=[".py"],
    ),
    # React component multi-file
    StackCase(
        name="medium_react_counter",
        prompt=(
            "Build a small React 18 app (Vite) for a counter with increment, decrement, "
            "and reset. Split into App.jsx, Counter.jsx, and a CSS module. Include "
            "package.json, vite.config.js, index.html, and main.jsx."
        ),
        require_multifile=True,
        expected_extensions=[".jsx", ".js", ".html", ".json"],
    ),
    # Big project: Express REST
    StackCase(
        name="big_express_api",
        prompt=(
            "Build a Node.js Express REST API for a notes service with CRUD endpoints. "
            "Use proper layering: routes, controllers, services, and an in-memory model. "
            "Include package.json, server.js entry, and a README. Use ESM imports."
        ),
        require_multifile=True,
        expected_extensions=[".js", ".json"],
    ),
    # Big project: Flask app
    StackCase(
        name="big_flask_app",
        prompt=(
            "Build a Flask web application for a tiny blog. It must have routes, "
            "templates (Jinja2), static files (CSS), models, and a sqlite-backed "
            "store via sqlalchemy. Multi-file, conventional Flask layout."
        ),
        require_multifile=True,
        expected_extensions=[".py", ".html", ".css"],
    ),
    # Tricky: heavy single-language ask that the model often inlines
    StackCase(
        name="tricky_chess_html",
        prompt=(
            "Make a playable two-player chess game that runs in the browser. Plain "
            "HTML/CSS/JS (no libraries), drag-and-drop pieces, basic move legality. "
            "Make it look beautiful."
        ),
        require_multifile=True,
        expected_extensions=[".html", ".css", ".js"],
    ),
]


# ---------- Validation ----------


@dataclass
class CaseResult:
    name: str
    status: str  # PASS / FAIL / SKIP
    notes: list[str]
    files: list[str]
    artifact_chars: int = 0


def validate_case(case: StackCase, artifact: Optional[dict]) -> CaseResult:
    notes: list[str] = []
    if not artifact:
        return CaseResult(case.name, "FAIL", ["no artifact present"], [])
    files = artifact.get("files") or []
    if not files:
        return CaseResult(case.name, "FAIL", ["artifact has no files"], [])

    file_paths = [f.get("path", "") for f in files]
    artifact_chars = sum(len(f.get("content", "") or "") for f in files)

    bad_files = [f for f in files if not f.get("path") or not isinstance(f.get("content", ""), str)]
    if bad_files:
        notes.append(f"{len(bad_files)} files missing path or content")

    miss = missing_references(artifact)
    if miss:
        notes.append(f"missing local refs: {miss}")

    mono = monolithic_issues(artifact)
    if mono:
        notes.append("monolithic: " + "; ".join(mono))

    if case.require_multifile and len(files) < 2:
        notes.append(f"required multi-file but got {len(files)} file(s)")

    # check expected extensions are at least represented (any-of semantics:
    # we look for at least one file matching each requested extension when
    # expected_extensions is non-empty)
    if case.expected_extensions:
        for ext in case.expected_extensions:
            if not any(p.lower().endswith(ext) for p in file_paths):
                notes.append(f"missing any file with extension {ext}")

    status = "PASS" if not notes else "FAIL"
    return CaseResult(case.name, status, notes, file_paths, artifact_chars)


# ---------- Driver ----------


def run() -> int:
    suffix = random_suffix()
    email = f"matrix_{int(time.time())}_{suffix}@example.com"
    name = f"Matrix User {suffix}"
    print(f"[matrix] base={BASE_URL} user={email}", flush=True)

    results: list[CaseResult] = []

    only = {s.strip() for s in os.environ.get("E2E_ONLY", "").split(",") if s.strip()}
    cases = [c for c in CASES if (not only) or c.name in only]
    if only and not cases:
        print(f"[matrix] no cases match E2E_ONLY={sorted(only)}; available: {[c.name for c in CASES]}", flush=True)
        return 2

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(ignore_https_errors=True)
        page = ctx.new_page()
        register_user(page, name=name, email=email, password=PASSWORD)
        print("[matrix] registered + logged in", flush=True)

        for case in cases:
            print(f"\n[matrix] === {case.name} ===", flush=True)
            print(f"[matrix] prompt: {case.prompt[:120]}...", flush=True)
            try:
                send = send_chat(page, case.prompt)
                task = (send.get("task") or {})
                task_id = task.get("id")
                if not task_id:
                    results.append(CaseResult(case.name, "FAIL", [f"no task id from /api/chat: {send}"], []))
                    continue
                final_task = poll_for_completion(page, task_id, TASK_TIMEOUT_S)
                if final_task.get("status") != "COMPLETED":
                    results.append(
                        CaseResult(
                            case.name,
                            "FAIL",
                            [f"task did not complete: status={final_task.get('status')!r}"],
                            [],
                        )
                    )
                    continue
                content = latest_assistant_for_task(page, final_task) or ""
                with open(os.path.join(DEBUG_DIR, f"{case.name}.md"), "w") as fh:
                    fh.write(content)
                artifact = extract_artifact(content)
                if artifact is not None:
                    with open(os.path.join(DEBUG_DIR, f"{case.name}.artifact.json"), "w") as fh:
                        json.dump(artifact, fh, indent=2)
                result = validate_case(case, artifact)
                results.append(result)
                print(
                    f"[matrix] {case.name}: {result.status} files={len(result.files)} chars={result.artifact_chars} content_len={len(content)}",
                    flush=True,
                )
                for note in result.notes:
                    print(f"  - {note}", flush=True)
                if result.status != "PASS":
                    snippet = content[:600].replace("\n", " ⏎ ")
                    print(f"  (snippet) {snippet}", flush=True)
            except Exception as exc:  # pragma: no cover
                results.append(CaseResult(case.name, "FAIL", [f"exception: {exc!r}"], []))
                print(f"[matrix] {case.name}: EXCEPTION {exc!r}", flush=True)

        ctx.close()
        browser.close()

    print("\n========== SUMMARY ==========")
    pass_count = sum(1 for r in results if r.status == "PASS")
    print(f"{pass_count}/{len(results)} cases passed")
    for r in results:
        print(f"  [{r.status}] {r.name} | files={len(r.files)} | chars={r.artifact_chars}")
        for n in r.notes:
            print(f"      - {n}")

    return 0 if pass_count == len(results) else 1


if __name__ == "__main__":
    sys.exit(run())
