import { useState } from "react";
import React from "react";
import {
  Cloud,
  CloudOff,
  Server,
  Terminal,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  GlobalSettings,
  CloudSyncConfig,
  CloudSyncProvider,
  CloudSyncFrequency,
  ConflictResolutionStrategy,
  defaultCloudSyncConfig,
  ProviderSyncStatus,
} from "../../types/settings";

// ─── Static data ───────────────────────────────────────────────────

export const providerLabels: Record<CloudSyncProvider, string> = {
  none: "None (Disabled)",
  googleDrive: "Google Drive",
  oneDrive: "Microsoft OneDrive",
  nextcloud: "Nextcloud",
  webdav: "WebDAV Server",
  sftp: "SFTP Server",
};

export const providerDescriptions: Record<CloudSyncProvider, string> = {
  none: "Cloud sync is disabled",
  googleDrive: "Sync to your Google Drive account",
  oneDrive: "Sync to your Microsoft OneDrive account",
  nextcloud: "Sync to your self-hosted Nextcloud server",
  webdav: "Sync to any WebDAV-compatible server",
  sftp: "Sync via SFTP to any SSH server",
};

export const providerIcons: Record<CloudSyncProvider, React.ReactNode> = {
  none: React.createElement(CloudOff, {
    className: "w-5 h-5 text-[var(--color-textSecondary)]",
  }),
  googleDrive: React.createElement(Cloud, {
    className: "w-5 h-5 text-green-400",
  }),
  oneDrive: React.createElement(Cloud, {
    className: "w-5 h-5 text-blue-500",
  }),
  nextcloud: React.createElement(Cloud, {
    className: "w-5 h-5 text-cyan-400",
  }),
  webdav: React.createElement(Server, {
    className: "w-5 h-5 text-orange-400",
  }),
  sftp: React.createElement(Terminal, {
    className: "w-5 h-5 text-purple-400",
  }),
};

export const frequencyLabels: Record<CloudSyncFrequency, string> = {
  manual: "Manual Only",
  realtime: "Real-time (Instant)",
  onSave: "On Save",
  every5Minutes: "Every 5 Minutes",
  every15Minutes: "Every 15 Minutes",
  every30Minutes: "Every 30 Minutes",
  hourly: "Every Hour",
  daily: "Once Daily",
};

export const conflictLabels: Record<ConflictResolutionStrategy, string> = {
  askEveryTime: "Ask Every Time",
  keepLocal: "Always Keep Local",
  keepRemote: "Always Keep Remote",
  keepNewer: "Keep Newer Version",
  merge: "Attempt to Merge",
};

export const conflictDescriptions: Record<ConflictResolutionStrategy, string> =
  {
    askEveryTime: "Show a dialog when conflicts are detected",
    keepLocal: "Local changes always override remote",
    keepRemote: "Remote changes always override local",
    keepNewer: "Keep whichever version was modified most recently",
    merge: "Try to merge changes (may require manual resolution)",
  };

// ─── Hook ──────────────────────────────────────────────────────────

export function useCloudSyncSettings(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedProvider, setExpandedProvider] =
    useState<CloudSyncProvider | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingProvider, setSyncingProvider] =
    useState<CloudSyncProvider | null>(null);
  const [authProvider, setAuthProvider] = useState<CloudSyncProvider | null>(
    null,
  );
  const [authForm, setAuthForm] = useState({
    accessToken: "",
    refreshToken: "",
    accountEmail: "",
    tokenExpiry: "",
  });

  // Derived / backward-compat
  const cloudSync = settings.cloudSync ?? defaultCloudSyncConfig;
  const enabledProviders = cloudSync.enabledProviders ?? [];
  const providerStatus = cloudSync.providerStatus ?? {};

  const updateCloudSync = (updates: Partial<CloudSyncConfig>) => {
    updateSettings({
      cloudSync: { ...cloudSync, ...updates },
    });
  };

  // ── Token dialog ──

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
    const expiryValue = Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : undefined;

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

  // ── Provider management ──

  const toggleProvider = (provider: CloudSyncProvider) => {
    if (provider === "none") return;

    const newEnabledProviders = enabledProviders.includes(provider)
      ? enabledProviders.filter((p) => p !== provider)
      : [...enabledProviders, provider];

    const newStatus = { ...providerStatus };
    if (!enabledProviders.includes(provider)) {
      newStatus[provider] = { enabled: true };
      setExpandedProvider(provider);
    } else {
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
      provider:
        newEnabledProviders.length > 0 ? newEnabledProviders[0] : "none",
    });
  };

  const getProviderStatus = (
    provider: CloudSyncProvider,
  ): ProviderSyncStatus | undefined => {
    return providerStatus[provider];
  };

  const getSyncTimestampMs = (timestamp?: number): number | undefined => {
    if (!timestamp) return undefined;
    return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  };

  const applySyncStatusUpdate = (
    providers: CloudSyncProvider[],
    status: ProviderSyncStatus["lastSyncStatus"],
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

  // ── Sync ──

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
      applySyncStatusUpdate(targetProviders, "success");
    } finally {
      setIsSyncing(false);
      setSyncingProvider(null);
    }
  };

  const handleSyncProvider = async (provider: CloudSyncProvider) => {
    await handleSyncNow(provider);
  };

  // ── Sync status icon helpers ──

  const getSyncStatusIcon = () => {
    if (!cloudSync.enabled || enabledProviders.length === 0) {
      return React.createElement(CloudOff, {
        className: "w-5 h-5 text-[var(--color-textSecondary)]",
      });
    }
    switch (cloudSync.lastSyncStatus) {
      case "success":
        return React.createElement(Check, {
          className: "w-5 h-5 text-green-400",
        });
      case "failed":
        return React.createElement(X, {
          className: "w-5 h-5 text-red-400",
        });
      case "partial":
        return React.createElement(AlertTriangle, {
          className: "w-5 h-5 text-yellow-400",
        });
      case "conflict":
        return React.createElement(AlertTriangle, {
          className: "w-5 h-5 text-orange-400",
        });
      default:
        return React.createElement(RefreshCw, {
          className: "w-5 h-5 text-blue-400",
        });
    }
  };

  return {
    // State
    showAdvanced,
    setShowAdvanced,
    expandedProvider,
    setExpandedProvider,
    isSyncing,
    syncingProvider,
    authProvider,
    authForm,
    setAuthForm,

    // Derived
    cloudSync,
    enabledProviders,
    providerStatus,

    // Actions
    updateCloudSync,
    openTokenDialog,
    saveTokenDialog,
    closeTokenDialog,
    toggleProvider,
    getProviderStatus,
    getSyncTimestampMs,
    handleSyncNow,
    handleSyncProvider,
    getSyncStatusIcon,
  };
}
