import { WebTerminalMgr } from "./types";
import RDPTotpPanel from "../../rdp/RDPTotpPanel";
import { Shield } from "lucide-react";
import RuntimeVaultTotpPanel from "../../security/RuntimeVaultTotpPanel";

function TotpPopover({ mgr }: { mgr: WebTerminalMgr }) {
  const vaultSelected = mgr.connection?.credentialSource?.kind === "vault";
  return (
    <div
      className="relative"
      ref={mgr.totpBtnRef}
      data-tooltip={
        vaultSelected
          ? "Generate codes from this session's owning database vault. Connection-local codes are ignored."
          : undefined
      }
    >
      <button
        type="button"
        disabled={vaultSelected && !mgr.vaultTotp.available}
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        className={`app-bar-button p-2 relative ${mgr.showTotpPanel ? "text-primary" : ""}`}
        data-tooltip={vaultSelected ? undefined : "2FA Codes"}
        aria-label="2FA Codes"
      >
        <Shield size={14} />
        {mgr.totpConfigs.length > 0 && (
          <span className="sor-notification-dot">{mgr.totpConfigs.length}</span>
        )}
      </button>
      {mgr.showTotpPanel && vaultSelected && (
        <RuntimeVaultTotpPanel
          controller={mgr.vaultTotp}
          anchorRef={mgr.totpBtnRef}
          onClose={() => mgr.setShowTotpPanel(false)}
        />
      )}
      {mgr.showTotpPanel && !vaultSelected && (
        <RDPTotpPanel
          configs={mgr.totpConfigs}
          onUpdate={mgr.handleUpdateTotpConfigs}
          onClose={() => mgr.setShowTotpPanel(false)}
          defaultIssuer={mgr.settings.totpIssuer}
          defaultDigits={mgr.settings.totpDigits}
          defaultPeriod={mgr.settings.totpPeriod}
          defaultAlgorithm={mgr.settings.totpAlgorithm}
          anchorRef={mgr.totpBtnRef}
        />
      )}
    </div>
  );
}

export default TotpPopover;
