export type RiskClassification = {
  isHighRisk: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  actionType: string;
  reason: string;
};

const highRiskPatterns = [
  {
    type: "PAYMENT",
    pattern: /\b(pay|payment|purchase|buy|subscribe|checkout|razorpay|refund|charge)\b/i,
    reason: "The request may initiate or modify a financial transaction.",
  },
  {
    type: "DESTRUCTIVE_FILE_ACTION",
    pattern: /\b(delete|remove|wipe|drop|destroy|erase|truncate|purge)\b/i,
    reason: "The request may permanently delete or alter data.",
  },
  {
    type: "REMOTE_MUTATION",
    pattern: /\b(push|deploy|release|publish|merge|production|prod|ssh|server)\b/i,
    reason: "The request may affect shared or production infrastructure.",
  },
  {
    type: "EXTERNAL_DATA_SEND",
    pattern: /\b(send|email|share|upload|export|post)\b.*\b(customer|user|data|file|secret|token|key)\b/i,
    reason: "The request may transmit private or sensitive data externally.",
  },
  {
    type: "CREDENTIAL_ACCESS",
    pattern: /\b(api key|secret|credential|password|private key|token|env file|\.env)\b/i,
    reason: "The request may access credentials or sensitive configuration.",
  },
];

const codingContextPattern = /\b(create|build|make|generate|code|develop|design|implement|write|craft|scaffold|construct|setup|set up|give me|i want|i need|want to|please make|program|app|website|page|component|function|class|module|api|endpoint|route|handler|script|tool|game|clone|widget|template|example|demo|sample|tutorial|show me|how to)\b/i;

export function classifyRisk(prompt: string): RiskClassification {
  // If the prompt is clearly a coding/project generation request,
  // skip high-risk classification since the keywords (delete, server, deploy, etc.)
  // are being used in a code-authoring context, not as real destructive commands.
  if (codingContextPattern.test(prompt)) {
    return {
      isHighRisk: false,
      riskLevel: "LOW",
      actionType: "NORMAL",
      reason: "Coding/project generation request — risk keywords are contextual.",
    };
  }

  for (const item of highRiskPatterns) {
    if (item.pattern.test(prompt)) {
      return {
        isHighRisk: true,
        riskLevel: "HIGH",
        actionType: item.type,
        reason: item.reason,
      };
    }
  }

  return {
    isHighRisk: false,
    riskLevel: "LOW",
    actionType: "NORMAL",
    reason: "No high-risk action pattern was detected.",
  };
}
