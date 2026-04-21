// OneDrive client hook.
//
// Thin wrapper around the 35 `od_*` Tauri commands defined in
// `src-tauri/crates/sorng-onedrive/src/onedrive/commands.rs`.
//
// Tauri's IPC layer camelCases Rust snake_case argument names, so the
// wrappers here pass `driveId`, `itemId`, `sessionId`, etc. as camelCase
// keys.  Return types mirror `src/types/onedrive.ts`.

import { invoke } from '@tauri-apps/api/core';
import type {
  CreateLinkRequest,
  DeltaSyncState,
  DeviceCodeInfo,
  Drive,
  DriveItem,
  DriveItemVersion,
  OAuthTokenSet,
  OneDriveConfig,
  OneDriveSessionSummary,
  PkceChallenge,
  Permission,
  SpecialFolder,
  Subscription,
  SubscriptionRequest,
  ThumbnailSet,
} from '../../types/onedrive';

// ─── Auth ────────────────────────────────────────────────────────────

export const odGeneratePkce = (): Promise<PkceChallenge> =>
  invoke('od_generate_pkce');

export const odBuildAuthUrl = (
  config: OneDriveConfig,
  pkce: PkceChallenge,
  state: string,
): Promise<string> => invoke('od_build_auth_url', { config, pkce, state });

export const odExchangeCode = (
  config: OneDriveConfig,
  code: string,
  pkce: PkceChallenge,
): Promise<OAuthTokenSet> =>
  invoke('od_exchange_code', { config, code, pkce });

export const odStartDeviceCode = (
  config: OneDriveConfig,
): Promise<DeviceCodeInfo> => invoke('od_start_device_code', { config });

export const odPollDeviceCode = (
  config: OneDriveConfig,
  deviceCode: string,
): Promise<OAuthTokenSet> =>
  invoke('od_poll_device_code', { config, deviceCode });

export const odClientCredentials = (
  config: OneDriveConfig,
): Promise<OAuthTokenSet> => invoke('od_client_credentials', { config });

// ─── Sessions ────────────────────────────────────────────────────────

export const odAddSession = (
  config: OneDriveConfig,
  token: OAuthTokenSet,
): Promise<string> => invoke('od_add_session', { config, token });

export const odRemoveSession = (sessionId: string): Promise<void> =>
  invoke('od_remove_session', { sessionId });

export const odListSessions = (): Promise<OneDriveSessionSummary[]> =>
  invoke('od_list_sessions');

// ─── Drives ──────────────────────────────────────────────────────────

export const odGetMyDrive = (sessionId: string): Promise<Drive> =>
  invoke('od_get_my_drive', { sessionId });

export const odListDrives = (sessionId: string): Promise<Drive[]> =>
  invoke('od_list_drives', { sessionId });

// ─── Files & Folders ─────────────────────────────────────────────────

export const odGetItem = (
  sessionId: string,
  itemId: string,
): Promise<DriveItem> => invoke('od_get_item', { sessionId, itemId });

export const odGetItemByPath = (
  sessionId: string,
  path: string,
): Promise<DriveItem> => invoke('od_get_item_by_path', { sessionId, path });

export const odListChildren = (
  sessionId: string,
  folderId: string,
  top?: number,
): Promise<DriveItem[]> =>
  invoke('od_list_children', { sessionId, folderId, top: top ?? null });

export const odListRoot = (
  sessionId: string,
  top?: number,
): Promise<DriveItem[]> =>
  invoke('od_list_root', { sessionId, top: top ?? null });

export const odDownload = (
  sessionId: string,
  itemId: string,
): Promise<number[]> => invoke('od_download', { sessionId, itemId });

export const odUploadSmall = (
  sessionId: string,
  parentId: string,
  fileName: string,
  data: number[] | Uint8Array,
  contentType: string,
): Promise<DriveItem> =>
  invoke('od_upload_small', {
    sessionId,
    parentId,
    fileName,
    data: Array.from(data as Uint8Array),
    contentType,
  });

export const odCreateFolder = (
  sessionId: string,
  parentId: string,
  name: string,
): Promise<DriveItem> =>
  invoke('od_create_folder', { sessionId, parentId, name });

export const odRename = (
  sessionId: string,
  itemId: string,
  newName: string,
): Promise<DriveItem> =>
  invoke('od_rename', { sessionId, itemId, newName });

export const odDelete = (sessionId: string, itemId: string): Promise<void> =>
  invoke('od_delete', { sessionId, itemId });

export const odRestore = (
  sessionId: string,
  itemId: string,
): Promise<DriveItem> => invoke('od_restore', { sessionId, itemId });

