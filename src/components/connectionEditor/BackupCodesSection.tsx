import React, { useState, useMemo } from 'react';
import {
  KeyRound, ChevronDown, ChevronUp, Copy, Check, RefreshCw, Trash2,
  ClipboardPaste, Plus, X,
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
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [addSingleTarget, setAddSingleTarget] = useState<string | null>(null);
  const [singleCode, setSingleCode] = useState('');

  const totpService = useMemo(() => new TOTPService(), []);
  const configs = formData.totpConfigs ?? [];

  // Only show if there are TOTP configs and not a group
  if (formData.isGroup || configs.length === 0) return null;

  const configsWithBackup = configs.filter(c => c.backupCodes && c.backupCodes.length > 0);
  const totalBackupCodes = configsWithBackup.reduce((sum, c) => sum + (c.backupCodes?.length ?? 0), 0);

  const updateConfigs = (newConfigs: TOTPConfig[]) => {
    setFormData(prev => ({ ...prev, totpConfigs: newConfigs }));
  };

  // Parse pasted text into individual codes (one per line, comma-separated, or space-separated)
  const parseCodes = (text: string): string[] => {
    return text
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const handlePasteCodes = (secret: string) => {
    const codes = parseCodes(pasteText);
    if (codes.length === 0) return;
    const updated = configs.map(cfg =>
      cfg.secret === secret
        ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), ...codes] }
        : cfg
    );
    updateConfigs(updated);
    setPasteText('');
    setPasteTarget(null);
  };

  const handleAddSingleCode = (secret: string) => {
    const code = singleCode.trim();
    if (!code) return;
    const updated = configs.map(cfg =>
      cfg.secret === secret
        ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), code] }
        : cfg
    );
    updateConfigs(updated);
    setSingleCode('');
    setAddSingleTarget(null);
  };

  const removeCode = (secret: string, index: number) => {
    const updated = configs.map(cfg => {
      if (cfg.secret !== secret || !cfg.backupCodes) return cfg;
      const newCodes = [...cfg.backupCodes];
      newCodes.splice(index, 1);
      return { ...cfg, backupCodes: newCodes.length > 0 ? newCodes : undefined };
    });
    updateConfigs(updated);
  };

  const generateBackupFor = (secret: string) => {
    const backupCodes = totpService.generateBackupCodes(10);
    const updated = configs.map(cfg =>
      cfg.secret === secret
        ? { ...cfg, backupCodes: [...(cfg.backupCodes ?? []), ...backupCodes] }
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
            Paste recovery codes from your TOTP provider (Google, Microsoft, etc.) to store
            them alongside the connection. You can also generate your own codes.
          </p>

          {/* Per-account backup codes */}
          {configs.map(cfg => {
            const hasCodes = cfg.backupCodes && cfg.backupCodes.length > 0;
            const copyKey = `backup-${cfg.secret}`;
            const isPasting = pasteTarget === cfg.secret;
            const isAddingSingle = addSingleTarget === cfg.secret;

            return (
              <div key={cfg.secret} className="bg-gray-800 rounded-lg p-3 space-y-2">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <KeyRound size={12} className="text-gray-500" />
                    <span className="text-xs font-medium text-gray-300">{cfg.account}</span>
                    <span className="text-[10px] text-gray-600">({cfg.issuer})</span>
                    {hasCodes && (
                      <span className="text-[10px] text-gray-600">
                        {cfg.backupCodes!.length} codes
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-1">
                    {/* Paste codes */}
                    <button
                      type="button"
                      onClick={() => {
                        setPasteTarget(isPasting ? null : cfg.secret);
                        setAddSingleTarget(null);
                        setPasteText('');
                      }}
                      className={`p-1 rounded transition-colors ${isPasting ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                      title="Paste recovery codes"
                    >
                      <ClipboardPaste size={12} />
                    </button>
                    {/* Add single code */}
                    <button
                      type="button"
                      onClick={() => {
                        setAddSingleTarget(isAddingSingle ? null : cfg.secret);
                        setPasteTarget(null);
                        setSingleCode('');
                      }}
                      className={`p-1 rounded transition-colors ${isAddingSingle ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                      title="Add a single code"
                    >
                      <Plus size={12} />
                    </button>
                    {/* Copy all */}
                    {hasCodes && (
                      <button
                        type="button"
                        onClick={() => copyAll(cfg.backupCodes!, copyKey)}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        title="Copy all codes"
                      >
                        {copiedKey === copyKey ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                      </button>
                    )}
                    {/* Generate */}
                    <button
                      type="button"
                      onClick={() => generateBackupFor(cfg.secret)}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title="Generate 10 random codes"
                    >
                      <RefreshCw size={12} />
                    </button>
                    {/* Clear all */}
                    {hasCodes && (
                      <button
                        type="button"
                        onClick={() => clearBackupFor(cfg.secret)}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        title="Clear all codes"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Paste area */}
                {isPasting && (
                  <div className="space-y-1.5">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="Paste recovery codes here (one per line, or comma-separated)"
                      className="w-full h-24 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white font-mono placeholder-gray-500 resize-none"
                      autoFocus
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">
                        {parseCodes(pasteText).length > 0
                          ? `${parseCodes(pasteText).length} code(s) detected`
                          : 'Paste codes from your provider'}
                      </span>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={() => { setPasteTarget(null); setPasteText(''); }}
                          className="px-2 py-1 text-[10px] text-gray-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePasteCodes(cfg.secret)}
                          disabled={parseCodes(pasteText).length === 0}
                          className="px-2 py-1 text-[10px] bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-600 text-white rounded"
                        >
                          Save codes
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Add single code */}
                {isAddingSingle && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={singleCode}
                      onChange={(e) => setSingleCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddSingleCode(cfg.secret);
                        if (e.key === 'Escape') { setAddSingleTarget(null); setSingleCode(''); }
                      }}
                      placeholder="Enter recovery code"
                      className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white font-mono placeholder-gray-500"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleAddSingleCode(cfg.secret)}
                      disabled={!singleCode.trim()}
                      className="px-2 py-1 text-[10px] bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-600 text-white rounded"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddSingleTarget(null); setSingleCode(''); }}
                      className="p-1 text-gray-400 hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {/* Codes grid */}
                {hasCodes ? (
                  <div className="grid grid-cols-2 gap-1">
                    {cfg.backupCodes!.map((code, i) => (
                      <div
                        key={i}
                        className="group flex items-center justify-between font-mono text-[11px] text-gray-300 bg-gray-700/50 rounded px-2 py-0.5"
                      >
                        <span className="select-all">{code}</span>
                        <button
                          type="button"
                          onClick={() => removeCode(cfg.secret, i)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-red-400 transition-opacity"
                          title="Remove code"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-600 text-center py-1">
                    No recovery codes stored — paste from your provider or generate new ones
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
