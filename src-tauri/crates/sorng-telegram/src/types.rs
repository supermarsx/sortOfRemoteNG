//! Shared types for the Telegram integration crate.
//!
//! Covers Bot API types, message structures, chat types, inline keyboards,
//! notification rules, monitoring configuration, and template definitions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bot Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Configuration for a Telegram bot instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramBotConfig {
    /// Human-readable label for this bot.
    pub name: String,
    /// Bot API token (from @BotFather).
    pub token: String,
    /// Optional custom API base URL (for self-hosted Bot API servers).
    #[serde(default)]
    pub api_base_url: Option<String>,
    /// HTTP request timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    /// Maximum retries on transient failures.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Whether this bot is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Optional proxy URL (SOCKS5 or HTTP).
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// Rate limiting: minimum milliseconds between messages.
    #[serde(default = "default_rate_limit_ms")]
    pub rate_limit_ms: u64,
}

fn default_timeout() -> u64 {
    30
}
fn default_max_retries() -> u32 {
    3
}
fn default_true() -> bool {
    true
}
fn default_rate_limit_ms() -> u64 {
    50
}

impl Default for TelegramBotConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            token: String::new(),
            api_base_url: None,
            timeout_seconds: default_timeout(),
            max_retries: default_max_retries(),
            enabled: true,
            proxy_url: None,
            rate_limit_ms: default_rate_limit_ms(),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bot API response wrappers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generic wrapper for Telegram Bot API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(bound(deserialize = "T: serde::de::DeserializeOwned"))]
pub struct ApiResponse<T> {
    pub ok: bool,
    #[serde(default)]
    pub result: Option<T>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub error_code: Option<i32>,
    #[serde(default)]
    pub parameters: Option<ResponseParameters>,
}

/// Additional response parameters (e.g. rate-limit info).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseParameters {
    #[serde(default)]
    pub migrate_to_chat_id: Option<i64>,
    #[serde(default)]
    pub retry_after: Option<i64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  User / Chat / Message
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Telegram user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TgUser {
    pub id: i64,
    pub is_bot: bool,
    pub first_name: String,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub language_code: Option<String>,
}

/// Chat type enumeration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatType {
    Private,
    Group,
    Supergroup,
    Channel,
}

/// Telegram chat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgChat {
    pub id: i64,
    #[serde(rename = "type")]
    pub chat_type: ChatType,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub invite_link: Option<String>,
    #[serde(default)]
    pub pinned_message: Option<Box<TgMessage>>,
    #[serde(default)]
    pub photo: Option<ChatPhoto>,
}

/// Chat photo sizes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatPhoto {
    pub small_file_id: String,
    pub small_file_unique_id: String,
    pub big_file_id: String,
    pub big_file_unique_id: String,
}

/// Chat member info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMember {
    pub user: TgUser,
    pub status: String,
    #[serde(default)]
    pub custom_title: Option<String>,
    #[serde(default)]
    pub until_date: Option<i64>,
}

/// A Telegram message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgMessage {
    pub message_id: i64,
    #[serde(default)]
    pub from: Option<TgUser>,
    pub date: i64,
    pub chat: TgChat,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub entities: Option<Vec<MessageEntity>>,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub caption_entities: Option<Vec<MessageEntity>>,
    #[serde(default)]
    pub reply_to_message: Option<Box<TgMessage>>,
    #[serde(default)]
    pub photo: Option<Vec<PhotoSize>>,
    #[serde(default)]
    pub document: Option<TgDocument>,
    #[serde(default)]
    pub video: Option<TgVideo>,
    #[serde(default)]
    pub audio: Option<TgAudio>,
    #[serde(default)]
    pub voice: Option<TgVoice>,
    #[serde(default)]
    pub sticker: Option<TgSticker>,
    #[serde(default)]
    pub location: Option<TgLocation>,
    #[serde(default)]
    pub contact: Option<TgContact>,
    #[serde(default)]
    pub poll: Option<TgPoll>,
    #[serde(default)]
    pub dice: Option<TgDice>,
    #[serde(default)]
    pub reply_markup: Option<InlineKeyboardMarkup>,
    #[serde(default)]
    pub forward_from: Option<TgUser>,
    #[serde(default)]
    pub forward_date: Option<i64>,
    #[serde(default)]
    pub edit_date: Option<i64>,
    #[serde(default)]
    pub media_group_id: Option<String>,
}

