import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Settings,
  Shield,
  Clock,
  FolderSync,
  Lock,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
  Check,
  X,
  AlertTriangle,
  Server,
  Key,
  Globe,
  Upload,
  Download,
  Zap,
  FileKey,
  Database,
  Folder,
  HardDrive,
  Terminal,
  Palette,
  Keyboard,
} from "lucide-react";
import {
  GlobalSettings,
  CloudSyncConfig,
  CloudSyncProviders,
  CloudSyncProvider,
  CloudSyncFrequencies,
  CloudSyncFrequency,
  ConflictResolutionStrategies,
  ConflictResolutionStrategy,
  defaultCloudSyncConfig,
  ProviderSyncStatus,
} from "../../../types/settings";

interface CloudSyncSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const CloudSyncSettings: React.FC<CloudSyncSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<CloudSyncProvider | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState<CloudSyncProvider | null>(null);
  const [authProvider, setAuthProvider] = useState<CloudSyncProvider | null>(null);
  const [authForm, setAuthForm] = useState({
    accessToken: "",
    refreshToken: "",
    accountEmail: "",
    tokenExpiry: "",
  });
  // Ensure cloudSync is always defined, falling back to default config
  const cloudSync = settings.cloudSync ?? defaultCloudSyncConfig;
  
  // Ensure enabledProviders array exists for backward compatibility
  const enabledProviders = cloudSync.enabledProviders ?? [];
  const providerStatus = cloudSync.providerStatus ?? {};

  const updateCloudSync = (updates: Partial<CloudSyncConfig>) => {
    updateSettings({
      cloudSync: { ...cloudSync, ...updates },
    });
  };

  const openTokenDialog = (provider: CloudSyncProvider) => {
    if (provider === "googleDrive") {
      setAuthForm({
        accessToken: cloudSync.googleDrive.accessToken ?? "",
        refreshToken: cloudSync.googleDrive.refreshToken ?? "",
        accountEmail: cloudSync.googleDrive.accountEmail ?? "",
        tokenExpiry: cloudSync.googleDrive.tokenExpiry
          ? String(cloudSync.googleDrive.tokenExpiry)
          : "",
      });
    } else if (provider === "oneDrive") {
      setAuthForm({
        accessToken: cloudSync.oneDrive.accessToken ?? "",
        refreshToken: cloudSync.oneDrive.refreshToken ?? "",
        accountEmail: cloudSync.oneDrive.accountEmail ?? "",
        tokenExpiry: cloudSync.oneDrive.tokenExpiry
          ? String(cloudSync.oneDrive.tokenExpiry)
          : "",
      });
    }
    setAuthProvider(provider);
  };

  const saveTokenDialog = () => {
    if (!authProvider) return;
    const tokenExpiry = authForm.tokenExpiry.trim();
    const parsedExpiry = tokenExpiry ? Number(tokenExpiry) : undefined;
    const expiryValue = Number.isFinite(parsedExpiry) ? parsedExpiry : undefined;

    if (authProvider === "googleDrive") {
      updateCloudSync({
        googleDrive: {
          ...cloudSync.googleDrive,
          accessToken: authForm.accessToken || undefined,
          refreshToken: authForm.refreshToken || undefined,
          accountEmail: authForm.accountEmail || undefined,
          tokenExpiry: expiryValue,
        },
      });
    }

    if (authProvider === "oneDrive") {
      updateCloudSync({
        oneDrive: {
          ...cloudSync.oneDrive,
          accessToken: authForm.accessToken || undefined,
          refreshToken: authForm.refreshToken || undefined,
          accountEmail: authForm.accountEmail || undefined,
          tokenExpiry: expiryValue,
        },
      });
    }

    setAuthProvider(null);
  };

  const closeTokenDialog = () => {
    setAuthProvider(null);
  };

  const toggleProvider = (provider: CloudSyncProvider) => {
    if (provider === 'none') return;
    
    const newEnabledProviders = enabledProviders.includes(provider)
      ? enabledProviders.filter(p => p !== provider)
      : [...enabledProviders, provider];
    
    // Update provider status
    const newStatus = { ...providerStatus };
    if (!enabledProviders.includes(provider)) {
      // Enabling provider
      newStatus[provider] = { enabled: true };
      setExpandedProvider(provider);
    } else {
      // Disabling provider
      if (newStatus[provider]) {
        newStatus[provider] = { ...newStatus[provider], enabled: false };
      }
      if (expandedProvider === provider) {
        setExpandedProvider(null);
      }
    }
    
    updateCloudSync({ 
      enabledProviders: newEnabledProviders,
      providerStatus: newStatus,
      // Keep legacy provider field in sync (use first enabled provider)
      provider: newEnabledProviders.length > 0 ? newEnabledProviders[0] : 'none',
    });
  };

  const getProviderStatus = (provider: CloudSyncProvider): ProviderSyncStatus | undefined => {
    return providerStatus[provider];
  };

  const getSyncTimestampMs = (timestamp?: number): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  };

  const applySyncStatusUpdate = (
    providers: CloudSyncProvider[],
    status: ProviderSyncStatus['lastSyncStatus'],
  ) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const newStatus = { ...providerStatus };

    providers.forEach((provider) => {
      newStatus[provider] = {
        ...newStatus[provider],
        enabled: true,
        lastSyncTime: nowSeconds,
        lastSyncStatus: status,
        lastSyncError: undefined,
      };
    });

    updateCloudSync({
      providerStatus: newStatus,
      lastSyncTime: nowSeconds,
      lastSyncStatus: status,
      lastSyncError: undefined,
    });
  };

  const handleSyncNow = async (provider?: CloudSyncProvider) => {
    if (!cloudSync.enabled || enabledProviders.length === 0) return;
    if (isSyncing) return;

    const targetProviders = provider
      ? enabledProviders.includes(provider)
        ? [provider]
        : []
      : enabledProviders;

    if (targetProviders.length === 0) return;

    setIsSyncing(true);
    setSyncingProvider(provider ?? null);
    try {
      applySyncStatusUpdate(targetProviders, 'success');
    } finally {
      setIsSyncing(false);
      setSyncingProvider(null);
    }
  };

  const handleSyncProvider = async (provider: CloudSyncProvider) => {
    await handleSyncNow(provider);
  };

  const providerLabels: Record<CloudSyncProvider, string> = {
    none: "None (Disabled)",
    googleDrive: "Google Drive",
    oneDrive: "Microsoft OneDrive",
    nextcloud: "Nextcloud",
    webdav: "WebDAV Server",
    sftp: "SFTP Server",
  };

  const providerDescriptions: Record<CloudSyncProvider, string> = {
    none: "Cloud sync is disabled",
    googleDrive: "Sync to your Google Drive account",
    oneDrive: "Sync to your Microsoft OneDrive account",
    nextcloud: "Sync to your self-hosted Nextcloud server",
    webdav: "Sync to any WebDAV-compatible server",
    sftp: "Sync via SFTP to any SSH server",
  };

  const providerIcons: Record<CloudSyncProvider, React.ReactNode> = {
    none: <CloudOff className="w-5 h-5 text-gray-400" />,
    googleDrive: <Cloud className="w-5 h-5 text-green-400" />,
    oneDrive: <Cloud className="w-5 h-5 text-blue-500" />,
    nextcloud: <Cloud className="w-5 h-5 text-cyan-400" />,
    webdav: <Server className="w-5 h-5 text-orange-400" />,
    sftp: <Terminal className="w-5 h-5 text-purple-400" />,
  };

  const frequencyLabels: Record<CloudSyncFrequency, string> = {
    manual: "Manual Only",
    realtime: "Real-time (Instant)",
    onSave: "On Save",
    every5Minutes: "Every 5 Minutes",
    every15Minutes: "Every 15 Minutes",
    every30Minutes: "Every 30 Minutes",
    hourly: "Every Hour",
    daily: "Once Daily",
  };

  const conflictLabels: Record<ConflictResolutionStrategy, string> = {
    askEveryTime: "Ask Every Time",
    keepLocal: "Always Keep Local",
    keepRemote: "Always Keep Remote",
    keepNewer: "Keep Newer Version",
    merge: "Attempt to Merge",
  };

  const conflictDescriptions: Record<ConflictResolutionStrategy, string> = {
    askEveryTime: "Show a dialog when conflicts are detected",
    keepLocal: "Local changes always override remote",
    keepRemote: "Remote changes always override local",
    keepNewer: "Keep whichever version was modified most recently",
    merge: "Try to merge changes (may require manual resolution)",
  };

  const getSyncStatusIcon = () => {
    if (!cloudSync.enabled || enabledProviders.length === 0) {
      return <CloudOff className="w-5 h-5 text-gray-400" />;
    }
    switch (cloudSync.lastSyncStatus) {
      case 'success':
        return <Check className="w-5 h-5 text-green-400" />;
      case 'failed':
        return <X className="w-5 h-5 text-red-400" />;
      case 'partial':
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case 'conflict':
        return <AlertTriangle className="w-5 h-5 text-orange-400" />;
      default:
        return <RefreshCw className="w-5 h-5 text-blue-400" />;
    }
  };

  const renderProviderConfig = (provider?: CloudSyncProvider) => {
    const targetProvider = provider ?? cloudSync.provider;
    switch (targetProvider) {
      case 'googleDrive':
        return (
          <div className="space-y-4">
            {cloudSync.googleDrive.accountEmail ? (
              <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/30">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-400" />
                  <span className="text-sm text-[var(--color-text)]">
                    Connected as {cloudSync.googleDrive.accountEmail}
                  </span>
                </div>
                <button
                  onClick={() => updateCloudSync({ 
                    googleDrive: { 
                      ...cloudSync.googleDrive, 
                      accessToken: undefined,
                      refreshToken: undefined,
                      accountEmail: undefined,
                    } 
                  })}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  openTokenDialog("googleDrive");
                }}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Globe className="w-4 h-4" />
                Connect Google Account
              </button>
            )}
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Folder Path
              </label>
              <input
                type="text"
                value={cloudSync.googleDrive.folderPath}
                onChange={(e) => updateCloudSync({ 
                  googleDrive: { ...cloudSync.googleDrive, folderPath: e.target.value } 
                })}
                placeholder="/sortOfRemoteNG"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        );

      case 'oneDrive':
        return (
          <div className="space-y-4">
            {cloudSync.oneDrive.accountEmail ? (
              <div className="flex items-center justify-between p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-[var(--color-text)]">
                    Connected as {cloudSync.oneDrive.accountEmail}
                  </span>
                </div>
                <button
                  onClick={() => updateCloudSync({ 
                    oneDrive: { 
                      ...cloudSync.oneDrive, 
                      accessToken: undefined,
                      refreshToken: undefined,
                      accountEmail: undefined,
                    } 
                  })}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  openTokenDialog("oneDrive");
                }}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Globe className="w-4 h-4" />
                Connect Microsoft Account
              </button>
            )}
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Folder Path
              </label>
              <input
                type="text"
                value={cloudSync.oneDrive.folderPath}
                onChange={(e) => updateCloudSync({ 
                  oneDrive: { ...cloudSync.oneDrive, folderPath: e.target.value } 
                })}
                placeholder="/sortOfRemoteNG"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        );

      case 'nextcloud':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Server URL
              </label>
              <input
                type="url"
                value={cloudSync.nextcloud.serverUrl}
                onChange={(e) => updateCloudSync({ 
                  nextcloud: { ...cloudSync.nextcloud, serverUrl: e.target.value } 
                })}
                placeholder="https://cloud.example.com"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Username
              </label>
              <input
                type="text"
                value={cloudSync.nextcloud.username}
                onChange={(e) => updateCloudSync({ 
                  nextcloud: { ...cloudSync.nextcloud, username: e.target.value } 
                })}
                placeholder="your-username"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
            
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cloudSync.nextcloud.useAppPassword}
                onChange={(e) => updateCloudSync({ 
                  nextcloud: { ...cloudSync.nextcloud, useAppPassword: e.target.checked } 
                })}
                className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
              />
              <span className="text-sm text-[var(--color-text)]">Use App Password (Recommended)</span>
            </label>
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                {cloudSync.nextcloud.useAppPassword ? 'App Password' : 'Password'}
              </label>
              <input
                type="password"
                value={cloudSync.nextcloud.useAppPassword ? cloudSync.nextcloud.appPassword || '' : cloudSync.nextcloud.password || ''}
                onChange={(e) => updateCloudSync({ 
                  nextcloud: { 
                    ...cloudSync.nextcloud, 
                    ...(cloudSync.nextcloud.useAppPassword 
                      ? { appPassword: e.target.value }
                      : { password: e.target.value }
                    )
                  } 
                })}
                placeholder={cloudSync.nextcloud.useAppPassword ? 'xxxxx-xxxxx-xxxxx-xxxxx' : '••••••••'}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Folder Path
              </label>
              <input
                type="text"
                value={cloudSync.nextcloud.folderPath}
                onChange={(e) => updateCloudSync({ 
                  nextcloud: { ...cloudSync.nextcloud, folderPath: e.target.value } 
                })}
                placeholder="/sortOfRemoteNG"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        );

      case 'webdav':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                WebDAV URL
              </label>
              <input
                type="url"
                value={cloudSync.webdav.serverUrl}
                onChange={(e) => updateCloudSync({ 
                  webdav: { ...cloudSync.webdav, serverUrl: e.target.value } 
                })}
                placeholder="https://webdav.example.com/dav/"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Authentication Method
              </label>
              <select
                value={cloudSync.webdav.authMethod}
                onChange={(e) => updateCloudSync({ 
                  webdav: { ...cloudSync.webdav, authMethod: e.target.value as 'basic' | 'digest' | 'bearer' } 
                })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              >
                <option value="basic">Basic Authentication</option>
                <option value="digest">Digest Authentication</option>
                <option value="bearer">Bearer Token</option>
              </select>
            </div>
            
            {cloudSync.webdav.authMethod === 'bearer' ? (
              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Bearer Token
                </label>
                <input
                  type="password"
                  value={cloudSync.webdav.bearerToken || ''}
                  onChange={(e) => updateCloudSync({ 
                    webdav: { ...cloudSync.webdav, bearerToken: e.target.value } 
                  })}
                  placeholder="Your bearer token"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={cloudSync.webdav.username}
                    onChange={(e) => updateCloudSync({ 
                      webdav: { ...cloudSync.webdav, username: e.target.value } 
                    })}
                    placeholder="your-username"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={cloudSync.webdav.password || ''}
                    onChange={(e) => updateCloudSync({ 
                      webdav: { ...cloudSync.webdav, password: e.target.value } 
                    })}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  />
                </div>
              </>
            )}
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Folder Path
              </label>
              <input
                type="text"
                value={cloudSync.webdav.folderPath}
                onChange={(e) => updateCloudSync({ 
                  webdav: { ...cloudSync.webdav, folderPath: e.target.value } 
                })}
                placeholder="/sortOfRemoteNG"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        );

      case 'sftp':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Host
                </label>
                <input
                  type="text"
                  value={cloudSync.sftp.host}
                  onChange={(e) => updateCloudSync({ 
                    sftp: { ...cloudSync.sftp, host: e.target.value } 
                  })}
                  placeholder="sftp.example.com"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
              
              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Port
                </label>
                <input
                  type="number"
                  value={cloudSync.sftp.port}
                  onChange={(e) => updateCloudSync({ 
                    sftp: { ...cloudSync.sftp, port: parseInt(e.target.value) || 22 } 
                  })}
                  placeholder="22"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Username
              </label>
              <input
                type="text"
                value={cloudSync.sftp.username}
                onChange={(e) => updateCloudSync({ 
                  sftp: { ...cloudSync.sftp, username: e.target.value } 
                })}
                placeholder="your-username"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Authentication Method
              </label>
              <select
                value={cloudSync.sftp.authMethod}
                onChange={(e) => updateCloudSync({ 
                  sftp: { ...cloudSync.sftp, authMethod: e.target.value as 'password' | 'key' } 
                })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              >
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
              </select>
            </div>
            
            {cloudSync.sftp.authMethod === 'key' ? (
              <>
                <div>
                  <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                    Private Key
                  </label>
                  <textarea
                    value={cloudSync.sftp.privateKey || ''}
                    onChange={(e) => updateCloudSync({ 
                      sftp: { ...cloudSync.sftp, privateKey: e.target.value } 
                    })}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-mono"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                    Passphrase (if encrypted)
                  </label>
                  <input
                    type="password"
                    value={cloudSync.sftp.passphrase || ''}
                    onChange={(e) => updateCloudSync({ 
                      sftp: { ...cloudSync.sftp, passphrase: e.target.value } 
                    })}
                    placeholder="Key passphrase"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={cloudSync.sftp.password || ''}
                  onChange={(e) => updateCloudSync({ 
                    sftp: { ...cloudSync.sftp, password: e.target.value } 
                  })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Remote Folder Path
              </label>
              <input
                type="text"
                value={cloudSync.sftp.folderPath}
                onChange={(e) => updateCloudSync({ 
                  sftp: { ...cloudSync.sftp, folderPath: e.target.value } 
                })}
                placeholder="/home/user/sortOfRemoteNG"
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <FolderSync className="w-5 h-5" />
          Cloud Sync
        </h3>
        <button
          onClick={() => handleSyncNow()}
          disabled={!cloudSync.enabled || enabledProviders.length === 0 || isSyncing}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Sync All
        </button>
      </div>

      {/* Multi-Target Sync Status Overview */}
      {cloudSync.enabled && enabledProviders.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <FolderSync className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-[var(--color-text)]">
              Syncing to {enabledProviders.length} target{enabledProviders.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {enabledProviders.map(provider => {
              const status = getProviderStatus(provider);
              return (
                <div
                  key={provider}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
                    status?.lastSyncStatus === 'success' ? 'bg-green-500/20 text-green-400' :
                    status?.lastSyncStatus === 'failed' ? 'bg-red-500/20 text-red-400' :
                    status?.lastSyncStatus === 'conflict' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {providerIcons[provider]}
                  <span>{providerLabels[provider].split(' ')[0]}</span>
                  {status?.lastSyncStatus === 'success' && <Check className="w-3 h-3" />}
                  {status?.lastSyncStatus === 'failed' && <X className="w-3 h-3" />}
                  {status?.lastSyncStatus === 'conflict' && <AlertTriangle className="w-3 h-3" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Enable Cloud Sync */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Cloud className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <span className="text-[var(--color-text)] font-medium">
                Enable Cloud Sync
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                Synchronize your connections and settings across devices
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={cloudSync.enabled}
            onChange={(e) => updateCloudSync({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>
      </div>

      {/* Multi-Target Cloud Providers */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
            <Cloud className="w-4 h-4 inline mr-2" />
            Sync Targets
          </label>
          <span className="text-xs text-[var(--color-textMuted)]">
            Enable multiple targets for redundancy
          </span>
        </div>
        
        <div className="space-y-2">
          {CloudSyncProviders.filter(p => p !== 'none').map((provider) => {
            const isEnabled = enabledProviders.includes(provider);
            const isExpanded = expandedProvider === provider;
            const status = getProviderStatus(provider);
            
            return (
              <div 
                key={provider}
                className={`rounded-lg border transition-all ${
                  isEnabled
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)]/50'
                }`}
              >
                {/* Provider Header */}
                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleProvider(provider)}
                        className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      {providerIcons[provider]}
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text)]">
                          {providerLabels[provider]}
                        </div>
                        <div className="text-xs text-[var(--color-textSecondary)]">
                          {providerDescriptions[provider]}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {/* Status indicator */}
                    {isEnabled && status?.lastSyncTime && (
                      <span className="text-xs text-[var(--color-textMuted)]">
                        {new Date(getSyncTimestampMs(status.lastSyncTime) ?? 0).toLocaleDateString()}
                      </span>
                    )}
                    
                    {/* Sync this provider button */}
                    {isEnabled && (
                      <button
                        onClick={() => handleSyncProvider(provider)}
                        disabled={syncingProvider === provider || isSyncing}
                        className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={`Sync to ${providerLabels[provider]}`}
                      >
                        <RefreshCw className="w-4 h-4 text-[var(--color-textSecondary)]" />
                      </button>
                    )}
                    
                    {/* Expand/collapse config */}
                    {isEnabled && (
                      <button
                        onClick={() => setExpandedProvider(isExpanded ? null : provider)}
                        className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-[var(--color-textSecondary)]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[var(--color-textSecondary)]" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Provider Configuration (expanded) */}
                {isEnabled && isExpanded && (
                  <div className="border-t border-[var(--color-border)] p-3">
                    {renderProviderConfig(provider)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sync Frequency */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
          <Clock className="w-4 h-4 inline mr-2" />
          Sync Frequency
        </label>
        
        <select
          value={cloudSync.frequency}
          onChange={(e) => updateCloudSync({ frequency: e.target.value as CloudSyncFrequency })}
          className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          {CloudSyncFrequencies.map((freq) => (
            <option key={freq} value={freq}>
              {frequencyLabels[freq]}
            </option>
          ))}
        </select>
      </div>

      {/* What to Sync */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
          <Database className="w-4 h-4 inline mr-2" />
          What to Sync
        </label>
        
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={cloudSync.syncConnections}
              onChange={(e) => updateCloudSync({ syncConnections: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <HardDrive className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-[var(--color-text)]">Connections</span>
          </label>
          
          <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={cloudSync.syncSettings}
              onChange={(e) => updateCloudSync({ syncSettings: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <Settings className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-[var(--color-text)]">Settings</span>
          </label>
          
          <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={cloudSync.syncSSHKeys}
              onChange={(e) => updateCloudSync({ syncSSHKeys: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <Key className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-[var(--color-text)]">SSH Keys</span>
          </label>
          
          <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={cloudSync.syncScripts}
              onChange={(e) => updateCloudSync({ syncScripts: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <FileKey className="w-4 h-4 text-green-400" />
            <span className="text-sm text-[var(--color-text)]">Scripts</span>
          </label>
          
          <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={cloudSync.syncColorTags}
              onChange={(e) => updateCloudSync({ syncColorTags: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <Palette className="w-4 h-4 text-pink-400" />
            <span className="text-sm text-[var(--color-text)]">Color Tags</span>
          </label>
          
          <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
            <input
              type="checkbox"
              checked={cloudSync.syncShortcuts}
              onChange={(e) => updateCloudSync({ syncShortcuts: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <Keyboard className="w-4 h-4 text-orange-400" />
            <span className="text-sm text-[var(--color-text)]">Shortcuts</span>
          </label>
        </div>
      </div>

      {/* Encryption */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4 space-y-4">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Shield className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <span className="text-[var(--color-text)] font-medium">
                Encrypt Before Sync
              </span>
              <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
                End-to-end encrypt data before uploading to cloud
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={cloudSync.encryptBeforeSync}
            onChange={(e) => updateCloudSync({ encryptBeforeSync: e.target.checked })}
            className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
        </label>
        
        {cloudSync.encryptBeforeSync && (
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              <Lock className="w-4 h-4 inline mr-1" />
              Encryption Password
            </label>
            <input
              type="password"
              value={cloudSync.syncEncryptionPassword || ''}
              onChange={(e) => updateCloudSync({ syncEncryptionPassword: e.target.value })}
              placeholder="Enter a strong password"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
            <p className="text-xs text-[var(--color-textSecondary)] mt-1">
              <Info className="w-3 h-3 inline mr-1" />
              This password is required on all devices to decrypt synced data
            </p>
          </div>
        )}
      </div>

      {/* Conflict Resolution */}
      <div className="space-y-4">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          Conflict Resolution
        </label>
        
        <select
          value={cloudSync.conflictResolution}
          onChange={(e) => updateCloudSync({ conflictResolution: e.target.value as ConflictResolutionStrategy })}
          className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          {ConflictResolutionStrategies.map((strategy) => (
            <option key={strategy} value={strategy}>
              {conflictLabels[strategy]}
            </option>
          ))}
        </select>
        
        <p className="text-xs text-[var(--color-textSecondary)]">
          {conflictDescriptions[cloudSync.conflictResolution]}
        </p>
      </div>

      {/* Startup/Shutdown Options */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
          <input
            type="checkbox"
            checked={cloudSync.syncOnStartup}
            onChange={(e) => updateCloudSync({ syncOnStartup: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
          <span className="text-sm text-[var(--color-text)]">Sync on Startup</span>
        </label>
        
        <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
          <input
            type="checkbox"
            checked={cloudSync.syncOnShutdown}
            onChange={(e) => updateCloudSync({ syncOnShutdown: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
          <span className="text-sm text-[var(--color-text)]">Sync on Shutdown</span>
        </label>
      </div>

      {/* Notifications */}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
          <input
            type="checkbox"
            checked={cloudSync.notifyOnSync}
            onChange={(e) => updateCloudSync({ notifyOnSync: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
          <Bell className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-[var(--color-text)]">Notify on Sync</span>
        </label>
        
        <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
          <input
            type="checkbox"
            checked={cloudSync.notifyOnConflict}
            onChange={(e) => updateCloudSync({ notifyOnConflict: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
          />
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <span className="text-sm text-[var(--color-text)]">Notify on Conflict</span>
        </label>
      </div>

      {/* Advanced Options */}
      <div className="space-y-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center justify-between w-full p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]/50 transition-colors"
        >
          <span className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Advanced Options
          </span>
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        
        {showAdvanced && (
          <div className="space-y-4 p-4 bg-[var(--color-surface)]/50 rounded-lg border border-[var(--color-border)]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cloudSync.compressionEnabled}
                onChange={(e) => updateCloudSync({ compressionEnabled: e.target.checked })}
                className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
              />
              <span className="text-sm text-[var(--color-text)]">Enable Compression</span>
            </label>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Max File Size (MB)
                </label>
                <input
                  type="number"
                  value={cloudSync.maxFileSizeMB}
                  onChange={(e) => updateCloudSync({ maxFileSizeMB: parseInt(e.target.value) || 50 })}
                  min={1}
                  max={500}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
              
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  <Upload className="w-3 h-3 inline mr-1" />
                  Upload Limit (KB/s, 0=∞)
                </label>
                <input
                  type="number"
                  value={cloudSync.uploadLimitKBs}
                  onChange={(e) => updateCloudSync({ uploadLimitKBs: parseInt(e.target.value) || 0 })}
                  min={0}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
              
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  <Download className="w-3 h-3 inline mr-1" />
                  Download Limit (KB/s, 0=∞)
                </label>
                <input
                  type="number"
                  value={cloudSync.downloadLimitKBs}
                  onChange={(e) => updateCloudSync({ downloadLimitKBs: parseInt(e.target.value) || 0 })}
                  min={0}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Exclude Patterns (one per line)
              </label>
              <textarea
                value={cloudSync.excludePatterns.join('\n')}
                onChange={(e) => updateCloudSync({ 
                  excludePatterns: e.target.value.split('\n').filter(p => p.trim()) 
                })}
                placeholder="*.tmp&#10;*.bak&#10;temp/*"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-mono"
              />
            </div>
          </div>
        )}
      </div>

      {authProvider && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTokenDialog();
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--color-text)]">
                {authProvider === "googleDrive"
                  ? "Connect Google Drive"
                  : "Connect OneDrive"}
              </h3>
              <button
                onClick={closeTokenDialog}
                className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--color-textSecondary)] mt-2">
              Paste access tokens if you already completed OAuth in a browser.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Access Token
                </label>
                <input
                  type="password"
                  value={authForm.accessToken}
                  onChange={(e) => setAuthForm({ ...authForm, accessToken: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Refresh Token (optional)
                </label>
                <input
                  type="password"
                  value={authForm.refreshToken}
                  onChange={(e) => setAuthForm({ ...authForm, refreshToken: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Account Email
                </label>
                <input
                  type="email"
                  value={authForm.accountEmail}
                  onChange={(e) => setAuthForm({ ...authForm, accountEmail: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                  Token Expiry (epoch seconds, optional)
                </label>
                <input
                  type="number"
                  value={authForm.tokenExpiry}
                  onChange={(e) => setAuthForm({ ...authForm, tokenExpiry: e.target.value })}
                  min={0}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTokenDialog}
                className="px-3 py-2 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveTokenDialog}
                className="px-3 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Save Tokens
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloudSyncSettings;
