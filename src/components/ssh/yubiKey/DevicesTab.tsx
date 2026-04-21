import React from "react";
import {
  RefreshCw,
  Lock,
  Usb,
  Nfc,
  Smartphone,
  Clock,
  Timer,
  HardDrive,
  Cpu,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../../ui/display";
import { EmptyState } from "../../ui/display";
import { InterfaceBadge } from "./helpers";
import type { Mgr } from "./types";

export const DevicesTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (mgr.devices.length === 0) {
    return (
      <div className="sor-yk-devices space-y-4">
        <EmptyState
          icon={Usb}
          message={t("yubikey.devices.empty", "Insert a YubiKey")}
          hint={t(
            "yubikey.devices.emptyDesc",
            "No YubiKey devices detected. Insert a YubiKey to get started.",
          )}
        />
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => mgr.listDevices()}
            disabled={mgr.loading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`}
            />
            {t("yubikey.devices.refresh", "Refresh")}
          </button>
          <button
            onClick={() => mgr.waitForDevice(30)}
            disabled={mgr.loading}
            className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 disabled:opacity-50"
          >
            <Clock className="w-4 h-4" />
            {t("yubikey.devices.waitFor", "Wait for Device")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sor-yk-devices space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">
          {t("yubikey.devices.detected", "Detected Devices")} (
          {mgr.devices.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.listDevices()}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`}
            />
            {t("yubikey.devices.refresh", "Refresh")}
          </button>
          <button
            onClick={() => mgr.waitForDevice(30)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <Clock className="w-3 h-3" />
            {t("yubikey.devices.waitFor", "Wait for Device")}
          </button>
        </div>
      </div>

      <div className="grid gap-3">
        {mgr.devices.map((dev) => {
          const isActive = mgr.selectedDevice?.serial === dev.serial;
          return (
            <button
              key={dev.serial}
              onClick={() => mgr.getDeviceInfo(dev.serial)}
              className={`w-full text-left bg-card border rounded-lg p-4 transition-colors ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-primary" />
                  <span className="font-medium text-sm">
                    {t("yubikey.devices.serial", "Serial")}: {dev.serial}
                  </span>
                </div>
                {isActive && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                    {t("yubikey.devices.active", "Active")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <Cpu className="w-3 h-3" />
                {t("yubikey.devices.firmware", "Firmware")}:{" "}
                {dev.firmware_version}
                {dev.form_factor && (
                  <span className="ml-2 flex items-center gap-1">
                    <Smartphone className="w-3 h-3" />
                    {dev.form_factor}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                <span className="text-[10px] text-muted-foreground mr-1">
                  USB:
                </span>
                <InterfaceBadge
                  label="OTP"
                  active={dev.usb_interfaces?.includes("OTP") ?? false}
                />
                <InterfaceBadge
                  label="FIDO"
                  active={dev.usb_interfaces?.includes("FIDO") ?? false}
                />
                <InterfaceBadge
                  label="CCID"
                  active={dev.usb_interfaces?.includes("CCID") ?? false}
                />
                {dev.nfc_interfaces && (
                  <>
                    <span className="text-[10px] text-muted-foreground ml-2 mr-1">
                      NFC:
                    </span>
                    <InterfaceBadge
                      label="OTP"
                      active={dev.nfc_interfaces.includes("OTP")}
                    />
                    <InterfaceBadge
                      label="FIDO"
                      active={dev.nfc_interfaces.includes("FIDO")}
                    />
                    <InterfaceBadge
                      label="CCID"
                      active={dev.nfc_interfaces.includes("CCID")}
                    />
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {dev.is_fips && (
                  <StatusBadge status="success" label={t("yubikey.devices.fips", "FIPS")} />
                )}
                {dev.config_locked && (
                  <span className="flex items-center gap-1 text-warning">
                    <Lock className="w-3 h-3" />
                    {t("yubikey.devices.configLocked", "Config Locked")}
                  </span>
                )}
                {dev.has_nfc && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Nfc className="w-3 h-3" />
                    {t("yubikey.devices.nfc", "NFC")}
                  </span>
                )}
                {dev.auto_eject_timeout != null &&
                  dev.auto_eject_timeout > 0 && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Timer className="w-3 h-3" />
                      {t("yubikey.devices.autoEject", "Auto-eject")}:{" "}
                      {dev.auto_eject_timeout}s
                    </span>
                  )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
