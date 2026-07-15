// useGdrive — real Tauri `invoke(...)` wrappers for the sorng-gdrive backend.
//
// Binds all 47 `gdrive_*` commands registered in the Tauri handler. Unlike the
// host-keyed integrations (prometheus, netbox, ...), the gdrive service is a
// SINGLE global session (`State<GDriveServiceState>` — no connection id), so no
// command takes an `id`. The panel therefore models ONE Drive connection whose
// lifecycle is the OAuth2 flow:
//
//   setCredentials(clientId, clientSecret, redirectUri, scopes)
//     → getAuthUrl()                 (open in browser)
//     → user authorizes, copies the code (or the redirect's ?code=)
//     → exchangeCode(code)           (now authenticated)
//     → refreshToken()               (renew the access token later)
//
// `getToken`/`setToken` persist and restore the token across sessions. Argument
// names are camelCase, matching Tauri v2's automatic snake_case→camelCase
// conversion of the Rust `#[tauri::command]` params exactly.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxyArgs } from "./httpProxy";
import type {
  BatchResult,
  DriveAbout,
  DriveChange,
  DriveComment,
  DriveFile,
  DrivePermission,
  DriveReply,
  DriveRevision,
  FileList,
  GDriveConnectionSummary,
  OAuthToken,
  PermissionRole,
  SharedDrive,
} from "../../types/gdrive";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const gdriveApi = {
  // ── Auth ──
  setCredentials: (
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    scopes: string[],
  ) =>
    invoke<void>(
      "gdrive_set_credentials",
      withGlobalHttpProxyArgs({
        clientId,
        clientSecret,
        redirectUri,
        scopes,
      }),
    ),
  getAuthUrl: () => invoke<string>("gdrive_get_auth_url"),
  exchangeCode: (code: string) =>
    invoke<void>("gdrive_exchange_code", { code }),
  refreshToken: () => invoke<void>("gdrive_refresh_token"),
  setToken: (token: OAuthToken) => invoke<void>("gdrive_set_token", { token }),
  getToken: () => invoke<OAuthToken | null>("gdrive_get_token"),
  revoke: () => invoke<void>("gdrive_revoke"),
  isAuthenticated: () => invoke<boolean>("gdrive_is_authenticated"),
  connectionSummary: () =>
    invoke<GDriveConnectionSummary>("gdrive_connection_summary"),

  // ── About ──
  getAbout: () => invoke<DriveAbout>("gdrive_get_about"),

  // ── Files ──
  getFile: (fileId: string) => invoke<DriveFile>("gdrive_get_file", { fileId }),
  listFiles: (
    query?: string,
    pageSize?: number,
    pageToken?: string,
    orderBy?: string,
  ) =>
    invoke<FileList>("gdrive_list_files", {
      query,
      pageSize,
      pageToken,
      orderBy,
    }),
  createFile: (
    name: string,
    mimeType: string | undefined,
    parents: string[],
    description?: string,
  ) =>
    invoke<DriveFile>("gdrive_create_file", {
      name,
      mimeType,
      parents,
      description,
    }),
  updateFile: (
    fileId: string,
    name?: string,
    description?: string,
    starred?: boolean,
    trashed?: boolean,
  ) =>
    invoke<DriveFile>("gdrive_update_file", {
      fileId,
      name,
      description,
      starred,
      trashed,
    }),
  copyFile: (fileId: string, newName: string | undefined, parents: string[]) =>
    invoke<DriveFile>("gdrive_copy_file", { fileId, newName, parents }),
  deleteFile: (fileId: string) =>
    invoke<void>("gdrive_delete_file", { fileId }),
  trashFile: (fileId: string) =>
    invoke<DriveFile>("gdrive_trash_file", { fileId }),
  untrashFile: (fileId: string) =>
    invoke<DriveFile>("gdrive_untrash_file", { fileId }),
  emptyTrash: () => invoke<void>("gdrive_empty_trash"),
  starFile: (fileId: string) =>
    invoke<DriveFile>("gdrive_star_file", { fileId }),
  renameFile: (fileId: string, newName: string) =>
    invoke<DriveFile>("gdrive_rename_file", { fileId, newName }),
  moveFile: (fileId: string, newParentId: string, oldParentId: string) =>
    invoke<DriveFile>("gdrive_move_file", { fileId, newParentId, oldParentId }),
  generateIds: (count: number) =>
    invoke<string[]>("gdrive_generate_ids", { count }),

  // ── Folders ──
  createFolder: (name: string, parentId?: string) =>
    invoke<DriveFile>("gdrive_create_folder", { name, parentId }),
  listChildren: (folderId: string, pageSize?: number, pageToken?: string) =>
    invoke<FileList>("gdrive_list_children", { folderId, pageSize, pageToken }),
  listSubfolders: (folderId: string) =>
    invoke<DriveFile[]>("gdrive_list_subfolders", { folderId }),
  findFolder: (name: string, parentId?: string) =>
    invoke<DriveFile | null>("gdrive_find_folder", { name, parentId }),

  // ── Uploads ──
  uploadFile: (
    filePath: string,
    name: string,
    parents: string[],
    mimeType?: string,
    description?: string,
  ) =>
    invoke<DriveFile>("gdrive_upload_file", {
      filePath,
      name,
      parents,
      mimeType,
      description,
    }),

  // ── Downloads ──
  downloadFile: (fileId: string, destination: string) =>
    invoke<number>("gdrive_download_file", { fileId, destination }),
  exportFile: (fileId: string, exportMimeType: string, destination: string) =>
    invoke<number>("gdrive_export_file", {
      fileId,
      exportMimeType,
      destination,
    }),

  // ── Sharing ──
  shareWithUser: (
    fileId: string,
    email: string,
    role: PermissionRole,
    sendNotification: boolean,
  ) =>
    invoke<DrivePermission>("gdrive_share_with_user", {
      fileId,
      email,
      role,
      sendNotification,
    }),
  shareWithAnyone: (fileId: string, role: PermissionRole) =>
    invoke<DrivePermission>("gdrive_share_with_anyone", { fileId, role }),
  listPermissions: (fileId: string) =>
    invoke<DrivePermission[]>("gdrive_list_permissions", { fileId }),
  deletePermission: (fileId: string, permissionId: string) =>
    invoke<void>("gdrive_delete_permission", { fileId, permissionId }),
  unshareAll: (fileId: string) =>
    invoke<BatchResult>("gdrive_unshare_all", { fileId }),

  // ── Revisions ──
  listRevisions: (fileId: string) =>
    invoke<DriveRevision[]>("gdrive_list_revisions", { fileId }),
  pinRevision: (fileId: string, revisionId: string) =>
    invoke<DriveRevision>("gdrive_pin_revision", { fileId, revisionId }),

  // ── Comments ──
  listComments: (fileId: string, includeDeleted: boolean) =>
    invoke<DriveComment[]>("gdrive_list_comments", { fileId, includeDeleted }),
  createComment: (fileId: string, content: string) =>
    invoke<DriveComment>("gdrive_create_comment", { fileId, content }),
  resolveComment: (fileId: string, commentId: string) =>
    invoke<DriveReply>("gdrive_resolve_comment", { fileId, commentId }),
  createReply: (fileId: string, commentId: string, content: string) =>
    invoke<DriveReply>("gdrive_create_reply", { fileId, commentId, content }),

  // ── Shared drives ──
  listDrives: () => invoke<SharedDrive[]>("gdrive_list_drives"),
  createDrive: (name: string, requestId: string) =>
    invoke<SharedDrive>("gdrive_create_drive", { name, requestId }),
  deleteDrive: (driveId: string) =>
    invoke<void>("gdrive_delete_drive", { driveId }),

  // ── Changes ──
  getStartPageToken: () => invoke<string>("gdrive_get_start_page_token"),
  pollChanges: () => invoke<DriveChange[]>("gdrive_poll_changes"),

  // ── Search ──
  search: (query: string, pageSize?: number, orderBy?: string) =>
    invoke<FileList>("gdrive_search", { query, pageSize, orderBy }),
};

