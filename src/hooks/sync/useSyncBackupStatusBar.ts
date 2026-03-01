import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { CloudSyncProvider } from '../../types/settings';

export interface BackupStatus {
  isRunning: boolean;
  lastBackupTime?: number;
  lastBackupType?: string;
  lastBackupStatus?: 'success' | 'failed' | 'partial';
  lastError?: string;
  nextScheduledTime?: number;
  backupCount: number;
  totalSizeBytes: number;
}

export interface ProviderStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;
}

export const PROVIDER_NAMES: Record<CloudSyncProvider, string> = {
  none: 'None',
  googleDrive: 'Google Drive',
  oneDrive: 'OneDrive',
  nextcloud: 'Nextcloud',
  webdav: 'WebDAV',
  sftp: 'SFTP',
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp) return 'Never';
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

export const formatNextTime = (timestamp?: number): string => {
  if (!timestamp) return 'Not scheduled';
  const now = Date.now() / 1000;
  const diff = timestamp - now;
  if (diff < 0) return 'Overdue';
  if (diff < 60) return 'In < 1m';
  if (diff < 3600) return `In ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `In ${Math.floor(diff / 3600)}h`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

interface SyncBackupConfig {
  enabled: boolean;
  enabledProviders: CloudSyncProvider[];
  providerStatus: Partial<Record<CloudSyncProvider, ProviderStatus>>;
  frequency: string;
}

export function useSyncBackupStatusBar(
  cloudSyncConfig?: SyncBackupConfig,
  onSyncNow?: (provider?: CloudSyncProvider) => void,
  onBackupNow?: () => void,
) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    const interval = setInterval(fetchBackupStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const config = cloudSyncConfig ?? {
    enabled: false,
    enabledProviders: [],
    providerStatus: {},
    frequency: 'manual',
  };

  const enabledProviders = config.enabledProviders.filter((p) => p !== 'none');
  const hasSync = config.enabled && enabledProviders.length > 0;

  const handleSyncAll = useCallback(async () => {
    if (!onSyncNow) return;
    setIsSyncing(true);
    try {
      await onSyncNow();
    } finally {
      setIsSyncing(false);
    }
  }, [onSyncNow]);

  const handleSyncProvider = useCallback(
    async (provider: CloudSyncProvider) => {
      if (!onSyncNow) return;
      setIsSyncing(true);
      try {
        await onSyncNow(provider);
      } finally {
        setIsSyncing(false);
      }
    },
    [onSyncNow],
  );

  const handleBackupNow = useCallback(async () => {
    if (!onBackupNow) return;
    setIsBackingUp(true);
    try {
      await onBackupNow();
      const status = await invoke<BackupStatus>('backup_get_status');
      setBackupStatus(status);
    } finally {
      setIsBackingUp(false);
    }
  }, [onBackupNow]);

  const getLastSyncTime = useCallback((): number | undefined => {
    const times = enabledProviders
      .map((p) => config.providerStatus[p]?.lastSyncTime)
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  }, [enabledProviders, config.providerStatus]);

  return {
    t,
    isExpanded,
    setIsExpanded,
    backupStatus,
    isSyncing,
    isBackingUp,
    dropdownRef,
    config,
    enabledProviders,
    hasSync,
    handleSyncAll,
    handleSyncProvider,
    handleBackupNow,
    getLastSyncTime,
  };
}
