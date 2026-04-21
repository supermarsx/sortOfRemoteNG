// OneDrive / Microsoft Graph TypeScript types.
//
// Mirror of `src-tauri/crates/sorng-onedrive/src/onedrive/types.rs`.
// All structs use `#[serde(rename_all = "camelCase")]` so fields here
// are camelCase.  Kept intentionally permissive (optional where Rust is
// `Option<T>`) and focused on the fields exercised by the `od_*`
// commands — sub-shapes that are not read from the UI are left as
// `unknown` / `Record<string, unknown>`.

// ─── Configuration & auth ────────────────────────────────────────────

export interface OneDriveConfig {
  clientId: string;
  clientSecret?: string | null;
  tenantId: string;
  redirectUri: string;
  graphBaseUrl: string;
  timeoutSec: number;
  maxRetries: number;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string | null;
  tokenType: string;
  expiresAt: string; // ISO-8601 DateTime<Utc>
  scope: string;
  idToken?: string | null;
}

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
  method: string;
}

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message: string;
}

export interface GraphUserProfile {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
}

// ─── Drives & items ──────────────────────────────────────────────────

export interface IdentitySet {
  user?: Identity | null;
  device?: Identity | null;
  application?: Identity | null;
}

export interface Identity {
  id?: string | null;
  displayName?: string | null;
}

export interface DriveQuota {
  deleted?: number | null;
  remaining?: number | null;
  state?: string | null;
  total?: number | null;
  used?: number | null;
  storagePlanInformation?: { upgradeAvailable?: boolean | null } | null;
}

export interface Drive {
  id: string;
  name?: string | null;
  description?: string | null;
  driveType?: string | null;
  owner?: IdentitySet | null;
  quota?: DriveQuota | null;
  webUrl?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
}

export interface ItemReference {
  driveId?: string | null;
  driveType?: string | null;
  id?: string | null;
  name?: string | null;
  path?: string | null;
  shareId?: string | null;
  siteId?: string | null;
}

export interface FileInfo {
  mimeType?: string | null;
  hashes?: Record<string, string | null> | null;
  processingMetadata?: boolean | null;
}

export interface FolderInfo {
  childCount?: number | null;
  view?: Record<string, unknown> | null;
}

export interface SpecialFolderInfo {
  name?: string | null;
}

export interface DriveItem {
  id: string;
  name?: string | null;
  size?: number | null;
  webUrl?: string | null;
  description?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  eTag?: string | null;
  cTag?: string | null;
  parentReference?: ItemReference | null;
  file?: FileInfo | null;
  folder?: FolderInfo | null;
  image?: Record<string, unknown> | null;
  video?: Record<string, unknown> | null;
  audio?: Record<string, unknown> | null;
  photo?: Record<string, unknown> | null;
  remoteItem?: DriveItem | null;
  root?: Record<string, unknown> | null;
  package?: Record<string, unknown> | null;
  shared?: Record<string, unknown> | null;
  sharepointIds?: Record<string, unknown> | null;
  specialFolder?: SpecialFolderInfo | null;
  deleted?: Record<string, unknown> | null;
  malware?: Record<string, unknown> | null;
  contentDownloadUrl?: string | null;
  createdBy?: IdentitySet | null;
  lastModifiedBy?: IdentitySet | null;
  thumbnails?: ThumbnailSet[] | null;
  '@microsoft.graph.downloadUrl'?: string | null;
  '@odata.nextLink'?: string | null;
}

export interface DriveItemVersion {
  id: string;
  lastModifiedDateTime?: string | null;
  size?: number | null;
  lastModifiedBy?: IdentitySet | null;
}

// ─── Thumbnails ──────────────────────────────────────────────────────

export interface Thumbnail {
  height?: number | null;
  width?: number | null;
  url?: string | null;
  sourceItemId?: string | null;
}

export interface ThumbnailSet {
  id?: string | null;
  small?: Thumbnail | null;
  medium?: Thumbnail | null;
  large?: Thumbnail | null;
  source?: Thumbnail | null;
}

// ─── Sharing & permissions ───────────────────────────────────────────

export interface Permission {
  id: string;
  roles?: string[] | null;
  grantedTo?: IdentitySet | null;
  grantedToIdentities?: IdentitySet[] | null;
  link?: SharingLink | null;
  inheritedFrom?: ItemReference | null;
  invitation?: Record<string, unknown> | null;
  shareId?: string | null;
  expirationDateTime?: string | null;
  hasPassword?: boolean | null;
}

export interface SharingLink {
  type?: string | null;
  scope?: string | null;
  webUrl?: string | null;
  webHtml?: string | null;
  application?: Identity | null;
}

export interface CreateLinkRequest {
  linkType: string; // 'view' | 'edit' | 'embed'
  scope?: string | null; // 'anonymous' | 'organization' | 'users'
  expirationDateTime?: string | null;
  password?: string | null;
  retainInheritedPermissions?: boolean | null;
}

// ─── Special folders ─────────────────────────────────────────────────

export type SpecialFolder =
  | 'documents'
  | 'photos'
  | 'cameraRoll'
  | 'appRoot'
  | 'music';

// ─── Delta / sync ────────────────────────────────────────────────────

export interface DeltaSyncState {
  driveId: string;
  deltaLink?: string | null;
  lastSync?: string | null;
  syncedItems: number;
}

// ─── Subscriptions / webhooks ────────────────────────────────────────

export interface Subscription {
  id: string;
  resource?: string | null;
  changeType?: string | null;
  clientState?: string | null;
  notificationUrl?: string | null;
  expirationDateTime?: string | null;
  applicationId?: string | null;
  creatorId?: string | null;
}

export interface SubscriptionRequest {
  resource: string;
  changeType: string;
  clientState?: string | null;
  notificationUrl: string;
  expirationDateTime: string;
}

// ─── Sessions ────────────────────────────────────────────────────────

export interface OneDriveSessionSummary {
  id: string;
  userDisplayName?: string | null;
  userPrincipalName?: string | null;
  defaultDriveId?: string | null;
  connectedAt: string;
  lastActivity: string;
  tokenExpiresAt: string;
}
