import React, { useState } from "react";
import {
  Shield,
  Key,
  Lock,
  Unlock,
  FileText,
  Settings,
  Search,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Plus,
  Copy,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  CreditCard,
  Globe,
  UserCheck,
  Users,
  Award,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Hash,
  Mail,
  Calendar,
  Clock,
  Activity,
  FileKey,
  ShieldAlert,
  Layers,
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
import { useGpgAgent } from "../../hooks/ssh/useGpgAgent";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Mgr = ReturnType<typeof useGpgAgent>;

type GpgTab =
  | "overview"
  | "keyring"
  | "sign-verify"
  | "encrypt-decrypt"
  | "trust"
  | "smartcard"
  | "keyserver"
  | "audit"
  | "config";

interface GpgAgentManagerProps {
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
        ? "bg-success/10 text-success"
        : "bg-error/10 text-error"
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

const ValidityBadge: React.FC<{ validity: string }> = ({ validity }) => {
  const colors: Record<string, string> = {
    ultimate: "bg-success/10 text-success",
    full: "bg-primary/10 text-primary",
    marginal: "bg-warning/10 text-warning",
    never: "bg-error/10 text-error",
    unknown: "bg-text-secondary/10 text-text-muted",
    revoked: "bg-error/10 text-error",
    expired: "bg-warning/10 text-warning",
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        colors[validity] ?? colors.unknown
      }`}
    >
      {validity}
    </span>
  );
};

const TrustBadge: React.FC<{ trust: string }> = ({ trust }) => {
  const colors: Record<string, string> = {
    ultimate: "bg-accent/10 text-accent",
    full: "bg-primary/10 text-primary",
    marginal: "bg-warning/10 text-warning",
    never: "bg-error/10 text-error",
    unknown: "bg-text-secondary/10 text-text-muted",
    undefined: "bg-text-secondary/10 text-text-muted",
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        colors[trust] ?? colors.unknown
      }`}
    >
      {trust}
    </span>
  );
};

