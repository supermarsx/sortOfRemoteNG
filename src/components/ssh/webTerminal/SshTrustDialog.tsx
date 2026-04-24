import { WebTerminalMgr } from "./types";
import { TrustWarningDialog } from "../../security/TrustWarningDialog";

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
      onAccept={(remember) => {
        mgr.setSshTrustPrompt(null);
        mgr.sshTrustResolveRef.current?.(
          mgr.sshTrustPrompt?.status === "first-use" && remember === false
            ? "accept_once"
            : "accept_and_save",
        );
        mgr.sshTrustResolveRef.current = null;
      }}
      onReject={() => {
        mgr.setSshTrustPrompt(null);
        mgr.sshTrustResolveRef.current?.("reject");
        mgr.sshTrustResolveRef.current = null;
      }}
    />
  );
}

/* ── Root component ────────────────────────────────────────────── */

export default SshTrustDialog;
