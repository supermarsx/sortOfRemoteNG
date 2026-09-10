import React from "react";
import { useTranslation } from "react-i18next";
import { useSynologyManager } from "../../hooks/synology/useSynologyManager";
import Modal from "../ui/overlays/Modal";
import { useSynologyFileConnection } from "../../hooks/synology/useSynologyFileConnection";
import AdminTools from "./synologyPanel/AdminTools";
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

export function SynologySessionContent({
  connection,
  isActive = true,
}: {
  connection: ReturnType<typeof useSynologyFileConnection>;
  isActive?: boolean;
}) {
  const { t } = useTranslation();
  const mgr = useSynologyManager(isActive, connection);
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
    <div
      className="flex flex-1 min-h-0 min-w-0 flex-col h-full bg-surface text-text"
      data-testid="synology-panel"
    >
      {mgr.connectionStatus !== "connected" ? (
        <ConnectionForm mgr={mgr} />
      ) : (
        <div className="flex flex-1 min-h-0 min-w-0">
          <Sidebar mgr={mgr} />
          <div className="flex flex-1 flex-col min-w-0 min-h-0">
            {mgr.dataError && (
              <div
                role="alert"
                className="flex items-start gap-2 px-4 py-2 bg-error/10 border-b border-error/30 text-error text-xs"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-pre-line">{mgr.dataError}</span>
                <button onClick={mgr.clearDataError} className="ml-auto">
                  {t("common.dismiss", "Dismiss")}
                </button>
              </div>
            )}
            <AdminTools mgr={mgr} />
            {renderContent()}
          </div>
        </div>
      )}
    </div>
  );
}
export const SynologyPanel: React.FC<SynologyPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const connection = useSynologyFileConnection(isOpen);
  if (!isOpen) return null;
  return (
    <Modal
      isOpen={isOpen}
      ariaLabel="Synology NAS Manager"
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-7xl h-[92vh] rounded-xl overflow-hidden border border-border"
      contentClassName="bg-surface flex flex-col min-h-0"
    >
      <SynologyHeader connection={connection} onClose={onClose} />
      <SynologySessionContent connection={connection} isActive={isOpen} />
    </Modal>
  );
};
export default SynologyPanel;
