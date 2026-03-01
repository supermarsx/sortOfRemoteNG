import React from "react";
import { useTranslation } from "react-i18next";
import { usePerformanceMonitor } from "../../hooks/monitoring/usePerformanceMonitor";
import Modal from "../ui/overlays/Modal";
import ConfirmDialog from "../shared/ConfirmDialog";
import { PerformanceMonitorProps } from "./performanceMonitor/types";
import MonitorHeader from "./performanceMonitor/MonitorHeader";
import SecondaryBar from "./performanceMonitor/SecondaryBar";
import CurrentMetricsGrid from "./performanceMonitor/CurrentMetricsGrid";
import SummaryStats from "./performanceMonitor/SummaryStats";
import RecentMetricsTable from "./performanceMonitor/RecentMetricsTable";

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = usePerformanceMonitor(isOpen);

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdropClassName="bg-black/50"
        panelClassName="max-w-6xl h-[90vh] rounded-xl overflow-hidden border border-[var(--color-border)]"
        contentClassName="bg-[var(--color-surface)]"
      >
        <div className="flex flex-1 min-h-0 flex-col">
          <MonitorHeader mgr={mgr} onClose={onClose} />
          <SecondaryBar mgr={mgr} />
          <div className="p-6 overflow-y-auto flex-1">
            <CurrentMetricsGrid mgr={mgr} />
            <SummaryStats mgr={mgr} />
            <RecentMetricsTable mgr={mgr} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={mgr.showClearConfirm}
        onCancel={() => mgr.setShowClearConfirm(false)}
        onConfirm={mgr.clearMetrics}
        title={t("performance.clearTitle", "Clear Metrics")}
        message={t(
          "performance.clearConfirm",
          "Are you sure you want to clear all performance metrics? This action cannot be undone.",
        )}
        confirmText={t("common.clear", "Clear")}
        cancelText={t("common.cancel", "Cancel")}
        variant="danger"
      />
    </>
  );
};

