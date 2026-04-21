import React, { useState } from "react";
import {
  Lock,
  Unlock,
  RefreshCw,
  Settings,
  Usb,
  Nfc,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "../../ui/forms";
import type { Mgr } from "./types";

export const ConfigTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [lockCode, setLockCode] = useState("");

  const cfg = mgr.config;
  if (!cfg) {
    return (
      <div className="sor-yk-config space-y-4">
        <button
          onClick={() => mgr.fetchConfig()}
          disabled={mgr.loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`}
          />
          {t("yubikey.config.load", "Load Configuration")}
        </button>
      </div>
    );
  }

  return (
    <div className="sor-yk-config space-y-6">
      {/* USB Interfaces */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium flex items-center gap-2">
          <Usb className="w-4 h-4" />
          {t("yubikey.config.usbInterfaces", "USB Interfaces")}
        </h3>
        <div className="flex gap-3">
          {["OTP", "FIDO", "CCID"].map((iface) => (
            <label
              key={`usb-${iface}`}
              className="flex items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={cfg.usb_interfaces?.includes(iface) ?? false}
                onChange={(e) => {
                  const usb = cfg.usb_interfaces ?? [];
                  const updated = e.target.checked
                    ? [...usb, iface]
                    : usb.filter((i: string) => i !== iface);
                  mgr.setInterfaces(
                    serial,
                    updated as never,
                    (cfg.nfc_interfaces ?? []) as never,
                  );
                }}
                className="rounded"
              />
              {iface}
            </label>
          ))}
        </div>
      </div>

      {/* NFC Interfaces */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium flex items-center gap-2">
          <Nfc className="w-4 h-4" />
          {t("yubikey.config.nfcInterfaces", "NFC Interfaces")}
        </h3>
        <div className="flex gap-3">
          {["OTP", "FIDO", "CCID"].map((iface) => (
            <label
              key={`nfc-${iface}`}
              className="flex items-center gap-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={cfg.nfc_interfaces?.includes(iface) ?? false}
                onChange={(e) => {
                  const nfc = cfg.nfc_interfaces ?? [];
                  const updated = e.target.checked
                    ? [...nfc, iface]
                    : nfc.filter((i: string) => i !== iface);
                  mgr.setInterfaces(
                    serial,
                    (cfg.usb_interfaces ?? []) as never,
                    updated as never,
                  );
                }}
                className="rounded"
              />
              {iface}
            </label>
          ))}
        </div>
      </div>

      {/* App-level Config */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-medium flex items-center gap-2">
          <Settings className="w-4 h-4" />
          {t("yubikey.config.appConfig", "Application Configuration")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={cfg.auto_detect ?? true}
              onChange={(e) =>
                mgr.updateConfig({ ...cfg, auto_detect: e.target.checked })
              }
              className="rounded"
            />
            {t("yubikey.config.autoDetect", "Auto-detect devices")}
          </label>
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground">
              {t("yubikey.config.pollInterval", "Poll Interval (ms)")}:
            </label>
            <input
              type="number"
              value={cfg.poll_interval ?? 5000}
              onChange={(e) =>
                mgr.updateConfig({
                  ...cfg,
                  poll_interval: Number(e.target.value),
                })
              }
              className="w-20 px-2 py-1 bg-background border border-border rounded"
              min={1000}
              max={60000}
            />
          </div>
          <div className="flex items-center gap-2 col-span-2">
            <label className="text-muted-foreground">
              {t("yubikey.config.ykmanPath", "ykman Path")}:
            </label>
            <input
              type="text"
              value={cfg.ykman_path ?? ""}
              onChange={(e) =>
                mgr.updateConfig({ ...cfg, ykman_path: e.target.value })
              }
              className="flex-1 px-2 py-1 bg-background border border-border rounded font-mono text-xs"
              placeholder="ykman"
            />
          </div>
        </div>
      </div>

      {/* Defaults */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("yubikey.config.pivDefaults", "PIV Defaults")}
          </h4>
          <div className="space-y-1 text-xs">
            <div>
              {t("yubikey.config.algorithm", "Algorithm")}:{" "}
              {cfg.piv_defaults?.algorithm ?? "ECCP256"}
            </div>
            <div>
              {t("yubikey.config.pinPolicy", "PIN Policy")}:{" "}
              {cfg.piv_defaults?.pin_policy ?? "DEFAULT"}
            </div>
            <div>
              {t("yubikey.config.touchPolicy", "Touch Policy")}:{" "}
              {cfg.piv_defaults?.touch_policy ?? "DEFAULT"}
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("yubikey.config.oathDefaults", "OATH Defaults")}
          </h4>
          <div className="space-y-1 text-xs">
            <div>
              {t("yubikey.config.algorithm", "Algorithm")}:{" "}
              {cfg.oath_defaults?.algorithm ?? "SHA1"}
            </div>
            <div>
              {t("yubikey.config.digits", "Digits")}:{" "}
              {cfg.oath_defaults?.digits ?? 6}
            </div>
            <div>
              {t("yubikey.config.period", "Period")}:{" "}
              {cfg.oath_defaults?.period ?? 30}s
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("yubikey.config.fido2Defaults", "FIDO2 Defaults")}
          </h4>
          <div className="space-y-1 text-xs">
            <div>
              UV Preferred: {cfg.fido2_defaults?.uv_preferred ? "Yes" : "No"}
            </div>
            <div>
              Auto Attestation:{" "}
              {cfg.fido2_defaults?.auto_attestation ? "Yes" : "No"}
            </div>
            <div>
              Require Touch: {cfg.fido2_defaults?.require_touch ? "Yes" : "No"}
            </div>
          </div>
        </div>
      </div>

      {/* Lock / Unlock Config */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t("yubikey.config.lockConfig", "Configuration Lock")}
        </h3>
        <div className="flex items-center gap-2">
          <PasswordInput
            value={lockCode}
            onChange={(e) => setLockCode(e.target.value)}
            placeholder={t("yubikey.config.lockCode", "Lock Code")}
            className="flex-1"
          />
          <button
            onClick={() => {
              mgr.lockConfig(serial, lockCode);
              setLockCode("");
            }}
            disabled={!lockCode || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-warning text-[var(--color-text)] rounded hover:bg-warning/90 disabled:opacity-50"
          >
            <Lock className="w-3 h-3" />
            {t("yubikey.config.lock", "Lock")}
          </button>
          <button
            onClick={() => {
              mgr.unlockConfig(serial, lockCode);
              setLockCode("");
            }}
            disabled={!lockCode || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-success text-[var(--color-text)] rounded hover:bg-success/90 disabled:opacity-50"
          >
            <Unlock className="w-3 h-3" />
            {t("yubikey.config.unlock", "Unlock")}
          </button>
        </div>
      </div>
    </div>
  );
};
