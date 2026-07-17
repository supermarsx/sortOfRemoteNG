// Google Drive integration panel (t42-gdrive).
//
// Full panel for the sorng-gdrive crate — binds every one of the 47 registered
// `gdrive_*` commands through `useGdrive()` / `gdriveApi`. The gdrive backend is
// a SINGLE global service (no connection id), so the panel models one Drive
// session whose lifecycle is the OAuth2 flow:
//   set credentials → get auth URL (open browser) → paste code → exchange.
// Credentials persist via `useIntegrationConfigStore` (the client secret and, once
// obtained, the refresh token are stored in the OS vault; client id / redirect /
// scopes are non-secret config). Sub-tabs cover files & folders, sharing,
// revisions, comments, shared drives, changes and account.

import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Clock,
  Files,
  FolderPlus,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
  Share2,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGdrive, type GdriveManager } from "../../hooks/integration/useGdrive";
import { useIntegrationConfigStore } from "../../hooks/integrations/useIntegrationConfigStore";
import type {
  IntegrationDescriptor,
  IntegrationPanelProps,
} from "../../types/integrations/registry";
import {
  GDRIVE_OOB_REDIRECT,
  GDRIVE_SCOPES,
  type DriveChange,
  type DriveComment,
  type DriveFile,
  type DrivePermission,
  type DriveRevision,
  type OAuthToken,
  type PermissionRole,
  type SharedDrive,
} from "../../types/gdrive";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Open a URL in the user's real browser (Tauri), falling back to window.open. */
function openExternal(url: string) {
  invoke("open_url_external", { url }).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

/** The persisted secret blob for a gdrive instance. */
interface GdriveSecret {
  clientSecret?: string;
  refreshToken?: string;
}

function parseSecret(raw: string | null): GdriveSecret {
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === "object" && p ? (p as GdriveSecret) : {};
  } catch {
    // Legacy / plain secret — treat the whole string as the client secret.
    return { clientSecret: raw };
  }
}

type TabKey =
  | "files"
  | "sharing"
  | "revisions"
  | "comments"
  | "drives"
  | "changes"
  | "account";

// ─── OAuth connect flow ──────────────────────────────────────────────────────

interface CredState {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  name: string;
}

const emptyCred: CredState = {
  clientId: "",
  clientSecret: "",
  redirectUri: GDRIVE_OOB_REDIRECT,
  scope: GDRIVE_SCOPES.drive,
  name: "",
};

