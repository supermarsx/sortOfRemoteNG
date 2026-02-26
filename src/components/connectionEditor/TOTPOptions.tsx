import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Shield, Plus, Trash2, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Connection } from '../../types/connection';
import { TOTPConfig } from '../../types/settings';
import { TOTPService } from '../../utils/totpService';

interface TOTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const TOTPOptions: React.FC<TOTPOptionsProps> = ({ formData, setFormData }) => {
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAccount, setNewAccount] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newDigits, setNewDigits] = useState<number>(6);
  const [newPeriod, setNewPeriod] = useState<number>(30);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);

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

  const handleAdd = () => {
    if (!newAccount) return;
    const secret = newSecret || totpService.generateSecret();
    const config: TOTPConfig = {
      secret,
      issuer: 'sortOfRemoteNG',
      account: newAccount,
      digits: newDigits,
      period: newPeriod,
      algorithm: 'sha1',
    };
    updateConfigs([...configs, config]);
    setNewAccount('');
    setNewSecret('');
    setNewDigits(6);
    setNewPeriod(30);
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
          {/* Existing configs */}
          {configs.length === 0 && !showAddForm && (
            <p className="text-xs text-gray-500 text-center py-2">
              No 2FA configurations. Add one to enable TOTP for this connection.
            </p>
          )}

          {configs.map((cfg) => {
            const remaining = getTimeRemaining(cfg.period);
            const progress = remaining / (cfg.period || 30);
            return (
              <div
                key={cfg.secret}
                className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400 truncate">{cfg.account}</div>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span className="font-mono text-base text-gray-200 tracking-wider">
                      {codes[cfg.secret] || '------'}
                    </span>
                    <div className="flex items-center space-x-1">
                      <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gray-400 transition-all duration-1000"
                          style={{ width: `${progress * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 w-4 text-right">{remaining}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {cfg.digits} digits · {cfg.period}s · {cfg.issuer}
                  </div>
                </div>
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    type="button"
                    onClick={() => copyCode(cfg.secret)}
                    className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                    title="Copy code"
                  >
                    {copiedSecret === cfg.secret ? <Check size={12} /> : <Copy size={12} />}
                  </button>
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
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder="Secret key (auto-generated if empty)"
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500"
              />
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
                  <option value={30}>30s period</option>
                  <option value={60}>60s period</option>
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
