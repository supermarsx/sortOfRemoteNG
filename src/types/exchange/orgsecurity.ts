// Exchange "Org Config, Security & Compliance" category types (t42-exchange-c5).
//
// camelCase 1:1 mirror of the compliance / RBAC / audit / org-config / hygiene /
// certificate structs in `src-tauri/crates/sorng-exchange/src/types.rs`. Every
// struct there derives `#[serde(rename_all = "camelCase")]`, so these interfaces
// are a direct view of the wire shape (no invoke-layer field remapping). Enums are
// `rename_all = "camelCase"` too, so they surface as camelCase string-literal
// unions.
//
// Shared/shell types (`ExchangeTabProps`, connection summary, error/token/paging)
// live in the barrel `./index`; import them from there, not from this file.

// ─── Retention & compliance holds ─────────────────────────────────────────────

/** Mirror of `RetentionActionType`. */
export type RetentionActionType =
  | "deleteAndAllowRecovery"
  | "permanentlyDelete"
  | "moveToArchive"
  | "markAsPastRetentionLimit"
  | "moveToDeletedItems";

/** Mirror of `RetentionTagType`. */
export type RetentionTagType = "default" | "personal" | "all";

/** Mirror of `RetentionPolicy` — a messaging-records-management retention policy. */
export interface RetentionPolicy {
  id: string;
  name: string;
  /** Linked retention tag names/GUIDs. */
  retentionPolicyTagLinks: string[];
  isDefault: boolean;
}

/** Mirror of `RetentionTag` — a single retention policy tag (RPT/DPT/personal). */
export interface RetentionTag {
  id: string;
  name: string;
  tagType: RetentionTagType;
  ageLimitInDays: number;
  retentionAction: RetentionActionType;
  retentionEnabled: boolean;
  messageClass?: string | null;
  comment?: string | null;
}

/** Mirror of `HoldType`. */
export type HoldType =
  | "none"
  | "litigationHold"
  | "inPlaceHold"
  | "complianceTagHold";

/** Mirror of `MailboxHold` — the hold state of a single mailbox. */
export interface MailboxHold {
  identity: string;
  holdType: HoldType;
  litigationHoldEnabled: boolean;
  /** ISO-8601 timestamp. */
  litigationHoldDate?: string | null;
  litigationHoldOwner?: string | null;
  litigationHoldDuration?: string | null;
  inPlaceHolds?: string[] | null;
}

/** Mirror of `DlpPolicy` — a data-loss-prevention policy. `state` mirrors
 *  `RuleState` (owned by the mailflow slice); inlined here as a union to keep this
 *  module self-contained and avoid a cross-slice barrel re-export collision. */
export interface DlpPolicy {
  id: string;
  name: string;
  state: "enabled" | "disabled";
  mode: string;
  description?: string | null;
  sensitiveInfoTypes: string[];
}

// ─── Journal rules ─────────────────────────────────────────────────────────────

/** Mirror of `JournalRuleScope`. */
export type JournalRuleScope = "global" | "internal" | "external";

/** Mirror of `JournalRule`. */
export interface JournalRule {
  name: string;
  journalEmailAddress: string;
  scope: JournalRuleScope;
  enabled: boolean;
  recipient?: string | null;
}

/** Mirror of `CreateJournalRuleRequest` — payload for `exchange_create_journal_rule`. */
export interface CreateJournalRuleRequest {
  name: string;
  journalEmailAddress: string;
  scope?: JournalRuleScope;
  recipient?: string | null;
  enabled?: boolean;
}

// ─── RBAC & audit ──────────────────────────────────────────────────────────────

/** Mirror of `RoleGroup` — a management role group (RBAC). */
export interface RoleGroup {
  name: string;
  description?: string | null;
  members: string[];
  roles: string[];
  managedBy?: string[] | null;
}

/** Mirror of `ManagementRole`. */
export interface ManagementRole {
  name: string;
  roleType: string;
  parent?: string | null;
  isRootRole: boolean;
  description?: string | null;
}

/** Mirror of `ManagementRoleAssignment`. */
export interface ManagementRoleAssignment {
  name: string;
  role: string;
  roleAssignee: string;
  roleAssigneeType: string;
  enabled: boolean;
  customRecipientWriteScope?: string | null;
  recipientReadScope?: string | null;
}

