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
  type InheritableTrustPolicy,
  type TrustPolicy,
  type TrustRecord,
} from "../../../utils/auth/trustStore";
import {
  classifyTrustRecords,
  useTrustVerificationSettings,
} from "../../../hooks/settings/useTrustVerificationSettings";
import { Checkbox, NumberInput, Select } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";

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

const SectionHeader: React.FC = () => (
  <div>
    <SectionHeading
      icon={<Fingerprint className="w-5 h-5" />}
      title="Trust Center"
      description="Control how HTTPS certificates, general certificates, RDP certificates, SSH host keys, and legacy TLS identities are verified and memorized. These settings apply globally but can be overridden per connection."
    />
  </div>
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

interface PolicyCardProps {
  title: string;
  icon: React.ReactNode;
  iconClassName: string;
  value: TrustPolicy | InheritableTrustPolicy;
  options: { value: string; label: string }[];
  effectivePolicy: TrustPolicy;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}

const PolicyCard: React.FC<PolicyCardProps> = ({
  title,
  icon,
  iconClassName,
  value,
  options,
  effectivePolicy,
  onChange,
  children,
}) => (
  <div className="sor-settings-card">
    <div className="flex items-center gap-2 mb-3">
      <span className={iconClassName}>{icon}</span>
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)]">
        {title}
      </h4>
    </div>
    <Select
      value={value}
      onChange={onChange}
      options={options}
      className="sor-settings-select w-full text-sm"
    />
    <p className="text-xs text-[var(--color-textMuted)] mt-2">
      {effectivePolicyDescription(effectivePolicy)}
    </p>
    {children}
  </div>
);

const GlobalPolicies: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const rootPolicy = mgr.settings.trustPolicy ?? "tofu";
  const httpsPolicy = mgr.settings.httpsTrustPolicy ?? "inherit";
  const certificatePolicy = mgr.settings.certificateTrustPolicy ?? "inherit";
  const sshPolicy = mgr.settings.sshTrustPolicy ?? "always-ask";
  const rdpPolicy = mgr.settings.rdpTrustPolicy ?? "inherit";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      <PolicyCard
        title="Default Trust Policy"
        icon={<ShieldCheck size={16} />}
        iconClassName="text-success"
        value={rootPolicy}
        options={CONCRETE_POLICY_OPTIONS}
        effectivePolicy={rootPolicy}
        onChange={(v: string) =>
          mgr.updateSettings({
            trustPolicy: v as GlobalSettings["trustPolicy"],
          })
        }
      />

      <PolicyCard
        title="General Certificate Policy"
        icon={<ShieldAlert size={16} />}
        iconClassName="text-primary"
        value={certificatePolicy}
        options={INHERITABLE_POLICY_OPTIONS}
        effectivePolicy={resolveEffectiveTrustPolicy(
          undefined,
          certificatePolicy,
          rootPolicy,
        )}
        onChange={(v: string) =>
          mgr.updateSettings({
            certificateTrustPolicy:
              v as GlobalSettings["certificateTrustPolicy"],
          })
        }
      />

      <PolicyCard
        title="HTTPS Certificate Policy"
        icon={<Lock size={16} />}
        iconClassName="text-success"
        value={httpsPolicy}
        options={INHERITABLE_POLICY_OPTIONS}
        effectivePolicy={resolveEffectiveTrustPolicy(
          undefined,
          httpsPolicy,
          rootPolicy,
        )}
        onChange={(v: string) =>
          mgr.updateSettings({
            httpsTrustPolicy: v as GlobalSettings["httpsTrustPolicy"],
          })
        }
      />

      <PolicyCard
        title="SSH Host Key Policy"
        icon={<Fingerprint size={16} />}
        iconClassName="text-primary"
        value={sshPolicy}
        options={INHERITABLE_POLICY_OPTIONS}
        effectivePolicy={resolveEffectiveTrustPolicy(
          undefined,
          sshPolicy,
          rootPolicy,
        )}
        onChange={(v: string) =>
          mgr.updateSettings({
            sshTrustPolicy: v as GlobalSettings["sshTrustPolicy"],
          })
        }
      />

      <PolicyCard
        title="RDP Certificate Policy"
        icon={<Monitor size={16} />}
        iconClassName="text-warning"
        value={rdpPolicy}
        options={INHERITABLE_POLICY_OPTIONS}
        effectivePolicy={resolveEffectiveTrustPolicy(
          undefined,
          rdpPolicy,
          rootPolicy,
        )}
        onChange={(v: string) =>
          mgr.updateSettings({
            rdpTrustPolicy: v as GlobalSettings["rdpTrustPolicy"],
          })
        }
      >
        <p className="text-[10px] text-[var(--color-textMuted)] mt-2 italic">
          Separate from HTTPS certificates and legacy TLS identities. RDP servers
          are typically self-signed, so most users keep this at TOFU even when
          HTTPS is set to Strict.
        </p>
      </PolicyCard>
    </div>
  );
};

const PolicyExplanations: React.FC = () => (
  <details className="group [&>summary]:list-none bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
    <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors flex items-center gap-2">
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
    <div className="px-4 pb-4 pt-2 space-y-3 text-xs text-[var(--color-textMuted)] leading-relaxed border-t border-[var(--color-border)] mt-1">
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
);

const AdditionalOptions: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <label className="flex items-center gap-3 text-sm text-[var(--color-textSecondary)]">
      <Checkbox checked={mgr.settings.showTrustIdentityInfo ?? true} onChange={(v: boolean) => mgr.updateSettings({ showTrustIdentityInfo: v })} />
      <div className="flex items-center gap-2">
        <Eye size={14} className="text-[var(--color-textSecondary)]" />
        <span>
          Show certificate / host key info in URL bar &amp; terminal toolbar
        </span>
      </div>
    </label>

    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-[var(--color-textSecondary)]" />
        <label className="text-sm text-[var(--color-textSecondary)]">
          Warn when certificates expire within
        </label>
      </div>
      <NumberInput value={mgr.settings.certExpiryWarningDays ?? 5} onChange={(v: number) => mgr.updateSettings({
            certExpiryWarningDays: v,
          })} className="w-20" min={0} max={365} />
      <span className="text-sm text-[var(--color-textSecondary)]">
        days (0 = disabled)
      </span>
    </div>
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
  <div>
    <div className="flex items-center justify-between mb-3">
      <h4 className="sor-section-heading">
        <ShieldAlert size={16} className="text-warning" />
        Stored Identities ({mgr.totalCount})
      </h4>
      <ClearAllButton mgr={mgr} />
    </div>

    {mgr.totalCount === 0 ? (
      <div className="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)] text-center">
        <ShieldCheck size={24} className="text-[var(--color-textMuted)] mx-auto mb-2" />
        <p className="text-sm text-[var(--color-textMuted)]">No stored identities yet.</p>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Identities will appear here as you connect to servers.
        </p>
      </div>
    ) : (
      <div className="space-y-4">
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
      <SectionHeader />
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
