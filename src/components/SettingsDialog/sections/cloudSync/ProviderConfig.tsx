import { PasswordInput, Textarea } from '../../../ui/forms';
import { Check, Globe } from "lucide-react";
import { Checkbox, NumberInput, Select } from "../../../ui/forms";
import type {
  CloudSyncTarget,
  GoogleDriveProviderConfig,
  OneDriveProviderConfig,
  NextcloudProviderConfig,
  WebDavProviderConfig,
  SftpProviderConfig,
} from "../../../../types/settings/settings";
import type { Mgr } from "./types";

/**
 * Per-target provider configuration editor. Reads from and writes to
 * the matching provider sub-object on the supplied `target`, not the
 * legacy top-level CloudSyncConfig provider blocks.
 */
function ProviderConfig({
  target,
  mgr,
}: {
  target: CloudSyncTarget;
  mgr: Mgr;
}) {
  const writeGoogle = (patch: Partial<GoogleDriveProviderConfig>) =>
    mgr.updateSyncTarget(target.id, {
      googleDrive: {
        folderPath: "/sortOfRemoteNG",
        ...target.googleDrive,
        ...patch,
      },
    });
  const writeOneDrive = (patch: Partial<OneDriveProviderConfig>) =>
    mgr.updateSyncTarget(target.id, {
      oneDrive: {
        folderPath: "/sortOfRemoteNG",
        ...target.oneDrive,
        ...patch,
      },
    });
  const writeNextcloud = (patch: Partial<NextcloudProviderConfig>) =>
    mgr.updateSyncTarget(target.id, {
      nextcloud: {
        serverUrl: "",
        username: "",
        folderPath: "/sortOfRemoteNG",
        useAppPassword: true,
        ...target.nextcloud,
        ...patch,
      },
    });
  const writeWebdav = (patch: Partial<WebDavProviderConfig>) =>
    mgr.updateSyncTarget(target.id, {
      webdav: {
        serverUrl: "",
        username: "",
        folderPath: "/sortOfRemoteNG",
        authMethod: "basic",
        ...target.webdav,
        ...patch,
      },
    });
  const writeSftp = (patch: Partial<SftpProviderConfig>) =>
    mgr.updateSyncTarget(target.id, {
      sftp: {
        host: "",
        port: 22,
        username: "",
        folderPath: "/sortOfRemoteNG",
        authMethod: "password",
        ...target.sftp,
        ...patch,
      },
    });

  switch (target.provider) {
    case "googleDrive": {
      const gd = target.googleDrive;
      return (
        <div className="space-y-4">
          {gd?.accountEmail ? (
            <div className="flex items-center justify-between p-3 bg-success/10 rounded-lg border border-success/30">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-success" />
                <span className="text-sm text-[var(--color-text)]">
                  Connected as {gd.accountEmail}
                </span>
              </div>
              <button
                onClick={() =>
                  writeGoogle({
                    accessToken: undefined,
                    refreshToken: undefined,
                    accountEmail: undefined,
                  })
                }
                className="text-xs text-error hover:text-error"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => mgr.openTokenDialog(target.id)}
              className="w-full px-4 py-2 bg-primary hover:bg-primary/90 text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2"
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
              value={gd?.folderPath ?? ""}
              onChange={(e) => writeGoogle({ folderPath: e.target.value })}
              placeholder="/sortOfRemoteNG"
              className="sor-settings-input"
            />
          </div>
        </div>
      );
    }

    case "oneDrive": {
      const od = target.oneDrive;
      return (
        <div className="space-y-4">
          {od?.accountEmail ? (
            <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg border border-primary/30">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary" />
                <span className="text-sm text-[var(--color-text)]">
                  Connected as {od.accountEmail}
                </span>
              </div>
              <button
                onClick={() =>
                  writeOneDrive({
                    accessToken: undefined,
                    refreshToken: undefined,
                    accountEmail: undefined,
                  })
                }
                className="text-xs text-error hover:text-error"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => mgr.openTokenDialog(target.id)}
              className="w-full px-4 py-2 bg-primary hover:bg-primary/90 text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2"
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
              value={od?.folderPath ?? ""}
              onChange={(e) => writeOneDrive({ folderPath: e.target.value })}
              placeholder="/sortOfRemoteNG"
              className="sor-settings-input"
            />
          </div>
        </div>
      );
    }

    case "nextcloud": {
      const nc = target.nextcloud;
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Server URL
            </label>
            <input
              type="url"
              value={nc?.serverUrl ?? ""}
              onChange={(e) => writeNextcloud({ serverUrl: e.target.value })}
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
              value={nc?.username ?? ""}
              onChange={(e) => writeNextcloud({ username: e.target.value })}
              placeholder="your-username"
              className="sor-settings-input"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={Boolean(nc?.useAppPassword)}
              onChange={(v: boolean) => writeNextcloud({ useAppPassword: v })}
              className="sor-checkbox-sm"
            />
            <span className="text-sm text-[var(--color-text)]">
              Use App Password (Recommended)
            </span>
          </label>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              {nc?.useAppPassword ? "App Password" : "Password"}
            </label>
            <PasswordInput
              value={
                nc?.useAppPassword ? nc?.appPassword || "" : nc?.password || ""
              }
              onChange={(e) =>
                writeNextcloud(
                  nc?.useAppPassword
                    ? { appPassword: e.target.value }
                    : { password: e.target.value },
                )
              }
              placeholder={
                nc?.useAppPassword
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
              value={nc?.folderPath ?? ""}
              onChange={(e) => writeNextcloud({ folderPath: e.target.value })}
              placeholder="/sortOfRemoteNG"
              className="sor-settings-input"
            />
          </div>
        </div>
      );
    }

    case "webdav": {
      const wd = target.webdav;
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              WebDAV URL
            </label>
            <input
              type="url"
              value={wd?.serverUrl ?? ""}
              onChange={(e) => writeWebdav({ serverUrl: e.target.value })}
              placeholder="https://webdav.example.com/dav/"
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method
            </label>
            <Select
              value={wd?.authMethod ?? "basic"}
              onChange={(v: string) =>
                writeWebdav({
                  authMethod: v as "basic" | "digest" | "bearer",
                })
              }
              options={[
                { value: "basic", label: "Basic Authentication" },
                { value: "digest", label: "Digest Authentication" },
                { value: "bearer", label: "Bearer Token" },
              ]}
              className="sor-settings-input"
            />
          </div>

          {wd?.authMethod === "bearer" ? (
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Bearer Token
              </label>
              <PasswordInput
                value={wd?.bearerToken || ""}
                onChange={(e) => writeWebdav({ bearerToken: e.target.value })}
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
                  value={wd?.username ?? ""}
                  onChange={(e) => writeWebdav({ username: e.target.value })}
                  placeholder="your-username"
                  className="sor-settings-input"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Password
                </label>
                <PasswordInput
                  value={wd?.password || ""}
                  onChange={(e) => writeWebdav({ password: e.target.value })}
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
              value={wd?.folderPath ?? ""}
              onChange={(e) => writeWebdav({ folderPath: e.target.value })}
              placeholder="/sortOfRemoteNG"
              className="sor-settings-input"
            />
          </div>
        </div>
      );
    }

    case "sftp": {
      const sf = target.sftp;
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Host
              </label>
              <input
                type="text"
                value={sf?.host ?? ""}
                onChange={(e) => writeSftp({ host: e.target.value })}
                placeholder="sftp.example.com"
                className="sor-settings-input"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                Port
              </label>
              <NumberInput
                value={sf?.port ?? 22}
                onChange={(v: number) => writeSftp({ port: v })}
                className="sor-settings-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Username
            </label>
            <input
              type="text"
              value={sf?.username ?? ""}
              onChange={(e) => writeSftp({ username: e.target.value })}
              placeholder="your-username"
              className="sor-settings-input"
            />
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
              Authentication Method
            </label>
            <Select
              value={sf?.authMethod ?? "password"}
              onChange={(v: string) =>
                writeSftp({ authMethod: v as "password" | "key" })
              }
              options={[
                { value: "password", label: "Password" },
                { value: "key", label: "SSH Key" },
              ]}
              className="sor-settings-input"
            />
          </div>

          {sf?.authMethod === "key" ? (
            <>
              <div>
                <label className="block text-sm text-[var(--color-textSecondary)] mb-1">
                  Private Key
                </label>
                <Textarea
                  value={sf?.privateKey || ""}
                  onChange={(v) => writeSftp({ privateKey: v })}
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
                  value={sf?.passphrase || ""}
                  onChange={(e) => writeSftp({ passphrase: e.target.value })}
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
                value={sf?.password || ""}
                onChange={(e) => writeSftp({ password: e.target.value })}
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
              value={sf?.folderPath ?? ""}
              onChange={(e) => writeSftp({ folderPath: e.target.value })}
              placeholder="/home/user/sortOfRemoteNG"
              className="sor-settings-input"
            />
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

export default ProviderConfig;
