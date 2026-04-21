/**
 * TypeScript types mirroring the Rust `sorng-whatsapp` crate models.
 *
 * All types use camelCase or snake_case to match the Rust serde
 * `rename_all` configuration on each struct.
 */

// ═══════════════════════════════════════════════════════════════════════
//  Configuration & Session
// ═══════════════════════════════════════════════════════════════════════

export interface WaConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion?: string;
  baseUrl?: string;
  webhookVerifyToken?: string | null;
  appSecret?: string | null;
  timeoutSec?: number;
  maxRetries?: number;
}

export type WaSessionState = "active" | "tokenExpired" | "disconnected" | "error";

export interface WaSession {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  phoneDisplay: string | null;
  state: WaSessionState;
  connectedAt: string;
  lastActivity: string;
  messagesSent: number;
  messagesReceived: number;
}

export interface WaSessionSummary {
  sessionId: string;
  phoneNumberId: string;
  phoneDisplay: string | null;
  state: string;
  messagesSent: number;
  messagesReceived: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  Message Types
// ═══════════════════════════════════════════════════════════════════════

export type WaMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "reaction"
  | "interactive"
  | "template";

// ═══════════════════════════════════════════════════════════════════════
//  Message Payloads
// ═══════════════════════════════════════════════════════════════════════

export interface WaTextPayload {
  body: string;
  preview_url?: boolean;
}

export interface WaMediaPayload {
  id?: string | null;
  link?: string | null;
  caption?: string | null;
  mime_type?: string | null;
}

export interface WaDocumentPayload {
  id?: string | null;
  link?: string | null;
  caption?: string | null;
  filename?: string | null;
}

export interface WaLocationPayload {
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}

export interface WaReactionPayload {
  message_id: string;
  emoji: string;
}

export interface WaMessageContext {
  message_id: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Contact Card
// ═══════════════════════════════════════════════════════════════════════

export interface WaContactCard {
  name: WaContactName;
  phones: WaContactPhone[];
  emails: WaContactEmail[];
  urls: WaContactUrl[];
  addresses: WaContactAddress[];
  org?: WaContactOrg | null;
  birthday?: string | null;
}

export interface WaContactName {
  formatted_name: string;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  suffix?: string | null;
  prefix?: string | null;
}

export interface WaContactPhone {
  phone: string;
  type?: string | null;
  wa_id?: string | null;
}

export interface WaContactEmail {
  email: string;
  type?: string | null;
}

export interface WaContactUrl {
  url: string;
  type?: string | null;
}

export interface WaContactAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  country_code?: string | null;
  type?: string | null;
}

export interface WaContactOrg {
  company?: string | null;
  department?: string | null;
  title?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Interactive Messages
// ═══════════════════════════════════════════════════════════════════════

export type WaInteractiveType =
  | "button"
  | "list"
  | "product"
  | "product_list"
  | "catalog_message"
  | "cta_url"
  | "flow"
  | "location_request_message"
  | "address_message";

export interface WaInteractivePayload {
  type: WaInteractiveType;
  header?: WaInteractiveHeader | null;
  body?: WaInteractiveBody | null;
  footer?: WaInteractiveFooter | null;
  action?: WaInteractiveAction | null;
}

export interface WaInteractiveHeader {
  type: string;
  text?: string | null;
  image?: WaMediaPayload | null;
  video?: WaMediaPayload | null;
  document?: WaDocumentPayload | null;
}

export interface WaInteractiveBody {
  text: string;
}

export interface WaInteractiveFooter {
  text: string;
}

export interface WaInteractiveAction {
  buttons: WaInteractiveButton[];
  button?: string | null;
  sections: WaListSection[];
  name?: string | null;
  parameters?: WaCtaUrlParameters | null;
  catalog_id?: string | null;
  product_retailer_id?: string | null;
  flow_id?: string | null;
  flow_token?: string | null;
  flow_cta?: string | null;
  flow_action?: string | null;
  flow_action_payload?: unknown;
}

export interface WaInteractiveButton {
  type: string;
  reply: WaButtonReply;
}

export interface WaButtonReply {
  id: string;
  title: string;
}

export interface WaListSection {
  title: string;
  rows: WaListRow[];
}

export interface WaListRow {
  id: string;
  title: string;
  description?: string | null;
}

export interface WaCtaUrlParameters {
  display_text: string;
  url: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Templates
// ═══════════════════════════════════════════════════════════════════════

export interface WaTemplatePayload {
  name: string;
  language: WaTemplateLanguage;
  components: WaTemplateComponent[];
}

export interface WaTemplateLanguage {
  code: string;
}

export type WaTemplateComponentType = "header" | "body" | "button";

export interface WaTemplateComponent {
  type: WaTemplateComponentType;
  parameters: WaTemplateParameter[];
  sub_type?: string | null;
  index?: number | null;
}

export interface WaTemplateParameter {
  type: string;
  text?: string | null;
  currency?: WaTemplateCurrency | null;
  date_time?: WaTemplateDateTime | null;
  image?: WaMediaPayload | null;
  video?: WaMediaPayload | null;
  document?: WaDocumentPayload | null;
  payload?: string | null;
}

export interface WaTemplateCurrency {
  fallback_value: string;
  code: string;
  amount_1000: number;
}

export interface WaTemplateDateTime {
  fallback_value: string;
}

export type WaTemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "DISABLED"
  | "PAUSED"
  | "PENDING_DELETION"
  | "DELETED"
  | "IN_APPEAL"
  | "LIMIT_EXCEEDED";

export type WaTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export interface WaTemplateInfo {
  id: string;
  name: string;
  language: string;
  status: WaTemplateStatus;
  category: WaTemplateCategory;
  components: WaTemplateComponentDef[];
  rejected_reason?: string | null;
  quality_score?: WaQualityScore | null;
}

export interface WaTemplateComponentDef {
  type: string;
  format?: string | null;
  text?: string | null;
  buttons: WaTemplateButtonDef[];
  example?: unknown;
}

export interface WaTemplateButtonDef {
  type: string;
  text: string;
  url?: string | null;
  phone_number?: string | null;
  example?: string[] | null;
}

export interface WaCreateTemplateRequest {
  name: string;
  language: string;
  category: WaTemplateCategory;
  components: WaTemplateComponentDef[];
  allow_category_change?: boolean | null;
}

export interface WaQualityScore {
  score: string;
  date?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Media
// ═══════════════════════════════════════════════════════════════════════

export interface WaMediaInfo {
  id: string;
  url?: string | null;
  mime_type?: string | null;
  sha256?: string | null;
  file_size?: number | null;
  messaging_product?: string | null;
}

export interface WaMediaUploadResult {
  id: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Message Responses
// ═══════════════════════════════════════════════════════════════════════

export interface WaSendMessageResponse {
  messaging_product: string;
  contacts: WaResponseContact[];
  messages: WaResponseMessage[];
}

export interface WaResponseContact {
  input: string;
  wa_id: string;
}

export interface WaResponseMessage {
  id: string;
  message_status?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Webhooks / Incoming
// ═══════════════════════════════════════════════════════════════════════

export interface WaWebhookPayload {
  object: string;
  entry: WaWebhookEntry[];
}

export interface WaWebhookEntry {
  id: string;
  changes: WaWebhookChange[];
}

export interface WaWebhookChange {
  field: string;
  value: WaWebhookValue;
}

export interface WaWebhookValue {
  messaging_product: string;
  metadata?: WaWebhookMetadata | null;
  contacts: WaWebhookContact[];
  messages: WaIncomingMessage[];
  statuses: WaMessageStatusUpdate[];
  errors: WaWebhookError[];
}

export interface WaWebhookMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WaWebhookContact {
  wa_id: string;
  profile: { name: string };
}

export interface WaIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: WaTextPayload | null;
  image?: WaIncomingMedia | null;
  video?: WaIncomingMedia | null;
  audio?: WaIncomingMedia | null;
  document?: WaIncomingMedia | null;
  sticker?: WaIncomingMedia | null;
  location?: WaLocationPayload | null;
  contacts?: WaContactCard[] | null;
  interactive?: WaIncomingInteractiveReply | null;
  button?: WaIncomingButtonReply | null;
  reaction?: WaReactionPayload | null;
  context?: WaIncomingContext | null;
  referral?: WaReferral | null;
  errors?: WaWebhookError[] | null;
}

export interface WaIncomingMedia {
  id: string;
  mime_type?: string | null;
  sha256?: string | null;
  caption?: string | null;
  filename?: string | null;
  voice?: boolean | null;
  animated?: boolean | null;
}

export interface WaIncomingInteractiveReply {
  type: string;
  button_reply?: WaButtonReply | null;
  list_reply?: WaListReply | null;
}

export interface WaListReply {
  id: string;
  title: string;
  description?: string | null;
}

export interface WaIncomingButtonReply {
  payload: string;
  text: string;
}

export interface WaIncomingContext {
  from: string;
  id: string;
  forwarded?: boolean | null;
  frequently_forwarded?: boolean | null;
  referred_product?: WaReferredProduct | null;
}

export interface WaReferredProduct {
  catalog_id: string;
  product_retailer_id: string;
}

export interface WaReferral {
  source_url?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  headline?: string | null;
  body?: string | null;
  media_type?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
}

export type WaMessageStatus = "sent" | "delivered" | "read" | "failed";

export interface WaMessageStatusUpdate {
  id: string;
  status: WaMessageStatus;
  timestamp: string;
  recipient_id: string;
  conversation?: WaConversation | null;
  pricing?: WaPricing | null;
  errors?: WaWebhookError[] | null;
}

export interface WaConversation {
  id: string;
  origin?: { type: string } | null;
  expiration_timestamp?: string | null;
}

export interface WaPricing {
  billable: boolean;
  pricing_model: string;
  category: string;
}

export interface WaWebhookError {
  code: number;
  title: string;
  message?: string | null;
  error_data?: { details: string } | null;
  href?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Business Profile
// ═══════════════════════════════════════════════════════════════════════

export interface WaBusinessProfile {
  about?: string | null;
  address?: string | null;
  description?: string | null;
  email?: string | null;
  messaging_product?: string | null;
  profile_picture_url?: string | null;
  websites: string[];
  vertical?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Phone Numbers
// ═══════════════════════════════════════════════════════════════════════

export interface WaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating?: string | null;
  status?: string | null;
  name_status?: string | null;
  code_verification_status?: string | null;
  messaging_limit_tier?: string | null;
  platform_type?: string | null;
  is_official_business_account?: boolean | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Groups
// ═══════════════════════════════════════════════════════════════════════

export interface WaGroupInfo {
  id: string;
  subject: string;
  owner?: string | null;
  creation: number;
  participants: WaGroupParticipant[];
  description?: string | null;
  inviteLink?: string | null;
}

export interface WaGroupParticipant {
  id: string;
  admin?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Flows
// ═══════════════════════════════════════════════════════════════════════

export type WaFlowStatus = "DRAFT" | "PUBLISHED" | "DEPRECATED" | "BLOCKED" | "THROTTLED";

export interface WaFlow {
  id: string;
  name: string;
  status: WaFlowStatus;
  categories: string[];
  validation_errors?: unknown[] | null;
  json_version?: string | null;
  data_api_version?: string | null;
  endpoint_uri?: string | null;
  preview?: { preview_url: string; expires_at: string } | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Analytics
// ═══════════════════════════════════════════════════════════════════════

export interface WaAnalyticsDataPoint {
  start: string;
  end: string;
  sent: number;
  delivered: number;
  read: number;
  dataPoints: WaConversationAnalytics[];
}

export interface WaConversationAnalytics {
  start: string;
  end: string;
  conversation: number;
  cost: number;
}

// ═══════════════════════════════════════════════════════════════════════
//  Chat History
// ═══════════════════════════════════════════════════════════════════════

export type WaMessageDirection = "outgoing" | "incoming";
export type WaLocalMessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface WaChatMessage {
  id: string;
  sessionId: string;
  direction: WaMessageDirection;
  contactWaId: string;
  contactName: string | null;
  msgType: string;
  body: string | null;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaCaption: string | null;
  latitude: number | null;
  longitude: number | null;
  templateName: string | null;
  status: WaLocalMessageStatus;
  timestamp: string;
  waMessageId: string | null;
  replyToId: string | null;
  reactionEmoji: string | null;
  rawPayload?: unknown;
}

export interface WaConversationThread {
  contactWaId: string;
  contactName: string | null;
  lastMessage: WaChatMessage | null;
  unreadCount: number;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Bulk Messaging
// ═══════════════════════════════════════════════════════════════════════

export interface WaBulkMessageContent {
  msgType: WaMessageType;
  text?: WaTextPayload | null;
  template?: WaTemplatePayload | null;
  image?: WaMediaPayload | null;
  document?: WaDocumentPayload | null;
}

export interface WaBulkMessageRequest {
  recipients: string[];
  message: WaBulkMessageContent;
  delayMs?: number;
}

export interface WaBulkMessageResult {
  total: number;
  succeeded: number;
  failed: number;
  results: WaBulkSendEntry[];
}

export interface WaBulkSendEntry {
  recipient: string;
  success: boolean;
  messageId: string | null;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Pagination
// ═══════════════════════════════════════════════════════════════════════

export interface WaPaginatedResponse<T> {
  data: T[];
  paging?: WaPaging | null;
}

export interface WaPaging {
  cursors?: { before: string; after: string } | null;
  next?: string | null;
  previous?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
//  Tauri Events
// ═══════════════════════════════════════════════════════════════════════

export type WaEvent =
  | {
      type: "messageReceived";
      sessionId: string;
      message: WaChatMessage;
    }
  | {
      type: "messageStatusChanged";
      sessionId: string;
      messageId: string;
      status: WaMessageStatus;
      timestamp: string;
    }
  | {
      type: "sessionStateChanged";
      sessionId: string;
      state: WaSessionState;
      timestamp: string;
    }
  | {
      type: "error";
      sessionId: string | null;
      message: string;
      timestamp: string;
    };

// ═══════════════════════════════════════════════════════════════════════
//  Unofficial / Pairing Types
// ═══════════════════════════════════════════════════════════════════════

export type UnofficialConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "qrPending"
  | "error";

export type PairingState =
  | "idle"
  | "waitingForQrScan"
  | "waitingForPhoneCode"
  | "paired"
  | "failed"
  | "cancelled";

export interface QrCodeData {
  qrString: string;
  expiresAt: string;
  ref_?: string | null;
}