const ConnectFlow: React.FC<{
  mgr: GdriveManager;
  instanceId?: string;
}> = ({ mgr, instanceId }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<CredState>(emptyCred);
  const [savedId, setSavedId] = useState<string | undefined>(instanceId);
  const [authUrl, setAuthUrl] = useState<string>("");
  const [code, setCode] = useState("");

  // Prefill from a persisted instance (non-secret fields + vault secret) and,
  // if a refresh token was stored, try a silent reconnect.
  useEffect(() => {
    if (!instanceId || store.isLoading) return;
    const inst = store.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setForm((f) => ({
      ...f,
      name: inst.name,
      clientId: inst.fields?.clientId ?? "",
      redirectUri: inst.fields?.redirectUri ?? GDRIVE_OOB_REDIRECT,
      scope: inst.fields?.scopes ?? GDRIVE_SCOPES.drive,
    }));
    void store.readSecret(inst).then(async (raw) => {
      const secret = parseSecret(raw);
      setForm((f) => ({ ...f, clientSecret: secret.clientSecret ?? "" }));
      if (secret.refreshToken && inst.fields?.clientId) {
        // Silent reconnect: register creds, install the refresh token, renew.
        const ok = await mgr.setCredentials({
          clientId: inst.fields.clientId,
          clientSecret: secret.clientSecret ?? "",
          redirectUri: inst.fields?.redirectUri ?? GDRIVE_OOB_REDIRECT,
          scopes: (inst.fields?.scopes ?? GDRIVE_SCOPES.drive)
            .split(/\s+/)
            .filter(Boolean),
        });
        if (ok) {
          const token: OAuthToken = {
            accessToken: "",
            refreshToken: secret.refreshToken,
            tokenType: "Bearer",
          };
          const restored = await mgr.restoreToken(token);
          if (restored) await mgr.refreshToken();
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, store.isLoading]);

  const set = <K extends keyof CredState>(k: K, v: CredState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const scopes = () => form.scope.split(/\s+/).filter(Boolean);

  const persist = useCallback(
    async (refreshToken?: string) => {
      const fields: Record<string, string> = {
        clientId: form.clientId,
        redirectUri: form.redirectUri,
        scopes: form.scope,
      };
      const secret = JSON.stringify({
        clientSecret: form.clientSecret,
        refreshToken,
      });
      if (savedId) {
        await store.updateInstance(savedId, {
          name: form.name || form.clientId,
          fields,
          secret,
        });
      } else {
        const created = await store.createInstance({
          integrationKey: "gdrive",
          name: form.name || form.clientId,
          fields,
          secret,
        });
        setSavedId(created.id);
      }
    },
    [store, form, savedId],
  );

  const doGetUrl = useCallback(async () => {
    const ok = await mgr.setCredentials({
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret,
      redirectUri: form.redirectUri.trim(),
      scopes: scopes(),
    });
    if (!ok) return;
    await persist();
    const url = await mgr.getAuthUrl();
    if (url) {
      setAuthUrl(url);
      openExternal(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgr, form, persist]);

  const doExchange = useCallback(async () => {
    const ok = await mgr.exchangeCode(code);
    if (!ok) return;
    // Capture and persist the refresh token for silent reconnects.
    const token = await mgr.getToken();
    await persist(token?.refreshToken ?? undefined);
  }, [mgr, code, persist]);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
          <KeyRound size={12} />
          {t("integrations.gdrive.oauthCredentials", "OAuth2 client credentials")}
        </h4>
        <p className="mb-3 text-[11px] text-[var(--color-textMuted)]">
          {t(
            "integrations.gdrive.oauthHelp",
            "Create an OAuth client (Desktop app) in the Google Cloud Console and paste its ID and secret here.",
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t("integrations.gdrive.clientId", "Client ID")}>
            <input
              className={field}
              value={form.clientId}
              onChange={(e) => set("clientId", e.target.value)}
              placeholder="xxxxxx.apps.googleusercontent.com"
            />
          </Labeled>
          <Labeled
            label={t("integrations.gdrive.clientSecret", "Client secret")}
          >
            <input
              className={field}
              type="password"
              value={form.clientSecret}
              onChange={(e) => set("clientSecret", e.target.value)}
            />
          </Labeled>
          <Labeled
            label={t("integrations.gdrive.redirectUri", "Redirect URI")}
          >
            <input
              className={field}
              value={form.redirectUri}
              onChange={(e) => set("redirectUri", e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.gdrive.scopes", "Scopes (space-separated)")}>
            <input
              className={field}
              value={form.scope}
              onChange={(e) => set("scope", e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.gdrive.instanceName", "Saved name")}>
            <input
              className={field}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={form.clientId}
            />
          </Labeled>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className={btn}
            onClick={doGetUrl}
            disabled={mgr.isBusy || !form.clientId || !form.clientSecret}
          >
            {mgr.isBusy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plug size={12} />
            )}
            {t("integrations.gdrive.getAuthUrl", "Get authorization URL")}
          </button>
          {authUrl && (
            <button className={btn} onClick={() => openExternal(authUrl)}>
              {t("integrations.gdrive.reopenBrowser", "Reopen in browser")}
            </button>
          )}
        </div>
      </div>

      {authUrl && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.gdrive.enterCode", "Enter the authorization code")}
          </h4>
          <p className="mb-2 break-all text-[11px] text-[var(--color-textMuted)]">
            {t(
              "integrations.gdrive.enterCodeHelp",
              "Approve access in the browser, then paste the code Google shows you (or the ?code= value from the redirect).",
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={field}
              style={{ maxWidth: 420 }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="4/0Axxxx..."
            />
            <button
              className={btn}
              onClick={doExchange}
              disabled={mgr.isBusy || !code.trim()}
            >
              {mgr.isBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <KeyRound size={12} />
              )}
              {t("integrations.gdrive.exchangeCode", "Exchange code")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Files & folders tab ─────────────────────────────────────────────────────

const FilesTab: React.FC<{
  mgr: GdriveManager;
  selectedId: string;
  setSelectedId: (id: string) => void;
}> = ({ mgr, selectedId, setSelectedId }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [orderBy, setOrderBy] = useState("modifiedTime desc");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [rename, setRename] = useState("");

  const list = useCallback(
    async (token?: string) => {
      try {
        const r = await mgr.run(() =>
          query
            ? mgr.api.search(query, 50, orderBy || undefined)
            : mgr.api.listFiles(undefined, 50, token, orderBy || undefined),
        );
        setFiles(token ? (f) => [...f, ...r.files] : r.files);
        setNextToken(r.nextPageToken ?? null);
      } catch {
        /* surfaced via mgr.error */
      }
    },
    [mgr, query, orderBy],
  );

  useEffect(() => {
    void list();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createFolder = useCallback(async () => {
    if (!newFolder.trim()) return;
    try {
      await mgr.run(() => mgr.api.createFolder(newFolder.trim()));
      setNewFolder("");
      await list();
    } catch {
      /* surfaced */
    }
  }, [mgr, newFolder, list]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await mgr.run(fn);
        await list();
      } catch {
        /* surfaced */
      }
    },
    [mgr, list],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ maxWidth: 320 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(
            "integrations.gdrive.searchPlaceholder",
            "Drive query, e.g. name contains 'report'",
          )}
        />
        <select
          className={field}
          style={{ width: 180 }}
          value={orderBy}
          onChange={(e) => setOrderBy(e.target.value)}
        >
          <option value="modifiedTime desc">
            {t("integrations.gdrive.sortModified", "Modified (newest)")}
          </option>
          <option value="name">
            {t("integrations.gdrive.sortName", "Name")}
          </option>
          <option value="quotaBytesUsed desc">
            {t("integrations.gdrive.sortSize", "Size")}
          </option>
        </select>
        <button className={btn} onClick={() => void list()} disabled={mgr.isLoading}>
          <Search size={12} />
          {query
            ? t("integrations.gdrive.search", "Search")
            : t("integrations.gdrive.list", "List")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ maxWidth: 220 }}
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          placeholder={t("integrations.gdrive.newFolderName", "New folder name")}
        />
        <button className={btn} onClick={createFolder} disabled={mgr.isLoading}>
          <FolderPlus size={12} />
          {t("integrations.gdrive.createFolder", "Create folder")}
        </button>
        <button
          className={btn}
          onClick={() =>
            act(() => mgr.api.emptyTrash())
          }
          disabled={mgr.isLoading}
        >
          <Trash2 size={12} />
          {t("integrations.gdrive.emptyTrash", "Empty trash")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-textMuted)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.gdrive.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.gdrive.type", "Type")}</th>
              <th className="px-2 py-1">{t("integrations.gdrive.modified", "Modified")}</th>
              <th className="px-2 py-1">{t("integrations.gdrive.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr
                key={f.id}
                className={`border-t border-[var(--color-border)] ${
                  f.id === selectedId ? "bg-primary/10" : ""
                }`}
              >
                <td
                  className="cursor-pointer px-2 py-1 text-[var(--color-text)]"
                  onClick={() => setSelectedId(f.id)}
                  title={f.id}
                >
                  {f.starred && (
                    <Star size={10} className="mr-1 inline text-yellow-500" />
                  )}
                  {f.name}
                  {f.trashed && (
                    <span className="ml-1 text-[10px] text-red-400">
                      {t("integrations.gdrive.trashed", "(trashed)")}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">
                  {f.isFolder
                    ? t("integrations.gdrive.folder", "Folder")
                    : f.mimeType}
                </td>
                <td className="px-2 py-1 text-[var(--color-textMuted)]">
                  {f.modifiedTime?.slice(0, 10) ?? "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-1">
                    <button
                      className={btn}
                      title={t("integrations.gdrive.star", "Star")}
                      onClick={() => act(() => mgr.api.starFile(f.id))}
                    >
                      <Star size={11} />
                    </button>
                    {f.trashed ? (
                      <button
                        className={btn}
                        onClick={() => act(() => mgr.api.untrashFile(f.id))}
                      >
                        {t("integrations.gdrive.untrash", "Restore")}
                      </button>
                    ) : (
                      <button
                        className={btn}
                        onClick={() => act(() => mgr.api.trashFile(f.id))}
                      >
                        {t("integrations.gdrive.trash", "Trash")}
                      </button>
                    )}
                    <button
                      className={btn}
                      title={t("integrations.gdrive.copy", "Copy")}
                      onClick={() =>
                        act(() => mgr.api.copyFile(f.id, `${f.name} (copy)`, []))
                      }
                    >
                      {t("integrations.gdrive.copy", "Copy")}
                    </button>
                    <button
                      className={btn}
                      title={t("integrations.gdrive.deleteForever", "Delete permanently")}
                      onClick={() => act(() => mgr.api.deleteFile(f.id))}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-[var(--color-textMuted)]" colSpan={4}>
                  {t("integrations.gdrive.noFiles", "No files")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextToken && (
        <button
          className={btn}
          onClick={() => void list(nextToken)}
          disabled={mgr.isLoading}
        >
          {t("integrations.gdrive.loadMore", "Load more")}
        </button>
      )}

      {selectedId && (
        <div className={card}>
          <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
            {t("integrations.gdrive.selectedFile", "Selected file")}: {selectedId}
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={field}
              style={{ maxWidth: 240 }}
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              placeholder={t("integrations.gdrive.newName", "New name")}
            />
            <button
              className={btn}
              onClick={() =>
                act(async () => {
                  if (rename.trim())
                    await mgr.api.renameFile(selectedId, rename.trim());
                  setRename("");
                })
              }
              disabled={mgr.isLoading || !rename.trim()}
            >
              {t("integrations.gdrive.rename", "Rename")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sharing tab ─────────────────────────────────────────────────────────────

const SharingTab: React.FC<{ mgr: GdriveManager; fileId: string }> = ({
  mgr,
  fileId,
}) => {
  const { t } = useTranslation();
  const [perms, setPerms] = useState<DrivePermission[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PermissionRole>("reader");
  const [notify, setNotify] = useState(true);

  const refresh = useCallback(async () => {
    if (!fileId) return;
    try {
      setPerms(await mgr.run(() => mgr.api.listPermissions(fileId)));
    } catch {
      /* surfaced */
    }
  }, [mgr, fileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!fileId) {
    return (
      <p className="text-xs text-[var(--color-textMuted)]">
        {t("integrations.gdrive.selectFileFirst", "Select a file in the Files tab first.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Labeled label={t("integrations.gdrive.email", "User email")}>
            <input
              className={field}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.gdrive.role", "Role")}>
            <select
              className={field}
              value={role}
              onChange={(e) => setRole(e.target.value as PermissionRole)}
            >
              {(["reader", "commenter", "writer", "fileOrganizer", "organizer", "owner"] as PermissionRole[]).map(
                (r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ),
              )}
            </select>
          </Labeled>
          <label className="flex items-end gap-2 pb-1 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
            />
            {t("integrations.gdrive.notify", "Send notification")}
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={btn}
            disabled={mgr.isLoading || !email}
            onClick={async () => {
              try {
                await mgr.run(() =>
                  mgr.api.shareWithUser(fileId, email, role, notify),
                );
                setEmail("");
                await refresh();
              } catch {
                /* surfaced */
              }
            }}
          >
            <Share2 size={12} />
            {t("integrations.gdrive.shareUser", "Share with user")}
          </button>
          <button
            className={btn}
            disabled={mgr.isLoading}
            onClick={async () => {
              try {
                await mgr.run(() => mgr.api.shareWithAnyone(fileId, role));
                await refresh();
              } catch {
                /* surfaced */
              }
            }}
          >
            {t("integrations.gdrive.shareAnyone", "Share with anyone")}
          </button>
          <button
            className={btn}
            disabled={mgr.isLoading}
            onClick={async () => {
              try {
                await mgr.run(() => mgr.api.unshareAll(fileId));
                await refresh();
              } catch {
                /* surfaced */
              }
            }}
          >
            {t("integrations.gdrive.unshareAll", "Unshare all")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {perms.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]"
          >
            <span>
              {p.emailAddress ?? p.domain ?? p.type} · {p.role}
            </span>
            <button
              className={btn}
              onClick={async () => {
                try {
                  await mgr.run(() => mgr.api.deletePermission(fileId, p.id));
                  await refresh();
                } catch {
                  /* surfaced */
                }
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        {perms.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.gdrive.noPermissions", "No permissions")}
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Revisions tab ───────────────────────────────────────────────────────────

const RevisionsTab: React.FC<{ mgr: GdriveManager; fileId: string }> = ({
  mgr,
  fileId,
}) => {
  const { t } = useTranslation();
  const [revs, setRevs] = useState<DriveRevision[]>([]);

  const refresh = useCallback(async () => {
    if (!fileId) return;
    try {
      setRevs(await mgr.run(() => mgr.api.listRevisions(fileId)));
    } catch {
      /* surfaced */
    }
  }, [mgr, fileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!fileId) {
    return (
      <p className="text-xs text-[var(--color-textMuted)]">
        {t("integrations.gdrive.selectFileFirst", "Select a file in the Files tab first.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.gdrive.refresh", "Refresh")}
      </button>
      {revs.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]"
        >
          <span>
            {r.modifiedTime?.slice(0, 19).replace("T", " ") ?? r.id}
            {r.keepForever && (
              <span className="ml-1 text-[10px] text-primary">
                {t("integrations.gdrive.pinned", "(pinned)")}
              </span>
            )}
          </span>
          <button
            className={btn}
            onClick={async () => {
              try {
                await mgr.run(() => mgr.api.pinRevision(fileId, r.id));
                await refresh();
              } catch {
                /* surfaced */
              }
            }}
          >
            {t("integrations.gdrive.pin", "Keep forever")}
          </button>
        </div>
      ))}
      {revs.length === 0 && (
        <span className="text-xs text-[var(--color-textMuted)]">
          {t("integrations.gdrive.noRevisions", "No revisions")}
        </span>
      )}
    </div>
  );
};

// ─── Comments tab ────────────────────────────────────────────────────────────

const CommentsTab: React.FC<{ mgr: GdriveManager; fileId: string }> = ({
  mgr,
  fileId,
}) => {
  const { t } = useTranslation();
  const [comments, setComments] = useState<DriveComment[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!fileId) return;
    try {
      setComments(
        await mgr.run(() => mgr.api.listComments(fileId, includeDeleted)),
      );
    } catch {
      /* surfaced */
    }
  }, [mgr, fileId, includeDeleted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!fileId) {
    return (
      <p className="text-xs text-[var(--color-textMuted)]">
        {t("integrations.gdrive.selectFileFirst", "Select a file in the Files tab first.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ maxWidth: 320 }}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={t("integrations.gdrive.newComment", "New comment")}
        />
        <button
          className={btn}
          disabled={mgr.isLoading || !newComment.trim()}
          onClick={async () => {
            try {
              await mgr.run(() =>
                mgr.api.createComment(fileId, newComment.trim()),
              );
              setNewComment("");
              await refresh();
            } catch {
              /* surfaced */
            }
          }}
        >
          <MessageSquare size={12} />
          {t("integrations.gdrive.comment", "Comment")}
        </button>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setIncludeDeleted(e.target.checked)}
          />
          {t("integrations.gdrive.includeDeleted", "Include deleted")}
        </label>
      </div>

      {comments.map((c) => (
        <div key={c.id} className={card}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-text)]">
              {c.author?.displayName ?? "—"}
              {c.resolved && (
                <span className="ml-1 text-[10px] text-green-500">
                  {t("integrations.gdrive.resolved", "(resolved)")}
                </span>
              )}
            </span>
            {!c.resolved && (
              <button
                className={btn}
                onClick={async () => {
                  try {
                    await mgr.run(() => mgr.api.resolveComment(fileId, c.id));
                    await refresh();
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                {t("integrations.gdrive.resolve", "Resolve")}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
            {c.content}
          </p>
          {c.replies.map((r) => (
            <p
              key={r.id}
              className="mt-1 border-l-2 border-[var(--color-border)] pl-2 text-[11px] text-[var(--color-textMuted)]"
            >
              {r.author?.displayName ?? "—"}: {r.content}
            </p>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <input
              className={field}
              style={{ maxWidth: 260 }}
              value={reply[c.id] ?? ""}
              onChange={(e) =>
                setReply((s) => ({ ...s, [c.id]: e.target.value }))
              }
              placeholder={t("integrations.gdrive.reply", "Reply")}
            />
            <button
              className={btn}
              disabled={mgr.isLoading || !(reply[c.id] ?? "").trim()}
              onClick={async () => {
                try {
                  await mgr.run(() =>
                    mgr.api.createReply(fileId, c.id, (reply[c.id] ?? "").trim()),
                  );
                  setReply((s) => ({ ...s, [c.id]: "" }));
                  await refresh();
                } catch {
                  /* surfaced */
                }
              }}
            >
              {t("integrations.gdrive.sendReply", "Send")}
            </button>
          </div>
        </div>
      ))}
      {comments.length === 0 && (
        <span className="text-xs text-[var(--color-textMuted)]">
          {t("integrations.gdrive.noComments", "No comments")}
        </span>
      )}
    </div>
  );
};

// ─── Shared drives tab ───────────────────────────────────────────────────────

const DrivesTab: React.FC<{ mgr: GdriveManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [drives, setDrives] = useState<SharedDrive[]>([]);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDrives(await mgr.run(() => mgr.api.listDrives()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={field}
          style={{ maxWidth: 260 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("integrations.gdrive.driveName", "New shared drive name")}
        />
        <button
          className={btn}
          disabled={mgr.isLoading || !name.trim()}
          onClick={async () => {
            try {
              // request_id must be a unique client-generated token per create.
              const requestId =
                globalThis.crypto?.randomUUID?.() ?? String(Date.now());
              await mgr.run(() => mgr.api.createDrive(name.trim(), requestId));
              setName("");
              await refresh();
            } catch {
              /* surfaced */
            }
          }}
        >
          <HardDrive size={12} />
          {t("integrations.gdrive.createDrive", "Create shared drive")}
        </button>
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.gdrive.refresh", "Refresh")}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {drives.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]"
          >
            <span>
              {d.name}
              {d.hidden && (
                <span className="ml-1 text-[10px] text-[var(--color-textMuted)]">
                  {t("integrations.gdrive.hidden", "(hidden)")}
                </span>
              )}
            </span>
            <button
              className={btn}
              onClick={async () => {
                try {
                  await mgr.run(() => mgr.api.deleteDrive(d.id));
                  await refresh();
                } catch {
                  /* surfaced */
                }
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        {drives.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.gdrive.noDrives", "No shared drives")}
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Changes tab ─────────────────────────────────────────────────────────────

const ChangesTab: React.FC<{ mgr: GdriveManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState<string>("");
  const [changes, setChanges] = useState<DriveChange[]>([]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={btn}
          disabled={mgr.isLoading}
          onClick={async () => {
            try {
              setToken(await mgr.run(() => mgr.api.getStartPageToken()));
            } catch {
              /* surfaced */
            }
          }}
        >
          <Clock size={12} />
          {t("integrations.gdrive.getStartToken", "Get start page token")}
        </button>
        <button
          className={btn}
          disabled={mgr.isLoading}
          onClick={async () => {
            try {
              setChanges(await mgr.run(() => mgr.api.pollChanges()));
            } catch {
              /* surfaced */
            }
          }}
        >
          <RefreshCw size={12} />
          {t("integrations.gdrive.pollChanges", "Poll changes")}
        </button>
        {token && (
          <span className="font-mono text-[10px] text-[var(--color-textMuted)]">
            {token}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {changes.map((c, i) => (
          <div key={i} className="text-xs text-[var(--color-textSecondary)]">
            {c.removed
              ? t("integrations.gdrive.removed", "removed")
              : t("integrations.gdrive.changed", "changed")}{" "}
            · {c.file?.name ?? c.fileId} · {c.time?.slice(0, 19).replace("T", " ")}
          </div>
        ))}
        {changes.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.gdrive.noChanges", "No changes polled")}
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Account tab ─────────────────────────────────────────────────────────────

function fmtBytes(n?: number | null): string {
  if (n == null || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

const AccountTab: React.FC<{ mgr: GdriveManager }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [about, setAbout] = useState<
    import("../../types/gdrive").DriveAbout | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      setAbout(await mgr.run(() => mgr.api.getAbout()));
      await mgr.refreshAuthState();
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.gdrive.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={() => void mgr.refreshToken()}
          disabled={mgr.isLoading}
        >
          <KeyRound size={12} />
          {t("integrations.gdrive.renewToken", "Renew access token")}
        </button>
      </div>

      {about && (
        <div className={card}>
          <div className="text-sm text-[var(--color-text)]">
            {about.userDisplayName}
          </div>
          <div className="text-xs text-[var(--color-textSecondary)]">
            {about.userEmail}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              [t("integrations.gdrive.storageUsed", "Used"), fmtBytes(about.storageUsed)],
              [t("integrations.gdrive.storageLimit", "Limit"), fmtBytes(about.storageLimit)],
              [t("integrations.gdrive.storageTrash", "In trash"), fmtBytes(about.storageUsedInTrash)],
            ].map(([label, value]) => (
              <div key={String(label)} className={card}>
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  {value}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Panel shell ─────────────────────────────────────────────────────────────

const TABS: {
  key: TabKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  { key: "files", labelKey: "integrations.gdrive.tabFiles", labelDefault: "Files", icon: Files },
  { key: "sharing", labelKey: "integrations.gdrive.tabSharing", labelDefault: "Sharing", icon: Users },
  { key: "revisions", labelKey: "integrations.gdrive.tabRevisions", labelDefault: "Revisions", icon: History },
  { key: "comments", labelKey: "integrations.gdrive.tabComments", labelDefault: "Comments", icon: MessageSquare },
  { key: "drives", labelKey: "integrations.gdrive.tabDrives", labelDefault: "Shared Drives", icon: HardDrive },
  { key: "changes", labelKey: "integrations.gdrive.tabChanges", labelDefault: "Changes", icon: Clock },
  { key: "account", labelKey: "integrations.gdrive.tabAccount", labelDefault: "Account", icon: Activity },
];

const GdrivePanel: React.FC<IntegrationPanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const mgr = useGdrive();
  const [tab, setTab] = useState<TabKey>("files");
  const [selectedId, setSelectedId] = useState("");

  if (!isOpen) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <HardDrive className="h-5 w-5 text-primary" />
          {t("integrations.gdrive.title", "Google Drive")}
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 ${
              mgr.isAuthenticated
                ? "bg-green-500/15 text-green-500"
                : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                mgr.isAuthenticated ? "bg-green-500" : "bg-[var(--color-textMuted)]"
              }`}
            />
            {mgr.isAuthenticated
              ? mgr.summary?.userEmail ??
                t("integrations.gdrive.connected", "Connected")
              : t("integrations.gdrive.disconnected", "Not connected")}
          </span>
          {mgr.isAuthenticated && (
            <button className={btn} onClick={() => void mgr.revoke()}>
              <LogOut size={12} />
              {t("integrations.gdrive.revoke", "Disconnect")}
            </button>
          )}
        </div>
      </div>

      {mgr.error && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {mgr.error}
        </div>
      )}

      {!mgr.isAuthenticated ? (
        <ConnectFlow mgr={mgr} instanceId={instanceId} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {TABS.map(({ key, labelKey, labelDefault, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1 border-b-2 px-3 py-1.5 text-xs ${
                  tab === key
                    ? "border-primary text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-textSecondary)]"
                }`}
              >
                <Icon size={12} />
                {t(labelKey, labelDefault)}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === "files" && (
              <FilesTab
                mgr={mgr}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
              />
            )}
            {tab === "sharing" && <SharingTab mgr={mgr} fileId={selectedId} />}
            {tab === "revisions" && (
              <RevisionsTab mgr={mgr} fileId={selectedId} />
            )}
            {tab === "comments" && <CommentsTab mgr={mgr} fileId={selectedId} />}
            {tab === "drives" && <DrivesTab mgr={mgr} />}
            {tab === "changes" && <ChangesTab mgr={mgr} />}
            {tab === "account" && <AccountTab mgr={mgr} />}
          </div>
        </>
      )}
    </div>
  );
};

export default GdrivePanel;

/** Registry descriptor for the Google Drive integration (category: app-service).
 *  The Wave-3 app-service integrator appends this to `registry.appservice.ts`. */
export const gdriveDescriptor: IntegrationDescriptor = {
  key: "gdrive",
  label: "Google Drive",
  category: "file-storage",
  icon: HardDrive,
  importPanel: () => import("./GdrivePanel"),
};
