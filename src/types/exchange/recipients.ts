// Exchange "Recipients & Mailboxes" domain types (t42 `c1`).
//
// camelCase 1:1 mirror of the recipient structs in
// `src-tauri/crates/sorng-exchange/src/types.rs`. Every struct there derives
// `#[serde(rename_all = "camelCase")]`, so these interfaces map field-for-field
// with no invoke-layer remapping (unlike netbox). Enums are `rename_all
// = "camelCase"` too, hence the camelCase string-literal unions below.
//
// Covers the 49 commands of the recipients slice: mailboxes, distribution /
// M365 groups, mail contacts & mail users, shared / resource mailboxes, and
// archive mailboxes. Shared connection/config types live in
// `src/types/exchange/index.ts`; import `ExchangeTabProps` from there.

// ─── Mailboxes ────────────────────────────────────────────────────────────────

/** Mirror of `MailboxType`. */
export type MailboxType =
  | "userMailbox"
  | "sharedMailbox"
  | "roomMailbox"
  | "equipmentMailbox"
  | "linkedMailbox"
  | "discoveryMailbox"
  | "schedulingMailbox";

/** Mirror of `Mailbox`. */
export interface Mailbox {
  id: string;
  displayName: string;
  primarySmtpAddress: string;
  alias: string;
  mailboxType: MailboxType;
  isEnabled: boolean;
  database?: string | null;
  server?: string | null;
  organizationalUnit?: string | null;
  emailAddresses?: string[];
  whenCreated?: string | null;
  whenChanged?: string | null;
  archiveStatus?: string | null;
  litigationHoldEnabled?: boolean | null;
  retentionPolicy?: string | null;
  userPrincipalName?: string | null;
}

/** Mirror of `MailboxQuota`. */
export interface MailboxQuota {
  prohibitSendQuota?: string | null;
  prohibitSendReceiveQuota?: string | null;
  issueWarningQuota?: string | null;
  useDatabaseQuotaDefaults: boolean;
}

/** Mirror of `MailboxStatistics`. */
export interface MailboxStatistics {
  displayName: string;
  totalItemSize?: string | null;
  itemCount: number;
  lastLogonTime?: string | null;
  lastLogoffTime?: string | null;
  databaseName?: string | null;
  deletedItemCount: number;
  totalDeletedItemSize?: string | null;
}

/** Mirror of `MailboxPermission`. */
export interface MailboxPermission {
  identity: string;
  user: string;
  accessRights: string[];
  isInherited: boolean;
  deny: boolean;
}

/** Mirror of `MailboxForwarding`. */
export interface MailboxForwarding {
  identity: string;
  forwardingAddress?: string | null;
  forwardingSmtpAddress?: string | null;
  deliverToMailboxAndForward: boolean;
}

/** Mirror of `AutoReplyState`. */
export type AutoReplyState = "disabled" | "enabled" | "scheduled";

/** Mirror of `ExternalAudience`. */
export type ExternalAudience = "none" | "known" | "all";

/** Mirror of `OutOfOfficeSettings` (the `settings` arg of `exchange_set_ooo`). */
export interface OutOfOfficeSettings {
  identity: string;
  autoReplyState: AutoReplyState;
  internalMessage?: string | null;
  externalMessage?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  externalAudience: ExternalAudience;
}

/** Mirror of `CreateMailboxRequest` (the `request` arg of `exchange_create_mailbox`). */
export interface CreateMailboxRequest {
  displayName: string;
  alias: string;
  primarySmtpAddress: string;
  mailboxType: MailboxType;
  password?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  organizationalUnit?: string | null;
  database?: string | null;
}

/** Mirror of `UpdateMailboxRequest` (the `request` arg of `exchange_update_mailbox`). */
export interface UpdateMailboxRequest {
  identity: string;
  displayName?: string | null;
  alias?: string | null;
  primarySmtpAddress?: string | null;
  quota?: MailboxQuota | null;
  forwarding?: MailboxForwarding | null;
  maxSendSize?: string | null;
  maxReceiveSize?: string | null;
}

