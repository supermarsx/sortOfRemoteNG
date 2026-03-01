import React from "react";
import { X, RefreshCw, Loader2, Stethoscope, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Connection } from "../../types/connection";
import { Modal } from "../ui/overlays/Modal";
import { useConnectionDiagnostics } from "../../hooks/connection/useConnectionDiagnostics";
import Props from "./diagnostics/Props";
import StatusIcon from "./diagnostics/StatusIcon";
import NetworkChecksSection from "./diagnostics/NetworkChecksSection";
import DnsIpSection from "./diagnostics/DnsIpSection";
import PingResultsSection from "./diagnostics/PingResultsSection";
import PingGraph from "./diagnostics/PingGraph";
import PingStatsGrid from "./diagnostics/PingStatsGrid";
import PortCheckSection from "./diagnostics/PortCheckSection";
import TracerouteSection from "./diagnostics/TracerouteSection";
import AdvancedDiagnosticsSection from "./diagnostics/AdvancedDiagnosticsSection";
import TcpTimingCard from "./diagnostics/TcpTimingCard";
import IcmpStatusCard from "./diagnostics/IcmpStatusCard";
import ServiceFingerprintCard from "./diagnostics/ServiceFingerprintCard";
import MtuCheckCard from "./diagnostics/MtuCheckCard";
import TlsCheckCard from "./diagnostics/TlsCheckCard";
import ExtendedDiagnosticsCards from "./diagnostics/ExtendedDiagnosticsCards";
import ProtocolDeepDiagSection from "./diagnostics/ProtocolDeepDiagSection";

export const ConnectionDiagnostics: React.FC<ConnectionDiagnosticsProps> = ({
  connection,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useConnectionDiagnostics(connection);

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdropClassName="bg-black/50 backdrop-blur-sm"
      panelClassName="relative max-w-3xl rounded-xl overflow-hidden border border-[var(--color-border)]"
      contentClassName="relative bg-[var(--color-surface)]"
    >
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Stethoscope size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t(
                  "diagnostics.title",
                  "Connection Diagnostics",
                )}
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {connection.name} (<span>{connection.hostname}</span>)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mgr.isRunning && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-lg text-xs">
                <Loader2 size={12} className="animate-spin" />
                {mgr.currentStep}
              </div>
            )}
            <button
              onClick={mgr.copyDiagnosticsToClipboard}
              className="p-2 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
              title={t("diagnostics.copyAll", "Copy diagnostics")}
            >
              <Copy size={16} />
            </button>
            <button
              onClick={mgr.runDiagnostics}
              disabled={mgr.isRunning}
              className="p-2 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors disabled:opacity-30"
              title={t("diagnostics.rerun", "Run Again")}
            >
              <RefreshCw
                size={16}
                className={mgr.isRunning ? "animate-spin" : ""}
              />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
              title={t("common.close", "Close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <NetworkChecksSection mgr={mgr} />
          <DnsIpSection mgr={mgr} />
          <PingResultsSection mgr={mgr} />
          <PortCheckSection mgr={mgr} connection={connection} />
          <TracerouteSection mgr={mgr} />
          <AdvancedDiagnosticsSection mgr={mgr} />
          <ProtocolDeepDiagSection mgr={mgr} connection={connection} />
        </div>
      </div>
    </Modal>
  );
};
