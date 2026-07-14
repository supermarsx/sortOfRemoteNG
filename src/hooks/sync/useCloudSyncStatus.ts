import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudSyncProvider,
  CloudSyncTarget,
} from "../../types/settings/settings";
import {
  providersFromCloudSyncConfig,
  testCloudSyncProvider,
} from "../../utils/services/cloudSyncService";

interface ProviderStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: "success" | "failed" | "partial" | "conflict";
  lastSyncError?: string;
}

export interface SyncTestResult {
  provider: CloudSyncProvider;
  success: boolean;
  message: string;
  latencyMs?: number;
  canRead?: boolean;
  canWrite?: boolean;
}

interface UseCloudSyncStatusParams {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
    syncTargets?: Array<Pick<CloudSyncTarget, "provider" | "enabled">>;
    providerStatus: Partial<Record<CloudSyncProvider, ProviderStatus>>;
    frequency: string;
  };
  onSyncNow?: (provider?: CloudSyncProvider) => Promise<void>;
}

export const PROVIDER_NAMES: Record<CloudSyncProvider, string> = {
  none: "None",
  googleDrive: "Google Drive",
  oneDrive: "OneDrive",
  nextcloud: "Nextcloud",
  webdav: "WebDAV",
  sftp: "SFTP",
};

export const PROVIDER_ICONS: Record<CloudSyncProvider, string> = {
  none: "❌",
  googleDrive: "🔵",
  oneDrive: "☁️",
  nextcloud: "🟢",
  webdav: "🌐",
  sftp: "🔒",
};

export const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp) return "Never";
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
};

export function useCloudSyncStatus({
  cloudSyncConfig,
  onSyncNow,
}: UseCloudSyncStatusParams) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingProvider, setSyncingProvider] =
    useState<CloudSyncProvider | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testingProvider, setTestingProvider] =
    useState<CloudSyncProvider | null>(null);
  const [testResults, setTestResults] = useState<SyncTestResult[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const config = cloudSyncConfig ?? {
    enabled: false,
    enabledProviders: [],
    syncTargets: [],
    providerStatus: {},
    frequency: "manual",
  };

  const enabledProviders = providersFromCloudSyncConfig(config);
  const hasSync = config.enabled && enabledProviders.length > 0;

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
    setTestResults((prev) => prev.filter((r) => r.provider !== provider));
    try {
      const result = await testCloudSyncProvider(provider);
      setTestResults((prev) => [
        ...prev,
        {
          provider,
          success: result.status === "success",
          message:
            result.status === "success"
              ? t("sync.testSuccess", "Connection successful")
              : result.message,
          latencyMs: result.latencyMs,
          canRead: result.canRead,
          canWrite: result.canWrite,
        },
      ]);
    } catch (error) {
      setTestResults((prev) => [
        ...prev,
        {
          provider,
          success: false,
          message: t("sync.testError", "Test failed: {{error}}", {
            error: String(error),
          }),
        },
      ]);
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
      .map((p) => config.providerStatus[p]?.lastSyncTime)
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  };

  const getTestResultForProvider = (
    provider: CloudSyncProvider,
  ): SyncTestResult | undefined => {
    return testResults.find((r) => r.provider === provider);
  };

  return {
    t,
    isOpen,
    setIsOpen,
    isSyncing,
    syncingProvider,
    isTesting,
    testingProvider,
    dropdownRef,
    config,
    enabledProviders,
    hasSync,
    handleSyncAll,
    handleSyncProvider,
    handleTestProvider,
    handleTestAll,
    getLastSyncTime,
    getTestResultForProvider,
  };
}
