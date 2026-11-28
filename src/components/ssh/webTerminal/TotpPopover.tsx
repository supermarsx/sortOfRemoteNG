import { WebTerminalMgr } from "./types";
import SessionTotpPanel from "../../security/SessionTotpPanel";
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
      data-tooltip="Credentials & 2FA"
    >
      <button
        type="button"
        disabled={vaultSelected && !mgr.vaultTotp.available}
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        onPointerDown={typing.onPointerDown}
        className={`sor-btn sor-icon-btn-sm relative shrink-0 ${mgr.showTotpPanel ? "bg-primary/15 text-primary" : "text-[var(--color-textSecondary)]"}`}
        data-tooltip={vaultSelected ? undefined : "Credentials & 2FA"}
        aria-expanded={mgr.showTotpPanel}
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
        <SessionTotpPanel
          configs={mgr.totpConfigs}
          typingRef={typing.popupRef}
          renderTypeCode={(index) => actions({ localIndex: index })}
          credentialActions={actions()}
          onClose={() => mgr.setShowTotpPanel(false)}
          ownerDatabaseId={mgr.session.ownerDatabaseId}
          connectionId={mgr.connection?.id}
          anchorRef={mgr.totpBtnRef}
        />
      )}
    </div>
  );
}

export default TotpPopover;
