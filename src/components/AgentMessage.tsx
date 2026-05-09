"use client";

import { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { Bot, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { ToolCallCard, type ToolCallData } from "./ToolCallCard";

type AgentMessageProps = {
  content: string;
  toolCalls?: ToolCallData[];
  modelUsed?: string;
  timestamp?: string;
  isStreaming?: boolean;
};

export function AgentMessage({
  content,
  toolCalls = [],
  modelUsed,
  timestamp,
  isStreaming = false,
}: AgentMessageProps) {
  const [showAllToolCalls, setShowAllToolCalls] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [displayedContent, setDisplayedContent] = useState(isStreaming ? "" : content);

  useEffect(() => {
    if (isStreaming && content) {
      setDisplayedContent(content);
    } else {
      setDisplayedContent(content);
    }
  }, [content, isStreaming]);

  return (
    <div className="flex gap-3 py-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
        <Bot className="w-4 h-4 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-200">Assistant</span>
          {modelUsed && (
            <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
              {modelUsed.split("/").pop()}
            </span>
          )}
          {isStreaming && (
            <span className="text-xs text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded animate-pulse">
              Working...
            </span>
          )}
          {timestamp && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>

        {toolCalls.length > 0 && (
          <div className="mb-3 space-y-2">
            <button
              onClick={() => setShowAllToolCalls(!showAllToolCalls)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              {showAllToolCalls ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              {toolCalls.length} tool call{toolCalls.length > 1 ? "s" : ""}
            </button>

            {showAllToolCalls && (
              <div className="space-y-1">
                {toolCalls.map((tc) => (
                  <ToolCallCard key={tc.callId} toolCall={tc} defaultExpanded={false} />
                ))}
              </div>
            )}
          </div>
        )}

        <div
          ref={contentRef}
          className={clsx(
            "text-sm text-gray-300 leading-relaxed",
            isStreaming && "after:content-['▋'] after:animate-pulse"
          )}
        >
          {displayedContent || (isStreaming ? null : (
            <span className="text-gray-500 italic">Processing...</span>
          ))}
        </div>

        {isStreaming && !content && (
          <div className="text-sm text-gray-500 flex items-center gap-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span>Using tools...</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentMessage;