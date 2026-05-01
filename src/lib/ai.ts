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
  "You are an agent inside PineApple. Be concise, action-oriented, and do not claim that high-risk actions were executed unless an explicit approval flow has already completed. IMPORTANT: Do NOT include any hidden reasoning, 'thinking', or analysis. Do not call tools. Output only the final answer.";

const PROJECT_ARTIFACT_SYSTEM = [
  "When the user asks you to build, code, create, or generate a website, app, landing page, dashboard, ecommerce store, or similar project, return a complete preview-ready project artifact.",
  "Do not use tools, do not write files to the server filesystem, and do not describe a project without providing the files.",
  "Your answer must include one short intro sentence, then exactly one fenced block tagged pineapple-project.",
  "Inside that fenced block, output valid JSON only with this shape: {\"name\":\"Project name\",\"entry\":\"index.html\",\"files\":[{\"path\":\"index.html\",\"content\":\"...\"}]}",
  "Always return a real multi-file structure. Minimum files: index.html, styles.css, script.js. Add extra files/folders when useful for clarity.",
  "Do not collapse everything into one escaped string or one giant index.html unless the user explicitly asks for single-file output.",
  "Each file.content must be plain file text (normal newlines), not double-escaped JSON strings.",
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
  const fenced = normalized.match(/```(?:pineapple-project|json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return extractProjectArtifact(parseJsonObjectSlice(fenced[1]));
  }
  return extractProjectArtifact(parseJsonObjectSlice(normalized));
}

function hasUsableProjectArtifact(content: string, minFiles = 3) {
  const artifact = extractProjectArtifactFromText(content);
  return Boolean(
    artifact &&
      artifact.files.length >= minFiles &&
      artifact.files.every((file) => file.path.trim().length > 0 && file.content.trim().length > 0),
  );
}

function fallbackProjectArtifactContent(prompt: string) {
  const artifact = {
    name: "Generated Project",
    entry: "index.html",
    files: [
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Generated Project</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="container">
    <h1>Generated Project</h1>
    <p class="lead">Built from your request:</p>
    <pre class="prompt"></pre>
    <button id="actionBtn">Click me</button>
    <p id="status"></p>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
      },
      {
        path: "styles.css",
        content: `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
.container { max-width: 760px; margin: 40px auto; padding: 24px; }
.lead { margin: 0 0 12px; opacity: 0.85; }
.prompt { white-space: pre-wrap; padding: 12px; border-radius: 10px; background: rgba(120,120,120,0.12); }
button { margin-top: 16px; padding: 10px 14px; border-radius: 8px; border: 0; cursor: pointer; }`,
      },
      {
        path: "script.js",
        content: `const promptText = ${JSON.stringify(prompt)};
document.querySelector(".prompt").textContent = promptText;
const status = document.getElementById("status");
document.getElementById("actionBtn").addEventListener("click", () => {
  status.textContent = "Interaction works.";
});`,
      },
    ],
  };

  return [
    "I've created a complete project structure for you.",
    "",
    "```pineapple-project",
    JSON.stringify(artifact, null, 2),
    "```",
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

function isOpenCodeProviderFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const text = error.message.toLowerCase();
  return (
    text.includes("opencode upstream provider error") ||
    text.includes("no assistant text") ||
    text.includes("requires more credits") ||
    text.includes("guardrail restrictions")
  );
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
  let content = normalizeProjectArtifactContent(rawContent, codingProjectRequest);

  if (codingProjectRequest && !hasUsableProjectArtifact(content, 3)) {
    const repairResponse = await fetchWithModelTimeout(
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
          max_tokens: 2200,
          messages: [
            {
              role: "system",
              content: `${buildSystemPrompt(input, modelText)}\n\nReturn strict valid JSON artifact only.`,
            },
            {
              role: "user",
              content: [
                "Rewrite your previous output into exactly one valid pineapple-project artifact.",
                "Must include at least 3 files: index.html, styles.css, script.js.",
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
      75_000,
    );

    if (repairResponse.ok) {
      const repairPayload = (await repairResponse.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const repairedRaw = repairPayload.choices?.[0]?.message?.content?.trim();
      if (repairedRaw) {
        content = normalizeProjectArtifactContent(repairedRaw, true);
      }
    }
  }

  if (codingProjectRequest && !hasUsableProjectArtifact(content, 3)) {
    content = fallbackProjectArtifactContent(input.prompt);
  }

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
      let openCodeResult = await callOpenCode(
        input.prompt,
        baseSystem,
        codingProjectRequest ? 180_000 : 120_000,
        codingProjectRequest ? 3000 : 1024,
      );

      if (!openCodeResult?.content?.trim()) {
        openCodeResult = await callOpenCode(
          input.prompt,
          `${baseSystem}\n\nReturn plain text response only. Do not emit empty parts.`,
          codingProjectRequest ? 180_000 : 120_000,
          codingProjectRequest ? 2200 : 900,
        );
      }

      if (codingProjectRequest && openCodeResult?.content && !hasUsableProjectArtifact(openCodeResult.content, 3)) {
        const repairPrompt = [
          "Rewrite your previous answer as one strict pineapple-project artifact with valid JSON.",
          "Output exactly:",
          "1) one short intro sentence",
          "2) one fenced block tagged pineapple-project",
          "3) valid JSON only inside that block with: {\"name\",\"entry\",\"files\":[{\"path\",\"content\"}]}",
          "4) include at least 3 files: index.html, styles.css, script.js",
          "5) every file object MUST include both path and content keys; content must be plain text with normal newlines",
          "Do not include any other text.",
        ].join("\n");
        openCodeResult = await callOpenCode(repairPrompt, baseSystem, 150_000, 1800);
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
        const safeContent =
          codingProjectRequest && !hasUsableProjectArtifact(normalizedContent, 3)
            ? fallbackProjectArtifactContent(input.prompt)
            : normalizedContent;
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

      // Keep production chat available when OpenCode session execution fails due
      // upstream provider policy/credit/runtime issues. We preserve the exact
      // UI-selected model by routing the same request through OpenRouter.
      if (isOpenCodeProviderFailure(error) && process.env.OPENROUTER_API_KEY) {
        return generateOpenRouterResponse(
          input,
          modelText,
          "OpenCode execution failed for this request. Routed via direct OpenRouter as fallback.",
        );
      }

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
