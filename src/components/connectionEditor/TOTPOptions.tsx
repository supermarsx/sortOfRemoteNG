import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield, Plus, Trash2, Copy, Check, ChevronDown, ChevronUp,
  Eye, EyeOff, Pencil, Download, Upload, KeyRound, QrCode,
} from 'lucide-react';
import { Connection } from '../../types/connection';
import { TOTPConfig } from '../../types/settings';
import { TOTPService } from '../../utils/totpService';
import { useSettings } from '../../contexts/SettingsContext';

interface TOTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const TOTPOptions: React.FC<TOTPOptionsProps> = ({ formData, setFormData }) => {
  const { settings } = useSettings();
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAccount, setNewAccount] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newIssuer, setNewIssuer] = useState(settings.totpIssuer || 'sortOfRemoteNG');
  const [newDigits, setNewDigits] = useState<number>(settings.totpDigits || 6);
  const [newPeriod, setNewPeriod] = useState<number>(settings.totpPeriod || 30);
  const [newAlgorithm, setNewAlgorithm] = useState<string>(settings.totpAlgorithm || 'sha1');
  const [showNewSecret, setShowNewSecret] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<TOTPConfig>>({});
  const [showBackup, setShowBackup] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const totpService = useMemo(() => new TOTPService(), []);
  const configs = formData.totpConfigs ?? [];
  const configsRef = useRef(configs);
  configsRef.current = configs;

  if (formData.isGroup) return null;

  const refreshCodes = useCallback(() => {
    const c: Record<string, string> = {};
    configsRef.current.forEach((cfg) => {
      if (cfg.secret) {
        c[cfg.secret] = totpService.generateToken(cfg.secret, cfg);
      }
    });
    setCodes(c);
  }, [totpService]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!expanded || configs.length === 0) return;
    refreshCodes();
    const interval = setInterval(refreshCodes, 1000);
    return () => clearInterval(interval);
  }, [expanded, configs.length, refreshCodes]);

  const updateConfigs = (newConfigs: TOTPConfig[]) => {
    setFormData(prev => ({ ...prev, totpConfigs: newConfigs }));
  };

  const handleAdd = async () => {
    if (!newAccount) return;
    const secret = newSecret || totpService.generateSecret();
    const config: TOTPConfig = {
      secret,
      issuer: newIssuer || settings.totpIssuer || 'sortOfRemoteNG',
      account: newAccount,
      digits: newDigits,
      period: newPeriod,
      algorithm: newAlgorithm as TOTPConfig['algorithm'],
      createdAt: new Date().toISOString(),
    };
    updateConfigs([...configs, config]);

    // Generate QR
    try {
      const url = await totpService.generateQRCode(config);
      setQrDataUrl(url);
    } catch { /* ignore */ }

    setNewAccount('');
    setNewSecret('');
    setNewIssuer(settings.totpIssuer || 'sortOfRemoteNG');
    setNewDigits(settings.totpDigits || 6);
    setNewPeriod(settings.totpPeriod || 30);
    setNewAlgorithm(settings.totpAlgorithm || 'sha1');
    setShowNewSecret(false);
    setShowAddForm(false);
  };

  const handleDelete = (secret: string) => {
    updateConfigs(configs.filter((c) => c.secret !== secret));
  };

  const copyCode = (secret: string) => {
    const code = codes[secret];
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedSecret(secret);
      setTimeout(() => setCopiedSecret(null), 1500);
    }
  };

  const toggleReveal = (secret: string) => {
    setRevealedSecrets(prev => {
      const next = new Set(prev);
      if (next.has(secret)) next.delete(secret);
      else next.add(secret);
      return next;
    });
  };

  const startEdit = (cfg: TOTPConfig) => {
    setEditingSecret(cfg.secret);
    setEditData({ account: cfg.account, issuer: cfg.issuer, digits: cfg.digits, period: cfg.period, algorithm: cfg.algorithm });
  };

  const saveEdit = () => {
    if (!editingSecret) return;
    updateConfigs(configs.map(c =>
      c.secret === editingSecret ? { ...c, ...editData } : c
    ));
    setEditingSecret(null);
    setEditData({});
  };

  const cancelEdit = () => {
    setEditingSecret(null);
    setEditData({});
  };

  const generateBackup = (secret: string) => {
    const backupCodes = totpService.generateBackupCodes(10);
    updateConfigs(configs.map(c =>
      c.secret === secret ? { ...c, backupCodes } : c
    ));
    setShowBackup(secret);
  };

  const copyAllBackup = (backupCodes: string[]) => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopiedSecret('backup');
    setTimeout(() => setCopiedSecret(null), 1500);
  };

  const handleExport = () => {
    const json = JSON.stringify(configs, null, 2);
    navigator.clipboard.writeText(json);
    setCopiedSecret('export');
    setTimeout(() => setCopiedSecret(null), 1500);
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) throw new Error('Expected array');
      for (const c of parsed) {
        if (!c.secret || !c.account) throw new Error('Each entry needs secret and account');
      }
      const existingSecrets = new Set(configs.map(c => c.secret));
      const newConfigs = (parsed as TOTPConfig[]).filter(c => !existingSecrets.has(c.secret));
      if (newConfigs.length > 0) {
        updateConfigs([...configs, ...newConfigs]);
      }
      setShowImport(false);
      setImportText('');
      setImportError('');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const getTimeRemaining = (period: number = 30) => {
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
  };

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/40 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Shield size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">
            2FA / TOTP
          </span>
          {configs.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded-full">
              {configs.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-700">
          {/* Import/Export header */}
          <div className="flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center space-x-1 text-[10px] text-gray-400 hover:text-white transition-colors"
              title="Export to clipboard"
            >
              <Download size={11} />
              <span>Export</span>
              {copiedSecret === 'export' && <Check size={10} className="text-green-400" />}
            </button>
            <button
              type="button"
              onClick={() => setShowImport(!showImport)}
              className="flex items-center space-x-1 text-[10px] text-gray-400 hover:text-white transition-colors"
              title="Import from JSON"
            >
              <Upload size={11} />
              <span>Import</span>
            </button>
          </div>

          {/* Import form */}
          {showImport && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
              <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                Import TOTP Configs (JSON)
              </div>
              <textarea
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportError(''); }}
                placeholder='[{"secret":"...","account":"...","issuer":"...","digits":6,"period":30,"algorithm":"sha1"}]'
                className="w-full h-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-[10px] text-white font-mono placeholder-gray-500 resize-none"
              />
              {importError && <div className="text-[10px] text-red-400">{importError}</div>}
              <div className="flex justify-end space-x-2">
                <button type="button" onClick={() => { setShowImport(false); setImportText(''); setImportError(''); }} className="px-2 py-1 text-[10px] text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button type="button" onClick={handleImport} className="px-2 py-1 text-[10px] bg-gray-600 hover:bg-gray-500 text-white rounded">
                  Import
                </button>
              </div>
            </div>
          )}

          {/* QR Code display */}
          {qrDataUrl && (
            <div className="bg-gray-800 rounded-lg p-3 flex flex-col items-center space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="TOTP QR Code" className="w-40 h-40 rounded" />
              <p className="text-[10px] text-gray-400">Scan with your authenticator app</p>
              <button
                type="button"
                onClick={() => setQrDataUrl(null)}
                className="text-[10px] text-gray-400 hover:text-white transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Existing configs */}
          {configs.length === 0 && !showAddForm && (
            <p className="text-xs text-gray-500 text-center py-2">
              No 2FA configurations. Add one to enable TOTP for this connection.
            </p>
          )}

          {configs.map((cfg) => {
            const remaining = getTimeRemaining(cfg.period);
            const progress = remaining / (cfg.period || 30);
            const isEditing = editingSecret === cfg.secret;
            const isRevealed = revealedSecrets.has(cfg.secret);
            const showingBackup = showBackup === cfg.secret && cfg.backupCodes && cfg.backupCodes.length > 0;

            if (isEditing) {
              return (
                <div key={cfg.secret} className="bg-gray-800 rounded-lg p-3 space-y-2">
                  <input
                    type="text"
                    value={editData.account ?? ''}
                    onChange={(e) => setEditData(d => ({ ...d, account: e.target.value }))}
                    placeholder="Account"
                    className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                  />
                  <input
                    type="text"
                    value={editData.issuer ?? ''}
                    onChange={(e) => setEditData(d => ({ ...d, issuer: e.target.value }))}
                    placeholder="Issuer"
                    className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                  />
                  <div className="flex space-x-2">
                    <select
                      value={editData.digits ?? 6}
                      onChange={(e) => setEditData(d => ({ ...d, digits: parseInt(e.target.value) }))}
                      className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                    >
                      <option value={6}>6 digits</option>
                      <option value={8}>8 digits</option>
                    </select>
                    <select
                      value={editData.period ?? 30}
                      onChange={(e) => setEditData(d => ({ ...d, period: parseInt(e.target.value) }))}
                      className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                    >
                      <option value={15}>15s period</option>
                      <option value={30}>30s period</option>
                      <option value={60}>60s period</option>
                    </select>
                    <select
                      value={editData.algorithm ?? 'sha1'}
                      onChange={(e) => setEditData(d => ({ ...d, algorithm: e.target.value as TOTPConfig['algorithm'] }))}
                      className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                    >
                      <option value="sha1">SHA-1</option>
                      <option value="sha256">SHA-256</option>
                      <option value="sha512">SHA-512</option>
                    </select>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button type="button" onClick={cancelEdit} className="px-3 py-1 text-xs text-gray-400 hover:text-white">
                      Cancel
                    </button>
                    <button type="button" onClick={saveEdit} className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded">
                      Save
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={cfg.secret}>
                <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1">
                      <span className="text-xs text-gray-400 truncate">{cfg.account}</span>
                      <span className="text-[10px] text-gray-600">({cfg.issuer})</span>
                    </div>
                    <div className="flex items-center space-x-2 mt-0.5">
                      <span className="font-mono text-base text-gray-200 tracking-wider">
                        {codes[cfg.secret] || '------'}
                      </span>
                      <div className="flex items-center space-x-1">
                        <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-1000 ${
                              remaining <= 5 ? 'bg-red-500' : 'bg-gray-400'
                            }`}
                            style={{ width: `${progress * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500 w-4 text-right">{remaining}</span>
                      </div>
                    </div>
                    {/* Secret reveal */}
                    {isRevealed && (
                      <div className="mt-0.5 font-mono text-[10px] text-gray-500 break-all select-all">
                        {cfg.secret}
                      </div>
                    )}
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {cfg.digits} digits · {cfg.period}s · {cfg.algorithm.toUpperCase()}
                      {cfg.createdAt && ` · ${new Date(cfg.createdAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex items-center space-x-0.5 ml-2">
                    {/* Copy code */}
                    <button
                      type="button"
                      onClick={() => copyCode(cfg.secret)}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title="Copy code"
                    >
                      {copiedSecret === cfg.secret ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                    </button>
                    {/* Reveal secret */}
                    <button
                      type="button"
                      onClick={() => toggleReveal(cfg.secret)}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title={isRevealed ? 'Hide secret' : 'Show secret'}
                    >
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    {/* Backup codes */}
                    <button
                      type="button"
                      onClick={() => {
                        if (cfg.backupCodes && cfg.backupCodes.length > 0) {
                          setShowBackup(showBackup === cfg.secret ? null : cfg.secret);
                        } else {
                          generateBackup(cfg.secret);
                        }
                      }}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title="Backup codes"
                    >
                      <KeyRound size={12} />
                    </button>
                    {/* Edit */}
                    <button
                      type="button"
                      onClick={() => startEdit(cfg)}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => handleDelete(cfg.secret)}
                      className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {/* Backup codes expansion */}
                {showingBackup && (
                  <div className="bg-gray-800/60 rounded-b-lg px-3 py-2 -mt-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                        Backup Codes
                      </span>
                      <button
                        type="button"
                        onClick={() => copyAllBackup(cfg.backupCodes!)}
                        className="text-[10px] text-gray-400 hover:text-white transition-colors flex items-center space-x-1"
                      >
                        <Copy size={10} />
                        <span>Copy all</span>
                        {copiedSecret === 'backup' && <Check size={10} className="text-green-400" />}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {cfg.backupCodes!.map((code, i) => (
                        <span key={i} className="font-mono text-[10px] text-gray-300 bg-gray-700/50 rounded px-1.5 py-0.5 text-center">
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add form */}
          {showAddForm ? (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
              <input
                type="text"
                value={newAccount}
                onChange={(e) => setNewAccount(e.target.value)}
                placeholder="Account name (e.g. admin@server)"
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500"
              />
              <input
                type="text"
                value={newIssuer}
                onChange={(e) => setNewIssuer(e.target.value)}
                placeholder="Issuer"
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500"
              />
              <div className="relative">
                <input
                  type={showNewSecret ? 'text' : 'password'}
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder="Secret key (auto-generated if empty)"
                  className="w-full px-2 py-1.5 pr-8 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowNewSecret(!showNewSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showNewSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="flex space-x-2">
                <select
                  value={newDigits}
                  onChange={(e) => setNewDigits(parseInt(e.target.value))}
                  className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                >
                  <option value={6}>6 digits</option>
                  <option value={8}>8 digits</option>
                </select>
                <select
                  value={newPeriod}
                  onChange={(e) => setNewPeriod(parseInt(e.target.value))}
                  className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                >
                  <option value={15}>15s period</option>
                  <option value={30}>30s period</option>
                  <option value={60}>60s period</option>
                </select>
                <select
                  value={newAlgorithm}
                  onChange={(e) => setNewAlgorithm(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                >
                  <option value="sha1">SHA-1</option>
                  <option value="sha256">SHA-256</option>
                  <option value="sha512">SHA-512</option>
                </select>
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="flex items-center space-x-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <Plus size={12} />
              <span>Add TOTP configuration</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TOTPOptions;
