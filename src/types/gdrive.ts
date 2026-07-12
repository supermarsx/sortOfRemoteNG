// TypeScript mirror of the sorng-gdrive crate's Rust types.
//
// Source: src-tauri/crates/sorng-gdrive/src/types.rs (serde
// `rename_all = "camelCase"`). `interface` for structs, string-literal unions
// for enums. Only the types reachable through the 47 registered `gdrive_*`
// commands are modelled here; command errors cross the Tauri boundary as plain
// strings (the handlers map `GDriveError` via `err_str`), so the error enum is
// intentionally not mirrored.

// ─── OAuth2 ──────────────────────────────────────────────────────────────────

/** Well-known Google Drive OAuth2 scopes (mirrors `types::scopes`). */
export const GDRIVE_SCOPES = {
  drive: "https://www.googleapis.com/auth/drive",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  driveReadonly: "https://www.googleapis.com/auth/drive.readonly",
  driveMetadataReadonly:
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  driveMetadata: "https://www.googleapis.com/auth/drive.metadata",
  driveAppdata: "https://www.googleapis.com/auth/drive.appdata",
  drivePhotosReadonly: "https://www.googleapis.com/auth/drive.photos.readonly",
} as const;

/** The out-of-band redirect that shows the auth code in the browser. */
export const GDRIVE_OOB_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";

/** OAuth2 client credentials (from Google Cloud Console). */
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/** OAuth2 token pair. */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string | null;
  tokenType: string;
  expiresAt?: string | null;
  scope?: string | null;
}

// ─── Account info (about) ────────────────────────────────────────────────────

export interface ExportFormat {
  source: string;
  targets: string[];
}

export interface ImportFormat {
  source: string;
  targets: string[];
}

export interface DriveAbout {
  userDisplayName: string;
  userEmail: string;
  userPhotoLink?: string | null;
  storageUsed: number;
  storageLimit: number;
  storageUsedInTrash: number;
  storageUsedInDrive: number;
  canCreateDrives: boolean;
  maxUploadSize: number;
  exportFormats: ExportFormat[];
  importFormats: ImportFormat[];
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** User info embedded in file metadata. */
export interface DriveUser {
  displayName: string;
  emailAddress?: string | null;
  photoLink?: string | null;
  me: boolean;
  permissionId?: string | null;
}

/** Capabilities the current user has on a file. */
export interface FileCapabilities {
  canEdit: boolean;
  canComment: boolean;
  canShare: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canDownload: boolean;
  canTrash: boolean;
  canUntrash: boolean;
  canRename: boolean;
  canMoveItemWithinDrive: boolean;
  canMoveItemOutOfDrive: boolean;
  canAddChildren: boolean;
  canRemoveChildren: boolean;
  canListChildren: boolean;
  canReadRevisions: boolean;
  canModifyContent: boolean;
}

/** Google Drive file metadata (v3 files resource). */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string | null;
  isFolder: boolean;
  size?: number | null;
  parents: string[];
  createdTime?: string | null;
  modifiedTime?: string | null;
  viewedByMeTime?: string | null;
  fileExtension?: string | null;
  md5Checksum?: string | null;
  starred: boolean;
  trashed: boolean;
  explicitlyTrashed: boolean;
  writersCanShare: boolean;
  viewersCanCopyContent: boolean;
  webViewLink?: string | null;
  webContentLink?: string | null;
  iconLink?: string | null;
  thumbnailLink?: string | null;
  owners: DriveUser[];
  lastModifyingUser?: DriveUser | null;
  sharedWithMeTime?: string | null;
  sharingUser?: DriveUser | null;
  permissions: DrivePermission[];
  version?: string | null;
  originalFilename?: string | null;
  fullFileExtension?: string | null;
  headRevisionId?: string | null;
  capabilities?: FileCapabilities | null;
}

/** Paginated file list response. */
export interface FileList {
  files: DriveFile[];
  nextPageToken?: string | null;
  incompleteSearch: boolean;
}

