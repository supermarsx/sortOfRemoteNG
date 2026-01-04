import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { TagManager } from './TagManager';
import { getDefaultPort } from '../utils/defaultPorts';
import { generateId } from '../utils/id';
import GeneralSection from './connectionEditor/GeneralSection';
import SSHOptions from './connectionEditor/SSHOptions';
import HTTPOptions from './connectionEditor/HTTPOptions';
import CloudProviderOptions from './connectionEditor/CloudProviderOptions';

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
  const [formData, setFormData] = useState<Partial<Connection>>({
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
    authType: 'password',
    privateKey: '',
    passphrase: '',
    ignoreSshSecurityErrors: true,
    sshConnectTimeout: 30,
    sshKeepAliveInterval: 60,
    sshKnownHostsPath: '',
    icon: '',
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
      setFormData({
        ...connection,
        privateKey: connection.privateKey || '',
        passphrase: connection.passphrase || '',
        ignoreSshSecurityErrors: connection.ignoreSshSecurityErrors ?? true,
        sshConnectTimeout: connection.sshConnectTimeout ?? 30,
        sshKeepAliveInterval: connection.sshKeepAliveInterval ?? 60,
        sshKnownHostsPath: connection.sshKnownHostsPath || '',
        icon: connection.icon || '',
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
        authType: 'password',
        basicAuthUsername: '',
        basicAuthPassword: '',
        basicAuthRealm: '',
        httpHeaders: {},
        cloudProvider: undefined,
        ignoreSshSecurityErrors: true,
        sshConnectTimeout: 30,
        sshKeepAliveInterval: 60,
        sshKnownHostsPath: '',
        icon: '',
      });
    }
  }, [connection, isOpen]);

  // Keyboard handling for ESC and Enter
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const now = new Date();
    
    // Prepare description with SSH library info
    const description = formData.description || '';

    const connectionData: Connection = {
      id: connection?.id || generateId(),
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
      icon: formData.icon || undefined,
      order: connection?.order ?? Date.now(),
      createdAt: connection?.createdAt || now,
      updatedAt: now,
      authType: formData.authType,
      basicAuthUsername: formData.basicAuthUsername,
      basicAuthPassword: formData.basicAuthPassword,
      basicAuthRealm: formData.basicAuthRealm,
      httpHeaders: formData.httpHeaders,
      cloudProvider: formData.cloudProvider,
      ignoreSshSecurityErrors: formData.ignoreSshSecurityErrors ?? true,
      sshConnectTimeout: formData.sshConnectTimeout,
      sshKeepAliveInterval: formData.sshKeepAliveInterval,
      sshKnownHostsPath: formData.sshKnownHostsPath || undefined,
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
      data-testid="connection-editor-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {connection ? 'Edit Connection' : 'New Connection'}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                data-tooltip={connection ? 'Update' : 'Create'}
                aria-label={connection ? 'Update' : 'Create'}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                <Save size={16} />
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

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <GeneralSection formData={formData} setFormData={setFormData} availableGroups={availableGroups} />
            <SSHOptions formData={formData} setFormData={setFormData} />
            <HTTPOptions formData={formData} setFormData={setFormData} />
            <CloudProviderOptions formData={formData} setFormData={setFormData} />

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
          </div>
        </form>
      </div>
    </div>
  );
};
