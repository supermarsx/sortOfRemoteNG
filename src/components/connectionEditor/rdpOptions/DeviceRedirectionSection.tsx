import React, { useState } from "react";
import type { SectionBaseProps } from "./types";
import Section from "./Section";
import { HardDrive, Info, Plus, Trash2, FolderOpen, Lock, Power, PowerOff, Pencil, Check } from "lucide-react";
import { RDPConnectionSettings, RdpDriveRedirection } from "../../../types/connection/connection";
import { SettingsManager } from "../../../utils/settings/settingsManager";
import { CSS } from "../../../hooks/rdp/useRDPOptions";
import { Select } from "../../ui/forms";

/** Shared drive mapping list + add-drive UI used by both per-connection and global settings. */
export const DriveMappingEditor: React.FC<{
  drives: RdpDriveRedirection[];
  onChange: (drives: RdpDriveRedirection[]) => void;
  selectClass?: string;
}> = ({ drives, onChange, selectClass = "" }) => {
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");

  const update = (i: number, patch: Partial<RdpDriveRedirection>) =>
    onChange(drives.map((d, idx) => idx === i ? { ...d, ...patch } : d));

  const addDrive = () => {
    if (!newName.trim() || !newPath.trim()) return;
    onChange([...drives, { name: newName.trim(), path: newPath.trim(), readOnly: false, enabled: true }]);
    setNewName("");
    setNewPath("");
  };

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditName(drives[i].name);
    setEditPath(drives[i].path);
  };

  const commitEdit = () => {
    if (editingIdx == null || !editName.trim() || !editPath.trim()) return;
    update(editingIdx, { name: editName.trim(), path: editPath.trim() });
    setEditingIdx(null);
  };

  const newNameRef = React.useRef(newName);
  newNameRef.current = newName;

  const pickFolder = async (target: 'new' | number) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Select drive or folder to share" });
      if (selected && typeof selected === "string") {
        if (target === 'new') {
          setNewPath(selected);
          if (!newNameRef.current.trim()) {
            const parts = selected.replace(/[\\/]+$/, "").split(/[\\/]/);
            setNewName(parts[parts.length - 1] || parts[parts.length - 2] || "Drive");
          }
        } else {
          setEditPath(selected);
        }
      }
    } catch {
      // Not in Tauri environment
    }
  };

  return (
    <>
      {drives.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {drives.map((d, i) => {
            const enabled = d.enabled !== false;
            const isEditing = editingIdx === i;

            return (
              <div key={`${i}-${d.name}`} className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs transition-opacity ${
                enabled ? 'bg-[var(--color-surface)] border-[var(--color-border)]' : 'bg-[var(--color-surface)]/50 border-[var(--color-border)]/50 opacity-50'
              }`}>
                {/* Enable/Disable */}
                <button type="button" onClick={() => update(i, { enabled: !enabled })}
                  className={`p-0.5 rounded transition-colors ${enabled ? 'text-success' : 'text-[var(--color-textMuted)]'}`}
                  data-tooltip={enabled ? 'Enabled (click to disable)' : 'Disabled (click to enable)'}>
                  {enabled ? <Power size={11} /> : <PowerOff size={11} />}
                </button>

                {isEditing ? (
                  <>
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      className={`${selectClass} w-20 text-xs`} />
                    <div className="flex-1 flex items-center gap-1">
                      <input type="text" value={editPath} onChange={(e) => setEditPath(e.target.value)}
                        className={`${selectClass} flex-1 text-xs`} />
                      <button type="button" onClick={() => pickFolder(i)}
                        className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] transition-colors" data-tooltip="Browse...">
                        <FolderOpen size={11} />
                      </button>
                    </div>
                    <button type="button" onClick={commitEdit}
                      className="p-0.5 rounded text-success hover:bg-success/20 transition-colors" data-tooltip="Save">
                      <Check size={11} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-[var(--color-text)] min-w-[50px]">{d.name}</span>
                    <span className="text-[var(--color-textMuted)] truncate flex-1" title={d.path}>{d.path}</span>
                    <button type="button" onClick={() => startEdit(i)}
                      className="p-0.5 rounded text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors" data-tooltip="Edit">
                      <Pencil size={11} />
                    </button>
                  </>
                )}

                {/* Preferred letter */}
                <select
                  value={d.preferredLetter || ""}
                  onChange={(e) => update(i, { preferredLetter: e.target.value || undefined })}
                  className={`${selectClass} w-14 text-[10px] py-0.5 px-1`}
                  data-tooltip="Preferred drive letter on remote (Auto = server assigns)"
                >
                  <option value="">Auto</option>
                  {Array.from({ length: 26 }, (_, j) => String.fromCharCode(65 + j)).map(l => (
                    <option key={l} value={l}>{l}:</option>
                  ))}
                </select>

                {/* Read-only toggle */}
                <button type="button" onClick={() => update(i, { readOnly: !d.readOnly })}
                  className={`p-0.5 rounded transition-colors ${d.readOnly ? 'text-warning' : 'text-[var(--color-textMuted)] opacity-40'}`}
                  data-tooltip={d.readOnly ? 'Read-only (click for read-write)' : 'Read-write (click for read-only)'}>
                  <Lock size={11} />
                </button>

                {/* Remove */}
                <button type="button" onClick={() => { onChange(drives.filter((_, idx) => idx !== i)); if (editingIdx === i) setEditingIdx(null); }}
                  className="p-0.5 rounded text-[var(--color-textMuted)] hover:text-error transition-colors" data-tooltip="Remove">
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new drive */}
      <div className="flex items-center gap-2">
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
          placeholder="Name" className={`${selectClass} w-20 text-xs`} />
        <div className="flex-1 flex items-center gap-1">
          <input type="text" value={newPath} onChange={(e) => setNewPath(e.target.value)}
            placeholder="Drive or folder path (e.g. C:\ or D:\Shared)" className={`${selectClass} flex-1 text-xs`} />
          <button type="button" onClick={() => pickFolder('new')}
            className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] transition-colors" data-tooltip="Browse...">
            <FolderOpen size={13} />
          </button>
        </div>
        <button type="button" onClick={addDrive} disabled={!newName.trim() || !newPath.trim()}
          className="p-1 rounded hover:bg-[var(--color-input)] text-primary disabled:opacity-30 transition-colors" data-tooltip="Add drive">
          <Plus size={13} />
        </button>
      </div>
    </>
  );
};

const DeviceRedirectionSection: React.FC<SectionBaseProps> = ({
  rdp,
  updateRdp,
}) => {
  const settings = SettingsManager.getInstance().getSettings();
  const globalDrives: RdpDriveRedirection[] = (settings.rdpDefaults?.driveRedirections as RdpDriveRedirection[] | undefined) ?? [];
  const localDrives: RdpDriveRedirection[] = rdp.deviceRedirection?.drives ?? [];
  const inheritGlobal = rdp.deviceRedirection?.inheritGlobalDrives !== false;
  const excludedGlobals: Set<string> = new Set(rdp.deviceRedirection?.excludedGlobalDrives ?? []);
  const devices: { key: keyof NonNullable<RDPConnectionSettings["deviceRedirection"]>; label: string; defaultVal: boolean; tooltip: string }[] = [
    { key: "clipboard", label: "Clipboard", defaultVal: true, tooltip: "Share clipboard between local and remote desktops for copy/paste." },
    { key: "printers", label: "Printers", defaultVal: false, tooltip: "Redirect local printers so they appear in the remote session." },
    { key: "ports", label: "Serial / COM Ports", defaultVal: false, tooltip: "Redirect serial/COM ports to the remote session for hardware devices." },
    { key: "smartCards", label: "Smart Cards", defaultVal: false, tooltip: "Redirect smart card readers for remote authentication or signing." },
    { key: "webAuthn", label: "WebAuthn / FIDO Devices", defaultVal: false, tooltip: "Redirect FIDO/WebAuthn security keys for passwordless authentication in the remote session." },
    { key: "videoCapture", label: "Video Capture (Cameras)", defaultVal: false, tooltip: "Redirect local webcams to the remote session for video calls." },
    { key: "audioInput", label: "Audio Input (Microphone)", defaultVal: false, tooltip: "Redirect microphone input to the remote session for voice calls and recording." },
    { key: "usbDevices", label: "USB Devices", defaultVal: false, tooltip: "Redirect USB devices to the remote session. May require additional drivers on the server." },
    { key: "driveRedirection", label: "Drive Redirection", defaultVal: false, tooltip: "Share local drives and folders with the remote session as mapped network drives." },
    { key: "fileDragDrop", label: "File Drag & Drop", defaultVal: true, tooltip: "Allow dragging files and folders onto the RDP session to transfer them via clipboard." },
  ];

  return (
    <Section
      title="Local Resources"
      icon={<HardDrive size={14} className="text-primary" />}
    >
      {devices.map((d) => {
        const raw = rdp.deviceRedirection?.[d.key] as boolean | undefined;
        return (
        <div key={d.key}>
          <label className="block text-xs text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">{d.label} <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip={d.tooltip} /></label>
          <Select value={raw === undefined ? "" : raw ? "true" : "false"} onChange={(v: string) => updateRdp("deviceRedirection", { [d.key]: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "Use global default" }, { value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} className={CSS.select} />
        </div>
        );
      })}

      {/* Virtual Drive Mappings */}
      <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
        <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-2 flex items-center gap-1">
          <FolderOpen size={12} className="text-primary" />
          Virtual Drive Mappings
          <Info size={12} className="text-[var(--color-textMuted)] cursor-help" data-tooltip="Map local drives or folders as network drives visible in the remote session. Inherited global mappings can be individually disabled." />
        </label>

        {/* Global drive inheritance */}
        {globalDrives.length > 0 && (
          <div className="mb-3">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] cursor-pointer select-none mb-2">
              <input
                type="checkbox"
                checked={inheritGlobal}
                onChange={(e) => updateRdp("deviceRedirection", { inheritGlobalDrives: e.target.checked ? undefined : false } as any)}
                className="accent-primary"
              />
              Inherit global drive mappings
            </label>

            {inheritGlobal && (
              <div className="ml-5 space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)] mb-1">Global Drives</div>
                {globalDrives.map((gd) => {
                  const key = `${gd.name}:${gd.path}`;
                  const excluded = excludedGlobals.has(key);
                  const globalDisabled = gd.enabled === false;
                  return (
                    <label key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer select-none transition-opacity ${
                      excluded || globalDisabled
                        ? 'bg-[var(--color-surface)]/50 border-[var(--color-border)]/50 opacity-50'
                        : 'bg-[var(--color-surface)] border-[var(--color-border)] border-dashed'
                    }`}>
                      <input
                        type="checkbox"
                        checked={!excluded}
                        disabled={globalDisabled}
                        onChange={() => {
                          const next = new Set(excludedGlobals);
                          if (excluded) next.delete(key); else next.add(key);
                          updateRdp("deviceRedirection", { excludedGlobalDrives: [...next] } as any);
                        }}
                        className="accent-primary"
                      />
                      <span className="font-medium text-[var(--color-text)] min-w-[50px]">{gd.name}</span>
                      <span className="text-[var(--color-textMuted)] truncate flex-1" title={gd.path}>{gd.path}</span>
                      {gd.preferredLetter && <span className="text-[9px] text-primary font-mono flex-shrink-0">{gd.preferredLetter}:</span>}
                      {gd.readOnly && <Lock size={11} className="text-warning flex-shrink-0" data-tooltip="Read-only" />}
                      {globalDisabled && <span className="text-[9px] text-error italic flex-shrink-0">disabled globally</span>}
                      <span className="text-[9px] text-[var(--color-textMuted)] italic flex-shrink-0">global</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Per-connection drives */}
        {(localDrives.length > 0 || globalDrives.length > 0) && localDrives.length > 0 && (
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)] mb-1">
            Connection-specific drives
          </div>
        )}
        <DriveMappingEditor
          drives={localDrives}
          onChange={(updated) => {
            const patch: Record<string, unknown> = { drives: updated };
            // Auto-enable drive redirection when drives are added
            if (updated.length > 0 && rdp.deviceRedirection?.driveRedirection !== true) {
              patch.driveRedirection = true;
            }
            updateRdp("deviceRedirection", patch as any);
          }}
          selectClass={CSS.select}
        />
      </div>
    </Section>
  );
};

export default DeviceRedirectionSection;