/// Message entity (bold, italic, link, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEntity {
    #[serde(rename = "type")]
    pub entity_type: String,
    pub offset: i64,
    pub length: i64,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub user: Option<TgUser>,
    #[serde(default)]
    pub language: Option<String>,
}

/// Photo size.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoSize {
    pub file_id: String,
    pub file_unique_id: String,
    pub width: i64,
    pub height: i64,
    #[serde(default)]
    pub file_size: Option<i64>,
}

/// Document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgDocument {
    pub file_id: String,
    pub file_unique_id: String,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub file_size: Option<i64>,
    #[serde(default)]
    pub thumbnail: Option<PhotoSize>,
}

/// Video.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgVideo {
    pub file_id: String,
    pub file_unique_id: String,
    pub width: i64,
    pub height: i64,
    pub duration: i64,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub file_size: Option<i64>,
    #[serde(default)]
    pub thumbnail: Option<PhotoSize>,
}

/// Audio.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgAudio {
    pub file_id: String,
    pub file_unique_id: String,
    pub duration: i64,
    #[serde(default)]
    pub performer: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub file_size: Option<i64>,
    #[serde(default)]
    pub thumbnail: Option<PhotoSize>,
}

/// Voice message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgVoice {
    pub file_id: String,
    pub file_unique_id: String,
    pub duration: i64,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub file_size: Option<i64>,
}

/// Sticker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgSticker {
    pub file_id: String,
    pub file_unique_id: String,
    pub width: i64,
    pub height: i64,
    #[serde(default)]
    pub is_animated: bool,
    #[serde(default)]
    pub is_video: bool,
    #[serde(default)]
    pub emoji: Option<String>,
    #[serde(default)]
    pub set_name: Option<String>,
    #[serde(default)]
    pub file_size: Option<i64>,
    #[serde(default)]
    pub thumbnail: Option<PhotoSize>,
}

/// Location.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgLocation {
    pub longitude: f64,
    pub latitude: f64,
    #[serde(default)]
    pub horizontal_accuracy: Option<f64>,
    #[serde(default)]
    pub live_period: Option<i64>,
    #[serde(default)]
    pub heading: Option<i64>,
    #[serde(default)]
    pub proximity_alert_radius: Option<i64>,
}

/// Contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgContact {
    pub phone_number: String,
    pub first_name: String,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub vcard: Option<String>,
}

/// Poll.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgPoll {
    pub id: String,
    pub question: String,
    pub options: Vec<PollOption>,
    pub total_voter_count: i64,
    pub is_closed: bool,
    pub is_anonymous: bool,
    #[serde(rename = "type")]
    pub poll_type: String,
    #[serde(default)]
    pub allows_multiple_answers: bool,
    #[serde(default)]
    pub correct_option_id: Option<i64>,
    #[serde(default)]
    pub explanation: Option<String>,
}

/// Poll option.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollOption {
    pub text: String,
    pub voter_count: i64,
}

/// Dice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgDice {
    pub emoji: String,
    pub value: i64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  File info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// File object returned by getFile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgFile {
    pub file_id: String,
    pub file_unique_id: String,
    #[serde(default)]
    pub file_size: Option<i64>,
    #[serde(default)]
    pub file_path: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Inline Keyboard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Inline keyboard markup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineKeyboardMarkup {
    pub inline_keyboard: Vec<Vec<InlineKeyboardButton>>,
}

/// A single inline keyboard button.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineKeyboardButton {
    pub text: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub callback_data: Option<String>,
    #[serde(default)]
    pub switch_inline_query: Option<String>,
    #[serde(default)]
    pub switch_inline_query_current_chat: Option<String>,
    #[serde(default)]
    pub login_url: Option<LoginUrl>,
    #[serde(default)]
    pub web_app: Option<WebAppInfo>,
}

/// Login URL for inline keyboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginUrl {
    pub url: String,
    #[serde(default)]
    pub forward_text: Option<String>,
    #[serde(default)]
    pub bot_username: Option<String>,
    #[serde(default)]
    pub request_write_access: Option<bool>,
}

/// Web App info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebAppInfo {
    pub url: String,
}

