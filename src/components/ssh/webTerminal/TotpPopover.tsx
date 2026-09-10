import { WebTerminalMgr } from "./types";
import RDPTotpPanel from "../../rdp/RDPTotpPanel";
import { Shield } from "lucide-react";

function TotpPopover({ mgr }: { mgr: WebTerminalMgr }) {
  const vaultSelected = mgr.connection?.credentialSource?.kind === "vault";
  return (
    <div
      className="relative"
      ref={mgr.totpBtnRef}
      data-tooltip={
        vaultSelected
          ? "Vault TOTP is not supported for SSH yet. Preserved connection-local codes are ignored."
          : undefined
      }
    >
      <button
        type="button"
        disabled={vaultSelected}
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
