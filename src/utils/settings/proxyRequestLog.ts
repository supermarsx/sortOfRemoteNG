export const DEFAULT_PROXY_REQUEST_LOG_LIMIT = 10_000;
export const MAX_PROXY_REQUEST_LOG_LIMIT = 100_000;

export function validateProxyRequestLogLimit(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_PROXY_REQUEST_LOG_LIMIT
  )
    throw new Error(
      "Proxy request log limit must be an integer from 0 to 100000.",
    );
  return value;
}

export function normalizeProxyRequestLogLimit(value: unknown): number {
  try {
    return validateProxyRequestLogLimit(value);
  } catch {
    return DEFAULT_PROXY_REQUEST_LOG_LIMIT;
  }
}
