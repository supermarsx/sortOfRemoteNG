import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { GlobalSettings } from '../../../types/settings';
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
} from 'lucide-react';
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
  type ConnectionTrustGroup,
} from '../../../utils/trustStore';
import { useConnections } from '../../../contexts/useConnections';

interface TrustVerificationSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const POLICY_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'tofu', label: 'Trust On First Use (TOFU)', description: 'Silently accept on first connection, warn if it changes later.' },
  { value: 'always-ask', label: 'Always Ask', description: 'Prompt for confirmation on every new identity.' },
  { value: 'always-trust', label: 'Always Trust', description: 'Never check — accept everything without verification.' },
  { value: 'strict', label: 'Strict', description: 'Reject unless the identity has been manually pre-approved.' },
];

export const TrustVerificationSettings: React.FC<TrustVerificationSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const [trustRecords, setTrustRecords] = useState<TrustRecord[]>(() => getAllTrustRecords());
  const [connectionGroups, setConnectionGroups] = useState<ConnectionTrustGroup[]>(() => getAllPerConnectionTrustRecords());
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const { state: connectionState } = useConnections();

  const refreshRecords = useCallback(() => {
    setTrustRecords(getAllTrustRecords());
    setConnectionGroups(getAllPerConnectionTrustRecords());
  }, []);

  useEffect(() => {
    window.addEventListener('trustStoreChanged', refreshRecords);
    return () => window.removeEventListener('trustStoreChanged', refreshRecords);
  }, [refreshRecords]);

  /** Resolve a connection ID to its name, falling back to a truncated ID. */
  const connectionName = useCallback((id: string): string => {
    const conn = connectionState.connections.find(c => c.id === id);
    return conn?.name || `Connection ${id.slice(0, 8)}…`;
  }, [connectionState.connections]);

  const tlsRecords = useMemo(() => trustRecords.filter(r => r.type === 'tls'), [trustRecords]);
  const sshRecords = useMemo(() => trustRecords.filter(r => r.type === 'ssh'), [trustRecords]);

  const handleRemoveRecord = (record: TrustRecord, connectionId?: string) => {
    const [host, portStr] = record.host.split(':');
    const port = parseInt(portStr, 10);
    removeIdentity(host, port, record.type, connectionId);
    refreshRecords();
  };

  const handleClearAll = () => {
    clearAllTrustRecords();
    // Also clear all per-connection stores
    connectionGroups.forEach(g => clearAllTrustRecords(g.connectionId));
    refreshRecords();
    setShowConfirmClear(false);
  };

  const totalCount = trustRecords.length + connectionGroups.reduce((sum, g) => sum + g.records.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <ShieldCheck size={20} className="text-blue-400" />
          Trust &amp; Verification
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          Control how TLS certificates and SSH host keys are verified and memorized.
          These settings apply globally but can be overridden per connection.
        </p>
      </div>

      {/* Global Policies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* TLS Trust Policy */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} className="text-green-400" />
            <h4 className="text-sm font-medium text-white">TLS Certificate Policy</h4>
          </div>
          <select
            value={settings.tlsTrustPolicy ?? 'tofu'}
            onChange={(e) => updateSettings({ tlsTrustPolicy: e.target.value as GlobalSettings['tlsTrustPolicy'] })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {POLICY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2">
            {POLICY_OPTIONS.find(o => o.value === settings.tlsTrustPolicy)?.description}
          </p>
        </div>

        {/* SSH Trust Policy */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <Fingerprint size={16} className="text-blue-400" />
            <h4 className="text-sm font-medium text-white">SSH Host Key Policy</h4>
          </div>
          <select
            value={settings.sshTrustPolicy ?? 'tofu'}
            onChange={(e) => updateSettings({ sshTrustPolicy: e.target.value as GlobalSettings['sshTrustPolicy'] })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-blue-500 text-sm"
          >
            {POLICY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2">
            {POLICY_OPTIONS.find(o => o.value === settings.sshTrustPolicy)?.description}
          </p>
        </div>
      </div>

      {/* Policy Explanations Accordion */}
      <details className="group [&>summary]:list-none bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors flex items-center gap-2">
          <ChevronRight size={14} className="text-[var(--color-textMuted)] transition-transform group-open:rotate-90 flex-shrink-0" />
          <ShieldAlert size={14} className="text-[var(--color-textMuted)] flex-shrink-0" />
          What do these policies mean?
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-3 text-xs text-[var(--color-textMuted)] leading-relaxed border-t border-[var(--color-border)] mt-1">
          <div>
            <span className="text-[var(--color-text)] font-medium">Trust On First Use (TOFU)</span>
            <p className="mt-0.5">
              The first time you connect to a host, its certificate or host key is automatically accepted and stored.
              On subsequent connections the stored identity is compared — if it changed you will see a warning so you
              can decide whether the change is expected (e.g. a certificate renewal) or suspicious.
              This is the recommended default for most users.
            </p>
          </div>
          <div>
            <span className="text-[var(--color-text)] font-medium">Always Ask</span>
            <p className="mt-0.5">
              Every time a new or previously unseen identity is encountered you will be prompted to manually
              approve or reject it. Use this when you prefer explicit confirmation for every identity,
              for example in high-security environments.
            </p>
          </div>
          <div>
            <span className="text-[var(--color-text)] font-medium">Always Trust</span>
            <p className="mt-0.5">
              All certificates and host keys are accepted without any verification or prompts.
              This is convenient for development or lab environments but should <em className="text-[var(--color-textSecondary)] not-italic font-medium">never</em> be
              used in production or on untrusted networks — it leaves you vulnerable to
              man-in-the-middle attacks.
            </p>
          </div>
          <div>
            <span className="text-[var(--color-text)] font-medium">Strict</span>
            <p className="mt-0.5">
              Connections are only allowed if the host&apos;s identity has been manually pre-approved
              and stored beforehand. Any unknown or changed identity is immediately rejected.
              Ideal when you manage a fixed set of known servers and want maximum security.
            </p>
          </div>
        </div>
      </details>

      {/* Additional options */}
      <div className="space-y-4">
        <label className="flex items-center gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={settings.showTrustIdentityInfo ?? true}
            onChange={(e) => updateSettings({ showTrustIdentityInfo: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-gray-400" />
            <span>Show certificate / host key info in URL bar &amp; terminal toolbar</span>
          </div>
        </label>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-gray-400" />
            <label className="text-sm text-gray-300">
              Warn when TLS certificate expires within
            </label>
          </div>
          <input
            type="number"
            min={0}
            max={365}
            value={settings.certExpiryWarningDays ?? 5}
            onChange={(e) => updateSettings({ certExpiryWarningDays: parseInt(e.target.value, 10) || 0 })}
            className="w-20 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-400">days (0 = disabled)</span>
        </div>
      </div>

      {/* Stored Trust Records */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-white flex items-center gap-2">
            <ShieldAlert size={16} className="text-yellow-400" />
            Stored Identities ({totalCount})
          </h4>
          {totalCount > 0 && (
            showConfirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Clear all stored identities?</span>
                <button
                  onClick={handleClearAll}
                  className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                >
                  Yes, clear all
                </button>
                <button
                  onClick={() => setShowConfirmClear(false)}
                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowConfirmClear(true)}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              >
                <Trash2 size={12} />
                Clear All
              </button>
            )
          )}
        </div>

        {totalCount === 0 ? (
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 text-center">
            <ShieldCheck size={24} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No stored identities yet.</p>
            <p className="text-xs text-gray-600 mt-1">
              Identities will appear here as you connect to servers.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Global Store ── */}
            {trustRecords.length > 0 && (
              <details className="group" open>
                <summary className="cursor-pointer select-none text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                  <Globe size={12} />
                  Global Identities ({trustRecords.length})
                </summary>
                <div className="space-y-3 ml-4">
                  {/* TLS Records */}
                  {tlsRecords.length > 0 && (
                    <div>
                      <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Lock size={12} /> TLS Certificates ({tlsRecords.length})
                      </h5>
                      <div className="space-y-2">
                        {tlsRecords.map((record, i) => (
                          <TrustRecordRow key={`tls-${i}`} record={record} onRemove={(r) => handleRemoveRecord(r)} onUpdated={refreshRecords} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SSH Records */}
                  {sshRecords.length > 0 && (
                    <div>
                      <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <Fingerprint size={12} /> SSH Host Keys ({sshRecords.length})
                      </h5>
                      <div className="space-y-2">
                        {sshRecords.map((record, i) => (
                          <TrustRecordRow key={`ssh-${i}`} record={record} onRemove={(r) => handleRemoveRecord(r)} onUpdated={refreshRecords} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* ── Per-Connection Stores ── */}
            {connectionGroups.map(group => {
              const connTls = group.records.filter(r => r.type === 'tls');
              const connSsh = group.records.filter(r => r.type === 'ssh');
              return (
                <details key={group.connectionId} className="group">
                  <summary className="cursor-pointer select-none text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                    <Link2 size={12} />
                    {connectionName(group.connectionId)} ({group.records.length})
                  </summary>
                  <div className="space-y-3 ml-4">
                    {connTls.length > 0 && (
                      <div>
                        <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Lock size={12} /> TLS Certificates ({connTls.length})
                        </h5>
                        <div className="space-y-2">
                          {connTls.map((record, i) => (
                            <TrustRecordRow
                              key={`${group.connectionId}-tls-${i}`}
                              record={record}
                              connectionId={group.connectionId}
                              onRemove={(r) => handleRemoveRecord(r, group.connectionId)}
                              onUpdated={refreshRecords}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {connSsh.length > 0 && (
                      <div>
                        <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Fingerprint size={12} /> SSH Host Keys ({connSsh.length})
                        </h5>
                        <div className="space-y-2">
                          {connSsh.map((record, i) => (
                            <TrustRecordRow
                              key={`${group.connectionId}-ssh-${i}`}
                              record={record}
                              connectionId={group.connectionId}
                              onRemove={(r) => handleRemoveRecord(r, group.connectionId)}
                              onUpdated={refreshRecords}
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
    </div>
  );
};

/** A single trust record row with remove action. */
function TrustRecordRow({ record, connectionId, onRemove, onUpdated }: { record: TrustRecord; connectionId?: string; onRemove: (r: TrustRecord) => void; onUpdated: () => void }) {
  const [editingNick, setEditingNick] = React.useState(false);
  const [nickDraft, setNickDraft] = React.useState(record.nickname ?? '');

  const saveNickname = () => {
    const [h, p] = record.host.split(':');
    updateTrustRecordNickname(h, parseInt(p, 10), record.type, nickDraft.trim(), connectionId);
    setEditingNick(false);
    onUpdated();
  };

  return (
    <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {editingNick ? (
            <input
              autoFocus
              type="text"
              value={nickDraft}
              onChange={(e) => setNickDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNickname();
                else if (e.key === 'Escape') { setNickDraft(record.nickname ?? ''); setEditingNick(false); }
              }}
              onBlur={saveNickname}
              placeholder="Nickname…"
              className="w-40 px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <>
              <span className="text-sm text-white font-medium truncate">{record.nickname || record.host}</span>
              {record.nickname && <span className="text-xs text-gray-500 truncate">({record.host})</span>}
              <button
                onClick={() => { setNickDraft(record.nickname ?? ''); setEditingNick(true); }}
                className="text-gray-500 hover:text-gray-300 p-0.5 transition-colors flex-shrink-0"
                title={record.nickname ? 'Edit nickname' : 'Add nickname'}
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
              {record.history.length} change{record.history.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-[11px] font-mono text-gray-500 truncate mt-0.5">
          {formatFingerprint(record.identity.fingerprint)}
        </p>
        <p className="text-[10px] text-gray-600 mt-0.5">
          First seen: {new Date(record.identity.firstSeen).toLocaleDateString()} · Last: {new Date(record.identity.lastSeen).toLocaleDateString()}
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
