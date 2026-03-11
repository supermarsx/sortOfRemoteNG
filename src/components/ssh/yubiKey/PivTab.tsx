import React, { useState } from "react";
import {
  Key,
  Lock,
  RefreshCw,
  CreditCard,
  Download,
  AlertTriangle,
  Hash,
  Award,
  Layers,
  FileKey,
  UserCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../../ui/display";
import { PasswordInput } from "../../ui/forms";
import { DangerConfirm } from "./helpers";
import type { Mgr } from "./types";

const PIV_SLOTS: { slot: string; name: string; icon: React.ReactNode }[] = [
  {
    slot: "9a",
    name: "Authentication",
    icon: <UserCheck className="w-4 h-4" />,
  },
  {
    slot: "9c",
    name: "Digital Signature",
    icon: <FileKey className="w-4 h-4" />,
  },
  { slot: "9d", name: "Key Management", icon: <Key className="w-4 h-4" /> },
  {
    slot: "9e",
    name: "Card Authentication",
    icon: <CreditCard className="w-4 h-4" />,
  },
];

export const PivTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [pinForm, setPinForm] = useState({ oldPin: "", newPin: "" });
  const [pukForm, setPukForm] = useState({ oldPuk: "", newPuk: "" });
  const [mgmtForm, setMgmtForm] = useState({ current: "", newKey: "" });
  const [unblockForm, setUnblockForm] = useState({ puk: "", newPin: "" });

  return (
    <div className="sor-yk-piv space-y-6">
      {/* Slot Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Layers className="w-4 h-4" />
            {t("yubikey.piv.slots", "PIV Slots")}
          </h3>
          <button
            onClick={() => mgr.fetchPivCerts(serial)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`}
            />
            {t("yubikey.piv.refresh", "Refresh")}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PIV_SLOTS.map(({ slot, name, icon }) => {
            const info = mgr.pivSlots.find((s) => s.slot === slot);
            return (
              <div
                key={slot}
                className="bg-card border border-border rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-sm font-medium">
                      {slot.toUpperCase()} — {name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge
                      status={info?.has_key ? "success" : "error"}
                      label={t("yubikey.piv.key", "Key")}
                    />
                    <StatusBadge
                      status={info?.has_cert ? "success" : "error"}
                      label={t("yubikey.piv.cert", "Cert")}
                    />
                  </div>
                </div>

                {info?.algorithm && (
                  <div className="text-xs text-muted-foreground">
                    {t("yubikey.piv.algorithm", "Algorithm")}: {info.algorithm}
                  </div>
                )}

                {info?.certificate && (
                  <div className="text-xs space-y-0.5 bg-muted/50 p-2 rounded">
                    <div>
                      <span className="text-muted-foreground">
                        {t("yubikey.piv.subject", "Subject")}:
                      </span>{" "}
                      {info.certificate.subject}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("yubikey.piv.issuer", "Issuer")}:
                      </span>{" "}
                      {info.certificate.issuer}
                    </div>
                    <div className="flex gap-3">
                      <span>
                        <span className="text-muted-foreground">
                          {t("yubikey.piv.notBefore", "From")}:
                        </span>{" "}
                        {info.certificate.not_before}
                      </span>
                      <span>
                        <span className="text-muted-foreground">
                          {t("yubikey.piv.notAfter", "To")}:
                        </span>{" "}
                        {info.certificate.not_after}
                      </span>
                    </div>
                    {info.certificate.fingerprint && (
                      <div className="font-mono text-[10px] truncate text-muted-foreground">
                        {info.certificate.fingerprint}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() =>
                      mgr.pivGenerateKey(
                        serial,
                        slot as never,
                        "ECCP256" as never,
                        "DEFAULT" as never,
                        "DEFAULT" as never,
                      )
                    }
                    disabled={mgr.loading}
                    className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.genKey", "Gen Key")}
                  </button>
                  <button
                    onClick={() =>
                      mgr.pivSelfSignCert(
                        serial,
                        slot as never,
                        "CN=YubiKey",
                        365,
                      )
                    }
                    disabled={mgr.loading}
                    className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.selfSign", "Self-Sign")}
                  </button>
                  <button
                    onClick={() =>
                      mgr.pivGenerateCsr(
                        serial,
                        slot as never,
                        { subject: "CN=YubiKey" } as never,
                      )
                    }
                    disabled={mgr.loading}
                    className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.csr", "CSR")}
                  </button>
                  <button
                    onClick={() => mgr.pivExportCert(serial, slot as never)}
                    disabled={mgr.loading || !info?.has_cert}
                    className="px-2 py-0.5 text-[10px] bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Download className="w-3 h-3 inline mr-0.5" />
                    {t("yubikey.piv.exportCert", "Export")}
                  </button>
                  <button
                    onClick={() => mgr.pivAttest(serial, slot as never)}
                    disabled={mgr.loading || !info?.has_key}
                    className="px-2 py-0.5 text-[10px] bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Award className="w-3 h-3 inline mr-0.5" />
                    {t("yubikey.piv.attest", "Attest")}
                  </button>
                  <button
                    onClick={() => mgr.pivDeleteCert(serial, slot as never)}
                    disabled={mgr.loading || !info?.has_cert}
                    className="px-2 py-0.5 text-[10px] bg-error/10 text-error rounded hover:bg-error/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.delCert", "Del Cert")}
                  </button>
                  <button
                    onClick={() => mgr.pivDeleteKey(serial, slot as never)}
                    disabled={mgr.loading || !info?.has_key}
                    className="px-2 py-0.5 text-[10px] bg-error/10 text-error rounded hover:bg-error/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.delKey", "Del Key")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PIN Management */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t("yubikey.piv.pinMgmt", "PIN Management")}
        </h3>

        {mgr.pivPinStatus && (
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1">
              <Hash className="w-3 h-3" />
              {t("yubikey.piv.pinRetries", "PIN attempts")}:{" "}
              <span
                className={
                  (mgr.pivPinStatus.pin_retries ?? 0) <= 1
                    ? "text-error font-bold"
                    : (mgr.pivPinStatus.pin_retries ?? 0) <= 3
                      ? "text-warning"
                      : "text-success"
                }
              >
                {mgr.pivPinStatus.pin_retries}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Hash className="w-3 h-3" />
              {t("yubikey.piv.pukRetries", "PUK attempts")}:{" "}
              <span
                className={
                  (mgr.pivPinStatus.puk_retries ?? 0) <= 1
                    ? "text-error font-bold"
                    : (mgr.pivPinStatus.puk_retries ?? 0) <= 3
                      ? "text-warning"
                      : "text-success"
                }
              >
                {mgr.pivPinStatus.puk_retries}
              </span>
            </div>
            {mgr.pivPinStatus.default_pin && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="w-3 h-3" />
                {t("yubikey.piv.defaultPin", "Default PIN in use!")}
              </span>
            )}
            {mgr.pivPinStatus.default_puk && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="w-3 h-3" />
                {t("yubikey.piv.defaultPuk", "Default PUK in use!")}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Change PIN */}
          <div className="space-y-2">
            <label className="text-xs font-medium">
              {t("yubikey.piv.changePin", "Change PIN")}
            </label>
            <PasswordInput
              value={pinForm.oldPin}
              onChange={(e) =>
                setPinForm((f) => ({ ...f, oldPin: e.target.value }))
              }
              placeholder={t("yubikey.piv.currentPin", "Current PIN")}
              className="w-full"
            />
            <PasswordInput
              value={pinForm.newPin}
              onChange={(e) =>
                setPinForm((f) => ({ ...f, newPin: e.target.value }))
              }
              placeholder={t("yubikey.piv.newPin", "New PIN")}
              className="w-full"
            />
            <button
              onClick={() => {
                mgr.pivChangePin(serial, pinForm.oldPin, pinForm.newPin);
                setPinForm({ oldPin: "", newPin: "" });
              }}
              disabled={!pinForm.oldPin || !pinForm.newPin || mgr.loading}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {t("yubikey.piv.changePin", "Change PIN")}
            </button>
          </div>

          {/* Change PUK */}
          <div className="space-y-2">
            <label className="text-xs font-medium">
              {t("yubikey.piv.changePuk", "Change PUK")}
            </label>
            <PasswordInput
              value={pukForm.oldPuk}
              onChange={(e) =>
                setPukForm((f) => ({ ...f, oldPuk: e.target.value }))
              }
              placeholder={t("yubikey.piv.currentPuk", "Current PUK")}
              className="w-full"
            />
            <PasswordInput
              value={pukForm.newPuk}
              onChange={(e) =>
                setPukForm((f) => ({ ...f, newPuk: e.target.value }))
              }
              placeholder={t("yubikey.piv.newPuk", "New PUK")}
              className="w-full"
            />
            <button
              onClick={() => {
                mgr.pivChangePuk(serial, pukForm.oldPuk, pukForm.newPuk);
                setPukForm({ oldPuk: "", newPuk: "" });
              }}
              disabled={!pukForm.oldPuk || !pukForm.newPuk || mgr.loading}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {t("yubikey.piv.changePuk", "Change PUK")}
            </button>
          </div>

          {/* Change Management Key */}
          <div className="space-y-2">
            <label className="text-xs font-medium">
              {t("yubikey.piv.changeMgmt", "Change Management Key")}
            </label>
            <PasswordInput
              value={mgmtForm.current}
              onChange={(e) =>
                setMgmtForm((f) => ({ ...f, current: e.target.value }))
              }
              placeholder={t("yubikey.piv.currentMgmt", "Current Key")}
              className="w-full"
            />
            <PasswordInput
              value={mgmtForm.newKey}
              onChange={(e) =>
                setMgmtForm((f) => ({ ...f, newKey: e.target.value }))
              }
              placeholder={t("yubikey.piv.newMgmt", "New Key")}
              className="w-full"
            />
            <button
              onClick={() => {
                mgr.pivChangeMgmtKey(
                  serial,
                  mgmtForm.current,
                  mgmtForm.newKey,
                  "TDES" as never,
                  false,
                );
                setMgmtForm({ current: "", newKey: "" });
              }}
              disabled={!mgmtForm.current || !mgmtForm.newKey || mgr.loading}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {t("yubikey.piv.changeMgmt", "Change Management Key")}
            </button>
          </div>

          {/* Unblock PIN */}
          <div className="space-y-2">
            <label className="text-xs font-medium">
              {t("yubikey.piv.unblockPin", "Unblock PIN")}
            </label>
            <PasswordInput
              value={unblockForm.puk}
              onChange={(e) =>
                setUnblockForm((f) => ({ ...f, puk: e.target.value }))
              }
              placeholder={t("yubikey.piv.puk", "PUK")}
              className="w-full"
            />
            <PasswordInput
              value={unblockForm.newPin}
              onChange={(e) =>
                setUnblockForm((f) => ({ ...f, newPin: e.target.value }))
              }
              placeholder={t("yubikey.piv.newPin", "New PIN")}
              className="w-full"
            />
            <button
              onClick={() => {
                mgr.pivUnblockPin(serial, unblockForm.puk, unblockForm.newPin);
                setUnblockForm({ puk: "", newPin: "" });
              }}
              disabled={!unblockForm.puk || !unblockForm.newPin || mgr.loading}
              className="px-3 py-1.5 text-xs bg-warning text-white rounded hover:bg-warning/90 disabled:opacity-50"
            >
              {t("yubikey.piv.unblockPin", "Unblock PIN")}
            </button>
          </div>
        </div>

        <button
          onClick={() => mgr.pivGetPinStatus(serial)}
          disabled={mgr.loading}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80"
        >
          <RefreshCw className="w-3 h-3" />
          {t("yubikey.piv.refreshPinStatus", "Refresh Status")}
        </button>
      </div>

      {/* Danger Zone */}
      <div className="border border-error/20 rounded-lg p-3">
        <h4 className="text-xs text-error font-medium mb-2">
          {t("yubikey.dangerZone", "Danger Zone")}
        </h4>
        <DangerConfirm
          label={t("yubikey.piv.reset", "Reset PIV Applet")}
          onConfirm={() => mgr.pivReset(serial)}
          disabled={mgr.loading}
        />
      </div>
    </div>
  );
};
