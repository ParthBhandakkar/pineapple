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

export function classifyRisk(prompt: string): RiskClassification {
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