export const odListVersions = (
  sessionId: string,
  itemId: string,
): Promise<DriveItemVersion[]> =>
  invoke('od_list_versions', { sessionId, itemId });

// ─── Search ──────────────────────────────────────────────────────────

export const odSearch = (
  sessionId: string,
  query: string,
  top?: number,
): Promise<DriveItem[]> =>
  invoke('od_search', { sessionId, query, top: top ?? null });

export const odRecent = (sessionId: string): Promise<DriveItem[]> =>
  invoke('od_recent', { sessionId });

// ─── Sharing ─────────────────────────────────────────────────────────

export const odCreateLink = (
  sessionId: string,
  itemId: string,
  linkType: CreateLinkRequest['linkType'],
  scope?: CreateLinkRequest['scope'],
): Promise<Permission> =>
  invoke('od_create_link', {
    sessionId,
    itemId,
    linkType,
    scope: scope ?? null,
  });

export const odSharedWithMe = (sessionId: string): Promise<DriveItem[]> =>
  invoke('od_shared_with_me', { sessionId });

// ─── Permissions ─────────────────────────────────────────────────────

export const odListPermissions = (
  sessionId: string,
  itemId: string,
): Promise<Permission[]> =>
  invoke('od_list_permissions', { sessionId, itemId });

export const odRemovePermission = (
  sessionId: string,
  itemId: string,
  permissionId: string,
): Promise<void> =>
  invoke('od_remove_permission', { sessionId, itemId, permissionId });

// ─── Thumbnails ──────────────────────────────────────────────────────

export const odListThumbnails = (
  sessionId: string,
  itemId: string,
): Promise<ThumbnailSet[]> =>
  invoke('od_list_thumbnails', { sessionId, itemId });

export const odDownloadThumbnail = (
  sessionId: string,
  itemId: string,
  size: string,
): Promise<number[]> =>
  invoke('od_download_thumbnail', { sessionId, itemId, size });

// ─── Special Folders ─────────────────────────────────────────────────

export const odGetSpecialFolder = (
  sessionId: string,
  folder: SpecialFolder,
): Promise<DriveItem> =>
  invoke('od_get_special_folder', { sessionId, folder });

// ─── Sync / Delta ────────────────────────────────────────────────────

export const odInitDelta = (sessionId: string): Promise<DeltaSyncState> =>
  invoke('od_init_delta', { sessionId });

// ─── Webhooks ────────────────────────────────────────────────────────

export const odCreateSubscription = (
  sessionId: string,
  request: SubscriptionRequest,
): Promise<Subscription> =>
  invoke('od_create_subscription', { sessionId, request });

export const odListSubscriptions = (
  sessionId: string,
): Promise<Subscription[]> =>
  invoke('od_list_subscriptions', { sessionId });

export const odDeleteSubscription = (
  sessionId: string,
  subscriptionId: string,
): Promise<void> =>
  invoke('od_delete_subscription', { sessionId, subscriptionId });

// ─── Namespace export ────────────────────────────────────────────────

export const onedriveApi = {
  // auth
  generatePkce: odGeneratePkce,
  buildAuthUrl: odBuildAuthUrl,
  exchangeCode: odExchangeCode,
  startDeviceCode: odStartDeviceCode,
  pollDeviceCode: odPollDeviceCode,
  clientCredentials: odClientCredentials,
  // sessions
  addSession: odAddSession,
  removeSession: odRemoveSession,
  listSessions: odListSessions,
  // drives
  getMyDrive: odGetMyDrive,
  listDrives: odListDrives,
  // files/folders
  getItem: odGetItem,
  getItemByPath: odGetItemByPath,
  listChildren: odListChildren,
  listRoot: odListRoot,
  download: odDownload,
  uploadSmall: odUploadSmall,
  createFolder: odCreateFolder,
  rename: odRename,
  delete: odDelete,
  restore: odRestore,
  listVersions: odListVersions,
  // search
  search: odSearch,
  recent: odRecent,
  // sharing
  createLink: odCreateLink,
  sharedWithMe: odSharedWithMe,
  // permissions
  listPermissions: odListPermissions,
  removePermission: odRemovePermission,
  // thumbnails
  listThumbnails: odListThumbnails,
  downloadThumbnail: odDownloadThumbnail,
  // special folders
  getSpecialFolder: odGetSpecialFolder,
  // sync
  initDelta: odInitDelta,
  // webhooks
  createSubscription: odCreateSubscription,
  listSubscriptions: odListSubscriptions,
  deleteSubscription: odDeleteSubscription,
} as const;

export default function useOneDrive(): typeof onedriveApi {
  return onedriveApi;
}
