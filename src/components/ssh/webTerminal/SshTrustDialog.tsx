import { WebTerminalMgr } from "./types";

function SshTrustDialog({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.sshTrustPrompt || !mgr.hostKeyIdentity) return null;
  return (
    <TrustWarningDialog
      type="ssh"
      host={mgr.session.hostname}
      port={mgr.connection?.port || 22}
      reason={mgr.sshTrustPrompt.status === "mismatch" ? "mismatch" : "first-use"}
      receivedIdentity={mgr.hostKeyIdentity}
      storedIdentity={
        mgr.sshTrustPrompt.status === "mismatch"
          ? mgr.sshTrustPrompt.stored
          : undefined
      }
      onAccept={() => {
        mgr.setSshTrustPrompt(null);
        mgr.sshTrustResolveRef.current?.(true);
        mgr.sshTrustResolveRef.current = null;
      }}
      onReject={() => {
        mgr.setSshTrustPrompt(null);
        mgr.sshTrustResolveRef.current?.(false);
        mgr.sshTrustResolveRef.current = null;
      }}
    />
  );
}

/* ── Root component ────────────────────────────────────────────── */

export default SshTrustDialog;
