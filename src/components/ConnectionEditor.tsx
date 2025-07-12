import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { Connection, Protocol } from '../types/connection';
import { useConnections } from '../contexts/ConnectionContext';
import { TagManager } from './TagManager';
import { SSHLibraryType } from '../utils/sshLibraries';
import { getDefaultPort } from '../utils/defaultPorts';
import GeneralSection from './connectionEditor/GeneralSection';
import SSHOptions from './connectionEditor/SSHOptions';
import HTTPOptions from './connectionEditor/HTTPOptions';

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
    protocol: Protocol.RDP,
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
        protocol: Protocol.RDP,
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
      protocol: formData.protocol as Protocol,
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


  const handleTagsChange = (tags: string[]) => {
    setFormData({ ...formData, tags });
  };

  const handleCreateTag = (tag: string) => {
    // Tags are automatically available once created
  };


  if (!isOpen) return null;

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
          <GeneralSection formData={formData} setFormData={setFormData} availableGroups={availableGroups} />
          <SSHOptions formData={formData} setFormData={setFormData} />
          <HTTPOptions formData={formData} setFormData={setFormData} />

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
