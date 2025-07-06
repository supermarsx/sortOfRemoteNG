import React from 'react';
import { Connection } from '../../types/connection';
import { SSHLibraryType } from '../../utils/sshLibraries';

interface SSHOptionsProps {
  formData: Partial<Connection & { sshLibrary?: SSHLibraryType }>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection & { sshLibrary?: SSHLibraryType }>>>;
}

export const SSHOptions: React.FC<SSHOptionsProps> = ({ formData, setFormData }) => {
  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');
  if (formData.isGroup || isHttpProtocol) return null;

  const handlePrivateKeyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      setFormData(prev => ({ ...prev, privateKey: text }));
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
            <label className="block text-sm font-medium text-gray-300 mb-2">Private Key</label>
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
    </>
  );
};

export default SSHOptions;
