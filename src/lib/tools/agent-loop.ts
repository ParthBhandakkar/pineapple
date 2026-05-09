import { prisma } from "@/lib/prisma";
import { getBillingModel } from "@/lib/models";
import { generateAgentResponse } from "@/lib/ai";
import { createOpenCodeSession } from "@/lib/opencode";
import { logError } from "@/lib/error-logger";
import { estimateTaskCost } from "@/lib/tokens";

export type AgentLoopConfig = {
  userId: string;
  conversationId: string;
  prompt: string;
  billingModelCode?: string | null;
  images?: string[];
  onToolCall?: (call: ToolCallEvent) => void;
  onToolResult?: (result: ToolResultEvent) => void;
  onTextChunk?: (text: string) => void;
  onComplete?: (result: AgentLoopResult) => void;
  abortSignal?: AbortSignal;
};

export type ToolCallEvent = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolResultEvent = {
  callId: string;
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
};

export type AgentLoopResult = {
  content: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  toolCalls: number;
  model: string;
};

const MAX_LOOP_ITERATIONS = 100;

const SYSTEM_PROMPT = `You are an expert AI coding assistant inside PineApple. You have access to tools to read, write, and edit files in the user's workspace.

CRITICAL INSTRUCTIONS:
1. Use the Read tool to explore files before making changes
2. Use the Edit tool for targeted modifications - never rewrite entire files unless necessary
3. Use the Write tool only for new files or complete replacements
4. Use Glob and Grep to explore the codebase and find relevant files
5. Think step by step for complex tasks - plan your approach before acting
6. When working on a project, start by understanding the existing structure
7. Always provide working, complete code - no placeholders or stubs
8. Keep files organized with proper structure for the language/framework used

You can call multiple tools in parallel if their operations are independent.

Tool results are returned as JSON. Handle errors gracefully - if a tool fails, explain the issue and propose an alternative approach.`;

export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentLoopResult> {
  const selectedModel = getBillingModel(config.billingModelCode);

  if (config.abortSignal?.aborted) {
    throw new Error("Agent loop aborted");
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: config.conversationId, userId: config.userId },
    select: {
      id: true,
      title: true,
      opencodeSessionId: true,
    },
  });
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (!process.env.OPENCODE_SERVER_URL) {
    throw new Error("OpenCode is required but OPENCODE_SERVER_URL is not configured.");
  }

  let opencodeSessionId = conversation.opencodeSessionId;
  if (!opencodeSessionId) {
    const openCodeSession = await createOpenCodeSession(conversation.title).catch((error) => {
      logError("OpenCode session bootstrap failed", error, { userId: config.userId, conversationId: config.conversationId });
      return null;
    });
    if (!openCodeSession?.id) {
      throw new Error("Could not initialize an OpenCode session for this conversation.");
    }
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { opencodeSessionId: openCodeSession.id },
    });
    opencodeSessionId = updatedConversation.opencodeSessionId;
  }

  try {
    const generated = await generateAgentResponse({
      userId: config.userId,
      prompt: config.prompt,
      agentName: "Code Pilot",
      conversationId: conversation.id,
      opencodeSessionId,
      billingModelCode: config.billingModelCode,
      images: config.images,
    });

    const content = generated.content ?? "";
    const totalTokens = generated.totalTokens ?? estimateTaskCost(config.prompt);
    const result: AgentLoopResult = {
      content,
      totalTokens,
      inputTokens: generated.inputTokens ?? 0,
      outputTokens: generated.outputTokens ?? Math.max(0, totalTokens - (generated.inputTokens ?? 0)),
      iterations: 1,
      toolCalls: 0,
      model: generated.model ?? selectedModel.openRouterModel,
    };

    // Stream content progressively in chunks for real-time typing effect
    if (config.onTextChunk && content) {
      const CHUNK_SIZE = 12;
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        if (config.abortSignal?.aborted) break;
        config.onTextChunk(content.slice(0, i + CHUNK_SIZE));
        // Yield control to allow SSE flush
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      // Ensure final full content is sent
      config.onTextChunk(content);
    }

    config.onComplete?.(result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    logError("Agent loop failed", error, {
      userId: config.userId,
      conversationId: config.conversationId,
    });
    throw error instanceof Error ? error : new Error("OpenCode request failed");
  }
}

export { MAX_LOOP_ITERATIONS, SYSTEM_PROMPT };