import React from "react";
import { PasswordInput } from "../../ui/PasswordInput";
import {
  Cloud,
  CloudCog,
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
  Globe,
  Upload,
  Download,
  Zap,
  FileKey,
  Database,
  Folder,
  HardDrive,
  Key,
  Palette,
  Keyboard,
} from "lucide-react";
import {
  CloudSyncProviders,
  CloudSyncProvider,
  CloudSyncFrequencies,
  CloudSyncFrequency,
  ConflictResolutionStrategies,
  ConflictResolutionStrategy,
  GlobalSettings,
} from "../../../types/settings";
import { Modal } from "../../ui/Modal";
import {
  useCloudSyncSettings,
  providerLabels,
  providerDescriptions,
  providerIcons,
  frequencyLabels,
  conflictLabels,
  conflictDescriptions,
} from "../../../hooks/useCloudSyncSettings";

interface CloudSyncSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

type Mgr = ReturnType<typeof useCloudSyncSettings>;

const CloudSyncSettings: React.FC<CloudSyncSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useCloudSyncSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
          <CloudCog className="w-5 h-5" />
          Cloud Sync
        </h3>
        <button
          onClick={() => mgr.handleSyncNow()}
          disabled={
            !mgr.cloudSync.enabled ||
            mgr.enabledProviders.length === 0 ||
            mgr.isSyncing
          }
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Sync All
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Synchronize connections and settings across devices using cloud storage
        providers.
      </p>

      {/* Multi-Target Sync Status Overview */}
      {mgr.cloudSync.enabled && mgr.enabledProviders.length > 0 && (
        <SyncStatusOverview mgr={mgr} />
      )}

      {/* Enable Cloud Sync */}
      <EnableSyncToggle mgr={mgr} />

      {/* Multi-Target Cloud Providers */}
      <ProviderList mgr={mgr} />

      {/* Sync Frequency */}
      <SyncFrequencySelect mgr={mgr} />

      {/* What to Sync */}
      <SyncItemsGrid mgr={mgr} />

      {/* Encryption */}
      <EncryptionSection mgr={mgr} />

      {/* Conflict Resolution */}
      <ConflictResolutionSection mgr={mgr} />

      {/* Startup/Shutdown Options */}
      <StartupShutdownGrid mgr={mgr} />

      {/* Notifications */}
      <NotificationsGrid mgr={mgr} />

      {/* Advanced Options */}
      <AdvancedSection mgr={mgr} />

      {/* Auth Token Modal */}
      {mgr.authProvider && <AuthTokenModal mgr={mgr} />}
    </div>
  );
};

export default CloudSyncSettings;

// ─── Sub-components ────────────────────────────────────────────────

