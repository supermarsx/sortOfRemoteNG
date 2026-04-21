import { useCallback, useEffect, useState } from "react";

/**
 * Persisted acknowledgement flag for "insecure TLS" (skip-verify) connection
 * configs (BMC / Redfish, CI/CD, Kubernetes).  The flag is keyed per
 * connection-config id so that each insecure config requires a one-time
 * acknowledgement from the user.
 *
 * Persistence is backed by `localStorage` under the
 * `insecure-tls-ack:<configId>` key.  The value is a simple ISO timestamp
 * marker.
 */
const STORAGE_PREFIX = "insecure-tls-ack:";

const storageKey = (configId: string) => `${STORAGE_PREFIX}${configId}`;

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readAck = (configId: string): boolean => {
  if (!isBrowser() || !configId) return false;
  try {
    return window.localStorage.getItem(storageKey(configId)) !== null;
  } catch {
    return false;
  }
};

const writeAck = (configId: string): void => {
  if (!isBrowser() || !configId) return;
  try {
    window.localStorage.setItem(storageKey(configId), new Date().toISOString());
  } catch {
    // ignore quota / disabled storage — the modal will just reappear.
  }
};

const clearAck = (configId: string): void => {
  if (!isBrowser() || !configId) return;
  try {
    window.localStorage.removeItem(storageKey(configId));
  } catch {
    // ignore
  }
};

export interface UseInsecureTlsAckOptions {
  /** Stable id of the connection config. Empty string disables the hook. */
  configId: string;
  /**
   * Whether this config is actually insecure (i.e. `tls_skip_verify=true` /
   * `danger_accept_invalid_certs=true`).  When `false` the hook reports
   * `needsAck=false` regardless of persisted state.
   */
  insecure: boolean;
}

export interface UseInsecureTlsAckResult {
  /** True if an insecure config is present and no ack has been recorded. */
  needsAck: boolean;
  /** Raw persisted flag (true if previously acknowledged). */
  acknowledged: boolean;
  /** Record an acknowledgement for this config id. */
  acknowledge: () => void;
  /** Clear a previously recorded acknowledgement (e.g. for tests / reset). */
  reset: () => void;
}

/**
 * React hook surfacing whether a given connection config needs an
 * "insecure TLS" acknowledgement and providing a one-shot `acknowledge()`
 * function that persists the decision.
 */
export function useInsecureTlsAck(
  options: UseInsecureTlsAckOptions,
): UseInsecureTlsAckResult {
  const { configId, insecure } = options;
  const [acknowledged, setAcknowledged] = useState<boolean>(() =>
    readAck(configId),
  );

  // Keep state in sync when configId changes (e.g. switching connections).
  useEffect(() => {
    setAcknowledged(readAck(configId));
  }, [configId]);

  const acknowledge = useCallback(() => {
    if (!configId) return;
    writeAck(configId);
    setAcknowledged(true);
  }, [configId]);

  const reset = useCallback(() => {
    if (!configId) return;
    clearAck(configId);
    setAcknowledged(false);
  }, [configId]);

  return {
    needsAck: insecure && !!configId && !acknowledged,
    acknowledged,
    acknowledge,
    reset,
  };
}

export default useInsecureTlsAck;
