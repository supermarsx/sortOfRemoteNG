import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, RotateCcw, Trash2, Plus, RefreshCw } from "lucide-react";
import type { SubProps } from "./types";

const SnapshotsView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const node = mgr.selectedNode;
  const vmid = mgr.selectedVmid;
  const vmType = mgr.selectedVmType;
  const [newSnapName, setNewSnapName] = useState("");
  const [newSnapDesc, setNewSnapDesc] = useState("");
  const [includeRam, setIncludeRam] = useState(false);

  if (!node || !vmid || !vmType) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        {t("proxmox.snapshots.selectVm", "Select a VM or container to manage snapshots")}
      </div>
    );
  }

  const handleCreate = async () => {
    if (!newSnapName.trim()) return;
    await mgr.createSnapshot(node, vmid, vmType, {
      snapname: newSnapName.trim(),
      description: newSnapDesc || undefined,
      vmstate: vmType === "qemu" ? includeRam : undefined,
    });
    setNewSnapName("");
    setNewSnapDesc("");
  };

  return (
    <div className="p-6 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Camera className="w-4 h-4 text-indigo-500" />
          {t("proxmox.snapshots.title", "Snapshots")}
          <span className="text-xs font-normal text-[var(--color-text-secondary)]">
            {vmType.toUpperCase()} {vmid}
          </span>
        </h3>
        <button
          onClick={() => mgr.refreshSnapshots(node, vmid, vmType)}
          className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${mgr.refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Create snapshot form */}
      <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <h4 className="text-xs font-semibold text-[var(--color-text)] mb-3">
          {t("proxmox.snapshots.create", "Create Snapshot")}
        </h4>
        <div className="flex flex-col gap-2">
          <input
            className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            placeholder={t("proxmox.snapshots.namePlaceholder", "Snapshot name")}
            value={newSnapName}
            onChange={(e) => setNewSnapName(e.target.value)}
          />
          <input
            className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            placeholder={t("proxmox.snapshots.descPlaceholder", "Description (optional)")}
            value={newSnapDesc}
            onChange={(e) => setNewSnapDesc(e.target.value)}
          />
          {vmType === "qemu" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRam}
                onChange={(e) => setIncludeRam(e.target.checked)}
                className="w-4 h-4 rounded border-[var(--color-border)] text-indigo-500"
              />
              <span className="text-xs text-[var(--color-text-secondary)]">
                {t("proxmox.snapshots.includeRam", "Include RAM state")}
              </span>
            </label>
          )}
          <button
            onClick={handleCreate}
            disabled={!newSnapName.trim() || mgr.loading}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("proxmox.snapshots.createBtn", "Create Snapshot")}
          </button>
        </div>
      </div>

      {/* Snapshot list */}
      {mgr.snapshots.length === 0 ? (
        <div className="text-center py-12 text-sm text-[var(--color-text-secondary)]">
          <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {t("proxmox.snapshots.noSnapshots", "No snapshots found")}
        </div>
      ) : (
        <div className="space-y-2">
          {mgr.snapshots
            .filter((s) => s.name !== "current")
            .map((snap) => (
              <div
                key={snap.name}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
              >
                <Camera className="w-4 h-4 text-indigo-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">{snap.name}</div>
                  {snap.description && (
                    <div className="text-[10px] text-[var(--color-text-secondary)]">{snap.description}</div>
                  )}
                  {snap.snaptime != null && (
                    <div className="text-[10px] text-[var(--color-text-secondary)]">
                      {new Date(snap.snaptime * 1000).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() =>
                      mgr.requestConfirm(
                        t("proxmox.snapshots.rollbackTitle", "Rollback Snapshot"),
                        t("proxmox.snapshots.rollbackMsg", `Rollback to snapshot "${snap.name}"? Current state will be lost.`),
                        () => mgr.rollbackSnapshot(node, vmid, vmType, snap.name),
                      )
                    }
                    className="p-1.5 rounded-lg border border-[var(--color-border)] text-yellow-500 hover:bg-yellow-500/10 transition-colors"
                    title={t("proxmox.snapshots.rollback", "Rollback")}
                    disabled={mgr.loading}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      mgr.requestConfirm(
                        t("proxmox.snapshots.deleteTitle", "Delete Snapshot"),
                        t("proxmox.snapshots.deleteMsg", `Delete snapshot "${snap.name}"?`),
                        () => mgr.deleteSnapshot(node, vmid, vmType, snap.name),
                      )
                    }
                    className="p-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                    title={t("proxmox.snapshots.deleteBtn", "Delete")}
                    disabled={mgr.loading}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default SnapshotsView;
