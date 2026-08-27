/**
 * useVoipPhone — per-session state machine for the `voip-phone` protocol.
 *
 * Wraps the `voip_phone_*` commands through {@link VoipPhoneRuntimeAdapter}.
 * The backend keys sessions by the tab's `session.id`, so several phones can
 * be open at once and no process-global lease is required.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Connection } from "../../types/connection/connection";
import type {
  VoipPhoneSessionSummary,
  VoipPhoneStatus,
  VoipRebootResult,
} from "../../types/voipPhone";
import { toSafeManagementError } from "../../utils/security/managementInvoke";
import {
  voipPhoneRuntimeAdapter,
  type VoipPhoneResolvedWebLoginHint,
  type VoipPhoneRuntimeAdapter,
} from "../../utils/session/voipPhoneRuntimeAdapter";

export type VoipPhonePhase =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnecting";

export interface UseVoipPhoneState {
  phase: VoipPhonePhase;
  summary: VoipPhoneSessionSummary | null;
  status: VoipPhoneStatus | null;
  statusLoading: boolean;
  statusError: string | null;
  error: string | null;
  rebooting: boolean;
}

export interface UseVoipPhoneReturn extends UseVoipPhoneState {
  connect: (connection: Connection) => Promise<VoipPhoneSessionSummary>;
  disconnect: () => Promise<void>;
  refreshStatus: () => Promise<VoipPhoneStatus | null>;
  reboot: () => Promise<VoipRebootResult>;
  getWebLoginHint: () => Promise<VoipPhoneResolvedWebLoginHint>;
}

const DEFAULT_ERROR = "The phone operation failed.";

export function useVoipPhone(
  sessionId: string,
  adapter: VoipPhoneRuntimeAdapter = voipPhoneRuntimeAdapter,
): UseVoipPhoneReturn {
  const [phase, setPhase] = useState<VoipPhonePhase>("idle");
  const [summary, setSummary] = useState<VoipPhoneSessionSummary | null>(null);
  const [status, setStatus] = useState<VoipPhoneStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebooting, setRebooting] = useState(false);
  const mountedRef = useRef(true);
  const statusRequestRef = useRef(0);
  const connectPromiseRef = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusRequestRef.current += 1;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    const requestId = statusRequestRef.current + 1;
    statusRequestRef.current = requestId;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const next = await adapter.loadStatus(sessionId);
      if (mountedRef.current && statusRequestRef.current === requestId) {
        setStatus(next);
      }
      return next;
    } catch (cause) {
      if (mountedRef.current && statusRequestRef.current === requestId) {
        setStatusError(toSafeManagementError(cause, DEFAULT_ERROR));
      }
      return null;
    } finally {
      if (mountedRef.current && statusRequestRef.current === requestId) {
        setStatusLoading(false);
      }
    }
  }, [adapter, sessionId]);

  const connect = useCallback(
    async (connection: Connection) => {
      setPhase("connecting");
      setError(null);
      setStatus(null);
      setStatusError(null);
      const promise = adapter.connect(sessionId, connection);
      connectPromiseRef.current = promise;
      try {
        const next = await promise;
        if (mountedRef.current) {
          setSummary(next);
          setPhase("connected");
        }
        return next;
      } catch (cause) {
        if (mountedRef.current) {
          setError(toSafeManagementError(cause, DEFAULT_ERROR));
          setPhase("error");
        }
        throw cause;
      }
    },
    [adapter, sessionId],
  );

  const disconnect = useCallback(async () => {
    if (mountedRef.current) setPhase("disconnecting");
    statusRequestRef.current += 1;
    try {
      await connectPromiseRef.current;
    } catch {
      // A failed connect still needs backend cleanup.
    }
    try {
      await adapter.disconnect(sessionId);
    } finally {
      if (mountedRef.current) {
        setSummary(null);
        setStatus(null);
        setPhase("idle");
      }
    }
  }, [adapter, sessionId]);

  const reboot = useCallback(async () => {
    setRebooting(true);
    try {
      return await adapter.reboot(sessionId);
    } finally {
      if (mountedRef.current) setRebooting(false);
    }
  }, [adapter, sessionId]);

  const getWebLoginHint = useCallback(
    () => adapter.webLoginHint(sessionId),
    [adapter, sessionId],
  );

  return {
    phase,
    summary,
    status,
    statusLoading,
    statusError,
    error,
    rebooting,
    connect,
    disconnect,
    refreshStatus,
    reboot,
    getWebLoginHint,
  };
}

export default useVoipPhone;
