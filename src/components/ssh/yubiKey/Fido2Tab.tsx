import React, { useState } from "react";
import {
  Key,
  Lock,
  Unlock,
  RefreshCw,
  Trash2,
  Fingerprint,
  Clock,
  Globe,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, EmptyState } from "../../ui/display";
import { PasswordInput } from "../../ui/forms";
import { DangerConfirm } from "./helpers";
import type { Mgr } from "./types";

export const Fido2Tab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [pinInput, setPinInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");
  const [oldPinInput, setOldPinInput] = useState("");

  return (
    <div className="sor-yk-fido2 space-y-6">
      {/* Device Info */}
      {mgr.fido2Info && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Fingerprint className="w-4 h-4" />
            {t("yubikey.fido2.deviceInfo", "FIDO2 Device Info")}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">
                {t("yubikey.fido2.version", "Version")}:
              </span>{" "}
              {mgr.fido2Info.version}
            </div>
            <div className="font-mono">
              <span className="text-muted-foreground">AAGUID:</span>{" "}
              {mgr.fido2Info.aaguid}
            </div>
            {mgr.fido2Info.max_creds_remaining != null && (
              <div>
                <span className="text-muted-foreground">
                  {t("yubikey.fido2.maxCreds", "Max Creds Remaining")}:
                </span>{" "}
                {mgr.fido2Info.max_creds_remaining}
              </div>
            )}
          </div>
          {mgr.fido2Info.extensions && mgr.fido2Info.extensions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {mgr.fido2Info.extensions.map((ext) => (
                <span
                  key={ext}
                  className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground"
                >
                  {ext}
                </span>
              ))}
            </div>
          )}
          {/* Options */}
          {mgr.fido2Info.options && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(mgr.fido2Info.options).map(([key, val]) => (
                <StatusBadge key={key} status={val ? "success" : "error"} label={key} />
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => mgr.fetchFido2Info(serial)}
        disabled={mgr.loading}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
      >
        <RefreshCw className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`} />
        {t("yubikey.fido2.refreshInfo", "Refresh Info")}
      </button>

      {/* PIN Status */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t("yubikey.fido2.pinStatus", "PIN Status")}
        </h3>
        {mgr.fido2PinStatus ? (
          <div className="flex flex-wrap gap-3 text-xs">
            <StatusBadge
              status={mgr.fido2PinStatus.is_set ? "success" : "error"}
              label={
                mgr.fido2PinStatus.is_set
                  ? t("yubikey.fido2.pinSet", "PIN Set")
                  : t("yubikey.fido2.pinNotSet", "PIN Not Set")
              }
            />
            {mgr.fido2PinStatus.retries != null && (
              <span>
                {t("yubikey.fido2.retries", "Retries")}:{" "}
                {mgr.fido2PinStatus.retries}
              </span>
            )}
            {mgr.fido2PinStatus.force_change && (
              <span className="text-warning flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t("yubikey.fido2.forceChange", "PIN change required")}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={() => mgr.fido2GetPinStatus(serial)}
            disabled={mgr.loading}
            className="text-xs text-primary hover:underline"
          >
            {t("yubikey.fido2.checkPin", "Check PIN status")}
          </button>
        )}

        {/* Set or Change PIN */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {!mgr.fido2PinStatus?.is_set ? (
            <div className="space-y-2">
              <label className="text-xs font-medium">
                {t("yubikey.fido2.setPin", "Set PIN")}
              </label>
              <PasswordInput
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value)}
                placeholder={t("yubikey.fido2.newPin", "New PIN")}
                className="w-full"
              />
              <button
                onClick={() => {
                  mgr.fido2SetPin(serial, newPinInput);
                  setNewPinInput("");
                }}
                disabled={!newPinInput || mgr.loading}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {t("yubikey.fido2.setPin", "Set PIN")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-medium">
                {t("yubikey.fido2.changePin", "Change PIN")}
              </label>
              <PasswordInput
                value={oldPinInput}
                onChange={(e) => setOldPinInput(e.target.value)}
                placeholder={t("yubikey.fido2.currentPin", "Current PIN")}
                className="w-full"
              />
              <PasswordInput
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value)}
                placeholder={t("yubikey.fido2.newPin", "New PIN")}
                className="w-full"
              />
              <button
                onClick={() => {
                  mgr.fido2ChangePin(serial, oldPinInput, newPinInput);
                  setOldPinInput("");
                  setNewPinInput("");
                }}
                disabled={!oldPinInput || !newPinInput || mgr.loading}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {t("yubikey.fido2.changePin", "Change PIN")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Credentials */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Key className="w-4 h-4" />
            {t("yubikey.fido2.credentials", "Credentials")}
          </h3>
          <div className="flex gap-2 items-center">
            <PasswordInput
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder={t("yubikey.fido2.pin", "PIN")}
              className="w-32"
            />
            <button
              onClick={() => mgr.fetchFido2Credentials(serial, pinInput)}
              disabled={!pinInput || mgr.loading}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              {t("yubikey.fido2.list", "List")}
            </button>
          </div>
        </div>

        {mgr.fido2Credentials.length === 0 ? (
          <EmptyState
            icon={Fingerprint}
            message={t("yubikey.fido2.noCreds", "No Credentials")}
            hint={t(
              "yubikey.fido2.noCredsDesc",
              "Enter PIN and click List to view discoverable credentials.",
            )}
          />
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {mgr.fido2Credentials.map((cred) => (
              <div
                key={cred.credential_id}
                className="flex items-center justify-between bg-card border border-border rounded p-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium truncate">{cred.rp_id}</span>
                    {cred.discoverable && (
                      <span className="px-1 py-0.5 bg-success/10 text-success rounded text-[10px]">
                        {t("yubikey.fido2.discoverable", "Discoverable")}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground truncate ml-5">
                    {cred.user_name}
                    {cred.creation_time && (
                      <span className="ml-2">
                        <Clock className="w-3 h-3 inline" />{" "}
                        {cred.creation_time}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() =>
                    mgr.fido2DeleteCredential(
                      serial,
                      cred.credential_id,
                      pinInput,
                    )
                  }
                  disabled={!pinInput || mgr.loading}
                  className="flex-shrink-0 p-1 text-error hover:bg-error/10 rounded disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toggle Always UV */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => mgr.fido2ToggleAlwaysUv(serial, true, pinInput)}
          disabled={!pinInput || mgr.loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
        >
          <ShieldCheck className="w-3 h-3" />
          {t("yubikey.fido2.enableUV", "Enable Always-UV")}
        </button>
        <button
          onClick={() => mgr.fido2ToggleAlwaysUv(serial, false, pinInput)}
          disabled={!pinInput || mgr.loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
        >
          <Unlock className="w-3 h-3" />
          {t("yubikey.fido2.disableUV", "Disable Always-UV")}
        </button>
      </div>

      {/* Danger Zone */}
      <div className="border border-error/20 rounded-lg p-3">
        <h4 className="text-xs text-error font-medium mb-2">
          {t("yubikey.dangerZone", "Danger Zone")}
        </h4>
        <DangerConfirm
          label={t("yubikey.fido2.reset", "Reset FIDO2")}
          onConfirm={() => mgr.fido2Reset(serial)}
          disabled={mgr.loading}
        />
      </div>
    </div>
  );
};
