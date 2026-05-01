export type BillingModel = {
  code: string;
  brand: string;
  name: string;
  openRouterModel: string;
  multiplier: number;
  output: string;
};

// Source of truth for the in-app model picker.
// Every entry MUST map to a model id that exists today on OpenRouter so the
// runtime can route requests to the selected model without a 404 or fallback.
//
// Spec doc: docs/Tokens Pricing Architecture.pdf — pricing tiers map to the
// `multiplier` column. UI labels are the human-readable model names from the
// spec (with `/`-separated names split into individual entries).
const rawBillingModels: BillingModel[] = [
  // 1x — Base Logic (Coding/General)
  {
    code: "deepseek-v3-2",
    brand: "DeepSeek",
    name: "V3.2",
    openRouterModel: "deepseek/deepseek-v3.2",
    multiplier: 1,
    output: "Base Logic (Coding/General)",
  },
  {
    code: "deepseek-v4",
    brand: "DeepSeek",
    name: "V4",
    openRouterModel: "deepseek/deepseek-v4-pro",
    multiplier: 1,
    output: "Base Logic (Coding/General)",
  },
  {
    code: "deepseek-r1",
    brand: "DeepSeek",
    name: "R1",
    openRouterModel: "deepseek/deepseek-r1",
    multiplier: 1,
    output: "Base Logic (Coding/General)",
  },

  // 1x — Base Logic (Fast Tasks)
  {
    code: "openai-gpt-5-mini",
    brand: "OpenAI",
    name: "GPT-5 Mini",
    openRouterModel: "openai/gpt-5-mini",
    multiplier: 1,
    output: "Base Logic (Fast Tasks)",
  },
  {
    code: "openai-gpt-4o-mini",
    brand: "OpenAI",
    name: "GPT-4o Mini",
    openRouterModel: "openai/gpt-4o-mini",
    multiplier: 1,
    output: "Base Logic (Fast Tasks)",
  },

  // 3x — Fast Reasoning / Data Parsing
  {
    code: "google-gemini-3-1-flash",
    brand: "Google",
    name: "Gemini 3.1 Flash",
    openRouterModel: "google/gemini-3.1-flash-lite-preview",
    multiplier: 3,
    output: "Fast Reasoning / Data Parsing",
  },

  // 12x — Long Context / Repository Analysis
  {
    code: "google-gemini-3-1-pro",
    brand: "Google",
    name: "Gemini 3.1 Pro",
    openRouterModel: "google/gemini-3.1-pro-preview",
    multiplier: 12,
    output: "Long Context / Repository Analysis",
  },

  // 15x — Advanced Coding (OpenCode)
  {
    code: "anthropic-claude-3-5-sonnet",
    brand: "Anthropic",
    name: "Claude 3.5 Sonnet",
    // OpenRouter no longer exposes claude-3.5-sonnet directly; 3.7 sonnet is the
    // closest production model in the same coding-tuned family.
    openRouterModel: "anthropic/claude-3.7-sonnet",
    multiplier: 15,
    output: "Advanced Coding (OpenCode)",
  },
  {
    code: "anthropic-claude-4-6-sonnet",
    brand: "Anthropic",
    name: "Claude 4.6 Sonnet",
    openRouterModel: "anthropic/claude-sonnet-4.6",
    multiplier: 15,
    output: "Advanced Coding (OpenCode)",
  },

  // 15x — Advanced Logic / Complex Tasks
  {
    code: "openai-gpt-5-4",
    brand: "OpenAI",
    name: "GPT-5.4",
    openRouterModel: "openai/gpt-5.4",
    multiplier: 15,
    output: "Advanced Logic / Complex Tasks",
  },
  {
    code: "openai-gpt-4o",
    brand: "OpenAI",
    name: "GPT-4o",
    openRouterModel: "openai/gpt-4o",
    multiplier: 15,
    output: "Advanced Logic / Complex Tasks",
  },

  // 60x — Deep Architectural Engineering
  {
    code: "anthropic-claude-3",
    brand: "Anthropic",
    name: "Claude 3 Opus",
    openRouterModel: "anthropic/claude-opus-4",
    multiplier: 60,
    output: "Deep Architectural Engineering",
  },
  {
    code: "anthropic-claude-4-6-opus",
    brand: "Anthropic",
    name: "Claude 4.6 Opus",
    openRouterModel: "anthropic/claude-opus-4.6",
    multiplier: 60,
    output: "Deep Architectural Engineering",
  },
];

const EXCLUDED_BRAND_KEYWORDS = ["yi-lightning", "meta", "meta models"];

// Defensive filter: never expose excluded brands even if a future edit forgets.
export const billingModels = rawBillingModels.filter((model) => {
  const haystack = `${model.code} ${model.brand} ${model.name} ${model.openRouterModel}`.toLowerCase();
  return !EXCLUDED_BRAND_KEYWORDS.some((keyword) => haystack.includes(keyword));
});

export const defaultBillingModelCode =
  billingModels.find((model) => model.code === "deepseek-v3-2")?.code ??
  billingModels[0]?.code ??
  "deepseek-v3-2";

export function getBillingModel(code?: string | null) {
  return billingModels.find((model) => model.code === code) ?? billingModels[0];
}

export function getAllowedMaxMultiplier(planCode: string | null | undefined) {
  const code = (planCode ?? "").toLowerCase();

  // Tier-based access control for multiplier-heavy models.
  // Mapping rationale (spec):
  //   1x  base models (DeepSeek, GPT-5 Mini, GPT-4o Mini)
  //   3x  fast reasoning (Gemini Flash)
  //   12x long-context (Gemini Pro)
  //   15x advanced coding/logic (Sonnet, GPT-4o, GPT-5.4)
  //   60x deep architectural (Opus)
  if (code === "free") return 1;
  if (code === "starter" || code === "basic") return 3;
  if (code === "silver" || code === "professional") return 12;
  if (code === "pro") return 60;
  if (code === "business" || code === "enterprise") return 60;
  return 1;
}
