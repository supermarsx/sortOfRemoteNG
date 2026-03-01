import { WebTerminalMgr } from "./types";

function TotpPopover({ mgr }: { mgr: WebTerminalMgr }) {
  return (
    <div className="relative" ref={mgr.totpBtnRef}>
      <button
        type="button"
        onClick={() => mgr.setShowTotpPanel(!mgr.showTotpPanel)}
        className={`app-bar-button p-2 relative ${mgr.showTotpPanel ? "text-blue-400" : ""}`}
        data-tooltip="2FA Codes"
        aria-label="2FA Codes"
      >
        <Shield size={14} />
        {mgr.totpConfigs.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--color-secondary)] text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">
            {mgr.totpConfigs.length}
          </span>
        )}
      </button>
      {mgr.showTotpPanel && (
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
