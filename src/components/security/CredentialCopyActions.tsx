"use client";

import React from "react";
import { Copy, Keyboard } from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import {
  useCredentialCopy,
  type CredentialCodeSelection,
} from "../../hooks/security/useCredentialCopy";
import type { CredentialTypingTarget } from "../../utils/security/credentialTyping";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

export default function CredentialCopyActions({
  session,
  connection,
  typingTarget,
  codeSelection,
}: {
  session: ConnectionSession;
  connection?: Connection;
  typingTarget?: CredentialTypingTarget | null;
  codeSelection?: CredentialCodeSelection;
}) {
  const { copy, type, typeCode, typingAvailable, available, busy, message } =
    useCredentialCopy(session, connection, typingTarget);
  if (codeSelection)
    return (
      <span className="inline-flex min-w-0 max-w-32 flex-col items-end">
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label="Type code"
          title="Type code"
          disabled={!typingAvailable || busy}
          onClick={() => void typeCode(codeSelection)}
        >
          <Keyboard size={14} aria-hidden="true" />
        </button>
        {message && (
          <span
            role="status"
            className="mt-1 max-w-full whitespace-normal text-right text-[10px] leading-tight text-[var(--color-textSecondary)] [overflow-wrap:anywhere]"
          >
            {message}
          </span>
        )}
      </span>
    );
  return (
    <div
      className="space-y-2 border-b border-[var(--color-border)] p-3"
      aria-label="Copy or type selected credential"
    >
      <div className="space-y-1">
        {(["username", "password"] as const).map((field) => (
          <div key={field} className="flex items-center justify-between gap-3">
            <span className="text-xs">Copy {field}</span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="sor-icon-btn-sm"
                aria-label={`Copy ${field}`}
                title={`Copy ${field}`}
                disabled={!available || busy}
                onClick={() => void copy(field)}
              >
                <Copy size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sor-icon-btn-sm"
                aria-label={`Type ${field}`}
                title={`Type ${field}`}
                disabled={!typingAvailable || busy}
                onClick={() => void type(field)}
              >
                <Keyboard size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs">
        {typingAvailable
          ? "Type inserts into the captured field or session without pressing Enter."
          : "Focus the session field, then reopen this popup to enable typing."}
      </p>
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
  typingTarget,
  codeSelection,
}: {
  sessionId: string;
  connectionId: string;
  typingTarget?: CredentialTypingTarget | null;
  codeSelection?: CredentialCodeSelection;
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
      typingTarget={typingTarget}
      codeSelection={codeSelection}
    />
  );
}
