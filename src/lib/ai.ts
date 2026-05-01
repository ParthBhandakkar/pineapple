import { prisma } from "@/lib/prisma";
import { fetchWithModelTimeout } from "@/lib/fetch-timeout";
import { promptOpenCodeSession } from "@/lib/opencode";
import { getBillingModel } from "@/lib/models";
import { logError } from "@/lib/error-logger";

type GenerateInput = {
  userId: string;
  prompt: string;
  agentName: string;
  conversationId?: string;
  opencodeSessionId?: string | null;
  billingModelCode?: string | null;
};

type GenerateResult = {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  selectedModelCode?: string;
  selectedModelMultiplier?: number;
  fallbackNotice?: string;
};

type ProjectArtifactFile = {
  path?: unknown;
  content?: unknown;
};

type ProjectArtifactPayload = {
  name?: unknown;
  entry?: unknown;
  files?: unknown;
};

const FORCE_OPENCODE_ONLY =
  process.env.FORCE_OPENCODE_ONLY === "true";

function isModelIdentityQuestion(prompt: string) {
  const p = prompt.toLowerCase();
  return (
    /\bwhich\s+model\b/.test(p) ||
    /\bwhat\s+model\b/.test(p) ||
    /\bwhat\s+model\s+are\s+you\b/.test(p) ||
    /\bmodel\s+are\s+you\b/.test(p) ||
    /\bwhich\s+model\s+are\s+you\b/.test(p) ||
    /\bmodel\b\s+usage\b/.test(p)
  );
}

function isSimpleGreeting(prompt: string) {
  const p = prompt.trim().toLowerCase();
  if (!p) return false;

  // Robust greeting-only detection (handles whitespace + punctuation).
  // Examples: "hi", "hi!", "hello", "hey???"
  return /^(hi|hello|hey)\s*[!?.]*$/.test(p);
}

function isCodingProjectRequest(prompt: string) {
  const p = prompt.toLowerCase();
  return (
    /\b(create|build|make|generate|code|develop)\b/.test(p) &&
    /\b(website|web site|site|portfolio|landing page|page|project|app|application|html|css|javascript|react|next\.?js|code|ecommerce|commerce|store|shop|saas|dashboard|blog)\b/.test(p)
  );
}

const BASE_AGENT_SYSTEM =
  "You are an agent inside PineApple. Be concise, action-oriented, and do not claim that high-risk actions were executed unless an explicit approval flow has already completed. IMPORTANT: Do NOT include any hidden reasoning, 'thinking', or analysis. Output only the final answer.";

const PROJECT_ARTIFACT_SYSTEM = [
  "When the user asks you to build, code, create, or generate a website, app, landing page, dashboard, ecommerce store, or similar project, return a complete preview-ready project artifact.",
  "Do not use tools, do not write files to the server filesystem, and do not describe a project without providing the files.",
  "Your answer must include one short intro sentence, then exactly one fenced block tagged pineapple-project.",
  "Inside that fenced block, output valid JSON only with this shape: {\"name\":\"Project name\",\"entry\":\"index.html\",\"files\":[{\"path\":\"index.html\",\"content\":\"...\"}]}",
  "For static sites, prefer one complete self-contained index.html with embedded CSS and JavaScript. Use separate files only if the user explicitly asks for a framework or multi-file structure.",
  "Keep the artifact compact: no external fonts, no external icon libraries, no giant placeholder content, and no unnecessary framework setup unless the user asked for it.",
  "Satisfy the user's exact product/domain request. For ecommerce, include product listing, cart state, account button, add-to-cart behavior, totals, and a usable checkout/account surface.",
  "Never reuse unrelated portfolio, agency, selected-work, or contact-template copy unless the user asked for a portfolio.",
  "The preview opens the entry file directly, so all CSS and JS must be referenced by relative paths that exist in files.",
].join(" ");

function buildSystemPrompt(input: GenerateInput, modelText: string) {
  const parts = [
    BASE_AGENT_SYSTEM,
    `Current UI-selected model: ${modelText}.`,
    `If the user asks "which model are you" / "what model are you" / "what model are you using" or similar, respond with ONLY this exact text: "${modelText}". No additional words. No explanations.`,
  ];

  if (isCodingProjectRequest(input.prompt)) {
    parts.push(PROJECT_ARTIFACT_SYSTEM);
  }

  return parts.join("\n\n");
}

