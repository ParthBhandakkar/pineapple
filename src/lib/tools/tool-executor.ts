import { prisma } from "@/lib/prisma";
import { TOOL_REGISTRY, type ToolName } from "./tool-registry";

export type ToolResult =
  | { success: true; result: unknown }
  | { success: false; error: string };

type ToolContext = {
  userId: string;
  conversationId: string;
};

type ToolArgs = Record<string, unknown>;

export async function executeTool(
  name: string,
  args: ToolArgs,
  ctx: ToolContext
): Promise<ToolResult> {
  if (!TOOL_REGISTRY[name as ToolName]) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  switch (name as ToolName) {
    case "Read":
      return executeRead(args, ctx);
    case "Write":
      return executeWrite(args, ctx);
    case "Edit":
      return executeEdit(args, ctx);
    case "Glob":
      return executeGlob(args, ctx);
    case "Grep":
      return executeGrep(args, ctx);
    case "Bash":
      return { success: false, error: "Bash execution is not yet available. Please use Read/Write/Edit to work with files." };
    case "WebSearch":
      return { success: false, error: "Web search is not yet available." };
    case "WebFetch":
      return { success: false, error: "Web fetch is not yet available." };
    case "TodoWrite":
      return { success: false, error: "TodoWrite is not needed - the model can track tasks in context." };
    default:
      return { success: false, error: `Tool ${name} is not implemented.` };
  }
}

async function executeRead(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const path = args.path as string;
  if (!path) {
    return { success: false, error: "path is required" };
  }

  const normalizedPath = normalizePath(path);

  const file = await prisma.userFile.findUnique({
    where: { userId_path: { userId: ctx.userId, path: normalizedPath } },
  });

  if (!file) {
    return { success: false, error: `File not found: ${path}` };
  }

  return {
    success: true,
    result: {
      path: file.path,
      content: file.content,
      size: file.sizeBytes,
      mimeType: file.mimeType,
    },
  };
}

async function executeWrite(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const path = args.path as string;
  const content = args.content as string;

  if (!path) {
    return { success: false, error: "path is required" };
  }

  if (typeof content !== "string") {
    return { success: false, error: "content must be a string" };
  }

  const normalizedPath = normalizePath(path);
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  const mimeType = detectMimeType(normalizedPath);

  await prisma.userFile.upsert({
    where: { userId_path: { userId: ctx.userId, path: normalizedPath } },
    update: { content, sizeBytes, mimeType },
    create: {
      userId: ctx.userId,
      path: normalizedPath,
      content,
      sizeBytes,
      mimeType,
    },
  });

  return {
    success: true,
    result: {
      path: normalizedPath,
      written: true,
      size: sizeBytes,
    },
  };
}

async function executeEdit(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const path = args.path as string;
  const oldText = args.oldText as string;
  const newText = args.newText as string;

  if (!path) {
    return { success: false, error: "path is required" };
  }

  if (typeof oldText !== "string" || typeof newText !== "string") {
    return { success: false, error: "oldText and newText must be strings" };
  }

  const normalizedPath = normalizePath(path);

  const file = await prisma.userFile.findUnique({
    where: { userId_path: { userId: ctx.userId, path: normalizedPath } },
  });

  if (!file) {
    return { success: false, error: `File not found: ${path}` };
  }

  if (!file.content.includes(oldText)) {
    return {
      success: false,
      error: `Could not find the specified text in ${path}. Please check the exact content and try again.`,
    };
  }

  const newContent = file.content.replace(oldText, newText);
  const sizeBytes = Buffer.byteLength(newContent, "utf-8");

  await prisma.userFile.update({
    where: { id: file.id },
    data: { content: newContent, sizeBytes },
  });

  return {
    success: true,
    result: {
      path: normalizedPath,
      edited: true,
      newSize: sizeBytes,
    },
  };
}

async function executeGlob(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const pattern = (args.pattern as string) || "**/*";

  const files = await prisma.userFile.findMany({
    where: { userId: ctx.userId },
    select: { path: true, sizeBytes: true, mimeType: true },
    orderBy: { path: "asc" },
  });

  const regex = globToRegex(pattern);
  const matched = files.filter((f) => regex.test(f.path));

  return {
    success: true,
    result: {
      pattern,
      matched: matched.length,
      files: matched.map((f) => ({
        path: f.path,
        size: f.sizeBytes,
        type: f.mimeType,
      })),
    },
  };
}

async function executeGrep(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const pattern = args.pattern as string;
  const searchPath = args.path as string | undefined;
  const caseSensitive = args.caseSensitive as boolean | undefined;

  if (!pattern) {
    return { success: false, error: "pattern is required" };
  }

  const files = await prisma.userFile.findMany({
    where: { userId: ctx.userId },
    select: { path: true, content: true },
  });

  let targetFiles = files;
  if (searchPath) {
    const normalizedSearchPath = normalizePath(searchPath);
    targetFiles = files.filter((f) => {
      if (f.path === normalizedSearchPath) return true;
      if (normalizedSearchPath.endsWith("/")) {
        return f.path.startsWith(normalizedSearchPath);
      }
      return f.path.startsWith(normalizedSearchPath + "/") || f.path.startsWith(normalizedSearchPath);
    });
  }

  const flags = caseSensitive ? "g" : "gi";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return { success: false, error: `Invalid regex pattern: ${pattern}` };
  }

  const results: Array<{
    path: string;
    matches: number;
    lines: string[];
  }> = [];

  for (const file of targetFiles) {
    const lines = file.content.split("\n");
    const matchedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matchedLines.push(`${i + 1}: ${lines[i]}`);
      }
    }

    if (matchedLines.length > 0) {
      results.push({
        path: file.path,
        matches: matchedLines.length,
        lines: matchedLines.slice(0, 50),
      });
    }
  }

  return {
    success: true,
    result: {
      pattern,
      searched: targetFiles.length,
      results,
      totalMatches: results.reduce((sum, r) => sum + r.matches, 0),
    },
  };
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .filter((p) => p !== "." && p !== "..")
    .join("/");
}

function detectMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    ts: "text/typescript",
    tsx: "text/typescript",
    js: "text/javascript",
    jsx: "text/javascript",
    mjs: "text/javascript",
    cjs: "text/javascript",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    scss: "text/x-scss",
    sass: "text/x-sass",
    less: "text/x-less",
    md: "text/markdown",
    py: "text/x-python",
    rb: "text/x-ruby",
    go: "text/x-go",
    rs: "text/x-rust",
    java: "text/x-java",
    cpp: "text/x-c++",
    c: "text/x-c",
    h: "text/x-chdr",
    sh: "text/x-shellscript",
    bash: "text/x-shellscript",
    yaml: "text/yaml",
    yml: "text/yaml",
    xml: "text/xml",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
  };
  return mimeTypes[ext] || "text/plain";
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLE_STAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{DOUBLE_STAR\}\}/g, ".*")
    .replace(/\//g, "\\/");

  return new RegExp("^" + escaped + "$", "i");
}

export type { ToolContext, ToolArgs };