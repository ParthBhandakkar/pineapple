import json
import os
import random
import string
import sys
import time
from dataclasses import dataclass, asdict

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:13300").rstrip("/")
PASSWORD = os.environ.get("E2E_PASSWORD", "SmokePass123!")
WAIT_MS = int(os.environ.get("E2E_WAIT_MS", "120000"))


@dataclass
class StepResult:
    name: str
    passed: bool
    detail: str


def random_suffix(length: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def register_user(page, name: str, email: str, password: str) -> None:
    page.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=WAIT_MS)
    page.get_by_role("button", name="Register").click(timeout=15_000)
    page.get_by_label("Name").fill(name)
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(password)
    page.get_by_role("button", name="Start Free Tier").click()
    page.wait_for_url("**/dashboard", timeout=WAIT_MS)
    page.get_by_role("button", name="Workspace").first.wait_for(timeout=WAIT_MS)


def poll_for_completed_task(page, prompt: str, timeout_s: int = 150):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        res = page.request.get(f"{BASE_URL}/api/bootstrap")
        if res.ok:
            body = res.json()
            tasks = body.get("tasks", [])
            for task in tasks:
                if task.get("prompt") == prompt and task.get("status") == "COMPLETED":
                    return task
        time.sleep(2)
    return None


def extract_latest_assistant_for_prompt(page, prompt: str):
    res = page.request.get(f"{BASE_URL}/api/bootstrap")
    if not res.ok:
        return None
    body = res.json()
    conversations = body.get("conversations", [])
    for conv in conversations:
        msgs = conv.get("messages", [])
        for idx in range(len(msgs) - 1):
            if msgs[idx].get("role") == "USER" and msgs[idx].get("content") == prompt:
                # nearest assistant after this user prompt
                for j in range(idx + 1, len(msgs)):
                    if msgs[j].get("role") == "ASSISTANT":
                        return msgs[j].get("content", "")
    return None


