import React, { useState, useEffect } from 'react';
import { PasswordInput } from './ui/PasswordInput';
import { Clock, Play, Trash2, X, Zap } from 'lucide-react';
import { QuickConnectHistoryEntry } from '../types/settings';

interface QuickConnectProps {
  isOpen: boolean;
  onClose: () => void;
  historyEnabled: boolean;
  history: QuickConnectHistoryEntry[];
  onClearHistory: () => void;
  onConnect: (payload: {
    hostname: string;
    protocol: string;
    username?: string;
    password?: string;
    domain?: string;
    authType?: "password" | "key";
    privateKey?: string;
    passphrase?: string;
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    httpVerifySsl?: boolean;
  }) => void;
}

export const QuickConnect: React.FC<QuickConnectProps> = ({
  isOpen,
  onClose,
  historyEnabled,
  history,
  onClearHistory,
  onConnect,
}) => {
  const [hostname, setHostname] = useState('');
  const [protocol, setProtocol] = useState('rdp');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [basicAuthUsername, setBasicAuthUsername] = useState('');
  const [basicAuthPassword, setBasicAuthPassword] = useState('');
  const [httpVerifySsl, setHttpVerifySsl] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const isSsh = protocol === 'ssh';
  const isRdp = protocol === 'rdp';
  const isVnc = protocol === 'vnc';
  const isHttp = protocol === 'http' || protocol === 'https';
  const isHttps = protocol === 'https';
  const isTelnet = protocol === 'telnet';
  const historyItems = historyEnabled ? history : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostname.trim()) return;

    // Validate SSH-specific fields
    if (isSsh) {
      if (!username.trim()) return;
      if (authType === 'password' && !password) return;
      if (authType === 'key' && !privateKey.trim()) return;
    }

    const payload: Parameters<typeof onConnect>[0] = {
      hostname: hostname.trim(),
      protocol,
    };

    if (isSsh) {
      payload.username = username.trim();
      payload.authType = authType;
      if (authType === 'password') {
        payload.password = password;
      } else {
        payload.privateKey = privateKey.trim();
        payload.passphrase = passphrase || undefined;
      }
    } else if (isRdp) {
      if (username.trim()) payload.username = username.trim();
      if (password) payload.password = password;
      if (domain.trim()) payload.domain = domain.trim();
    } else if (isVnc) {
      if (password) payload.password = password;
    } else if (isHttp) {
      if (basicAuthUsername.trim()) payload.basicAuthUsername = basicAuthUsername.trim();
      if (basicAuthPassword) payload.basicAuthPassword = basicAuthPassword;
      if (isHttps) payload.httpVerifySsl = httpVerifySsl;
    } else if (isTelnet) {
      if (username.trim()) payload.username = username.trim();
      if (password) payload.password = password;
    }

    onConnect(payload);
    resetFields();
    onClose();
  };

  const resetFields = () => {
    setHostname('');
    setUsername('');
    setPassword('');
    setDomain('');
    setPrivateKey('');
    setPassphrase('');
    setBasicAuthUsername('');
    setBasicAuthPassword('');
    setHttpVerifySsl(true);
  };

  // Handle ESC key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
    }
  }, [isOpen]);

  const handleHistorySelect = (entry: QuickConnectHistoryEntry) => {
    setHostname(entry.hostname);
    setProtocol(entry.protocol);
    setUsername(entry.username ?? '');
    setAuthType(entry.authType ?? 'password');
    setPassword('');
    setPrivateKey('');
    setPassphrase('');
    setShowHistory(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      data-testid="quick-connect-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden flex flex-col border border-[var(--color-border)]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1" role="form">
          <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between bg-[var(--color-surface)]">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Zap size={16} className="text-green-500" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">Quick Connect</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                data-tooltip="Connect"
                aria-label="Connect"
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Play size={16} />
              </button>
              <button
                type="button"
                onClick={onClose}
                data-tooltip="Close"
                aria-label="Close"
                className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4">
          <div className="relative">
            <div className="flex items-center justify-between">
              <label htmlFor="hostname" className="block text-sm font-medium text-gray-300 mb-2">
                Hostname or IP Address
              </label>
              {historyItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory((prev) => !prev)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <Clock size={12} />
                  History
                </button>
              )}
            </div>
            <input
              id="hostname"
              type="text"
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="192.168.1.100 or server.example.com"
              autoFocus
            />
            {showHistory && historyItems.length > 0 && (
              <div className="absolute z-20 mt-2 w-full rounded-md border border-gray-700 bg-gray-800 shadow-lg overflow-hidden">
                <div className="max-h-48 overflow-auto">
                  {historyItems.map((entry, index) => (
                    <button
                      key={`${entry.protocol}-${entry.hostname}-${index}`}
                      type="button"
                      onClick={() => handleHistorySelect(entry)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{entry.hostname}</span>
                        <span className="ml-3 text-[10px] uppercase text-gray-400">
                          {entry.protocol}
                        </span>
                      </div>
                      {entry.username && (
                        <div className="text-[11px] text-gray-400 truncate">
                          {entry.username}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-700 px-3 py-2 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    {historyEnabled ? "Saved Quick Connects" : "History disabled"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearHistory();
                      setShowHistory(false);
                    }}
                    className="flex items-center gap-1 text-[11px] text-gray-300 hover:text-white"
                  >
                    <Trash2 size={12} />
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="protocol" className="block text-sm font-medium text-gray-300 mb-2">
              Protocol
            </label>
            <select
              id="protocol"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="rdp">RDP (Remote Desktop)</option>
              <option value="ssh">SSH (Secure Shell)</option>
              <option value="vnc">VNC (Virtual Network Computing)</option>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="telnet">Telnet</option>
            </select>
          </div>
          {/* RDP credentials */}
          {isRdp && (
            <>
              <div>
                <label htmlFor="rdp-username" className="block text-sm font-medium text-gray-300 mb-2">
                  Username (optional)
                </label>
                <input
                  id="rdp-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Administrator"
                />
              </div>
              <div>
                <label htmlFor="rdp-password" className="block text-sm font-medium text-gray-300 mb-2">
                  Password (optional)
                </label>
                <PasswordInput
                  id="rdp-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="rdp-domain" className="block text-sm font-medium text-gray-300 mb-2">
                  Domain (optional)
                </label>
                <input
                  id="rdp-domain"
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="DOMAIN"
                />
              </div>
            </>
          )}

          {/* SSH credentials */}
          {isSsh && (
            <>
              <div>
                <label htmlFor="ssh-username" className="block text-sm font-medium text-gray-300 mb-2">
                  Username
                </label>
                <input
                  id="ssh-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="root"
                />
              </div>
              <div>
                <label htmlFor="ssh-auth" className="block text-sm font-medium text-gray-300 mb-2">
                  Auth Method
                </label>
                <select
                  id="ssh-auth"
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as 'password' | 'key')}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="password">Password</option>
                  <option value="key">Private Key</option>
                </select>
              </div>
              {authType === 'password' ? (
                <div>
                  <label htmlFor="ssh-password" className="block text-sm font-medium text-gray-300 mb-2">
                    Password
                  </label>
                  <PasswordInput
                    id="ssh-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="ssh-key" className="block text-sm font-medium text-gray-300 mb-2">
                      Private Key Path
                    </label>
                    <input
                      id="ssh-key"
                      type="text"
                      required
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="C:\\Users\\me\\.ssh\\id_rsa"
                    />
                  </div>
                  <div>
                    <label htmlFor="ssh-passphrase" className="block text-sm font-medium text-gray-300 mb-2">
                      Passphrase (optional)
                    </label>
                    <PasswordInput
                      id="ssh-passphrase"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* VNC credentials */}
          {isVnc && (
            <div>
              <label htmlFor="vnc-password" className="block text-sm font-medium text-gray-300 mb-2">
                Password (optional)
              </label>
              <PasswordInput
                id="vnc-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* HTTP/HTTPS credentials */}
          {isHttp && (
            <>
              <div>
                <label htmlFor="http-username" className="block text-sm font-medium text-gray-300 mb-2">
                  Basic Auth Username (optional)
                </label>
                <input
                  id="http-username"
                  type="text"
                  value={basicAuthUsername}
                  onChange={(e) => setBasicAuthUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="admin"
                />
              </div>
              <div>
                <label htmlFor="http-password" className="block text-sm font-medium text-gray-300 mb-2">
                  Basic Auth Password (optional)
                </label>
                <PasswordInput
                  id="http-password"
                  value={basicAuthPassword}
                  onChange={(e) => setBasicAuthPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {isHttps && (
                <div>
                  <label className="flex items-center space-x-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={httpVerifySsl}
                      onChange={(e) => setHttpVerifySsl(e.target.checked)}
                      className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Verify TLS certificates</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    Disable for self-signed or untrusted certificates.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Telnet credentials */}
          {isTelnet && (
            <>
              <div>
                <label htmlFor="telnet-username" className="block text-sm font-medium text-gray-300 mb-2">
                  Username (optional)
                </label>
                <input
                  id="telnet-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="telnet-password" className="block text-sm font-medium text-gray-300 mb-2">
                  Password (optional)
                </label>
                <PasswordInput
                  id="telnet-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </>
          )}
          </div>
        </form>
      </div>
    </div>
  );
};
