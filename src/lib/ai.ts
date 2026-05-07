import { prisma } from "@/lib/prisma";
import { fetchWithModelTimeout } from "@/lib/fetch-timeout";
import { promptOpenCodeSession } from "@/lib/opencode";
import { getBillingModel } from "@/lib/models";
import { logError } from "@/lib/error-logger";
import { estimateTaskCost } from "@/lib/tokens";

type GenerateInput = {
  userId: string;
  prompt: string;
  agentName: string;
  conversationId?: string;
  opencodeSessionId?: string | null;
  billingModelCode?: string | null;
  images?: string[];
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

const OPENROUTER_MAX_ATTEMPTS = Number(process.env.OPENROUTER_MAX_ATTEMPTS) || 8;

const OPENROUTER_API_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL ?? "openrouter/auto";

const MAX_CONVERSATION_HISTORY = 20;
const CODING_TIMEOUT_MS = 270_000;
const NON_CODING_TIMEOUT_MS = 240_000;
const CODING_MAX_TOKENS = 3000;
const NON_CODING_MAX_TOKENS = 1024;
const REPAIR_MAX_TOKENS = 2200;
const REPAIR_TIMEOUT_MS = 200_000;
const BACKOFF_BASE_MS = 1600;
const BACKOFF_MAX_MS = 24_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Only these should surface as a FAILED task when OPENROUTER_API_KEY is set. */
function isOpenRouterCreditExhaustedMessage(message: string) {
  const t = message.toLowerCase();
  return (
    t.includes("(402)") ||
    t.includes("requires more credits") ||
    t.includes("insufficient token") ||
    (t.includes("insufficient") && t.includes("credit")) ||
    t.includes("you need to purchase") ||
    (t.includes("quota") && t.includes("exceeded") && t.includes("bill"))
  );
}

function isOpenRouterAuthConfigMessage(message: string) {
  const t = message.toLowerCase();
  return (
    t.includes("(401)") ||
    t.includes("(403)") ||
    t.includes("check openrouter_api_key") ||
    t.includes("invalid api key")
  );
}

function guaranteedOpenRouterResult(
  input: GenerateInput,
  modelText: string,
  fallbackNotice: string | undefined,
  lastError: Error | null,
): GenerateResult {
  const selectedModel = getBillingModel(input.billingModelCode);
  const coding = isCodingProjectRequest(input.prompt);
  const est = estimateTaskCost(input.prompt);
  const notice = [
    fallbackNotice,
    lastError
      ? `Model connectivity failed after retries (${lastError.message.slice(0, 200)}). Delivering a fallback response.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (coding) {
    const content = fallbackProjectArtifactContent(input.prompt);
    return {
      content: notice ? `${notice}\n\n${content}` : content,
      model: "fallback-local",
      totalTokens: est,
      selectedModelCode: selectedModel.code,
      selectedModelMultiplier: selectedModel.multiplier,
      fallbackNotice: notice || undefined,
    };
  }

  const msg = [
    "I could not reach the AI provider after several attempts.",
    lastError ? `Detail: ${lastError.message.slice(0, 280)}` : "",
    "Please try again in a few minutes.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: notice ? `${notice}\n\n${msg}` : msg,
    model: "fallback-local",
    totalTokens: est,
    selectedModelCode: selectedModel.code,
    selectedModelMultiplier: selectedModel.multiplier,
    fallbackNotice: notice || undefined,
  };
}

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

/** Option A: verb-only check — controls longer timeouts, higher max_tokens, and repair passes. */
function isCodingProjectRequest(prompt: string) {
  const p = prompt.toLowerCase();
  return /\b(create|build|make|generate|code|develop|design|implement|write|craft|set\s*up|scaffold|put\s+together|give\s+me|i\s+want|i\s+need)\b/.test(p);
}

const BASE_AGENT_SYSTEM =
  "You are an agent inside PineApple. Be concise, action-oriented, and do not claim that high-risk actions were executed unless an explicit approval flow has already completed. IMPORTANT: Do NOT include any hidden reasoning, 'thinking', or analysis. Do not call tools. Output only the final answer.";

/**
 * Option B: artifact instructions are always present so the model decides
 * when to produce files vs. answer conversationally.
 */
const PROJECT_ARTIFACT_SYSTEM = [
  "When the user asks you to build, code, create, generate, design, or produce ANY kind of software, website, app, tool, game, chatbot, clone, widget, component, or similar — return a complete project artifact.",
  "If the user's request is clearly NOT asking for code or a buildable project (e.g. a factual question, explanation, debugging help, or general conversation), respond with normal text instead.",
  "Do not use tools, do not write files to the server filesystem, and do not describe a project without providing the files.",
  "CRITICAL FORMAT: Your response must be ONLY one short intro sentence (max 1-2 lines), followed IMMEDIATELY by the pineapple-project fenced block. Do NOT include directory trees, setup instructions, feature lists, or any other markdown content before or after the artifact block. All documentation should be inside a README.md file within the artifact.",
  "The fenced block must be tagged exactly as: ```pineapple-project",
  "Inside that fenced block, output valid JSON only with this shape: {\"name\":\"Descriptive project name\",\"entry\":\"<main entry file>\",\"files\":[{\"path\":\"<filepath>\",\"content\":\"...\"}]}",
  "IMPORTANT: Use the language and technology the user asked for. If they say Python, use .py files with entry like app.py or main.py. If they say JavaScript/Node, use .js files. If they say HTML/web, use index.html + styles.css + script.js. Match the user's requested language — do NOT default to HTML/CSS/JS unless the request is for a web page.",
  "The number of files and their types are entirely up to you based on what the project needs. Use as many or as few files as makes sense for the project. Do not artificially pad or restrict file count.",
  "Each file.content must be plain file text (normal newlines), not double-escaped JSON strings.",
  "Keep the artifact compact: no unnecessary placeholder content and no framework setup unless the user asked for it.",
  "Satisfy the user's exact product/domain request with working, functional code — not stubs or placeholders.",
  "For web projects, the preview opens the entry file directly, so all CSS and JS must be referenced by relative paths that exist in files.",
  "Include a README.md file with setup instructions, features list, and project structure documentation inside the artifact.",
].join(" ");

function buildSystemPrompt(input: GenerateInput, modelText: string) {
  const parts = [
    BASE_AGENT_SYSTEM,
    `Current UI-selected model: ${modelText}.`,
    `If the user asks "which model are you" / "what model are you" / "what model are you using" or similar, respond with ONLY this exact text: "${modelText}". No additional words. No explanations.`,
    `IMPORTANT: You do NOT have internet/web access. You cannot browse URLs, search the web, fetch live data, or access external APIs. If the user asks you to search the web, visit a URL, or get real-time information, politely inform them that web access is not available yet and offer to help with what you can do offline.`,
    PROJECT_ARTIFACT_SYSTEM,
  ];

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

function normalizeArtifactFileContent(value: string) {
  let normalized = decodeEscapedContent(value);

  // Some model responses return file bodies as escaped text blobs.
  if (!normalized.includes("\n") && /\\n/.test(normalized)) {
    normalized = normalized.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  if (normalized.includes("\\\"") && /<html|<!doctype html|<body|<head/i.test(normalized)) {
    normalized = normalized.replace(/\\"/g, "\"");
  }

  return normalized;
}

function normalizeArtifactFiles(artifact: { name: string; entry?: string; files: Array<{ path: string; content: string }> }) {
  return {
    ...artifact,
    files: artifact.files.map((file) => ({
      path: file.path.replace(/^\/+/, ""),
      content: normalizeArtifactFileContent(file.content),
    })),
  };
}

function extractProjectArtifact(value: unknown): { name: string; entry?: string; files: Array<{ path: string; content: string }> } | null {
  if (isValidProjectArtifact(value)) {
    return normalizeArtifactFiles(value);
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

function extractProjectArtifactFromText(content: string) {
  const normalized = decodeEscapedContent(content);
  const fenced = normalized.match(/```(?:pineapple-project|json)?[\s\S]*?(\{[\s\S]*\})[\s\S]*?```/);
  if (fenced) {
    return extractProjectArtifact(parseJsonObjectSlice(fenced[1]));
  }
  const simpleFenced = normalized.match(/```(?:pineapple-project|json)?\s*([\s\S]*?)```/);
  if (simpleFenced) {
    const inner = simpleFenced[1].replace(/^\s*pineapple-project\s*/i, "");
    return extractProjectArtifact(parseJsonObjectSlice(inner));
  }
  return extractProjectArtifact(parseJsonObjectSlice(normalized));
}

function hasUsableProjectArtifact(content: string, minFiles = 1) {
  const artifact = extractProjectArtifactFromText(content);
  return Boolean(
    artifact &&
      artifact.files.length >= minFiles &&
      artifact.files.every((file) => file.path.trim().length > 0 && file.content.trim().length > 0),
  );
}

function fallbackProjectArtifactContent(prompt: string) {
  return [
    "The AI model could not be reached after several attempts, so I was unable to generate the project you requested.",
    "",
    `**Your request:** ${prompt.slice(0, 300)}`,
    "",
    "Please try again — the model may be temporarily overloaded. Your request will be fulfilled on the next successful attempt.",
  ].join("\n");
}

function normalizeProjectArtifactContent(content: string, enabled: boolean) {
  if (!enabled) {
    return content;
  }

  const normalized = decodeEscapedContent(content);
  const artifact = extractProjectArtifactFromText(normalized);

  if (!artifact) {
    return content;
  }

  const fenced = normalized.match(/```(?:pineapple-project|json)?\s*([\s\S]*?)```/);
  const intro = (
    fenced ? normalized.replace(fenced[0], "").trim() : normalized.slice(0, normalized.indexOf("{")).trim()
  ) || "I've created a complete project structure for you.";

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
    take: MAX_CONVERSATION_HISTORY,
  });

  return messages.map((message) => ({
    role: message.role === "USER" ? "user" : message.role === "ASSISTANT" ? "assistant" : "system",
    content: message.content,
  }));
}

function extractLastArtifactContext(history: Array<{ role: string; content: string }>): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const match = msg.content.match(/```pineapple-project\s*([\s\S]*?)```/);
    if (match) {
      try {
        const artifact = JSON.parse(match[1]);
        if (artifact?.files?.length) {
          const filesSummary = artifact.files
            .map((f: { path: string; content: string }) => `--- ${f.path} ---\n${f.content}`)
            .join("\n\n");
          return `[EXISTING PROJECT CONTEXT]\nThe user previously generated this project. When they ask for changes, modifications, edits, fixes, or improvements:\n1. MODIFY the existing files — do not regenerate everything from scratch.\n2. Keep all existing logic/code intact unless the user specifically asks to change it.\n3. Only change the specific parts the user asks about.\n4. If they ask for a UI change, only modify UI code. If they ask for a logic change, only modify the logic.\n5. Return the full updated project artifact with ALL files (unchanged files should keep their original content).\n\nProject: ${artifact.name}\nFiles:\n${filesSummary}`;
        }
      } catch { /* ignore parse errors */ }
    }
  }
  return null;
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
  if (status === 402) {
    return `Model provider requires more credits or payment (${status}).${detail ? ` ${detail}` : ""}`;
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

  return `Model provider failed (${status}).${detail ? ` ${detail}` : ""}${trimmed.includes("image_parse_error") || trimmed.includes("Could not process image") ? " [image_error]" : ""}`;
}

async function openRouterSingleAttempt(
  input: GenerateInput,
  modelText: string,
  fallbackNotice: string | undefined,
  attemptIndex: number,
): Promise<GenerateResult> {
  const selectedModel = getBillingModel(input.billingModelCode);
  const identityQuestion = isModelIdentityQuestion(input.prompt);
  const codingProjectRequest = isCodingProjectRequest(input.prompt);
  const apiKey = process.env.OPENROUTER_API_KEY!;

  const useAutoModel = attemptIndex >= OPENROUTER_MAX_ATTEMPTS - 2;
  const hasInputImages = input.images && input.images.length > 0;
  const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL ?? "openai/gpt-4o";
  // When images are present, always use a proven vision-capable model to avoid provider routing issues
  const openrouterModel = hasInputImages
    ? VISION_MODEL
    : useAutoModel
      ? OPENROUTER_FALLBACK_MODEL
      : selectedModel.openRouterModel || OPENROUTER_FALLBACK_MODEL;

  const history = await getConversationHistory(input.userId, input.conversationId);
  const artifactContext = extractLastArtifactContext(history);
  const mainTimeoutMs = codingProjectRequest ? CODING_TIMEOUT_MS : NON_CODING_TIMEOUT_MS;
  const systemPrompt = artifactContext
    ? `${buildSystemPrompt(input, modelText)}\n\n${artifactContext}`
    : buildSystemPrompt(input, modelText);

  // Build user message: multimodal if images are attached, plain text otherwise
  if (hasInputImages) {
    console.log(`[ai] Sending ${input.images!.length} image(s) to OpenRouter model ${openrouterModel}`);
  }
  const userMessage: { role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> } =
    hasInputImages
      ? {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            ...input.images!.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ],
        }
      : { role: "user", content: input.prompt };

  const response = await fetchWithModelTimeout(
    OPENROUTER_API_URL,
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
        max_tokens: codingProjectRequest ? CODING_MAX_TOKENS : NON_CODING_MAX_TOKENS,
        ...(hasInputImages ? { provider: { order: ["openai"], allow_fallbacks: true } } : {}),
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...history,
          userMessage,
        ],
      }),
    },
    mainTimeoutMs,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logError("OpenRouter call failed", new Error(body || response.statusText), {
      status: response.status,
      openrouterModel,
      billingModelCode: selectedModel.code,
      attemptIndex,
    });
    throw new Error(summarizeOpenRouterError(response.status, body, openrouterModel));
  }

  let payload: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error("OpenRouter returned invalid JSON response");
  }

  const rawContent = payload.choices?.[0]?.message?.content?.trim() || "The model returned an empty response.";
  let content = normalizeProjectArtifactContent(rawContent, codingProjectRequest);

  if (codingProjectRequest && !hasUsableProjectArtifact(content, 1)) {
    const repairResponse = await fetchWithModelTimeout(
      OPENROUTER_API_URL,
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
          max_tokens: REPAIR_MAX_TOKENS,
          messages: [
            {
              role: "system",
              content: `${buildSystemPrompt(input, modelText)}\n\nReturn strict valid JSON artifact only.`,
            },
            {
              role: "user",
              content: [
                "Rewrite your previous output into exactly one valid pineapple-project artifact.",
                "Use file types appropriate for the language/framework the user requested. Do not force HTML/CSS/JS unless that is what the user asked for.",
                "Every file must be an object with path and content keys.",
                "Keep content plain text with normal newlines (not escaped JSON strings).",
                "Output one intro sentence, then one ```pineapple-project fenced block with valid JSON.",
                "",
                "Previous output:",
                rawContent,
              ].join("\n"),
            },
          ],
        }),
      },
      REPAIR_TIMEOUT_MS,
    );

    if (repairResponse.ok) {
      try {
        const repairPayload = (await repairResponse.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const repairedRaw = repairPayload.choices?.[0]?.message?.content?.trim();
        if (repairedRaw) {
          content = normalizeProjectArtifactContent(repairedRaw, true);
        }
      } catch {
        /* keep content from main call */
      }
    }
  }

  if (codingProjectRequest && !hasUsableProjectArtifact(content, 1)) {
    /* Model responded but didn't produce a valid artifact — keep the raw response
       so the user can still see the code/text the model generated. */
  }

  return {
    content: identityQuestion ? modelText : content,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
    model: payload.model ?? openrouterModel,
    fallbackNotice,
    totalTokens:
      payload.usage?.total_tokens ??
      (payload.usage?.prompt_tokens ?? 0) + (payload.usage?.completion_tokens ?? 0),
    selectedModelCode: selectedModel.code,
    selectedModelMultiplier: selectedModel.multiplier,
  };
}

