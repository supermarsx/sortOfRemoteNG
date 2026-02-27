import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud,
  CloudOff,
  HardDrive,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Archive,
  Timer,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { CloudSyncProvider, defaultCloudSyncConfig } from '../types/settings';

interface BackupStatus {
  isRunning: boolean;
  lastBackupTime?: number;
  lastBackupType?: string;
  lastBackupStatus?: 'success' | 'failed' | 'partial';
  lastError?: string;
  nextScheduledTime?: number;
  backupCount: number;
  totalSizeBytes: number;
}

interface ProviderStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;
}

interface SyncBackupStatusBarProps {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
    providerStatus: Partial<Record<CloudSyncProvider, ProviderStatus>>;
    frequency: string;
  };
  onSyncNow?: (provider?: CloudSyncProvider) => void;
  onBackupNow?: () => void;
  onOpenSettings?: () => void;
}

const PROVIDER_NAMES: Record<CloudSyncProvider, string> = {
  none: 'None',
  googleDrive: 'Google Drive',
  oneDrive: 'OneDrive',
  nextcloud: 'Nextcloud',
  webdav: 'WebDAV',
  sftp: 'SFTP',
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp) return 'Never';
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

const formatNextTime = (timestamp?: number): string => {
  if (!timestamp) return 'Not scheduled';
  const now = Date.now() / 1000;
  const diff = timestamp - now;
  
  if (diff < 0) return 'Overdue';
  if (diff < 60) return 'In < 1m';
  if (diff < 3600) return `In ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `In ${Math.floor(diff / 3600)}h`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

export const SyncBackupStatusBar: React.FC<SyncBackupStatusBarProps> = ({
  cloudSyncConfig,
  onSyncNow,
  onBackupNow,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setIsExpanded(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch backup status from Rust backend
  useEffect(() => {
    const fetchBackupStatus = async () => {
      try {
        const status = await invoke<BackupStatus>('backup_get_status');
        setBackupStatus(status);
      } catch (error) {
        console.error('Failed to fetch backup status:', error);
      }
    };

    fetchBackupStatus();
    const interval = setInterval(fetchBackupStatus, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  const config = cloudSyncConfig ?? {
    enabled: false,
    enabledProviders: [],
    providerStatus: {},
    frequency: 'manual',
  };

  const enabledProviders = config.enabledProviders.filter(p => p !== 'none');
  const hasSync = config.enabled && enabledProviders.length > 0;

  // Compute overall sync status
  const getSyncStatusIcon = () => {
    if (isSyncing) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
    }

    if (!hasSync) {
      return <CloudOff className="w-4 h-4 text-gray-500" />;
    }

    const statuses = enabledProviders.map(p => config.providerStatus[p]?.lastSyncStatus);
    if (statuses.some(s => s === 'failed')) {
      return <AlertCircle className="w-4 h-4 text-red-400" />;
    }
    if (statuses.some(s => s === 'conflict')) {
      return <AlertCircle className="w-4 h-4 text-yellow-400" />;
    }
    if (statuses.every(s => s === 'success')) {
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    }
    return <Cloud className="w-4 h-4 text-gray-400" />;
  };

  // Compute overall backup status
  const getBackupStatusIcon = () => {
    if (isBackingUp || backupStatus?.isRunning) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
    }

    if (!backupStatus || backupStatus.backupCount === 0) {
      return <Archive className="w-4 h-4 text-gray-500" />;
    }

    if (backupStatus.lastBackupStatus === 'failed') {
      return <AlertCircle className="w-4 h-4 text-red-400" />;
    }
    if (backupStatus.lastBackupStatus === 'success') {
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    }
    return <HardDrive className="w-4 h-4 text-gray-400" />;
  };

  const handleSyncAll = async () => {
    if (!onSyncNow) return;
    setIsSyncing(true);
    try {
      await onSyncNow();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncProvider = async (provider: CloudSyncProvider) => {
    if (!onSyncNow) return;
    setIsSyncing(true);
    try {
      await onSyncNow(provider);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBackupNow = async () => {
    if (!onBackupNow) return;
    setIsBackingUp(true);
    try {
      await onBackupNow();
      // Refresh status
      const status = await invoke<BackupStatus>('backup_get_status');
      setBackupStatus(status);
    } finally {
      setIsBackingUp(false);
    }
  };

  // Get last sync time across all providers
  const getLastSyncTime = (): number | undefined => {
    const times = enabledProviders
      .map(p => config.providerStatus[p]?.lastSyncTime)
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Compact Status Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-700/50 transition-colors"
        title={t('syncBackup.statusBarTitle', 'Sync & Backup Status')}
      >
        <div className="flex items-center gap-1">
          {getSyncStatusIcon()}
          {getBackupStatusIcon()}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-3 h-3 text-gray-400" />
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-400" />
        )}
      </button>

      {/* Expanded Dropdown (portal) */}
      {isExpanded && createPortal(
        <div
          ref={(el) => {
            popupRef.current = el;
            if (el && dropdownRef.current) {
              const rect = dropdownRef.current.getBoundingClientRect();
              const w = 320;
              let left = rect.right - w;
              if (left < 4) left = 4;
              el.style.top = `${rect.bottom + 8}px`;
              el.style.left = `${left}px`;
            }
          }}
          className="fixed w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl"
          style={{ zIndex: 9999 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
            <h3 className="font-semibold text-sm text-gray-200">
              {t('syncBackup.title', 'Sync & Backup')}
            </h3>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 rounded hover:bg-gray-700"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          {/* Cloud Sync Section */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-gray-200">
                  {t('syncBackup.cloudSync', 'Cloud Sync')}
                </span>
              </div>
              {hasSync && (
                <button
                  onClick={handleSyncAll}
                  disabled={isSyncing}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded"
                >
                  {isSyncing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {t('syncBackup.syncAll', 'Sync All')}
                </button>
              )}
            </div>

            {!hasSync ? (
              <p className="text-xs text-gray-500">
                {t('syncBackup.noSyncConfigured', 'No sync providers configured')}
              </p>
            ) : (
              <div className="space-y-2">
                {enabledProviders.map(provider => {
                  const status = config.providerStatus[provider];
                  return (
                    <div
                      key={provider}
                      className="flex items-center justify-between p-2 bg-gray-750 rounded"
                    >
                      <div className="flex items-center gap-2">
                        {status?.lastSyncStatus === 'success' && (
                          <CheckCircle className="w-3 h-3 text-green-400" />
                        )}
                        {status?.lastSyncStatus === 'failed' && (
                          <AlertCircle className="w-3 h-3 text-red-400" />
                        )}
                        {status?.lastSyncStatus === 'conflict' && (
                          <AlertCircle className="w-3 h-3 text-yellow-400" />
                        )}
                        {!status?.lastSyncStatus && (
                          <Clock className="w-3 h-3 text-gray-400" />
                        )}
                        <span className="text-xs text-gray-300">
                          {PROVIDER_NAMES[provider]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {formatRelativeTime(status?.lastSyncTime)}
                        </span>
                        <button
                          onClick={() => handleSyncProvider(provider)}
                          disabled={isSyncing}
                          className="p-1 hover:bg-gray-700 rounded"
                          title={t('syncBackup.syncProvider', 'Sync {{provider}}', { provider: PROVIDER_NAMES[provider] })}
                        >
                          <RefreshCw className="w-3 h-3 text-gray-400" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {hasSync && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                <span>
                  {t('syncBackup.lastSync', 'Last sync')}: {formatRelativeTime(getLastSyncTime())}
                </span>
              </div>
            )}
          </div>

          {/* Backup Section */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-gray-200">
                  {t('syncBackup.localBackup', 'Local Backup')}
                </span>
              </div>
              <button
                onClick={handleBackupNow}
                disabled={isBackingUp || backupStatus?.isRunning}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded"
              >
                {isBackingUp || backupStatus?.isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Archive className="w-3 h-3" />
                )}
                {t('syncBackup.backupNow', 'Backup Now')}
              </button>
            </div>

            {backupStatus && (
              <div className="space-y-2">
                {/* Last Backup */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    {t('syncBackup.lastBackup', 'Last backup')}:
                  </span>
                  <div className="flex items-center gap-2">
                    {backupStatus.lastBackupStatus === 'success' && (
                      <CheckCircle className="w-3 h-3 text-green-400" />
                    )}
                    {backupStatus.lastBackupStatus === 'failed' && (
                      <AlertCircle className="w-3 h-3 text-red-400" />
                    )}
                    <span className="text-gray-300">
                      {formatRelativeTime(backupStatus.lastBackupTime)}
                    </span>
                  </div>
                </div>

                {/* Next Scheduled */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    {t('syncBackup.nextBackup', 'Next backup')}:
                  </span>
                  <div className="flex items-center gap-1 text-gray-300">
                    <Timer className="w-3 h-3 text-gray-500" />
                    {formatNextTime(backupStatus.nextScheduledTime)}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-700">
                  <span className="text-gray-500">
                    {backupStatus.backupCount} {t('syncBackup.backups', 'backups')}
                  </span>
                  <span className="text-gray-500">
                    {formatBytes(backupStatus.totalSizeBytes)}
                  </span>
                </div>

                {/* Error display */}
                {backupStatus.lastError && (
                  <div className="mt-2 p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">
                    {backupStatus.lastError}
                  </div>
                )}
              </div>
            )}

            {!backupStatus && (
              <p className="text-xs text-gray-500">
                {t('syncBackup.noBackups', 'No backups yet')}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-700">
            <button
              onClick={onOpenSettings}
              className="w-full text-center text-xs text-blue-400 hover:text-blue-300"
            >
              {t('syncBackup.openSettings', 'Open Sync & Backup Settings')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default SyncBackupStatusBar;
