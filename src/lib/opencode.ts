import { fetchWithModelTimeout } from "@/lib/fetch-timeout";

type OpenCodeSession = {
  id: string;
  title?: string;
};

type OpenCodeMessagePart =
  | { type?: string; text?: string; content?: string; summary?: string }
  | Record<string, unknown>;

type OpenCodeMessageResponse = {
  info?: {
    modelID?: string;
    providerID?: string;
  };
  parts?: OpenCodeMessagePart[];
  message?: {
    parts?: OpenCodeMessagePart[];
    content?: string;
  };
  content?: string;
  text?: string;
  summary?: string;
};

const OPENCODE_SHORT_TIMEOUT_MS = 30_000;

function getOpenCodeBaseUrl() {
  const baseUrl = process.env.OPENCODE_SERVER_URL;
  return baseUrl ? baseUrl.replace(/\/$/, "") : null;
}

function getOpenCodeHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (process.env.OPENCODE_SERVER_PASSWORD) {
    const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
    headers.Authorization = `Basic ${Buffer.from(`${username}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
  }

  return headers;
}

function extractOpenCodeText(parts: OpenCodeMessagePart[] | undefined) {
  if (!parts?.length) {
    return "";
  }

  return parts
    .map((part) => {
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }

      if (typeof part.content === "string" && part.content.trim()) {
        return part.content.trim();
      }

      if (typeof part.summary === "string" && part.summary.trim()) {
        return part.summary.trim();
      }

      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractTextDeep(value: unknown, depth = 0): string {
  if (value == null || depth > 4) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextDeep(item, depth + 1))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (typeof value !== "object") return "";

  const obj = value as Record<string, unknown>;
  const directKeys = ["text", "content", "summary", "output_text", "result"];
  const direct = directKeys
    .map((key) => (typeof obj[key] === "string" ? String(obj[key]).trim() : ""))
    .filter(Boolean)
    .join("\n\n");
  if (direct) return direct;

  return Object.values(obj)
    .map((item) => extractTextDeep(item, depth + 1))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export async function getOpenCodeHealth() {
  const baseUrl = getOpenCodeBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const response = await fetchWithModelTimeout(
    `${baseUrl}/global/health`,
    {
      method: "GET",
      headers: getOpenCodeHeaders(),
      cache: "no-store",
    },
    OPENCODE_SHORT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`OpenCode health failed: ${response.status}`);
  }

  return (await response.json()) as { healthy: boolean; version: string };
}

export async function createOpenCodeSession(title?: string) {
  const baseUrl = getOpenCodeBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const response = await fetchWithModelTimeout(
    `${baseUrl}/session`,
    {
      method: "POST",
      headers: getOpenCodeHeaders(),
      body: JSON.stringify(title ? { title } : {}),
    },
    OPENCODE_SHORT_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenCode session creation failed: ${response.status} ${body}`);
  }

  return (await response.json()) as OpenCodeSession;
}

export async function promptOpenCodeSession(
  sessionId: string,
  prompt: string,
  system?: string,
  timeoutOverrideMs?: number,
) {
  const baseUrl = getOpenCodeBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const response = await fetchWithModelTimeout(
    `${baseUrl}/session/${sessionId}/message`,
    {
      method: "POST",
      headers: getOpenCodeHeaders(),
      body: JSON.stringify({
        system,
        parts: [{ type: "text", text: prompt }],
      }),
    },
    timeoutOverrideMs,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenCode prompt failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as OpenCodeMessageResponse;

  const content =
    extractOpenCodeText(payload.parts) ||
    extractOpenCodeText(payload.message?.parts) ||
    extractTextDeep(payload);

  if (!content) {
    throw new Error("OpenCode returned no assistant text");
  }

  return {
    content,
    model: payload.info?.modelID
      ? `${payload.info?.providerID ?? "opencode"}/${payload.info.modelID}`
      : "opencode-server",
  };
}
