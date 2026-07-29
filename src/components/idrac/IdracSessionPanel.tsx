"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
import {
  claimIdracRuntime,
  teardownIdracRuntime,
} from "../../utils/session/builtInManagementRuntimeRegistry";
import IdracPanel, {
  type IdracPanelConnectionState,
} from "./idracPanel/IdracPanel";

export interface IdracSessionPanelProps {
  session: ConnectionSession;
  onClose?: () => void;
}

const connectionError = (
  session: ConnectionSession,
  connection: Connection | undefined,
): string | null => {
  if (!connection) {
    return `Dell iDRAC connection "${session.connectionId}" is unavailable. The saved connection may have been removed.`;
  }
  if (connection.protocol !== "idrac") {
    return `Dell iDRAC session "${session.id}" resolved to protocol "${connection.protocol}" instead of "idrac".`;
  }
  if (!connection.hostname.trim()) {
    return "Dell iDRAC cannot connect because the saved hostname is empty.";
  }
  if (!connection.username?.trim()) {
    return "Dell iDRAC cannot connect because the saved username is empty.";
  }
  return null;
};

const IdracSessionPanel: React.FC<IdracSessionPanelProps> = ({
  session,
  onClose,
}) => {
  const { state, dispatch } = useConnections();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectedRef = useRef(false);
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const validationError = connectionError(session, connection);
  const [leaseError, setLeaseError] = useState<string | null>(null);
  const [leaseReady, setLeaseReady] = useState(false);

  const updateSession = useCallback(
    (patch: Partial<ConnectionSession>) => {
      dispatch?.({
        type: "UPDATE_SESSION",
        payload: { ...sessionRef.current, ...patch },
      });
    },
    [dispatch],
  );

  const teardown = useCallback(
    () =>
      teardownIdracRuntime(session.id, () =>
        invoke<void>("idrac_disconnect"),
      ),
    [session.id],
  );

  useEffect(() => {
    if (validationError) {
      updateSession({ status: "error", errorMessage: validationError });
      return;
    }

    if (!claimIdracRuntime(session.id)) {
      const message =
        "Another Dell iDRAC session is already active. The native iDRAC service currently supports one device at a time.";
      setLeaseError(message);
      updateSession({ status: "error", errorMessage: message });
      return;
    }

    setLeaseReady(true);
    return () => {
      void teardown();
    };
  }, [session.id, teardown, updateSession, validationError]);

  const handleConnectionStateChange = useCallback(
    (nextState: IdracPanelConnectionState, errorMessage?: string) => {
      if (
        nextState === "disconnected" &&
        !connectedRef.current &&
        sessionRef.current.status === "connecting"
      ) {
        return;
      }

      if (nextState === "connected") connectedRef.current = true;
      if (nextState === "disconnected" || nextState === "error") {
        connectedRef.current = false;
      }

      updateSession({
        status: nextState,
        errorMessage: nextState === "error" ? errorMessage : undefined,
      });
    },
    [updateSession],
  );

  const error = validationError ?? leaseError;
  if (error) {
    return (
      <div
        className="flex h-full items-center justify-center bg-[var(--color-bg)] p-6"
        data-testid="idrac-session-error"
      >
        <div
          className="w-full max-w-lg rounded-xl border border-error/30 bg-error/10 p-5"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-error" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Dell iDRAC session unavailable
              </h2>
              <p className="mt-1 text-xs text-error">{error}</p>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
                aria-label="Close iDRAC session"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!leaseReady || !connection) {
    return (
      <div
        className="flex h-full items-center justify-center bg-[var(--color-bg)] text-sm text-[var(--color-textSecondary)]"
        data-testid="idrac-session-preparing"
      >
        Preparing Dell iDRAC session
      </div>
    );
  }

  return (
    <IdracPanel
      key={connection.id}
      connection={connection}
      autoConnect
      onConnectionStateChange={handleConnectionStateChange}
      onRequestTeardown={teardown}
      onClose={onClose}
    />
  );
};

export default IdracSessionPanel;
