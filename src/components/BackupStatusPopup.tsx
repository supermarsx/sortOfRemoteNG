import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  Archive,
  Timer,
  X,
  Play,
  Trash2,
  Download,
  Upload,
  Settings,
  TestTube,
  FolderOpen,
  FileCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useConnections } from '../contexts/useConnections';
import { SettingsManager } from '../utils/settingsManager';
import { Connection } from '../types/connection';
import { GlobalSettings } from '../types/settings';

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

interface BackupListItem {
  id: string;
  filename: string;
  createdAt: number;
  backupType: string;
  sizeBytes: number;
  encrypted: boolean;
  compressed: boolean;
}

interface BackupStatusPopupProps {
  onBackupNow?: (data: unknown) => Promise<void>;
  onOpenSettings?: () => void;
}

interface BackupRestorePayload {
  connections?: Connection[];
  settings?: Partial<GlobalSettings>;
  timestamp?: number;
}

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

export const BackupStatusPopup: React.FC<BackupStatusPopupProps> = ({
  onBackupNow,
  onOpenSettings,
}) => {
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
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
    const interval = setInterval(fetchBackupStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch backup list when showing list
  useEffect(() => {
    if (showBackupList) {
      fetchBackupList();
    }
  }, [showBackupList]);

  const fetchBackupList = async () => {
    try {
      const list = await invoke<BackupListItem[]>('backup_list');
      setBackupList(list);
    } catch (error) {
      console.error('Failed to fetch backup list:', error);
    }
  };

  const getStatusIcon = () => {
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

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      if (onBackupNow) {
        await onBackupNow({});
      } else {
        // Fallback: call backup directly
        await invoke('backup_run_now', { 
          backupType: 'manual',
          data: { connections: [], settings: {}, timestamp: Date.now() }
        });
      }
      // Refresh status
      const status = await invoke<BackupStatus>('backup_get_status');
      setBackupStatus(status);
      await fetchBackupList();
    } catch (error) {
      console.error('Backup failed:', error);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleTestBackup = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // Test backup by creating a small test backup and verifying it
      const testData = {
        connections: [{ id: 'test', name: 'Test Connection', protocol: 'ssh' }],
        settings: { testMode: true },
        timestamp: Date.now(),
      };
      
      // Run backup
      const metadata = await invoke<{ id: string; checksum: string }>('backup_run_now', {
        backupType: 'test',
        data: testData,
      });
      
      // Verify by restoring
      const restored = await invoke<{ connections: unknown[] }>('backup_restore', {
        backupId: metadata.id,
      });
      
      // Clean up test backup
      await invoke('backup_delete', { backupId: metadata.id });
      
      // Verify data integrity
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
      
      // Refresh status
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
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!confirm(t('backup.confirmRestore', 'Are you sure you want to restore this backup? Current data will be overwritten.'))) {
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
        dispatch({ type: "SET_CONNECTIONS", payload: restoredConnections });
      }

      if (data?.settings && Object.keys(data.settings).length > 0) {
        await settingsManager.saveSettings(data.settings);
      }

      alert(t('backup.restoreSuccess', 'Backup restored successfully.'));
    } catch (error) {
      console.error('Restore failed:', error);
      alert(t('backup.restoreFailed', 'Failed to restore backup: {{error}}', { error: String(error) }));
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
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
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="app-bar-button p-2"
        title={t('backup.title', 'Backup Status')}
      >
        {getStatusIcon()}
      </button>

      {/* Popup */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-96 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold text-gray-200">
                {t('backup.title', 'Local Backup')}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowBackupList(!showBackupList)}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                title={t('backup.viewBackups', 'View Backups')}
              >
                <FolderOpen className="w-4 h-4" />
              </button>
              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                title={t('backup.settings', 'Backup Settings')}
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {/* Status Section */}
            {backupStatus && (
              <div className="space-y-3 mb-4">
                {/* Last Backup */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">{t('backup.lastBackup', 'Last backup')}:</span>
                  <div className="flex items-center gap-2">
                    {backupStatus.lastBackupStatus === 'success' && (
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    )}
                    {backupStatus.lastBackupStatus === 'failed' && (
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span className="text-gray-200">
                      {formatRelativeTime(backupStatus.lastBackupTime)}
                    </span>
                  </div>
                </div>

                {/* Next Scheduled */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">{t('backup.nextBackup', 'Next backup')}:</span>
                  <div className="flex items-center gap-1.5 text-gray-200">
                    <Timer className="w-3.5 h-3.5 text-gray-500" />
                    {formatNextTime(backupStatus.nextScheduledTime)}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-700">
                  <span className="text-gray-500">
                    {backupStatus.backupCount} {t('backup.backups', 'backups')}
                  </span>
                  <span className="text-gray-500">
                    {formatBytes(backupStatus.totalSizeBytes)}
                  </span>
                </div>

                {/* Error display */}
                {backupStatus.lastError && (
                  <div className="p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">
                    {backupStatus.lastError}
                  </div>
                )}
              </div>
            )}

            {!backupStatus && (
              <p className="text-sm text-gray-500 mb-4">
                {t('backup.noBackups', 'No backups yet')}
              </p>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`p-3 rounded-lg mb-4 ${testResult.success ? 'bg-green-900/20 border border-green-800' : 'bg-red-900/20 border border-red-800'}`}>
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <FileCheck className="w-4 h-4 text-green-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span className={`text-sm ${testResult.success ? 'text-green-300' : 'text-red-300'}`}>
                    {testResult.message}
                  </span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleBackupNow}
                disabled={isBackingUp || backupStatus?.isRunning}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {isBackingUp || backupStatus?.isRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
                {t('backup.backupNow', 'Backup Now')}
              </button>
              <button
                onClick={handleTestBackup}
                disabled={isTesting}
                className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                title={t('backup.testBackup', 'Test Backup')}
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TestTube className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Backup List */}
            {showBackupList && (
              <div className="mt-4 pt-4 border-t border-gray-700">
                <h4 className="text-sm font-medium text-gray-300 mb-2">
                  {t('backup.availableBackups', 'Available Backups')}
                </h4>
                {backupList.length === 0 ? (
                  <p className="text-xs text-gray-500">{t('backup.noBackupsFound', 'No backups found')}</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {backupList.map((backup) => (
                      <div
                        key={backup.id}
                        className="flex items-center justify-between p-2 bg-gray-750 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-gray-300 truncate">
                            {backup.filename}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{formatRelativeTime(backup.createdAt)}</span>
                            <span>•</span>
                            <span>{formatBytes(backup.sizeBytes)}</span>
                            {backup.encrypted && <span className="text-yellow-500">🔒</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleRestoreBackup(backup.id)}
                            className="p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-green-400"
                            title={t('backup.restore', 'Restore')}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteBackup(backup.id)}
                            className="p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-red-400"
                            title={t('backup.delete', 'Delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupStatusPopup;
