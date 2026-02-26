import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, Plus, Trash2, Copy, Shield, Check } from 'lucide-react';
import { TOTPConfig } from '../../types/settings';
import { TOTPService } from '../../utils/totpService';

interface RDPTotpPanelProps {
  configs: TOTPConfig[];
  onUpdate: (configs: TOTPConfig[]) => void;
  onClose: () => void;
}

export default function RDPTotpPanel({ configs, onUpdate, onClose }: RDPTotpPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newAccount, setNewAccount] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newDigits, setNewDigits] = useState<number>(6);
  const [newPeriod, setNewPeriod] = useState<number>(30);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);

  const totpService = useMemo(() => new TOTPService(), []);
  const configsRef = useRef(configs);
  configsRef.current = configs;

  const refreshCodes = useCallback(() => {
    const c: Record<string, string> = {};
    configsRef.current.forEach((cfg) => {
      if (cfg.secret) {
        c[cfg.secret] = totpService.generateToken(cfg.secret, cfg);
      }
    });
    setCodes(c);
  }, [totpService]);

  useEffect(() => {
    refreshCodes();
    const interval = setInterval(refreshCodes, 1000);
    return () => clearInterval(interval);
  }, [refreshCodes]);

  // Also refresh when configs change
  useEffect(() => {
    refreshCodes();
  }, [configs, refreshCodes]);

  const getTimeRemaining = (period: number = 30) => {
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
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
    onUpdate([...configs, config]);
    setNewAccount('');
    setNewSecret('');
    setNewDigits(6);
    setNewPeriod(30);
    setShowAdd(false);
  };

  const handleDelete = (secret: string) => {
    onUpdate(configs.filter((c) => c.secret !== secret));
  };

  const copyCode = (secret: string) => {
    const code = codes[secret];
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedSecret(secret);
      setTimeout(() => setCopiedSecret(null), 1500);
    }
  };

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/80">
        <div className="flex items-center space-x-2">
          <Shield size={14} className="text-blue-400" />
          <span className="text-xs font-semibold text-white">2FA Codes</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
            title="Add TOTP"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="p-3 border-b border-gray-700 space-y-2">
          <input
            type="text"
            value={newAccount}
            onChange={(e) => setNewAccount(e.target.value)}
            placeholder="Account name"
            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
          />
          <input
            type="text"
            value={newSecret}
            onChange={(e) => setNewSecret(e.target.value)}
            placeholder="Secret (auto-generated if empty)"
            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-500"
          />
          <div className="flex space-x-2">
            <select
              value={newDigits}
              onChange={(e) => setNewDigits(parseInt(e.target.value))}
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
            >
              <option value={6}>6 digits</option>
              <option value={8}>8 digits</option>
            </select>
            <select
              value={newPeriod}
              onChange={(e) => setNewPeriod(parseInt(e.target.value))}
              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white"
            >
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* TOTP List */}
      <div className="max-h-64 overflow-y-auto">
        {configs.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            No 2FA codes configured
          </div>
        ) : (
          configs.map((cfg) => {
            const remaining = getTimeRemaining(cfg.period);
            const progress = remaining / (cfg.period || 30);
            return (
              <div
                key={cfg.secret}
                className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50 hover:bg-gray-700/30"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-400 truncate">{cfg.account}</div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-lg text-green-400 tracking-wider">
                      {codes[cfg.secret] || '------'}
                    </span>
                    <div className="flex items-center space-x-1">
                      <div className="w-12 h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ${
                            remaining <= 5 ? 'bg-red-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${progress * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 w-4 text-right">{remaining}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1 ml-2">
                  <button
                    onClick={() => copyCode(cfg.secret)}
                    className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white transition-colors"
                    title="Copy code"
                  >
                    {copiedSecret === cfg.secret ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={() => handleDelete(cfg.secret)}
                    className="p-1 hover:bg-gray-600 rounded text-red-400 hover:text-red-300 transition-colors"
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
