import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useConnections } from '../../contexts/useConnections';
import { SettingsManager } from '../../utils/settingsManager';
import { Connection } from '../../types/connection';
import { GlobalSettings } from '../../types/settings';

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

export interface BackupListItem {
  id: string;
  filename: string;
  createdAt: number;
  backupType: string;
  sizeBytes: number;
  encrypted: boolean;
  compressed: boolean;
}

interface BackupRestorePayload {
  connections?: Connection[];
  settings?: Partial<GlobalSettings>;
  timestamp?: number;
}

// ─── Formatting helpers ─────────────────────────────────────────────

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

// ─── Hook ───────────────────────────────────────────────────────────

interface UseBackupStatusOptions {
  onBackupNow?: (data: unknown) => Promise<void>;
}

export function useBackupStatus({ onBackupNow }: UseBackupStatusOptions = {}) {
  const { t } = useTranslation();
  const { dispatch } = useConnections();
  const settingsManager = SettingsManager.getInstance();

  const [isOpen, setIsOpen] = useState(false);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupList, setBackupList] = useState<BackupListItem[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showBackupList, setShowBackupList] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    const interval = setInterval(fetchBackupStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch backup list when showing list
  const fetchBackupList = useCallback(async () => {
    try {
      const list = await invoke<BackupListItem[]>('backup_list');
      setBackupList(list);
    } catch (error) {
      console.error('Failed to fetch backup list:', error);
    }
  }, []);

  useEffect(() => {
    if (showBackupList) {
      fetchBackupList();
    }
  }, [showBackupList, fetchBackupList]);

  const getStatusIcon = useCallback(() => {
    if (isBackingUp || backupStatus?.isRunning) return 'loading' as const;
    if (!backupStatus || backupStatus.backupCount === 0) return 'empty' as const;
    if (backupStatus.lastBackupStatus === 'failed') return 'failed' as const;
    if (backupStatus.lastBackupStatus === 'success') return 'success' as const;
    return 'default' as const;
  }, [isBackingUp, backupStatus]);

  const handleBackupNow = useCallback(async () => {
    setIsBackingUp(true);
    try {
      if (onBackupNow) {
        await onBackupNow({});
      } else {
        await invoke('backup_run_now', {
          backupType: 'manual',
          data: { connections: [], settings: {}, timestamp: Date.now() },
        });
      }
      const status = await invoke<BackupStatus>('backup_get_status');
      setBackupStatus(status);
      await fetchBackupList();
    } catch (error) {
      console.error('Backup failed:', error);
    } finally {
      setIsBackingUp(false);
    }
  }, [onBackupNow, fetchBackupList]);

  const handleTestBackup = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const testData = {
        connections: [{ id: 'test', name: 'Test Connection', protocol: 'ssh' }],
        settings: { testMode: true },
        timestamp: Date.now(),
      };

      const metadata = await invoke<{ id: string; checksum: string }>('backup_run_now', {
        backupType: 'test',
        data: testData,
      });

      const restored = await invoke<{ connections: unknown[] }>('backup_restore', {
        backupId: metadata.id,
      });

      await invoke('backup_delete', { backupId: metadata.id });

      if (restored && restored.connections && restored.connections.length > 0) {
        setTestResult({
          success: true,
          message: t('backup.testSuccess', 'Backup test passed! Data integrity verified.'),
        });
      } else {
        setTestResult({
          success: false,
          message: t('backup.testFailed', 'Backup test failed: Data verification failed.'),
        });
      }

      const status = await invoke<BackupStatus>('backup_get_status');
      setBackupStatus(status);
    } catch (error) {
      setTestResult({
        success: false,
        message: t('backup.testError', 'Backup test failed: {{error}}', { error: String(error) }),
      });
    } finally {
      setIsTesting(false);
    }
  }, [t]);

  const handleRestoreBackup = useCallback(
    async (backupId: string) => {
      if (
        !confirm(
          t(
            'backup.confirmRestore',
            'Are you sure you want to restore this backup? Current data will be overwritten.',
          ),
        )
      ) {
        return;
      }
      try {
        const data = await invoke<BackupRestorePayload>('backup_restore', { backupId });
        const restoredConnections = Array.isArray(data?.connections)
          ? data.connections.map((conn: any) => ({
              ...conn,
              createdAt: conn.createdAt ? new Date(conn.createdAt) : new Date(),
              updatedAt: conn.updatedAt ? new Date(conn.updatedAt) : new Date(),
            }))
          : [];

        if (restoredConnections.length > 0) {
          dispatch({ type: 'SET_CONNECTIONS', payload: restoredConnections });
        }
        if (data?.settings && Object.keys(data.settings).length > 0) {
          await settingsManager.saveSettings(data.settings);
        }
        alert(t('backup.restoreSuccess', 'Backup restored successfully.'));
      } catch (error) {
        console.error('Restore failed:', error);
        alert(t('backup.restoreFailed', 'Failed to restore backup: {{error}}', { error: String(error) }));
      }
    },
    [t, dispatch, settingsManager],
  );

  const handleDeleteBackup = useCallback(
    async (backupId: string) => {
      if (!confirm(t('backup.confirmDelete', 'Are you sure you want to delete this backup?'))) {
        return;
      }
      try {
        await invoke('backup_delete', { backupId });
        await fetchBackupList();
        const status = await invoke<BackupStatus>('backup_get_status');
        setBackupStatus(status);
      } catch (error) {
        console.error('Delete failed:', error);
      }
    },
    [t, fetchBackupList],
  );

  return {
    t,
    isOpen,
    setIsOpen,
    backupStatus,
    backupList,
    isBackingUp,
    isTesting,
    testResult,
    showBackupList,
    setShowBackupList,
    dropdownRef,
    getStatusIcon,
    handleBackupNow,
    handleTestBackup,
    handleRestoreBackup,
    handleDeleteBackup,
  };
}