/// Reply keyboard markup (custom keyboard).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyKeyboardMarkup {
    pub keyboard: Vec<Vec<KeyboardButton>>,
    #[serde(default)]
    pub resize_keyboard: Option<bool>,
    #[serde(default)]
    pub one_time_keyboard: Option<bool>,
    #[serde(default)]
    pub input_field_placeholder: Option<String>,
    #[serde(default)]
    pub selective: Option<bool>,
    #[serde(default)]
    pub is_persistent: Option<bool>,
}

/// A single keyboard button.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyboardButton {
    pub text: String,
    #[serde(default)]
    pub request_contact: Option<bool>,
    #[serde(default)]
    pub request_location: Option<bool>,
}

/// Remove keyboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyKeyboardRemove {
    pub remove_keyboard: bool,
    #[serde(default)]
    pub selective: Option<bool>,
}

/// Force reply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForceReply {
    pub force_reply: bool,
    #[serde(default)]
    pub input_field_placeholder: Option<String>,
    #[serde(default)]
    pub selective: Option<bool>,
}

/// Union type for reply markup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReplyMarkup {
    InlineKeyboard(InlineKeyboardMarkup),
    ReplyKeyboard(ReplyKeyboardMarkup),
    ReplyKeyboardRemove(ReplyKeyboardRemove),
    ForceReply(ForceReply),
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Updates & Webhooks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// An incoming update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TgUpdate {
    pub update_id: i64,
    #[serde(default)]
    pub message: Option<TgMessage>,
    #[serde(default)]
    pub edited_message: Option<TgMessage>,
    #[serde(default)]
    pub channel_post: Option<TgMessage>,
    #[serde(default)]
    pub edited_channel_post: Option<TgMessage>,
    #[serde(default)]
    pub callback_query: Option<CallbackQuery>,
    #[serde(default)]
    pub poll: Option<TgPoll>,
}

/// Callback query from inline keyboard press.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallbackQuery {
    pub id: String,
    pub from: TgUser,
    #[serde(default)]
    pub message: Option<TgMessage>,
    #[serde(default)]
    pub inline_message_id: Option<String>,
    pub chat_instance: String,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub game_short_name: Option<String>,
}

/// Webhook info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookInfo {
    pub url: String,
    pub has_custom_certificate: bool,
    pub pending_update_count: i64,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub last_error_date: Option<i64>,
    #[serde(default)]
    pub last_error_message: Option<String>,
    #[serde(default)]
    pub last_synchronization_error_date: Option<i64>,
    #[serde(default)]
    pub max_connections: Option<i64>,
    #[serde(default)]
    pub allowed_updates: Option<Vec<String>>,
}

/// Webhook configuration request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookConfig {
    pub url: String,
    #[serde(default)]
    pub max_connections: Option<i64>,
    #[serde(default)]
    pub allowed_updates: Option<Vec<String>>,
    #[serde(default)]
    pub secret_token: Option<String>,
    #[serde(default)]
    pub drop_pending_updates: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Parse mode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Message parse mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ParseMode {
    #[serde(rename = "Markdown")]
    Markdown,
    #[serde(rename = "MarkdownV2")]
    MarkdownV2,
    #[serde(rename = "HTML")]
    Html,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Send requests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Request to send a text message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub chat_id: ChatId,
    pub text: String,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub disable_web_page_preview: bool,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
    #[serde(default)]
    pub message_thread_id: Option<i64>,
}

/// Chat ID can be a numeric ID or a @username string.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatId {
    Numeric(i64),
    Username(String),
}

impl std::fmt::Display for ChatId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatId::Numeric(id) => write!(f, "{}", id),
            ChatId::Username(name) => write!(f, "{}", name),
        }
    }
}

/// Request to send a photo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPhotoRequest {
    pub chat_id: ChatId,
    /// file_id, URL, or base64-encoded data.
    pub photo: String,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
    #[serde(default)]
    pub has_spoiler: bool,
}

/// Request to send a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendDocumentRequest {
    pub chat_id: ChatId,
    /// file_id, URL, or base64-encoded data.
    pub document: String,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
    #[serde(default)]
    pub file_name: Option<String>,
}

/// Request to send a video.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendVideoRequest {
    pub chat_id: ChatId,
    pub video: String,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub duration: Option<i64>,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub supports_streaming: bool,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
    #[serde(default)]
    pub has_spoiler: bool,
}

