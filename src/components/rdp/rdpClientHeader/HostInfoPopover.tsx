import React, { useState, useCallback } from "react";
import { Mgr, RDPClientHeaderProps, btnActive, btnDefault } from "./helpers";
import PopoverSurface from "../../ui/overlays/PopoverSurface";
import { Check, Fingerprint, Info, Pencil, ShieldCheck, ShieldAlert, ShieldOff, Tag, X } from "lucide-react";
import { updateTrustRecordNickname, getAllTrustRecords } from "../../../utils/auth/trustStore";

const CERT_MODES = [
  { value: "validate" as const, label: "Validate", icon: ShieldCheck, color: "var(--color-success)" },
  { value: "warn" as const, label: "Warn", icon: ShieldAlert, color: "var(--color-warning)" },
  { value: "ignore" as const, label: "Ignore", icon: ShieldOff, color: "var(--color-error)" },
];

function getCertModeInfo(mode: string) {
  return CERT_MODES.find((m) => m.value === mode) ?? CERT_MODES[2]; // default "ignore"
}

const HostInfoPopover: React.FC<{
  mgr: Mgr;
  p: RDPClientHeaderProps;
}> = ({ mgr, p }) => {
  const [editingCert, setEditingCert] = useState(false);
  const [editingNick, setEditingNick] = useState(false);
  const host = p.sessionHostname;
  const port = 3389; // RDP default
  const trustKey = `${host}:${port}`;

  // Look up existing nickname from trust store
  const existingRecord = getAllTrustRecords(p.connectionId).find(
    (r) => r.host === trustKey && r.type === "tls"
  );
  const [certNickname, setCertNickname] = useState(existingRecord?.nickname ?? "");
  const [nickDraft, setNickDraft] = useState(certNickname);

  const saveNickname = useCallback(() => {
    updateTrustRecordNickname(host, port, "tls", nickDraft, p.connectionId);
    setCertNickname(nickDraft);
    setEditingNick(false);
  }, [host, port, nickDraft, p.connectionId]);

  const currentMode = p.serverCertValidation ?? "ignore";
  const modeInfo = getCertModeInfo(currentMode);
  const ModeIcon = modeInfo.icon;

  return (
    <div ref={mgr.hostInfoRef} className="relative">
      <button
        onClick={() => mgr.setShowHostInfo(!mgr.showHostInfo)}
        className={mgr.showHostInfo ? btnActive : btnDefault}
        data-tooltip="Host info &amp; certificate"
      >
        <Info size={14} />
      </button>
      <PopoverSurface
        isOpen={mgr.showHostInfo}
        onClose={() => { mgr.setShowHostInfo(false); setEditingCert(false); }}
        anchorRef={mgr.hostInfoRef}
        className="sor-popover-panel w-72 overflow-hidden"
        dataTestId="rdp-host-info-popover"
      >
        <div>
          {/* Friendly Name */}
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
                  data-tooltip="Edit name"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Host */}
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

          {/* Certificate */}
          <div className="px-3 py-2 border-b border-[var(--color-border)] space-y-2">
            <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
              Certificate
            </div>
            {/* Cert friendly name */}
            <div className="flex items-start space-x-2">
              <Tag size={12} className="text-[var(--color-textSecondary)] flex-shrink-0 mt-0.5" />
              {editingNick ? (
                <div className="flex items-center space-x-1 flex-1 min-w-0">
                  <input
                    type="text"
                    value={nickDraft}
                    onChange={(e) => setNickDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveNickname();
                      if (e.key === "Escape") { setNickDraft(certNickname); setEditingNick(false); }
                    }}
                    className="sor-form-input-xs flex-1"
                    placeholder="Certificate nickname"
                    autoFocus
                  />
                  <button onClick={saveNickname} className="p-0.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
                    <Check size={11} />
                  </button>
                  <button onClick={() => { setNickDraft(certNickname); setEditingNick(false); }} className="p-0.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="text-[10px] text-[var(--color-textSecondary)] truncate">
                    {certNickname || <span className="italic">No nickname</span>}
                  </span>
                  <button
                    onClick={() => { setNickDraft(certNickname); setEditingNick(true); }}
                    className="p-0.5 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] flex-shrink-0"
                    data-tooltip="Edit certificate nickname"
                  >
                    <Pencil size={10} />
                  </button>
                </div>
              )}
            </div>
            {/* Fingerprint */}
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

          {/* Certificate Validation */}
          <div className="px-3 py-2 space-y-1.5">
            <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider">
              Certificate Validation
            </div>
            {editingCert ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  {CERT_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const isActive = currentMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        onClick={() => {
                          p.onUpdateServerCertValidation(mode.value);
                          setEditingCert(false);
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors"
                        style={{
                          background: isActive
                            ? `color-mix(in srgb, ${mode.color} 18%, transparent)`
                            : "transparent",
                          color: isActive ? mode.color : "var(--color-textMuted)",
                          border: `1px solid ${isActive ? `color-mix(in srgb, ${mode.color} 35%, transparent)` : "var(--color-border)"}`,
                        }}
                        data-tooltip={`${mode.label} server certificate`}
                      >
                        <Icon size={11} />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setEditingCert(false)}
                  className="text-[10px] text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div
                  className="flex items-center gap-1.5 text-[10px] font-medium"
                  style={{ color: modeInfo.color }}
                >
                  <ModeIcon size={12} />
                  {modeInfo.label}
                </div>
                <button
                  onClick={() => setEditingCert(true)}
                  className="p-1 hover:bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                  data-tooltip="Edit certificate validation"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
          </div>
        </div>
      </PopoverSurface>
    </div>
  );
};

export default HostInfoPopover;
