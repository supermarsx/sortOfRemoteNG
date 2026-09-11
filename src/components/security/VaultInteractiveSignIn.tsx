import React from "react";
import { KeyRound, ExternalLink } from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { useVaultInteractiveSignIn } from "../../hooks/security/useVaultInteractiveSignIn";
import { Modal } from "../ui/overlays/Modal";

export default function VaultInteractiveSignIn({
  session,
  connection,
  sessionTarget,
}: {
  session: ConnectionSession;
  connection: Connection;
  sessionTarget: string;
}) {
  const mgr = useVaultInteractiveSignIn(session, connection, sessionTarget);
  return (
    <>
      <button
        type="button"
        className="sor-icon-btn-sm"
        aria-label="Vault social and passkey sign-in"
        data-tooltip="Interactive sign-in with a saved vault binding"
        disabled={mgr.busy}
        onClick={() => void mgr.load()}
      >
        <KeyRound size={16} />
      </button>
      <Modal
        isOpen={mgr.open}
        onClose={mgr.close}
        ariaLabel="Interactive vault sign-in"
        panelClassName="!max-w-lg"
      >
        <div className="p-5 space-y-4">
          <h3 className="font-semibold">Interactive vault sign-in</h3>
          <p className="text-sm text-[var(--color-textSecondary)]">
            Open the original HTTPS website in your external browser. Browser
            cookies and network routing are separate from this embedded session.
            Social providers and passkeys require interactive sign-in; hardware
            keys and tokens are never copied.
          </p>
          {mgr.target && (
            <p className="rounded border border-[var(--color-border)] p-2 break-all text-sm">
              {mgr.target}
            </p>
          )}
          {mgr.error && (
            <p role="alert" className="text-sm text-error">
              {mgr.error}
            </p>
          )}
          {mgr.notice && (
            <p role="status" className="text-sm">
              {mgr.notice}
            </p>
          )}
          <ul className="max-h-64 overflow-auto space-y-3">
            {mgr.rows.map((row) => (
              <li
                key={`${row.kind}:${row.id}`}
                className="rounded border border-[var(--color-border)] p-3 space-y-1"
              >
                <p className="text-sm font-medium">
                  {row.provider} ·{" "}
                  {row.kind === "passkey" ? "Passkey" : "Social sign-in"}
                </p>
                {row.accountHint && (
                  <p className="text-xs break-all text-[var(--color-textSecondary)]">
                    {row.accountHint}
                  </p>
                )}
                <p className="text-xs break-all">{row.authority}</p>
                {!row.available && (
                  <p className="text-xs text-warning">{row.reason}</p>
                )}
                <button
                  type="button"
                  className="sor-btn-secondary-sm"
                  disabled={mgr.busy || !row.available}
                  onClick={() => void mgr.openBinding(row)}
                >
                  <ExternalLink size={13} />
                  Open website for {row.provider}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={mgr.busy}
              onClick={() => void mgr.load()}
            >
              Reload bindings
            </button>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={mgr.close}
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