/// Request to send audio.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAudioRequest {
    pub chat_id: ChatId,
    pub audio: String,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub duration: Option<i64>,
    #[serde(default)]
    pub performer: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Request to send a voice message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendVoiceRequest {
    pub chat_id: ChatId,
    pub voice: String,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub duration: Option<i64>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Request to send a location.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendLocationRequest {
    pub chat_id: ChatId,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default)]
    pub horizontal_accuracy: Option<f64>,
    #[serde(default)]
    pub live_period: Option<i64>,
    #[serde(default)]
    pub heading: Option<i64>,
    #[serde(default)]
    pub proximity_alert_radius: Option<i64>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Request to send a contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendContactRequest {
    pub chat_id: ChatId,
    pub phone_number: String,
    pub first_name: String,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub vcard: Option<String>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Request to send a poll.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPollRequest {
    pub chat_id: ChatId,
    pub question: String,
    pub options: Vec<String>,
    #[serde(default)]
    pub is_anonymous: Option<bool>,
    #[serde(default)]
    pub poll_type: Option<String>,
    #[serde(default)]
    pub allows_multiple_answers: bool,
    #[serde(default)]
    pub correct_option_id: Option<i64>,
    #[serde(default)]
    pub explanation: Option<String>,
    #[serde(default)]
    pub explanation_parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub open_period: Option<i64>,
    #[serde(default)]
    pub close_date: Option<i64>,
    #[serde(default)]
    pub is_closed: bool,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Request to send a dice.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendDiceRequest {
    pub chat_id: ChatId,
    #[serde(default = "default_dice_emoji")]
    pub emoji: String,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

fn default_dice_emoji() -> String {
    "🎲".to_string()
}

/// Request to send a sticker.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendStickerRequest {
    pub chat_id: ChatId,
    /// file_id or URL.
    pub sticker: String,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
    #[serde(default)]
    pub emoji: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Edit / Forward / Copy / Pin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Request to edit a message's text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditMessageTextRequest {
    pub chat_id: ChatId,
    pub message_id: i64,
    pub text: String,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub disable_web_page_preview: bool,
    #[serde(default)]
    pub reply_markup: Option<InlineKeyboardMarkup>,
}

/// Request to edit a message's caption.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditMessageCaptionRequest {
    pub chat_id: ChatId,
    pub message_id: i64,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub reply_markup: Option<InlineKeyboardMarkup>,
}

/// Request to edit a message's reply markup (keyboard).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditMessageReplyMarkupRequest {
    pub chat_id: ChatId,
    pub message_id: i64,
    #[serde(default)]
    pub reply_markup: Option<InlineKeyboardMarkup>,
}

/// Request to forward a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardMessageRequest {
    pub chat_id: ChatId,
    pub from_chat_id: ChatId,
    pub message_id: i64,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
}

/// Request to copy a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyMessageRequest {
    pub chat_id: ChatId,
    pub from_chat_id: ChatId,
    pub message_id: i64,
    #[serde(default)]
    pub caption: Option<String>,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub protect_content: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Result of copyMessage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageId {
    pub message_id: i64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Chat actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Chat action to broadcast via sendChatAction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatAction {
    Typing,
    UploadPhoto,
    RecordVideo,
    UploadVideo,
    RecordVoice,
    UploadVoice,
    UploadDocument,
    ChooseSticker,
    FindLocation,
    RecordVideoNote,
    UploadVideoNote,
}

/// Chat permissions.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatPermissions {
    #[serde(default)]
    pub can_send_messages: Option<bool>,
    #[serde(default)]
    pub can_send_audios: Option<bool>,
    #[serde(default)]
    pub can_send_documents: Option<bool>,
    #[serde(default)]
    pub can_send_photos: Option<bool>,
    #[serde(default)]
    pub can_send_videos: Option<bool>,
    #[serde(default)]
    pub can_send_video_notes: Option<bool>,
    #[serde(default)]
    pub can_send_voice_notes: Option<bool>,
    #[serde(default)]
    pub can_send_polls: Option<bool>,
    #[serde(default)]
    pub can_send_other_messages: Option<bool>,
    #[serde(default)]
    pub can_add_web_page_previews: Option<bool>,
    #[serde(default)]
    pub can_change_info: Option<bool>,
    #[serde(default)]
    pub can_invite_users: Option<bool>,
    #[serde(default)]
    pub can_pin_messages: Option<bool>,
    #[serde(default)]
    pub can_manage_topics: Option<bool>,
}

