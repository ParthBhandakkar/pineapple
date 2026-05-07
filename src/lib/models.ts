export type BillingModel = {
  code: string;
  brand: string;
  name: string;
  /** OpenRouter model id passed to `model` in https://openrouter.ai/docs/api-reference/chat/send-chat-completion-request */
  openRouterModel: string;
  multiplier: number;
  output: string;
};

// PineApple multiplier tiers × OpenRouter `model` ids (must exist on OpenRouter).
const rawBillingModels: BillingModel[] = [
  // ——— 60x ———
  {
    code: "anthropic-claude-opus-4-7",
    brand: "Anthropic",
    name: "Claude 4.7 Opus",
    openRouterModel: "anthropic/claude-opus-4.7",
    multiplier: 60,
    output: "Latest frontier; unmatched architectural depth.",
  },
  {
    code: "anthropic-claude-opus-4-6",
    brand: "Anthropic",
    name: "Claude 4.6 Opus",
    openRouterModel: "anthropic/claude-opus-4.6",
    multiplier: 60,
    output: "Deep architectural engineering.",
  },
  {
    code: "openai-gpt-5-5-pro",
    brand: "OpenAI",
    name: "GPT-5.5 Pro",
    openRouterModel: "openai/gpt-5.5-pro",
    multiplier: 60,
    output: "Top-tier reasoning; heavy token consumer.",
  },

  // ——— 15x ———
  {
    code: "anthropic-claude-4-6-sonnet",
    brand: "Anthropic",
    name: "Claude 4.6 Sonnet",
    openRouterModel: "anthropic/claude-sonnet-4.6",
    multiplier: 15,
    output: "Sweet spot for OpenCode development.",
  },
  {
    code: "anthropic-claude-3-7-sonnet",
    brand: "Anthropic",
    name: "Claude 3.7 Sonnet",
    openRouterModel: "anthropic/claude-3.7-sonnet",
    multiplier: 15,
    output: "Legacy logic; extremely stable for agents.",
  },
  {
    code: "openai-gpt-5-4",
    brand: "OpenAI",
    name: "GPT-5.4",
    openRouterModel: "openai/gpt-5.4",
    multiplier: 15,
    output: "All-rounder for multi-step task planning.",
  },
  {
    code: "xai-grok-3-beta",
    brand: "xAI",
    name: "Grok 3 Beta",
    openRouterModel: "x-ai/grok-3-beta",
    multiplier: 15,
    output: "Real-time world info; competitive with Claude.",
  },

  // ——— 12x ———
  {
    code: "google-gemini-3-1-pro",
    brand: "Google",
    name: "Gemini 3.1 Pro",
    openRouterModel: "google/gemini-3.1-pro-preview",
    multiplier: 12,
    output: "2M-class context; entire codebase analysis.",
  },

  // ——— 10x ———
  {
    code: "google-gemini-2-5-pro",
    brand: "Google",
    name: "Gemini 2.5 Pro",
    openRouterModel: "google/gemini-2.5-pro",
    multiplier: 10,
    output: "High reasoning; better for debugging.",
  },
  {
    code: "openai-gpt-4-1",
    brand: "OpenAI",
    name: "GPT-4.1",
    openRouterModel: "openai/gpt-4.1",
    multiplier: 10,
    output: "Complex math and logic steps.",
  },
  {
    code: "openai-o3",
    brand: "OpenAI",
    name: "o3",
    openRouterModel: "openai/o3",
    multiplier: 10,
    output: "Advanced reasoning (OpenAI o-series).",
  },

  // ——— 5x ———
  {
    code: "anthropic-claude-haiku-4-5",
    brand: "Anthropic",
    name: "Claude 4.5 Haiku",
    openRouterModel: "anthropic/claude-haiku-4.5",
    multiplier: 5,
    output: "Fast automation; cheaper than Sonnet.",
  },

  // ——— 2x ———
  {
    code: "moonshot-kimi-k2-6",
    brand: "Moonshot",
    name: "Kimi K2.6",
    openRouterModel: "moonshotai/kimi-k2.6",
    multiplier: 2,
    output: "Coding-driven UI/UX specialist.",
  },
  {
    code: "deepseek-r1",
    brand: "DeepSeek",
    name: "R1",
    openRouterModel: "deepseek/deepseek-r1",
    multiplier: 2,
    output: "Reasoning specialist; complex tasks.",
  },
  {
    code: "zhipu-glm-4-7",
    brand: "Zhipu",
    name: "GLM-4.7",
    openRouterModel: "z-ai/glm-4.7",
    multiplier: 2,
    output: "Strong multilingual logic; local-market friendly.",
  },
  {
    code: "xai-grok-code-fast-1",
    brand: "xAI",
    name: "Grok Code Fast 1",
    openRouterModel: "x-ai/grok-code-fast-1",
    multiplier: 2,
    output: "Speed in IDEs and terminals.",
  },

  // ——— 1x (base) ———
  {
    code: "deepseek-v3-2",
    brand: "DeepSeek",
    name: "V3.2",
    openRouterModel: "deepseek/deepseek-v3.2",
    multiplier: 1,
    output: "Default OpenCode-class base; fast coding.",
  },
  {
    code: "deepseek-v4",
    brand: "DeepSeek",
    name: "V4 Pro",
    openRouterModel: "deepseek/deepseek-v4-pro",
    multiplier: 1,
    output: "Base-tier DeepSeek flagship.",
  },
  {
    code: "openai-gpt-5-mini",
    brand: "OpenAI",
    name: "GPT-5 Mini",
    openRouterModel: "openai/gpt-5-mini",
    multiplier: 1,
    output: "High-margin base; very fast.",
  },
  {
    code: "openai-gpt-4o-mini",
    brand: "OpenAI",
    name: "GPT-4o Mini",
    openRouterModel: "openai/gpt-4o-mini",
    multiplier: 1,
    output: "Compact OpenAI base.",
  },
  {
    code: "moonshot-kimi-k2",
    brand: "Moonshot",
    name: "Kimi K2",
    openRouterModel: "moonshotai/kimi-k2",
    multiplier: 1,
    output: "Long-horizon research tasks.",
  },
  {
    code: "qwen-3-6-plus",
    brand: "Qwen",
    name: "Qwen 3.6 Plus",
    openRouterModel: "qwen/qwen3.6-plus",
    multiplier: 1,
    output: "Latest Qwen Plus tier.",
  },
  {
    code: "qwen-3-5-coder",
    brand: "Qwen",
    name: "Qwen 3.5 Coder",
    openRouterModel: "qwen/qwen3-coder",
    multiplier: 1,
    output: "High-speed scripting / coding.",
  },
  {
    code: "zhipu-glm-4-7-flash",
    brand: "Zhipu",
    name: "GLM-4.7 Flash",
    openRouterModel: "z-ai/glm-4.7-flash",
    multiplier: 1,
    output: "High-frequency agent pings.",
  },
  {
    code: "minimax-m2-7",
    brand: "MiniMax",
    name: "M2.7",
    openRouterModel: "minimax/minimax-m2.7",
    multiplier: 1,
    output: "Top-tier UI generation logic.",
  },
  {
    code: "minimax-m2",
    brand: "MiniMax",
    name: "M2",
    openRouterModel: "minimax/minimax-m2",
    multiplier: 1,
    output: "Low-cost reliable agent alternative.",
  },
  {
    code: "google-gemini-3-1-flash",
    brand: "Google",
    name: "Gemini 3.1 Flash",
    openRouterModel: "google/gemini-3.1-flash-lite-preview",
    multiplier: 1,
    output: "Summaries and fast turns.",
  },
];

