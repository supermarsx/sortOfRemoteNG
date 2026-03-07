import React from "react";
import { useTranslation } from "react-i18next";
import { Shield, AlertCircle } from "lucide-react";
import { useOpkssh } from "../../hooks/ssh/useOpkssh";
import Modal from "../ui/overlays/Modal";
import DialogHeader from "../ui/overlays/DialogHeader";
import type { OpksshPanelProps } from "./opkssh/types";
import { OpksshToolbar } from "./opkssh/OpksshToolbar";
import { OverviewTab } from "./opkssh/OverviewTab";
import { LoginTab } from "./opkssh/LoginTab";
import { KeysTab } from "./opkssh/KeysTab";
import { ServerConfigTab } from "./opkssh/ServerConfigTab";
import { ProvidersTab } from "./opkssh/ProvidersTab";
import { AuditTab } from "./opkssh/AuditTab";

export const OpksshPanel: React.FC<OpksshPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useOpkssh(isOpen);

  if (!isOpen) return null;

  const renderTab = () => {
    switch (mgr.activeTab) {
      case "overview":
        return <OverviewTab mgr={mgr} />;
      case "login":
        return <LoginTab mgr={mgr} />;
      case "keys":
        return <KeysTab mgr={mgr} />;
      case "serverConfig":
        return <ServerConfigTab mgr={mgr} />;
      case "providers":
        return <ProvidersTab mgr={mgr} />;
      case "audit":
        return <AuditTab mgr={mgr} />;
      default:
        return <OverviewTab mgr={mgr} />;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-6xl mx-4 h-[90vh]"
      contentClassName="overflow-hidden"
      dataTestId="opkssh-panel-modal"
    >
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[15%] left-[10%] w-96 h-96 bg-success/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[15%] w-80 h-80 bg-success/6 rounded-full blur-3xl" />
        <div className="absolute top-[50%] right-[25%] w-64 h-64 bg-teal-500/5 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <DialogHeader
          icon={Shield}
          iconColor="text-success dark:text-success"
          iconBg="bg-success/20"
          title={t("opkssh.title", "opkssh — OpenPubkey SSH")}
          badge={
            mgr.binaryStatus?.installed
              ? `v${mgr.binaryStatus.version || "?"} · ${mgr.activeKeys.length} ${t("opkssh.keysLabel", "keys")}`
              : undefined
          }
          onClose={onClose}
          sticky
        />

        {/* Toolbar */}
        <OpksshToolbar mgr={mgr} />

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Error banner */}
          {mgr.error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{mgr.error}</span>
            </div>
          )}

          {renderTab()}
        </div>
      </div>
    </Modal>
  );
};
