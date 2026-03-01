import React, { useState } from "react";
import { GlobalSettings } from "../../../types/settings";
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
} from "lucide-react";
import {
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
} from "../../../utils/trustStore";
import { useTrustVerificationSettings } from "../../../hooks/settings/useTrustVerificationSettings";
import { Checkbox, NumberInput, Select } from '../../ui/forms';

type Mgr = ReturnType<typeof useTrustVerificationSettings>;

interface TrustVerificationSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const POLICY_OPTIONS: { value: string; label: string; description: string }[] =
  [
    {
      value: "tofu",
      label: "Trust On First Use (TOFU)",
      description:
        "Silently accept on first connection, warn if it changes later.",
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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const SectionHeader: React.FC = () => (
  <div>
    <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
      <Fingerprint className="w-5 h-5" />
      Trust Center
    </h3>
    <p className="text-xs text-[var(--color-textSecondary)] mb-4">
      Control how TLS certificates and SSH host keys are verified and memorized.
      These settings apply globally but can be overridden per connection.
    </p>
  </div>
);

const GlobalPolicies: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    <div className="sor-settings-card">
      <div className="flex items-center gap-2 mb-3">
        <Lock size={16} className="text-green-400" />
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)]">
          TLS Certificate Policy
        </h4>
      </div>
      <Select value={mgr.settings.tlsTrustPolicy ?? "tofu"} onChange={(v: string) =>
          mgr.updateSettings({
            tlsTrustPolicy: v as GlobalSettings["tlsTrustPolicy"],
          })} options={[...POLICY_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))]} className="sor-settings-select w-full text-sm" />
      <p className="text-xs text-gray-500 mt-2">
        {
          POLICY_OPTIONS.find((o) => o.value === mgr.settings.tlsTrustPolicy)
            ?.description
        }
      </p>
    </div>

    <div className="sor-settings-card">
      <div className="flex items-center gap-2 mb-3">
        <Fingerprint size={16} className="text-blue-400" />
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)]">
          SSH Host Key Policy
        </h4>
      </div>
      <Select value={mgr.settings.sshTrustPolicy ?? "tofu"} onChange={(v: string) =>
          mgr.updateSettings({
            sshTrustPolicy: v as GlobalSettings["sshTrustPolicy"],
          })} options={[...POLICY_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))]} className="sor-settings-select w-full text-sm" />
      <p className="text-xs text-gray-500 mt-2">
        {
          POLICY_OPTIONS.find((o) => o.value === mgr.settings.sshTrustPolicy)
            ?.description
        }
      </p>
    </div>
  </div>
);

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
          automatically accepted and stored. On subsequent connections the
          stored identity is compared — if it changed you will see a warning so
          you can decide whether the change is expected (e.g. a certificate
          renewal) or suspicious. This is the recommended default for most
          users.
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
          Warn when TLS certificate expires within
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
        <span className="text-xs text-red-400">
          Clear all stored identities?
        </span>
        <button
          onClick={mgr.handleClearAll}
          className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 text-[var(--color-text)] rounded transition-colors"
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

const StoredIdentitiesSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div>
    <div className="flex items-center justify-between mb-3">
      <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
        <ShieldAlert size={16} className="text-yellow-400" />
        Stored Identities ({mgr.totalCount})
      </h4>
      <ClearAllButton mgr={mgr} />
    </div>

    {mgr.totalCount === 0 ? (
      <div className="bg-[var(--color-surface)] rounded-lg p-6 border border-[var(--color-border)] text-center">
        <ShieldCheck size={24} className="text-gray-500 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No stored identities yet.</p>
        <p className="text-xs text-gray-600 mt-1">
          Identities will appear here as you connect to servers.
        </p>
      </div>
    ) : (
      <div className="space-y-4">
        {/* Global Store */}
        {mgr.trustRecords.length > 0 && (
          <details className="group" open>
            <summary className="cursor-pointer select-none text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
              <ChevronRight
                size={12}
                className="transition-transform group-open:rotate-90"
              />
              <Globe size={12} />
              Global Identities ({mgr.trustRecords.length})
            </summary>
            <div className="space-y-3 ml-4">
              {mgr.tlsRecords.length > 0 && (
                <div>
                  <h5 className="text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Lock size={12} /> TLS Certificates ({mgr.tlsRecords.length}
                    )
                  </h5>
                  <div className="space-y-2">
                    {mgr.tlsRecords.map((record, i) => (
                      <TrustRecordRow
                        key={`tls-${i}`}
                        record={record}
                        onRemove={(r) => mgr.handleRemoveRecord(r)}
                        onUpdated={mgr.refreshRecords}
                      />
                    ))}
                  </div>
                </div>
              )}

              {mgr.sshRecords.length > 0 && (
                <div>
                  <h5 className="text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Fingerprint size={12} /> SSH Host Keys (
                    {mgr.sshRecords.length})
                  </h5>
                  <div className="space-y-2">
                    {mgr.sshRecords.map((record, i) => (
                      <TrustRecordRow
                        key={`ssh-${i}`}
                        record={record}
                        onRemove={(r) => mgr.handleRemoveRecord(r)}
                        onUpdated={mgr.refreshRecords}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Per-Connection Stores */}
        {mgr.connectionGroups.map((group) => {
          const connTls = group.records.filter((r) => r.type === "tls");
          const connSsh = group.records.filter((r) => r.type === "ssh");
          return (
            <details key={group.connectionId} className="group">
              <summary className="cursor-pointer select-none text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                <ChevronRight
                  size={12}
                  className="transition-transform group-open:rotate-90"
                />
                <Link2 size={12} />
                {mgr.connectionName(group.connectionId)} (
                {group.records.length})
              </summary>
              <div className="space-y-3 ml-4">
                {connTls.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Lock size={12} /> TLS Certificates ({connTls.length})
                    </h5>
                    <div className="space-y-2">
                      {connTls.map((record, i) => (
                        <TrustRecordRow
                          key={`${group.connectionId}-tls-${i}`}
                          record={record}
                          connectionId={group.connectionId}
                          onRemove={(r) =>
                            mgr.handleRemoveRecord(r, group.connectionId)
                          }
                          onUpdated={mgr.refreshRecords}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {connSsh.length > 0 && (
                  <div>
                    <h5 className="text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Fingerprint size={12} /> SSH Host Keys ({connSsh.length})
                    </h5>
                    <div className="space-y-2">
                      {connSsh.map((record, i) => (
                        <TrustRecordRow
                          key={`${group.connectionId}-ssh-${i}`}
                          record={record}
                          connectionId={group.connectionId}
                          onRemove={(r) =>
                            mgr.handleRemoveRecord(r, group.connectionId)
                          }
                          onUpdated={mgr.refreshRecords}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
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
              className="sor-settings-input sor-settings-input-compact w-40 text-sm text-gray-200 placeholder-gray-500"
            />
          ) : (
            <>
              <span className="text-sm text-[var(--color-text)] font-medium truncate">
                {record.nickname || record.host}
              </span>
              {record.nickname && (
                <span className="text-xs text-gray-500 truncate">
                  ({record.host})
                </span>
              )}
              <button
                onClick={() => {
                  setNickDraft(record.nickname ?? "");
                  setEditingNick(true);
                }}
                className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5 transition-colors flex-shrink-0"
                title={record.nickname ? "Edit nickname" : "Add nickname"}
              >
                <Pencil size={10} />
              </button>
            </>
          )}
          {record.userApproved && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-700/50">
              approved
            </span>
          )}
          {record.history && record.history.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-700/50 flex items-center gap-0.5">
              <AlertTriangle size={8} />
              {record.history.length} change
              {record.history.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="text-[11px] font-mono text-gray-500 truncate mt-0.5">
          {formatFingerprint(record.identity.fingerprint)}
        </p>
        <p className="text-[10px] text-gray-600 mt-0.5">
          First seen: {new Date(record.identity.firstSeen).toLocaleDateString()}{" "}
          · Last: {new Date(record.identity.lastSeen).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={() => onRemove(record)}
        className="text-gray-500 hover:text-red-400 p-1 transition-colors flex-shrink-0"
        title="Remove stored identity"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