/** Older picker / DB codes → current `code` (same OpenRouter target where possible). */
const DEPRECATED_BILLING_MODEL_CODES: Record<string, string> = {
  "anthropic-claude-3-5-sonnet": "anthropic-claude-3-7-sonnet",
  "anthropic-claude-3": "anthropic-claude-opus-4-6",
  "anthropic-claude-4-6-opus": "anthropic-claude-opus-4-6",
  "openai-gpt-4o": "openai-gpt-5-4",
};

const EXCLUDED_BRAND_KEYWORDS = ["yi-lightning", "meta", "meta models"];

export const billingModels = rawBillingModels
  .filter((model) => {
    const haystack = `${model.code} ${model.brand} ${model.name} ${model.openRouterModel}`.toLowerCase();
    return !EXCLUDED_BRAND_KEYWORDS.some((keyword) => haystack.includes(keyword));
  })
  .sort(
    (a, b) =>
      b.multiplier - a.multiplier ||
      a.brand.localeCompare(b.brand) ||
      a.name.localeCompare(b.name),
  );

const DEFAULT_MODEL_CODE = process.env.DEFAULT_BILLING_MODEL ?? "deepseek-v3-2";

export const defaultBillingModelCode =
  billingModels.find((model) => model.code === DEFAULT_MODEL_CODE)?.code ??
  billingModels[0]?.code ??
  DEFAULT_MODEL_CODE;

export function getBillingModel(code?: string | null) {
  const normalized =
    code && DEPRECATED_BILLING_MODEL_CODES[code] ? DEPRECATED_BILLING_MODEL_CODES[code] : code ?? undefined;
  return billingModels.find((model) => model.code === normalized) ?? billingModels[0];
}

export function getAllowedMaxMultiplier(planCode: string | null | undefined) {
  const code = (planCode ?? "").toLowerCase();

  // Tier caps vs multiplier chart: 1 / 2 / 5 / 10 / 12 / 15 / 60
  if (code === "free") return 1;
  if (code === "starter" || code === "basic") return 5;
  if (code === "silver" || code === "professional") return 12;
  if (code === "pro") return 60;
  if (code === "business" || code === "enterprise") return 60;
  return 1;
}
