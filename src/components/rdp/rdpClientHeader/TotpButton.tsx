import React from "react";
import { Mgr, RDPClientHeaderProps, btnActive, btnDefault } from "./helpers";
import RDPTotpPanel from "../RDPTotpPanel";
import { Shield } from "lucide-react";
import RuntimeVaultTotpPanel from "../../security/RuntimeVaultTotpPanel";
import { SessionCredentialCopyActions } from "../../security/CredentialCopyActions";

const TotpButton: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => {
  const configs =
    p.vaultTotp || p.totpUnavailableReason ? [] : (p.totpConfigs ?? []);
  return (
    <div
      ref={mgr.totpBtnRef}
      className="relative"
      data-tooltip={p.totpUnavailableReason}
    >
      <button
        disabled={!!p.totpUnavailableReason}
        aria-label="2FA Codes"
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        className={`${mgr.showTotpPanel ? btnActive : btnDefault} relative`}
        data-tooltip={p.totpUnavailableReason ? undefined : "2FA Codes"}
      >
        <Shield size={14} />
        {configs.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--color-border)] text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">
            {configs.length}
          </span>
        )}
      </button>
      {mgr.showTotpPanel && p.vaultTotp && (
        <RuntimeVaultTotpPanel
          controller={p.vaultTotp}
          credentialActions={
            <SessionCredentialCopyActions
              sessionId={p.sessionId}
              connectionId={p.connectionId}
            />
          }
          anchorRef={mgr.totpBtnRef}
          onClose={() => mgr.setShowTotpPanel(false)}
        />
      )}
      {mgr.showTotpPanel && !p.vaultTotp && !p.totpUnavailableReason && (
        <RDPTotpPanel
          configs={configs}
          credentialActions={
            <SessionCredentialCopyActions
              sessionId={p.sessionId}
              connectionId={p.connectionId}
            />
          }
          onUpdate={p.onUpdateTotpConfigs}
          onClose={() => mgr.setShowTotpPanel(false)}
          onAutoType={p.handleAutoTypeTOTP}
          defaultIssuer={p.totpDefaultIssuer}
          defaultDigits={p.totpDefaultDigits}
          defaultPeriod={p.totpDefaultPeriod}
          defaultAlgorithm={p.totpDefaultAlgorithm}
          anchorRef={mgr.totpBtnRef}
        />
      )}
    </div>
  );
};

export default TotpButton;