/// Request to ban a chat member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BanChatMemberRequest {
    pub chat_id: ChatId,
    pub user_id: i64,
    #[serde(default)]
    pub until_date: Option<i64>,
    #[serde(default)]
    pub revoke_messages: bool,
}

/// Request to restrict a chat member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictChatMemberRequest {
    pub chat_id: ChatId,
    pub user_id: i64,
    pub permissions: ChatPermissions,
    #[serde(default)]
    pub until_date: Option<i64>,
    #[serde(default)]
    pub use_independent_chat_permissions: bool,
}

/// Request to promote a chat member.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteChatMemberRequest {
    pub chat_id: ChatId,
    pub user_id: i64,
    #[serde(default)]
    pub is_anonymous: Option<bool>,
    #[serde(default)]
    pub can_manage_chat: Option<bool>,
    #[serde(default)]
    pub can_post_messages: Option<bool>,
    #[serde(default)]
    pub can_edit_messages: Option<bool>,
    #[serde(default)]
    pub can_delete_messages: Option<bool>,
    #[serde(default)]
    pub can_manage_video_chats: Option<bool>,
    #[serde(default)]
    pub can_restrict_members: Option<bool>,
    #[serde(default)]
    pub can_promote_members: Option<bool>,
    #[serde(default)]
    pub can_change_info: Option<bool>,
    #[serde(default)]
    pub can_invite_users: Option<bool>,
    #[serde(default)]
    pub can_pin_messages: Option<bool>,
    #[serde(default)]
    pub can_manage_topics: Option<bool>,
}

/// Chat invite link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatInviteLink {
    pub invite_link: String,
    pub creator: TgUser,
    pub creates_join_request: bool,
    pub is_primary: bool,
    pub is_revoked: bool,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub expire_date: Option<i64>,
    #[serde(default)]
    pub member_limit: Option<i64>,
    #[serde(default)]
    pub pending_join_request_count: Option<i64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Notifications & Monitoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Event type for connection notifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionEventType {
    Connected,
    Disconnected,
    ConnectionFailed,
    Reconnecting,
    AuthenticationFailed,
    SessionTimeout,
    FileTransferStarted,
    FileTransferCompleted,
    FileTransferFailed,
    CommandExecuted,
    ErrorOccurred,
    HighLatency,
    HighCpu,
    HighMemory,
    DiskSpaceLow,
    ServiceDown,
    Custom,
}

/// Severity level for notifications.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NotificationSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

/// A notification rule that triggers Telegram messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRule {
    /// Unique rule ID.
    pub id: String,
    /// Rule name.
    pub name: String,
    /// Whether the rule is active.
    pub enabled: bool,
    /// Bot config name to use.
    pub bot_name: String,
    /// Target chat ID for notifications.
    pub chat_id: ChatId,
    /// Event types that trigger this rule.
    pub event_types: Vec<ConnectionEventType>,
    /// Minimum severity to trigger.
    #[serde(default)]
    pub min_severity: Option<NotificationSeverity>,
    /// Optional host filter (glob pattern).
    #[serde(default)]
    pub host_filter: Option<String>,
    /// Optional connection type filter (SSH, RDP, VNC, etc.).
    #[serde(default)]
    pub protocol_filter: Option<Vec<String>>,
    /// Message template (supports {{variables}}).
    #[serde(default)]
    pub template: Option<String>,
    /// Parse mode for the message.
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    /// Throttle: minimum seconds between notifications for same event.
    #[serde(default)]
    pub throttle_seconds: Option<u64>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Last triggered timestamp.
    #[serde(default)]
    pub last_triggered: Option<DateTime<Utc>>,
    /// Total times triggered.
    #[serde(default)]
    pub trigger_count: u64,
}

/// A connection event to be processed by notification rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEvent {
    pub event_type: ConnectionEventType,
    pub severity: NotificationSeverity,
    pub host: String,
    pub protocol: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    pub message: String,
    #[serde(default)]
    pub details: Option<HashMap<String, String>>,
    pub timestamp: DateTime<Utc>,
}

