import React from "react";
import { Shield, RefreshCw, Download, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal, ModalHeader } from "../../ui/overlays/Modal";
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

export const YubiKeyManager: React.FC<YubiKeyManagerProps> = ({
  isOpen,
  onClose,
  embedded = false,
}) => {
  const { t } = useTranslation();
  const mgr = useYubiKey();
  const ready = mgr.readiness === "ready";
  const deviceTab = ["piv", "fido2", "oath", "otp"].includes(mgr.activeTab);
  const content = (
    <>
      <ModalHeader
        onClose={embedded ? undefined : onClose}
        showCloseButton={!embedded}
        title={
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {t("yubikey.title", "YubiKey Manager")}
          </div>
        }
      />
      <div className="shrink-0 space-y-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-textSecondary)]">
          <span>
            {mgr.devices.length} hardware keys · PIV, FIDO2, OATH and OTP
          </span>
          <span role="status" className="flex items-center gap-2">
            {mgr.loading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            {mgr.readiness === "detecting"
              ? "Detecting YubiKey Manager…"
              : mgr.loading
                ? "Operation in progress…"
                : ready
                  ? "YubiKey Manager ready"
                  : "Hardware detection needs attention"}
          </span>
        </div>
        {mgr.selectedDevice && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <HardDrive className="h-3.5 w-3.5" />
            {t("yubikey.selected", "Selected")}: #{mgr.selectedDevice.serial} ·
            FW {mgr.selectedDevice.firmware_version}
          </div>
        )}
        <div
          role="tablist"
          aria-label="Hardware key applications"
          className="sor-yk-tabs flex gap-1 overflow-x-auto"
        >
          {tabDefs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mgr.activeTab === tab.id}
              onClick={() => mgr.setActiveTab(tab.id as YubiKeyTab)}
              className={`sor-option-chip shrink-0 ${mgr.activeTab === tab.id ? "sor-option-chip-active" : ""}`}
            >
              {tab.icon}
              {t(tab.labelKey, tab.id.toUpperCase())}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <ErrorBanner error={mgr.error} onClear={() => mgr.clearError()} />
        {!ready && mgr.readiness !== "detecting" && (
          <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
            <h3 className="text-sm font-medium">
              Hardware detection needs attention
            </h3>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {mgr.readiness === "unavailable"
                ? "Install the external YubiKey Manager (ykman) tool, or correct its executable path in Configuration if already installed. The app does not install it automatically."
                : "Detection did not complete. Check device access and the selected executable, then retry. Configuration and the audit log remain available."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="sor-btn sor-btn-primary text-xs"
                disabled={mgr.loading}
                onClick={() => void mgr.listDevices()}
              >
                Retry detection
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-secondary text-xs"
                onClick={() => mgr.setActiveTab("config")}
              >
                Open Configuration
              </button>
            </div>
          </div>
        )}
        {mgr.activeTab === "devices" && ready && <DevicesTab mgr={mgr} />}
        {deviceTab && (!ready || !mgr.selectedDevice) && (
          <p className="mb-3 text-sm text-[var(--color-textSecondary)]">
            Select a detected device before using its applications.
          </p>
        )}
        <fieldset
          key={`applications-${mgr.selectedDevice?.serial ?? "no-device"}`}
          disabled={mgr.loading || !ready || !mgr.selectedDevice}
          className="min-w-0"
        >
          {mgr.activeTab === "piv" && <PivTab mgr={mgr} />}
          {mgr.activeTab === "fido2" && <Fido2Tab mgr={mgr} />}
          {mgr.activeTab === "oath" && <OathTab mgr={mgr} />}
          {mgr.activeTab === "otp" && <OtpTab mgr={mgr} />}
        </fieldset>
        {mgr.activeTab === "config" && (
          <ConfigTab
            key={`config-${mgr.selectedDevice?.serial ?? "no-device"}`}
            mgr={mgr}
          />
        )}
        {mgr.activeTab === "audit" && <AuditTab mgr={mgr} />}
      </div>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void mgr.exportDeviceReport(mgr.selectedDevice?.serial)
            }
            disabled={mgr.loading || !ready || !mgr.selectedDevice}
            className="sor-btn sor-btn-secondary text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            {t("yubikey.exportReport", "Export Report")}
          </button>
          <DangerConfirm
            key={mgr.selectedDevice?.serial ?? "no-device"}
            label={t("yubikey.factoryReset", "Factory Reset All")}
            onConfirm={() =>
              void mgr.factoryResetAll(mgr.selectedDevice?.serial)
            }
            disabled={mgr.loading || !ready || !mgr.selectedDevice}
          />
        </div>
        {!embedded && (
          <button
            type="button"
            onClick={onClose}
            className="sor-btn sor-btn-secondary"
          >
            {t("common.close", "Close")}
          </button>
        )}
      </div>
    </>
  );
  if (embedded)
    return (
      <section
        aria-label="Hardware keys"
        className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-surface)] text-[var(--color-text)]"
      >
        {content}
      </section>
    );
  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-4xl">
      {content}
    </Modal>
  );
};
