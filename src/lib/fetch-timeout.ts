/** Default for OpenRouter + OpenCode chat-style calls (ms). */
const DEFAULT_MODEL_MS = 120_000;

function timeoutMs(override?: number) {
  const fromEnv = Number(process.env.MODEL_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return override ?? DEFAULT_MODEL_MS;
}

/**
 * fetch with AbortSignal.timeout so hung upstreams (LLM) cannot block forever.
 * Pass `init.signal` to combine with a caller's abort, if provided.
 */
export async function fetchWithModelTimeout(
  input: string | URL,
  init: RequestInit = {},
  overrideMs?: number,
): Promise<Response> {
  const ms = timeoutMs(overrideMs);
  const timeSignal = AbortSignal.timeout(ms);
  const signal =
    init.signal != null
      ? AbortSignal.any([init.signal, timeSignal] as [AbortSignal, ...AbortSignal[]])
      : timeSignal;
  return fetch(input, { ...init, signal });
}
