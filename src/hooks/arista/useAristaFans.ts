/**
 * useAristaFans - fetches Arista EOS fan speeds (eAPI) with optional polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement as invoke,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import type {
  AristaConfig,
  AristaCoolingReport,
} from "../../types/hardware/arista";

export interface UseAristaFansOptions {
  /** Poll interval in milliseconds; 0 or undefined disables polling. */
  pollMs?: number;
}

export function useAristaFans(
  config: AristaConfig | null,
  options: UseAristaFansOptions = {},
) {
  const { pollMs = 0 } = options;
  const [report, setReport] = useState<AristaCoolingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const aliveRef = useRef(true);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg) return;
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const next = await invoke<AristaCoolingReport>("arista_get_fan_speeds", {
        config: cfg,
      });
      if (!aliveRef.current || seq !== seqRef.current) return;
      setReport(next);
      setError(null);
    } catch (e) {
      if (!aliveRef.current || seq !== seqRef.current) return;
      setError(toSafeManagementError(e, "Failed to read fan speeds."));
    } finally {
      if (aliveRef.current && seq === seqRef.current) setLoading(false);
    }
  }, []);

  const host = config?.host;
  const port = config?.port;
  const username = config?.username;
  useEffect(() => {
    aliveRef.current = true;
    if (!host) return () => undefined;
    void refresh();
    const timer = pollMs > 0 ? setInterval(() => void refresh(), pollMs) : null;
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [host, port, username, pollMs, refresh]);

  return { report, loading, error, refresh };
}
