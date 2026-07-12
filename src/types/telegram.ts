// Telegram integration types — camelCase 1:1 mirror of the crate's wire shapes.
//
// Source of truth: src-tauri/crates/sorng-telegram/src/types.rs
// (plus MonitoringSummary from src-tauri/crates/sorng-telegram/src/monitoring.rs).
//
// serde conventions preserved per struct:
//   - Bot config, all Send*/Edit*/request structs, and the app-side domain
//     types (NotificationRule, MonitoringCheck, DigestConfig, MessageTemplate,
//     ScheduledMessage, TelegramStats, BotSummary, …) use `rename_all="camelCase"`.
//   - Raw Telegram Bot API response types (TgUser, TgChat, TgMessage, ChatMember,
//     WebhookInfo, ChatInviteLink, …) keep the Bot API's snake_case field names.
//     `TgUser` is explicitly `snake_case`; the others have no rename attr, so
//     their Rust field names (already snake_case) are the wire names.
//   - `ChatId` and `ReplyMarkup` are serde `untagged` enums → TS unions.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bot configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Configuration for a Telegram bot instance (`TelegramBotConfig`). */
export interface TelegramBotConfig {
  /** Human-readable label for this bot. */
  name: string;
  /** Bot API token (from @BotFather). */
  token: string;
  /** Optional custom API base URL (for self-hosted Bot API servers). */
  apiBaseUrl?: string | null;
  /** HTTP request timeout in seconds. */
  timeoutSeconds?: number;
  /** Maximum retries on transient failures. */
  maxRetries?: number;
  /** Whether this bot is enabled. */
  enabled?: boolean;
  /** Optional proxy URL (SOCKS5 or HTTP). */
  proxyUrl?: string | null;
  /** Rate limiting: minimum milliseconds between messages. */
  rateLimitMs?: number;
}

/** Summary of a configured bot (`BotSummary`). */
export interface BotSummary {
  name: string;
  enabled: boolean;
  botUser: TgUser | null;
  connected: boolean;
  apiBase: string;
  messagesSent: number;
  messagesFailed: number;
  lastActivity: string | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  User / Chat / Message (raw Bot API — snake_case wire names)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string | null;
  username?: string | null;
  language_code?: string | null;
}

export type ChatType = "private" | "group" | "supergroup" | "channel";

export interface TgChat {
  id: number;
  type: ChatType;
  title?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  description?: string | null;
  invite_link?: string | null;
  pinned_message?: TgMessage | null;
  photo?: ChatPhoto | null;
}

export interface ChatPhoto {
  small_file_id: string;
  small_file_unique_id: string;
  big_file_id: string;
  big_file_unique_id: string;
}

export interface ChatMember {
  user: TgUser;
  status: string;
  custom_title?: string | null;
  until_date?: number | null;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser | null;
  date: number;
  chat: TgChat;
  text?: string | null;
  entities?: MessageEntity[] | null;
  caption?: string | null;
  caption_entities?: MessageEntity[] | null;
  reply_to_message?: TgMessage | null;
  photo?: PhotoSize[] | null;
  document?: TgDocument | null;
  video?: TgVideo | null;
  audio?: TgAudio | null;
  voice?: TgVoice | null;
  sticker?: TgSticker | null;
  location?: TgLocation | null;
  contact?: TgContact | null;
  poll?: TgPoll | null;
  dice?: TgDice | null;
  reply_markup?: InlineKeyboardMarkup | null;
  forward_from?: TgUser | null;
  forward_date?: number | null;
  edit_date?: number | null;
  media_group_id?: string | null;
}

export interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string | null;
  user?: TgUser | null;
  language?: string | null;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number | null;
}

export interface TgDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  thumbnail?: PhotoSize | null;
}

export interface TgVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  thumbnail?: PhotoSize | null;
}

export interface TgAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string | null;
  title?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  thumbnail?: PhotoSize | null;
}

