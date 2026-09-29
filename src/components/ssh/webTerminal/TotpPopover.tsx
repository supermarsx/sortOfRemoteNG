import { WebTerminalMgr } from "./types";
import RDPTotpPanel from "../../rdp/RDPTotpPanel";
import { Shield } from "lucide-react";
import RuntimeVaultTotpPanel from "../../security/RuntimeVaultTotpPanel";
import CredentialCopyActions from "../../security/CredentialCopyActions";
import { useCredentialTyping } from "../../../hooks/security/useCredentialTyping";

function TotpPopover({ mgr }: { mgr: WebTerminalMgr }) {
  const typing = useCredentialTyping(
    mgr.showTotpPanel,
    mgr.captureCredentialTarget,
  );
  const actions = (
    codeSelection?: import("../../../hooks/security/useCredentialCopy").CredentialCodeSelection,
  ) => (
    <CredentialCopyActions
      session={mgr.session}
      connection={mgr.connection}
      typingTarget={typing.target}
      codeSelection={codeSelection}
    />
  );
  const vaultSelected = mgr.connection?.credentialSource?.kind === "vault";
  return (
    <div
      className="relative"
      ref={mgr.totpBtnRef}
      data-tooltip={
        vaultSelected
          ? "Credentials & 2FA — copy credentials or generate codes from this session's owning database vault. Connection-local codes are ignored."
          : undefined
      }
    >
      <button
        type="button"
        disabled={vaultSelected && !mgr.vaultTotp.available}
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        onPointerDown={typing.onPointerDown}
        className={`app-bar-button p-2 relative ${mgr.showTotpPanel ? "text-primary" : ""}`}
        data-tooltip={vaultSelected ? undefined : "Credentials & 2FA"}
        aria-label="Credentials & 2FA"
      >
        <Shield size={14} />
        {mgr.totpConfigs.length > 0 && (
          <span className="sor-notification-dot">{mgr.totpConfigs.length}</span>
        )}
      </button>
      {mgr.showTotpPanel && vaultSelected && (
        <RuntimeVaultTotpPanel
          controller={mgr.vaultTotp}
          typingRef={typing.popupRef}
          renderTypeCode={(id) => actions({ vaultId: id })}
          credentialActions={actions()}
          anchorRef={mgr.totpBtnRef}
          onClose={() => mgr.setShowTotpPanel(false)}
        />
      )}
      {mgr.showTotpPanel && !vaultSelected && (
        <RDPTotpPanel
          configs={mgr.totpConfigs}
          typingRef={typing.popupRef}
          renderTypeCode={(index) => actions({ localIndex: index })}
          credentialActions={actions()}
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
