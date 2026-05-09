"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Search,
  Pencil,
  Plus,
  Terminal,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export type ToolCallData = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  result?: {
    success: boolean;
    result?: unknown;
    error?: string;
  };
};

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Read: <FileText className="w-4 h-4" />,
  Write: <Plus className="w-4 h-4" />,
  Edit: <Pencil className="w-4 h-4" />,
  Glob: <FolderOpen className="w-4 h-4" />,
  Grep: <Search className="w-4 h-4" />,
  Bash: <Terminal className="w-4 h-4" />,
};

const TOOL_COLORS: Record<string, string> = {
  Read: "text-blue-500 bg-blue-500/10",
  Write: "text-green-500 bg-green-500/10",
  Edit: "text-yellow-500 bg-yellow-500/10",
  Glob: "text-purple-500 bg-purple-500/10",
  Grep: "text-orange-500 bg-orange-500/10",
  Bash: "text-red-500 bg-red-500/10",
};

type ToolCallCardProps = {
  toolCall: ToolCallData;
  expanded?: boolean;
  defaultExpanded?: boolean;
};

export function ToolCallCard({ toolCall, expanded, defaultExpanded = false }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const showExpanded = expanded !== undefined ? expanded : isExpanded;

  const hasResult = toolCall.result !== undefined;
  const isSuccess = toolCall.result?.success ?? null;
  const icon = TOOL_ICONS[toolCall.name] || <Terminal className="w-4 h-4" />;
  const colorClass = TOOL_COLORS[toolCall.name] || "text-gray-500 bg-gray-500/10";

  const formatArgs = (args: Record<string, unknown>): string => {
    const entries = Object.entries(args);
    if (entries.length === 0) return "";

    if (entries.length === 1 && entries[0][0] === "path") {
      return entries[0][1] as string;
    }

    return JSON.stringify(args, null, 2);
  };

  const argsDisplay = formatArgs(toolCall.args);

  return (
    <div
      className={clsx(
        "rounded-lg border overflow-hidden transition-colors",
        isSuccess === true && "border-green-500/30 bg-green-500/5",
        isSuccess === false && "border-red-500/30 bg-red-500/5",
        isSuccess === null && "border-gray-700 bg-gray-800/50"
      )}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={clsx(
          "w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-white/5 transition-colors",
          !hasResult && isSuccess === null && "animate-pulse"
        )}
      >
        <div className={clsx("p-1.5 rounded-md", colorClass)}>{icon}</div>

        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-200">{toolCall.name}</div>
          <div className="text-xs text-gray-400 truncate font-mono">
            {argsDisplay.split("\n")[0]}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isSuccess === null && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          {isSuccess === true && <CheckCircle2 className="w-4 h-4 text-green-500" />}
          {isSuccess === false && <XCircle className="w-4 h-4 text-red-500" />}
          {hasResult && (
            <span className="text-gray-500">
              {showExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </span>
          )}
        </div>
      </button>

      {hasResult && showExpanded && (
        <div className="px-3 pb-3 border-t border-gray-700/50">
          {toolCall.result?.error ? (
            <div className="mt-2 p-2 rounded bg-red-500/10 text-red-400 text-xs font-mono">
              Error: {toolCall.result.error}
            </div>
          ) : toolCall.result?.result ? (
            <div className="mt-2">
              {toolCall.name === "Read" && (
                <ReadResultPreview result={toolCall.result.result} />
              )}
              {toolCall.name === "Glob" && (
                <GlobResultPreview result={toolCall.result.result} />
              )}
              {toolCall.name === "Grep" && (
                <GrepResultPreview result={toolCall.result.result} />
              )}
              {(toolCall.name === "Write" || toolCall.name === "Edit") && (
                <div className="p-2 rounded bg-green-500/10 text-green-400 text-xs">
                  Successfully {toolCall.name === "Write" ? "wrote" : "edited"}{" "}
                  {(toolCall.result.result as { path?: string })?.path || "file"}
                </div>
              )}
              {!["Read", "Glob", "Grep", "Write", "Edit"].includes(toolCall.name) && (
                <pre className="p-2 rounded bg-gray-900/50 text-xs text-gray-300 font-mono overflow-auto max-h-48">
                  {JSON.stringify(toolCall.result.result, null, 2)}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReadResultPreview({ result }: { result: unknown }) {
  const data = result as { path?: string; content?: string; size?: number };
  const content = data.content || "";
  const lines = content.split("\n").slice(0, 20);
  const hasMore = content.split("\n").length > 20;

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">
        {data.path} ({data.size || 0} bytes)
      </div>
      <pre className="p-2 rounded bg-gray-900/50 text-xs text-gray-300 font-mono overflow-auto max-h-64">
        {lines.join("\n")}
        {hasMore && "\n... (truncated)"}
      </pre>
    </div>
  );
}

function GlobResultPreview({ result }: { result: unknown }) {
  const data = result as { matched?: number; files?: Array<{ path: string; size: number }> };
  const files = data.files || [];

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">
        {data.matched || 0} file(s) matched
      </div>
      <div className="space-y-0.5 max-h-32 overflow-auto">
        {files.slice(0, 10).map((f, i) => (
          <div key={i} className="text-xs text-gray-300 font-mono">
            {f.path}
          </div>
        ))}
        {files.length > 10 && (
          <div className="text-xs text-gray-500">... and {files.length - 10} more</div>
        )}
      </div>
    </div>
  );
}

function GrepResultPreview({ result }: { result: unknown }) {
  const data = result as {
    pattern?: string;
    searched?: number;
    results?: Array<{ path: string; matches: number; lines: string[] }>;
  };
  const results = data.results || [];

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">
        Found {data.results?.reduce((sum, r) => sum + r.matches, 0) || 0} matches in{" "}
        {data.searched || 0} files
      </div>
      <div className="space-y-2 max-h-48 overflow-auto">
        {results.slice(0, 5).map((r, i) => (
          <div key={i}>
            <div className="text-xs text-gray-400 font-mono">
              {r.path} ({r.matches} matches)
            </div>
            {r.lines.slice(0, 3).map((line, j) => (
              <div key={j} className="text-xs text-gray-300 font-mono pl-2">
                {line}
              </div>
            ))}
            {r.lines.length > 3 && (
              <div className="text-xs text-gray-500 pl-2">... more</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ToolCallCard;