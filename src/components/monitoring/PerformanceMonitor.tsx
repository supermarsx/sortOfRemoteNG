import React from "react";
import { useTranslation } from "react-i18next";
import { usePerformanceMonitor } from "../../hooks/monitoring/usePerformanceMonitor";
import ConfirmDialog from "../ui/dialogs/ConfirmDialog";
import { PerformanceMonitorProps } from "./performanceMonitor/types";
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
      <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
        <SecondaryBar mgr={mgr} />
        <div className="p-6 overflow-y-auto flex-1">
          <CurrentMetricsGrid mgr={mgr} />
          <SummaryStats mgr={mgr} />
          <RecentMetricsTable mgr={mgr} />
        </div>
      </div>

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

