import React, { useState, useEffect } from 'react';
import { X, Save, Monitor, Terminal, Eye, Globe, Phone, Folder } from 'lucide-react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/ConnectionContext';
import { TagManager } from './TagManager';
import { SSHLibraryType } from '../utils/sshLibraries';
import { getDefaultPort } from '../utils/defaultPorts';

interface ConnectionEditorProps {
  connection?: Connection;
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectionEditor: React.FC<ConnectionEditorProps> = ({
  connection,
  isOpen,
  onClose,
}) => {
  const { state, dispatch } = useConnections();
  const [formData, setFormData] = useState<Partial<Connection & { sshLibrary?: SSHLibraryType }>>({
    name: '',
    protocol: 'rdp',
    hostname: '',
    port: 3389,
    username: '',
    password: '',
    domain: '',
    description: '',
    isGroup: false,
    tags: [],
    parentId: undefined,
    sshLibrary: 'webssh',
    authType: 'password',
    privateKey: '',
    passphrase: '',
    basicAuthUsername: '',
    basicAuthPassword: '',
    basicAuthRealm: '',
    httpHeaders: {},
  });

  const handlePrivateKeyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const text = await file.text();
      setFormData(prev => ({ ...prev, privateKey: text }));
    }
  };


  // Get all available tags from existing connections
  const allTags = Array.from(
    new Set(
      state.connections
        .flatMap(conn => conn.tags || [])
        .filter(tag => tag.trim() !== '')
    )
  ).sort();

  // Get all groups for parent selection
  const availableGroups = state.connections.filter(conn => conn.isGroup);

  useEffect(() => {
    if (connection) {
      // Extract SSH library from description if it exists
      let sshLibrary: SSHLibraryType = 'webssh';
      if (connection.description) {
        const match = connection.description.match(/\[SSH_LIBRARY:([^\]]+)\]/);
        if (match) {
          sshLibrary = match[1] as SSHLibraryType;
        }
      }

      setFormData({
        ...connection,
        sshLibrary,
        privateKey: connection.privateKey || '',
        passphrase: connection.passphrase || '',
        basicAuthUsername: connection.basicAuthUsername || '',
        basicAuthPassword: connection.basicAuthPassword || '',
        basicAuthRealm: connection.basicAuthRealm || '',
        httpHeaders: connection.httpHeaders || {},
      });
    } else {
      setFormData({
        name: '',
        protocol: 'rdp',
        hostname: '',
        port: 3389,
        username: '',
        password: '',
        privateKey: '',
        passphrase: '',
        domain: '',
        description: '',
        isGroup: false,
        tags: [],
        parentId: undefined,
        sshLibrary: 'webssh',
        authType: 'password',
        basicAuthUsername: '',
        basicAuthPassword: '',
        basicAuthRealm: '',
        httpHeaders: {},
      });
    }
  }, [connection, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const now = new Date();
    
    // Prepare description with SSH library info
    let description = formData.description || '';
    
    // Remove existing SSH library marker
    description = description.replace(/\[SSH_LIBRARY:[^\]]+\]\s*/g, '').trim();
    
    // Add SSH library marker if SSH protocol and library is selected
    if (formData.protocol === 'ssh' && formData.sshLibrary && formData.sshLibrary !== 'webssh') {
      description = description ? `${description}\n[SSH_LIBRARY:${formData.sshLibrary}]` : `[SSH_LIBRARY:${formData.sshLibrary}]`;
    }

    const connectionData: Connection = {
      id: connection?.id || crypto.randomUUID(),
      name: formData.name || 'New Connection',
      protocol: formData.protocol as Connection['protocol'],
      hostname: formData.hostname || '',
      port: formData.port || getDefaultPort(formData.protocol as string),
      username: formData.username,
      password: formData.password,
      privateKey: formData.privateKey,
      passphrase: formData.passphrase,
      domain: formData.domain,
      description,
      isGroup: formData.isGroup || false,
      tags: formData.tags || [],
      parentId: formData.parentId,
      createdAt: connection?.createdAt || now,
      updatedAt: now,
      authType: formData.authType,
      basicAuthUsername: formData.basicAuthUsername,
      basicAuthPassword: formData.basicAuthPassword,
      basicAuthRealm: formData.basicAuthRealm,
      httpHeaders: formData.httpHeaders,
    };

    if (connection) {
      dispatch({ type: 'UPDATE_CONNECTION', payload: connectionData });
    } else {
      dispatch({ type: 'ADD_CONNECTION', payload: connectionData });
    }

    onClose();
  };

  const handleProtocolChange = (protocol: string) => {
    setFormData({
      ...formData,
      protocol: protocol as Connection['protocol'],
      port: getDefaultPort(protocol),
      authType: ['http', 'https'].includes(protocol) ? 'basic' : 'password',
    });
  };

  const handleTagsChange = (tags: string[]) => {
    setFormData({ ...formData, tags });
  };

  const handleCreateTag = (tag: string) => {
    // Tags are automatically available once created
  };

  const addHttpHeader = () => {
    const key = prompt('Header name:');
    if (key) {
      const value = prompt('Header value:');
      if (value !== null) {
        setFormData({
          ...formData,
          httpHeaders: {
            ...formData.httpHeaders,
            [key]: value,
          },
        });
      }
    }
  };

  const removeHttpHeader = (key: string) => {
    const headers = { ...formData.httpHeaders };
    delete headers[key];
    setFormData({ ...formData, httpHeaders: headers });
  };

  if (!isOpen) return null;

  const isHttpProtocol = ['http', 'https'].includes(formData.protocol || '');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">
            {connection ? 'Edit Connection' : 'New Connection'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.isGroup}
                onChange={(e) => setFormData({ ...formData, isGroup: e.target.checked })}
                className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-gray-300">Create as folder/group</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={formData.isGroup ? "Folder name" : "Connection name"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Parent Folder
              </label>
              <select
                value={formData.parentId || ''}
                onChange={(e) => setFormData({ ...formData, parentId: e.target.value || undefined })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Root (No parent)</option>
                {availableGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            {!formData.isGroup && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Protocol
                  </label>
                  <select
                    value={formData.protocol}
                    onChange={(e) => handleProtocolChange(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="rdp">RDP (Remote Desktop)</option>
                    <option value="ssh">SSH (Secure Shell)</option>
                    <option value="vnc">VNC (Virtual Network Computing)</option>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="telnet">Telnet</option>
                    <option value="rlogin">RLogin</option>
                  </select>
                </div>

                {formData.protocol === 'ssh' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      SSH Library
                    </label>
                    <select
                      value={formData.sshLibrary}
                      onChange={(e) => setFormData({ ...formData, sshLibrary: e.target.value as SSHLibraryType })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="webssh">WebSSH Library (Default)</option>
                      <option value="ssh2">SSH2 Library</option>
                      <option value="node-ssh">Node-SSH Library</option>
                      <option value="simple-ssh">Simple-SSH Library</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Choose the SSH library implementation for this connection
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Hostname/IP *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.hostname}
                    onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="192.168.1.100 or server.example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Port
                  </label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="1"
                    max="65535"
                  />
                </div>

                {/* Authentication Section */}
                {isHttpProtocol && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Authentication Type
                    </label>
                    <select
                      value={formData.authType}
                      onChange={(e) => setFormData({ ...formData, authType: e.target.value as any })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="basic">Basic Authentication</option>
                      <option value="header">Custom Headers</option>
                    </select>
                  </div>
                )}

                {isHttpProtocol && formData.authType === 'basic' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Basic Auth Username
                      </label>
                      <input
                        type="text"
                        value={formData.basicAuthUsername || ''}
                        onChange={(e) => setFormData({ ...formData, basicAuthUsername: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Username"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Basic Auth Password
                      </label>
                      <input
                        type="password"
                        value={formData.basicAuthPassword || ''}
                        onChange={(e) => setFormData({ ...formData, basicAuthPassword: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Password"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Realm (Optional)
                      </label>
                      <input
                        type="text"
                        value={formData.basicAuthRealm || ''}
                        onChange={(e) => setFormData({ ...formData, basicAuthRealm: e.target.value })}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Authentication realm"
                      />
                    </div>
                  </>
                )}

                {!isHttpProtocol && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Username
                      </label>
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
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Authentication Type
                        </label>
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
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Password
                        </label>
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
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Private Key
                          </label>
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
                          <label className="block text-sm font-medium text-gray-300 mb-2">
                            Passphrase (optional)
                          </label>
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
                )}

                {formData.protocol === 'rdp' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Domain
                    </label>
                    <input
                      type="text"
                      value={formData.domain || ''}
                      onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Domain (optional)"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* HTTP Headers */}
          {isHttpProtocol && formData.authType === 'header' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Custom HTTP Headers
              </label>
              <div className="space-y-2">
                {Object.entries(formData.httpHeaders || {}).map(([key, value]) => (
                  <div key={key} className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={key}
                      readOnly
                      className="flex-1 px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setFormData({
                        ...formData,
                        httpHeaders: { ...formData.httpHeaders, [key]: e.target.value }
                      })}
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                    />
                    <button
                      type="button"
                      onClick={() => removeHttpHeader(key)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addHttpHeader}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                >
                  Add Header
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Description
            </label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Tags
            </label>
            <TagManager
              tags={formData.tags || []}
              availableTags={allTags}
              onChange={handleTagsChange}
              onCreateTag={handleCreateTag}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Save size={16} />
              <span>{connection ? 'Update' : 'Create'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
