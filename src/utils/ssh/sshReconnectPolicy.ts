import type { Connection } from "../../types/connection/connection";
import type { GlobalSettings } from "../../types/settings/settings";

export type SshReconnectBackoff = "fixed" | "exponential";

export interface SshReconnectPolicy {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  backoff: SshReconnectBackoff;
  maxDelayMs: number;
}

export const DEFAULT_SSH_RECONNECT_POLICY = Object.freeze({
  enabled: true,
  maxAttempts: 20,
  baseDelaySecs: 2,
  backoff: "exponential" as const,
  maxDelaySecs: 30,
});

type PersistedReconnectSettings = Pick<
  GlobalSettings,
  | "autoReconnectOnDisconnect"
  | "autoReconnectMaxAttempts"
  | "autoReconnectDelaySecs"
  | "autoReconnectBackoff"
  | "autoReconnectMaxDelaySecs"
>;

const boundedInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
};

/**
 * Normalizes reconnect settings read from disk. Explicit legacy choices are
 * preserved, while absent or malformed values receive bounded safe defaults.
 */
export const normalizeSshReconnectSettings = (
  stored: Partial<PersistedReconnectSettings> | null | undefined,
): PersistedReconnectSettings => {
  const baseDelaySecs = boundedInteger(
    stored?.autoReconnectDelaySecs,
    DEFAULT_SSH_RECONNECT_POLICY.baseDelaySecs,
    1,
    60,
  );
  const maxDelaySecs = boundedInteger(
    stored?.autoReconnectMaxDelaySecs,
    DEFAULT_SSH_RECONNECT_POLICY.maxDelaySecs,
    baseDelaySecs,
    300,
  );

  return {
    autoReconnectOnDisconnect:
      typeof stored?.autoReconnectOnDisconnect === "boolean"
        ? stored.autoReconnectOnDisconnect
        : DEFAULT_SSH_RECONNECT_POLICY.enabled,
    autoReconnectMaxAttempts: boundedInteger(
      stored?.autoReconnectMaxAttempts,
      DEFAULT_SSH_RECONNECT_POLICY.maxAttempts,
      0,
      50,
    ),
    autoReconnectDelaySecs: baseDelaySecs,
    autoReconnectBackoff:
      stored?.autoReconnectBackoff === "fixed" ||
      stored?.autoReconnectBackoff === "exponential"
        ? stored.autoReconnectBackoff
        : DEFAULT_SSH_RECONNECT_POLICY.backoff,
    autoReconnectMaxDelaySecs: maxDelaySecs,
  };
};

/**
 * Resolves the effective unexpected-disconnect policy. Existing per-connection
 * retry counts and delays remain authoritative when explicitly configured.
 * A maxAttempts value of 0 retains the existing user-facing "unlimited"
 * override; the shipped default is intentionally bounded.
 */
export const resolveSshReconnectPolicy = (
  settings: Partial<PersistedReconnectSettings>,
  connection?: Pick<Connection, "retryAttempts" | "retryDelay">,
): SshReconnectPolicy => {
  const normalized = normalizeSshReconnectSettings(settings);
  const maxDelayMs = normalized.autoReconnectMaxDelaySecs * 1_000;
  const configuredDelayMs =
    typeof connection?.retryDelay === "number" &&
    Number.isFinite(connection.retryDelay)
      ? Math.max(0, Math.trunc(connection.retryDelay))
      : normalized.autoReconnectDelaySecs * 1_000;

  return {
    enabled: normalized.autoReconnectOnDisconnect,
    maxAttempts: boundedInteger(
      connection?.retryAttempts,
      normalized.autoReconnectMaxAttempts,
      0,
      50,
    ),
    baseDelayMs: Math.min(configuredDelayMs, maxDelayMs),
    backoff: normalized.autoReconnectBackoff,
    maxDelayMs,
  };
};

export const getSshReconnectDelayMs = (
  policy: SshReconnectPolicy,
  completedAttempts: number,
): number => {
  const attempt = boundedInteger(completedAttempts, 0, 0, 50);
  const delay =
    policy.backoff === "exponential"
      ? policy.baseDelayMs * 2 ** attempt
      : policy.baseDelayMs;
  return Math.min(policy.maxDelayMs, delay, 2_147_483_647);
};
