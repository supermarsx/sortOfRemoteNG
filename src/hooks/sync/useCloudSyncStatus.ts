import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudSyncProvider,
  CloudSyncTarget,
} from "../../types/settings/settings";
import { providersFromCloudSyncConfig } from "../../utils/services/cloudSyncService";
import { useCloudSyncActivity } from "./useCloudSyncActivity";

interface ProviderStatus {
  enabled: boolean;
  lastSyncTime?: number;
  lastSyncStatus?: "success" | "failed" | "partial" | "conflict";
  lastSyncError?: string;
}

interface UseCloudSyncStatusParams {
  cloudSyncConfig?: {
    enabled: boolean;
    enabledProviders: CloudSyncProvider[];
    syncTargets?: Array<
      Pick<CloudSyncTarget, "provider" | "enabled"> & Partial<CloudSyncTarget>
    >;
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

export { CLOUD_SYNC_PROVIDER_ICONS as PROVIDER_ICONS } from "../../utils/icons/cloudSyncProviderIcons";

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
  const activity = useCloudSyncActivity();
  const [syncingProvider, setSyncingProvider] =
    useState<CloudSyncProvider | null>(null);
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
  const anySyncing = isSyncing || activity.length > 0;
  const isProviderSyncing = (provider: CloudSyncProvider) =>
    activity.some((item) => item.provider === provider) ||
    (isSyncing && (syncingProvider === null || syncingProvider === provider));

  const handleSyncAll = async () => {
    if (!onSyncNow || anySyncing) return;
    setIsSyncing(true);
    try {
      await onSyncNow();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncProvider = async (provider: CloudSyncProvider) => {
    if (!onSyncNow || anySyncing) return;
    setSyncingProvider(provider);
    setIsSyncing(true);
    try {
      await onSyncNow(provider);
    } finally {
      setSyncingProvider(null);
      setIsSyncing(false);
    }
  };

  const getLastSyncTime = (): number | undefined => {
    const times = enabledProviders
      .map((p) => config.providerStatus[p]?.lastSyncTime)
      .filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : undefined;
  };

  return {
    t,
    isOpen,
    setIsOpen,
    isSyncing: anySyncing,
    isProviderSyncing,
    syncingProvider,
    dropdownRef,
    config,
    enabledProviders,
    hasSync,
    handleSyncAll,
    handleSyncProvider,
    getLastSyncTime,
  };
}
