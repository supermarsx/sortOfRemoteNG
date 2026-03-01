import { WebTerminalMgr } from "./types";
import { Fingerprint, Key, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { getStoredIdentity, formatFingerprint } from "../../../utils/trustStore";

function HostKeyTrustBadges({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.isSsh || !mgr.hostKeyIdentity || !mgr.hostKeyIdentity.fingerprint) return null;

  const sshPort = mgr.connection?.port || 22;
  const stored = getStoredIdentity(
    mgr.session.hostname,
    sshPort,
    "ssh",
    mgr.connection?.id,
  );
  const trustLabel = stored
    ? stored.userApproved
      ? "Trusted"
      : "Remembered (TOFU)"
    : "Unknown";
  const trustBadge = stored
    ? stored.userApproved
      ? "app-badge--success"
      : "app-badge--info"
    : "app-badge--warning";
  const TrustBadgeIcon = stored
    ? stored.userApproved
      ? ShieldCheck
      : Shield
    : ShieldAlert;
  const shortFp =
    formatFingerprint(mgr.hostKeyIdentity.fingerprint).slice(0, 23) + "…";

  return (
    <>
      <span
        className={`app-badge ${trustBadge}`}
        title={`Host key: ${trustLabel}`}
      >
        <TrustBadgeIcon size={10} className="mr-1 inline" />
        {trustLabel}
      </span>
      {mgr.hostKeyIdentity.keyType && (
        <span
          className="app-badge app-badge--neutral"
          title="Host key algorithm"
        >
          <Key size={10} className="mr-1 inline" />
          {mgr.hostKeyIdentity.keyType}
          {mgr.hostKeyIdentity.keyBits
            ? ` (${mgr.hostKeyIdentity.keyBits})`
            : ""}
        </span>
      )}
      <span
        className="app-badge app-badge--neutral normal-case tracking-normal font-mono cursor-pointer hover:opacity-80"
        title={`SHA-256: ${formatFingerprint(mgr.hostKeyIdentity.fingerprint)}`}
        onClick={() => mgr.setShowKeyPopup((v) => !v)}
      >
        <Fingerprint size={10} className="mr-1 inline" />
        {shortFp}
      </span>
    </>
  );
}

export default HostKeyTrustBadges;
