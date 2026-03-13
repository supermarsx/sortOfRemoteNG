import React, { useState } from "react";
import {
  Trash2,
  Fingerprint,
  KeyRound,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../../ui/display";
import { PasswordInput, Select } from "../../ui/forms";
import type { Mgr } from "./types";

const OTP_SLOT_NAMES = ["Short Press (Slot 1)", "Long Press (Slot 2)"];

export const OtpTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [configSlot, setConfigSlot] = useState<0 | 1 | null>(null);
  const [configType, setConfigType] = useState<string | null>(null);
  const [yubicoForm, setYubicoForm] = useState({
    publicId: "",
    privateId: "",
    key: "",
  });
  const [chalRespForm, setChalRespForm] = useState({ key: "", touch: false });
  const [staticForm, setStaticForm] = useState({ password: "", layout: "US" });
  const [hotpForm, setHotpForm] = useState({ key: "", digits: 6 });

  const slotId = (idx: number) => (idx === 0 ? "slot1" : "slot2") as never;

  return (
    <div className="sor-yk-otp space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          {t("yubikey.otp.title", "OTP Slots")}
        </h3>
        <button
          onClick={() => mgr.fetchOtpInfo(serial)}
          disabled={mgr.loading}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`}
          />
          {t("yubikey.otp.refresh", "Refresh")}
        </button>
      </div>

      {/* Slot Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {mgr.otpSlots.map((slotCfg, idx) => (
          <div
            key={idx}
            className="bg-card border border-border rounded-lg p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{OTP_SLOT_NAMES[idx]}</span>
              <StatusBadge
                status={slotCfg != null ? "success" : "error"}
                label={
                  slotCfg
                    ? t("yubikey.otp.configured", "Configured")
                    : t("yubikey.otp.empty", "Empty")
                }
              />
            </div>
            {slotCfg && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {slotCfg.slot_type && (
                  <div>
                    {t("yubikey.otp.type", "Type")}: {slotCfg.slot_type}
                  </div>
                )}
                {slotCfg.touch_required && (
                  <span className="flex items-center gap-1 text-warning">
                    <Fingerprint className="w-3 h-3" />{" "}
                    {t("yubikey.otp.touchRequired", "Touch Required")}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => {
                  setConfigSlot(idx as 0 | 1);
                  setConfigType("yubico");
                }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.yubicoOtp", "Yubico OTP")}
              </button>
              <button
                onClick={() => {
                  setConfigSlot(idx as 0 | 1);
                  setConfigType("chalresp");
                }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.chalResp", "Challenge-Response")}
              </button>
              <button
                onClick={() => {
                  setConfigSlot(idx as 0 | 1);
                  setConfigType("static");
                }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.static", "Static")}
              </button>
              <button
                onClick={() => {
                  setConfigSlot(idx as 0 | 1);
                  setConfigType("hotp");
                }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.hotp", "HOTP")}
              </button>
              <button
                onClick={() => mgr.otpDeleteSlot(serial, slotId(idx))}
                disabled={!slotCfg || mgr.loading}
                className="px-2 py-0.5 text-[10px] bg-error/10 text-error rounded hover:bg-error/20 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3 inline" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Swap Slots */}
      <button
        onClick={() => mgr.otpSwapSlots(serial)}
        disabled={mgr.loading}
        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
      >
        <RotateCcw className="w-3 h-3" />
        {t("yubikey.otp.swap", "Swap Slots")}
      </button>

      {/* Configuration Forms */}
      {configSlot != null && configType && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium">
              {t("yubikey.otp.configure", "Configure")}{" "}
              {OTP_SLOT_NAMES[configSlot]} — {configType}
            </h3>
            <button
              onClick={() => {
                setConfigSlot(null);
                setConfigType(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>

          {configType === "yubico" && (
            <div className="space-y-2">
              <input
                value={yubicoForm.publicId}
                onChange={(e) =>
                  setYubicoForm((f) => ({ ...f, publicId: e.target.value }))
                }
                placeholder={t("yubikey.otp.publicId", "Public ID")}
                className="sor-form-input-xs w-full"
              />
              <input
                value={yubicoForm.privateId}
                onChange={(e) =>
                  setYubicoForm((f) => ({ ...f, privateId: e.target.value }))
                }
                placeholder={t("yubikey.otp.privateId", "Private ID")}
                className="sor-form-input-xs w-full"
              />
              <PasswordInput
                value={yubicoForm.key}
                onChange={(e) =>
                  setYubicoForm((f) => ({ ...f, key: e.target.value }))
                }
                placeholder={t("yubikey.otp.secretKey", "Secret Key")}
                className="w-full"
              />
              <button
                onClick={() => {
                  mgr.otpConfigureYubico(
                    serial,
                    slotId(configSlot),
                    yubicoForm.publicId,
                    yubicoForm.privateId,
                    yubicoForm.key,
                  );
                  setConfigSlot(null);
                  setConfigType(null);
                }}
                disabled={
                  !yubicoForm.publicId || !yubicoForm.key || mgr.loading
                }
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}

          {configType === "chalresp" && (
            <div className="space-y-2">
              <PasswordInput
                value={chalRespForm.key}
                onChange={(e) =>
                  setChalRespForm((f) => ({ ...f, key: e.target.value }))
                }
                placeholder={t("yubikey.otp.key", "Key")}
                className="w-full"
              />
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={chalRespForm.touch}
                  onChange={(e) =>
                    setChalRespForm((f) => ({ ...f, touch: e.target.checked }))
                  }
                  className="rounded"
                />
                {t("yubikey.otp.touchRequired", "Touch Required")}
              </label>
              <button
                onClick={() => {
                  mgr.otpConfigureChalResp(
                    serial,
                    slotId(configSlot),
                    chalRespForm.key,
                    chalRespForm.touch,
                  );
                  setConfigSlot(null);
                  setConfigType(null);
                }}
                disabled={!chalRespForm.key || mgr.loading}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}

          {configType === "static" && (
            <div className="space-y-2">
              <PasswordInput
                value={staticForm.password}
                onChange={(e) =>
                  setStaticForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder={t("yubikey.otp.password", "Password")}
                className="w-full"
              />
              <Select
                value={staticForm.layout}
                onChange={(v) =>
                  setStaticForm((f) => ({ ...f, layout: v }))
                }
                variant="form-sm"
                className="w-full"
                options={[
                  { value: "US", label: "US" },
                  { value: "DE", label: "DE" },
                  { value: "FR", label: "FR" },
                  { value: "SE", label: "SE" },
                ]}
              />
              <button
                onClick={() => {
                  mgr.otpConfigureStatic(
                    serial,
                    slotId(configSlot),
                    staticForm.password,
                    staticForm.layout,
                  );
                  setConfigSlot(null);
                  setConfigType(null);
                }}
                disabled={!staticForm.password || mgr.loading}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}

          {configType === "hotp" && (
            <div className="space-y-2">
              <PasswordInput
                value={hotpForm.key}
                onChange={(e) =>
                  setHotpForm((f) => ({ ...f, key: e.target.value }))
                }
                placeholder={t("yubikey.otp.key", "Key")}
                className="w-full"
              />
              <input
                type="number"
                value={hotpForm.digits}
                onChange={(e) =>
                  setHotpForm((f) => ({ ...f, digits: Number(e.target.value) }))
                }
                min={6}
                max={8}
                className="sor-form-input-xs w-full"
              />
              <button
                onClick={() => {
                  mgr.otpConfigureHotp(
                    serial,
                    slotId(configSlot),
                    hotpForm.key,
                    hotpForm.digits,
                  );
                  setConfigSlot(null);
                  setConfigType(null);
                }}
                disabled={!hotpForm.key || mgr.loading}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