/// Notification delivery result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationResult {
    pub rule_id: String,
    pub rule_name: String,
    pub success: bool,
    #[serde(default)]
    pub message_id: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Monitoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Monitoring check configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringCheck {
    /// Unique check ID.
    pub id: String,
    /// Check name.
    pub name: String,
    /// Whether the check is enabled.
    pub enabled: bool,
    /// Bot config name to use.
    pub bot_name: String,
    /// Target chat ID for alerts.
    pub chat_id: ChatId,
    /// Check type.
    pub check_type: MonitoringCheckType,
    /// Interval in seconds between checks.
    pub interval_seconds: u64,
    /// Alert threshold configuration.
    #[serde(default)]
    pub thresholds: Option<MonitoringThresholds>,
    /// Number of consecutive failures before alerting.
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: u32,
    /// Whether to send recovery notifications.
    #[serde(default = "default_true")]
    pub notify_on_recovery: bool,
    /// Parse mode for alert messages.
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    /// Custom alert template.
    #[serde(default)]
    pub alert_template: Option<String>,
    /// Recovery template.
    #[serde(default)]
    pub recovery_template: Option<String>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Current status.
    #[serde(default)]
    pub status: MonitoringStatus,
    /// Consecutive failures.
    #[serde(default)]
    pub consecutive_failures: u32,
    /// Last check timestamp.
    #[serde(default)]
    pub last_check: Option<DateTime<Utc>>,
    /// Last alert timestamp.
    #[serde(default)]
    pub last_alert: Option<DateTime<Utc>>,
}

fn default_failure_threshold() -> u32 {
    3
}

/// What to monitor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MonitoringCheckType {
    /// Ping a host.
    Ping,
    /// TCP port check.
    TcpPort,
    /// HTTP/HTTPS endpoint check.
    HttpEndpoint,
    /// SSH connection test.
    SshConnection,
    /// RDP connection test.
    RdpConnection,
    /// VNC connection test.
    VncConnection,
    /// Custom script execution.
    CustomScript,
}

/// Monitoring thresholds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringThresholds {
    /// Warning latency in ms.
    #[serde(default)]
    pub warning_latency_ms: Option<u64>,
    /// Critical latency in ms.
    #[serde(default)]
    pub critical_latency_ms: Option<u64>,
    /// Timeout in seconds.
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    /// Target host.
    #[serde(default)]
    pub host: Option<String>,
    /// Target port.
    #[serde(default)]
    pub port: Option<u16>,
    /// HTTP URL to check.
    #[serde(default)]
    pub url: Option<String>,
    /// Expected HTTP status codes.
    #[serde(default)]
    pub expected_status_codes: Option<Vec<u16>>,
    /// Expected response body substring.
    #[serde(default)]
    pub expected_body_contains: Option<String>,
}

/// Current monitoring status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MonitoringStatus {
    #[default]
    Unknown,
    Healthy,
    Warning,
    Critical,
    Down,
}

/// Result of a single monitoring check execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringCheckResult {
    pub check_id: String,
    pub check_name: String,
    pub status: MonitoringStatus,
    pub latency_ms: Option<u64>,
    pub success: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub details: Option<HashMap<String, String>>,
    pub timestamp: DateTime<Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Digest / Scheduled reports
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Scheduled digest report configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestConfig {
    /// Unique digest ID.
    pub id: String,
    /// Digest name.
    pub name: String,
    /// Whether enabled.
    pub enabled: bool,
    /// Bot config name.
    pub bot_name: String,
    /// Target chat ID.
    pub chat_id: ChatId,
    /// Cron-like schedule (simplified: "hourly", "daily", "weekly", "@HH:MM").
    pub schedule: String,
    /// What to include in the digest.
    pub include: DigestIncludes,
    /// Parse mode.
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    /// Custom template.
    #[serde(default)]
    pub template: Option<String>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Last sent timestamp.
    #[serde(default)]
    pub last_sent: Option<DateTime<Utc>>,
}

