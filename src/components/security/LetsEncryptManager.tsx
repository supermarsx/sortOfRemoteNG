import React from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Square,
  Settings,
  Activity,
  Globe,
  Clock,
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ScrollText,
  User,
  Save,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import { EmptyState, StatusBadge, ErrorBanner } from "../ui/display";
import type { StatusBadgeStatus } from "../ui/display";
import { TextInput, Select } from "../ui/forms";
import {
  useLetsEncryptManager,
  ManagedCertificate,
  AcmeAccount,
  LetsEncryptEvent,
  LeTab,
} from "../../hooks/security/useLetsEncryptManager";

type Mgr = ReturnType<typeof useLetsEncryptManager>;

interface LetsEncryptManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

const certStatusToSemantic = (status: string): StatusBadgeStatus => {
  switch (status) {
    case "Active":
      return "success";
    case "Expired":
    case "Revoked":
    case "Failed":
      return "error";
    case "Pending":
      return "warning";
    case "RenewalScheduled":
    case "Renewing":
      return "info";
    default:
      return "info";
  }
};

/* ------------------------------------------------------------------ */
/*  Tab bar                                                            */
/* ------------------------------------------------------------------ */

const TAB_ITEMS: { key: LeTab; icon: React.ElementType; label: string }[] = [
  { key: "overview", icon: Shield, label: "letsEncrypt.tabs.overview" },
  { key: "certificates", icon: FileCheck, label: "letsEncrypt.tabs.certificates" },
  { key: "accounts", icon: User, label: "letsEncrypt.tabs.accounts" },
  { key: "config", icon: Settings, label: "letsEncrypt.tabs.config" },
  { key: "health", icon: Activity, label: "letsEncrypt.tabs.health" },
  { key: "events", icon: ScrollText, label: "letsEncrypt.tabs.events" },
];

const TabBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1 mb-4 border-b border-[var(--color-border)] pb-1 overflow-x-auto">
      {TAB_ITEMS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          onClick={() => mgr.setActiveTab(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-t-md transition-colors whitespace-nowrap ${
            mgr.activeTab === key
              ? "bg-primary/10 text-primary border-b-2 border-primary font-medium"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]"
          }`}
        >
          <Icon className="w-4 h-4" />
          {t(label, key)}
        </button>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Overview tab                                                       */
/* ------------------------------------------------------------------ */

const OverviewTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const s = mgr.status;

  return (
    <div className="space-y-6">
      {/* Service status card */}
      <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {s?.running ? (
              <ShieldCheck className="w-5 h-5 text-success" />
            ) : (
              <ShieldX className="w-5 h-5 text-error" />
            )}
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              {t("letsEncrypt.serviceStatus", "Service Status")}
            </h3>
          </div>
          <div className="flex gap-2">
            {!s?.running ? (
              <button
                onClick={mgr.startService}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-success text-white rounded-md hover:bg-success/90 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {t("letsEncrypt.start", "Start")}
              </button>
            ) : (
              <button
                onClick={mgr.stopService}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-error text-white rounded-md hover:bg-error/90 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                {t("letsEncrypt.stop", "Stop")}
              </button>
            )}
            <button
              onClick={mgr.refresh}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {s && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-[var(--color-text-muted)]">
                {t("letsEncrypt.environment", "Environment")}
              </span>
              <p className="font-medium text-[var(--color-text)]">{s.environment}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">
                {t("letsEncrypt.activeCerts", "Active Certificates")}
              </span>
              <p className="font-medium text-success">{s.active_certificates}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">
                {t("letsEncrypt.pendingRenewal", "Pending Renewal")}
              </span>
              <p className="font-medium text-primary">{s.pending_renewal}</p>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">
                {t("letsEncrypt.expired", "Expired")}
              </span>
              <p className="font-medium text-error">{s.expired_certificates}</p>
            </div>
          </div>
        )}
      </div>

      {/* Health summary */}
      {mgr.health && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            {t("letsEncrypt.healthSummary", "Health Summary")}
          </h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-sm text-center">
            <HealthStat label="Healthy" value={mgr.health.healthy} color="text-success" />
            <HealthStat label="Warning" value={mgr.health.warning} color="text-warning" />
            <HealthStat label="Critical" value={mgr.health.critical} color="text-warning" />
            <HealthStat label="Expired" value={mgr.health.expired} color="text-error" />
            <HealthStat label="Revoked" value={mgr.health.revoked} color="text-error" />
            <HealthStat label="Error" value={mgr.health.error} color="text-error" />
          </div>
        </div>
      )}
    </div>
  );
};

const HealthStat: React.FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
    <p className="text-[var(--color-text-muted)] text-xs">{label}</p>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Certificates tab                                                   */
/* ------------------------------------------------------------------ */

const CertificateCard: React.FC<{ cert: ManagedCertificate; mgr: Mgr }> = ({
  cert,
  mgr,
}) => {
  const { t } = useTranslation();
  const daysLeft = cert.days_until_expiry;
  const urgent = daysLeft !== undefined && daysLeft <= 14;

  return (
    <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:border-[var(--color-border-hover)] transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-[var(--color-text-muted)]" />
            <span className="font-semibold text-[var(--color-text)] truncate">
              {cert.primary_domain}
            </span>
            <StatusBadge status={certStatusToSemantic(cert.status)} label={cert.status} />
          </div>
          {cert.domains.length > 1 && (
            <p className="text-xs text-[var(--color-text-muted)] ml-6 mb-1">
              +{cert.domains.length - 1} SAN
              {cert.domains.length > 2 ? "s" : ""}: {cert.domains.slice(1).join(", ")}
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)] mt-2">
            {cert.issuer_cn && <span>Issuer: {cert.issuer_cn}</span>}
            {cert.not_after && (
              <span className={urgent ? "text-error font-medium" : ""}>
                <Clock className="w-3 h-3 inline mr-1" />
                Expires: {new Date(cert.not_after).toLocaleDateString()}
                {daysLeft !== undefined && ` (${daysLeft}d)`}
              </span>
            )}
            {cert.preferred_challenge && (
              <span>Challenge: {cert.preferred_challenge}</span>
            )}
            {cert.auto_renew && (
              <span className="text-success">
                <RefreshCw className="w-3 h-3 inline mr-1" />
                Auto-renew
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1 ml-3 shrink-0">
          <button
            onClick={() => mgr.renewCertificate(cert.id)}
            className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-primary transition-colors"
            title={t("letsEncrypt.renew", "Renew")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => mgr.fetchOcsp(cert.id)}
            className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-accent transition-colors"
            title={t("letsEncrypt.fetchOcsp", "Fetch OCSP")}
          >
            <ShieldCheck className="w-4 h-4" />
          </button>
          <button
            onClick={() => mgr.revokeCertificate(cert.id)}
            className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-warning transition-colors"
            title={t("letsEncrypt.revoke", "Revoke")}
          >
            <ShieldAlert className="w-4 h-4" />
          </button>
          <button
            onClick={() => mgr.removeCertificate(cert.id)}
            className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-error transition-colors"
            title={t("letsEncrypt.remove", "Remove")}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

const RequestCertificateForm: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-4 p-4 rounded-lg border border-primary/30 bg-primary/5">
      <h4 className="text-sm font-semibold text-[var(--color-text)] mb-3">
        {t("letsEncrypt.requestCertificate", "Request Certificate")}
      </h4>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-[var(--color-text-muted)] mb-1">
            {t("letsEncrypt.domains", "Domains")} ({t("letsEncrypt.commaSeparated", "comma-separated")})
          </label>
          <TextInput
            value={mgr.requestDomains}
            onChange={(v) => mgr.setRequestDomains(v)}
            placeholder="example.com, *.example.com"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-text-muted)] mb-1">
            {t("letsEncrypt.challengeType", "Challenge Type")}
          </label>
          <Select
            value={mgr.requestChallenge}
            onChange={(v) =>
              mgr.setRequestChallenge(v as "Http01" | "Dns01" | "TlsAlpn01")
            }
            options={[
              { value: "Http01", label: "HTTP-01" },
              { value: "Dns01", label: "DNS-01 (required for wildcards)" },
              { value: "TlsAlpn01", label: "TLS-ALPN-01" },
            ]}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={mgr.requestCertificate}
            disabled={mgr.requesting || !mgr.requestDomains.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {mgr.requesting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {t("letsEncrypt.request", "Request")}
          </button>
          <button
            onClick={() => mgr.setShowRequestForm(false)}
            className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
          >
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};

const CertificatesTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("letsEncrypt.managedCertificates", "Managed Certificates")}
        </h3>
        <button
          onClick={() => mgr.setShowRequestForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("letsEncrypt.requestNew", "Request New")}
        </button>
      </div>

      {mgr.showRequestForm && <RequestCertificateForm mgr={mgr} />}

      {mgr.certificates.length === 0 ? (
        <EmptyState
          icon={FileCheck}
          message={t("letsEncrypt.noCertificates", "No certificates yet")}
          hint={t(
            "letsEncrypt.noCertificatesHint",
            "Request your first Let's Encrypt certificate above.",
          )}
        />
      ) : (
        mgr.certificates.map((cert) => (
          <CertificateCard key={cert.id} cert={cert} mgr={mgr} />
        ))
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Accounts tab                                                       */
/* ------------------------------------------------------------------ */

const AccountCard: React.FC<{ account: AcmeAccount; mgr: Mgr }> = ({
  account,
  mgr,
}) => {
  const { t } = useTranslation();
  return (
    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium text-[var(--color-text)]">
            {account.id.substring(0, 12)}…
          </span>
          <StatusBadge status={certStatusToSemantic(account.status)} label={account.status} />
        </div>
        <div className="text-xs text-[var(--color-text-muted)] ml-6 space-y-0.5">
          <p>{account.contact.join(", ")}</p>
          <p>
            {account.environment} · Created{" "}
            {new Date(account.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
      <button
        onClick={() => mgr.removeAccount(account.id)}
        className="p-1.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-error transition-colors"
        title={t("common.delete", "Delete")}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

const AccountsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("letsEncrypt.acmeAccounts", "ACME Accounts")}
        </h3>
        <button
          onClick={mgr.registerAccount}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("letsEncrypt.registerAccount", "Register Account")}
        </button>
      </div>
      {mgr.accounts.length === 0 ? (
        <EmptyState
          icon={User}
          message={t("letsEncrypt.noAccounts", "No ACME accounts")}
          hint={t(
            "letsEncrypt.noAccountsHint",
            "Register an account with your preferred Certificate Authority.",
          )}
        />
      ) : (
        mgr.accounts.map((acct) => (
          <AccountCard key={acct.id} account={acct} mgr={mgr} />
        ))
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Config tab                                                         */
/* ------------------------------------------------------------------ */

const ConfigTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const cfg = mgr.editingConfig ? mgr.configDraft : mgr.config;
  if (!cfg) return null;

  const updateDraft = (patch: Partial<typeof cfg>) => {
    if (mgr.configDraft) mgr.setConfigDraft({ ...mgr.configDraft, ...patch });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("letsEncrypt.configuration", "Configuration")}
        </h3>
        {!mgr.editingConfig ? (
          <button
            onClick={mgr.startEditingConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            {t("common.edit", "Edit")}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={mgr.saveConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {t("common.save", "Save")}
            </button>
            <button
              onClick={mgr.cancelEditingConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        {/* Enabled toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.enabled}
            disabled={!mgr.editingConfig}
            onChange={(e) => updateDraft({ enabled: e.target.checked })}
            className="accent-primary"
          />
          <span className="text-[var(--color-text)]">
            {t("letsEncrypt.enabled", "Enabled")}
          </span>
        </label>

        {/* ToS agreement */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.agree_tos}
            disabled={!mgr.editingConfig}
            onChange={(e) => updateDraft({ agree_tos: e.target.checked })}
            className="accent-primary"
          />
          <span className="text-[var(--color-text)]">
            {t("letsEncrypt.agreeTos", "Agree to ToS")}
          </span>
        </label>

        {/* Environment */}
        <div>
          <label className="block text-xs text-[var(--color-text-muted)] mb-1">
            {t("letsEncrypt.environment", "Environment")}
          </label>
          <Select
            value={cfg.environment}
            disabled={!mgr.editingConfig}
            onChange={(v) =>
              updateDraft({ environment: v as typeof cfg.environment })
            }
            options={[
              { value: "LetsEncryptProduction", label: "Let's Encrypt (Production)" },
              { value: "LetsEncryptStaging", label: "Let's Encrypt (Staging)" },
              { value: "ZeroSsl", label: "ZeroSSL" },
              { value: "BuypassProduction", label: "Buypass (Production)" },
              { value: "BuypassStaging", label: "Buypass (Staging)" },
              { value: "GoogleTrustServices", label: "Google Trust Services" },
              { value: "Custom", label: "Custom ACME CA" },
            ]}
          />
        </div>

        {/* Contact email */}
        <div>
          <label className="block text-xs text-[var(--color-text-muted)] mb-1">
            {t("letsEncrypt.contactEmail", "Contact Email")}
          </label>
          <TextInput
            value={cfg.contact_email}
            disabled={!mgr.editingConfig}
            onChange={(v) => updateDraft({ contact_email: v })}
            placeholder="admin@example.com"
          />
        </div>

        {/* Preferred challenge */}
        <div>
          <label className="block text-xs text-[var(--color-text-muted)] mb-1">
            {t("letsEncrypt.preferredChallenge", "Preferred Challenge")}
          </label>
          <Select
            value={cfg.preferred_challenge}
            disabled={!mgr.editingConfig}
            onChange={(v) =>
              updateDraft({
                preferred_challenge: v as typeof cfg.preferred_challenge,
              })
            }
            options={[
              { value: "Http01", label: "HTTP-01" },
              { value: "Dns01", label: "DNS-01" },
              { value: "TlsAlpn01", label: "TLS-ALPN-01" },
            ]}
          />
        </div>

        {/* OCSP stapling */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.ocsp_stapling}
            disabled={!mgr.editingConfig}
            onChange={(e) => updateDraft({ ocsp_stapling: e.target.checked })}
            className="accent-primary"
          />
          <span className="text-[var(--color-text)]">
            {t("letsEncrypt.ocspStapling", "OCSP Stapling")}
          </span>
        </label>
      </div>

      {/* Renewal config */}
      <div className="mt-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <h4 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
          {t("letsEncrypt.renewalSettings", "Renewal Settings")}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer col-span-full">
            <input
              type="checkbox"
              checked={cfg.renewal.enabled}
              disabled={!mgr.editingConfig}
              onChange={(e) =>
                updateDraft({
                  renewal: { ...cfg.renewal, enabled: e.target.checked },
                })
              }
              className="accent-primary"
            />
            <span className="text-[var(--color-text)]">
              {t("letsEncrypt.autoRenewal", "Auto-renewal")}
            </span>
          </label>
          <div>
            <span className="text-xs text-[var(--color-text-muted)]">
              {t("letsEncrypt.renewBeforeDays", "Renew before (days)")}
            </span>
            <p className="font-medium text-[var(--color-text)]">
              {cfg.renewal.renew_before_days}
            </p>
          </div>
          <div>
            <span className="text-xs text-[var(--color-text-muted)]">
              {t("letsEncrypt.warningDays", "Warning (days)")}
            </span>
            <p className="font-medium text-[var(--color-text)]">
              {cfg.renewal.warning_threshold_days}
            </p>
          </div>
          <div>
            <span className="text-xs text-[var(--color-text-muted)]">
              {t("letsEncrypt.maxRetries", "Max retries")}
            </span>
            <p className="font-medium text-[var(--color-text)]">
              {cfg.renewal.max_retries}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Health tab                                                         */
/* ------------------------------------------------------------------ */

const HealthTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (!mgr.health) {
    return (
      <EmptyState
        icon={Activity}
        message={t("letsEncrypt.noHealthData", "No health data")}
        hint={t("letsEncrypt.noHealthDataHint", "Health checks run automatically.")}
      />
    );
  }

  const h = mgr.health;
  const items: { label: string; value: number; icon: React.ReactNode; color: string }[] = [
    { label: "Healthy", value: h.healthy, icon: <CheckCircle2 className="w-5 h-5" />, color: "text-success" },
    { label: "Warning", value: h.warning, icon: <AlertTriangle className="w-5 h-5" />, color: "text-warning" },
    { label: "Critical", value: h.critical, icon: <AlertTriangle className="w-5 h-5" />, color: "text-warning" },
    { label: "Expired", value: h.expired, icon: <XCircle className="w-5 h-5" />, color: "text-error" },
    { label: "Revoked", value: h.revoked, icon: <ShieldX className="w-5 h-5" />, color: "text-error" },
    { label: "Error", value: h.error, icon: <XCircle className="w-5 h-5" />, color: "text-error" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("letsEncrypt.certificateHealth", "Certificate Health")}
        </h3>
        <button
          onClick={mgr.refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          {t("common.refresh", "Refresh")}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-center"
          >
            <div className={`${item.color} mb-1 flex justify-center`}>{item.icon}</div>
            <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Events tab                                                         */
/* ------------------------------------------------------------------ */

const EventRow: React.FC<{ event: LetsEncryptEvent }> = ({ event }) => {
  const eventType = event.type || "unknown";
  const details = Object.entries(event)
    .filter(([k]) => k !== "type")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");

  return (
    <div className="flex items-start gap-2 py-2 border-b border-[var(--color-border)] last:border-b-0 text-sm">
      <ScrollText className="w-4 h-4 mt-0.5 text-[var(--color-text-muted)] shrink-0" />
      <div className="min-w-0">
        <span className="font-medium text-[var(--color-text)]">{eventType}</span>
        {details && (
          <p className="text-xs text-[var(--color-text-muted)] truncate">{details}</p>
        )}
      </div>
    </div>
  );
};

const EventsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("letsEncrypt.recentEvents", "Recent Events")}
        </h3>
        <button
          onClick={mgr.refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          {t("common.refresh", "Refresh")}
        </button>
      </div>
      {mgr.events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          message={t("letsEncrypt.noEvents", "No events recorded")}
          hint={t("letsEncrypt.noEventsHint", "Events will appear here as certificates are managed.")}
        />
      ) : (
        <div className="space-y-0">
          {mgr.events.map((ev, i) => (
            <EventRow key={i} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Tab content router                                                 */
/* ------------------------------------------------------------------ */

const TabContent: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  switch (mgr.activeTab) {
    case "overview":
      return <OverviewTab mgr={mgr} />;
    case "certificates":
      return <CertificatesTab mgr={mgr} />;
    case "accounts":
      return <AccountsTab mgr={mgr} />;
    case "config":
      return <ConfigTab mgr={mgr} />;
    case "health":
      return <HealthTab mgr={mgr} />;
    case "events":
      return <EventsTab mgr={mgr} />;
    default:
      return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const LetsEncryptManager: React.FC<LetsEncryptManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useLetsEncryptManager(isOpen, onClose);

  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-4xl max-h-[90vh]">
      <ModalHeader>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <span>{t("letsEncrypt.title", "Let's Encrypt / ACME Manager")}</span>
        </div>
      </ModalHeader>
      <ModalBody className="overflow-y-auto">
        <ErrorBanner error={mgr.error} onClear={() => {}} />
        <TabBar mgr={mgr} />

        {mgr.loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)]">
            <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
            {t("common.loading", "Loading…")}
          </div>
        ) : (
          <TabContent mgr={mgr} />
        )}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors"
        >
          {t("common.close", "Close")}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export default LetsEncryptManager;
