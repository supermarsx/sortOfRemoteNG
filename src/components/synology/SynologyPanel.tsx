import React from "react";
import { useTranslation } from "react-i18next";
import { useSynologyManager } from "../../hooks/synology/useSynologyManager";
import Modal from "../ui/overlays/Modal";
import ConfirmDialog from "../ui/dialogs/ConfirmDialog";
import type { SynologyPanelProps } from "./synologyPanel/types";
import SynologyHeader from "./synologyPanel/SynologyHeader";
import ConnectionForm from "./synologyPanel/ConnectionForm";
import Sidebar from "./synologyPanel/Sidebar";
import DashboardView from "./synologyPanel/DashboardView";
import SystemView from "./synologyPanel/SystemView";
import StorageView from "./synologyPanel/StorageView";
import FileStationView from "./synologyPanel/FileStationView";
import {
  SharesView,
  NetworkView,
  UsersView,
  PackagesView,
  ServicesView,
  DockerView,
  VmsView,
  DownloadsView,
  SurveillanceView,
  BackupView,
  SecurityView,
  HardwareView,
  LogsView,
  NotificationsView,
} from "./synologyPanel/SecondaryViews";
import { AlertCircle } from "lucide-react";

export const SynologyPanel: React.FC<SynologyPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useSynologyManager(isOpen);

  if (!isOpen) return null;

  const renderContent = () => {
    switch (mgr.activeTab) {
      case "dashboard":
        return <DashboardView mgr={mgr} />;
      case "system":
        return <SystemView mgr={mgr} />;
      case "storage":
        return <StorageView mgr={mgr} />;
      case "fileStation":
        return <FileStationView mgr={mgr} />;
      case "shares":
        return <SharesView mgr={mgr} />;
      case "network":
        return <NetworkView mgr={mgr} />;
      case "users":
        return <UsersView mgr={mgr} />;
      case "packages":
        return <PackagesView mgr={mgr} />;
      case "services":
        return <ServicesView mgr={mgr} />;
      case "docker":
        return <DockerView mgr={mgr} />;
      case "vms":
        return <VmsView mgr={mgr} />;
      case "downloads":
        return <DownloadsView mgr={mgr} />;
      case "surveillance":
        return <SurveillanceView mgr={mgr} />;
      case "backup":
        return <BackupView mgr={mgr} />;
      case "security":
        return <SecurityView mgr={mgr} />;
      case "hardware":
        return <HardwareView mgr={mgr} />;
      case "logs":
        return <LogsView mgr={mgr} />;
      case "notifications":
        return <NotificationsView mgr={mgr} />;
      default:
        return <DashboardView mgr={mgr} />;
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
          <SynologyHeader mgr={mgr} onClose={onClose} />

          {mgr.connectionStatus !== "connected" ? (
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
        isOpen={mgr.confirmOpen}
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

export default SynologyPanel;
