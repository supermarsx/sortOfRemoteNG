import React, { useState } from "react";
import { Copy, Info, Keyboard } from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import {
  useCredentialCopy,
  type CredentialCodeSelection,
} from "../../../hooks/security/useCredentialCopy";
import type { OriginCredentialTypingController } from "../../../hooks/security/useOriginCredentialTyping";
import { Select } from "../../ui/forms/Select";
import HttpCredentialWarning from "../../security/HttpCredentialWarning";

/** The shared hook owns secret resolution and database lease checks. */
export default function OriginCredentialCopyPanel({
  session,
  connection,
  assertOwner,
  typing,
}: {
  session: ConnectionSession;
  connection: Connection;
  assertOwner: () => void;
  typing?: OriginCredentialTypingController;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const { copy, typeOrThrow, typingAvailable, available, busy, message } =
    useCredentialCopy(session, connection, typing?.target);
  const help = typing
    ? "Copy uses the secure clipboard, which other apps may read. Type hides this popup: click an empty field on an allowed origin within 30 seconds. HTTP typing stays on the configured origin and port. Cancel from the typing notification. Credentials are read only when needed; typing never presses Enter."
    : "Copy uses the secure clipboard, which other apps may read. Credentials are read only when needed. Open Credentials & 2FA on the toolbar to type into a website field.";
  return (
    <div ref={setPortalContainer} className="space-y-3">
      <HttpCredentialWarning connection={connection} />
      <div className="flex flex-wrap gap-2">
        {(["username", "password"] as const).map((field) => (
          <React.Fragment key={field}>
            <button
              key={field}
              type="button"
              className="sor-btn sor-btn-secondary gap-2"
              data-tooltip={`Copy ${field}`}
              disabled={!available || busy || typing?.busy}
              onClick={() => {
                try {
                  assertOwner();
                  void copy(field);
                } catch {
                  /* The owning scope has expired. */
                }
              }}
            >
              <Copy size={16} aria-hidden="true" />
              Copy {field}
            </button>
            {typing && (
              <button
                type="button"
                className="sor-btn sor-btn-secondary gap-2"
                disabled={!typingAvailable || busy || typing.busy}
                // Rejecting, so the typing notice names why nothing was typed.
                onClick={() => void typing.run(() => typeOrThrow(field))}
              >
                <Keyboard size={16} aria-hidden="true" />
                Type {field}
              </button>
            )}
          </React.Fragment>
        ))}
        <button
          type="button"
          className="sor-icon-btn-sm ml-auto"
          aria-label="Copy and typing help"
          aria-description={help}
          data-tooltip={help}
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </div>
      {typing && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              Typing mode
              <Select
                portalContainer={portalContainer}
                label="Credential typing mode"
                variant="form-sm"
                value={typing.mode}
                disabled={typing.busy}
                onChange={(value) => {
                  if (value === "simulated" || value === "instant")
                    typing.setMode(value);
                }}
                options={[
                  { value: "simulated", label: "Simulated keys" },
                  { value: "instant", label: "Fast keys" },
                ]}
              />
            </label>
            <label className="space-y-1 text-xs">
              Start delay
              <Select
                portalContainer={portalContainer}
                label="Credential typing start delay"
                variant="form-sm"
                value={typing.delaySeconds}
                disabled={typing.busy}
                onChange={(value) => typing.setDelaySeconds(Number(value))}
                options={[
                  { value: 0, label: "No delay" },
                  { value: 3, label: "3 seconds" },
                  { value: 5, label: "5 seconds" },
                ]}
              />
            </label>
          </div>
        </div>
      )}
      {(message || !available) && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          {message ||
            "Open and unlock the owning database to copy credentials."}
        </p>
      )}
    </div>
  );
}

export function OriginCredentialTypeCode({
  session,
  connection,
  selection,
  typing,
}: {
  session: ConnectionSession;
  connection: Connection;
  selection: CredentialCodeSelection;
  typing: OriginCredentialTypingController;
}) {
  const { typeCodeOrThrow, typingAvailable, busy, message } = useCredentialCopy(
    session,
    connection,
    typing.target,
  );
  return (
    <span className="inline-flex max-w-32 flex-col items-end">
      <button
        type="button"
        aria-label="Type code"
        data-tooltip="Type code"
        className="sor-icon-btn-sm"
        disabled={!typingAvailable || busy || typing.busy}
        onClick={() => void typing.run(() => typeCodeOrThrow(selection))}
      >
        <Keyboard size={14} aria-hidden="true" />
      </button>
      {message && (
        <span
          role="status"
          className="text-xs text-[var(--color-textSecondary)]"
        >
          {message}
        </span>
      )}
    </span>
  );
}