export type GdriveApi = typeof gdriveApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/** Credentials the OAuth flow starts from. */
export interface GdriveCredentialsInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Stateful Google Drive session hook. Owns the OAuth2 lifecycle for the single
 * global Drive service, tracks auth state (`isAuthenticated` + `summary`), and
 * exposes the full registered command surface via `api`. The `run` wrapper
 * funnels arbitrary ops through shared `isLoading`/`error` handling.
 */
export function useGdrive() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [summary, setSummary] = useState<GDriveConnectionSummary | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  /** Refresh auth state + summary from the backend. */
  const refreshAuthState = useCallback(async (): Promise<boolean> => {
    try {
      const authed = await gdriveApi.isAuthenticated();
      setIsAuthenticated(authed);
      if (authed) {
        try {
          setSummary(await gdriveApi.connectionSummary());
        } catch {
          /* summary is best-effort */
        }
      } else {
        setSummary(null);
      }
      return authed;
    } catch (e) {
      setError(errMsg(e));
      return false;
    }
  }, []);

  /** Step 1: register the OAuth2 client credentials. */
  const setCredentials = useCallback(
    async (input: GdriveCredentialsInput): Promise<boolean> => {
      setIsBusy(true);
      setError(null);
      try {
        await gdriveApi.setCredentials(
          input.clientId,
          input.clientSecret,
          input.redirectUri,
          input.scopes,
        );
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [],
  );

  /** Step 2: build the authorization URL to open in the browser. */
  const getAuthUrl = useCallback(async (): Promise<string | null> => {
    setError(null);
    try {
      return await gdriveApi.getAuthUrl();
    } catch (e) {
      setError(errMsg(e));
      return null;
    }
  }, []);

  /** Step 3: exchange the authorization code for tokens. */
  const exchangeCode = useCallback(
    async (code: string): Promise<boolean> => {
      setIsBusy(true);
      setError(null);
      try {
        await gdriveApi.exchangeCode(code.trim());
        await refreshAuthState();
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [refreshAuthState],
  );

  /** Renew the access token using the stored refresh token. */
  const refreshToken = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      await gdriveApi.refreshToken();
      await refreshAuthState();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    }
  }, [refreshAuthState]);

  /** Restore a persisted token (skips the browser flow when still valid). */
  const restoreToken = useCallback(
    async (token: OAuthToken): Promise<boolean> => {
      setError(null);
      try {
        await gdriveApi.setToken(token);
        return await refreshAuthState();
      } catch (e) {
        setError(errMsg(e));
        return false;
      }
    },
    [refreshAuthState],
  );

  /** Read the current token back (for persistence). */
  const getToken = useCallback(async (): Promise<OAuthToken | null> => {
    try {
      return await gdriveApi.getToken();
    } catch (e) {
      setError(errMsg(e));
      return null;
    }
  }, []);

  /** Revoke the token and clear local auth state. */
  const revoke = useCallback(async (): Promise<void> => {
    try {
      await gdriveApi.revoke();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setIsAuthenticated(false);
      setSummary(null);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    isAuthenticated,
    summary,
    isBusy,
    isLoading,
    error,
    setError,
    clearError,
    // OAuth lifecycle
    setCredentials,
    getAuthUrl,
    exchangeCode,
    refreshToken,
    restoreToken,
    getToken,
    revoke,
    refreshAuthState,
    // full registered command surface + shared runner
    api: gdriveApi,
    run,
  };
}

export type GdriveManager = ReturnType<typeof useGdrive>;