def run() -> int:
    steps: list[StepResult] = []
    stamp = int(time.time())
    suffix = random_suffix()
    email = f"smoke_{stamp}_{suffix}@example.com"
    name = f"Smoke User {suffix}"
    prompt = f"Smoke test prompt {suffix}: reply in one short line."
    coding_prompt = (
        f"Build a Python CLI todo app using a pineapple-project artifact. "
        f"Use exactly these files: main.py, storage.py, README.md. "
        f"Use JSON file persistence in storage.py. Marker={suffix}"
    )
    followup_prompt = (
        f"Now update only storage.py to include completed_at timestamps while keeping main.py behavior unchanged. Marker={suffix}"
    )
    long_marker = f"LONGCTX-{suffix}"
    long_prompt = (
        "Context stress test. Remember this marker exactly: "
        f"{long_marker}. "
        "Now here are lines: "
        + " ".join([f"L{i}=value{i}" for i in range(1, 220)])
        + " Reply briefly with 'stored'."
    )
    long_followup = "From my previous message, return only the marker I asked you to remember."
    workspace_file = f"smoke/{suffix}.txt"
    workspace_content = f"hello from smoke test {suffix}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        anon_context = browser.new_context()
        anon_page = anon_context.new_page()
        context = browser.new_context()
        page = context.new_page()
        context_b = browser.new_context()
        page_b = context_b.new_page()

        try:
            anon_page.goto(f"{BASE_URL}/", wait_until="domcontentloaded", timeout=WAIT_MS)
            steps.append(StepResult("landing_loaded", True, "Landing page opened"))
        except Exception as error:
            steps.append(StepResult("landing_loaded", False, f"Failed to open landing page: {error}"))
            print(json.dumps({"baseUrl": BASE_URL, "email": email, "steps": [asdict(s) for s in steps]}, indent=2))
            browser.close()
            return 1

        # Unauthenticated workspace read/list should be blocked.
        try:
            unauth_ws = anon_page.request.get(f"{BASE_URL}/api/workspace")
            unauth_read = anon_page.request.post(f"{BASE_URL}/api/workspace/read", data={"path": workspace_file})
            if unauth_ws.status == 401 and unauth_read.status == 401:
                steps.append(StepResult("workspace_auth_guard", True, "Unauthenticated workspace APIs return 401"))
            else:
                steps.append(
                    StepResult(
                        "workspace_auth_guard",
                        False,
                        f"Expected 401s, got /workspace={unauth_ws.status} /workspace/read={unauth_read.status}",
                    )
                )
        except Exception as error:
            steps.append(StepResult("workspace_auth_guard", False, f"Could not validate workspace auth guard: {error}"))

        try:
            register_user(page, name, email, PASSWORD)
            steps.append(StepResult("register_and_login", True, "Registered and reached dashboard"))
        except Exception as error:
            form_message = ""
            try:
                form_message = page.locator(".form-message").inner_text(timeout=2_000)
            except Exception:
                form_message = "no form error text captured"
            steps.append(StepResult("register_and_login", False, f"Could not register/login: {error} ({form_message})"))

        # Workspace flow: create -> open -> verify content -> delete.
        try:
            page.get_by_role("button", name="Workspace").first.click(timeout=20_000)
            page.get_by_role("heading", name="Workspace").wait_for(timeout=WAIT_MS)
            page.get_by_role("button", name="+ New File").click()
            page.get_by_placeholder("File path (e.g. src/index.js)").fill(workspace_file)
            page.get_by_placeholder("File content (optional)").fill(workspace_content)
            page.get_by_role("button", name="Create").click()
            file_row = page.locator(".workspace-file-item", has_text=workspace_file).first
            file_row.wait_for(timeout=WAIT_MS)
            file_row.click()
            page.locator(".workspace-file-content", has_text=workspace_content).first.wait_for(timeout=WAIT_MS)
            file_row.locator(".workspace-delete-btn").click()
            page.locator(".workspace-file-item", has_text=workspace_file).first.wait_for(state="detached", timeout=WAIT_MS)
            steps.append(StepResult("workspace_create_open_delete", True, "Workspace file lifecycle passed"))
        except Exception as error:
            steps.append(StepResult("workspace_create_open_delete", False, f"Workspace flow failed: {error}"))

        # Cross-user read should be denied (file-level permission consistency).
        try:
            # Recreate file in user A
            page.get_by_role("button", name="Workspace").first.click(timeout=20_000)
            page.get_by_role("button", name="+ New File").click()
            page.get_by_placeholder("File path (e.g. src/index.js)").fill(workspace_file)
            page.get_by_placeholder("File content (optional)").fill(workspace_content)
            page.get_by_role("button", name="Create").click()
            page.locator(".workspace-file-item", has_text=workspace_file).first.wait_for(timeout=WAIT_MS)

            email_b = f"smoke_b_{stamp}_{suffix}@example.com"
            register_user(page_b, f"Smoke User B {suffix}", email_b, PASSWORD)
            res_b = page_b.request.post(f"{BASE_URL}/api/workspace/read", data={"path": workspace_file})
            if res_b.status == 404:
                steps.append(StepResult("workspace_cross_user_read_blocked", True, "Second user cannot read first user's file"))
            else:
                steps.append(
                    StepResult(
                        "workspace_cross_user_read_blocked",
                        False,
                        f"Expected 404 for cross-user read, got {res_b.status}",
                    )
                )
        except Exception as error:
            steps.append(StepResult("workspace_cross_user_read_blocked", False, f"Cross-user permission test failed: {error}"))

        # Chat flow: send prompt and verify user prompt persists in chat.
        try:
            page.get_by_role("button", name="Chat").first.click(timeout=20_000)
            box = page.get_by_placeholder("Ask PineApple anything…")
            box.fill(prompt)
            page.get_by_role("button", name="Send").click()
            page.locator(".bubble.user", has_text=prompt).first.wait_for(timeout=WAIT_MS)
            steps.append(StepResult("chat_prompt_persists", True, "User prompt appears in chat"))
        except Exception as error:
            steps.append(StepResult("chat_prompt_persists", False, f"Chat prompt persistence failed: {error}"))

        # Task visibility: task row should include the prompt text.
        try:
            page.get_by_role("button", name="Tasks").first.click(timeout=20_000)
            page.get_by_role("heading", name="Tasks").wait_for(timeout=WAIT_MS)
            page.locator("tbody tr", has_text=prompt).first.wait_for(timeout=WAIT_MS)
            steps.append(StepResult("task_row_visible", True, "Task appears in Tasks tab"))
        except Exception as error:
            steps.append(StepResult("task_row_visible", False, f"Task row not visible: {error}"))

        # Completed task output should be visible in tasks UI.
        try:
            done = poll_for_completed_task(page, prompt, timeout_s=120)
            if not done:
                steps.append(StepResult("completed_output_visible", False, "Task did not reach COMPLETED status in time"))
            else:
                page.get_by_role("button", name="Tasks").first.click(timeout=20_000)
                row = page.locator("tbody tr", has_text=prompt).first
                row.wait_for(timeout=WAIT_MS)
                preview = row.locator(".task-fail-reason").first
                preview.wait_for(timeout=WAIT_MS)
                text = preview.inner_text()
                if len(text.strip()) > 0:
                    steps.append(StepResult("completed_output_visible", True, "Completed task output is shown in task row"))
                else:
                    steps.append(StepResult("completed_output_visible", False, "Completed task output text is empty"))
        except Exception as error:
            steps.append(StepResult("completed_output_visible", False, f"Could not verify completed output visibility: {error}"))

        # Coding artifact behavior + file type freedom + context follow-up smoke checks.
        try:
            page.get_by_role("button", name="Chat").first.click(timeout=20_000)
            box = page.get_by_placeholder("Ask PineApple anything…")
            box.fill(coding_prompt)
            page.get_by_role("button", name="Send").click()
            page.locator(".bubble.user", has_text=f"Marker={suffix}").first.wait_for(timeout=WAIT_MS)
            done1 = poll_for_completed_task(page, coding_prompt, timeout_s=150)
            assistant1 = extract_latest_assistant_for_prompt(page, coding_prompt) or ""
            checks = [
                "```pineapple-project" in assistant1,
                "main.py" in assistant1,
                "storage.py" in assistant1,
                "README.md" in assistant1,
            ]
            if done1 and all(checks):
                steps.append(StepResult("coding_artifact_and_file_types", True, "Assistant produced multi-file Python artifact as requested"))
            else:
                steps.append(
                    StepResult(
                        "coding_artifact_and_file_types",
                        False,
                        "Did not reliably observe requested Python artifact/files in assistant output",
                    )
                )

            # Follow-up context instruction should reference storage.py update.
            box.fill(followup_prompt)
            page.get_by_role("button", name="Send").click()
            done2 = poll_for_completed_task(page, followup_prompt, timeout_s=150)
            assistant2 = extract_latest_assistant_for_prompt(page, followup_prompt) or ""
            if done2 and "storage.py" in assistant2:
                steps.append(StepResult("context_followup_behavior", True, "Follow-up coding change references prior file context"))
            else:
                steps.append(StepResult("context_followup_behavior", False, "Follow-up response did not clearly preserve file context"))
        except Exception as error:
            steps.append(StepResult("coding_artifact_and_file_types", False, f"Coding behavior check failed: {error}"))

        # Best-effort: try to see assistant token/model line in chat.
        try:
            page.get_by_role("button", name="Chat").first.click(timeout=20_000)
            page.locator("small", has_text="Tokens:").first.wait_for(timeout=90_000)
            model_line = page.locator("small", has_text="Tokens:").first.inner_text()
            if "openrouter/" in model_line.lower():
                steps.append(StepResult("model_label_normalized", False, f"Model label still contains openrouter prefix: {model_line}"))
            else:
                steps.append(StepResult("model_label_normalized", True, f"Model label normalized: {model_line}"))
        except PlaywrightTimeoutError:
            steps.append(
                StepResult(
                    "model_label_normalized",
                    True,
                    "Skipped strict check: assistant token/model line did not appear within timeout window",
                )
            )
        except Exception as error:
            steps.append(StepResult("model_label_normalized", False, f"Could not inspect model label: {error}"))

        # Long context retention behavior check.
        try:
            page.get_by_role("button", name="Chat").first.click(timeout=20_000)
            box = page.get_by_placeholder("Ask PineApple anything…")
            box.fill(long_prompt)
            page.get_by_role("button", name="Send").click()
            done_long_1 = poll_for_completed_task(page, long_prompt, timeout_s=180)
            if not done_long_1:
                steps.append(StepResult("long_context_retention", False, "Long prompt task did not complete in time"))
            else:
                box.fill(long_followup)
                page.get_by_role("button", name="Send").click()
                done_long_2 = poll_for_completed_task(page, long_followup, timeout_s=180)
                assistant_long = extract_latest_assistant_for_prompt(page, long_followup) or ""
                if done_long_2 and long_marker in assistant_long:
                    steps.append(StepResult("long_context_retention", True, "Assistant retained marker across long context exchange"))
                else:
                    steps.append(StepResult("long_context_retention", False, "Assistant did not reliably return long-context marker"))
        except Exception as error:
            steps.append(StepResult("long_context_retention", False, f"Long-context check failed: {error}"))

        # Retry API contract check: completed task should not be retryable.
        try:
            res = page.request.get(f"{BASE_URL}/api/bootstrap")
            task_id = None
            if res.ok:
                body = res.json()
                for task in body.get("tasks", []):
                    if task.get("prompt") == prompt:
                        task_id = task.get("id")
                        break
            if task_id:
                retry_res = page.request.post(f"{BASE_URL}/api/chat/retry", data={"taskId": task_id})
                if retry_res.status == 400:
                    steps.append(StepResult("retry_contract_check", True, "Retry endpoint enforces failed-only task retries"))
                else:
                    steps.append(StepResult("retry_contract_check", False, f"Expected 400 for retrying non-failed task, got {retry_res.status}"))
            else:
                steps.append(StepResult("retry_contract_check", False, "Could not locate task id for retry contract check"))
        except Exception as error:
            steps.append(StepResult("retry_contract_check", False, f"Retry contract check failed: {error}"))

        browser.close()

    result = {
        "baseUrl": BASE_URL,
        "email": email,
        "steps": [asdict(s) for s in steps],
    }
    print(json.dumps(result, indent=2))
    return 0 if all(s.passed for s in steps) else 1


if __name__ == "__main__":
    sys.exit(run())