async function generateOpenRouterResponse(
  input: GenerateInput,
  modelText: string,
  fallbackNotice?: string,
): Promise<GenerateResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter is not configured. Set OPENROUTER_API_KEY to generate model responses.");
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < OPENROUTER_MAX_ATTEMPTS; attempt++) {
    try {
      return await openRouterSingleAttempt(input, modelText, fallbackNotice, attempt);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (isOpenRouterCreditExhaustedMessage(lastErr.message)) {
        throw lastErr;
      }
      if (isOpenRouterAuthConfigMessage(lastErr.message)) {
        throw lastErr;
      }
      // Image processing errors are permanent — retrying won't help
      if (lastErr.message.includes("[image_error]")) {
        throw lastErr;
      }
      logError("OpenRouter attempt failed", lastErr, { attempt, attempts: OPENROUTER_MAX_ATTEMPTS });
      if (attempt < OPENROUTER_MAX_ATTEMPTS - 1) {
        await sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt));
      }
    }
  }

  return guaranteedOpenRouterResult(input, modelText, fallbackNotice, lastErr);
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

  const hasImages = input.images && input.images.length > 0;

  // Images require multimodal — OpenCode is text-only, go directly to OpenRouter
  if (!FORCE_OPENCODE_ONLY || hasImages) {
    return generateOpenRouterResponse(input, modelText);
  }

  if (input.opencodeSessionId && process.env.OPENCODE_SERVER_URL) {
    const openCodeModel = {
      providerID: "openrouter",
      modelID: selectedModel.openRouterModel,
    };

    async function callOpenCode(
      prompt: string,
      systemPrompt: string,
      timeoutMs?: number,
      maxTokens?: number,
    ) {
      return promptOpenCodeSession(
        input.opencodeSessionId!,
        prompt,
        systemPrompt,
        timeoutMs,
        maxTokens,
        openCodeModel,
      );
    }

    try {
      const baseSystem = `${buildSystemPrompt(input, modelText)}\n\nYou are ${input.agentName}.`;
      const history = await getConversationHistory(input.userId, input.conversationId);
      const artifactCtx = extractLastArtifactContext(history);
      const fullSystem = artifactCtx ? `${baseSystem}\n\n${artifactCtx}` : baseSystem;

      const historyContext = history.length > 0
        ? history.map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 3000)}`).slice(-10).join("\n\n")
        : "";
      const enrichedPrompt = historyContext
        ? `[Previous conversation context for continuity]\n${historyContext}\n\n[Current user message]\n${input.prompt}`
        : input.prompt;

      let openCodeResult = await callOpenCode(
        enrichedPrompt,
        fullSystem,
        codingProjectRequest ? 300_000 : 280_000,
        codingProjectRequest ? 3000 : 1024,
      );

      if (!openCodeResult?.content?.trim()) {
        openCodeResult = await callOpenCode(
          enrichedPrompt,
          `${fullSystem}\n\nReturn plain text response only. Do not emit empty parts.`,
          codingProjectRequest ? 300_000 : 280_000,
          codingProjectRequest ? 2200 : 900,
        );
      }

      if (codingProjectRequest && openCodeResult?.content && !hasUsableProjectArtifact(openCodeResult.content, 1)) {
        const repairPrompt = [
          "Rewrite your previous answer as one strict pineapple-project artifact with valid JSON.",
          "Output exactly:",
          "1) one short intro sentence",
          "2) one fenced block tagged pineapple-project",
          "3) valid JSON only inside that block with: {\"name\",\"entry\",\"files\":[{\"path\",\"content\"}]}",
          "4) use file types and count appropriate for the project — do not force HTML/CSS/JS if the user asked for another language",
          "5) every file object MUST include both path and content keys; content must be plain text with normal newlines",
          "Do not include any other text.",
        ].join("\n");
        openCodeResult = await callOpenCode(repairPrompt, fullSystem, 280_000, 1800);
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
        const safeContent = normalizedContent;
        return {
          ...openCodeResult,
          content: safeContent,
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

      if (process.env.OPENROUTER_API_KEY) {
        return generateOpenRouterResponse(
          input,
          modelText,
          "OpenCode could not complete this request. Answered via OpenRouter instead.",
        );
      }

      throw error instanceof Error ? error : new Error("OpenCode request failed");
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    return generateOpenRouterResponse(
      input,
      modelText,
      "OpenCode was not available for this request. Answered via OpenRouter instead.",
    );
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