export interface TgVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string | null;
  file_size?: number | null;
}

export interface TgSticker {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  is_animated?: boolean;
  is_video?: boolean;
  emoji?: string | null;
  set_name?: string | null;
  file_size?: number | null;
  thumbnail?: PhotoSize | null;
}

export interface TgLocation {
  longitude: number;
  latitude: number;
  horizontal_accuracy?: number | null;
  live_period?: number | null;
  heading?: number | null;
  proximity_alert_radius?: number | null;
}

export interface TgContact {
  phone_number: string;
  first_name: string;
  last_name?: string | null;
  user_id?: number | null;
  vcard?: string | null;
}

export interface TgPoll {
  id: string;
  question: string;
  options: PollOption[];
  total_voter_count: number;
  is_closed: boolean;
  is_anonymous: boolean;
  type: string;
  allows_multiple_answers?: boolean;
  correct_option_id?: number | null;
  explanation?: string | null;
}

export interface PollOption {
  text: string;
  voter_count: number;
}

export interface TgDice {
  emoji: string;
  value: number;
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number | null;
  file_path?: string | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Keyboards / reply markup (raw Bot API — snake_case)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  url?: string | null;
  callback_data?: string | null;
  switch_inline_query?: string | null;
  switch_inline_query_current_chat?: string | null;
  login_url?: LoginUrl | null;
  web_app?: WebAppInfo | null;
}

export interface LoginUrl {
  url: string;
  forward_text?: string | null;
  bot_username?: string | null;
  request_write_access?: boolean | null;
}

export interface WebAppInfo {
  url: string;
}

export interface ReplyKeyboardMarkup {
  keyboard: KeyboardButton[][];
  resize_keyboard?: boolean | null;
  one_time_keyboard?: boolean | null;
  input_field_placeholder?: string | null;
  selective?: boolean | null;
  is_persistent?: boolean | null;
}

export interface KeyboardButton {
  text: string;
  request_contact?: boolean | null;
  request_location?: boolean | null;
}

export interface ReplyKeyboardRemove {
  remove_keyboard: boolean;
  selective?: boolean | null;
}

export interface ForceReply {
  force_reply: boolean;
  input_field_placeholder?: string | null;
  selective?: boolean | null;
}

/** serde `untagged` union — any of the four markup shapes. */
export type ReplyMarkup =
  | InlineKeyboardMarkup
  | ReplyKeyboardMarkup
  | ReplyKeyboardRemove
  | ForceReply;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Updates & webhooks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TgUpdate {
  update_id: number;
  message?: TgMessage | null;
  edited_message?: TgMessage | null;
  channel_post?: TgMessage | null;
  edited_channel_post?: TgMessage | null;
  callback_query?: CallbackQuery | null;
  poll?: TgPoll | null;
}

export interface CallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage | null;
  inline_message_id?: string | null;
  chat_instance: string;
  data?: string | null;
  game_short_name?: string | null;
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string | null;
  last_error_date?: number | null;
  last_error_message?: string | null;
  last_synchronization_error_date?: number | null;
  max_connections?: number | null;
  allowed_updates?: string[] | null;
}

