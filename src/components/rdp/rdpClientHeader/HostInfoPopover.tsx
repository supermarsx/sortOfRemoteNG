import React from "react";
import { Mgr, RDPClientHeaderProps, btnActive, btnDefault } from "./helpers";

const HostInfoPopover: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => (
  <div ref={mgr.hostInfoRef} className="relative">
    <button
      onClick={() => mgr.setShowHostInfo(!mgr.showHostInfo)}
      className={mgr.showHostInfo ? btnActive : btnDefault}
      title="Host info &amp; certificate"
    >
      <Info size={14} />
    </button>
    <PopoverSurface
      isOpen={mgr.showHostInfo}
      onClose={() => mgr.setShowHostInfo(false)}
      anchorRef={mgr.hostInfoRef}
      className="sor-popover-panel w-72 overflow-hidden"
      dataTestId="rdp-host-info-popover"
    >
      <div>
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-1.5">
            Friendly Name
          </div>
          {mgr.isEditingName ? (
            <div className="flex items-center space-x-1">
              <input
                ref={mgr.nameInputRef}
                type="text"
                value={mgr.editName}
                onChange={(e) => mgr.setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") mgr.confirmRename();
                  if (e.key === "Escape") mgr.cancelRename();
                }}
                className="sor-form-input-xs flex-1"
              />
              <button
                onClick={mgr.confirmRename}
                className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <Check size={12} />
              </button>
              <button
                onClick={mgr.cancelRename}
                className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-textSecondary)]">
                {p.connectionName}
              </span>
              <button
                onClick={mgr.startEditing}
                className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                title="Edit name"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}
        </div>
        <div className="px-3 py-2 border-b border-[var(--color-border)] space-y-1">
          <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-1">
            Host
          </div>
          <div className="text-xs text-[var(--color-textSecondary)]">
            {p.sessionHostname}
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)]">
            Status:{" "}
            <span className="capitalize">{p.connectionStatus}</span>
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)]">
            Resolution: {p.desktopSize.width}x{p.desktopSize.height} ·{" "}
            {p.colorDepth}-bit
          </div>
        </div>
        <div className="px-3 py-2 space-y-1">
          <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-1">
            Certificate
          </div>
          <div className="flex items-start space-x-2">
            <Fingerprint
              size={12}
              className="text-[var(--color-textSecondary)] flex-shrink-0 mt-0.5"
            />
            <div className="text-[10px] text-[var(--color-textSecondary)] min-w-0">
              {p.certFingerprint ? (
                <span className="font-mono break-all">
                  {p.certFingerprint}
                </span>
              ) : (
                <span className="italic">No certificate available</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </PopoverSurface>
  </div>
);

export default HostInfoPopover;
