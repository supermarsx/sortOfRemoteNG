import React, { useId } from "react";
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
import SynologyApiFailure from "./synologyPanel/SynologyApiFailure";
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
  runtimeVerified = false,
}: {
  connection: ReturnType<typeof useSynologyFileConnection>;
  isActive?: boolean;
  runtimeVerified?: boolean;
}) {
  const { t } = useTranslation();
  const mgr = useSynologyManager(isActive, connection);
  const failuresTitle = useId();
  const renderContent = () => {
    switch (mgr.activeTab) {
      case "dashboard":
        return <DashboardView mgr={mgr} />;
      case "system":
        return <SystemView mgr={mgr} />;
      case "storage":
        return <StorageView mgr={mgr} />;
      case "fileStation":
        return <FileStationView mgr={mgr} isActive={isActive} />;
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
        <ConnectionForm
          mgr={mgr}
          runtimeVerified={runtimeVerified}
          isActive={isActive}
        />
      ) : (
        <div className="flex flex-1 min-h-0 min-w-0">
          <Sidebar mgr={mgr} />
          <div className="flex flex-1 flex-col min-w-0 min-h-0">
            {connection.sessionHealth && (
              <div
                role="status"
                className={`border-b border-[var(--color-border)] px-4 py-1.5 text-xs ${connection.sessionHealth.status === "degraded" ? "text-warning" : "text-[var(--color-textSecondary)]"}`}
                title={
                  connection.sessionHealth.lastVerifiedAt
                    ? `Last API verification: ${new Date(connection.sessionHealth.lastVerifiedAt).toLocaleString()}`
                    : undefined
                }
              >
                {connection.sessionHealth.status === "degraded"
                  ? connection.sessionHealth.message
                  : "API session active · Background keep-alive enabled"}
              </div>
            )}
            {mgr.readFailures.length > 0 && (
              <div
                role="alert"
                aria-labelledby={failuresTitle}
                data-testid="synology-read-failures"
                className="max-h-72 overflow-y-auto px-4 py-2 bg-error/10 border-b border-error/30 text-xs"
              >
                <div className="flex items-start gap-2 text-error">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <p id={failuresTitle} className="font-medium">
                    Some data could not be refreshed
                  </p>
                  <button onClick={mgr.clearReadFailures} className="ml-auto">
                    {t("common.dismiss", "Dismiss")}
                  </button>
                </div>
                <ul className="mt-2 space-y-3">
                  {mgr.readFailures.map((failure) => (
                    <li
                      key={failure.field}
                      data-testid={`synology-read-failure-${failure.field}`}
                    >
                      <p className="mb-1 font-medium text-[var(--color-text)]">
                        {failure.label}
                      </p>
                      <SynologyApiFailure
                        error={failure.error}
                        alert={false}
                        signInNote={false}
                      />
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[var(--color-textSecondary)]">
                  Values from these reads were cleared so stale data is not
                  shown. Retry with Refresh.
                </p>
              </div>
            )}
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
      ariaLabel="Synology NAS API"
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