function isValidProjectArtifact(value: unknown): value is { name: string; entry?: string; files: Array<{ path: string; content: string }> } {
  const artifact = value as ProjectArtifactPayload;

  return (
    Boolean(artifact) &&
    typeof artifact.name === "string" &&
    Array.isArray(artifact.files) &&
    artifact.files.length > 0 &&
    artifact.files.every((file: ProjectArtifactFile) => typeof file.path === "string" && typeof file.content === "string")
  );
}

function parseJsonObjectSlice(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(value.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function decodeEscapedContent(value: string) {
  let decoded = value.trim();

  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (typeof parsed !== "string" || parsed === decoded) break;
      decoded = parsed.trim();
    } catch {
      break;
    }
  }

  return decoded;
}

function extractProjectArtifact(value: unknown): { name: string; entry?: string; files: Array<{ path: string; content: string }> } | null {
  if (isValidProjectArtifact(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const wrapped = value as { artifact?: unknown; project?: unknown; content?: unknown };
    return (
      extractProjectArtifact(wrapped.artifact) ??
      extractProjectArtifact(wrapped.project) ??
      (typeof wrapped.content === "string" ? extractProjectArtifact(parseJsonObjectSlice(decodeEscapedContent(wrapped.content))) : null)
    );
  }

  return null;
}

function normalizeProjectArtifactContent(content: string, enabled: boolean) {
  if (!enabled || content.includes("```pineapple-project")) {
    return content;
  }

  const normalized = decodeEscapedContent(content);
  const artifact = extractProjectArtifact(parseJsonObjectSlice(normalized));

  if (!artifact) {
    return content;
  }

  const intro = normalized.slice(0, normalized.indexOf("{")).trim() || "I've created a complete project structure for you.";

  return [
    intro,
    "",
    "```pineapple-project",
    JSON.stringify(artifact, null, 2),
    "```",
  ].join("\n");
}

async function getConversationHistory(userId: string, conversationId?: string) {
  if (!conversationId) {
    return [];
  }

  const messages = await prisma.message.findMany({
    where: { userId, conversationId },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  return messages.map((message) => ({
    role: message.role === "USER" ? "user" : message.role === "ASSISTANT" ? "assistant" : "system",
    content: message.content,
  }));
}

function summarizeOpenRouterError(status: number, body: string, openrouterModel: string) {
  const trimmed = body.replace(/\s+/g, " ").trim();

  let detail: string | null = null;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string | number } };
    if (parsed?.error?.message) detail = parsed.error.message;
  } catch {
    detail = trimmed.slice(0, 240) || null;
  }

  if (status === 401 || status === 403) {
    return `Model provider rejected the request (${status}). Check OPENROUTER_API_KEY.${detail ? ` ${detail}` : ""}`;
  }
  if (status === 404) {
    return `The selected model "${openrouterModel}" is unavailable on OpenRouter right now. Pick a different model from the dropdown.${detail ? ` ${detail}` : ""}`;
  }
  if (status === 408 || status === 504) {
    return `The model "${openrouterModel}" timed out before answering. Try again or pick a faster model.${detail ? ` ${detail}` : ""}`;
  }
  if (status === 429) {
    return `Model provider rate-limited the request. Try again shortly or pick a different model.${detail ? ` ${detail}` : ""}`;
  }

  return `Model provider failed (${status}).${detail ? ` ${detail}` : ""}`;
}

async function generateOpenRouterResponse(
  input: GenerateInput,
  modelText: string,
  fallbackNotice?: string,
): Promise<GenerateResult> {
  const selectedModel = getBillingModel(input.billingModelCode);
  const identityQuestion = isModelIdentityQuestion(input.prompt);
  const codingProjectRequest = isCodingProjectRequest(input.prompt);
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY to generate model responses.");
  }

  const history = await getConversationHistory(input.userId, input.conversationId);
  // Always keep the runtime OpenRouter selection aligned with the UI-selected billing model.
  const openrouterModel = selectedModel.openRouterModel || "openrouter/auto";

  const response = await fetchWithModelTimeout(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME || "PineApple",
      },
      body: JSON.stringify({
        store: process.env.OPENROUTER_STORE === "true",
        model: openrouterModel,
        // Always cap completion tokens. Without this OpenRouter applies the
        // model's max (>=65k for some models), which (a) often costs more than
        // a free-tier account can spend in one shot and (b) regularly times
        // out behind a 100s upstream proxy.
        max_tokens: codingProjectRequest ? 3000 : 1024,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(input, modelText),
          },
          ...history,
          {
            role: "user",
            content: input.prompt,
          },
        ],
      }),
    },
    codingProjectRequest ? 90_000 : 60_000,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logError("OpenRouter call failed", new Error(body || response.statusText), {
      status: response.status,
      openrouterModel,
      billingModelCode: selectedModel.code,
    });
    throw new Error(summarizeOpenRouterError(response.status, body, openrouterModel));
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  const rawContent = payload.choices?.[0]?.message?.content?.trim() || "The model returned an empty response.";
  const content = normalizeProjectArtifactContent(rawContent, codingProjectRequest);

  return {
    content: identityQuestion ? modelText : content,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
    model: payload.model ?? openrouterModel,
    fallbackNotice,
    totalTokens:
      payload.usage?.total_tokens ??
      (payload.usage?.prompt_tokens ?? 0) +
        (payload.usage?.completion_tokens ?? 0),
    selectedModelCode: selectedModel.code,
    selectedModelMultiplier: selectedModel.multiplier,
  };
}

