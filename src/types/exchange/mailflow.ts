// Exchange "Transport & Mail Flow" category types (t42-exchange-c2).
//
// camelCase 1:1 mirror of the transport/connector/mail-flow/address-policy/
// remote-domain/transport-config structs in
// `src-tauri/crates/sorng-exchange/src/types.rs`. Every struct there derives
// `#[serde(rename_all = "camelCase")]` (and each enum is `rename_all = "camelCase"`
// too), so these interfaces are a direct view of the wire shape — no invoke-layer
// remapping. `DateTime<Utc>` fields serialize as ISO-8601 strings; a Rust
// `HashMap<String, Vec<String>>` is a `Record<string, string[]>`.
//
// Shared/config types (connection summary, tab props, error/token helpers) live in
// the lead-owned barrel `src/types/exchange/index.ts`; import those from there.

// ═══════════════════════════════════════════════════════════════════════════════
// Transport rules
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `RuleState`. */
export type RuleState = "enabled" | "disabled";

/** Mirror of `TransportRule` — a mail-flow (transport) rule with its most-popular
 *  condition/action subset. */
export interface TransportRule {
  id: string;
  name: string;
  priority: number;
  state: RuleState;
  description?: string | null;
  comments?: string | null;
  mode?: string | null;
  // Conditions
  fromAddresses?: string[] | null;
  sentToAddresses?: string[] | null;
  subjectContainsWords?: string[] | null;
  subjectOrBodyContainsWords?: string[] | null;
  headerContainsWords?: Record<string, string[]> | null;
  hasAttachment?: boolean | null;
  fromScope?: string | null;
  // Actions
  prependSubject?: string | null;
  addDisclaimerText?: string | null;
  redirectMessageTo?: string[] | null;
  rejectMessageReason?: string | null;
  setScl?: number | null;
  copyTo?: string[] | null;
  bccTo?: string[] | null;
  /** ISO-8601 timestamp. */
  whenCreated?: string | null;
}

/** Mirror of `CreateTransportRuleRequest` — payload for `exchange_create_transport_rule`. */
export interface CreateTransportRuleRequest {
  name: string;
  priority?: number | null;
  description?: string | null;
  fromAddresses?: string[] | null;
  sentToAddresses?: string[] | null;
  subjectContainsWords?: string[] | null;
  hasAttachment?: boolean | null;
  prependSubject?: string | null;
  redirectMessageTo?: string[] | null;
  rejectMessageReason?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connectors
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `ConnectorDirection`. */
export type ConnectorDirection = "send" | "receive" | "inbound" | "outbound";

/** Mirror of `Connector` — send / receive / inbound / outbound connector. */
export interface Connector {
  id: string;
  name: string;
  direction: ConnectorDirection;
  enabled: boolean;
  connectorType?: string | null;
  smartHosts?: string[] | null;
  addressSpaces?: string[] | null;
  sourceTransportServers?: string[] | null;
  remoteIpRanges?: string[] | null;
  tlsSettings?: string | null;
  comment?: string | null;
  /** ISO-8601 timestamp. */
  whenCreated?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message trace & queues
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `DeliveryStatus`. */
export type DeliveryStatus =
  | "delivered"
  | "failed"
  | "pending"
  | "expanded"
  | "quarantined"
  | "filteredAsSpam"
  | "none";

/** Mirror of `MessageTraceResult` — one row of a message trace / tracking-log run. */
export interface MessageTraceResult {
  messageId: string;
  senderAddress: string;
  recipientAddress: string;
  subject: string;
  status: DeliveryStatus;
  /** ISO-8601 timestamp. */
  received?: string | null;
  size?: number | null;
  messageTraceId?: string | null;
}

/** Mirror of `MessageTraceRequest` — payload for `exchange_message_trace`.
 *  `pageSize` / `page` carry Rust serde defaults (100 / 0) when omitted. */
export interface MessageTraceRequest {
  senderAddress?: string | null;
  recipientAddress?: string | null;
  messageId?: string | null;
  /** ISO-8601 timestamp. */
  startDate?: string | null;
  /** ISO-8601 timestamp. */
  endDate?: string | null;
  status?: DeliveryStatus | null;
  pageSize?: number;
  page?: number;
}

/** Mirror of `MailQueue` — a transport queue snapshot. */
export interface MailQueue {
  identity: string;
  deliveryType: string;
  status: string;
  messageCount: number;
  nextHopDomain?: string | null;
  lastError?: string | null;
  /** ISO-8601 timestamp. */
  nextRetryTime?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Address policies & lists
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `EmailAddressPolicy`. */
export interface EmailAddressPolicy {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  enabledEmailAddressTemplates: string[];
  recipientFilter?: string | null;
  recipientFilterType?: string | null;
}

/** Mirror of `AcceptedDomainType`. */
export type AcceptedDomainType =
  | "authoritative"
  | "internalRelay"
  | "externalRelay";

/** Mirror of `AcceptedDomain`. */
export interface AcceptedDomain {
  name: string;
  domainName: string;
  domainType: AcceptedDomainType;
  isDefault: boolean;
}

/** Mirror of `AddressList`. */
export interface AddressList {
  name: string;
  path: string;
  recipientFilter?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Remote domains
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `RemoteDomain`. */
export interface RemoteDomain {
  name: string;
  domainName: string;
  isInternal: boolean;
  autoReplyEnabled: boolean;
  autoForwardEnabled: boolean;
  deliveryReportEnabled: boolean;
  ndrEnabled: boolean;
  tnefEnabled: boolean;
  allowedOofType?: string | null;
  contentType?: string | null;
  characterSet?: string | null;
}

/** Mirror of `CreateRemoteDomainRequest` — payload for `exchange_create_remote_domain`. */
export interface CreateRemoteDomainRequest {
  name: string;
  domainName: string;
  autoReplyEnabled?: boolean | null;
  autoForwardEnabled?: boolean | null;
  deliveryReportEnabled?: boolean | null;
  ndrEnabled?: boolean | null;
  allowedOofType?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transport config
// ═══════════════════════════════════════════════════════════════════════════════

/** Mirror of `TransportConfig` — organization-wide transport settings. */
export interface TransportConfig {
  maxSendSize?: string | null;
  maxReceiveSize?: string | null;
  externalPostmasterAddress: string;
  internalSmtpServers: string[];
  tlsReceiveDomainSecureList: string[];
  tlsSendDomainSecureList: string[];
  generateCopyOfDsrFor: string[];
  journalArchivingEnabled: boolean;
  shadowRedundancyEnabled: boolean;
  safetyNetHoldTime: string;
}
