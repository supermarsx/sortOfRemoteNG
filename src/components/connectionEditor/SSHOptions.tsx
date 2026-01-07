import React, { useState } from 'react';
import { Key } from 'lucide-react';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { Connection } from '../../types/connection';
import { SSHKeyManager } from '../SSHKeyManager';
import { SSHTerminalOverrides } from './SSHTerminalOverrides';

interface SSHOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const SSHOptions: React.FC<SSHOptionsProps> = ({ formData, setFormData }) => {
  const [showKeyManager, setShowKeyManager] = useState(false);
  
  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');
  if (formData.isGroup || isHttpProtocol) return null;

  const handlePrivateKeyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      setFormData(prev => ({ ...prev, privateKey: text }));
    }
  };
  
  const handleSelectKey = async (keyPath: string) => {
    try {
      const keyContent = await readTextFile(keyPath);
      setFormData(prev => ({ ...prev, privateKey: keyContent }));
    } catch (err) {
      console.error('Failed to read selected key:', err);
    }
  };

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Username</label>
        <input
          type="text"
          value={formData.username || ''}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Username"
        />
      </div>

      {formData.protocol === 'ssh' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Authentication Type</label>
            <select
              value={formData.authType}
              onChange={(e) => setFormData({ ...formData, authType: e.target.value as any })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="password">Password</option>
              <option value="key">Private Key</option>
            </select>
          </div>
          <label className="flex items-center space-x-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={formData.ignoreSshSecurityErrors ?? true}
              onChange={(e) =>
                setFormData({ ...formData, ignoreSshSecurityErrors: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600"
            />
            <span>Ignore SSH security errors (host keys/certs)</span>
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Connect Timeout (sec)
              </label>
              <input
                type="number"
                min={5}
                max={300}
                value={formData.sshConnectTimeout ?? 30}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sshConnectTimeout: Number(e.target.value) || 30,
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Keep Alive (sec)
              </label>
              <input
                type="number"
                min={10}
                max={600}
                value={formData.sshKeepAliveInterval ?? 60}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sshKeepAliveInterval: Number(e.target.value) || 60,
                  })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Known Hosts Path
              </label>
              <input
                type="text"
                value={formData.sshKnownHostsPath || ''}
                onChange={(e) =>
                  setFormData({ ...formData, sshKnownHostsPath: e.target.value })
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="C:\\Users\\me\\.ssh\\known_hosts"
              />
            </div>
          </div>
        </div>
      )}

      {formData.authType === 'password' && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
          <input
            type="password"
            value={formData.password || ''}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Password"
          />
        </div>
      )}

      {formData.protocol === 'ssh' && formData.authType === 'key' && (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">Private Key</label>
              <button
                type="button"
                onClick={() => setShowKeyManager(true)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Manage Keys
              </button>
            </div>
            <textarea
              value={formData.privateKey || ''}
              onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="-----BEGIN PRIVATE KEY-----"
            />
            <input
              type="file"
              accept=".key,.pem,.ppk"
              onChange={handlePrivateKeyFileChange}
              className="mt-2 text-sm text-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Passphrase (optional)</label>
            <input
              type="password"
              value={formData.passphrase || ''}
              onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Passphrase"
            />
          </div>
        </>
      )}
      
      <SSHKeyManager
        isOpen={showKeyManager}
        onClose={() => setShowKeyManager(false)}
        onSelectKey={handleSelectKey}
      />

      {/* SSH Terminal Settings Override */}
      {formData.protocol === 'ssh' && (
        <SSHTerminalOverrides formData={formData} setFormData={setFormData} />
      )}
    </>
  );
};

export default SSHOptions;
