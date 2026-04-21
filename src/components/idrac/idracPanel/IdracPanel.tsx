import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, X } from "lucide-react";
import { useIdracManager } from "../../../hooks/idrac/useIdracManager";
import ConnectionForm from "./ConnectionForm";
import IdracHeader from "./IdracHeader";
import Sidebar from "./Sidebar";
import DashboardView from "./DashboardView";
import SystemView from "./SystemView";
import PowerView from "./PowerView";
import ThermalView from "./ThermalView";
import HardwareView from "./HardwareView";
import StorageView from "./StorageView";
import {
  NetworkView,
  FirmwareView,
  LifecycleView,
  VirtualMediaView,
  ConsoleView,
  EventLogView,
  UsersView,
  BiosView,
  CertificatesView,
  HealthView,
  TelemetryView,
  RacadmView,
} from "./SecondaryViews";

export interface IdracPanelProps {
  connectionId?: string;
  onClose?: () => void;
}

const IdracPanel: React.FC<IdracPanelProps> = ({ connectionId, onClose }) => {
  const { t } = useTranslation();
  const mgr = useIdracManager(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Not connected – show connection form
  if (mgr.connectionState !== "connected") {
    return (
      <div className="flex items-center justify-center h-full w-full bg-[var(--color-bg)]">
        <ConnectionForm mgr={mgr} />
      </div>
    );
  }

  const renderContent = () => {
    switch (mgr.activeTab) {
      case "dashboard":
        return <DashboardView mgr={mgr} />;
      case "system":
        return <SystemView mgr={mgr} />;
      case "power":
        return <PowerView mgr={mgr} />;
      case "thermal":
        return <ThermalView mgr={mgr} />;
      case "hardware":
        return <HardwareView mgr={mgr} />;
      case "storage":
        return <StorageView mgr={mgr} />;
      case "network":
        return <NetworkView mgr={mgr} />;
      case "firmware":
        return <FirmwareView mgr={mgr} />;
      case "lifecycle":
        return <LifecycleView mgr={mgr} />;
      case "virtual-media":
        return <VirtualMediaView mgr={mgr} />;
      case "console":
        return <ConsoleView mgr={mgr} />;
      case "event-log":
        return <EventLogView mgr={mgr} />;
      case "users":
        return <UsersView mgr={mgr} />;
      case "bios":
        return <BiosView mgr={mgr} />;
      case "certificates":
        return <CertificatesView mgr={mgr} />;
      case "health":
        return <HealthView mgr={mgr} />;
      case "telemetry":
        return <TelemetryView mgr={mgr} />;
      case "racadm":
        return <RacadmView mgr={mgr} />;
      default:
        return <DashboardView mgr={mgr} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]" data-testid="idrac-panel">
      <IdracHeader mgr={mgr} onClose={onClose ?? (() => {})} />

      {/* Error Bar */}
      {mgr.dataError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-error/10 border-b border-error/20">
          <AlertCircle className="w-3.5 h-3.5 text-error shrink-0" />
          <p className="text-[10px] text-error flex-1 truncate">{mgr.dataError}</p>
          <button onClick={() => mgr.refresh?.()} className="text-error hover:text-error">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar mgr={mgr} />
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>

      {/* Confirm Dialog */}
      {mgr.showConfirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">{mgr.confirmTitle}</h3>
            <p className="text-xs text-[var(--color-textSecondary)] mb-4">{mgr.confirmMessage}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => mgr.cancelConfirm()}
                className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-bg)]"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                onClick={() => { mgr.executeConfirm(); }}
                className="px-4 py-2 rounded-lg bg-warning hover:bg-warning/90 text-[var(--color-text)] text-xs font-medium transition-colors"
              >
                {t("common.confirm", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IdracPanel;
