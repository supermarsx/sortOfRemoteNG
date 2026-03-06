import React, { useState } from "react";
import {
  Shield,
  Key,
  Lock,
  Unlock,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  CreditCard,
  Fingerprint,
  Clock,
  Settings,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Usb,
  Nfc,
  Smartphone,
  Eye,
  EyeOff,
  Hash,
  Globe,
  Award,
  ShieldCheck,
  Timer,
  Layers,
  HardDrive,
  RotateCcw,
  FileKey,
  UserCheck,
  KeyRound,
  Activity,
  Server,
  Cpu,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import { EmptyState } from "../ui/display";
import { PasswordInput } from "../ui/forms";
import { useYubiKey } from "../../hooks/ssh/useYubiKey";

type Mgr = ReturnType<typeof useYubiKey>;

type YubiKeyTab =
  | "devices"
  | "piv"
  | "fido2"
  | "oath"
  | "otp"
  | "config"
  | "audit";

interface YubiKeyManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const StatusBadge: React.FC<{ ok: boolean; label: string }> = ({
  ok,
  label,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      ok
        ? "bg-green-500/10 text-green-400"
        : "bg-red-500/10 text-red-400"
    }`}
  >
    {ok ? (
      <CheckCircle2 className="w-3 h-3" />
    ) : (
      <XCircle className="w-3 h-3" />
    )}
    {label}
  </span>
);

const ErrorBanner: React.FC<{ error: string | null }> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="sor-yk-error mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      {error}
    </div>
  );
};

const DangerConfirm: React.FC<{
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}> = ({ label, onConfirm, disabled }) => {
  const [confirming, setConfirming] = useState(false);
  const { t } = useTranslation();
  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-400">
          {t("yubikey.confirmPrompt", "Are you sure?")}
        </span>
        <button
          onClick={() => {
            onConfirm();
            setConfirming(false);
          }}
          className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-500"
        >
          {t("yubikey.confirmYes", "Yes, proceed")}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80"
        >
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={disabled}
      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600/10 text-red-500 rounded hover:bg-red-600/20 disabled:opacity-50"
    >
      <AlertTriangle className="w-3 h-3" />
      {label}
    </button>
  );
};

const InterfaceBadge: React.FC<{ label: string; active: boolean }> = ({
  label,
  active,
}) => (
  <span
    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
      active
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground"
    }`}
  >
    {label}
  </span>
);

/* ------------------------------------------------------------------ */
/*  Tab Navigation                                                     */
/* ------------------------------------------------------------------ */

const tabDefs: { id: YubiKeyTab; icon: React.ReactNode; labelKey: string }[] = [
  { id: "devices", icon: <Usb className="w-4 h-4" />, labelKey: "yubikey.tabs.devices" },
  { id: "piv", icon: <CreditCard className="w-4 h-4" />, labelKey: "yubikey.tabs.piv" },
  { id: "fido2", icon: <Fingerprint className="w-4 h-4" />, labelKey: "yubikey.tabs.fido2" },
  { id: "oath", icon: <Timer className="w-4 h-4" />, labelKey: "yubikey.tabs.oath" },
  { id: "otp", icon: <KeyRound className="w-4 h-4" />, labelKey: "yubikey.tabs.otp" },
  { id: "config", icon: <Settings className="w-4 h-4" />, labelKey: "yubikey.tabs.config" },
  { id: "audit", icon: <Activity className="w-4 h-4" />, labelKey: "yubikey.tabs.audit" },
];

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

/* ------------------------------------------------------------------ */
/*  Devices Tab                                                        */
/* ------------------------------------------------------------------ */

const DevicesTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
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
            <RefreshCw className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`} />
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
          {t("yubikey.devices.detected", "Detected Devices")} ({mgr.devices.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.listDevices()}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`} />
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
                {t("yubikey.devices.firmware", "Firmware")}: {dev.firmware_version}
                {dev.form_factor && (
                  <span className="ml-2 flex items-center gap-1">
                    <Smartphone className="w-3 h-3" />
                    {dev.form_factor}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                <span className="text-[10px] text-muted-foreground mr-1">USB:</span>
                <InterfaceBadge label="OTP" active={dev.usb_interfaces?.includes("OTP") ?? false} />
                <InterfaceBadge label="FIDO" active={dev.usb_interfaces?.includes("FIDO") ?? false} />
                <InterfaceBadge label="CCID" active={dev.usb_interfaces?.includes("CCID") ?? false} />
                {dev.nfc_interfaces && (
                  <>
                    <span className="text-[10px] text-muted-foreground ml-2 mr-1">NFC:</span>
                    <InterfaceBadge label="OTP" active={dev.nfc_interfaces.includes("OTP")} />
                    <InterfaceBadge label="FIDO" active={dev.nfc_interfaces.includes("FIDO")} />
                    <InterfaceBadge label="CCID" active={dev.nfc_interfaces.includes("CCID")} />
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {dev.is_fips && (
                  <StatusBadge ok label={t("yubikey.devices.fips", "FIPS")} />
                )}
                {dev.config_locked && (
                  <span className="flex items-center gap-1 text-amber-400">
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
                {dev.auto_eject_timeout != null && dev.auto_eject_timeout > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Timer className="w-3 h-3" />
                    {t("yubikey.devices.autoEject", "Auto-eject")}: {dev.auto_eject_timeout}s
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

/* ------------------------------------------------------------------ */
/*  PIV Tab                                                            */
/* ------------------------------------------------------------------ */

const PIV_SLOTS: { slot: string; name: string; icon: React.ReactNode }[] = [
  { slot: "9a", name: "Authentication", icon: <UserCheck className="w-4 h-4" /> },
  { slot: "9c", name: "Digital Signature", icon: <FileKey className="w-4 h-4" /> },
  { slot: "9d", name: "Key Management", icon: <Key className="w-4 h-4" /> },
  { slot: "9e", name: "Card Authentication", icon: <CreditCard className="w-4 h-4" /> },
];

const PivTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
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
            <RefreshCw className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`} />
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
                      ok={!!info?.has_key}
                      label={t("yubikey.piv.key", "Key")}
                    />
                    <StatusBadge
                      ok={!!info?.has_cert}
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
                    onClick={() => mgr.pivGenerateKey(serial, slot as never, "ECCP256" as never, "DEFAULT" as never, "DEFAULT" as never)}
                    disabled={mgr.loading}
                    className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.genKey", "Gen Key")}
                  </button>
                  <button
                    onClick={() => mgr.pivSelfSignCert(serial, slot as never, "CN=YubiKey", 365)}
                    disabled={mgr.loading}
                    className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.selfSign", "Self-Sign")}
                  </button>
                  <button
                    onClick={() => mgr.pivGenerateCsr(serial, slot as never, { subject: "CN=YubiKey" } as never)}
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
                    className="px-2 py-0.5 text-[10px] bg-red-600/10 text-red-500 rounded hover:bg-red-600/20 disabled:opacity-50"
                  >
                    {t("yubikey.piv.delCert", "Del Cert")}
                  </button>
                  <button
                    onClick={() => mgr.pivDeleteKey(serial, slot as never)}
                    disabled={mgr.loading || !info?.has_key}
                    className="px-2 py-0.5 text-[10px] bg-red-600/10 text-red-500 rounded hover:bg-red-600/20 disabled:opacity-50"
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
                    ? "text-red-400 font-bold"
                    : (mgr.pivPinStatus.pin_retries ?? 0) <= 3
                      ? "text-amber-400"
                      : "text-green-400"
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
                    ? "text-red-400 font-bold"
                    : (mgr.pivPinStatus.puk_retries ?? 0) <= 3
                      ? "text-amber-400"
                      : "text-green-400"
                }
              >
                {mgr.pivPinStatus.puk_retries}
              </span>
            </div>
            {mgr.pivPinStatus.default_pin && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                {t("yubikey.piv.defaultPin", "Default PIN in use!")}
              </span>
            )}
            {mgr.pivPinStatus.default_puk && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                {t("yubikey.piv.defaultPuk", "Default PUK in use!")}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Change PIN */}
          <div className="space-y-2">
            <label className="text-xs font-medium">{t("yubikey.piv.changePin", "Change PIN")}</label>
            <PasswordInput
              value={pinForm.oldPin}
              onChange={(e) => setPinForm((f) => ({ ...f, oldPin: e.target.value }))}
              placeholder={t("yubikey.piv.currentPin", "Current PIN")}
              className="w-full"
            />
            <PasswordInput
              value={pinForm.newPin}
              onChange={(e) => setPinForm((f) => ({ ...f, newPin: e.target.value }))}
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
            <label className="text-xs font-medium">{t("yubikey.piv.changePuk", "Change PUK")}</label>
            <PasswordInput
              value={pukForm.oldPuk}
              onChange={(e) => setPukForm((f) => ({ ...f, oldPuk: e.target.value }))}
              placeholder={t("yubikey.piv.currentPuk", "Current PUK")}
              className="w-full"
            />
            <PasswordInput
              value={pukForm.newPuk}
              onChange={(e) => setPukForm((f) => ({ ...f, newPuk: e.target.value }))}
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
            <label className="text-xs font-medium">{t("yubikey.piv.changeMgmt", "Change Management Key")}</label>
            <PasswordInput
              value={mgmtForm.current}
              onChange={(e) => setMgmtForm((f) => ({ ...f, current: e.target.value }))}
              placeholder={t("yubikey.piv.currentMgmt", "Current Key")}
              className="w-full"
            />
            <PasswordInput
              value={mgmtForm.newKey}
              onChange={(e) => setMgmtForm((f) => ({ ...f, newKey: e.target.value }))}
              placeholder={t("yubikey.piv.newMgmt", "New Key")}
              className="w-full"
            />
            <button
              onClick={() => {
                mgr.pivChangeMgmtKey(serial, mgmtForm.current, mgmtForm.newKey, "TDES" as never, false);
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
            <label className="text-xs font-medium">{t("yubikey.piv.unblockPin", "Unblock PIN")}</label>
            <PasswordInput
              value={unblockForm.puk}
              onChange={(e) => setUnblockForm((f) => ({ ...f, puk: e.target.value }))}
              placeholder={t("yubikey.piv.puk", "PUK")}
              className="w-full"
            />
            <PasswordInput
              value={unblockForm.newPin}
              onChange={(e) => setUnblockForm((f) => ({ ...f, newPin: e.target.value }))}
              placeholder={t("yubikey.piv.newPin", "New PIN")}
              className="w-full"
            />
            <button
              onClick={() => {
                mgr.pivUnblockPin(serial, unblockForm.puk, unblockForm.newPin);
                setUnblockForm({ puk: "", newPin: "" });
              }}
              disabled={!unblockForm.puk || !unblockForm.newPin || mgr.loading}
              className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-50"
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
      <div className="border border-red-500/20 rounded-lg p-3">
        <h4 className="text-xs text-red-400 font-medium mb-2">
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

/* ------------------------------------------------------------------ */
/*  FIDO2 Tab                                                          */
/* ------------------------------------------------------------------ */

const Fido2Tab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
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
              <span className="text-muted-foreground">{t("yubikey.fido2.version", "Version")}:</span>{" "}
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
                <span key={ext} className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                  {ext}
                </span>
              ))}
            </div>
          )}
          {/* Options */}
          {mgr.fido2Info.options && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(mgr.fido2Info.options).map(([key, val]) => (
                <StatusBadge key={key} ok={!!val} label={key} />
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
              ok={mgr.fido2PinStatus.is_set}
              label={
                mgr.fido2PinStatus.is_set
                  ? t("yubikey.fido2.pinSet", "PIN Set")
                  : t("yubikey.fido2.pinNotSet", "PIN Not Set")
              }
            />
            {mgr.fido2PinStatus.retries != null && (
              <span>
                {t("yubikey.fido2.retries", "Retries")}: {mgr.fido2PinStatus.retries}
              </span>
            )}
            {mgr.fido2PinStatus.force_change && (
              <span className="text-amber-400 flex items-center gap-1">
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
              <label className="text-xs font-medium">{t("yubikey.fido2.setPin", "Set PIN")}</label>
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
              <label className="text-xs font-medium">{t("yubikey.fido2.changePin", "Change PIN")}</label>
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
            hint={t("yubikey.fido2.noCredsDesc", "Enter PIN and click List to view discoverable credentials.")}
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
                      <span className="px-1 py-0.5 bg-green-500/10 text-green-400 rounded text-[10px]">
                        {t("yubikey.fido2.discoverable", "Discoverable")}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground truncate ml-5">
                    {cred.user_name}
                    {cred.creation_time && (
                      <span className="ml-2">
                        <Clock className="w-3 h-3 inline" /> {cred.creation_time}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => mgr.fido2DeleteCredential(serial, cred.credential_id, pinInput)}
                  disabled={!pinInput || mgr.loading}
                  className="flex-shrink-0 p-1 text-red-500 hover:bg-red-500/10 rounded disabled:opacity-50"
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
      <div className="border border-red-500/20 rounded-lg p-3">
        <h4 className="text-xs text-red-400 font-medium mb-2">
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

/* ------------------------------------------------------------------ */
/*  OATH Tab                                                           */
/* ------------------------------------------------------------------ */

const OathTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [showSecret, setShowSecret] = useState(false);
  const [oathPw, setOathPw] = useState("");
  const [addForm, setAddForm] = useState({
    issuer: "",
    name: "",
    secret: "",
    type: "TOTP" as string,
    algorithm: "SHA1" as string,
    digits: 6,
    period: 30,
    touch: false,
  });

  return (
    <div className="sor-yk-oath space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Timer className="w-4 h-4" />
          {t("yubikey.oath.accounts", "OATH Accounts")} ({mgr.oathAccounts.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.fetchOathAccounts(serial)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`} />
            {t("yubikey.oath.refresh", "Refresh")}
          </button>
          <button
            onClick={() => mgr.oathCalculateAll(serial)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            {t("yubikey.oath.calcAll", "Calculate All")}
          </button>
        </div>
      </div>

      {/* Account List */}
      {mgr.oathAccounts.length === 0 ? (
        <EmptyState
          icon={Timer}
          message={t("yubikey.oath.empty", "No OATH Accounts")}
          hint={t("yubikey.oath.emptyDesc", "Add an account to store TOTP/HOTP credentials.")}
        />
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {mgr.oathAccounts.map((acct) => {
            const code = mgr.oathCodes[acct.credential_id];
            return (
              <div
                key={acct.credential_id}
                className="bg-card border border-border rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {acct.issuer && (
                        <span className="text-xs font-medium">{acct.issuer}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{acct.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          acct.oath_type === "TOTP"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-purple-500/10 text-purple-400"
                        }`}
                      >
                        {acct.oath_type}
                      </span>
                      <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                        {acct.algorithm}
                      </span>
                      <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                        {acct.digits}d
                      </span>
                      {acct.oath_type === "TOTP" && (
                        <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                          {acct.period}s
                        </span>
                      )}
                      {acct.touch_required && (
                        <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded text-[10px]">
                          <Fingerprint className="w-3 h-3 inline" /> Touch
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => mgr.oathCalculate(serial, acct.credential_id)}
                      disabled={mgr.loading}
                      className="px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                    >
                      {t("yubikey.oath.calculate", "Calc")}
                    </button>
                    <button
                      onClick={() => mgr.oathDeleteAccount(serial, acct.credential_id)}
                      disabled={mgr.loading}
                      className="p-1 text-red-500 hover:bg-red-500/10 rounded disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {code && (
                  <div className="flex items-center gap-2 bg-muted/50 rounded p-2">
                    <span className="text-lg font-mono font-bold tracking-wider">
                      {code.code}
                    </span>
                    {code.valid_to && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.max(0, Math.round((code.valid_to - Date.now() / 1000)))}s
                      </span>
                    )}
                    <button
                      onClick={() => navigator.clipboard.writeText(code.code)}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Account Form */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {t("yubikey.oath.addAccount", "Add Account")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={addForm.issuer}
            onChange={(e) => setAddForm((f) => ({ ...f, issuer: e.target.value }))}
            placeholder={t("yubikey.oath.issuer", "Issuer")}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded"
          />
          <input
            value={addForm.name}
            onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={t("yubikey.oath.name", "Account Name")}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded"
          />
        </div>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            value={addForm.secret}
            onChange={(e) => setAddForm((f) => ({ ...f, secret: e.target.value }))}
            placeholder={t("yubikey.oath.secret", "Secret (Base32)")}
            className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded pr-8"
          />
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <select
            value={addForm.type}
            onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value }))}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded"
          >
            <option value="TOTP">TOTP</option>
            <option value="HOTP">HOTP</option>
          </select>
          <select
            value={addForm.algorithm}
            onChange={(e) => setAddForm((f) => ({ ...f, algorithm: e.target.value }))}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded"
          >
            <option value="SHA1">SHA1</option>
            <option value="SHA256">SHA256</option>
            <option value="SHA512">SHA512</option>
          </select>
          <input
            type="number"
            value={addForm.digits}
            onChange={(e) => setAddForm((f) => ({ ...f, digits: Number(e.target.value) }))}
            min={6}
            max={8}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded"
          />
          <input
            type="number"
            value={addForm.period}
            onChange={(e) => setAddForm((f) => ({ ...f, period: Number(e.target.value) }))}
            min={15}
            max={60}
            className="px-2 py-1.5 text-xs bg-background border border-border rounded"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={addForm.touch}
              onChange={(e) => setAddForm((f) => ({ ...f, touch: e.target.checked }))}
              className="rounded"
            />
            <Fingerprint className="w-3 h-3" />
            {t("yubikey.oath.touchRequired", "Require Touch")}
          </label>
          <button
            onClick={() => {
              mgr.oathAddAccount(
                serial,
                addForm.issuer,
                addForm.name,
                addForm.secret,
                addForm.type as never,
                addForm.algorithm as never,
                addForm.digits,
                addForm.period,
                addForm.touch,
              );
              setAddForm({ issuer: "", name: "", secret: "", type: "TOTP", algorithm: "SHA1", digits: 6, period: 30, touch: false });
            }}
            disabled={!addForm.name || !addForm.secret || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            {t("yubikey.oath.add", "Add")}
          </button>
        </div>
      </div>

      {/* OATH Password */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium">{t("yubikey.oath.password", "OATH Applet Password")}</h3>
        <div className="flex gap-2 items-center">
          <PasswordInput
            value={oathPw}
            onChange={(e) => setOathPw(e.target.value)}
            placeholder={t("yubikey.oath.passwordPlaceholder", "Password")}
            className="flex-1"
          />
          <button
            onClick={() => { mgr.oathSetPassword(serial, oathPw); setOathPw(""); }}
            disabled={!oathPw || mgr.loading}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {t("yubikey.oath.setPassword", "Set")}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="border border-red-500/20 rounded-lg p-3">
        <h4 className="text-xs text-red-400 font-medium mb-2">
          {t("yubikey.dangerZone", "Danger Zone")}
        </h4>
        <DangerConfirm
          label={t("yubikey.oath.reset", "Reset OATH Applet")}
          onConfirm={() => mgr.oathReset(serial)}
          disabled={mgr.loading}
        />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  OTP Tab                                                            */
/* ------------------------------------------------------------------ */

const OTP_SLOT_NAMES = ["Short Press (Slot 1)", "Long Press (Slot 2)"];

const OtpTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [configSlot, setConfigSlot] = useState<0 | 1 | null>(null);
  const [configType, setConfigType] = useState<string | null>(null);
  const [yubicoForm, setYubicoForm] = useState({ publicId: "", privateId: "", key: "" });
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
          <RefreshCw className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`} />
          {t("yubikey.otp.refresh", "Refresh")}
        </button>
      </div>

      {/* Slot Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {mgr.otpSlots.map((slotCfg, idx) => (
          <div key={idx} className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{OTP_SLOT_NAMES[idx]}</span>
              <StatusBadge
                ok={slotCfg != null}
                label={slotCfg ? t("yubikey.otp.configured", "Configured") : t("yubikey.otp.empty", "Empty")}
              />
            </div>
            {slotCfg && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {slotCfg.slot_type && <div>{t("yubikey.otp.type", "Type")}: {slotCfg.slot_type}</div>}
                {slotCfg.touch_required && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Fingerprint className="w-3 h-3" /> {t("yubikey.otp.touchRequired", "Touch Required")}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => { setConfigSlot(idx as 0 | 1); setConfigType("yubico"); }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.yubicoOtp", "Yubico OTP")}
              </button>
              <button
                onClick={() => { setConfigSlot(idx as 0 | 1); setConfigType("chalresp"); }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.chalResp", "Challenge-Response")}
              </button>
              <button
                onClick={() => { setConfigSlot(idx as 0 | 1); setConfigType("static"); }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.static", "Static")}
              </button>
              <button
                onClick={() => { setConfigSlot(idx as 0 | 1); setConfigType("hotp"); }}
                className="px-2 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20"
              >
                {t("yubikey.otp.hotp", "HOTP")}
              </button>
              <button
                onClick={() => mgr.otpDeleteSlot(serial, slotId(idx))}
                disabled={!slotCfg || mgr.loading}
                className="px-2 py-0.5 text-[10px] bg-red-600/10 text-red-500 rounded hover:bg-red-600/20 disabled:opacity-50"
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
              {t("yubikey.otp.configure", "Configure")} {OTP_SLOT_NAMES[configSlot]} — {configType}
            </h3>
            <button onClick={() => { setConfigSlot(null); setConfigType(null); }} className="text-xs text-muted-foreground hover:text-foreground">
              {t("common.cancel", "Cancel")}
            </button>
          </div>

          {configType === "yubico" && (
            <div className="space-y-2">
              <input value={yubicoForm.publicId} onChange={(e) => setYubicoForm((f) => ({ ...f, publicId: e.target.value }))} placeholder={t("yubikey.otp.publicId", "Public ID")} className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded" />
              <input value={yubicoForm.privateId} onChange={(e) => setYubicoForm((f) => ({ ...f, privateId: e.target.value }))} placeholder={t("yubikey.otp.privateId", "Private ID")} className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded" />
              <PasswordInput value={yubicoForm.key} onChange={(e) => setYubicoForm((f) => ({ ...f, key: e.target.value }))} placeholder={t("yubikey.otp.secretKey", "Secret Key")} className="w-full" />
              <button onClick={() => { mgr.otpConfigureYubico(serial, slotId(configSlot), yubicoForm.publicId, yubicoForm.privateId, yubicoForm.key); setConfigSlot(null); setConfigType(null); }} disabled={!yubicoForm.publicId || !yubicoForm.key || mgr.loading} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}

          {configType === "chalresp" && (
            <div className="space-y-2">
              <PasswordInput value={chalRespForm.key} onChange={(e) => setChalRespForm((f) => ({ ...f, key: e.target.value }))} placeholder={t("yubikey.otp.key", "Key")} className="w-full" />
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={chalRespForm.touch} onChange={(e) => setChalRespForm((f) => ({ ...f, touch: e.target.checked }))} className="rounded" />
                {t("yubikey.otp.touchRequired", "Touch Required")}
              </label>
              <button onClick={() => { mgr.otpConfigureChalResp(serial, slotId(configSlot), chalRespForm.key, chalRespForm.touch); setConfigSlot(null); setConfigType(null); }} disabled={!chalRespForm.key || mgr.loading} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}

          {configType === "static" && (
            <div className="space-y-2">
              <PasswordInput value={staticForm.password} onChange={(e) => setStaticForm((f) => ({ ...f, password: e.target.value }))} placeholder={t("yubikey.otp.password", "Password")} className="w-full" />
              <select value={staticForm.layout} onChange={(e) => setStaticForm((f) => ({ ...f, layout: e.target.value }))} className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded">
                <option value="US">US</option>
                <option value="DE">DE</option>
                <option value="FR">FR</option>
                <option value="SE">SE</option>
              </select>
              <button onClick={() => { mgr.otpConfigureStatic(serial, slotId(configSlot), staticForm.password, staticForm.layout); setConfigSlot(null); setConfigType(null); }} disabled={!staticForm.password || mgr.loading} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}

          {configType === "hotp" && (
            <div className="space-y-2">
              <PasswordInput value={hotpForm.key} onChange={(e) => setHotpForm((f) => ({ ...f, key: e.target.value }))} placeholder={t("yubikey.otp.key", "Key")} className="w-full" />
              <input type="number" value={hotpForm.digits} onChange={(e) => setHotpForm((f) => ({ ...f, digits: Number(e.target.value) }))} min={6} max={8} className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded" />
              <button onClick={() => { mgr.otpConfigureHotp(serial, slotId(configSlot), hotpForm.key, hotpForm.digits); setConfigSlot(null); setConfigType(null); }} disabled={!hotpForm.key || mgr.loading} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
                {t("yubikey.otp.apply", "Apply")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Config Tab                                                         */
/* ------------------------------------------------------------------ */

const ConfigTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
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
          <RefreshCw className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`} />
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
            <label key={`usb-${iface}`} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={cfg.usb_interfaces?.includes(iface) ?? false}
                onChange={(e) => {
                  const usb = cfg.usb_interfaces ?? [];
                  const updated = e.target.checked ? [...usb, iface] : usb.filter((i: string) => i !== iface);
                  mgr.setInterfaces(serial, updated as never, (cfg.nfc_interfaces ?? []) as never);
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
            <label key={`nfc-${iface}`} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={cfg.nfc_interfaces?.includes(iface) ?? false}
                onChange={(e) => {
                  const nfc = cfg.nfc_interfaces ?? [];
                  const updated = e.target.checked ? [...nfc, iface] : nfc.filter((i: string) => i !== iface);
                  mgr.setInterfaces(serial, (cfg.usb_interfaces ?? []) as never, updated as never);
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
              onChange={(e) => mgr.updateConfig({ ...cfg, auto_detect: e.target.checked })}
              className="rounded"
            />
            {t("yubikey.config.autoDetect", "Auto-detect devices")}
          </label>
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground">{t("yubikey.config.pollInterval", "Poll Interval (ms)")}:</label>
            <input
              type="number"
              value={cfg.poll_interval ?? 5000}
              onChange={(e) => mgr.updateConfig({ ...cfg, poll_interval: Number(e.target.value) })}
              className="w-20 px-2 py-1 bg-background border border-border rounded"
              min={1000}
              max={60000}
            />
          </div>
          <div className="flex items-center gap-2 col-span-2">
            <label className="text-muted-foreground">{t("yubikey.config.ykmanPath", "ykman Path")}:</label>
            <input
              type="text"
              value={cfg.ykman_path ?? ""}
              onChange={(e) => mgr.updateConfig({ ...cfg, ykman_path: e.target.value })}
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
            <div>{t("yubikey.config.algorithm", "Algorithm")}: {cfg.piv_defaults?.algorithm ?? "ECCP256"}</div>
            <div>{t("yubikey.config.pinPolicy", "PIN Policy")}: {cfg.piv_defaults?.pin_policy ?? "DEFAULT"}</div>
            <div>{t("yubikey.config.touchPolicy", "Touch Policy")}: {cfg.piv_defaults?.touch_policy ?? "DEFAULT"}</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("yubikey.config.oathDefaults", "OATH Defaults")}
          </h4>
          <div className="space-y-1 text-xs">
            <div>{t("yubikey.config.algorithm", "Algorithm")}: {cfg.oath_defaults?.algorithm ?? "SHA1"}</div>
            <div>{t("yubikey.config.digits", "Digits")}: {cfg.oath_defaults?.digits ?? 6}</div>
            <div>{t("yubikey.config.period", "Period")}: {cfg.oath_defaults?.period ?? 30}s</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("yubikey.config.fido2Defaults", "FIDO2 Defaults")}
          </h4>
          <div className="space-y-1 text-xs">
            <div>UV Preferred: {cfg.fido2_defaults?.uv_preferred ? "Yes" : "No"}</div>
            <div>Auto Attestation: {cfg.fido2_defaults?.auto_attestation ? "Yes" : "No"}</div>
            <div>Require Touch: {cfg.fido2_defaults?.require_touch ? "Yes" : "No"}</div>
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
            onClick={() => { mgr.lockConfig(serial, lockCode); setLockCode(""); }}
            disabled={!lockCode || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-50"
          >
            <Lock className="w-3 h-3" />
            {t("yubikey.config.lock", "Lock")}
          </button>
          <button
            onClick={() => { mgr.unlockConfig(serial, lockCode); setLockCode(""); }}
            disabled={!lockCode || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
          >
            <Unlock className="w-3 h-3" />
            {t("yubikey.config.unlock", "Unlock")}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Audit Tab                                                          */
/* ------------------------------------------------------------------ */

const AuditTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="sor-yk-audit space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          {t("yubikey.audit.title", "Audit Log")}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.fetchAuditLog(100)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`} />
            {t("yubikey.audit.refresh", "Refresh")}
          </button>
          <button
            onClick={() => mgr.exportAudit()}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            {t("yubikey.audit.export", "Export")}
          </button>
          <button
            onClick={() => mgr.clearAudit()}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-red-600/10 text-red-500 rounded hover:bg-red-600/20 disabled:opacity-50"
          >
            <Trash2 className="w-3 h-3" />
            {t("yubikey.audit.clear", "Clear")}
          </button>
        </div>
      </div>

      {mgr.auditEntries.length === 0 ? (
        <EmptyState
          icon={Activity}
          message={t("yubikey.audit.empty", "No Audit Entries")}
          hint={t("yubikey.audit.emptyDesc", "Audit entries will appear here as YubiKey operations occur.")}
        />
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-1">
          {mgr.auditEntries.map((entry, idx) => (
            <div
              key={entry.timestamp + idx}
              className="flex items-start gap-2 p-2 bg-card border border-border rounded text-xs"
            >
              <span
                className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${
                  entry.success ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-medium">{entry.action}</span>
                    {entry.serial && (
                      <span className="text-muted-foreground">
                        #{entry.serial}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {entry.details && (
                  <div className="text-muted-foreground truncate">
                    {entry.details}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const YubiKeyManager: React.FC<YubiKeyManagerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const mgr = useYubiKey();

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
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
        <ErrorBanner error={mgr.error} />

        {mgr.loading && (
          <div className="sor-yk-loading absolute inset-0 bg-background/50 z-10 flex items-center justify-center rounded-lg">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {mgr.selectedDevice && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="w-3 h-3" />
            {t("yubikey.selected", "Selected")}: {t("yubikey.devices.serial", "Serial")} #{mgr.selectedDevice.serial}
            {mgr.selectedDevice.firmware_version && (
              <span className="ml-2">FW {mgr.selectedDevice.firmware_version}</span>
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

export { YubiKeyManager };
