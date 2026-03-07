import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Monitor,
  Play,
  Square,
  Power,
  RotateCcw,
  Pause,
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

const QemuView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [expandedVm, setExpandedVm] = useState<number | null>(null);
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
      case "running": return "bg-success";
      case "stopped": return "bg-text-secondary";
      case "paused": return "bg-warning";
      default: return "bg-text-muted";
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
          <Monitor className="w-4 h-4 text-primary" />
          {t("proxmox.qemu.title", "QEMU Virtual Machines")}
          <span className="text-xs font-normal text-[var(--color-text-secondary)]">
            ({mgr.filteredVms.length})
          </span>
        </h3>
        <button
          onClick={() => mgr.setShowCreateVm(true)}
          className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-medium transition-colors"
        >
          + {t("proxmox.qemu.create", "Create VM")}
        </button>
      </div>

      {mgr.filteredVms.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {t("proxmox.qemu.noVms", "No virtual machines found on this node")}
        </div>
      ) : (
        <div className="space-y-2">
          {mgr.filteredVms.map((vm) => (
            <div
              key={vm.vmid}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-hidden"
            >
              {/* Row header */}
              <button
                onClick={() => {
                  const next = expandedVm === vm.vmid ? null : vm.vmid;
                  setExpandedVm(next);
                  if (next) mgr.selectVm(vm.vmid, "qemu");
                }}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--color-bg-hover)] transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${statusColor(vm.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {vm.name || `VM ${vm.vmid}`}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-secondary)]">
                    VMID {vm.vmid} — {vm.status}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-[var(--color-text-secondary)]">
                  {vm.cpus != null && (
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {vm.cpus} vCPU
                    </span>
                  )}
                  {vm.maxmem != null && (
                    <span className="flex items-center gap-1">
                      <MemoryStick className="w-3 h-3" />
                      {formatBytes(vm.maxmem)}
                    </span>
                  )}
                  {vm.maxdisk != null && (
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3 h-3" />
                      {formatBytes(vm.maxdisk)}
                    </span>
                  )}
                </div>
                <MoreHorizontal className="w-4 h-4 text-[var(--color-text-secondary)]" />
              </button>

              {/* Expanded actions */}
              {expandedVm === vm.vmid && (
                <div className="border-t border-[var(--color-border)] p-3 flex flex-wrap gap-2">
                  {vm.status !== "running" && (
                    <ActionBtn
                      icon={Play}
                      label={t("proxmox.qemu.start", "Start")}
                      color="text-success"
                      onClick={() => mgr.vmAction(node, vm.vmid, "start")}
                      disabled={mgr.loading}
                    />
                  )}
                  {vm.status === "running" && (
                    <>
                      <ActionBtn
                        icon={Power}
                        label={t("proxmox.qemu.shutdown", "Shutdown")}
                        color="text-warning"
                        onClick={() => mgr.requestConfirm(
                          t("proxmox.qemu.shutdownTitle", "Shutdown VM"),
                          t("proxmox.qemu.shutdownMsg", `Gracefully shutdown VM ${vm.vmid}?`),
                          () => mgr.vmAction(node, vm.vmid, "shutdown"),
                        )}
                        disabled={mgr.loading}
                      />
                      <ActionBtn
                        icon={Square}
                        label={t("proxmox.qemu.stop", "Stop")}
                        color="text-error"
                        onClick={() => mgr.requestConfirm(
                          t("proxmox.qemu.stopTitle", "Stop VM"),
                          t("proxmox.qemu.stopMsg", `Force stop VM ${vm.vmid}? This may cause data loss.`),
                          () => mgr.vmAction(node, vm.vmid, "stop"),
                        )}
                        disabled={mgr.loading}
                      />
                      <ActionBtn
                        icon={RotateCcw}
                        label={t("proxmox.qemu.reboot", "Reboot")}
                        color="text-primary"
                        onClick={() => mgr.vmAction(node, vm.vmid, "reboot")}
                        disabled={mgr.loading}
                      />
                      <ActionBtn
                        icon={Pause}
                        label={t("proxmox.qemu.suspend", "Suspend")}
                        color="text-accent"
                        onClick={() => mgr.vmAction(node, vm.vmid, "suspend")}
                        disabled={mgr.loading}
                      />
                    </>
                  )}
                  {vm.status === "paused" && (
                    <ActionBtn
                      icon={Play}
                      label={t("proxmox.qemu.resume", "Resume")}
                      color="text-success"
                      onClick={() => mgr.vmAction(node, vm.vmid, "resume")}
                      disabled={mgr.loading}
                    />
                  )}
                  <div className="w-px bg-[var(--color-border)] mx-1" />
                  <ActionBtn
                    icon={Terminal}
                    label={t("proxmox.qemu.console", "Console")}
                    color="text-info"
                    onClick={() => mgr.openVncConsole(node, vm.vmid, "qemu")}
                  />
                  <ActionBtn
                    icon={Camera}
                    label={t("proxmox.qemu.snapshot", "Snapshot")}
                    color="text-accent"
                    onClick={() => {
                      mgr.selectVm(vm.vmid, "qemu");
                      mgr.refreshSnapshots(node, vm.vmid, "qemu");
                      mgr.switchTab("snapshots");
                    }}
                  />
                  <ActionBtn
                    icon={Copy}
                    label={t("proxmox.qemu.clone", "Clone")}
                    color="text-teal-500"
                    onClick={() => {
                      mgr.selectVm(vm.vmid, "qemu");
                      mgr.setShowCloneDialog(true);
                    }}
                  />
                  <ActionBtn
                    icon={ArrowRightLeft}
                    label={t("proxmox.qemu.migrate", "Migrate")}
                    color="text-warning"
                    onClick={() => {
                      // TODO: open migration dialog
                    }}
                  />
                  <div className="w-px bg-[var(--color-border)] mx-1" />
                  <ActionBtn
                    icon={Trash2}
                    label={t("proxmox.qemu.delete", "Delete")}
                    color="text-error"
                    onClick={() => mgr.requestConfirm(
                      t("proxmox.qemu.deleteTitle", "Delete VM"),
                      t("proxmox.qemu.deleteMsg", `Permanently delete VM ${vm.vmid} (${vm.name})?`),
                      async () => {
                        await mgr.vmAction(node, vm.vmid, "delete");
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

export default QemuView;
