import React from "react";
import { Shield, RefreshCw, Download, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../../ui/overlays/Modal";
import { ErrorBanner } from "../../ui/display";
import { useYubiKey } from "../../../hooks/ssh/useYubiKey";
import { tabDefs } from "./types";
import type { YubiKeyManagerProps, YubiKeyTab } from "./types";
import { DangerConfirm } from "./helpers";
import { DevicesTab } from "./DevicesTab";
import { PivTab } from "./PivTab";
import { Fido2Tab } from "./Fido2Tab";
import { OathTab } from "./OathTab";
import { OtpTab } from "./OtpTab";
import { ConfigTab } from "./ConfigTab";
import { AuditTab } from "./AuditTab";

const TabBar: React.FC<{
  active: string;
  onChange: (tab: YubiKeyTab) => void;
}> = ({ active, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="sor-yk-tabs flex gap-1 mb-4 border-b border-border pb-2 overflow-x-auto">
      {tabDefs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-sm whitespace-nowrap transition-colors ${
            active === tab.id
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          {tab.icon}
          {t(tab.labelKey, tab.id.toUpperCase())}
        </button>
      ))}
    </div>
  );
};

export const YubiKeyManager: React.FC<YubiKeyManagerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const mgr = useYubiKey();

  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-4xl">
      <ModalHeader
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {t("yubikey.title", "YubiKey Manager")}
          </div>
        }
      />
      <ModalBody>
        <ErrorBanner error={mgr.error} onClear={() => mgr.clearError()} />

        {mgr.loading && (
          <div className="sor-yk-loading absolute inset-0 bg-background/50 z-10 flex items-center justify-center rounded-lg">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {mgr.selectedDevice && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="w-3 h-3" />
            {t("yubikey.selected", "Selected")}:{" "}
            {t("yubikey.devices.serial", "Serial")} #{mgr.selectedDevice.serial}
            {mgr.selectedDevice.firmware_version && (
              <span className="ml-2">
                FW {mgr.selectedDevice.firmware_version}
              </span>
            )}
          </div>
        )}

        <TabBar active={mgr.activeTab} onChange={(tab) => mgr.setActiveTab(tab)} />

        <div className="relative">
          {mgr.activeTab === "devices" && <DevicesTab mgr={mgr} />}
          {mgr.activeTab === "piv" && <PivTab mgr={mgr} />}
          {mgr.activeTab === "fido2" && <Fido2Tab mgr={mgr} />}
          {mgr.activeTab === "oath" && <OathTab mgr={mgr} />}
          {mgr.activeTab === "otp" && <OtpTab mgr={mgr} />}
          {mgr.activeTab === "config" && <ConfigTab mgr={mgr} />}
          {mgr.activeTab === "audit" && <AuditTab mgr={mgr} />}
        </div>
      </ModalBody>
      <ModalFooter>
        <div className="flex justify-between w-full">
          <div className="flex gap-2">
            <button
              onClick={() => mgr.exportDeviceReport(mgr.selectedDevice?.serial)}
              disabled={mgr.loading || !mgr.selectedDevice}
              className="flex items-center gap-1 px-3 py-2 text-xs bg-muted text-foreground rounded-md hover:bg-muted/80 disabled:opacity-50"
            >
              <Download className="w-3 h-3" />
              {t("yubikey.exportReport", "Export Report")}
            </button>
            <DangerConfirm
              label={t("yubikey.factoryReset", "Factory Reset All")}
              onConfirm={() => mgr.factoryResetAll(mgr.selectedDevice?.serial)}
              disabled={mgr.loading || !mgr.selectedDevice}
            />
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};
