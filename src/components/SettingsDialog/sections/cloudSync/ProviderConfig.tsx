import { PasswordInput } from "../../../ui/forms/PasswordInput";
import { Check, Globe, Folder, Key } from "lucide-react";
import { CloudSyncProvider } from "../../../../types/settings";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";
import type { Mgr } from "./types";
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
              className="sor-settings-input"
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
              className="sor-settings-input"
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
              className="sor-settings-input"
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
              className="sor-settings-input"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={cs.nextcloud.useAppPassword} onChange={(v: boolean) => mgr.updateCloudSync({
                  nextcloud: {
                    ...cs.nextcloud,
                    useAppPassword: v,
                  },
                })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
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
              className="sor-settings-input"
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
              className="sor-settings-input"
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
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method
            </label>
            <Select value={cs.webdav.authMethod} onChange={(v: string) => mgr.updateCloudSync({
                  webdav: {
                    ...cs.webdav,
                    authMethod: v as "basic" | "digest" | "bearer",
                  },
                })} options={[{ value: "basic", label: "Basic Authentication" }, { value: "digest", label: "Digest Authentication" }, { value: "bearer", label: "Bearer Token" }]} className="sor-settings-input" />
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
                className="sor-settings-input"
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
                  className="sor-settings-input"
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
                  className="sor-settings-input"
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
              className="sor-settings-input"
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
                className="sor-settings-input"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Port
              </label>
              <NumberInput value={cs.sftp.port} onChange={(v: number) => mgr.updateCloudSync({
                    sftp: {
                      ...cs.sftp,
                      port: v,
                    },
                  })} className="sor-settings-input" />
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
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method
            </label>
            <Select value={cs.sftp.authMethod} onChange={(v: string) => mgr.updateCloudSync({
                  sftp: {
                    ...cs.sftp,
                    authMethod: v as "password" | "key",
                  },
                })} options={[{ value: "password", label: "Password" }, { value: "key", label: "SSH Key" }]} className="sor-settings-input" />
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
                  className="sor-settings-input font-mono"
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
                  className="sor-settings-input"
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
                className="sor-settings-input"
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
              className="sor-settings-input"
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}

export default ProviderConfig;
