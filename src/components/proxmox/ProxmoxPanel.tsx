import React from "react";
import { useTranslation } from "react-i18next";
import { useProxmoxManager } from "../../hooks/proxmox/useProxmoxManager";
import Modal from "../ui/overlays/Modal";
import ConfirmDialog from "../ui/dialogs/ConfirmDialog";
import type { ProxmoxPanelProps } from "./proxmoxPanel/types";
import ProxmoxHeader from "./proxmoxPanel/ProxmoxHeader";
import ConnectionForm from "./proxmoxPanel/ConnectionForm";
import Sidebar from "./proxmoxPanel/Sidebar";
import DashboardView from "./proxmoxPanel/DashboardView";
import NodesView from "./proxmoxPanel/NodesView";
import QemuView from "./proxmoxPanel/QemuView";
import LxcView from "./proxmoxPanel/LxcView";
import StorageView from "./proxmoxPanel/StorageView";
import NetworkView from "./proxmoxPanel/NetworkView";
import TasksView from "./proxmoxPanel/TasksView";
import SnapshotsView from "./proxmoxPanel/SnapshotsView";
import {
  BackupsView,
  FirewallView,
  PoolsView,
  HaView,
  CephView,
  ConsoleView,
} from "./proxmoxPanel/SecondaryViews";
import { AlertCircle } from "lucide-react";

export const ProxmoxPanel: React.FC<ProxmoxPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useProxmoxManager(isOpen);

  if (!isOpen) return null;

  const renderContent = () => {
    switch (mgr.activeTab) {
      case "dashboard": return <DashboardView mgr={mgr} />;
      case "nodes": return <NodesView mgr={mgr} />;
      case "qemu": return <QemuView mgr={mgr} />;
      case "lxc": return <LxcView mgr={mgr} />;
      case "storage": return <StorageView mgr={mgr} />;
      case "network": return <NetworkView mgr={mgr} />;
      case "tasks": return <TasksView mgr={mgr} />;
      case "backups": return <BackupsView mgr={mgr} />;
      case "firewall": return <FirewallView mgr={mgr} />;
      case "pools": return <PoolsView mgr={mgr} />;
      case "ha": return <HaView mgr={mgr} />;
      case "ceph": return <CephView mgr={mgr} />;
      case "snapshots": return <SnapshotsView mgr={mgr} />;
      case "console": return <ConsoleView mgr={mgr} />;
      default: return <DashboardView mgr={mgr} />;
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdropClassName="bg-black/50"
        panelClassName="max-w-7xl h-[92vh] rounded-xl overflow-hidden border border-[var(--color-border)]"
        contentClassName="bg-[var(--color-surface)]"
      >
        <div className="flex flex-1 min-h-0 flex-col h-full">
          <ProxmoxHeader mgr={mgr} onClose={onClose} />

          {mgr.connectionState !== "connected" ? (
            <ConnectionForm mgr={mgr} />
          ) : (
            <div className="flex flex-1 min-h-0">
              <Sidebar mgr={mgr} />
              <div className="flex flex-1 flex-col min-w-0">
                {/* Error bar */}
                {mgr.dataError && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{mgr.dataError}</span>
                    <button
                      onClick={() => {
                        /* error is auto-cleared on next action */
                      }}
                      className="ml-auto text-red-400/60 hover:text-red-400 text-[10px]"
                    >
                      {t("common.dismiss", "Dismiss")}
                    </button>
                  </div>
                )}
                {renderContent()}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm dialog */}
      <ConfirmDialog
        isOpen={mgr.showConfirmAction}
        onCancel={mgr.cancelConfirm}
        onConfirm={mgr.executeConfirm}
        title={mgr.confirmTitle}
        message={mgr.confirmMessage}
        confirmText={t("common.confirm", "Confirm")}
        cancelText={t("common.cancel", "Cancel")}
        variant="danger"
      />
    </>
  );
};

export default ProxmoxPanel;