export async function generateAgentResponse(input: GenerateInput): Promise<GenerateResult> {
  const selectedModel = getBillingModel(input.billingModelCode);
  const modelText = `${selectedModel.brand} ${selectedModel.name} (x${selectedModel.multiplier})`;
  const identityQuestion = isModelIdentityQuestion(input.prompt);
  const codingProjectRequest = isCodingProjectRequest(input.prompt);

  if (isSimpleGreeting(input.prompt)) {
    return {
      content: "Hello! How can I help you today?",
      selectedModelCode: selectedModel.code,
      selectedModelMultiplier: selectedModel.multiplier,
    };
  }

  if (identityQuestion) {
    return {
      content: modelText,
      selectedModelCode: selectedModel.code,
      selectedModelMultiplier: selectedModel.multiplier,
    };
  }

  if (!FORCE_OPENCODE_ONLY) {
    return generateOpenRouterResponse(input, modelText);
  }

  if (input.opencodeSessionId && process.env.OPENCODE_SERVER_URL) {
    async function callOpenCode(prompt: string, systemPrompt: string, timeoutMs?: number) {
      return promptOpenCodeSession(input.opencodeSessionId!, prompt, systemPrompt, timeoutMs);
    }

    try {
      const baseSystem = `${buildSystemPrompt(input, modelText)}\n\nYou are ${input.agentName}.`;
      let openCodeResult = await callOpenCode(
        input.prompt,
        baseSystem,
        codingProjectRequest ? 180_000 : 120_000,
      );

      if (!openCodeResult?.content?.trim()) {
        openCodeResult = await callOpenCode(
          input.prompt,
          `${baseSystem}\n\nReturn plain text response only. Do not emit empty parts.`,
          codingProjectRequest ? 180_000 : 120_000,
        );
      }

      if (codingProjectRequest && openCodeResult?.content && !openCodeResult.content.includes("```pineapple-project")) {
        const repairPrompt = [
          "Rewrite your previous answer as one strict pineapple-project artifact.",
          "Output exactly:",
          "1) one short intro sentence",
          "2) one fenced block tagged pineapple-project",
          "3) valid JSON only inside that block with: {\"name\",\"entry\",\"files\":[{\"path\",\"content\"}]}",
          "Do not include any other text.",
        ].join("\n");
        openCodeResult = await callOpenCode(repairPrompt, baseSystem, 150_000);
      }

      if (openCodeResult) {
        if (identityQuestion) {
          return {
            content: modelText,
            selectedModelCode: selectedModel.code,
            selectedModelMultiplier: selectedModel.multiplier,
          } as GenerateResult;
        }
        const normalizedContent = normalizeProjectArtifactContent(
          openCodeResult.content,
          codingProjectRequest,
        );
        return {
          ...openCodeResult,
          content: normalizedContent,
          selectedModelCode: selectedModel.code,
          selectedModelMultiplier: selectedModel.multiplier,
        };
      }

      throw new Error("OpenCode returned an empty result");
    } catch (error) {
      logError("OpenCode runtime error", error, {
        sessionId: input.opencodeSessionId,
        billingModelCode: input.billingModelCode,
      });

      throw error instanceof Error ? error : new Error("OpenCode request failed");
    }
  }

  if (FORCE_OPENCODE_ONLY) {
    if (!process.env.OPENCODE_SERVER_URL) {
      throw new Error("OpenCode is required but OPENCODE_SERVER_URL is not configured.");
    }

    if (!input.opencodeSessionId) {
      throw new Error("OpenCode is required but no session id is available for this conversation.");
    }

    throw new Error("OpenCode did not return a response for this request.");
  }

  throw new Error("OpenCode is required but no response was generated.");
}
