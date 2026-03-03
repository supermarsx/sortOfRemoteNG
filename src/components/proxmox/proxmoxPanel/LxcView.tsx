import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Container,
  Play,
  Square,
  Power,
  RotateCcw,
  Copy,
  ArrowRightLeft,
  Trash2,
  Terminal,
  Camera,
  Cpu,
  MemoryStick,
  HardDrive,
  MoreHorizontal,
} from "lucide-react";
import type { SubProps } from "./types";

const LxcView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [expandedCt, setExpandedCt] = useState<number | null>(null);
  const node = mgr.selectedNode;

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        {t("proxmox.selectNode", "Select a node first")}
      </div>
    );
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "bg-green-500";
      case "stopped": return "bg-gray-500";
      default: return "bg-gray-400";
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return "—";
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  return (
    <div className="p-6 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Container className="w-4 h-4 text-green-500" />
          {t("proxmox.lxc.title", "LXC Containers")}
          <span className="text-xs font-normal text-[var(--color-text-secondary)]">
            ({mgr.filteredContainers.length})
          </span>
        </h3>
        <button
          onClick={() => {
            // TODO: create container dialog
          }}
          className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
        >
          + {t("proxmox.lxc.create", "Create Container")}
        </button>
      </div>

      {mgr.filteredContainers.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          <Container className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {t("proxmox.lxc.noCts", "No containers found on this node")}
        </div>
      ) : (
        <div className="space-y-2">
          {mgr.filteredContainers.map((ct) => (
            <div
              key={ct.vmid}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-hidden"
            >
              <button
                onClick={() => {
                  const next = expandedCt === ct.vmid ? null : ct.vmid;
                  setExpandedCt(next);
                  if (next) mgr.selectVm(ct.vmid, "lxc");
                }}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${statusColor(ct.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {ct.name || `CT ${ct.vmid}`}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-secondary)]">
                    CTID {ct.vmid} — {ct.status}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-[var(--color-text-secondary)]">
                  {ct.cpus != null && (
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {ct.cpus} vCPU
                    </span>
                  )}
                  {ct.maxmem != null && (
                    <span className="flex items-center gap-1">
                      <MemoryStick className="w-3 h-3" />
                      {formatBytes(ct.maxmem)}
                    </span>
                  )}
                  {ct.maxdisk != null && (
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3 h-3" />
                      {formatBytes(ct.maxdisk)}
                    </span>
                  )}
                </div>
                <MoreHorizontal className="w-4 h-4 text-[var(--color-text-secondary)]" />
              </button>

              {expandedCt === ct.vmid && (
                <div className="border-t border-[var(--color-border)] p-3 flex flex-wrap gap-2">
                  {ct.status !== "running" && (
                    <ActionBtn
                      icon={Play}
                      label={t("proxmox.lxc.start", "Start")}
                      color="text-green-500"
                      onClick={() => mgr.lxcAction(node, ct.vmid, "start")}
                      disabled={mgr.loading}
                    />
                  )}
                  {ct.status === "running" && (
                    <>
                      <ActionBtn
                        icon={Power}
                        label={t("proxmox.lxc.shutdown", "Shutdown")}
                        color="text-yellow-500"
                        onClick={() => mgr.requestConfirm(
                          t("proxmox.lxc.shutdownTitle", "Shutdown Container"),
                          t("proxmox.lxc.shutdownMsg", `Gracefully shutdown container ${ct.vmid}?`),
                          () => mgr.lxcAction(node, ct.vmid, "shutdown"),
                        )}
                        disabled={mgr.loading}
                      />
                      <ActionBtn
                        icon={Square}
                        label={t("proxmox.lxc.stop", "Stop")}
                        color="text-red-500"
                        onClick={() => mgr.requestConfirm(
                          t("proxmox.lxc.stopTitle", "Stop Container"),
                          t("proxmox.lxc.stopMsg", `Force stop container ${ct.vmid}?`),
                          () => mgr.lxcAction(node, ct.vmid, "stop"),
                        )}
                        disabled={mgr.loading}
                      />
                      <ActionBtn
                        icon={RotateCcw}
                        label={t("proxmox.lxc.reboot", "Reboot")}
                        color="text-blue-500"
                        onClick={() => mgr.lxcAction(node, ct.vmid, "reboot")}
                        disabled={mgr.loading}
                      />
                    </>
                  )}
                  <div className="w-px bg-[var(--color-border)] mx-1" />
                  <ActionBtn
                    icon={Terminal}
                    label={t("proxmox.lxc.console", "Console")}
                    color="text-cyan-500"
                    onClick={() => mgr.openVncConsole(node, ct.vmid, "lxc")}
                  />
                  <ActionBtn
                    icon={Camera}
                    label={t("proxmox.lxc.snapshot", "Snapshot")}
                    color="text-indigo-500"
                    onClick={() => {
                      mgr.selectVm(ct.vmid, "lxc");
                      mgr.refreshSnapshots(node, ct.vmid, "lxc");
                      mgr.switchTab("snapshots");
                    }}
                  />
                  <ActionBtn
                    icon={Copy}
                    label={t("proxmox.lxc.clone", "Clone")}
                    color="text-teal-500"
                    onClick={() => {
                      mgr.selectVm(ct.vmid, "lxc");
                      mgr.setShowCloneDialog(true);
                    }}
                  />
                  <ActionBtn
                    icon={ArrowRightLeft}
                    label={t("proxmox.lxc.migrate", "Migrate")}
                    color="text-amber-500"
                    onClick={() => {
                      // TODO: migration dialog
                    }}
                  />
                  <div className="w-px bg-[var(--color-border)] mx-1" />
                  <ActionBtn
                    icon={Trash2}
                    label={t("proxmox.lxc.delete", "Delete")}
                    color="text-red-500"
                    onClick={() => mgr.requestConfirm(
                      t("proxmox.lxc.deleteTitle", "Delete Container"),
                      t("proxmox.lxc.deleteMsg", `Permanently delete container ${ct.vmid}?`),
                      async () => {
                        await mgr.lxcAction(node, ct.vmid, "delete");
                      },
                    )}
                    disabled={mgr.loading}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ActionBtn: React.FC<{
  icon: React.FC<{ className?: string }>;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon: Icon, label, color, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50 ${color}`}
  >
    <Icon className="w-3 h-3" />
    {label}
  </button>
);

export default LxcView;
