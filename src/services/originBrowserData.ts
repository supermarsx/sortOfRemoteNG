import type { BrowserHttpCacheUnavailableReason } from "../types/settings/browserSession";
import { getInvoke } from "../utils/tauri/invoke";

/**
 * Wrappers for the native per-connection browser data commands (t-cefiso C-H5).
 *
 * The owning database always comes from the caller's native database lease;
 * these wrappers never send a database id, a path or a cache size. Older
 * native builds without the commands reject with an unknown-command error,
 * which maps to `unavailable` so the UI degrades instead of failing.
 */

export type OriginBrowserDataError =
  /** A live attempt of the connection exists; its tab must close first. */
  | "browser-session-open"
  /** No native runtime, the command is missing, or the build lacks the browser. */
  | "unavailable"
  /** The command ran and failed, or replied with an unexpected shape. */
  | "failed";

export interface ClearConnectionDataRequest {
  connectionId: string;
  cookies: boolean;
  cache: boolean;
}

export interface ClearConnectionDataResult {
  cookiesCleared: boolean;
  cacheCleared: boolean;
  /** The cache was in use; it is removed when released or on next start. */
  cachePendingRestart: boolean;
}

export interface ClearAllHttpCacheResult {
  cleared: boolean;
  pendingRestart: boolean;
}

export interface HttpCacheUsage {
  available: boolean;
  reason?: BrowserHttpCacheUnavailableReason;
  bytes: number;
  limitBytes: number;
}

export type OriginBrowserDataOutcome<T> =
  { ok: true; value: T } | { ok: false; error: OriginBrowserDataError };

export const CLEAR_CONNECTION_DATA_COMMAND =
  "origin_browser_clear_connection_data";
export const HTTP_CACHE_USAGE_COMMAND = "origin_browser_http_cache_usage";
export const CLEAR_ALL_HTTP_CACHE_COMMAND =
  "origin_browser_clear_all_http_cache";

const REASONS: ReadonlySet<string> = new Set([
  "disabled",
  "cache-location-not-local",
  "engine-unsupported",
  "unavailable",
]);

export const UNAVAILABLE_HTTP_CACHE_USAGE: Readonly<HttpCacheUsage> =
  Object.freeze({
    available: false,
    reason: "unavailable",
    bytes: 0,
    limitBytes: 0,
  });

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Classify a rejected command without ever echoing native text to the UI. */
export function classifyOriginBrowserDataError(
  error: unknown,
): OriginBrowserDataError {
  const text = errorText(error);
  if (text.trim() === "browser-session-open") return "browser-session-open";
  if (
    /not found|unknown command|not allowed|unavailable|not supported/i.test(
      text,
    )
  )
    return "unavailable";
  return "failed";
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isByteCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function call<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  parse: (value: unknown) => T | null,
): Promise<OriginBrowserDataOutcome<T>> {
  let invoke;
  try {
    invoke = await getInvoke();
  } catch {
    invoke = null;
  }
  if (!invoke) return { ok: false, error: "unavailable" };
  let reply: unknown;
  try {
    reply = await invoke<unknown>(command, args);
  } catch (error) {
    return { ok: false, error: classifyOriginBrowserDataError(error) };
  }
  const value = parse(reply);
  return value === null ? { ok: false, error: "failed" } : { ok: true, value };
}

export function parseClearConnectionDataResult(
  value: unknown,
): ClearConnectionDataResult | null {
  const row = record(value);
  if (
    !row ||
    typeof row.cookiesCleared !== "boolean" ||
    typeof row.cacheCleared !== "boolean" ||
    typeof row.cachePendingRestart !== "boolean"
  )
    return null;
  return {
    cookiesCleared: row.cookiesCleared,
    cacheCleared: row.cacheCleared,
    cachePendingRestart: row.cachePendingRestart,
  };
}

export function parseHttpCacheUsage(value: unknown): HttpCacheUsage | null {
  const row = record(value);
  if (
    !row ||
    typeof row.available !== "boolean" ||
    !isByteCount(row.bytes) ||
    !isByteCount(row.limitBytes)
  )
    return null;
  if (row.available)
    return { available: true, bytes: row.bytes, limitBytes: row.limitBytes };
  return {
    available: false,
    reason: REASONS.has(row.reason as string)
      ? (row.reason as BrowserHttpCacheUnavailableReason)
      : "unavailable",
    bytes: row.bytes,
    limitBytes: row.limitBytes,
  };
}

export function parseClearAllHttpCacheResult(
  value: unknown,
): ClearAllHttpCacheResult | null {
  const row = record(value);
  if (
    !row ||
    typeof row.cleared !== "boolean" ||
    typeof row.pendingRestart !== "boolean"
  )
    return null;
  return { cleared: row.cleared, pendingRestart: row.pendingRestart };
}

/** Clear a saved connection's retained sign-in cookies and/or its page cache. */
export function clearConnectionData(
  request: ClearConnectionDataRequest,
): Promise<OriginBrowserDataOutcome<ClearConnectionDataResult>> {
  if (!request.connectionId.trim())
    return Promise.resolve({ ok: false, error: "failed" });
  return call(
    CLEAR_CONNECTION_DATA_COMMAND,
    {
      request: {
        connectionId: request.connectionId,
        cookies: request.cookies,
        cache: request.cache,
      },
    },
    parseClearConnectionDataResult,
  );
}

/** Page-cache usage for one connection, or the global figures without an id.
 * Never rejects: any failure reads as unavailable. */
export async function getHttpCacheUsage(
  connectionId?: string,
): Promise<HttpCacheUsage> {
  const outcome = await call(
    HTTP_CACHE_USAGE_COMMAND,
    { request: connectionId === undefined ? {} : { connectionId } },
    parseHttpCacheUsage,
  );
  return outcome.ok ? outcome.value : { ...UNAVAILABLE_HTTP_CACHE_USAGE };
}

/** Clear every connection's page cache on this device. */
export function clearAllHttpCache(): Promise<
  OriginBrowserDataOutcome<ClearAllHttpCacheResult>
> {
  return call(
    CLEAR_ALL_HTTP_CACHE_COMMAND,
    undefined,
    parseClearAllHttpCacheResult,
  );
}

/** Human-readable MiB/GiB figure for usage lines; never a path or id. */
export function formatCacheBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`;
  if (mib >= 10) return `${Math.round(mib)} MB`;
  return `${mib.toFixed(1)} MB`;
}