// ─── Distribution / M365 groups ───────────────────────────────────────────────

/** Mirror of `GroupType`. */
export type GroupType =
  | "distribution"
  | "security"
  | "mailEnabledSecurity"
  | "dynamicDistribution"
  | "microsoft365";

/** Mirror of `DistributionGroup`. */
export interface DistributionGroup {
  id: string;
  displayName: string;
  primarySmtpAddress: string;
  alias: string;
  groupType: GroupType;
  memberCount: number;
  managedBy?: string[] | null;
  description?: string | null;
  requireSenderAuthenticationEnabled: boolean;
  hideFromAddressLists: boolean;
  emailAddresses?: string[];
  whenCreated?: string | null;
}

/** Mirror of `GroupMember`. */
export interface GroupMember {
  identity: string;
  displayName: string;
  primarySmtpAddress: string;
  recipientType: string;
}

/** Mirror of `CreateGroupRequest` (the `request` arg of `exchange_create_group`). */
export interface CreateGroupRequest {
  displayName: string;
  alias: string;
  primarySmtpAddress: string;
  groupType: GroupType;
  managedBy?: string[] | null;
  description?: string | null;
  members?: string[] | null;
}

/** Mirror of `UpdateGroupRequest` (the `request` arg of `exchange_update_group`). */
export interface UpdateGroupRequest {
  identity: string;
  displayName?: string | null;
  primarySmtpAddress?: string | null;
  managedBy?: string[] | null;
  description?: string | null;
  requireSenderAuthenticationEnabled?: boolean | null;
  hideFromAddressLists?: boolean | null;
}

// ─── Mail contacts & mail users ───────────────────────────────────────────────

/** Mirror of `MailContact`. */
export interface MailContact {
  id: string;
  displayName: string;
  alias: string;
  externalEmailAddress: string;
  primarySmtpAddress?: string | null;
  emailAddresses?: string[];
  organizationalUnit?: string | null;
  hideFromAddressLists: boolean;
  firstName?: string | null;
  lastName?: string | null;
  whenCreated?: string | null;
}

/** Mirror of `CreateMailContactRequest`. */
export interface CreateMailContactRequest {
  displayName: string;
  alias: string;
  externalEmailAddress: string;
  firstName?: string | null;
  lastName?: string | null;
  organizationalUnit?: string | null;
}

/** Mirror of `MailUser`. */
export interface MailUser {
  id: string;
  displayName: string;
  alias: string;
  externalEmailAddress: string;
  userPrincipalName: string;
  primarySmtpAddress?: string | null;
  emailAddresses?: string[];
  isEnabled: boolean;
  whenCreated?: string | null;
}

/** Mirror of `CreateMailUserRequest`. */
export interface CreateMailUserRequest {
  displayName: string;
  alias: string;
  externalEmailAddress: string;
  userPrincipalName: string;
  password: string;
  firstName?: string | null;
  lastName?: string | null;
}

/** Mirror of `ConvertMailboxRequest` (the `req` arg of `exchange_convert_mailbox`). */
export interface ConvertMailboxRequest {
  identity: string;
  targetType: MailboxType;
}

// ─── Archive mailboxes ────────────────────────────────────────────────────────

/** Mirror of `ArchiveMailboxInfo`. */
export interface ArchiveMailboxInfo {
  identity: string;
  archiveState: string;
  archiveName?: string | null;
  archiveDatabase?: string | null;
  archiveGuid?: string | null;
  archiveQuota?: string | null;
  archiveWarningQuota?: string | null;
  autoExpandingArchiveEnabled: boolean;
}

/** Mirror of `ArchiveStatistics`. */
export interface ArchiveStatistics {
  identity: string;
  totalItemSize?: string | null;
  itemCount: number;
  totalDeletedItemSize?: string | null;
  deletedItemCount: number;
}
