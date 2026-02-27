import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Save, Check, Plus, Sparkles, ChevronDown, ChevronUp, Monitor, Terminal, Globe, Database, Server, Shield, Cloud, Folder as FolderIcon, Star, HardDrive, Zap, Settings2, FileText, Tag } from 'lucide-react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { TagManager } from './TagManager';
import { getDefaultPort } from '../utils/defaultPorts';
import { generateId } from '../utils/id';
import SSHOptions from './connectionEditor/SSHOptions';
import HTTPOptions from './connectionEditor/HTTPOptions';
import CloudProviderOptions from './connectionEditor/CloudProviderOptions';
import RDPOptions from './connectionEditor/RDPOptions';
import TOTPOptions from './connectionEditor/TOTPOptions';
import BackupCodesSection from './connectionEditor/BackupCodesSection';
import { useSettings } from '../contexts/SettingsContext';
import { getConnectionDepth, getMaxDescendantDepth, MAX_NESTING_DEPTH } from '../utils/dragDropManager';

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
  const { settings } = useSettings();
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
  
  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    advanced: false,
    description: false,
  });
  
  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saved'>('idle');
  const autoSaveTimerRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

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

  // Calculate selectable groups based on depth limits
  const selectableGroups = useMemo(() => {
    const currentId = formData.id;
    const isGroup = formData.isGroup;
    const descendantDepth = currentId && isGroup 
      ? getMaxDescendantDepth(currentId, state.connections) 
      : 0;
    
    return availableGroups.map(group => {
      // Don't allow selecting self as parent
      if (currentId && group.id === currentId) {
        return { group, disabled: true, reason: 'Cannot be its own parent' };
      }
      
      // Check if this group is a descendant of the current item
      if (currentId) {
        let checkId: string | undefined = group.id;
        while (checkId) {
          const parent = state.connections.find(c => c.id === checkId);
          if (parent?.parentId === currentId) {
            return { group, disabled: true, reason: 'Cannot move into own descendant' };
          }
          checkId = parent?.parentId;
        }
      }
      
      const groupDepth = getConnectionDepth(group.id, state.connections) + 1;
      const wouldExceedDepth = (groupDepth + descendantDepth) >= MAX_NESTING_DEPTH;
      
      return {
        group,
        disabled: wouldExceedDepth,
        reason: wouldExceedDepth ? `Max depth (${MAX_NESTING_DEPTH}) exceeded` : undefined,
      };
    });
  }, [availableGroups, state.connections, formData.id, formData.isGroup]);

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
      // Mark as initialized after setting initial data
      setTimeout(() => {
        isInitializedRef.current = true;
      }, 100);
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
      isInitializedRef.current = false;
    }
    // Reset auto-save status when connection changes
    setAutoSaveStatus('idle');
  }, [connection, isOpen]);
  
  // Build connection data from form
  const buildConnectionData = useCallback((): Connection => {
    const now = new Date();
    const description = formData.description || '';
    
    return {
      // Spread existing connection data first so fields not managed
      // by the editor (e.g. statusCheck, macAddress, etc.) are preserved.
      ...(connection || {}),
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
      httpVerifySsl: formData.httpVerifySsl,
      cloudProvider: formData.cloudProvider,
      ignoreSshSecurityErrors: formData.ignoreSshSecurityErrors ?? true,
      sshConnectTimeout: formData.sshConnectTimeout,
      sshKeepAliveInterval: formData.sshKeepAliveInterval,
      sshKnownHostsPath: formData.sshKnownHostsPath || undefined,
      tlsTrustPolicy: formData.tlsTrustPolicy,
      sshTrustPolicy: formData.sshTrustPolicy,
      rdpTrustPolicy: formData.rdpTrustPolicy,
      rdpSettings: formData.rdpSettings,
      totpSecret: formData.totpSecret,
      totpConfigs: formData.totpConfigs,
    };
  }, [formData, connection]);

  // Auto-save effect - only for existing connections when autoSaveEnabled
  useEffect(() => {
    // Only auto-save for existing connections and when enabled
    if (!connection || !settings.autoSaveEnabled || !isInitializedRef.current) {
      return;
    }
    
    // Clear any existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    // Set status to pending
    setAutoSaveStatus('pending');
    
    // Debounce auto-save (1 second delay)
    autoSaveTimerRef.current = window.setTimeout(() => {
      const connectionData = buildConnectionData();
      dispatch({ type: 'UPDATE_CONNECTION', payload: connectionData });
      setAutoSaveStatus('saved');
      
      // Reset status after 2 seconds
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    }, 1000);
    
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [formData, connection, settings.autoSaveEnabled, buildConnectionData, dispatch]);

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
    
    // Clear auto-save timer if pending
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    const connectionData = buildConnectionData();

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

  const handleCreateTag = (_tag: string) => {
    // Tags are automatically available once created
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleProtocolChange = (protocol: string) => {
    setFormData(prev => ({
      ...prev,
      protocol: protocol as Connection['protocol'],
      port: getDefaultPort(protocol),
      authType: ['http', 'https'].includes(protocol) ? 'basic' : 'password',
    }));
  };

  // Protocol options with icons and descriptions
  const protocolOptions = [
    { value: 'rdp', label: 'RDP', desc: 'Remote Desktop', icon: Monitor, color: 'blue' },
    { value: 'ssh', label: 'SSH', desc: 'Secure Shell', icon: Terminal, color: 'green' },
    { value: 'vnc', label: 'VNC', desc: 'Virtual Network', icon: Server, color: 'purple' },
    { value: 'http', label: 'HTTP', desc: 'Web Service', icon: Globe, color: 'orange' },
    { value: 'https', label: 'HTTPS', desc: 'Secure Web', icon: Shield, color: 'emerald' },
    { value: 'anydesk', label: 'AnyDesk', desc: 'Remote Access', icon: Monitor, color: 'red' },
  ];

  const cloudOptions = [
    { value: 'gcp', label: 'GCP', desc: 'Google Cloud' },
    { value: 'azure', label: 'Azure', desc: 'Microsoft' },
    { value: 'digital-ocean', label: 'DO', desc: 'Digital Ocean' },
  ];

  const iconOptions = [
    { value: '', label: 'Default', icon: Monitor },
    { value: 'terminal', label: 'Terminal', icon: Terminal },
    { value: 'globe', label: 'Web', icon: Globe },
    { value: 'database', label: 'Database', icon: Database },
    { value: 'server', label: 'Server', icon: Server },
    { value: 'shield', label: 'Shield', icon: Shield },
    { value: 'cloud', label: 'Cloud', icon: Cloud },
    { value: 'folder', label: 'Folder', icon: FolderIcon },
    { value: 'star', label: 'Star', icon: Star },
    { value: 'drive', label: 'Drive', icon: HardDrive },
  ];


  if (!isOpen) return null;

  const isNewConnection = !connection;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      data-testid="connection-editor-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Subtle glow effect */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <div className={`w-[500px] h-[400px] rounded-full blur-[100px] animate-pulse ${
          isNewConnection ? 'bg-emerald-500/15' : 'bg-blue-500/15'
        }`} />
      </div>

      <div className="relative bg-gray-800 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-gray-600">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* Header */}
          <div className="relative border-b border-gray-600 px-6 py-5" style={{ background: isNewConnection ? 'linear-gradient(to right, rgba(16, 185, 129, 0.15), var(--color-surface))' : 'linear-gradient(to right, rgba(59, 130, 246, 0.15), var(--color-surface))' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${
                  isNewConnection ? 'bg-green-500/20' : 'bg-blue-500/20'
                }`}>
                  {isNewConnection ? (
                    <Plus size={22} className="text-green-400" />
                  ) : (
                    <Settings2 size={22} className="text-blue-400" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                    {isNewConnection ? 'New Connection' : 'Edit Connection'}
                    {isNewConnection && <Sparkles size={16} className="text-green-400" />}
                  </h2>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {isNewConnection 
                      ? 'Add a new server or service to your collection' 
                      : `Editing "${formData.name || 'connection'}"`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Auto-save indicator */}
                {connection && settings.autoSaveEnabled && (
                  <div className="flex items-center gap-1.5 text-xs mr-2">
                    {autoSaveStatus === 'pending' && (
                      <span className="text-yellow-400 flex items-center gap-1 bg-yellow-400/10 px-2 py-1 rounded-full">
                        <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                        Saving...
                      </span>
                    )}
                    {autoSaveStatus === 'saved' && (
                      <span className="text-green-400 flex items-center gap-1 bg-green-400/10 px-2 py-1 rounded-full">
                        <Check size={12} />
                        Saved
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                    isNewConnection
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                  }`}
                >
                  <Save size={16} />
                  {isNewConnection ? 'Create' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Quick toggles */}
            <div className="flex flex-wrap gap-3">
              <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
                formData.isGroup 
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-400' 
                  : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
              }`}>
                <input
                  type="checkbox"
                  checked={!!formData.isGroup}
                  onChange={(e) => setFormData({ ...formData, isGroup: e.target.checked })}
                  className="sr-only"
                />
                <FolderIcon size={16} />
                <span className="text-sm font-medium">Folder/Group</span>
              </label>
              {!formData.isGroup && (
                <label className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
                  formData.favorite 
                    ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' 
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                }`}>
                  <input
                    type="checkbox"
                    checked={!!formData.favorite}
                    onChange={(e) => setFormData({ ...formData, favorite: e.target.checked })}
                    className="sr-only"
                  />
                  <Star size={16} className={formData.favorite ? 'fill-yellow-400' : ''} />
                  <span className="text-sm font-medium">Favorite</span>
                </label>
              )}
            </div>

            {/* Name input - prominent */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {formData.isGroup ? 'Folder Name' : 'Connection Name'} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                data-testid="name-input"
                value={formData.name || ''}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white text-lg placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                placeholder={formData.isGroup ? 'My Servers' : 'Production Server'}
                autoFocus
              />
            </div>

            {/* Parent folder selector */}
            {availableGroups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Parent Folder
                </label>
                <select
                  value={formData.parentId || ''}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value || undefined })}
                  className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                >
                  <option value="">Root (No parent)</option>
                  {selectableGroups.map(({ group, disabled, reason }) => (
                    <option 
                      key={group.id} 
                      value={group.id}
                      disabled={disabled}
                      title={reason}
                    >
                      {group.name}{disabled ? ` (${reason})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Protocol selection - only for non-groups */}
            {!formData.isGroup && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Protocol
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {protocolOptions.map(({ value, label, desc, icon: Icon, color }) => {
                      const isActive = formData.protocol === value;
                      const colorClasses: Record<string, string> = {
                        blue: isActive ? 'bg-blue-500/20 border-blue-500/60 text-blue-300' : '',
                        green: isActive ? 'bg-green-500/20 border-green-500/60 text-green-300' : '',
                        purple: isActive ? 'bg-purple-500/20 border-purple-500/60 text-purple-300' : '',
                        orange: isActive ? 'bg-orange-500/20 border-orange-500/60 text-orange-300' : '',
                        emerald: isActive ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : '',
                        red: isActive ? 'bg-red-500/20 border-red-500/60 text-red-300' : '',
                      };
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => handleProtocolChange(value)}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                            isActive 
                              ? colorClasses[color]
                              : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300'
                          }`}
                        >
                          <Icon size={20} />
                          <span className="text-xs font-semibold">{label}</span>
                          <span className="text-[10px] opacity-70">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  
                  {/* Cloud providers row */}
                  <div className="mt-2 flex gap-2">
                    {cloudOptions.map(({ value, label, desc }) => {
                      const isActive = formData.protocol === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => handleProtocolChange(value)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
                            isActive 
                              ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400'
                              : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                          }`}
                        >
                          <Cloud size={14} />
                          <span className="font-medium">{label}</span>
                          <span className="opacity-60">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Connection details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Hostname / IP Address <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.hostname || ''}
                      onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                      className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                      placeholder="192.168.1.100 or server.example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Port
                    </label>
                    <input
                      type="number"
                      value={formData.port || 0}
                      onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                      min={1}
                      max={65535}
                    />
                  </div>
                </div>

                {/* Protocol-specific options */}
                <SSHOptions formData={formData} setFormData={setFormData} />
                <HTTPOptions formData={formData} setFormData={setFormData} />
                <CloudProviderOptions formData={formData} setFormData={setFormData} />
                <RDPOptions formData={formData} setFormData={setFormData} />
                <TOTPOptions formData={formData} setFormData={setFormData} />
                <BackupCodesSection formData={formData} setFormData={setFormData} />
              </>
            )}

            {/* Icon selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Custom Icon
              </label>
              <div className="flex flex-wrap gap-2">
                {iconOptions.map(({ value, label, icon: Icon }) => {
                  const isActive = (formData.icon || '') === value;
                  return (
                    <button
                      key={value || 'default'}
                      type="button"
                      onClick={() => setFormData({ ...formData, icon: value || undefined })}
                      className={`p-2.5 rounded-lg border transition-all ${
                        isActive
                          ? 'border-blue-500/60 bg-blue-500/20 text-blue-400'
                          : 'border-gray-600 bg-gray-700 text-gray-400 hover:border-gray-500'
                      }`}
                      title={label}
                    >
                      <Icon size={18} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Tag size={14} className="text-gray-400" />
                <label className="text-sm font-medium text-gray-300">Tags</label>
              </div>
              <TagManager
                tags={formData.tags || []}
                availableTags={allTags}
                onChange={handleTagsChange}
                onCreateTag={handleCreateTag}
              />
            </div>

            {/* Description - collapsible */}
            <div className="border border-gray-600 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('description')}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                <div className="flex items-center gap-2 text-gray-300">
                  <FileText size={16} />
                  <span className="text-sm font-medium">Description & Notes</span>
                  {formData.description && (
                    <span className="text-xs text-gray-500 ml-2">
                      ({formData.description.length} chars)
                    </span>
                  )}
                </div>
                {expandedSections.description ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </button>
              {expandedSections.description && (
                <div className="p-4 border-t border-gray-600">
                  <textarea
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none"
                    placeholder="Add notes about this connection..."
                  />
                </div>
              )}
            </div>
          </div>

          {/* Footer hint */}
          <div className="border-t border-gray-600 px-6 py-3 bg-gray-800">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Zap size={12} />
                  Press <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-gray-300">Enter</kbd> to save
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-gray-300">Esc</kbd> to cancel
                </span>
              </div>
              {connection && settings.autoSaveEnabled && (
                <span className="text-gray-500">Auto-save enabled</span>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
