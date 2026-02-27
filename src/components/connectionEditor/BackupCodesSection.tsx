import React, { useState, useMemo } from 'react';
import {
  KeyRound, ChevronDown, ChevronUp, Copy, Check, RefreshCw, Trash2,
} from 'lucide-react';
import { Connection } from '../../types/connection';
import { TOTPConfig } from '../../types/settings';
import { TOTPService } from '../../utils/totpService';

interface BackupCodesSectionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const BackupCodesSection: React.FC<BackupCodesSectionProps> = ({ formData, setFormData }) => {
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const totpService = useMemo(() => new TOTPService(), []);
  const configs = formData.totpConfigs ?? [];

  // Only show if there are TOTP configs and not a group
  if (formData.isGroup || configs.length === 0) return null;

  const configsWithBackup = configs.filter(c => c.backupCodes && c.backupCodes.length > 0);
  const totalBackupCodes = configsWithBackup.reduce((sum, c) => sum + (c.backupCodes?.length ?? 0), 0);

  const updateConfigs = (newConfigs: TOTPConfig[]) => {
    setFormData(prev => ({ ...prev, totpConfigs: newConfigs }));
  };

  const generateBackupForAll = () => {
    const updated = configs.map(cfg => ({
      ...cfg,
      backupCodes: totpService.generateBackupCodes(10),
    }));
    updateConfigs(updated);
  };

  const generateBackupFor = (secret: string) => {
    const updated = configs.map(cfg =>
      cfg.secret === secret
        ? { ...cfg, backupCodes: totpService.generateBackupCodes(10) }
        : cfg
    );
    updateConfigs(updated);
  };

  const clearBackupFor = (secret: string) => {
    const updated = configs.map(cfg =>
      cfg.secret === secret
        ? { ...cfg, backupCodes: undefined }
        : cfg
    );
    updateConfigs(updated);
  };

  const copyAll = (codes: string[], key: string) => {
    navigator.clipboard.writeText(codes.join('\n'));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/40 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <KeyRound size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">
            Backup / Recovery Codes
          </span>
          {totalBackupCodes > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded-full">
              {totalBackupCodes} codes
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Backup codes provide emergency access when your authenticator app is unavailable.
            Each code can be used once. Store them in a secure location.
          </p>

          {/* Generate all button */}
          <button
            type="button"
            onClick={generateBackupForAll}
            className="flex items-center space-x-1.5 text-xs text-gray-400 hover:text-white transition-colors bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded"
          >
            <RefreshCw size={12} />
            <span>{configsWithBackup.length > 0 ? 'Regenerate all backup codes' : 'Generate backup codes for all accounts'}</span>
          </button>

          {/* Per-account backup codes */}
          {configs.map(cfg => {
            const hasCodes = cfg.backupCodes && cfg.backupCodes.length > 0;
            const copyKey = `backup-${cfg.secret}`;

            return (
              <div key={cfg.secret} className="bg-gray-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <KeyRound size={12} className="text-gray-500" />
                    <span className="text-xs font-medium text-gray-300">{cfg.account}</span>
                    <span className="text-[10px] text-gray-600">({cfg.issuer})</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {hasCodes && (
                      <>
                        <button
                          type="button"
                          onClick={() => copyAll(cfg.backupCodes!, copyKey)}
                          className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                          title="Copy all codes"
                        >
                          {copiedKey === copyKey ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => clearBackupFor(cfg.secret)}
                          className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                          title="Clear codes"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => generateBackupFor(cfg.secret)}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title={hasCodes ? 'Regenerate codes' : 'Generate codes'}
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                </div>

                {hasCodes ? (
                  <div className="grid grid-cols-2 gap-1">
                    {cfg.backupCodes!.map((code, i) => (
                      <span
                        key={i}
                        className="font-mono text-[11px] text-gray-300 bg-gray-700/50 rounded px-2 py-0.5 text-center select-all"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-600 text-center py-1">
                    No backup codes generated yet
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BackupCodesSection;
