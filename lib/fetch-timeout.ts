export class UpstreamTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    this.name = "UpstreamTimeoutError";
  }
}

/**
 * Abort an upstream request before the hosting gateway aborts the entire route.
 * Keeping the timeout here makes market-data, model and voice calls behave
 * consistently and prevents abandoned sockets from consuming the request budget.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number,
  label = "Upstream request"
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new UpstreamTimeoutError(label, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function timeoutFromEnv(
  name: string,
  fallbackMs: number,
  minimumMs: number,
  maximumMs: number
): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallbackMs;
  return Math.min(maximumMs, Math.max(minimumMs, Math.round(raw)));
}
