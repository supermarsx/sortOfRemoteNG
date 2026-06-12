import { WebTerminalMgr } from "./types";
import Modal from "../../ui/overlays/Modal";
import DialogHeader from "../../ui/overlays/DialogHeader";
import { ShieldAlert } from "lucide-react";

/**
 * Import-confirmation gate for SSH ProxyCommand.
 *
 * The backend refuses an unconfirmed (imported/synced) ProxyCommand with a
 * distinct `PROXY_COMMAND_CONFIRMATION_REQUIRED` error. This dialog shows the
 * user the EXACT (credential-redacted) shell command that would run on their
 * machine and requires explicit approval before the connection is allowed to
 * execute it. Decline aborts the connection without ever running the command.
 */
function ProxyCommandConfirmDialog({ mgr }: { mgr: WebTerminalMgr }) {
  const prompt = mgr.proxyCommandPrompt;
  if (!prompt) return null;

  const resolve = (confirmed: boolean) => {
    mgr.setProxyCommandPrompt(null);
    mgr.proxyCommandResolveRef.current?.(confirmed);
    mgr.proxyCommandResolveRef.current = null;
  };

  return (
    <Modal
      isOpen={!!prompt}
      onClose={() => resolve(false)}
      backdropClassName="bg-black/50"
      panelClassName="max-w-[560px] mx-4"
      dataTestId="proxy-command-confirm-dialog"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full flex flex-col border border-[var(--color-border)]">
        <DialogHeader
          icon={ShieldAlert}
          iconColor="text-warning"
          variant="compact"
          title="Confirm imported ProxyCommand"
          onClose={() => resolve(false)}
        />

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-[var(--color-text)]">
            This connection was imported or synced and its{" "}
            <span className="font-semibold">ProxyCommand</span> will run a shell
            command on your machine before the SSH session connects. Review it
            carefully — only confirm commands you trust.
          </p>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-textMuted)] mb-1">
              Command to run
            </div>
            <pre
              className="text-xs font-mono whitespace-pre-wrap break-all rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[var(--color-text)]"
              data-testid="proxy-command-confirm-command"
            >
              {prompt.command}
            </pre>
          </div>

          <p className="text-xs text-[var(--color-textMuted)]">
            Confirming records this exact command as trusted for this connection
            so you are not asked again. If the command later changes, you will be
            asked to confirm the new command.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-end gap-2">
          <button
            onClick={() => resolve(false)}
            className="px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors"
            data-testid="proxy-command-confirm-decline"
          >
            Cancel
          </button>
          <button
            onClick={() => resolve(true)}
            className="px-3 py-1.5 text-sm rounded-md bg-warning text-white hover:opacity-90 transition-opacity"
            data-testid="proxy-command-confirm-accept"
          >
            Run command &amp; connect
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ProxyCommandConfirmDialog;
