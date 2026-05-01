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
    error?: {
      name?: string;
      data?: {
        message?: string;
        statusCode?: number;
        responseBody?: string;
      };
    };
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
  maxTokens?: number,
  model?: { providerID: string; modelID: string },
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
        max_tokens: maxTokens,
        model,
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

  const providerErrorMessage = payload.info?.error?.data?.message?.trim();
  if (providerErrorMessage) {
    const providerErrorCode = payload.info?.error?.data?.statusCode;
    throw new Error(
      `OpenCode upstream provider error${providerErrorCode ? ` (${providerErrorCode})` : ""}: ${providerErrorMessage}`,
    );
  }

  const content =
    extractOpenCodeText(payload.parts) ||
    extractOpenCodeText(payload.message?.parts) ||
    (typeof payload.message?.content === "string" ? payload.message.content.trim() : "") ||
    (typeof payload.content === "string" ? payload.content.trim() : "") ||
    (typeof payload.text === "string" ? payload.text.trim() : "") ||
    (typeof payload.summary === "string" ? payload.summary.trim() : "");

  // OpenCode can sometimes surface upstream provider failures as plain text.
  // Do not treat those as valid assistant output.
  if (/APIError|\"error\"\s*:\s*\{\s*\"message\"/i.test(content)) {
    throw new Error(`OpenCode upstream error: ${content.slice(0, 500)}`);
  }

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