/** Mirror of `AdminAuditLogEntry` — one admin-audit-log record. */
export interface AdminAuditLogEntry {
  cmdletName: string;
  objectModified: string;
  caller?: string | null;
  succeeded: boolean;
  /** ISO-8601 timestamp. */
  runDate?: string | null;
  cmdletParameters: Record<string, string>;
}

/** Mirror of `AdminAuditLogSearchRequest` — payload for
 *  `exchange_search_admin_audit_log`. */
export interface AdminAuditLogSearchRequest {
  cmdlets?: string[] | null;
  objectIds?: string[] | null;
  userIds?: string[] | null;
  /** ISO-8601 date. */
  startDate?: string | null;
  /** ISO-8601 date. */
  endDate?: string | null;
  resultSize?: number;
}

/** Mirror of `MailboxAuditLogEntry` — one mailbox-audit-log record. */
export interface MailboxAuditLogEntry {
  operation: string;
  mailboxOwner: string;
  loggedBy?: string | null;
  logOnType?: string | null;
  itemSubject?: string | null;
  folderPathName?: string | null;
  /** ISO-8601 timestamp. */
  lastAccessed?: string | null;
}

// ─── Organization config ───────────────────────────────────────────────────────

/** Mirror of `OrganizationConfig` — the org-wide Exchange configuration. */
export interface OrganizationConfig {
  name: string;
  guid?: string | null;
  isDehydrated: boolean;
  defaultPublicFolderAgeLimit: string;
  defaultPublicFolderDeletedItemRetention: string;
  defaultPublicFolderIssueWarningQuota: string;
  defaultPublicFolderProhibitPostQuota: string;
  defaultPublicFolderMaxItemSize: string;
  mailtipsEnabled: boolean;
  mailtipsAllTipsEnabled: boolean;
  mailtipsGroupMetricsEnabled: boolean;
  mailtipsLargeAudienceThreshold: number;
  mailtipsExternalRecipientTipsEnabled: boolean;
  readTrackingEnabled: boolean;
  distributionGroupDefaultOu?: string | null;
  leanPopoutEnabled: boolean;
  publicFoldersEnabled: string;
  maxSendSize?: string | null;
  maxReceiveSize?: string | null;
}

// ─── Anti-spam / hygiene & quarantine ─────────────────────────────────────────

/** Mirror of `ContentFilterConfig` — SCL thresholds + bypass lists. */
export interface ContentFilterConfig {
  identity: string;
  enabled: boolean;
  sclDeleteThreshold: number;
  sclRejectThreshold: number;
  sclQuarantineThreshold: number;
  sclJunkThreshold: number;
  quarantineMailbox?: string | null;
  bypassSenderDomains: string[];
  bypassSenders: string[];
}

/** Mirror of `ConnectionFilterConfig` — IP allow/block lists. */
export interface ConnectionFilterConfig {
  identity: string;
  enabled: boolean;
  ipAllowList: string[];
  ipBlockList: string[];
  enableSafeList: boolean;
}

/** Mirror of `SenderFilterConfig` — blocked senders/domains. */
export interface SenderFilterConfig {
  identity: string;
  enabled: boolean;
  blockedSenders: string[];
  blockedDomains: string[];
  blockedDomainsAndSubdomains: string[];
  blankSenderBlockingEnabled: boolean;
}

/** Mirror of `QuarantineMessage` — one quarantined message. */
export interface QuarantineMessage {
  identity: string;
  subject: string;
  sender: string;
  recipients: string[];
  quarantineReason: string;
  /** ISO-8601 timestamp. */
  receivedTime?: string | null;
  releasedTo?: string[] | null;
  /** ISO-8601 timestamp. */
  expires?: string | null;
  direction: string;
  messageSize: number;
}

// ─── Certificates ──────────────────────────────────────────────────────────────

/** Mirror of `ExchangeCertificate` — an Exchange TLS/SMTP certificate. */
export interface ExchangeCertificate {
  thumbprint: string;
  subject: string;
  issuer: string;
  services: string[];
  certificateDomains: string[];
  /** ISO-8601 timestamp. */
  notBefore?: string | null;
  /** ISO-8601 timestamp. */
  notAfter?: string | null;
  selfSigned: boolean;
  isValid: boolean;
  status?: string | null;
  rootCaType?: string | null;
}
