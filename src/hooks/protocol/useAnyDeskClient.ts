import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

interface AnyDeskBackendSession {
  id: string;
  anydesk_id: string;
  /** Local launcher process only; never remote authentication/readiness. */
  process_running: boolean;
  start_time: string;
}

const getLaunchTarget = (connection: Connection | undefined) =>
  connection?.hostname?.trim() || connection?.name?.trim() || "";

const getTargetValidationError = (target: string) => {
  if (!target) return "Missing AnyDesk ID or hostname.";
  if (/^[/-]/.test(target)) {
    return "The AnyDesk ID or alias cannot be an option-like value.";
  }
  if (/\p{Cc}/u.test(target)) {
    return "The AnyDesk ID or alias contains control characters.";
  }
  return null;
};

const buildAnyDeskUrl = (target: string) =>
  `anydesk://${encodeURIComponent(target)}`;

const LOCAL_PROCESS_ONLY_MESSAGE =
  "The AnyDesk launcher process is running. Remote authentication and display readiness remain in the native client.";

export function useAnyDeskClient(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const connection = useMemo(
    () => state.connections.find((item) => item.id === session.connectionId),
    [state.connections, session.connectionId],
  );

  const [isLaunching, setIsLaunching] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendSession, setBackendSession] =
    useState<AnyDeskBackendSession | null>(null);
  const [launchMode, setLaunchMode] = useState<"managed" | "external" | null>(
    null,
  );

  const anydeskId = getLaunchTarget(connection);
  const targetValidationError = getTargetValidationError(anydeskId);
  const activeBackendSessionId = session.backendSessionId ?? backendSession?.id;

  const updateSession = useCallback(
    (payload: Partial<ConnectionSession>) => {
      const currentSession = sessionRef.current;
      const hasChanges = Object.entries(payload).some(
        ([key, value]) =>
          currentSession[key as keyof ConnectionSession] !== value,
      );
      if (!hasChanges) return;

      const nextSession = {
        ...currentSession,
        ...payload,
      };
      // Keep consecutive async status checks idempotent even before the
      // connection context has rendered the dispatched session object.
      sessionRef.current = nextSession;
      dispatch({
        type: "UPDATE_SESSION",
        payload: nextSession,
      });
    },
    [dispatch],
  );

  const refreshSession = useCallback(async () => {
    if (!activeBackendSessionId) {
      setBackendSession(null);
      return null;
    }

    try {
      const data = await invoke<AnyDeskBackendSession | null>(
        "get_anydesk_session",
        {
          sessionId: activeBackendSessionId,
        },
      );

      setBackendSession(data);
      if (!data) {
        setLaunchMode(null);
        updateSession({
          backendSessionId: undefined,
          status: "disconnected",
          errorMessage: undefined,
        });
      } else if (data.process_running) {
        setLaunchMode("managed");
        updateSession({
          status: "connecting",
          backendSessionId: data.id,
          errorMessage: undefined,
        });
      }

      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    }
  }, [activeBackendSessionId, updateSession]);

  const launchExternalScheme = useCallback(() => {
    if (targetValidationError) {
      throw new Error(targetValidationError);
    }

    window.open(buildAnyDeskUrl(anydeskId), "_blank", "noopener,noreferrer");
    setLaunchMode("external");
  }, [anydeskId, targetValidationError]);

  const launch = useCallback(async () => {
    if (!connection) {
      setError("The connection for this session could not be found.");
      return;
    }

    if (targetValidationError) {
      setError(targetValidationError);
      return;
    }

    setIsLaunching(true);
    setError(null);

    try {
      const sessionId = await invoke<string>("launch_anydesk", {
        anydeskId,
        password: connection.password || null,
      });

      setLaunchMode("managed");

      const managedSession = await invoke<AnyDeskBackendSession | null>(
        "get_anydesk_session",
        {
          sessionId,
        },
      );
      setBackendSession(managedSession);

      if (managedSession?.process_running) {
        updateSession({
          backendSessionId: sessionId,
          // Do not translate a local process handle into a claim that the
          // remote peer authenticated or produced a usable framebuffer.
          status: "connecting",
          errorMessage: undefined,
        });
      } else {
        throw new Error(
          "The tracked AnyDesk launcher process exited before it could be verified.",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      try {
        launchExternalScheme();
        updateSession({
          backendSessionId: undefined,
          status: "connecting",
          errorMessage: undefined,
        });
        setError(
          `Native AnyDesk launch failed. Falling back to the URL scheme. ${message}`,
        );
      } catch (schemeError) {
        const schemeMessage =
          schemeError instanceof Error
            ? schemeError.message
            : String(schemeError);
        setError(`Failed to launch AnyDesk. ${message}. ${schemeMessage}`);
      }
    } finally {
      setIsLaunching(false);
    }
  }, [
    anydeskId,
    connection,
    launchExternalScheme,
    targetValidationError,
    updateSession,
  ]);

  const disconnect = useCallback(async () => {
    if (!activeBackendSessionId) {
      setLaunchMode(null);
      updateSession({ status: "disconnected", backendSessionId: undefined });
      return;
    }

    setIsDisconnecting(true);
    setError(null);

    try {
      await invoke<void>("disconnect_anydesk", {
        sessionId: activeBackendSessionId,
      });
      setBackendSession(null);
      setLaunchMode(null);
      updateSession({ status: "disconnected", backendSessionId: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsDisconnecting(false);
    }
  }, [activeBackendSessionId, updateSession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!activeBackendSessionId) return undefined;

    const interval = window.setInterval(() => {
      refreshSession();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshSession, activeBackendSessionId]);

  return {
    connection,
    anydeskId,
    backendSession,
    launchMode,
    isLaunching,
    isDisconnecting,
    error,
    processStatusMessage:
      backendSession?.process_running && launchMode === "managed"
        ? LOCAL_PROCESS_ONLY_MESSAGE
        : null,
    canLaunch: Boolean(connection && !targetValidationError),
    launch,
    disconnect,
    refreshSession,
  };
}

export default useAnyDeskClient;
