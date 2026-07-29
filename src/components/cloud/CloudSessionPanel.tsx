import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConnections } from "../../contexts/useConnections";
import type { ConnectionSession } from "../../types/connection/connection";
import type { CloudRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import {
  claimBuiltInCloudRuntime,
  connectBuiltInCloudRuntime,
  teardownBuiltInCloudRuntime,
} from "../../utils/session/builtInCloudRuntimeRegistry";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export interface CloudSessionPanelProps {
  adapter: CloudRuntimeAdapter;
  session: ConnectionSession;
  onClose?: () => void;
}

type CloudPanelPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnecting";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function CloudSessionPanel({
  adapter,
  session,
  onClose,
}: CloudSessionPanelProps) {
  const { state, dispatch } = useConnections();
  const connection = useMemo(
    () =>
      resolveRuntimeConnection(state.connections, session.connectionId),
    [session.connectionId, state.connections],
  );
  const validationError = useMemo(() => {
    if (!connection) {
      return `Saved ${adapter.displayName} connection is unavailable.`;
    }
    if (connection.protocol !== adapter.protocol) {
      return `Saved connection protocol does not match ${adapter.displayName}.`;
    }
    return adapter.validate(connection);
  }, [adapter, connection]);
  const [phase, setPhase] = useState<CloudPanelPhase>(
    validationError ? "error" : "idle",
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(
    validationError,
  );
  const ownsLeaseRef = useRef(false);
  const mountedRef = useRef(true);

  const updateSession = useCallback(
    (
      status: ConnectionSession["status"],
      sessionError?: string,
      backendSessionId?: string,
    ) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          id: session.id,
          status,
          errorMessage: sessionError,
          backendSessionId,
        },
      });
    },
    [dispatch, session.id],
  );

  const teardown = useCallback(() => {
    if (!ownsLeaseRef.current) return Promise.resolve();
    return teardownBuiltInCloudRuntime(
      adapter.protocol,
      session.id,
      adapter.disconnect,
    );
  }, [adapter, session.id]);

  useEffect(() => {
    mountedRef.current = true;
    if (validationError || !connection) {
      if (validationError) updateSession("error", validationError);
      return () => {
        mountedRef.current = false;
      };
    }

    if (!claimBuiltInCloudRuntime(adapter.protocol, session.id)) {
      const message =
        `Another ${adapter.displayName} runtime owns this lifecycle. ` +
        "Wait for its disconnect to finish.";
      setRuntimeError(message);
      setPhase("error");
      updateSession("error", message);
      return () => {
        mountedRef.current = false;
      };
    }

    ownsLeaseRef.current = true;
    setRuntimeError(null);
    setPhase("connecting");
    updateSession("connecting");

    const connectPromise = connectBuiltInCloudRuntime(
      adapter.protocol,
      session.id,
      () => adapter.connect(connection),
    );
    void connectPromise.then(
      (handle) => {
        if (!mountedRef.current) return;
        setPhase("connected");
        updateSession("connected", undefined, handle.backendSessionId);
      },
      (error) => {
        if (!mountedRef.current) return;
        const message = errorMessage(error);
        setRuntimeError(message);
        setPhase("error");
        updateSession("error", message);
        void teardown();
      },
    );

    return () => {
      mountedRef.current = false;
      void teardown();
    };
  }, [
    adapter,
    connection,
    session.id,
    teardown,
    updateSession,
    validationError,
  ]);

  const handleClose = useCallback(() => {
    setPhase("disconnecting");
    void teardown().finally(() => {
      updateSession("disconnected");
      onClose?.();
    });
  }, [onClose, teardown, updateSession]);

  const visibleError = validationError ?? runtimeError;
  const summary = connection ? adapter.summary(connection) : "";

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-sky-950 text-sky-50"
      data-testid={`${adapter.protocol}-session-panel`}
    >
      <header className="flex items-center justify-between border-b border-sky-800 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
            {adapter.displayName}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {connection?.name ?? session.name}
          </h2>
          <p className="text-sm text-sky-200/70">{summary}</p>
        </div>
        <button
          type="button"
          className="rounded border border-sky-700 px-3 py-2 text-sm hover:border-amber-300 disabled:opacity-50"
          disabled={phase === "disconnecting"}
          onClick={handleClose}
        >
          Close
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-xl border border-sky-800 bg-sky-900/70 p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-sky-200/70">Provider runtime</span>
            <span className="rounded-full bg-sky-950 px-3 py-1 text-sm font-medium capitalize text-amber-200">
              {phase}
            </span>
          </div>
          {visibleError ? (
            <div
              className="mt-5 rounded-lg border border-red-400/60 bg-red-950/50 p-4 text-sm text-red-100"
              role="alert"
            >
              {visibleError}
            </div>
          ) : (
            <p className="mt-5 text-sm leading-6 text-sky-100/80">
              Provider credentials are sent only to the registered backend
              command and are never copied into frontend session state.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
