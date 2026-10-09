import React, { useState } from "react";
import { Copy, Keyboard } from "lucide-react";
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
  const { copy, type, typingAvailable, available, busy, message } =
    useCredentialCopy(session, connection, typing?.target);
  return (
    <div ref={setPortalContainer} className="space-y-3">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Copy the selected connection credential to your system clipboard. Other
        applications may read it.{" "}
        {typing
          ? "Choose Type, then click an empty website field. Typing never presses Enter."
          : "Open Credentials & 2FA on the toolbar to type into a website field."}
      </p>
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
                onClick={() => void typing.run(() => type(field))}
              >
                <Keyboard size={16} aria-hidden="true" />
                Type {field}
              </button>
            )}
          </React.Fragment>
        ))}
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
          <p className="text-xs text-[var(--color-textSecondary)]">
            Type hides this popup and waits up to 30 seconds for an empty HTTPS
            field. Cancel from the typing notification.
          </p>
        </div>
      )}
      <p role="status" className="text-xs text-[var(--color-textSecondary)]">
        {message ||
          (!available
            ? "Open and unlock the owning database to copy credentials."
            : "Credentials are resolved only for Copy or after Type captures an eligible field.")}
      </p>
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
  const { typeCode, typingAvailable, busy, message } = useCredentialCopy(
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
        onClick={() => void typing.run(() => typeCode(selection))}
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
