"use client";

import { Copy } from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { useCredentialCopy } from "../../hooks/security/useCredentialCopy";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

export default function CredentialCopyActions({
  session,
  connection,
}: {
  session: ConnectionSession;
  connection?: Connection;
}) {
  const { copy, available, busy, message } = useCredentialCopy(
    session,
    connection,
  );
  return (
    <div
      className="space-y-2 border-b border-[var(--color-border)] p-3"
      aria-label="Copy selected credential"
    >
      <div className="flex flex-wrap gap-2">
        {(["username", "password"] as const).map((field) => (
          <button
            key={field}
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!available || busy}
            onClick={() => void copy(field)}
          >
            <Copy size={14} aria-hidden="true" /> Copy {field}
          </button>
        ))}
      </div>
      {(message || !available) && (
        <p role="status" className="text-xs">
          {message ||
            "Open and unlock the owning database to copy this credential."}
        </p>
      )}
    </div>
  );
}

/** RDP headers carry IDs; obtain the owning session from the existing context. */
export function SessionCredentialCopyActions({
  sessionId,
  connectionId,
}: {
  sessionId: string;
  connectionId: string;
}) {
  const { state } = useConnections();
  const sessions = state.sessions.filter(
    (item) => item.id === sessionId && item.connectionId === connectionId,
  );
  const connections = state.connections.filter(
    (item) => item.id === connectionId,
  );
  if (sessions.length !== 1) return null;
  return (
    <CredentialCopyActions
      session={sessions[0]}
      connection={connections.length === 1 ? connections[0] : undefined}
    />
  );
}
