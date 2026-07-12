// Exchange "Client Access & Protocols" category types (t42-exchange-c4).
//
// camelCase 1:1 mirror of the c4 domain structs in
// `src-tauri/crates/sorng-exchange/src/types.rs`. Those structs derive
// `#[serde(rename_all = "camelCase")]`, so these interfaces are a direct view of
// the wire shape (no invoke-layer remapping). Enums also derive
// `rename_all = "camelCase"`, so their variants are camelCase string-literal
// unions. Shared/config types (connection summary, `ExchangeTabProps`, …) live in
// the barrel `./index`; import those from there.

// ═══════════════════════════════════════════════════════════════════════════════
// Calendar & resource booking
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `CalendarPermissionLevel`. */
export type CalendarPermissionLevel =
  | "none"
  | "freeBusyTimeOnly"
  | "freeBusyTimeAndSubjectAndLocation"
  | "limitedDetails"
  | "reviewer"
  | "author"
  | "editor"
  | "publishingAuthor"
  | "publishingEditor"
  | "owner";

/** Mirror of `CalendarPermission`. */
export interface CalendarPermission {
  identity: string;
  user: string;
  accessRights: CalendarPermissionLevel;
}

/** Mirror of `ResourceBookingConfig` — room/equipment auto-accept policy. */
export interface ResourceBookingConfig {
  identity: string;
  autoAccept: boolean;
  allowConflicts: boolean;
  bookingWindowInDays?: number | null;
  maxDurationInMinutes?: number | null;
  resourceDelegates?: string[] | null;
  allowRecurringMeetings: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public folders
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `PublicFolder`. */
export interface PublicFolder {
  identity: string;
  name: string;
  parentPath: string;
  folderClass: string;
  mailEnabled: boolean;
  primarySmtpAddress?: string | null;
  hasSubFolders: boolean;
  contentMailbox?: string | null;
}

/** Mirror of `PublicFolderStatistics`. */
export interface PublicFolderStatistics {
  identity: string;
  itemCount: number;
  totalItemSize?: string | null;
  /** ISO-8601 timestamp. */
  lastModificationTime?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile devices (Exchange ActiveSync)
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `MobileDeviceAccessState`. */
export type MobileDeviceAccessState =
  | "allowed"
  | "blocked"
  | "quarantined"
  | "deviceDiscovery";

/** Mirror of `MobileDevice`. */
export interface MobileDevice {
  identity: string;
  deviceId: string;
  deviceFriendlyName?: string | null;
  deviceModel?: string | null;
  deviceType?: string | null;
  deviceOs?: string | null;
  deviceUserAgent?: string | null;
  deviceAccessState: MobileDeviceAccessState;
  /** ISO-8601 timestamp. */
  firstSyncTime?: string | null;
  /** ISO-8601 timestamp. */
  lastSyncAttemptTime?: string | null;
  /** ISO-8601 timestamp. */
  lastSuccessfulSync?: string | null;
  clientType?: string | null;
}

/** Mirror of `MobileDeviceStatistics`. */
export interface MobileDeviceStatistics {
  identity: string;
  deviceId: string;
  status?: string | null;
  /** ISO-8601 timestamp. */
  lastSyncAttemptTime?: string | null;
  /** ISO-8601 timestamp. */
  lastSuccessfulSync?: string | null;
  numberOfFoldersSynced: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inbox rules
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `InboxRule` — a server-side mailbox rule (conditions + actions). */
export interface InboxRule {
  ruleId: string;
  name: string;
  priority: number;
  enabled: boolean;
  description?: string | null;
  // Conditions
  from?: string[] | null;
  subjectContainsWords?: string[] | null;
  bodyContainsWords?: string[] | null;
  subjectOrBodyContainsWords?: string[] | null;
  fromAddressContainsWords?: string[] | null;
  hasAttachment?: boolean | null;
  flaggedForAction?: string | null;
  messageTypeMatches?: string | null;
  // Actions
  moveToFolder?: string | null;
  copyToFolder?: string | null;
  deleteMessage?: boolean | null;
  forwardTo?: string[] | null;
  redirectTo?: string[] | null;
  markAsRead?: boolean | null;
  markImportance?: string | null;
  stopProcessingRules?: boolean | null;
}

/** Mirror of `CreateInboxRuleRequest` — payload for `exchange_create_inbox_rule`. */
export interface CreateInboxRuleRequest {
  mailbox: string;
  name: string;
  from?: string[] | null;
  subjectContainsWords?: string[] | null;
  hasAttachment?: boolean | null;
  moveToFolder?: string | null;
  deleteMessage?: boolean | null;
  forwardTo?: string[] | null;
  markAsRead?: boolean | null;
  stopProcessingRules?: boolean | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Client-access policies (OWA, mobile device, throttling)
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `OwaMailboxPolicy` — Outlook on the web feature policy. */
export interface OwaMailboxPolicy {
  id: string;
  name: string;
  isDefault: boolean;
  directFileAccessOnPublicComputers: boolean;
  directFileAccessOnPrivateComputers: boolean;
  wacViewingOnPublicComputers: boolean;
  wacViewingOnPrivateComputers: boolean;
  forceWacViewingFirstOnPublicComputers: boolean;
  forceWacViewingFirstOnPrivateComputers: boolean;
  actionForUnknownFileAndMimeTypes: string;
  instantMessagingEnabled: boolean;
  textMessagingEnabled: boolean;
  activeSyncIntegrationEnabled: boolean;
  allAddressListsEnabled: boolean;
  calendarEnabled: boolean;
  contactsEnabled: boolean;
  tasksEnabled: boolean;
  journalEnabled: boolean;
  notesEnabled: boolean;
  remindersAndNotificationsEnabled: boolean;
  searchFoldersEnabled: boolean;
  signaturesEnabled: boolean;
  spellCheckerEnabled: boolean;
  themeSelectionEnabled: boolean;
  changePasswordEnabled: boolean;
  rulesEnabled: boolean;
  publicFoldersEnabled: boolean;
}

/** Mirror of `MobileDeviceMailboxPolicy` — ActiveSync device security policy. */
export interface MobileDeviceMailboxPolicy {
  id: string;
  name: string;
  isDefault: boolean;
  allowBluetooth: boolean;
  allowBrowser: boolean;
  allowCamera: boolean;
  allowConsumerEmail: boolean;
  allowHtmlEmail: boolean;
  allowInternetSharing: boolean;
  allowIrDa: boolean;
  allowSimplePassword: boolean;
  allowTextMessaging: boolean;
  allowUnsignedApplications: boolean;
  allowWiFi: boolean;
  alphaNumericPasswordRequired: boolean;
  deviceEncryptionEnabled: boolean;
  devicePasswordEnabled: boolean;
  maxInactivityTimeDeviceLock?: string | null;
  maxPasswordFailedAttempts?: number | null;
  minPasswordLength?: number | null;
  passwordRecoveryEnabled: boolean;
  requireDeviceEncryption: boolean;
  requireStorageCardEncryption: boolean;
  attachmentsEnabled: boolean;
}

/** Mirror of `ThrottlingPolicy` — client-access rate/concurrency budgets. */
export interface ThrottlingPolicy {
  id: string;
  name: string;
  isDefault: boolean;
  ewsMaxConcurrency?: string | null;
  ewsMaxSubscriptions?: string | null;
  oasMaxConcurrency?: string | null;
  owaMaxConcurrency?: string | null;
  powerShellMaxConcurrency?: string | null;
  recipientRateLimit?: string | null;
  messageRateLimit?: string | null;
  forwardingSmtpRateLimit?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual directories & Outlook Anywhere
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `VirtualDirectoryType`. */
export type VirtualDirectoryType =
  | "owa"
  | "ecp"
  | "activeSync"
  | "ews"
  | "powerShell"
  | "mapi"
  | "outlookAnywhere"
  | "autoDiscover"
  | "oab";

/** Mirror of `VirtualDirectory` — a CAS virtual directory (or Outlook Anywhere). */
export interface VirtualDirectory {
  identity: string;
  server: string;
  name: string;
  vdirType: VirtualDirectoryType;
  internalUrl?: string | null;
  externalUrl?: string | null;
  internalAuthenticationMethods: string[];
  externalAuthenticationMethods: string[];
  sslOffloading?: boolean | null;
}
