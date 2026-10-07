import React from "react";
import { Copy } from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import { useCredentialCopy } from "../../../hooks/security/useCredentialCopy";

/** Copy only. The existing hook owns vault resolution and database lease checks. */
export default function OriginCredentialCopyPanel({
  session,
  connection,
  assertOwner,
}: {
  session: ConnectionSession;
  connection: Connection;
  assertOwner: () => void;
}) {
  const { copy, available, busy, message } = useCredentialCopy(
    session,
    connection,
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-textSecondary)]">
        Copy the selected connection credential to your system clipboard. Other
        applications may read it. Native credential typing is not available
        here.
      </p>
      <div className="flex flex-wrap gap-2">
        {(["username", "password"] as const).map((field) => (
          <button
            key={field}
            type="button"
            className="sor-btn sor-btn-secondary gap-2"
            data-tooltip={`Copy ${field}`}
            disabled={!available || busy}
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
        ))}
      </div>
      <p role="status" className="text-xs text-[var(--color-textSecondary)]">
        {message ||
          (!available
            ? "Open and unlock the owning database to copy credentials."
            : "Credentials are resolved only when you choose Copy.")}
      </p>
    </div>
  );
}