/// What to include in a digest report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestIncludes {
    #[serde(default = "default_true")]
    pub active_sessions: bool,
    #[serde(default = "default_true")]
    pub recent_connections: bool,
    #[serde(default = "default_true")]
    pub failed_connections: bool,
    #[serde(default = "default_true")]
    pub monitoring_status: bool,
    #[serde(default)]
    pub system_stats: bool,
    #[serde(default)]
    pub notification_summary: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A reusable message template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTemplate {
    /// Unique template ID.
    pub id: String,
    /// Template name.
    pub name: String,
    /// Template body (supports {{variable}} placeholders).
    pub body: String,
    /// Parse mode.
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    /// Default variables for this template.
    #[serde(default)]
    pub default_variables: HashMap<String, String>,
    /// Optional inline keyboard definition.
    #[serde(default)]
    pub reply_markup: Option<InlineKeyboardMarkup>,
    /// Description.
    #[serde(default)]
    pub description: Option<String>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    #[serde(default)]
    pub updated_at: Option<DateTime<Utc>>,
}

/// Request to render and send a template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTemplateRequest {
    pub bot_name: String,
    pub chat_id: ChatId,
    pub template_id: String,
    #[serde(default)]
    pub variables: HashMap<String, String>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub reply_to_message_id: Option<i64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Scheduled messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A scheduled message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledMessage {
    /// Unique ID.
    pub id: String,
    /// Bot config name.
    pub bot_name: String,
    /// Target chat.
    pub chat_id: ChatId,
    /// Message text.
    pub text: String,
    /// Parse mode.
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    /// Scheduled delivery time.
    pub scheduled_at: DateTime<Utc>,
    /// Whether it has been delivered.
    #[serde(default)]
    pub delivered: bool,
    /// Delivery timestamp (if delivered).
    #[serde(default)]
    pub delivered_at: Option<DateTime<Utc>>,
    /// Message ID (if delivered).
    #[serde(default)]
    pub message_id: Option<i64>,
    /// Error (if delivery failed).
    #[serde(default)]
    pub error: Option<String>,
    /// Reply markup.
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
    /// Disable web preview.
    #[serde(default)]
    pub disable_web_page_preview: bool,
    /// Disable notification sound.
    #[serde(default)]
    pub disable_notification: bool,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Message history / log
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Logged outgoing message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageLogEntry {
    pub id: String,
    pub bot_name: String,
    pub chat_id: String,
    pub text_preview: String,
    pub message_id: Option<i64>,
    pub success: bool,
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub source: MessageSource,
}

/// Source of a sent message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MessageSource {
    Manual,
    Notification,
    Monitoring,
    Digest,
    Scheduled,
    Template,
    Api,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Service statistics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Statistics for the Telegram integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramStats {
    pub configured_bots: usize,
    pub active_bots: usize,
    pub notification_rules: usize,
    pub active_rules: usize,
    pub monitoring_checks: usize,
    pub active_checks: usize,
    pub digest_configs: usize,
    pub templates: usize,
    pub scheduled_messages_pending: usize,
    pub total_messages_sent: u64,
    pub total_messages_failed: u64,
    pub total_notifications_sent: u64,
    pub total_alerts_sent: u64,
    pub message_log_size: usize,
    pub uptime_seconds: u64,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bulk operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Request to send a message to multiple chats.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastRequest {
    pub bot_name: String,
    pub chat_ids: Vec<ChatId>,
    pub text: String,
    #[serde(default)]
    pub parse_mode: Option<ParseMode>,
    #[serde(default)]
    pub disable_notification: bool,
    #[serde(default)]
    pub disable_web_page_preview: bool,
    #[serde(default)]
    pub reply_markup: Option<ReplyMarkup>,
}

/// Result of a broadcast operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastResult {
    pub total: usize,
    pub successful: usize,
    pub failed: usize,
    pub results: Vec<BroadcastItemResult>,
}

/// Individual result in a broadcast.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastItemResult {
    pub chat_id: String,
    pub success: bool,
    #[serde(default)]
    pub message_id: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bot info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Summary of a configured bot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotSummary {
    pub name: String,
    pub enabled: bool,
    pub bot_user: Option<TgUser>,
    pub connected: bool,
    pub api_base: String,
    pub messages_sent: u64,
    pub messages_failed: u64,
    pub last_activity: Option<DateTime<Utc>>,
}

/// Answer to a callback query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerCallbackQueryRequest {
    pub callback_query_id: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub show_alert: bool,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub cache_time: Option<i64>,
}
