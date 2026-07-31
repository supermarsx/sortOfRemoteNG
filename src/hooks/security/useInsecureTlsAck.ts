import { useCallback, useState } from "react";

/**
 * Runtime-only acknowledgement for an insecure-TLS connection attempt.
 * Acknowledgements must never be persisted or imported with connection data:
 * switching config ids or remounting the caller invalidates the decision.
 */
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
  /** Runtime-only flag for the current config id. */
  acknowledged: boolean;
  /** Record an acknowledgement for this config id in component memory. */
  acknowledge: () => void;
  /** Consume or clear the acknowledgement after the connection attempt. */
  reset: () => void;
}

/**
 * React hook surfacing whether a given connection config needs an
 * "insecure TLS" acknowledgement and providing a one-shot runtime decision.
 */
export function useInsecureTlsAck(
  options: UseInsecureTlsAckOptions,
): UseInsecureTlsAckResult {
  const { configId, insecure } = options;
  const [acknowledgedConfigId, setAcknowledgedConfigId] = useState<
    string | null
  >(null);
  const acknowledged = Boolean(configId) && acknowledgedConfigId === configId;

  const acknowledge = useCallback(() => {
    if (!configId) return;
    setAcknowledgedConfigId(configId);
  }, [configId]);

  const reset = useCallback(() => {
    setAcknowledgedConfigId(null);
  }, []);

  return {
    needsAck: insecure && !!configId && !acknowledged,
    acknowledged,
    acknowledge,
    reset,
  };
}

export default useInsecureTlsAck;
