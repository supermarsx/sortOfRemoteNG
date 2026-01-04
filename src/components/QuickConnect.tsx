import React, { useState, useEffect } from 'react';
import { Play, X } from 'lucide-react';

interface QuickConnectProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (payload: {
    hostname: string;
    protocol: string;
    username?: string;
    authType?: "password" | "key";
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }) => void;
}

export const QuickConnect: React.FC<QuickConnectProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [hostname, setHostname] = useState('');
  const [protocol, setProtocol] = useState('rdp');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const isSsh = protocol === 'ssh';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hostname.trim()) {
      if (isSsh && !username.trim()) {
        return;
      }
      if (isSsh && authType === 'password' && !password) {
        return;
      }
      if (isSsh && authType === 'key' && !privateKey.trim()) {
        return;
      }
      onConnect({
        hostname: hostname.trim(),
        protocol,
        username: isSsh ? username.trim() : undefined,
        authType: isSsh ? authType : undefined,
        password: isSsh && authType === 'password' ? password : undefined,
        privateKey: isSsh && authType === 'key' ? privateKey.trim() : undefined,
        passphrase: isSsh && authType === 'key' ? passphrase : undefined,
      });
      setHostname('');
      setUsername('');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
      onClose();
    }
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      data-testid="quick-connect-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1" role="form">
          <div className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Quick Connect</h2>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                data-tooltip="Connect"
                aria-label="Connect"
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                <Play size={16} />
              </button>
              <button
                type="button"
                onClick={onClose}
                data-tooltip="Close"
                aria-label="Close"
                className="p-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4">
          <div>
            <label htmlFor="hostname" className="block text-sm font-medium text-gray-300 mb-2">
              Hostname or IP Address
            </label>
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
                  <input
                    id="ssh-password"
                    type="password"
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
                    <input
                      id="ssh-passphrase"
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </>
              )}
            </>
          )}
          </div>
        </form>
      </div>
    </div>
  );
};