/** `WebhookConfig` — camelCase. */
export interface WebhookConfig {
  url: string;
  maxConnections?: number | null;
  allowedUpdates?: string[] | null;
  secretToken?: string | null;
  dropPendingUpdates?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Parse mode / chat id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ParseMode = "Markdown" | "MarkdownV2" | "HTML";

/** serde `untagged` — numeric chat id or `@username`. */
export type ChatId = number | string;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Send requests (camelCase)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SendMessageRequest {
  chatId: ChatId;
  text: string;
  parseMode?: ParseMode | null;
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
  messageThreadId?: number | null;
}

export interface SendPhotoRequest {
  chatId: ChatId;
  /** file_id, URL, or base64-encoded data. */
  photo: string;
  caption?: string | null;
  parseMode?: ParseMode | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
  hasSpoiler?: boolean;
}

export interface SendDocumentRequest {
  chatId: ChatId;
  document: string;
  caption?: string | null;
  parseMode?: ParseMode | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
  fileName?: string | null;
}

export interface SendVideoRequest {
  chatId: ChatId;
  video: string;
  caption?: string | null;
  parseMode?: ParseMode | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  supportsStreaming?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
  hasSpoiler?: boolean;
}

export interface SendAudioRequest {
  chatId: ChatId;
  audio: string;
  caption?: string | null;
  parseMode?: ParseMode | null;
  duration?: number | null;
  performer?: string | null;
  title?: string | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

export interface SendVoiceRequest {
  chatId: ChatId;
  voice: string;
  caption?: string | null;
  parseMode?: ParseMode | null;
  duration?: number | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

export interface SendLocationRequest {
  chatId: ChatId;
  latitude: number;
  longitude: number;
  horizontalAccuracy?: number | null;
  livePeriod?: number | null;
  heading?: number | null;
  proximityAlertRadius?: number | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

export interface SendContactRequest {
  chatId: ChatId;
  phoneNumber: string;
  firstName: string;
  lastName?: string | null;
  vcard?: string | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

export interface SendPollRequest {
  chatId: ChatId;
  question: string;
  options: string[];
  isAnonymous?: boolean | null;
  pollType?: string | null;
  allowsMultipleAnswers?: boolean;
  correctOptionId?: number | null;
  explanation?: string | null;
  explanationParseMode?: ParseMode | null;
  openPeriod?: number | null;
  closeDate?: number | null;
  isClosed?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

export interface SendDiceRequest {
  chatId: ChatId;
  emoji?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

export interface SendStickerRequest {
  chatId: ChatId;
  /** file_id or URL. */
  sticker: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
  emoji?: string | null;
}

/** Chat action broadcast via sendChatAction. */
export type ChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document"
  | "choose_sticker"
  | "find_location"
  | "record_video_note"
  | "upload_video_note";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Edit / forward / copy / pin (camelCase)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface EditMessageTextRequest {
  chatId: ChatId;
  messageId: number;
  text: string;
  parseMode?: ParseMode | null;
  disableWebPagePreview?: boolean;
  replyMarkup?: InlineKeyboardMarkup | null;
}

export interface EditMessageCaptionRequest {
  chatId: ChatId;
  messageId: number;
  caption?: string | null;
  parseMode?: ParseMode | null;
  replyMarkup?: InlineKeyboardMarkup | null;
}

export interface EditMessageReplyMarkupRequest {
  chatId: ChatId;
  messageId: number;
  replyMarkup?: InlineKeyboardMarkup | null;
}

export interface ForwardMessageRequest {
  chatId: ChatId;
  fromChatId: ChatId;
  messageId: number;
  disableNotification?: boolean;
  protectContent?: boolean;
}

export interface CopyMessageRequest {
  chatId: ChatId;
  fromChatId: ChatId;
  messageId: number;
  caption?: string | null;
  parseMode?: ParseMode | null;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number | null;
  replyMarkup?: ReplyMarkup | null;
}

/** Result of copyMessage (`MessageId`, snake_case). */
export interface MessageId {
  message_id: number;
}

export interface AnswerCallbackQueryRequest {
  callbackQueryId: string;
  text?: string | null;
  showAlert?: boolean;
  url?: string | null;
  cacheTime?: number | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Chat administration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Chat permissions (`ChatPermissions`, snake_case). */
export interface ChatPermissions {
  can_send_messages?: boolean | null;
  can_send_audios?: boolean | null;
  can_send_documents?: boolean | null;
  can_send_photos?: boolean | null;
  can_send_videos?: boolean | null;
  can_send_video_notes?: boolean | null;
  can_send_voice_notes?: boolean | null;
  can_send_polls?: boolean | null;
  can_send_other_messages?: boolean | null;
  can_add_web_page_previews?: boolean | null;
  can_change_info?: boolean | null;
  can_invite_users?: boolean | null;
  can_pin_messages?: boolean | null;
  can_manage_topics?: boolean | null;
}

export interface BanChatMemberRequest {
  chatId: ChatId;
  userId: number;
  untilDate?: number | null;
  revokeMessages?: boolean;
}

export interface RestrictChatMemberRequest {
  chatId: ChatId;
  userId: number;
  permissions: ChatPermissions;
  untilDate?: number | null;
  useIndependentChatPermissions?: boolean;
}

export interface PromoteChatMemberRequest {
  chatId: ChatId;
  userId: number;
  isAnonymous?: boolean | null;
  canManageChat?: boolean | null;
  canPostMessages?: boolean | null;
  canEditMessages?: boolean | null;
  canDeleteMessages?: boolean | null;
  canManageVideoChats?: boolean | null;
  canRestrictMembers?: boolean | null;
  canPromoteMembers?: boolean | null;
  canChangeInfo?: boolean | null;
  canInviteUsers?: boolean | null;
  canPinMessages?: boolean | null;
  canManageTopics?: boolean | null;
}

/** Chat invite link (`ChatInviteLink`, snake_case). */
export interface ChatInviteLink {
  invite_link: string;
  creator: TgUser;
  creates_join_request: boolean;
  is_primary: boolean;
  is_revoked: boolean;
  name?: string | null;
  expire_date?: number | null;
  member_limit?: number | null;
  pending_join_request_count?: number | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Notifications & monitoring (camelCase)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ConnectionEventType =
  | "connected"
  | "disconnected"
  | "connectionFailed"
  | "reconnecting"
  | "authenticationFailed"
  | "sessionTimeout"
  | "fileTransferStarted"
  | "fileTransferCompleted"
  | "fileTransferFailed"
  | "commandExecuted"
  | "errorOccurred"
  | "highLatency"
  | "highCpu"
  | "highMemory"
  | "diskSpaceLow"
  | "serviceDown"
  | "custom";

export type NotificationSeverity = "info" | "warning" | "error" | "critical";

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  botName: string;
  chatId: ChatId;
  eventTypes: ConnectionEventType[];
  minSeverity?: NotificationSeverity | null;
  hostFilter?: string | null;
  protocolFilter?: string[] | null;
  template?: string | null;
  parseMode?: ParseMode | null;
  throttleSeconds?: number | null;
  createdAt: string;
  lastTriggered?: string | null;
  triggerCount?: number;
}

export interface ConnectionEvent {
  eventType: ConnectionEventType;
  severity: NotificationSeverity;
  host: string;
  protocol: string;
  sessionId?: string | null;
  username?: string | null;
  message: string;
  details?: Record<string, string> | null;
  timestamp: string;
}

export interface NotificationResult {
  ruleId: string;
  ruleName: string;
  success: boolean;
  messageId?: number | null;
  error?: string | null;
  timestamp: string;
}

export type MonitoringCheckType =
  | "ping"
  | "tcpPort"
  | "httpEndpoint"
  | "sshConnection"
  | "rdpConnection"
  | "vncConnection"
  | "customScript";

export type MonitoringStatus =
  | "unknown"
  | "healthy"
  | "warning"
  | "critical"
  | "down";

export interface MonitoringThresholds {
  warningLatencyMs?: number | null;
  criticalLatencyMs?: number | null;
  timeoutSeconds?: number | null;
  host?: string | null;
  port?: number | null;
  url?: string | null;
  expectedStatusCodes?: number[] | null;
  expectedBodyContains?: string | null;
}

export interface MonitoringCheck {
  id: string;
  name: string;
  enabled: boolean;
  botName: string;
  chatId: ChatId;
  checkType: MonitoringCheckType;
  intervalSeconds: number;
  thresholds?: MonitoringThresholds | null;
  failureThreshold?: number;
  notifyOnRecovery?: boolean;
  parseMode?: ParseMode | null;
  alertTemplate?: string | null;
  recoveryTemplate?: string | null;
  createdAt: string;
  status?: MonitoringStatus;
  consecutiveFailures?: number;
  lastCheck?: string | null;
  lastAlert?: string | null;
}

export interface MonitoringCheckResult {
  checkId: string;
  checkName: string;
  status: MonitoringStatus;
  latencyMs: number | null;
  success: boolean;
  message?: string | null;
  details?: Record<string, string> | null;
  timestamp: string;
}

/** `MonitoringSummary` (monitoring.rs, camelCase). */
export interface MonitoringSummary {
  total: number;
  enabled: number;
  healthy: number;
  warning: number;
  critical: number;
  down: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Digests / templates / scheduled (camelCase)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DigestIncludes {
  activeSessions?: boolean;
  recentConnections?: boolean;
  failedConnections?: boolean;
  monitoringStatus?: boolean;
  systemStats?: boolean;
  notificationSummary?: boolean;
}

export interface DigestConfig {
  id: string;
  name: string;
  enabled: boolean;
  botName: string;
  chatId: ChatId;
  /** "hourly" | "daily" | "weekly" | "@HH:MM". */
  schedule: string;
  include: DigestIncludes;
  parseMode?: ParseMode | null;
  template?: string | null;
  createdAt: string;
  lastSent?: string | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
  parseMode?: ParseMode | null;
  defaultVariables?: Record<string, string>;
  replyMarkup?: InlineKeyboardMarkup | null;
  description?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface SendTemplateRequest {
  botName: string;
  chatId: ChatId;
  templateId: string;
  variables?: Record<string, string>;
  disableNotification?: boolean;
  replyToMessageId?: number | null;
}

export interface ScheduledMessage {
  id: string;
  botName: string;
  chatId: ChatId;
  text: string;
  parseMode?: ParseMode | null;
  scheduledAt: string;
  delivered?: boolean;
  deliveredAt?: string | null;
  messageId?: number | null;
  error?: string | null;
  replyMarkup?: ReplyMarkup | null;
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
  createdAt: string;
}

/** Result of `telegram_process_scheduled_messages`:
 *  Vec<(message_id, Result<i64, String>)> → tuple pairs on the wire. */
export type ScheduledProcessResult = Array<[string, i64Result]>;
/** serde-serialized `Result<i64,String>` → `{ Ok: number } | { Err: string }`. */
export type i64Result = { Ok: number } | { Err: string };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bulk / broadcast (camelCase)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface BroadcastRequest {
  botName: string;
  chatIds: ChatId[];
  text: string;
  parseMode?: ParseMode | null;
  disableNotification?: boolean;
  disableWebPagePreview?: boolean;
  replyMarkup?: ReplyMarkup | null;
}

export interface BroadcastResult {
  total: number;
  successful: number;
  failed: number;
  results: BroadcastItemResult[];
}

export interface BroadcastItemResult {
  chatId: string;
  success: boolean;
  messageId?: number | null;
  error?: string | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Stats / logs (camelCase)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type MessageSource =
  | "manual"
  | "notification"
  | "monitoring"
  | "digest"
  | "scheduled"
  | "template"
  | "api";

export interface MessageLogEntry {
  id: string;
  botName: string;
  chatId: string;
  textPreview: string;
  messageId: number | null;
  success: boolean;
  error: string | null;
  timestamp: string;
  source: MessageSource;
}

export interface TelegramStats {
  configuredBots: number;
  activeBots: number;
  notificationRules: number;
  activeRules: number;
  monitoringChecks: number;
  activeChecks: number;
  digestConfigs: number;
  templates: number;
  scheduledMessagesPending: number;
  totalMessagesSent: number;
  totalMessagesFailed: number;
  totalNotificationsSent: number;
  totalAlertsSent: number;
  messageLogSize: number;
  uptimeSeconds: number;
}