/** Well-known Google Workspace MIME types (mirrors `types::mime_types`). */
export const GDRIVE_MIME = {
  folder: "application/vnd.google-apps.folder",
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
  drawing: "application/vnd.google-apps.drawing",
  form: "application/vnd.google-apps.form",
  shortcut: "application/vnd.google-apps.shortcut",
} as const;

// ─── Permissions (sharing) ───────────────────────────────────────────────────

export type PermissionType = "user" | "group" | "domain" | "anyone";

export type PermissionRole =
  | "owner"
  | "organizer"
  | "fileOrganizer"
  | "writer"
  | "commenter"
  | "reader";

export interface DrivePermission {
  id: string;
  /** Serialized under the wire key `type`. */
  type: PermissionType;
  role: PermissionRole;
  emailAddress?: string | null;
  domain?: string | null;
  displayName?: string | null;
  photoLink?: string | null;
  expirationTime?: string | null;
  deleted: boolean;
  pendingOwner: boolean;
}

// ─── Revisions ───────────────────────────────────────────────────────────────

export interface DriveRevision {
  id: string;
  mimeType?: string | null;
  modifiedTime?: string | null;
  size?: number | null;
  keepForever: boolean;
  md5Checksum?: string | null;
  originalFilename?: string | null;
  lastModifyingUser?: DriveUser | null;
  publishAuto: boolean;
  published: boolean;
  publishedOutsideDomain: boolean;
}

// ─── Comments & replies ──────────────────────────────────────────────────────

export interface DriveReply {
  id: string;
  content: string;
  htmlContent?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  author?: DriveUser | null;
  deleted: boolean;
  action?: string | null;
}

export interface DriveComment {
  id: string;
  htmlContent?: string | null;
  content: string;
  createdTime?: string | null;
  modifiedTime?: string | null;
  author?: DriveUser | null;
  deleted: boolean;
  resolved: boolean;
  anchor?: string | null;
  replies: DriveReply[];
}

// ─── Shared drives ───────────────────────────────────────────────────────────

export interface SharedDriveRestrictions {
  adminManagedRestrictions: boolean;
  copyRequiresWriterPermission: boolean;
  domainUsersOnly: boolean;
  driveMembersOnly: boolean;
  sharingFoldersRequiresOrganizerPermission: boolean;
}

export interface SharedDriveCapabilities {
  canAddChildren: boolean;
  canManageMembers: boolean;
  canRenameDrive: boolean;
  canDeleteDrive: boolean;
  canListChildren: boolean;
  canChangeDriveMembersOnlyRestriction: boolean;
  canChangeCopyRequiresWriterPermissionRestriction: boolean;
  canChangeDomainUsersOnlyRestriction: boolean;
  canChangeSharingFoldersRequiresOrganizerPermissionRestriction: boolean;
  canTrashChildren: boolean;
}

export interface SharedDrive {
  id: string;
  name: string;
  colorRgb?: string | null;
  createdTime?: string | null;
  hidden: boolean;
  restrictions?: SharedDriveRestrictions | null;
  capabilities?: SharedDriveCapabilities | null;
}

// ─── Changes ─────────────────────────────────────────────────────────────────

export interface DriveChange {
  changeType: string;
  time?: string | null;
  removed: boolean;
  fileId: string;
  file?: DriveFile | null;
  driveId?: string | null;
  drive?: SharedDrive | null;
}

// ─── Connection summary / batch result ───────────────────────────────────────

/** Non-sensitive subset of config + auth state. */
export interface GDriveConnectionSummary {
  name: string;
  authenticated: boolean;
  userEmail?: string | null;
  userDisplayName?: string | null;
  storageUsed?: number | null;
  storageLimit?: number | null;
  connectedAt?: string | null;
}

/** Result of a batch operation (e.g. unshare-all). */
export interface BatchResult {
  succeeded: number;
  failed: number;
  errors: string[];
}
