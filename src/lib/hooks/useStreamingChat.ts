"use client";

import { useState, useCallback, useRef } from "react";
import type { ToolCallData } from "@/components/ToolCallCard";

export type StreamEvent = {
  type: "status" | "tool_call" | "tool_result" | "text" | "complete" | "error";
  data: unknown;
};

export type StreamingState = {
  isStreaming: boolean;
  toolCalls: ToolCallData[];
  textContent: string;
  stats: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    iterations: number;
    toolCalls: number;
    model: string;
  } | null;
  error: string | null;
};

export function useStreamingChat() {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    toolCalls: [],
    textContent: "",
    stats: null,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    onComplete?: (stats: StreamingState["stats"]) => void
  ) => {
    if (state.isStreaming) {
      abortControllerRef.current?.abort();
    }

    setState({
      isStreaming: true,
      toolCalls: [],
      textContent: "",
      stats: null,
      error: null,
    });

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("data: ") && eventType) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              setState((prev) => {
                switch (eventType) {
                  case "tool_call":
                    return {
                      ...prev,
                      toolCalls: [...prev.toolCalls, {
                        callId: data.callId,
                        name: data.name,
                        args: data.args,
                      }],
                    };
                  case "tool_result":
                    return {
                      ...prev,
                      toolCalls: prev.toolCalls.map((tc) =>
                        tc.callId === data.callId
                          ? { ...tc, result: { success: data.success, result: data.result, error: data.error } }
                          : tc
                      ),
                    };
                  case "text":
                    return {
                      ...prev,
                      textContent: data.content || "",
                    };
                  case "complete":
                    return {
                      ...prev,
                      stats: data,
                    };
                  default:
                    return prev;
                }
              });
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      setState((prev) => {
        onComplete?.(prev.stats);
        return prev;
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        isStreaming: false,
        error: error instanceof Error ? error.message : "Stream failed",
      }));
    } finally {
      setState((prev) => ({
        ...prev,
        isStreaming: false,
      }));
    }
  }, [state.isStreaming]);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setState({
      isStreaming: false,
      toolCalls: [],
      textContent: "",
      stats: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    startStream,
    abort,
    reset,
  };
}