const ErrorBanner: React.FC<{ error: string | null }> = ({ error }) => {
  if (!error) return null;
  return (
    <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      {error}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab Navigation                                                     */
/* ------------------------------------------------------------------ */

const tabs: { id: GpgTab; icon: React.ReactNode; labelKey: string }[] = [
  { id: "overview", icon: <Shield className="w-4 h-4" />, labelKey: "gpgAgent.tabs.overview" },
  { id: "keyring", icon: <Key className="w-4 h-4" />, labelKey: "gpgAgent.tabs.keyring" },
  { id: "sign-verify", icon: <FileKey className="w-4 h-4" />, labelKey: "gpgAgent.tabs.signVerify" },
  { id: "encrypt-decrypt", icon: <Lock className="w-4 h-4" />, labelKey: "gpgAgent.tabs.encryptDecrypt" },
  { id: "trust", icon: <ShieldCheck className="w-4 h-4" />, labelKey: "gpgAgent.tabs.trust" },
  { id: "smartcard", icon: <CreditCard className="w-4 h-4" />, labelKey: "gpgAgent.tabs.smartCard" },
  { id: "keyserver", icon: <Globe className="w-4 h-4" />, labelKey: "gpgAgent.tabs.keyserver" },
  { id: "audit", icon: <FileText className="w-4 h-4" />, labelKey: "gpgAgent.tabs.audit" },
  { id: "config", icon: <Settings className="w-4 h-4" />, labelKey: "gpgAgent.tabs.config" },
];

const TabBar: React.FC<{
  active: string;
  onChange: (tab: GpgTab) => void;
}> = ({ active, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="sor-gpg-tabbar flex gap-1 mb-4 border-b border-border pb-2 overflow-x-auto">
      {tabs.map((tab) => (
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
          {t(tab.labelKey, tab.id)}
        </button>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Overview Tab                                                       */
/* ------------------------------------------------------------------ */

const OverviewTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const s = mgr.status;

  return (
    <div className="sor-gpg-overview space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.agentStatus", "Agent Status")}
          </div>
          <StatusBadge
            ok={s?.running ?? false}
            label={
              s?.running
                ? t("gpgAgent.status.running", "Running")
                : t("gpgAgent.status.stopped", "Stopped")
            }
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.version", "Version")}
          </div>
          <div className="text-sm font-mono">{s?.version ?? "—"}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.socket", "Socket Path")}
          </div>
          <div className="text-xs font-mono truncate">{s?.socket_path ?? "—"}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.scdaemon", "Scdaemon")}
          </div>
          <StatusBadge
            ok={s?.scdaemon_running ?? false}
            label={
              s?.scdaemon_running
                ? t("gpgAgent.status.active", "Active")
                : t("gpgAgent.status.inactive", "Inactive")
            }
          />
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.cachedKeys", "Keys Cached")}
          </div>
          <div className="text-lg font-semibold">{s?.keys_cached ?? 0}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {t("gpgAgent.status.sshSupport", "SSH Support")}
          </div>
          <StatusBadge
            ok={s?.enable_ssh_support ?? false}
            label={
              s?.enable_ssh_support
                ? t("gpgAgent.status.enabled", "Enabled")
                : t("gpgAgent.status.disabled", "Disabled")
            }
          />
        </div>
      </div>

      {s?.card_present && (
        <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-primary" />
          <div>
            <div className="text-sm font-medium">
              {t("gpgAgent.status.cardPresent", "Smart Card Present")}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {s.card_serial ?? "—"}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!s?.running ? (
          <button
            onClick={mgr.startAgent}
            disabled={mgr.loading}
            className="flex items-center gap-2 px-4 py-2 bg-success text-[var(--color-text)] rounded-md hover:bg-success/90 transition-colors disabled:opacity-50"
          >
            <Activity className="w-4 h-4" />
            {t("gpgAgent.actions.start", "Start Agent")}
          </button>
        ) : (
          <>
            <button
              onClick={mgr.stopAgent}
              disabled={mgr.loading}
              className="flex items-center gap-2 px-4 py-2 bg-error text-[var(--color-text)] rounded-md hover:bg-error/90 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              {t("gpgAgent.actions.stop", "Stop Agent")}
            </button>
            <button
              onClick={mgr.restartAgent}
              disabled={mgr.loading}
              className="flex items-center gap-2 px-4 py-2 bg-warning text-[var(--color-text)] rounded-md hover:bg-warning/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              {t("gpgAgent.actions.restart", "Restart")}
            </button>
          </>
        )}
        <button
          onClick={mgr.detectEnvironment}
          className="flex items-center gap-2 px-3 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
        >
          <Search className="w-4 h-4" />
          {t("gpgAgent.actions.detectEnv", "Detect Environment")}
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Keyring Tab                                                        */
/* ------------------------------------------------------------------ */

const KeyringTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [secretOnly, setSecretOnly] = useState(false);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);

  const filtered = mgr.keys.filter((k) => {
    const q = filter.toLowerCase();
    if (!q) return true;
    const uid = k.uid_list?.[0];
    const name = uid?.name?.toLowerCase() ?? "";
    const email = uid?.email?.toLowerCase() ?? "";
    return (
      k.fingerprint?.toLowerCase().includes(q) ||
      name.includes(q) ||
      email.includes(q)
    );
  });

  return (
    <div className="sor-gpg-keyring space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("gpgAgent.keyring.search", "Search keys…")}
            className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={secretOnly}
            onChange={(e) => {
              setSecretOnly(e.target.checked);
              mgr.fetchKeys(e.target.checked);
            }}
            className="rounded"
          />
          {t("gpgAgent.keyring.secretOnly", "Secret keys only")}
        </label>
        <button
          onClick={() => mgr.fetchKeys(secretOnly)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw className="w-3 h-3" />
          {t("common.refresh", "Refresh")}
        </button>
        <button
          onClick={() => setShowImport(!showImport)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20"
        >
          <Upload className="w-3 h-3" />
          {t("gpgAgent.keyring.import", "Import")}
        </button>
      </div>

      {/* Import panel */}
      {showImport && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t("gpgAgent.keyring.pasteKey", "Paste armored key…")}
            rows={4}
            className="w-full px-3 py-2 bg-muted border border-border rounded text-xs font-mono resize-y"
          />
          <button
            onClick={async () => {
              if (!importText.trim()) return;
              const data = Array.from(new TextEncoder().encode(importText));
              await mgr.importKey(data, true);
              setImportText("");
              setShowImport(false);
              mgr.fetchKeys(secretOnly);
            }}
            disabled={!importText.trim()}
            className="px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {t("gpgAgent.keyring.importBtn", "Import Key")}
          </button>
        </div>
      )}

      {/* Key list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Key}
          message={t("gpgAgent.keyring.empty", "No Keys Found")}
          hint={t("gpgAgent.keyring.emptyDesc", "Import or generate keys to get started.")}
        />
      ) : (
        <div className="space-y-1 max-h-[360px] overflow-y-auto">
          {filtered.map((key) => {
            const uid = key.uid_list?.[0];
            const isSelected = mgr.selectedKey?.fingerprint === key.fingerprint;
            return (
              <div key={key.fingerprint}>
                <button
                  onClick={() => mgr.getKey(key.fingerprint)}
                  className={`w-full text-left p-2 rounded border transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Fingerprint className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs font-mono truncate">
                        {key.fingerprint?.slice(-16)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {key.is_secret && <KeyRound className="w-3 h-3 text-warning" />}
                      {key.card_serial && <CreditCard className="w-3 h-3 text-primary" />}
                      <ValidityBadge validity={key.validity ?? "unknown"} />
                      <TrustBadge trust={key.owner_trust ?? "unknown"} />
                    </div>
                  </div>
                  <div className="mt-1 text-sm truncate">
                    {uid ? (
                      <>
                        <span className="font-medium">{uid.name}</span>
                        {uid.email && (
                          <span className="text-muted-foreground">
                            {" "}&lt;{uid.email}&gt;
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">
                        {t("gpgAgent.keyring.noUid", "No UID")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
                    <span>{key.algorithm} {key.bits > 0 && `${key.bits}b`}</span>
                    {key.creation_date && (
                      <span className="flex items-center gap-0.5">
                        <Calendar className="w-3 h-3" />
                        {new Date(key.creation_date).toLocaleDateString()}
                      </span>
                    )}
                    {key.expiration_date && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {new Date(key.expiration_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </button>

                {/* Detail panel */}
                {isSelected && mgr.selectedKey && (
                  <div className="mt-1 ml-4 p-3 bg-card border border-border rounded-lg space-y-3 text-xs">
                    {/* UIDs */}
                    <div>
                      <h4 className="font-medium mb-1 flex items-center gap-1">
                        <Users className="w-3 h-3" /> {t("gpgAgent.keyring.uids", "User IDs")}
                      </h4>
                      {mgr.selectedKey.uid_list?.map((u: { name: string; email: string; comment: string; is_revoked: boolean }, i: number) => (
                        <div key={i} className="flex items-center gap-2 py-0.5">
                          <Mail className="w-3 h-3 text-muted-foreground" />
                          <span>{u.name}</span>
                          {u.email && <span className="text-muted-foreground">&lt;{u.email}&gt;</span>}
                          {u.comment && <span className="text-muted-foreground">({u.comment})</span>}
                          {u.is_revoked && <span className="text-error text-[10px]">REVOKED</span>}
                        </div>
                      ))}
                    </div>
                    {/* Subkeys */}
                    <div>
                      <h4 className="font-medium mb-1 flex items-center gap-1">
                        <Layers className="w-3 h-3" /> {t("gpgAgent.keyring.subkeys", "Subkeys")}
                      </h4>
                      {mgr.selectedKey.subkeys?.map((sk, i) => (
                        <div key={i} className="flex items-center gap-3 py-0.5 font-mono">
                          <span className="truncate w-24">{sk.fingerprint?.slice(-8)}</span>
                          <span>{sk.algorithm}</span>
                          <span className="text-muted-foreground">{sk.capabilities?.join(",")}</span>
                          {sk.is_revoked && <span className="text-error">rev</span>}
                        </div>
                      ))}
                    </div>
                    {/* Actions */}
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border">
                      <button
                        onClick={() => mgr.exportKey(key.fingerprint, { armor: true, include_secret: false, include_attributes: true, include_local_sigs: false, minimal: false, clean: false })}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded hover:bg-muted/80"
                      >
                        <Download className="w-3 h-3" /> {t("gpgAgent.keyring.export", "Export")}
                      </button>
                      <button
                        onClick={() => mgr.deleteKey(key.fingerprint, false)}
                        className="flex items-center gap-1 px-2 py-1 bg-error/10 text-error rounded hover:bg-error/20"
                      >
                        <Trash2 className="w-3 h-3" /> {t("gpgAgent.keyring.delete", "Delete")}
                      </button>
                      <button
                        onClick={() => mgr.signKey(key.fingerprint, key.fingerprint, [], false)}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded hover:bg-muted/80"
                      >
                        <Award className="w-3 h-3" /> {t("gpgAgent.keyring.signKey", "Sign Key")}
                      </button>
                      <button
                        onClick={() => mgr.setExpiration(key.fingerprint, null)}
                        className="flex items-center gap-1 px-2 py-1 bg-muted rounded hover:bg-muted/80"
                      >
                        <Calendar className="w-3 h-3" /> {t("gpgAgent.keyring.setExpiry", "Expiration")}
                      </button>
                      <button
                        onClick={() => mgr.genRevocation(key.fingerprint, "0", "No reason")}
                        className="flex items-center gap-1 px-2 py-1 bg-warning/10 text-warning rounded hover:bg-warning/20"
                      >
                        <ShieldAlert className="w-3 h-3" /> {t("gpgAgent.keyring.revoke", "Revocation")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Sign / Verify Tab                                                  */
/* ------------------------------------------------------------------ */

const SignVerifyTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [signKeyId, setSignKeyId] = useState("");
  const [signText, setSignText] = useState("");
  const [detached, setDetached] = useState(false);
  const [armor, setArmor] = useState(true);
  const [clearsign, setClearsign] = useState(false);
  const [signResult, setSignResult] = useState<string | null>(null);

  const [verifyData, setVerifyData] = useState("");
  const [detachedSig, setDetachedSig] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    status: string;
    signer?: string;
    timestamp?: string;
  } | null>(null);

  const secretKeys = mgr.keys.filter((k) => k.is_secret);

  const handleSign = async () => {
    if (!signKeyId || !signText) return;
    const data = Array.from(new TextEncoder().encode(signText));
    const result = await mgr.signData(signKeyId, data, detached, armor);
    if (result) {
      setSignResult(result.signature_armor || new TextDecoder().decode(new Uint8Array(result.signature_data)));
    }
  };

  const handleVerify = async () => {
    if (!verifyData) return;
    const data = Array.from(new TextEncoder().encode(verifyData));
    const sig = detachedSig
      ? Array.from(new TextEncoder().encode(detachedSig))
      : null;
    const result = await mgr.verifySignature(data, sig);
    if (result) {
      setVerifyResult({
        status: result.valid ? "Good" : "Bad",
        signer: result.signer_uid,
        timestamp: result.creation_date,
      });
    }
  };

  return (
    <div className="sor-gpg-sign-verify space-y-6">
      {/* Sign section */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <FileKey className="w-4 h-4" />
          {t("gpgAgent.sign.title", "Sign Data")}
        </h3>
        <select
          value={signKeyId}
          onChange={(e) => setSignKeyId(e.target.value)}
          className="w-full px-3 py-1.5 bg-muted border border-border rounded text-sm"
        >
          <option value="">{t("gpgAgent.sign.selectKey", "— Select signing key —")}</option>
          {secretKeys.map((k) => (
            <option key={k.fingerprint} value={k.fingerprint}>
              {k.uid_list?.[0]?.name ?? k.fingerprint?.slice(-16)} ({k.algorithm})
            </option>
          ))}
        </select>
        <textarea
          value={signText}
          onChange={(e) => setSignText(e.target.value)}
          placeholder={t("gpgAgent.sign.dataPlaceholder", "Enter data to sign…")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={detached} onChange={(e) => setDetached(e.target.checked)} className="rounded" />
            {t("gpgAgent.sign.detached", "Detached")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={armor} onChange={(e) => setArmor(e.target.checked)} className="rounded" />
            {t("gpgAgent.sign.armor", "Armor")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={clearsign} onChange={(e) => setClearsign(e.target.checked)} className="rounded" />
            {t("gpgAgent.sign.clearsign", "Clearsign")}
          </label>
        </div>
        <button
          onClick={handleSign}
          disabled={!signKeyId || !signText || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <FileKey className="w-4 h-4" />
          {t("gpgAgent.sign.signBtn", "Sign")}
        </button>
        {signResult && (
          <div className="relative">
            <textarea
              readOnly
              value={signResult}
              rows={5}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded text-xs font-mono"
            />
            <button
              onClick={() => navigator.clipboard.writeText(signResult)}
              className="absolute top-2 right-2 p-1 bg-muted rounded hover:bg-muted/80"
              title={t("common.copy", "Copy")}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Verify section */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          {t("gpgAgent.verify.title", "Verify Signature")}
        </h3>
        <textarea
          value={verifyData}
          onChange={(e) => setVerifyData(e.target.value)}
          placeholder={t("gpgAgent.verify.dataPlaceholder", "Paste signed data…")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <textarea
          value={detachedSig}
          onChange={(e) => setDetachedSig(e.target.value)}
          placeholder={t("gpgAgent.verify.detachedPlaceholder", "Detached signature (optional)…")}
          rows={2}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <button
          onClick={handleVerify}
          disabled={!verifyData || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-success text-[var(--color-text)] rounded hover:bg-success/90 disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          {t("gpgAgent.verify.verifyBtn", "Verify")}
        </button>
        {verifyResult && (
          <div className="flex items-center gap-3 p-2 rounded bg-muted/50 text-sm">
            <StatusBadge ok={verifyResult.status === "Good"} label={verifyResult.status} />
            {verifyResult.signer && (
              <span className="text-xs text-muted-foreground">
                {t("gpgAgent.verify.signer", "Signer")}: {verifyResult.signer}
              </span>
            )}
            {verifyResult.timestamp && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {verifyResult.timestamp}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Encrypt / Decrypt Tab                                              */
/* ------------------------------------------------------------------ */

const EncryptDecryptTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [plaintext, setPlaintext] = useState("");
  const [encArmor, setEncArmor] = useState(true);
  const [encSign, setEncSign] = useState(false);
  const [symmetricOnly, setSymmetricOnly] = useState(false);
  const [encResult, setEncResult] = useState<string | null>(null);

  const [ciphertext, setCiphertext] = useState("");
  const [decResult, setDecResult] = useState<{ plaintext: string; sigInfo?: string } | null>(null);

  const handleEncrypt = async () => {
    if (!plaintext || (recipients.length === 0 && !symmetricOnly)) return;
    const data = Array.from(new TextEncoder().encode(plaintext));
    const result = await mgr.encryptData(recipients, data, encArmor, encSign, null);
    if (result) {
      setEncResult(result.armor || new TextDecoder().decode(new Uint8Array(result.ciphertext)));
    }
  };

  const handleDecrypt = async () => {
    if (!ciphertext) return;
    const data = Array.from(new TextEncoder().encode(ciphertext));
    const result = await mgr.decryptData(data);
    if (result) {
      setDecResult({
        plaintext: new TextDecoder().decode(new Uint8Array(result.plaintext)),
        sigInfo: result.signature_info?.signer_uid ?? undefined,
      });
    }
  };

  const toggleRecipient = (fp: string) => {
    setRecipients((r) =>
      r.includes(fp) ? r.filter((x) => x !== fp) : [...r, fp],
    );
  };

  return (
    <div className="sor-gpg-enc-dec space-y-6">
      {/* Encrypt */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t("gpgAgent.encrypt.title", "Encrypt")}
        </h3>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {t("gpgAgent.encrypt.recipients", "Recipients")}
          </label>
          <div className="max-h-28 overflow-y-auto border border-border rounded p-1 space-y-0.5">
            {mgr.keys.map((k) => {
              const uid = k.uid_list?.[0];
              return (
                <label
                  key={k.fingerprint}
                  className="flex items-center gap-2 px-2 py-0.5 hover:bg-muted/50 rounded text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={recipients.includes(k.fingerprint)}
                    onChange={() => toggleRecipient(k.fingerprint)}
                    className="rounded"
                  />
                  <span className="truncate">
                    {uid?.name ?? k.fingerprint?.slice(-16)}
                    {uid?.email && <span className="text-muted-foreground"> &lt;{uid.email}&gt;</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <textarea
          value={plaintext}
          onChange={(e) => setPlaintext(e.target.value)}
          placeholder={t("gpgAgent.encrypt.dataPlaceholder", "Enter data to encrypt…")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <div className="flex gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={encArmor} onChange={(e) => setEncArmor(e.target.checked)} className="rounded" />
            {t("gpgAgent.encrypt.armor", "Armor")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={encSign} onChange={(e) => setEncSign(e.target.checked)} className="rounded" />
            {t("gpgAgent.encrypt.sign", "Sign")}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={symmetricOnly} onChange={(e) => setSymmetricOnly(e.target.checked)} className="rounded" />
            {t("gpgAgent.encrypt.symmetric", "Symmetric only")}
          </label>
        </div>
        <button
          onClick={handleEncrypt}
          disabled={(!recipients.length && !symmetricOnly) || !plaintext || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <Lock className="w-4 h-4" />
          {t("gpgAgent.encrypt.encryptBtn", "Encrypt")}
        </button>
        {encResult && (
          <div className="relative">
            <textarea
              readOnly
              value={encResult}
              rows={5}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded text-xs font-mono"
            />
            <button
              onClick={() => navigator.clipboard.writeText(encResult)}
              className="absolute top-2 right-2 p-1 bg-muted rounded hover:bg-muted/80"
              title={t("common.copy", "Copy")}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Decrypt */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Unlock className="w-4 h-4" />
          {t("gpgAgent.decrypt.title", "Decrypt")}
        </h3>
        <textarea
          value={ciphertext}
          onChange={(e) => setCiphertext(e.target.value)}
          placeholder={t("gpgAgent.decrypt.dataPlaceholder", "Paste encrypted data…")}
          rows={4}
          className="w-full px-3 py-2 bg-muted border border-border rounded text-sm font-mono resize-y"
        />
        <button
          onClick={handleDecrypt}
          disabled={!ciphertext || mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-success text-[var(--color-text)] rounded hover:bg-success/90 disabled:opacity-50"
        >
          <Unlock className="w-4 h-4" />
          {t("gpgAgent.decrypt.decryptBtn", "Decrypt")}
        </button>
        {decResult && (
          <div className="space-y-2">
            <textarea
              readOnly
              value={decResult.plaintext}
              rows={4}
              className="w-full px-3 py-2 bg-muted/50 border border-border rounded text-xs font-mono"
            />
            {decResult.sigInfo && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-3 h-3 text-success" />
                {t("gpgAgent.decrypt.signedBy", "Signed by")}: {decResult.sigInfo}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Trust Tab                                                          */
/* ------------------------------------------------------------------ */

const TrustTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [trustKeyId, setTrustKeyId] = useState("");
  const [trustLevel, setTrustLevel] = useState<string>("unknown");
  const ts = mgr.trustStats;

  return (
    <div className="sor-gpg-trust space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t("gpgAgent.trust.total", "Total Keys"), value: ts?.total_keys ?? 0 },
          { label: t("gpgAgent.trust.trusted", "Fully Trusted"), value: ts?.full_trust ?? 0 },
          { label: t("gpgAgent.trust.marginal", "Marginal"), value: ts?.marginal_trust ?? 0 },
          { label: t("gpgAgent.trust.ultimate", "Ultimate"), value: ts?.ultimate_trust ?? 0 },
          { label: t("gpgAgent.trust.revoked", "Revoked"), value: ts?.revoked_keys ?? 0 },
          { label: t("gpgAgent.trust.expired", "Expired"), value: ts?.expired_keys ?? 0 },
          { label: t("gpgAgent.trust.unknown", "Unknown"), value: ts?.unknown_trust ?? 0 },
          { label: t("gpgAgent.trust.trusted", "Trusted"), value: ts?.trusted_keys ?? 0 },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-card border border-border rounded-lg p-3 text-center"
          >
            <div className="text-lg font-semibold">{item.value}</div>
            <div className="text-xs text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={mgr.updateTrustDb}
          disabled={mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className="w-4 h-4" />
          {t("gpgAgent.trust.rebuild", "Rebuild Trust DB")}
        </button>
        <button
          onClick={() => mgr.fetchTrustStats()}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw className="w-4 h-4" />
          {t("common.refresh", "Refresh")}
        </button>
      </div>

      {/* Key trust editor */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <UserCheck className="w-4 h-4" />
          {t("gpgAgent.trust.setTrust", "Set Key Trust")}
        </h3>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.trust.keyId", "Key fingerprint or ID")}
            </label>
            <input
              type="text"
              value={trustKeyId}
              onChange={(e) => setTrustKeyId(e.target.value)}
              placeholder="0x..."
              className="w-full px-3 py-1.5 bg-muted border border-border rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.trust.level", "Trust level")}
            </label>
            <select
              value={trustLevel}
              onChange={(e) => setTrustLevel(e.target.value)}
              className="px-3 py-1.5 bg-muted border border-border rounded text-sm"
            >
              <option value="unknown">Unknown</option>
              <option value="never">Never</option>
              <option value="marginal">Marginal</option>
              <option value="full">Full</option>
              <option value="ultimate">Ultimate</option>
            </select>
          </div>
          <button
            onClick={() => {
              if (trustKeyId) mgr.setTrust(trustKeyId, trustLevel as any);
            }}
            disabled={!trustKeyId}
            className="px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {t("gpgAgent.trust.apply", "Apply")}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Smart Card Tab                                                     */
/* ------------------------------------------------------------------ */

const SmartCardTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const c = mgr.cardInfo;

  return (
    <div className="sor-gpg-smartcard space-y-4">
      <div className="flex gap-2">
        <button
          onClick={mgr.getCardStatus}
          disabled={mgr.loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80"
        >
          <RefreshCw className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`} />
          {t("gpgAgent.card.refresh", "Refresh Card")}
        </button>
        <button
          onClick={mgr.cardFetchKey}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/10 text-primary rounded hover:bg-primary/20"
        >
          <Download className="w-4 h-4" />
          {t("gpgAgent.card.fetchKey", "Fetch Key from Card")}
        </button>
      </div>

      {!c ? (
        <EmptyState
          icon={CreditCard}
          message={t("gpgAgent.card.noCard", "No Smart Card Detected")}
          hint={t("gpgAgent.card.noCardDesc", "Insert a smart card and click Refresh.")}
        />
      ) : (
        <>
          {/* Card info */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              {t("gpgAgent.card.info", "Card Information")}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: t("gpgAgent.card.reader", "Reader"), value: c.reader },
                { label: t("gpgAgent.card.serial", "Serial"), value: c.serial },
                { label: t("gpgAgent.card.manufacturer", "Manufacturer"), value: c.manufacturer },
                { label: t("gpgAgent.card.version", "Version"), value: c.application_version },
                { label: t("gpgAgent.card.holder", "Cardholder"), value: c.card_holder },
                { label: t("gpgAgent.card.language", "Language"), value: c.language },
              ].map((item) => (
                <div key={item.label}>
                  <span className="text-muted-foreground">{item.label}: </span>
                  <span className="font-mono">{item.value ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* PIN retry counts */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-medium flex items-center gap-2">
              <Hash className="w-3 h-3" />
              {t("gpgAgent.card.pinRetries", "PIN Retry Counts")}
            </h3>
            <div className="flex gap-4 text-xs">
              {[
                { label: "PIN", value: c.pin_retry_count[0] },
                { label: "Reset", value: c.pin_retry_count[1] },
                { label: "Admin", value: c.pin_retry_count[2] },
              ].map((p) => (
                <div key={p.label} className="flex items-center gap-1">
                  <span className="text-muted-foreground">{p.label}:</span>
                  <span
                    className={`font-semibold ${
                      (p.value ?? 0) <= 1 ? "text-error" : ""
                    }`}
                  >
                    {p.value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Key fingerprints on card */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <h3 className="text-xs font-medium flex items-center gap-2">
              <Fingerprint className="w-3 h-3" />
              {t("gpgAgent.card.keyFingerprints", "Key Fingerprints")}
            </h3>
            <div className="grid grid-cols-1 gap-1 text-xs font-mono">
              {[
                { label: "Signature", value: c.signature_key_fingerprint },
                { label: "Encryption", value: c.encryption_key_fingerprint },
                { label: "Authentication", value: c.authentication_key_fingerprint },
              ].map((kf) => (
                <div key={kf.label} className="flex gap-2">
                  <span className="text-muted-foreground w-24">{kf.label}:</span>
                  <span className="truncate">{kf.value || "—"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key attributes */}
          {c.key_attributes.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 space-y-2">
              <h3 className="text-xs font-medium">
                {t("gpgAgent.card.keyAttrs", "Key Attributes")}
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-1">Slot</th>
                    <th className="text-left py-1">Algorithm</th>
                    <th className="text-left py-1">Bits</th>
                  </tr>
                </thead>
                <tbody>
                  {c.key_attributes.map((attr, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1">{attr.slot}</td>
                      <td className="py-1 font-mono">{attr.algorithm}</td>
                      <td className="py-1">{attr.bits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => mgr.cardChangePin("user")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-warning text-[var(--color-text)] rounded hover:bg-warning/90"
            >
              <Lock className="w-3 h-3" />
              {t("gpgAgent.card.changePin", "Change PIN")}
            </button>
            <button
              onClick={() => mgr.cardChangePin("admin")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-warning text-[var(--color-text)] rounded hover:bg-warning/90"
            >
              <ShieldAlert className="w-3 h-3" />
              {t("gpgAgent.card.changeAdminPin", "Change Admin PIN")}
            </button>
            <button
              onClick={mgr.cardFactoryReset}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-error text-[var(--color-text)] rounded hover:bg-error/90"
            >
              <Trash2 className="w-3 h-3" />
              {t("gpgAgent.card.factoryReset", "Factory Reset")}
            </button>
            <button
              onClick={() => mgr.cardGenKey("sig", "rsa2048")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-[var(--color-text)] rounded hover:bg-primary/90"
            >
              <Plus className="w-3 h-3" />
              {t("gpgAgent.card.genKey", "Generate Key on Card")}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Keyserver Tab                                                      */
/* ------------------------------------------------------------------ */

const KeyserverTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sendKeyId, setSendKeyId] = useState("");

  return (
    <div className="sor-gpg-keyserver space-y-4">
      {/* Search */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Search className="w-4 h-4" />
          {t("gpgAgent.keyserver.search", "Search Keyserver")}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("gpgAgent.keyserver.searchPlaceholder", "Name, email, or key ID…")}
            className="flex-1 px-3 py-1.5 bg-muted border border-border rounded text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && query) mgr.searchKeyserver(query);
            }}
          />
          <button
            onClick={() => mgr.searchKeyserver(query)}
            disabled={!query || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            {t("gpgAgent.keyserver.searchBtn", "Search")}
          </button>
        </div>

        {mgr.keyserverResults.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {mgr.keyserverResults.map((r) => (
              <div
                key={r.key_id}
                className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs"
              >
                <div className="min-w-0">
                  <div className="font-mono truncate">{r.key_id}</div>
                  <div className="text-muted-foreground truncate">
                    {r.uid ?? "—"}
                  </div>
                  <div className="text-muted-foreground">
                    {r.algorithm} · {r.creation_date ? new Date(r.creation_date).toLocaleDateString() : "—"}
                  </div>
                </div>
                <button
                  onClick={() => mgr.fetchFromKeyserver(r.key_id)}
                  className="flex items-center gap-1 px-2 py-1 bg-success/10 text-success rounded hover:bg-success/20 flex-shrink-0 ml-2"
                >
                  <Download className="w-3 h-3" />
                  {t("gpgAgent.keyserver.fetch", "Fetch")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send key */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Upload className="w-4 h-4" />
          {t("gpgAgent.keyserver.send", "Send Key to Keyserver")}
        </h3>
        <div className="flex gap-2">
          <select
            value={sendKeyId}
            onChange={(e) => setSendKeyId(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-muted border border-border rounded text-sm"
          >
            <option value="">{t("gpgAgent.keyserver.selectKey", "— Select key —")}</option>
            {mgr.keys.map((k) => (
              <option key={k.fingerprint} value={k.fingerprint}>
                {k.uid_list?.[0]?.name ?? k.fingerprint?.slice(-16)}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (sendKeyId) mgr.sendToKeyserver(sendKeyId);
            }}
            disabled={!sendKeyId || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-[var(--color-text)] rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {t("gpgAgent.keyserver.sendBtn", "Send")}
          </button>
        </div>
      </div>

      {/* Refresh all */}
      <button
        onClick={mgr.refreshKeys}
        disabled={mgr.loading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded hover:bg-muted/80 disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${mgr.loading ? "animate-spin" : ""}`} />
        {t("gpgAgent.keyserver.refreshAll", "Refresh All Keys from Keyserver")}
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Audit Tab                                                          */
/* ------------------------------------------------------------------ */

const AuditTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(200);

  return (
    <div className="sor-gpg-audit space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">
          {t("gpgAgent.audit.title", "Audit Log")} ({mgr.auditEntries.length})
        </h3>
        <div className="flex gap-2 items-center">
          <select
            value={limit}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              setLimit(v);
              mgr.fetchAuditLog(v);
            }}
            className="px-2 py-1 text-xs bg-muted border border-border rounded"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <button
            onClick={() => mgr.fetchAuditLog(limit)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <RefreshCw className="w-3 h-3" />
            {t("common.refresh", "Refresh")}
          </button>
          <button
            onClick={async () => {
              const json = await mgr.exportAudit();
              if (json) {
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "gpg-audit.json";
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-muted/80"
          >
            <Download className="w-3 h-3" />
            {t("gpgAgent.audit.export", "Export")}
          </button>
          <button
            onClick={mgr.clearAudit}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-error/10 text-error rounded hover:bg-error/20"
          >
            <Trash2 className="w-3 h-3" />
            {t("gpgAgent.audit.clear", "Clear")}
          </button>
        </div>
      </div>

      {mgr.auditEntries.length === 0 ? (
        <EmptyState
          icon={FileText}
          message={t("gpgAgent.audit.empty", "No Audit Entries")}
          hint={t("gpgAgent.audit.emptyDesc", "Audit entries will appear here as GPG operations occur.")}
        />
      ) : (
        <div className="max-h-80 overflow-y-auto space-y-1">
          {mgr.auditEntries.map((entry, idx) => (
            <div
              key={entry.id ?? idx}
              className="flex items-start gap-2 p-2 bg-card border border-border rounded text-xs"
            >
              <span
                className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${
                  entry.success ? "bg-success" : "bg-error"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between">
                  <span className="font-medium">{entry.action}</span>
                  <span className="text-muted-foreground">
                    {entry.timestamp
                      ? new Date(entry.timestamp).toLocaleTimeString()
                      : "—"}
                  </span>
                </div>
                {entry.details && (
                  <div className="text-muted-foreground truncate">
                    {entry.details}
                  </div>
                )}
                {entry.key_id && (
                  <div className="font-mono text-muted-foreground truncate">
                    {entry.key_id}
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
/*  Config Tab                                                         */
/* ------------------------------------------------------------------ */

const ConfigTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const c = mgr.config;

  if (!c) {
    return (
      <div className="flex justify-center py-8">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const update = (patch: Partial<typeof c>) => mgr.updateConfig({ ...c, ...patch });

  return (
    <div className="sor-gpg-config space-y-4 text-sm">
      {/* Paths */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Server className="w-4 h-4" />
          {t("gpgAgent.config.paths", "Paths")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "home_dir", label: t("gpgAgent.config.homeDir", "Home directory") },
            { key: "gpg_binary", label: t("gpgAgent.config.gpgBinary", "GPG binary") },
            { key: "gpg_agent_binary", label: t("gpgAgent.config.agentBinary", "Agent binary") },
            { key: "scdaemon_binary", label: t("gpgAgent.config.scdaemonBin", "Scdaemon binary") },
          ].map((field) => (
            <div key={field.key}>
              <label className="text-xs text-muted-foreground block mb-1">{field.label}</label>
              <input
                type="text"
                value={(c as any)[field.key] ?? ""}
                onChange={(e) => update({ [field.key]: e.target.value })}
                className="w-full px-2 py-1 bg-muted border border-border rounded text-sm font-mono"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Security */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Shield className="w-4 h-4" />
          {t("gpgAgent.config.security", "Security")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.pinentryMode", "Pinentry mode")}
            </label>
            <select
              value={c.pinentry_mode ?? "Default"}
              onChange={(e) => update({ pinentry_mode: e.target.value as any })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            >
              <option value="Default">Default</option>
              <option value="Ask">Ask</option>
              <option value="Cancel">Cancel</option>
              <option value="Error">Error</option>
              <option value="Loopback">Loopback</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.defaultCacheTtl", "Default cache TTL (s)")}
            </label>
            <input
              type="number"
              value={c.default_cache_ttl ?? 600}
              onChange={(e) => update({ default_cache_ttl: parseInt(e.target.value) || 0 })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.maxCacheTtl", "Max cache TTL (s)")}
            </label>
            <input
              type="number"
              value={c.max_cache_ttl ?? 7200}
              onChange={(e) => update({ max_cache_ttl: parseInt(e.target.value) || 0 })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm"
            />
          </div>
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={c.allow_loopback_pinentry ?? false}
              onChange={(e) => update({ allow_loopback_pinentry: e.target.checked })}
              className="rounded"
            />
            {t("gpgAgent.config.allowLoopback", "Allow loopback pinentry")}
          </label>
        </div>
      </div>

      {/* SSH */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Key className="w-4 h-4" />
          {t("gpgAgent.config.ssh", "SSH Support")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={c.enable_ssh_support ?? false}
              onChange={(e) => update({ enable_ssh_support: e.target.checked })}
              className="rounded"
            />
            {t("gpgAgent.config.enableSsh", "Enable SSH support")}
          </label>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.extraSocket", "Extra socket path")}
            </label>
            <input
              type="text"
              value={c.extra_socket ?? ""}
              onChange={(e) => update({ extra_socket: e.target.value })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* Keys & Keyserver */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <Globe className="w-4 h-4" />
          {t("gpgAgent.config.keysAndServer", "Keys & Keyserver")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.defaultKey", "Default key")}
            </label>
            <input
              type="text"
              value={c.default_key ?? ""}
              onChange={(e) => update({ default_key: e.target.value })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.autoKeyLocate", "Auto key locate")}
            </label>
            <input
              type="text"
              value={(c.auto_key_locate ?? []).join(", ")}
              onChange={(e) => update({ auto_key_locate: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.keyserver", "Keyserver URL")}
            </label>
            <input
              type="text"
              value={c.keyserver ?? ""}
              onChange={(e) => update({ keyserver: e.target.value })}
              placeholder="hkps://keys.openpgp.org"
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("gpgAgent.config.keyserverOptions", "Keyserver options")}
            </label>
            <input
              type="text"
              value={(c.keyserver_options ?? []).join(", ")}
              onChange={(e) => update({ keyserver_options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              className="w-full px-2 py-1 bg-muted border border-border rounded text-sm font-mono"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const GpgAgentManager: React.FC<GpgAgentManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useGpgAgent();

  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-5xl">
      <ModalHeader
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {t("gpgAgent.title", "GPG Agent Manager")}
          </div>
        }
      />
      <ModalBody>
        <ErrorBanner error={mgr.error} />

        {mgr.loading && (
          <div className="sor-gpg-loading absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        <TabBar
          active={mgr.activeTab}
          onChange={(tab) => mgr.setActiveTab(tab)}
        />

        {mgr.activeTab === "overview" && <OverviewTab mgr={mgr} />}
        {mgr.activeTab === "keyring" && <KeyringTab mgr={mgr} />}
        {mgr.activeTab === "sign-verify" && <SignVerifyTab mgr={mgr} />}
        {mgr.activeTab === "encrypt-decrypt" && <EncryptDecryptTab mgr={mgr} />}
        {mgr.activeTab === "trust" && <TrustTab mgr={mgr} />}
        {mgr.activeTab === "smartcard" && <SmartCardTab mgr={mgr} />}
        {mgr.activeTab === "keyserver" && <KeyserverTab mgr={mgr} />}
        {mgr.activeTab === "audit" && <AuditTab mgr={mgr} />}
        {mgr.activeTab === "config" && <ConfigTab mgr={mgr} />}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors"
        >
          {t("common.close", "Close")}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export { GpgAgentManager };
