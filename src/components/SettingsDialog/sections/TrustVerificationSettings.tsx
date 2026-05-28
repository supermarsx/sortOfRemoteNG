import React, { useState } from "react";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  ShieldCheck,
  ShieldAlert,
  Fingerprint,
  Lock,
  Eye,
  Trash2,
  AlertTriangle,
  Clock,
  Pencil,
  Globe,
  Link2,
  ChevronRight,
  Monitor,
} from "lucide-react";
import {
  formatFingerprint,
  resolveEffectiveTrustPolicy,
  updateTrustRecordNickname,
  type TrustPolicy,
  type TrustRecord,
} from "../../../utils/auth/trustStore";
import {
  classifyTrustRecords,
  useTrustVerificationSettings,
} from "../../../hooks/settings/useTrustVerificationSettings";
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

function policyLabel(value: TrustPolicy): string {
  return POLICY_OPTIONS.find((option) => option.value === value)?.label ?? value;
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
  <div className="space-y-4">
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
            Every time a new or previously unseen identity is encountered you will
            be prompted to manually approve or reject it. Use this when you prefer
            explicit confirmation for every identity, for example in
            high-security environments.
          </p>
        </div>
        <div>
          <span className="text-[var(--color-text)] font-medium">
            Always Trust
          </span>
          <p className="mt-0.5">
            All certificates and host keys are accepted without any verification
            or prompts. This is convenient for development or lab environments but
            should{" "}
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
            identity is immediately rejected. Ideal when you manage a fixed set of
            known servers and want maximum security.
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
        checked={mgr.settings.showTrustIdentityInfo ?? true}
        onChange={(v) => mgr.updateSettings({ showTrustIdentityInfo: v })}
        icon={<Eye size={16} />}
        label="Show certificate / host key info"
        description="Reveal the resolved identity in the URL bar and terminal toolbar"
        infoTooltip="Display the verified certificate or SSH host key information inline in the URL bar (web browser sessions) and the terminal toolbar (SSH sessions)."
      />

      <div className="sor-settings-toggle-row !cursor-default pt-3 border-t border-[var(--color-border)] justify-between">
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
          <span className="text-xs text-[var(--color-textSecondary)]">days</span>
        </div>
      </div>
    </Card>
  </div>
);

const ClearAllButton: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.totalCount === 0) return null;
  if (mgr.showConfirmClear) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-error">
          Clear all stored identities?
        </span>
        <button
          onClick={mgr.handleClearAll}
          className="px-3 py-1 text-xs bg-error hover:bg-error/90 text-[var(--color-text)] rounded transition-colors"
        >
          Yes, clear all
        </button>
        <button
          onClick={() => mgr.setShowConfirmClear(false)}
          className="px-3 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => mgr.setShowConfirmClear(true)}
      className="flex items-center gap-1 px-3 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded transition-colors"
    >
      <Trash2 size={12} />
      Clear All
    </button>
  );
};

interface TrustRecordGroupSectionProps {
  title: string;
  records: TrustRecord[];
  icon: React.ReactNode;
  recordKeyPrefix: string;
  connectionId?: string;
  mgr: Mgr;
}

const TrustRecordGroupSection: React.FC<TrustRecordGroupSectionProps> = ({
  title,
  records,
  icon,
  recordKeyPrefix,
  connectionId,
  mgr,
}) => {
  if (records.length === 0) return null;

  return (
    <div>
      <h5 className="sor-sub-heading">
        {icon} {title} ({records.length})
      </h5>
      <div className="space-y-2">
        {records.map((record, index) => (
          <TrustRecordRow
            key={`${recordKeyPrefix}-${record.host}-${index}`}
            record={record}
            connectionId={connectionId}
            onRemove={(selectedRecord) =>
              mgr.handleRemoveRecord(selectedRecord, connectionId)
            }
            onUpdated={mgr.refreshRecords}
          />
        ))}
      </div>
    </div>
  );
};

function renderTrustRecordGroups(
  records: TrustRecord[],
  mgr: Mgr,
  recordKeyPrefix: string,
  connectionId?: string,
): React.ReactNode {
  const classifiedRecords = classifyTrustRecords(records);

  return (
    <>
      <TrustRecordGroupSection
        title="HTTPS Certificates"
        records={classifiedRecords.httpsRecords}
        icon={<Lock size={12} />}
        recordKeyPrefix={`${recordKeyPrefix}-https`}
        connectionId={connectionId}
        mgr={mgr}
      />
      <TrustRecordGroupSection
        title="General Certificates"
        records={classifiedRecords.certificateRecords}
        icon={<ShieldAlert size={12} />}
        recordKeyPrefix={`${recordKeyPrefix}-certificate`}
        connectionId={connectionId}
        mgr={mgr}
      />
      <TrustRecordGroupSection
        title="RDP Certificates"
        records={classifiedRecords.rdpRecords}
        icon={<Monitor size={12} />}
        recordKeyPrefix={`${recordKeyPrefix}-rdp`}
        connectionId={connectionId}
        mgr={mgr}
      />
      <TrustRecordGroupSection
        title="SSH Host Keys"
        records={classifiedRecords.sshRecords}
        icon={<Fingerprint size={12} />}
        recordKeyPrefix={`${recordKeyPrefix}-ssh`}
        connectionId={connectionId}
        mgr={mgr}
      />
      <TrustRecordGroupSection
        title="Legacy TLS"
        records={classifiedRecords.legacyTlsRecords}
        icon={<AlertTriangle size={12} />}
        recordKeyPrefix={`${recordKeyPrefix}-legacy-tls`}
        connectionId={connectionId}
        mgr={mgr}
      />
    </>
  );
}

const StoredIdentitiesSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <div className="flex items-start justify-between gap-3">
      <SettingsSectionHeader
        className="flex-1"
        icon={<ShieldAlert size={16} className="text-primary" />}
        title={`Stored Identities (${mgr.totalCount})`}
      />
      <ClearAllButton mgr={mgr} />
    </div>

    {mgr.totalCount === 0 ? (
      <div className="sor-settings-card py-6 text-center">
        <ShieldCheck size={24} className="text-[var(--color-textMuted)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-textMuted)]">No stored identities yet.</p>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Identities will appear here as you connect to servers.
        </p>
      </div>
    ) : (
      <div className="sor-settings-card space-y-4">
        {/* Global Store */}
        {mgr.trustRecords.length > 0 && (
          <details className="group" open>
            <summary className="cursor-pointer select-none sor-sub-heading">
              <ChevronRight
                size={12}
                className="transition-transform group-open:rotate-90"
              />
              <Globe size={12} />
              Global Identities ({mgr.trustRecords.length})
            </summary>
            <div className="space-y-3 ml-4">
              {renderTrustRecordGroups(mgr.trustRecords, mgr, "global")}
            </div>
          </details>
        )}

        {/* Per-Connection Stores */}
        {mgr.connectionGroups.map((group) => (
          <details key={group.connectionId} className="group">
            <summary className="cursor-pointer select-none sor-sub-heading">
              <ChevronRight
                size={12}
                className="transition-transform group-open:rotate-90"
              />
              <Link2 size={12} />
              {mgr.connectionName(group.connectionId)} ({group.records.length})
            </summary>
            <div className="space-y-3 ml-4">
              {renderTrustRecordGroups(
                group.records,
                mgr,
                group.connectionId,
                group.connectionId,
              )}
            </div>
          </details>
        ))}
      </div>
    )}
  </div>
);

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const TrustVerificationSettings: React.FC<
  TrustVerificationSettingsProps
> = ({ settings, updateSettings }) => {
  const mgr = useTrustVerificationSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <TrustCenterHeading />
      <GlobalPolicies mgr={mgr} />
      <PolicyExplanations />
      <AdditionalOptions mgr={mgr} />
      <StoredIdentitiesSection mgr={mgr} />
    </div>
  );
};

/** A single trust record row with remove action. */
function TrustRecordRow({
  record,
  connectionId,
  onRemove,
  onUpdated,
}: {
  record: TrustRecord;
  connectionId?: string;
  onRemove: (r: TrustRecord) => void;
  onUpdated: () => void;
}) {
  const [editingNick, setEditingNick] = React.useState(false);
  const [nickDraft, setNickDraft] = React.useState(record.nickname ?? "");

  const saveNickname = () => {
    const [h, p] = record.host.split(":");
    updateTrustRecordNickname(
      h,
      parseInt(p, 10),
      record.type,
      nickDraft.trim(),
      connectionId,
    );
    setEditingNick(false);
    onUpdated();
  };

  return (
    <div className="flex items-center gap-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {editingNick ? (
            <input
              autoFocus
              type="text"
              value={nickDraft}
              onChange={(e) => setNickDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNickname();
                else if (e.key === "Escape") {
                  setNickDraft(record.nickname ?? "");
                  setEditingNick(false);
                }
              }}
              onBlur={saveNickname}
              placeholder="Nickname…"
              className="sor-settings-input sor-settings-input-compact w-40 text-sm text-[var(--color-textSecondary)] placeholder-[var(--color-textMuted)]"
            />
          ) : (
            <>
              <span className="text-sm text-[var(--color-text)] font-medium truncate">
                {record.nickname || record.host}
              </span>
              {record.nickname && (
                <span className="text-xs text-[var(--color-textMuted)] truncate">
                  ({record.host})
                </span>
              )}
              <button
                onClick={() => {
                  setNickDraft(record.nickname ?? "");
                  setEditingNick(true);
                }}
                className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5 transition-colors flex-shrink-0"
                title={record.nickname ? "Edit nickname" : "Add nickname"}
              >
                <Pencil size={10} />
              </button>
            </>
          )}
          {record.userApproved && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/50 text-success border border-success/50">
              approved
            </span>
          )}
          {record.history && record.history.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/50 text-warning border border-warning/50 flex items-center gap-0.5">
              <AlertTriangle size={8} />
              {record.history.length} change
              {record.history.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="text-[11px] font-mono text-[var(--color-textMuted)] truncate mt-0.5">
          {formatFingerprint(record.identity.fingerprint)}
        </p>
        <p className="text-[10px] text-[var(--color-textMuted)] mt-0.5">
          First seen: {new Date(record.identity.firstSeen).toLocaleDateString()}{" "}
          · Last: {new Date(record.identity.lastSeen).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={() => onRemove(record)}
        className="text-[var(--color-textMuted)] hover:text-error p-1 transition-colors flex-shrink-0"
        title="Remove stored identity"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
