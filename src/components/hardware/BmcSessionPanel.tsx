import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { BmcRuntimeAdapter } from "../../utils/session/bmcRuntimeAdapters";
import {
  claimBuiltInManagementRuntime,
  teardownBuiltInManagementRuntime,
} from "../../utils/session/builtInManagementRuntimeRegistry";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";

export interface BmcSessionPanelProps {
  adapter: BmcRuntimeAdapter;
  session: ConnectionSession;
  onClose?: () => void;
}

type PanelPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnecting";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateConnection(
  adapter: BmcRuntimeAdapter,
  connection: Connection | undefined,
): string | null {
  if (!connection) {
    return `Saved ${adapter.displayName} connection is unavailable.`;
  }
  if (connection.protocol !== adapter.protocol) {
    return `Saved connection protocol does not match ${adapter.displayName}.`;
  }
  if (!connection.hostname?.trim()) {
    return `${adapter.displayName} requires a host.`;
  }
  if (!connection.username?.trim()) {
    return `${adapter.displayName} requires a username.`;
  }
  return null;
}

export function BmcSessionPanel({
  adapter,
  session,
  onClose,
}: BmcSessionPanelProps) {
  const { state, dispatch } = useConnections();
  const connection = useMemo(
    () =>
      resolveRuntimeConnection(state.connections, session.connectionId),
    [session.connectionId, state.connections],
  );
  const validationError = useMemo(
    () => validateConnection(adapter, connection),
    [adapter, connection],
  );
  const [phase, setPhase] = useState<PanelPhase>(
    validationError ? "error" : "idle",
  );
  const [runtimeError, setRuntimeError] = useState<string | null>(
    validationError,
  );
  const ownsLeaseRef = useRef(false);
  const mountedRef = useRef(true);
  const connectPromiseRef = useRef<Promise<void> | null>(null);

  const updateSession = useCallback(
    (status: ConnectionSession["status"], sessionError?: string) => {
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          id: session.id,
          status,
          errorMessage: sessionError,
        },
      });
    },
    [dispatch, session.id],
  );

  const teardown = useCallback(() => {
    if (!ownsLeaseRef.current) return Promise.resolve();
    return teardownBuiltInManagementRuntime(
      adapter.protocol,
      session.id,
      async () => {
        try {
          await connectPromiseRef.current;
        } catch {
          // Failed connection attempts still require backend cleanup.
        }
        await adapter.disconnect();
      },
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

    if (!claimBuiltInManagementRuntime(adapter.protocol, session.id)) {
      const message =
        `Another ${adapter.displayName} session is active. ` +
        "Close it before opening this connection.";
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

    const connectPromise = adapter.connect(connection);
    connectPromiseRef.current = connectPromise;
    void connectPromise.then(
      () => {
        if (!mountedRef.current) return;
        setPhase("connected");
        updateSession("connected");
      },
      (error) => {
        if (!mountedRef.current) return;
        const message = getErrorMessage(error);
        setRuntimeError(message);
        setPhase("error");
        updateSession("error", message);
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

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100"
      data-testid={`${adapter.protocol}-session-panel`}
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            {adapter.displayName}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {connection?.name ?? session.name}
          </h2>
          <p className="text-sm text-slate-400">
            {connection?.hostname ?? "Connection unavailable"}
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-slate-600 px-3 py-2 text-sm hover:border-cyan-400 disabled:opacity-50"
          disabled={phase === "disconnecting"}
          onClick={handleClose}
        >
          Close
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-400">Runtime status</span>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-sm font-medium capitalize text-cyan-200">
              {phase}
            </span>
          </div>
          {visibleError ? (
            <div
              className="mt-5 rounded-lg border border-red-500/60 bg-red-950/50 p-4 text-sm text-red-100"
              role="alert"
            >
              {visibleError}
            </div>
          ) : (
            <p className="mt-5 text-sm leading-6 text-slate-300">
              This saved connection owns the provider runtime until disconnect
              completes. Credentials are sent only to the registered backend.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
