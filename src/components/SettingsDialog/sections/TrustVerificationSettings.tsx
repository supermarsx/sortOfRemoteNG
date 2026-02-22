import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import {
  getAllTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  type TrustRecord,
} from '../../../utils/trustStore';

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
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const tlsRecords = useMemo(() => trustRecords.filter(r => r.type === 'tls'), [trustRecords]);
  const sshRecords = useMemo(() => trustRecords.filter(r => r.type === 'ssh'), [trustRecords]);

  const handleRemoveRecord = (record: TrustRecord) => {
    const [host, portStr] = record.host.split(':');
    const port = parseInt(portStr, 10);
    removeIdentity(host, port, record.type);
    setTrustRecords(getAllTrustRecords());
  };

  const handleClearAll = () => {
    clearAllTrustRecords();
    setTrustRecords([]);
    setShowConfirmClear(false);
  };

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
            value={settings.tlsTrustPolicy}
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
            value={settings.sshTrustPolicy}
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

      {/* Additional options */}
      <div className="space-y-4">
        <label className="flex items-center gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={settings.showTrustIdentityInfo}
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
            value={settings.certExpiryWarningDays}
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
            Stored Identities ({trustRecords.length})
          </h4>
          {trustRecords.length > 0 && (
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

        {trustRecords.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 text-center">
            <ShieldCheck size={24} className="text-gray-500 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No stored identities yet.</p>
            <p className="text-xs text-gray-600 mt-1">
              Identities will appear here as you connect to servers.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* TLS Records */}
            {tlsRecords.length > 0 && (
              <div>
                <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Lock size={12} /> TLS Certificates ({tlsRecords.length})
                </h5>
                <div className="space-y-2">
                  {tlsRecords.map((record, i) => (
                    <TrustRecordRow key={`tls-${i}`} record={record} onRemove={handleRemoveRecord} />
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
                    <TrustRecordRow key={`ssh-${i}`} record={record} onRemove={handleRemoveRecord} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** A single trust record row with remove action. */
function TrustRecordRow({ record, onRemove }: { record: TrustRecord; onRemove: (r: TrustRecord) => void }) {
  return (
    <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white font-medium truncate">{record.host}</span>
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