function SyncStatusOverview({ mgr }: { mgr: Mgr }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <FolderSync className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-[var(--color-text)]">
          Syncing to {mgr.enabledProviders.length} target
          {mgr.enabledProviders.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {mgr.enabledProviders.map((provider) => {
          const status = mgr.getProviderStatus(provider);
          return (
            <div
              key={provider}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
                status?.lastSyncStatus === "success"
                  ? "bg-green-500/20 text-green-400"
                  : status?.lastSyncStatus === "failed"
                    ? "bg-red-500/20 text-red-400"
                    : status?.lastSyncStatus === "conflict"
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {providerIcons[provider]}
              <span>{providerLabels[provider].split(" ")[0]}</span>
              {status?.lastSyncStatus === "success" && (
                <Check className="w-3 h-3" />
              )}
              {status?.lastSyncStatus === "failed" && (
                <X className="w-3 h-3" />
              )}
              {status?.lastSyncStatus === "conflict" && (
                <AlertTriangle className="w-3 h-3" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EnableSyncToggle({ mgr }: { mgr: Mgr }) {
  return (
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
          checked={mgr.cloudSync.enabled}
          onChange={(e) => mgr.updateCloudSync({ enabled: e.target.checked })}
          className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
      </label>
    </div>
  );
}

function ProviderList({ mgr }: { mgr: Mgr }) {
  return (
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
        {CloudSyncProviders.filter((p) => p !== "none").map((provider) => {
          const isEnabled = mgr.enabledProviders.includes(provider);
          const isExpanded = mgr.expandedProvider === provider;
          const status = mgr.getProviderStatus(provider);

          return (
            <div
              key={provider}
              className={`rounded-lg border transition-all ${
                isEnabled
                  ? "border-blue-500/50 bg-blue-500/10"
                  : "border-[var(--color-border)] bg-[var(--color-surface)]/50"
              }`}
            >
              {/* Provider Header */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => mgr.toggleProvider(provider)}
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
                  {isEnabled && status?.lastSyncTime && (
                    <span className="text-xs text-[var(--color-textMuted)]">
                      {new Date(
                        mgr.getSyncTimestampMs(status.lastSyncTime) ?? 0,
                      ).toLocaleDateString()}
                    </span>
                  )}

                  {isEnabled && (
                    <button
                      onClick={() => mgr.handleSyncProvider(provider)}
                      disabled={
                        mgr.syncingProvider === provider || mgr.isSyncing
                      }
                      className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Sync to ${providerLabels[provider]}`}
                    >
                      <RefreshCw className="w-4 h-4 text-[var(--color-textSecondary)]" />
                    </button>
                  )}

                  {isEnabled && (
                    <button
                      onClick={() =>
                        mgr.setExpandedProvider(isExpanded ? null : provider)
                      }
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
                  <ProviderConfig provider={provider} mgr={mgr} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProviderConfig({
  provider,
  mgr,
}: {
  provider: CloudSyncProvider;
  mgr: Mgr;
}) {
  const cs = mgr.cloudSync;

  switch (provider) {
    case "googleDrive":
      return (
        <div className="space-y-4">
          {cs.googleDrive.accountEmail ? (
            <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/30">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-sm text-[var(--color-text)]">
                  Connected as {cs.googleDrive.accountEmail}
                </span>
              </div>
              <button
                onClick={() =>
                  mgr.updateCloudSync({
                    googleDrive: {
                      ...cs.googleDrive,
                      accessToken: undefined,
                      refreshToken: undefined,
                      accountEmail: undefined,
                    },
                  })
                }
                className="text-xs text-red-400 hover:text-red-300"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => mgr.openTokenDialog("googleDrive")}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2"
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
              value={cs.googleDrive.folderPath}
              onChange={(e) =>
                mgr.updateCloudSync({
                  googleDrive: {
                    ...cs.googleDrive,
                    folderPath: e.target.value,
                  },
                })
              }
              placeholder="/sortOfRemoteNG"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>
      );

    case "oneDrive":
      return (
        <div className="space-y-4">
          {cs.oneDrive.accountEmail ? (
            <div className="flex items-center justify-between p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-[var(--color-text)]">
                  Connected as {cs.oneDrive.accountEmail}
                </span>
              </div>
              <button
                onClick={() =>
                  mgr.updateCloudSync({
                    oneDrive: {
                      ...cs.oneDrive,
                      accessToken: undefined,
                      refreshToken: undefined,
                      accountEmail: undefined,
                    },
                  })
                }
                className="text-xs text-red-400 hover:text-red-300"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => mgr.openTokenDialog("oneDrive")}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2"
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
              value={cs.oneDrive.folderPath}
              onChange={(e) =>
                mgr.updateCloudSync({
                  oneDrive: { ...cs.oneDrive, folderPath: e.target.value },
                })
              }
              placeholder="/sortOfRemoteNG"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>
      );

    case "nextcloud":
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Server URL
            </label>
            <input
              type="url"
              value={cs.nextcloud.serverUrl}
              onChange={(e) =>
                mgr.updateCloudSync({
                  nextcloud: { ...cs.nextcloud, serverUrl: e.target.value },
                })
              }
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
              value={cs.nextcloud.username}
              onChange={(e) =>
                mgr.updateCloudSync({
                  nextcloud: { ...cs.nextcloud, username: e.target.value },
                })
              }
              placeholder="your-username"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cs.nextcloud.useAppPassword}
              onChange={(e) =>
                mgr.updateCloudSync({
                  nextcloud: {
                    ...cs.nextcloud,
                    useAppPassword: e.target.checked,
                  },
                })
              }
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <span className="text-sm text-[var(--color-text)]">
              Use App Password (Recommended)
            </span>
          </label>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              {cs.nextcloud.useAppPassword ? "App Password" : "Password"}
            </label>
            <PasswordInput
              value={
                cs.nextcloud.useAppPassword
                  ? cs.nextcloud.appPassword || ""
                  : cs.nextcloud.password || ""
              }
              onChange={(e) =>
                mgr.updateCloudSync({
                  nextcloud: {
                    ...cs.nextcloud,
                    ...(cs.nextcloud.useAppPassword
                      ? { appPassword: e.target.value }
                      : { password: e.target.value }),
                  },
                })
              }
              placeholder={
                cs.nextcloud.useAppPassword
                  ? "xxxxx-xxxxx-xxxxx-xxxxx"
                  : "••••••••"
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Folder Path
            </label>
            <input
              type="text"
              value={cs.nextcloud.folderPath}
              onChange={(e) =>
                mgr.updateCloudSync({
                  nextcloud: { ...cs.nextcloud, folderPath: e.target.value },
                })
              }
              placeholder="/sortOfRemoteNG"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>
      );

    case "webdav":
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              WebDAV URL
            </label>
            <input
              type="url"
              value={cs.webdav.serverUrl}
              onChange={(e) =>
                mgr.updateCloudSync({
                  webdav: { ...cs.webdav, serverUrl: e.target.value },
                })
              }
              placeholder="https://webdav.example.com/dav/"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method
            </label>
            <select
              value={cs.webdav.authMethod}
              onChange={(e) =>
                mgr.updateCloudSync({
                  webdav: {
                    ...cs.webdav,
                    authMethod: e.target.value as "basic" | "digest" | "bearer",
                  },
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            >
              <option value="basic">Basic Authentication</option>
              <option value="digest">Digest Authentication</option>
              <option value="bearer">Bearer Token</option>
            </select>
          </div>

          {cs.webdav.authMethod === "bearer" ? (
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Bearer Token
              </label>
              <PasswordInput
                value={cs.webdav.bearerToken || ""}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    webdav: { ...cs.webdav, bearerToken: e.target.value },
                  })
                }
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
                  value={cs.webdav.username}
                  onChange={(e) =>
                    mgr.updateCloudSync({
                      webdav: { ...cs.webdav, username: e.target.value },
                    })
                  }
                  placeholder="your-username"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Password
                </label>
                <PasswordInput
                  value={cs.webdav.password || ""}
                  onChange={(e) =>
                    mgr.updateCloudSync({
                      webdav: { ...cs.webdav, password: e.target.value },
                    })
                  }
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
              value={cs.webdav.folderPath}
              onChange={(e) =>
                mgr.updateCloudSync({
                  webdav: { ...cs.webdav, folderPath: e.target.value },
                })
              }
              placeholder="/sortOfRemoteNG"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>
      );

    case "sftp":
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Host
              </label>
              <input
                type="text"
                value={cs.sftp.host}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    sftp: { ...cs.sftp, host: e.target.value },
                  })
                }
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
                value={cs.sftp.port}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    sftp: {
                      ...cs.sftp,
                      port: parseInt(e.target.value) || 22,
                    },
                  })
                }
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
              value={cs.sftp.username}
              onChange={(e) =>
                mgr.updateCloudSync({
                  sftp: { ...cs.sftp, username: e.target.value },
                })
              }
              placeholder="your-username"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method
            </label>
            <select
              value={cs.sftp.authMethod}
              onChange={(e) =>
                mgr.updateCloudSync({
                  sftp: {
                    ...cs.sftp,
                    authMethod: e.target.value as "password" | "key",
                  },
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            >
              <option value="password">Password</option>
              <option value="key">SSH Key</option>
            </select>
          </div>

          {cs.sftp.authMethod === "key" ? (
            <>
              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Private Key
                </label>
                <textarea
                  value={cs.sftp.privateKey || ""}
                  onChange={(e) =>
                    mgr.updateCloudSync({
                      sftp: { ...cs.sftp, privateKey: e.target.value },
                    })
                  }
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Passphrase (if encrypted)
                </label>
                <PasswordInput
                  value={cs.sftp.passphrase || ""}
                  onChange={(e) =>
                    mgr.updateCloudSync({
                      sftp: { ...cs.sftp, passphrase: e.target.value },
                    })
                  }
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
              <PasswordInput
                value={cs.sftp.password || ""}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    sftp: { ...cs.sftp, password: e.target.value },
                  })
                }
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
              value={cs.sftp.folderPath}
              onChange={(e) =>
                mgr.updateCloudSync({
                  sftp: { ...cs.sftp, folderPath: e.target.value },
                })
              }
              placeholder="/home/user/sortOfRemoteNG"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}

function SyncFrequencySelect({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        <Clock className="w-4 h-4 inline mr-2" />
        Sync Frequency
      </label>
      <select
        value={mgr.cloudSync.frequency}
        onChange={(e) =>
          mgr.updateCloudSync({
            frequency: e.target.value as CloudSyncFrequency,
          })
        }
        className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)]"
      >
        {CloudSyncFrequencies.map((freq) => (
          <option key={freq} value={freq}>
            {frequencyLabels[freq]}
          </option>
        ))}
      </select>
    </div>
  );
}

function SyncItemsGrid({ mgr }: { mgr: Mgr }) {
  const items: Array<{
    key: keyof Pick<
      typeof mgr.cloudSync,
      | "syncConnections"
      | "syncSettings"
      | "syncSSHKeys"
      | "syncScripts"
      | "syncColorTags"
      | "syncShortcuts"
    >;
    icon: React.ReactNode;
    label: string;
  }> = [
    {
      key: "syncConnections",
      icon: <HardDrive className="w-4 h-4 text-blue-400" />,
      label: "Connections",
    },
    {
      key: "syncSettings",
      icon: <Settings className="w-4 h-4 text-purple-400" />,
      label: "Settings",
    },
    {
      key: "syncSSHKeys",
      icon: <Key className="w-4 h-4 text-yellow-400" />,
      label: "SSH Keys",
    },
    {
      key: "syncScripts",
      icon: <FileKey className="w-4 h-4 text-green-400" />,
      label: "Scripts",
    },
    {
      key: "syncColorTags",
      icon: <Palette className="w-4 h-4 text-pink-400" />,
      label: "Color Tags",
    },
    {
      key: "syncShortcuts",
      icon: <Keyboard className="w-4 h-4 text-orange-400" />,
      label: "Shortcuts",
    },
  ];

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        <Database className="w-4 h-4 inline mr-2" />
        What to Sync
      </label>
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ key, icon, label }) => (
          <label
            key={key}
            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors"
          >
            <input
              type="checkbox"
              checked={mgr.cloudSync[key]}
              onChange={(e) => mgr.updateCloudSync({ [key]: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            {icon}
            <span className="text-sm text-[var(--color-text)]">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function EncryptionSection({ mgr }: { mgr: Mgr }) {
  return (
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
          checked={mgr.cloudSync.encryptBeforeSync}
          onChange={(e) =>
            mgr.updateCloudSync({ encryptBeforeSync: e.target.checked })
          }
          className="w-5 h-5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
      </label>

      {mgr.cloudSync.encryptBeforeSync && (
        <div>
          <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
            <Lock className="w-4 h-4 inline mr-1" />
            Encryption Password
          </label>
          <PasswordInput
            value={mgr.cloudSync.syncEncryptionPassword || ""}
            onChange={(e) =>
              mgr.updateCloudSync({ syncEncryptionPassword: e.target.value })
            }
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
  );
}

function ConflictResolutionSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        <AlertTriangle className="w-4 h-4 inline mr-2" />
        Conflict Resolution
      </label>
      <select
        value={mgr.cloudSync.conflictResolution}
        onChange={(e) =>
          mgr.updateCloudSync({
            conflictResolution: e.target.value as ConflictResolutionStrategy,
          })
        }
        className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)]"
      >
        {ConflictResolutionStrategies.map((strategy) => (
          <option key={strategy} value={strategy}>
            {conflictLabels[strategy]}
          </option>
        ))}
      </select>
      <p className="text-xs text-[var(--color-textSecondary)]">
        {conflictDescriptions[mgr.cloudSync.conflictResolution]}
      </p>
    </div>
  );
}

function StartupShutdownGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
        <input
          type="checkbox"
          checked={mgr.cloudSync.syncOnStartup}
          onChange={(e) =>
            mgr.updateCloudSync({ syncOnStartup: e.target.checked })
          }
          className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
        <span className="text-sm text-[var(--color-text)]">
          Sync on Startup
        </span>
      </label>

      <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
        <input
          type="checkbox"
          checked={mgr.cloudSync.syncOnShutdown}
          onChange={(e) =>
            mgr.updateCloudSync({ syncOnShutdown: e.target.checked })
          }
          className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
        <span className="text-sm text-[var(--color-text)]">
          Sync on Shutdown
        </span>
      </label>
    </div>
  );
}

function NotificationsGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
        <input
          type="checkbox"
          checked={mgr.cloudSync.notifyOnSync}
          onChange={(e) =>
            mgr.updateCloudSync({ notifyOnSync: e.target.checked })
          }
          className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
        <Bell className="w-4 h-4 text-blue-400" />
        <span className="text-sm text-[var(--color-text)]">
          Notify on Sync
        </span>
      </label>

      <label className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surfaceHover)]/50 transition-colors">
        <input
          type="checkbox"
          checked={mgr.cloudSync.notifyOnConflict}
          onChange={(e) =>
            mgr.updateCloudSync({ notifyOnConflict: e.target.checked })
          }
          className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
        />
        <AlertTriangle className="w-4 h-4 text-orange-400" />
        <span className="text-sm text-[var(--color-text)]">
          Notify on Conflict
        </span>
      </label>
    </div>
  );
}

function AdvancedSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <button
        onClick={() => mgr.setShowAdvanced(!mgr.showAdvanced)}
        className="flex items-center justify-between w-full p-3 rounded-lg bg-[var(--color-surface)]/50 border border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]/50 transition-colors"
      >
        <span className="text-sm font-medium text-[var(--color-text)] flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Advanced Options
        </span>
        {mgr.showAdvanced ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {mgr.showAdvanced && (
        <div className="space-y-4 p-4 bg-[var(--color-surface)]/50 rounded-lg border border-[var(--color-border)]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={mgr.cloudSync.compressionEnabled}
              onChange={(e) =>
                mgr.updateCloudSync({ compressionEnabled: e.target.checked })
              }
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600"
            />
            <span className="text-sm text-[var(--color-text)]">
              Enable Compression
            </span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Max File Size (MB)
              </label>
              <input
                type="number"
                value={mgr.cloudSync.maxFileSizeMB}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    maxFileSizeMB: parseInt(e.target.value) || 50,
                  })
                }
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
                value={mgr.cloudSync.uploadLimitKBs}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    uploadLimitKBs: parseInt(e.target.value) || 0,
                  })
                }
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
                value={mgr.cloudSync.downloadLimitKBs}
                onChange={(e) =>
                  mgr.updateCloudSync({
                    downloadLimitKBs: parseInt(e.target.value) || 0,
                  })
                }
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
              value={mgr.cloudSync.excludePatterns.join("\n")}
              onChange={(e) =>
                mgr.updateCloudSync({
                  excludePatterns: e.target.value
                    .split("\n")
                    .filter((p) => p.trim()),
                })
              }
              placeholder="*.tmp&#10;*.bak&#10;temp/*"
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AuthTokenModal({ mgr }: { mgr: Mgr }) {
  return (
    <Modal
      isOpen={Boolean(mgr.authProvider)}
      onClose={mgr.closeTokenDialog}
      closeOnEscape={false}
      backdropClassName="z-50 bg-black/60 p-4"
      panelClassName="max-w-md mx-4"
      dataTestId="cloud-sync-token-modal"
    >
      <div className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-[var(--color-text)]">
            {mgr.authProvider === "googleDrive"
              ? "Connect Google Drive"
              : "Connect OneDrive"}
          </h3>
          <button
            onClick={mgr.closeTokenDialog}
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
            <PasswordInput
              value={mgr.authForm.accessToken}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  accessToken: e.target.value,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Refresh Token (optional)
            </label>
            <PasswordInput
              value={mgr.authForm.refreshToken}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  refreshToken: e.target.value,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Account Email
            </label>
            <input
              type="email"
              value={mgr.authForm.accountEmail}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  accountEmail: e.target.value,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Token Expiry (epoch seconds, optional)
            </label>
            <input
              type="number"
              value={mgr.authForm.tokenExpiry}
              onChange={(e) =>
                mgr.setAuthForm({
                  ...mgr.authForm,
                  tokenExpiry: e.target.value,
                })
              }
              min={0}
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-text)] text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={mgr.closeTokenDialog}
            className="px-3 py-2 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={mgr.saveTokenDialog}
            className="px-3 py-2 text-sm text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Save Tokens
          </button>
        </div>
      </div>
    </Modal>
  );
}
