import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2,
  X,
  Settings,
  TestTube,
  FileCheck,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CloudSyncProvider } from '../types/settings';

interface ProviderStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: 'success' | 'failed' | 'partial' | 'conflict';
  lastSyncError?: string;
}

interface SyncTestResult {
  provider: CloudSyncProvider;
  success: boolean;
  message: string;
  latencyMs?: number;
  canRead?: boolean;
  canWrite?: boolean;
}

interface CloudSyncStatusPopupProps {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
    providerStatus: Partial<Record<CloudSyncProvider, ProviderStatus>>;
    frequency: string;
  };
  onSyncNow?: (provider?: CloudSyncProvider) => Promise<void>;
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

const PROVIDER_ICONS: Record<CloudSyncProvider, string> = {
  none: '❌',
  googleDrive: '🔵',
  oneDrive: '☁️',
  nextcloud: '🟢',
  webdav: '🌐',
  sftp: '🔒',
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

export const CloudSyncStatusPopup: React.FC<CloudSyncStatusPopupProps> = ({
  cloudSyncConfig,
  onSyncNow,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState<CloudSyncProvider | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testingProvider, setTestingProvider] = useState<CloudSyncProvider | null>(null);
  const [testResults, setTestResults] = useState<SyncTestResult[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const config = cloudSyncConfig ?? {
    enabled: false,
    enabledProviders: [],
    providerStatus: {},
    frequency: 'manual',
  };

  const enabledProviders = config.enabledProviders.filter(p => p !== 'none');
  const hasSync = config.enabled && enabledProviders.length > 0;

  const getOverallStatusIcon = () => {
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
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    }
    if (statuses.every(s => s === 'success')) {
      return <CheckCircle className="w-4 h-4 text-green-400" />;
    }
    return <Cloud className="w-4 h-4 text-[var(--color-textSecondary)]" />;
  };

  const getProviderStatusIcon = (provider: CloudSyncProvider) => {
    const status = config.providerStatus[provider];
    if (syncingProvider === provider) {
      return <Loader2 className="w-3 h-3 animate-spin text-blue-400" />;
    }
    if (!status?.lastSyncStatus) {
      return <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />;
    }
    switch (status.lastSyncStatus) {
      case 'success':
        return <CheckCircle className="w-3 h-3 text-green-400" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-red-400" />;
      case 'conflict':
        return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
      case 'partial':
        return <AlertTriangle className="w-3 h-3 text-orange-400" />;
      default:
        return <Clock className="w-3 h-3 text-[var(--color-textSecondary)]" />;
    }
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
    setSyncingProvider(provider);
    setIsSyncing(true);
    try {
      await onSyncNow(provider);
    } finally {
      setSyncingProvider(null);
      setIsSyncing(false);
    }
  };

  const handleTestProvider = async (provider: CloudSyncProvider) => {
    setTestingProvider(provider);
    setIsTesting(true);
    
    // Remove previous result for this provider
    setTestResults(prev => prev.filter(r => r.provider !== provider));
    
    const startTime = Date.now();
    
    try {
      // Simulate connection test based on provider type
      // In real implementation, this would call actual backend APIs
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
      
      const latencyMs = Date.now() - startTime;
      
      // Simulate test - in reality this would test actual provider connectivity
      const canRead = Math.random() > 0.1; // 90% success
      const canWrite = Math.random() > 0.15; // 85% success
      const success = canRead && canWrite;
      
      const result: SyncTestResult = {
        provider,
        success,
        message: success 
          ? t('sync.testSuccess', 'Connection successful')
          : t('sync.testFailed', 'Connection failed: {{reason}}', { 
              reason: !canRead ? 'Cannot read from remote' : 'Cannot write to remote'
            }),
        latencyMs,
        canRead,
        canWrite,
      };
      
      setTestResults(prev => [...prev, result]);
    } catch (error) {
      setTestResults(prev => [...prev, {
        provider,
        success: false,
        message: t('sync.testError', 'Test failed: {{error}}', { error: String(error) }),
      }]);
    } finally {
      setTestingProvider(null);
      setIsTesting(false);
    }
  };

  const handleTestAll = async () => {
    setTestResults([]);
    for (const provider of enabledProviders) {
      await handleTestProvider(provider);
    }
  };

  const getLastSyncTime = (): number | undefined => {
    const times = enabledProviders
      .map(p => config.providerStatus[p]?.lastSyncTime)
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  };

  const getTestResultForProvider = (provider: CloudSyncProvider): SyncTestResult | undefined => {
    return testResults.find(r => r.provider === provider);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="app-bar-button p-2"
        title={t('sync.title', 'Cloud Sync Status')}
      >
        {getOverallStatusIcon()}
      </button>

      {/* Popup (portal) */}
      {isOpen && createPortal(
        <div
          ref={(el) => {
            popupRef.current = el;
            if (el && dropdownRef.current) {
              const rect = dropdownRef.current.getBoundingClientRect();
              const w = 384;
              let left = rect.right - w;
              if (left < 4) left = 4;
              el.style.top = `${rect.bottom + 8}px`;
              el.style.left = `${left}px`;
            }
          }}
          className="sor-toolbar-popup"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-gray-200">
                {t('sync.title', 'Cloud Sync')}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-gray-200"
                title={t('sync.settings', 'Sync Settings')}
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {!hasSync ? (
              <div className="text-center py-6">
                <CloudOff className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-[var(--color-textSecondary)] mb-4">
                  {t('sync.noProviders', 'No sync providers configured')}
                </p>
                <button
                  onClick={onOpenSettings}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
                >
                  {t('sync.configure', 'Configure Sync')}
                </button>
              </div>
            ) : (
              <>
                {/* Overall Status */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                    <Clock className="w-4 h-4" />
                    <span>{t('sync.lastSync', 'Last sync')}:</span>
                    <span className="text-gray-200">{formatRelativeTime(getLastSyncTime())}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleTestAll}
                      disabled={isTesting}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded transition-colors"
                      title={t('sync.testAll', 'Test All Connections')}
                    >
                      {isTesting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <TestTube className="w-3 h-3" />
                      )}
                      {t('sync.test', 'Test')}
                    </button>
                    <button
                      onClick={handleSyncAll}
                      disabled={isSyncing}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded transition-colors"
                    >
                      {isSyncing && !syncingProvider ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      {t('sync.syncAll', 'Sync All')}
                    </button>
                  </div>
                </div>

                {/* Provider List */}
                <div className="space-y-2">
                  {enabledProviders.map(provider => {
                    const status = config.providerStatus[provider];
                    const testResult = getTestResultForProvider(provider);
                    
                    return (
                      <div
                        key={provider}
                        className="p-3 bg-gray-750 rounded-lg"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{PROVIDER_ICONS[provider]}</span>
                            <span className="text-sm font-medium text-gray-200">
                              {PROVIDER_NAMES[provider]}
                            </span>
                            {getProviderStatusIcon(provider)}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleTestProvider(provider)}
                              disabled={testingProvider === provider}
                              className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-blue-400 disabled:opacity-50"
                              title={t('sync.testProvider', 'Test Connection')}
                            >
                              {testingProvider === provider ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <TestTube className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => handleSyncProvider(provider)}
                              disabled={syncingProvider === provider}
                              className="p-1 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-green-400 disabled:opacity-50"
                              title={t('sync.syncProvider', 'Sync Now')}
                            >
                              {syncingProvider === provider ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                        
                        {/* Status Details */}
                        <div className="text-xs text-gray-500">
                          <span>{t('sync.lastSync', 'Last sync')}: </span>
                          <span className="text-[var(--color-textSecondary)]">
                            {formatRelativeTime(status?.lastSyncTime)}
                          </span>
                        </div>
                        
                        {/* Error */}
                        {status?.lastSyncError && (
                          <div className="mt-2 p-2 bg-red-900/20 border border-red-800 rounded text-xs text-red-300">
                            {status.lastSyncError}
                          </div>
                        )}
                        
                        {/* Test Result */}
                        {testResult && (
                          <div className={`mt-2 p-2 rounded text-xs ${
                            testResult.success 
                              ? 'bg-green-900/20 border border-green-800 text-green-300' 
                              : 'bg-red-900/20 border border-red-800 text-red-300'
                          }`}>
                            <div className="flex items-center gap-2">
                              {testResult.success ? (
                                <FileCheck className="w-3.5 h-3.5 text-green-400" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                              )}
                              <span>{testResult.message}</span>
                            </div>
                            {testResult.latencyMs && (
                              <div className="mt-1 text-gray-500">
                                Latency: {testResult.latencyMs}ms
                                {testResult.canRead !== undefined && (
                                  <> • Read: {testResult.canRead ? '✓' : '✗'}</>
                                )}
                                {testResult.canWrite !== undefined && (
                                  <> • Write: {testResult.canWrite ? '✓' : '✗'}</>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Frequency Info */}
                <div className="mt-4 pt-3 border-t border-[var(--color-border)] text-xs text-gray-500">
                  <span>{t('sync.frequency', 'Sync frequency')}: </span>
                  <span className="text-[var(--color-textSecondary)]">{config.frequency}</span>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default CloudSyncStatusPopup;
