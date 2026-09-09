import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  ShieldCheck,
  ShieldAlert,
  Fingerprint,
  Lock,
  Unlock,
  Eye,
  Trash2,
  AlertTriangle,
  Clock,
  Globe,
  ChevronRight,
  Monitor,
  RefreshCw,
  Database,
  Archive,
} from "lucide-react";
import {
  resolveEffectiveTrustPolicy,
  type TrustPolicy,
} from "../../../utils/auth/trustStore";
import { useTrustVerificationSettings } from "../../../hooks/settings/useTrustVerificationSettings";
import { NumberInput } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader,
  Toggle,
  SettingsSelectRow,
} from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

type Mgr = ReturnType<typeof useTrustVerificationSettings>;

interface TrustVerificationSettingsProps {
  onOpenTrustCenter?: () => void;
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const POLICY_OPTIONS: {
  value: TrustPolicy;
  label: string;
  description: string;
}[] = [
  {
    value: "tofu",
    label: "Trust On First Use (TOFU)",
    description:
      "Prompt on first connection, then remember accepted identities and warn on later changes.",
  },
  {
    value: "always-ask",
    label: "Always Ask",
    description: "Prompt for confirmation on every new identity.",
  },
  {
    value: "always-trust",
    label: "Always Trust",
    description: "Never check — accept everything without verification.",
  },
  {
    value: "strict",
    label: "Strict",
    description: "Reject unless the identity has been manually pre-approved.",
  },
];

const CONCRETE_POLICY_OPTIONS = POLICY_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

const INHERITABLE_POLICY_OPTIONS = [
  { value: "inherit", label: "Inherit Default Policy" },
  ...CONCRETE_POLICY_OPTIONS,
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const TrustCenterHeading: React.FC = () => (
  <SectionHeading
    icon={<Fingerprint className="w-5 h-5 text-primary" />}
    title="Trust Center"
    description="Control how HTTPS certificates, general certificates, RDP certificates, SSH host keys, and legacy TLS identities are verified and memorized. These settings apply globally but can be overridden per connection."
  />
);

/* ------------------------------------------------------------------ */
/*  Database scope, portability and legacy cleanup (t62 / D7)          */
/* ------------------------------------------------------------------ */

const ACTION_BUTTON_CLASS =
  "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs bg-[var(--color-border)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

const TrustDatabaseBanner: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  if (!mgr.scope.resolved) {
    return (
      <div
        className="sor-settings-card flex items-center gap-2"
        data-testid="trust-database-banner"
        data-scope-state="unresolved"
      >
        <Database size={16} className="text-[var(--color-textMuted)]" />
        <p className="text-xs text-[var(--color-textMuted)]">
          {t("trustCenter.database.checking", {
            defaultValue: "Checking which database holds the trust records…",
          })}
        </p>
      </div>
    );
  }

  if (mgr.noActiveDatabase) {
    return (
      <div
        className="sor-settings-card border border-warning/40 bg-warning/10 space-y-1"
        data-testid="trust-database-banner"
        data-scope-state="none"
      >
        <p className="flex items-center gap-2 text-xs font-medium text-warning">
          <AlertTriangle size={14} />
          {t("trustCenter.database.noDatabase", {
            defaultValue: "No database is open",
          })}
        </p>
        <p className="text-[11px] leading-relaxed text-[var(--color-textMuted)]">
          {t("trustCenter.database.noDatabaseHint", {
            defaultValue:
              "Trust decisions are stored per database. Open or unlock a database to review or change them.",
          })}
        </p>
      </div>
    );
  }

  return (
    <div
      className="sor-settings-card space-y-1.5"
      data-testid="trust-database-banner"
      data-scope-state="active"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Database size={16} className="text-primary flex-shrink-0" />
        <span
          className="text-sm font-medium text-[var(--color-text)]"
          data-testid="trust-database-name"
        >
          {mgr.databaseName
            ? t("trustCenter.database.storedIn", {
                defaultValue: "Stored in database “{{name}}”",
                name: mgr.databaseName,
              })
            : t("trustCenter.database.unnamed", {
                defaultValue: "Stored in the open database",
              })}
        </span>
        <span
          data-testid="trust-database-encryption"
          data-encrypted={mgr.scope.encrypted ? "true" : "false"}
          title={
            mgr.scope.encrypted
              ? t("trustCenter.database.encryptedHint", {
                  defaultValue:
                    "The trust file is encrypted with the master key, exactly like the database it belongs to.",
                })
              : t("trustCenter.database.plaintextHint", {
                  defaultValue:
                    "The trust file is stored unencrypted because no master encryption is configured.",
                })
          }
          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
            mgr.scope.encrypted
              ? "bg-success/20 text-success border-success/40"
              : "bg-warning/20 text-warning border-warning/40"
          }`}
        >
          {mgr.scope.encrypted ? <Lock size={9} /> : <Unlock size={9} />}
          {mgr.scope.encrypted
            ? t("trustCenter.database.encrypted", { defaultValue: "Encrypted" })
            : t("trustCenter.database.plaintext", {
                defaultValue: "Plaintext",
              })}
        </span>
        <span
          className="text-[11px] text-[var(--color-textMuted)]"
          data-testid="trust-database-count"
        >
          {t("trustCenter.database.records", {
            defaultValue: "{{total}} stored identities",
            total: mgr.totalCount,
          })}
        </span>
      </div>
      {mgr.scope.seededRecords > 0 && (
        <p
          className="text-[11px] text-[var(--color-textMuted)]"
          data-testid="trust-database-seeded"
        >
          {t("trustCenter.database.seeded", {
            defaultValue: "{{total}} migrated from the legacy trust files",
            total: mgr.scope.seededRecords,
          })}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-[var(--color-textMuted)]">
        {t("trustCenter.database.perDatabaseHint", {
          defaultValue:
            "A host trusted here is not trusted in another database. Use Export and Import to copy trust decisions between databases.",
        })}
      </p>
    </div>
  );
};

const TrustLegacyCard: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const status = mgr.legacyStatus;
  if (!status || !mgr.legacyPresent) return null;

  const blocked = !status.allDatabasesOpened;

  return (
    <div
      className="sor-settings-card space-y-2"
      data-testid="trust-legacy"
      data-setting-key="trustLegacyStores"
    >
      <p className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]">
        <Archive size={14} className="text-[var(--color-textMuted)]" />
        {t("trustCenter.legacy.title", { defaultValue: "Legacy trust files" })}
      </p>
      <p className="text-[11px] leading-relaxed text-[var(--color-textMuted)]">
        {t("trustCenter.legacy.description", {
          defaultValue:
            "Trust decisions from before per-database storage are still kept in app-wide files. They are read once to seed each database and are never modified.",
        })}
      </p>
      <ul
        className="space-y-0.5 text-[11px] font-mono text-[var(--color-textMuted)]"
        data-testid="trust-legacy-status"
      >
        {status.legacyPresent && (
          <li>
            {t("trustCenter.legacy.storeFile", {
              defaultValue: "trust_store.json — {{total}} identities",
              total: status.legacyRecords,
            })}
          </li>
        )}
        {status.rdpLegacyPresent && (
          <li>
            {t("trustCenter.legacy.rdpFile", {
              defaultValue: "rdp-cert-trust.json — {{total}} RDP certificates",
              total: status.rdpLegacyRecords,
            })}
          </li>
        )}
      </ul>
      {mgr.showConfirmDeleteLegacy ? (
        <div
          className="space-y-2 rounded border border-error/40 bg-error/10 p-2"
          data-testid="trust-delete-legacy-confirm"
          role="alertdialog"
          aria-label={t("trustCenter.legacy.confirmTitle", {
            defaultValue: "Delete the legacy trust files?",
          })}
        >
          <p className="text-xs font-medium text-error">
            {t("trustCenter.legacy.confirmTitle", {
              defaultValue: "Delete the legacy trust files?",
            })}
          </p>
          <p className="text-[11px] leading-relaxed text-[var(--color-textMuted)]">
            {t("trustCenter.legacy.confirmBody", {
              defaultValue:
                "trust_store.json and rdp-cert-trust.json are removed permanently. A database that was never opened would then start with an empty Trust Center.",
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void mgr.handleDeleteLegacyStores()}
              disabled={mgr.actionBusy === "delete-legacy"}
              data-testid="trust-delete-legacy-accept"
              className="rounded bg-error px-3 py-1 text-xs text-[var(--color-text)] transition-colors hover:bg-error/90 disabled:opacity-40"
            >
              {t("trustCenter.legacy.confirm", { defaultValue: "Delete" })}
            </button>
            <button
              onClick={() => mgr.setShowConfirmDeleteLegacy(false)}
              data-testid="trust-delete-legacy-cancel"
              className="rounded bg-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-textSecondary)] transition-colors"
            >
              {t("trustCenter.legacy.cancel", { defaultValue: "Cancel" })}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <button
            onClick={() => mgr.setShowConfirmDeleteLegacy(true)}
            disabled={blocked || mgr.actionBusy !== undefined}
            data-testid="trust-delete-legacy"
            title={
              blocked
                ? t("trustCenter.legacy.blocked", {
                    defaultValue:
                      "Open every database once so its trust records are migrated before deleting the legacy files.",
                  })
                : undefined
            }
            className={ACTION_BUTTON_CLASS}
          >
            <Trash2 size={12} />
            {t("trustCenter.legacy.delete", {
              defaultValue: "Delete legacy trust files",
            })}
          </button>
          {blocked && (
            <p
              className="text-[11px] leading-relaxed text-warning"
              data-testid="trust-delete-legacy-blocked"
            >
              {t("trustCenter.legacy.blocked", {
                defaultValue:
                  "Open every database once so its trust records are migrated before deleting the legacy files.",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const TrustDatabaseSection: React.FC<{
  mgr: Mgr;
  onOpenTrustCenter?: () => void;
}> = ({ mgr, onOpenTrustCenter }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title="Database trust management"
      />
      <TrustDatabaseBanner mgr={mgr} />
      <div
        className="sor-settings-card space-y-2"
        data-setting-key="trustDatabase"
      >
        <p className="text-xs text-[var(--color-textMuted)]">
          Manage identities, certificate details, history, verification
          statistics, labels, tags, per-host policies and reviewed imports in
          the dedicated Trust Center tab. Global policies stay below.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-setting-key="trustStoredIdentities"
            className={ACTION_BUTTON_CLASS}
            disabled={!onOpenTrustCenter}
            onClick={onOpenTrustCenter}
          >
            Open dedicated Trust Center
          </button>
          <button
            type="button"
            data-setting-key="trustExportJson"
            className={ACTION_BUTTON_CLASS}
            disabled={!onOpenTrustCenter}
            onClick={onOpenTrustCenter}
          >
            {t("trustCenter.actions.exportJson", "Export JSON")} → Trust Center
          </button>
          <button
            type="button"
            data-setting-key="trustImportJson"
            className={ACTION_BUTTON_CLASS}
            disabled={!onOpenTrustCenter}
            onClick={onOpenTrustCenter}
          >
            {t("trustCenter.actions.importJson", "Import JSON")} → Trust Center
          </button>
          <button
            type="button"
            data-setting-key="trustImportKnownHosts"
            className={ACTION_BUTTON_CLASS}
            disabled={!onOpenTrustCenter}
            onClick={onOpenTrustCenter}
          >
            {t(
              "trustCenter.actions.importKnownHosts",
              "Import from known_hosts",
            )}{" "}
            → Trust Center
          </button>
        </div>
      </div>
      <SettingsSectionHeader
        icon={<Archive className="w-4 h-4 text-warning" />}
        title="Legacy trust recovery"
      />
      <TrustLegacyCard mgr={mgr} />
      {mgr.actionMessage && (
        <p
          role="status"
          data-testid="trust-action-message"
          data-tone={mgr.actionMessage.tone}
          className={
            mgr.actionMessage.tone === "error"
              ? "text-xs text-error"
              : "text-xs text-success"
          }
        >
          {t(mgr.actionMessage.key, {
            defaultValue: mgr.actionMessage.key,
            ...(mgr.actionMessage.values ?? {}),
          })}
        </p>
      )}
    </div>
  );
};

function policyLabel(value: TrustPolicy): string {
  return (
    POLICY_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

function policyDescription(value: TrustPolicy | undefined): string | undefined {
  return POLICY_OPTIONS.find((option) => option.value === value)?.description;
}

function effectivePolicyDescription(value: TrustPolicy): string {
  const description = policyDescription(value);
  return description
    ? `Effective: ${policyLabel(value)}. ${description}`
    : `Effective: ${policyLabel(value)}.`;
}

const GlobalPolicies: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const rootPolicy = mgr.settings.trustPolicy ?? "tofu";
  const httpsPolicy = mgr.settings.httpsTrustPolicy ?? "inherit";
  const certificatePolicy = mgr.settings.certificateTrustPolicy ?? "inherit";
  const sshPolicy = mgr.settings.sshTrustPolicy ?? "always-ask";
  const rdpPolicy = mgr.settings.rdpTrustPolicy ?? "inherit";

  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        icon={<ShieldCheck className="w-4 h-4 text-primary" />}
        title="Trust Policies"
      />

      <Card>
        <SettingsSelectRow
          settingKey="trustPolicy"
          icon={<ShieldCheck size={16} />}
          label="Default Trust Policy"
          description={effectivePolicyDescription(rootPolicy)}
          value={rootPolicy}
          options={CONCRETE_POLICY_OPTIONS}
          onChange={(v) =>
            mgr.updateSettings({
              trustPolicy: v as GlobalSettings["trustPolicy"],
            })
          }
          infoTooltip="The default policy used by every protocol unless overridden below. Concrete options only — this row cannot inherit from elsewhere."
        />

        <SettingsSelectRow
          settingKey="certificateTrustPolicy"
          icon={<ShieldAlert size={16} />}
          label="General Certificate Policy"
          description={effectivePolicyDescription(
            resolveEffectiveTrustPolicy(
              undefined,
              certificatePolicy,
              rootPolicy,
            ),
          )}
          value={certificatePolicy}
          options={INHERITABLE_POLICY_OPTIONS}
          onChange={(v) =>
            mgr.updateSettings({
              certificateTrustPolicy:
                v as GlobalSettings["certificateTrustPolicy"],
            })
          }
          infoTooltip="Applies to certificates that aren't covered by a more specific policy below. Inherits from the default unless overridden."
        />

        <SettingsSelectRow
          settingKey="httpsTrustPolicy"
          icon={<Lock size={16} />}
          label="HTTPS Certificate Policy"
          description={effectivePolicyDescription(
            resolveEffectiveTrustPolicy(undefined, httpsPolicy, rootPolicy),
          )}
          value={httpsPolicy}
          options={INHERITABLE_POLICY_OPTIONS}
          onChange={(v) =>
            mgr.updateSettings({
              httpsTrustPolicy: v as GlobalSettings["httpsTrustPolicy"],
            })
          }
          infoTooltip="Policy for HTTPS server certificates seen by the embedded web browser and HTTP-based features."
        />

        <SettingsSelectRow
          settingKey="sshTrustPolicy"
          icon={<Fingerprint size={16} />}
          label="SSH Host Key Policy"
          description={effectivePolicyDescription(
            resolveEffectiveTrustPolicy(undefined, sshPolicy, rootPolicy),
          )}
          value={sshPolicy}
          options={INHERITABLE_POLICY_OPTIONS}
          onChange={(v) =>
            mgr.updateSettings({
              sshTrustPolicy: v as GlobalSettings["sshTrustPolicy"],
            })
          }
          infoTooltip="Policy for SSH server host keys. Most users keep this at Always Ask or TOFU so unrecognized hosts are flagged."
        />

        <SettingsSelectRow
          settingKey="rdpTrustPolicy"
          icon={<Monitor size={16} />}
          label="RDP Certificate Policy"
          description={`${effectivePolicyDescription(
            resolveEffectiveTrustPolicy(undefined, rdpPolicy, rootPolicy),
          )} — separate from HTTPS / legacy TLS identities; RDP servers are typically self-signed, so most users keep this at TOFU even when HTTPS is Strict.`}
          value={rdpPolicy}
          options={INHERITABLE_POLICY_OPTIONS}
          onChange={(v) =>
            mgr.updateSettings({
              rdpTrustPolicy: v as GlobalSettings["rdpTrustPolicy"],
            })
          }
          infoTooltip="Policy for RDP server certificates. RDP servers are commonly self-signed; TOFU is the usual choice."
        />
      </Card>
    </div>
  );
};

const PolicyExplanations: React.FC = () => (
  <div className="space-y-4" data-setting-key="trustPolicyGuide">
    <SettingsSectionHeader
      icon={<ShieldAlert className="w-4 h-4 text-primary" />}
      title="Policy Guide"
    />

    <details className="sor-settings-card group [&>summary]:list-none">
      <summary className="cursor-pointer select-none text-sm font-medium text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors flex items-center gap-2">
        <ChevronRight
          size={14}
          className="text-[var(--color-textMuted)] transition-transform group-open:rotate-90 flex-shrink-0"
        />
        <ShieldAlert
          size={14}
          className="text-[var(--color-textMuted)] flex-shrink-0"
        />
        What do these policies mean?
      </summary>
      <div className="pt-3 space-y-3 text-xs text-[var(--color-textMuted)] leading-relaxed border-t border-[var(--color-border)]">
        <div>
          <span className="text-[var(--color-text)] font-medium">
            Trust On First Use (TOFU)
          </span>
          <p className="mt-0.5">
            The first time you connect to a host, its certificate or host key is
            shown to you and you decide whether to continue. If you choose to
            remember it, subsequent connections compare against the stored
            identity and warn if it changes later.
          </p>
        </div>
        <div>
          <span className="text-[var(--color-text)] font-medium">
            Always Ask
          </span>
          <p className="mt-0.5">
            Every time a new or previously unseen identity is encountered you
            will be prompted to manually approve or reject it. Use this when you
            prefer explicit confirmation for every identity, for example in
            high-security environments.
          </p>
        </div>
        <div>
          <span className="text-[var(--color-text)] font-medium">
            Always Trust
          </span>
          <p className="mt-0.5">
            All certificates and host keys are accepted without any verification
            or prompts. This is convenient for development or lab environments
            but should{" "}
            <em className="text-[var(--color-textSecondary)] not-italic font-medium">
              never
            </em>{" "}
            be used in production or on untrusted networks — it leaves you
            vulnerable to man-in-the-middle attacks.
          </p>
        </div>
        <div>
          <span className="text-[var(--color-text)] font-medium">Strict</span>
          <p className="mt-0.5">
            Connections are only allowed if the host&apos;s identity has been
            manually pre-approved and stored beforehand. Any unknown or changed
            identity is immediately rejected. Ideal when you manage a fixed set
            of known servers and want maximum security.
          </p>
        </div>
      </div>
    </details>
  </div>
);

const AdditionalOptions: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SettingsSectionHeader
      icon={<Eye className="w-4 h-4 text-primary" />}
      title="Verification Options"
    />

    <Card>
      <Toggle
        settingKey="showTrustIdentityInfo"
        checked={mgr.settings.showTrustIdentityInfo ?? true}
        onChange={(v) => mgr.updateSettings({ showTrustIdentityInfo: v })}
        icon={<Eye size={16} />}
        label="Show certificate / host key info"
        description="Reveal the resolved identity in the URL bar and terminal toolbar"
        infoTooltip="Display the verified certificate or SSH host key information inline in the URL bar (web browser sessions) and the terminal toolbar (SSH sessions)."
      />

      <div
        className="sor-settings-toggle-row !cursor-default pt-3 border-t border-[var(--color-border)] justify-between"
        data-setting-key="certExpiryWarningDays"
      >
        <div className="sor-settings-toggle-icon">
          <Clock size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="sor-settings-toggle-label flex items-center gap-1">
            Warn when certificates expire
            <InfoTooltip text="Show a warning when a stored certificate's expiry date is within this many days. Set to 0 to disable expiry warnings entirely." />
          </span>
          <p className="sor-settings-toggle-description">
            Show an inline warning this many days before expiry (0 = off)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <NumberInput
            value={mgr.settings.certExpiryWarningDays ?? 5}
            onChange={(v: number) =>
              mgr.updateSettings({ certExpiryWarningDays: v })
            }
            variant="settings-compact"
            className="text-right"
            style={{ width: "5rem" }}
            min={0}
            max={365}
          />
          <span className="text-xs text-[var(--color-textSecondary)]">
            days
          </span>
        </div>
      </div>
    </Card>
  </div>
);

export const TrustVerificationSettings: React.FC<
  TrustVerificationSettingsProps
> = ({ settings, updateSettings, onOpenTrustCenter }) => {
  const mgr = useTrustVerificationSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <TrustCenterHeading />
      <TrustDatabaseSection mgr={mgr} onOpenTrustCenter={onOpenTrustCenter} />
      <GlobalPolicies mgr={mgr} />
      <PolicyExplanations />
      <AdditionalOptions mgr={mgr} />
    </div>
  );
};
