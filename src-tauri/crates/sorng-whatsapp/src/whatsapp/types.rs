//! Shared types for the WhatsApp Business Cloud API integration.
//!
//! Models cover configuration, sessions, the full Cloud API message payload
//! taxonomy, media objects, templates, contacts, business profiles, webhooks,
//! groups, interactive flows, and analytics.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
//  Configuration & Session
// ═══════════════════════════════════════════════════════════════════════

/// API configuration for connecting to the WhatsApp Cloud API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaConfig {
    /// Meta Graph API access token (long-lived or system-user token).
    pub access_token: String,
    /// Phone Number ID (the sending phone number registered in WhatsApp Business).
    pub phone_number_id: String,
    /// WhatsApp Business Account ID.
    pub business_account_id: String,
    /// Graph API version (e.g. "v21.0").
    #[serde(default = "default_api_version")]
    pub api_version: String,
    /// Base URL override (default: `https://graph.facebook.com`).
    #[serde(default = "default_base_url")]
    pub base_url: String,
    /// Webhook verify token (for incoming webhook verification).
    #[serde(default)]
    pub webhook_verify_token: Option<String>,
    /// App secret for webhook signature verification.
    #[serde(default)]
    pub app_secret: Option<String>,
    /// Timeout in seconds for API calls.
    #[serde(default = "default_timeout")]
    pub timeout_sec: u32,
    /// Maximum retries for transient failures.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
}

fn default_api_version() -> String {
    "v21.0".to_string()
}
fn default_base_url() -> String {
    "https://graph.facebook.com".to_string()
}
fn default_timeout() -> u32 {
    30
}
fn default_max_retries() -> u32 {
    3
}

/// State of a WhatsApp session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WaSessionState {
    Active,
    TokenExpired,
    Disconnected,
    Error,
}

/// A managed WhatsApp session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaSession {
    pub id: String,
    pub phone_number_id: String,
    pub business_account_id: String,
    pub phone_display: Option<String>,
    pub state: WaSessionState,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub messages_sent: u64,
    pub messages_received: u64,
}

/// Session summary for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaSessionSummary {
    pub session_id: String,
    pub phone_number_id: String,
    pub phone_display: Option<String>,
    pub state: String,
    pub messages_sent: u64,
    pub messages_received: u64,
}

// ═══════════════════════════════════════════════════════════════════════
//  Message Envelope (outgoing)
// ═══════════════════════════════════════════════════════════════════════

/// Top-level outgoing message request (maps to POST /{phone_number_id}/messages).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaSendMessageRequest {
    pub messaging_product: String,
    pub recipient_type: String,
    pub to: String,
    #[serde(rename = "type")]
    pub msg_type: WaMessageType,
    // Exactly one of the following payloads is set:
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<WaTextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<WaDocumentPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sticker: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<WaLocationPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contacts: Option<Vec<WaContactCard>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reaction: Option<WaReactionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactive: Option<WaInteractivePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<WaTemplatePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<WaMessageContext>,
}

impl Default for WaSendMessageRequest {
    fn default() -> Self {
        Self {
            messaging_product: "whatsapp".to_string(),
            recipient_type: "individual".to_string(),
            to: String::new(),
            msg_type: WaMessageType::Text,
            text: None,
            image: None,
            video: None,
            audio: None,
            document: None,
            sticker: None,
            location: None,
            contacts: None,
            reaction: None,
            interactive: None,
            template: None,
            context: None,
        }
    }
}

/// Message types supported by the Cloud API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WaMessageType {
    Text,
    Image,
    Video,
    Audio,
    Document,
    Sticker,
    Location,
    Contacts,
    Reaction,
    Interactive,
    Template,
}

// ═══════════════════════════════════════════════════════════════════════
//  Message Payloads
// ═══════════════════════════════════════════════════════════════════════

/// Text message body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTextPayload {
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_url: Option<bool>,
}

/// Media reference (image, video, audio, sticker).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaMediaPayload {
    /// Media ID (previously uploaded).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Public URL to the media (mutually exclusive with `id`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    /// Caption (images, videos, documents only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    /// MIME type hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Document-specific payload (adds `filename`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaDocumentPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

/// Geo-location payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaLocationPayload {
    pub latitude: f64,
    pub longitude: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
}

/// Reaction payload (emoji react to a message).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaReactionPayload {
    pub message_id: String,
    pub emoji: String,
}

/// Context for replying to or quoting a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaMessageContext {
    pub message_id: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  Contact Card (vCard)
// ═══════════════════════════════════════════════════════════════════════

/// A contact to share via WhatsApp.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactCard {
    pub name: WaContactName,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub phones: Vec<WaContactPhone>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub emails: Vec<WaContactEmail>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub urls: Vec<WaContactUrl>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub addresses: Vec<WaContactAddress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org: Option<WaContactOrg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birthday: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactName {
    pub formatted_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub middle_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactPhone {
    pub phone: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub phone_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wa_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactEmail {
    pub email: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub email_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactUrl {
    pub url: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub url_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactAddress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub street: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub address_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaContactOrg {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub department: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Interactive Messages
// ═══════════════════════════════════════════════════════════════════════

/// Interactive message payload (buttons, lists, CTA URL, product, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaInteractivePayload {
    #[serde(rename = "type")]
    pub interactive_type: WaInteractiveType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<WaInteractiveHeader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<WaInteractiveBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer: Option<WaInteractiveFooter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<WaInteractiveAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WaInteractiveType {
    Button,
    List,
    Product,
    ProductList,
    CatalogMessage,
    CtaUrl,
    Flow,
    LocationRequestMessage,
    AddressMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaInteractiveHeader {
    #[serde(rename = "type")]
    pub header_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<WaDocumentPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaInteractiveBody {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaInteractiveFooter {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaInteractiveAction {
    /// For button type
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buttons: Vec<WaInteractiveButton>,
    /// For list type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sections: Vec<WaListSection>,
    /// For CTA URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<WaCtaUrlParameters>,
    /// For product / product_list
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_retailer_id: Option<String>,
    /// For flow
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_cta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_action_payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaInteractiveButton {
    #[serde(rename = "type")]
    pub button_type: String,
    pub reply: WaButtonReply,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaButtonReply {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaListSection {
    pub title: String,
    pub rows: Vec<WaListRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaListRow {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaCtaUrlParameters {
    pub display_text: String,
    pub url: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  Templates
// ═══════════════════════════════════════════════════════════════════════

/// Template message payload for sending pre-approved templates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplatePayload {
    pub name: String,
    pub language: WaTemplateLanguage,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub components: Vec<WaTemplateComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateLanguage {
    pub code: String,
}

/// Component in a template send (header, body, button variables).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateComponent {
    #[serde(rename = "type")]
    pub component_type: WaTemplateComponentType,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parameters: Vec<WaTemplateParameter>,
    /// For button components: 0-indexed button index.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WaTemplateComponentType {
    Header,
    Body,
    Button,
}

/// Parameter for a template component.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateParameter {
    #[serde(rename = "type")]
    pub param_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<WaTemplateCurrency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_time: Option<WaTemplateDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<WaDocumentPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateCurrency {
    pub fallback_value: String,
    pub code: String,
    pub amount_1000: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateDateTime {
    pub fallback_value: String,
}

// ── Template Management (CRUD) ───────────────────────────────────────

/// Template definition returned by the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateInfo {
    pub id: String,
    pub name: String,
    pub language: String,
    pub status: WaTemplateStatus,
    pub category: WaTemplateCategory,
    #[serde(default)]
    pub components: Vec<WaTemplateComponentDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rejected_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_score: Option<WaQualityScore>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WaTemplateStatus {
    Approved,
    Pending,
    Rejected,
    Disabled,
    Paused,
    PendingDeletion,
    Deleted,
    InAppeal,
    LimitExceeded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WaTemplateCategory {
    Utility,
    Marketing,
    Authentication,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateComponentDef {
    #[serde(rename = "type")]
    pub component_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buttons: Vec<WaTemplateButtonDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaTemplateButtonDef {
    #[serde(rename = "type")]
    pub button_type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub example: Option<Vec<String>>,
}

/// Request to create a new message template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaCreateTemplateRequest {
    pub name: String,
    pub language: String,
    pub category: WaTemplateCategory,
    pub components: Vec<WaTemplateComponentDef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_category_change: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaQualityScore {
    pub score: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<i64>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Media
// ═══════════════════════════════════════════════════════════════════════

/// Uploaded media metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaMediaInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messaging_product: Option<String>,
}

/// Result of uploading media.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaMediaUploadResult {
    pub id: String,
}

/// Supported media types with their constraints.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WaSupportedMediaType {
    ImageJpeg,
    ImagePng,
    ImageWebp,
    VideoMp4,
    Video3gpp,
    AudioAac,
    AudioMp4,
    AudioMpeg,
    AudioAmr,
    AudioOgg,
    DocumentPdf,
    DocumentDoc,
    DocumentDocx,
    DocumentXls,
    DocumentXlsx,
    DocumentPpt,
    DocumentPptx,
    DocumentTxt,
    StickerWebp,
}

impl WaSupportedMediaType {
    /// MIME type string.
    pub fn mime_type(&self) -> &'static str {
        match self {
            Self::ImageJpeg => "image/jpeg",
            Self::ImagePng => "image/png",
            Self::ImageWebp => "image/webp",
            Self::VideoMp4 => "video/mp4",
            Self::Video3gpp => "video/3gpp",
            Self::AudioAac => "audio/aac",
            Self::AudioMp4 => "audio/mp4",
            Self::AudioMpeg => "audio/mpeg",
            Self::AudioAmr => "audio/amr",
            Self::AudioOgg => "audio/ogg",
            Self::DocumentPdf => "application/pdf",
            Self::DocumentDoc => "application/msword",
            Self::DocumentDocx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::DocumentXls => "application/vnd.ms-excel",
            Self::DocumentXlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Self::DocumentPpt => "application/vnd.ms-powerpoint",
            Self::DocumentPptx => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            Self::DocumentTxt => "text/plain",
            Self::StickerWebp => "image/webp",
        }
    }

    /// Maximum size in bytes.
    pub fn max_size_bytes(&self) -> u64 {
        match self {
            Self::ImageJpeg | Self::ImagePng | Self::ImageWebp => 5 * 1024 * 1024,
            Self::VideoMp4 | Self::Video3gpp => 16 * 1024 * 1024,
            Self::AudioAac | Self::AudioMp4 | Self::AudioMpeg
            | Self::AudioAmr | Self::AudioOgg => 16 * 1024 * 1024,
            Self::DocumentPdf | Self::DocumentDoc | Self::DocumentDocx
            | Self::DocumentXls | Self::DocumentXlsx | Self::DocumentPpt
            | Self::DocumentPptx | Self::DocumentTxt => 100 * 1024 * 1024,
            Self::StickerWebp => 500 * 1024,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Message Responses
// ═══════════════════════════════════════════════════════════════════════

/// Response from sending a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaSendMessageResponse {
    pub messaging_product: String,
    pub contacts: Vec<WaResponseContact>,
    pub messages: Vec<WaResponseMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaResponseContact {
    pub input: String,
    pub wa_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaResponseMessage {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Webhook / Incoming Messages
// ═══════════════════════════════════════════════════════════════════════

/// Top-level incoming webhook payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookPayload {
    pub object: String,
    pub entry: Vec<WaWebhookEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookEntry {
    pub id: String,
    pub changes: Vec<WaWebhookChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookChange {
    pub field: String,
    pub value: WaWebhookValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookValue {
    pub messaging_product: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WaWebhookMetadata>,
    #[serde(default)]
    pub contacts: Vec<WaWebhookContact>,
    #[serde(default)]
    pub messages: Vec<WaIncomingMessage>,
    #[serde(default)]
    pub statuses: Vec<WaMessageStatusUpdate>,
    #[serde(default)]
    pub errors: Vec<WaWebhookError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookMetadata {
    pub display_phone_number: String,
    pub phone_number_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookContact {
    pub wa_id: String,
    pub profile: WaWebhookProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookProfile {
    pub name: String,
}

/// An incoming WhatsApp message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaIncomingMessage {
    pub from: String,
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<WaTextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<WaIncomingMedia>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video: Option<WaIncomingMedia>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<WaIncomingMedia>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<WaIncomingMedia>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sticker: Option<WaIncomingMedia>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<WaLocationPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contacts: Option<Vec<WaContactCard>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactive: Option<WaIncomingInteractiveReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button: Option<WaIncomingButtonReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reaction: Option<WaReactionPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<WaIncomingContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral: Option<WaReferral>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<WaWebhookError>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaIncomingMedia {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaIncomingInteractiveReply {
    #[serde(rename = "type")]
    pub reply_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button_reply: Option<WaButtonReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_reply: Option<WaListReply>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaListReply {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaIncomingButtonReply {
    pub payload: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaIncomingContext {
    pub from: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forwarded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequently_forwarded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referred_product: Option<WaReferredProduct>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaReferredProduct {
    pub catalog_id: String,
    pub product_retailer_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaReferral {
    pub source_url: Option<String>,
    pub source_type: Option<String>,
    pub source_id: Option<String>,
    pub headline: Option<String>,
    pub body: Option<String>,
    pub media_type: Option<String>,
    pub image_url: Option<String>,
    pub video_url: Option<String>,
    pub thumbnail_url: Option<String>,
}

/// Message status change from webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaMessageStatusUpdate {
    pub id: String,
    pub status: WaMessageStatus,
    pub timestamp: String,
    pub recipient_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<WaConversation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pricing: Option<WaPricing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<WaWebhookError>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WaMessageStatus {
    Sent,
    Delivered,
    Read,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaConversation {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<WaConversationOrigin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration_timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaConversationOrigin {
    #[serde(rename = "type")]
    pub origin_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaPricing {
    pub billable: bool,
    pub pricing_model: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaWebhookError {
    pub code: u32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_data: Option<WaErrorData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaErrorData {
    pub details: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  Business Profile
// ═══════════════════════════════════════════════════════════════════════

/// WhatsApp Business Profile information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaBusinessProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messaging_product: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_picture_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub websites: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Phone Numbers
// ═══════════════════════════════════════════════════════════════════════

/// Phone number information from the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaPhoneNumber {
    pub id: String,
    pub display_phone_number: String,
    pub verified_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality_rating: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_verification_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messaging_limit_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_official_business_account: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Groups
// ═══════════════════════════════════════════════════════════════════════

/// Group information (from the Groups API).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaGroupInfo {
    pub id: String,
    pub subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub creation: u64,
    #[serde(default)]
    pub participants: Vec<WaGroupParticipant>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invite_link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaGroupParticipant {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin: Option<String>,
}

/// Request to create a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaCreateGroupRequest {
    pub subject: String,
    pub participants: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Flows
// ═══════════════════════════════════════════════════════════════════════

/// WhatsApp Flow definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaFlow {
    pub id: String,
    pub name: String,
    pub status: WaFlowStatus,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_errors: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_api_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<WaFlowPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WaFlowStatus {
    Draft,
    Published,
    Deprecated,
    Blocked,
    Throttled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaFlowPreview {
    pub preview_url: String,
    pub expires_at: String,
}

/// Request to create a new Flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaCreateFlowRequest {
    pub name: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clone_flow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint_uri: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Analytics
// ═══════════════════════════════════════════════════════════════════════

/// Analytics data point.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaAnalyticsDataPoint {
    pub start: String,
    pub end: String,
    pub sent: u64,
    pub delivered: u64,
    pub read: u64,
    #[serde(default)]
    pub data_points: Vec<WaConversationAnalytics>,
}

/// Conversation analytics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaConversationAnalytics {
    pub start: String,
    pub end: String,
    pub conversation: u64,
    pub cost: f64,
}

// ═══════════════════════════════════════════════════════════════════════
//  Internal – Chat History Model
// ═══════════════════════════════════════════════════════════════════════

/// A message in the local chat history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaChatMessage {
    pub id: String,
    pub session_id: String,
    pub direction: WaMessageDirection,
    pub contact_wa_id: String,
    pub contact_name: Option<String>,
    pub msg_type: String,
    pub body: Option<String>,
    pub media_id: Option<String>,
    pub media_url: Option<String>,
    pub media_mime_type: Option<String>,
    pub media_caption: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub template_name: Option<String>,
    pub status: WaLocalMessageStatus,
    pub timestamp: DateTime<Utc>,
    pub wa_message_id: Option<String>,
    pub reply_to_id: Option<String>,
    pub reaction_emoji: Option<String>,
    /// Full raw payload for advanced inspection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WaMessageDirection {
    Outgoing,
    Incoming,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WaLocalMessageStatus {
    Pending,
    Sent,
    Delivered,
    Read,
    Failed,
}

/// Conversation thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaConversationThread {
    pub contact_wa_id: String,
    pub contact_name: Option<String>,
    pub last_message: Option<WaChatMessage>,
    pub unread_count: u32,
    pub updated_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Bulk Messaging
// ═══════════════════════════════════════════════════════════════════════

/// A batch of messages to send.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaBulkMessageRequest {
    /// List of recipient phone numbers (E.164 format).
    pub recipients: Vec<String>,
    /// The message content (applied to each recipient).
    pub message: WaBulkMessageContent,
    /// Delay between sends in milliseconds (rate limiting protection).
    #[serde(default = "default_bulk_delay")]
    pub delay_ms: u64,
}

fn default_bulk_delay() -> u64 {
    100
}

/// Content for a bulk message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaBulkMessageContent {
    pub msg_type: WaMessageType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<WaTextPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<WaTemplatePayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<WaMediaPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<WaDocumentPayload>,
}

/// Result of a bulk send.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaBulkMessageResult {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub results: Vec<WaBulkSendEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaBulkSendEntry {
    pub recipient: String,
    pub success: bool,
    pub message_id: Option<String>,
    pub error: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Two-Step Verification
// ═══════════════════════════════════════════════════════════════════════

/// Parameters for enabling two-step verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaTwoStepVerification {
    pub pin: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  Generic API pagination
// ═══════════════════════════════════════════════════════════════════════

/// Paginated list response (used for templates, phone numbers, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaPaginatedResponse<T> {
    pub data: Vec<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paging: Option<WaPaging>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaPaging {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursors: Option<WaCursors>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WaCursors {
    pub before: String,
    pub after: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  Tauri Events
// ═══════════════════════════════════════════════════════════════════════

/// Events emitted to the Tauri frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WaEvent {
    MessageReceived {
        session_id: String,
        message: WaChatMessage,
    },
    MessageStatusChanged {
        session_id: String,
        message_id: String,
        status: WaMessageStatus,
        timestamp: DateTime<Utc>,
    },
    SessionStateChanged {
        session_id: String,
        state: WaSessionState,
        timestamp: DateTime<Utc>,
    },
    Error {
        session_id: Option<String>,
        message: String,
        timestamp: DateTime<Utc>,
    },
}

// ═══════════════════════════════════════════════════════════════════════
//  Helpers / builders
// ═══════════════════════════════════════════════════════════════════════

impl WaSendMessageRequest {
    /// Build a simple text message.
    pub fn text(to: &str, body: &str) -> Self {
        Self {
            to: to.to_string(),
            msg_type: WaMessageType::Text,
            text: Some(WaTextPayload {
                body: body.to_string(),
                preview_url: None,
            }),
            ..Default::default()
        }
    }

    /// Build an image message by media ID.
    pub fn image(to: &str, media_id: &str, caption: Option<&str>) -> Self {
        Self {
            to: to.to_string(),
            msg_type: WaMessageType::Image,
            image: Some(WaMediaPayload {
                id: Some(media_id.to_string()),
                link: None,
                caption: caption.map(|s| s.to_string()),
                mime_type: None,
            }),
            ..Default::default()
        }
    }

    /// Build a document message by media ID.
    pub fn document(to: &str, media_id: &str, filename: Option<&str>, caption: Option<&str>) -> Self {
        Self {
            to: to.to_string(),
            msg_type: WaMessageType::Document,
            document: Some(WaDocumentPayload {
                id: Some(media_id.to_string()),
                link: None,
                caption: caption.map(|s| s.to_string()),
                filename: filename.map(|s| s.to_string()),
            }),
            ..Default::default()
        }
    }

    /// Build a location message.
    pub fn location(to: &str, lat: f64, lon: f64, name: Option<&str>, address: Option<&str>) -> Self {
        Self {
            to: to.to_string(),
            msg_type: WaMessageType::Location,
            location: Some(WaLocationPayload {
                latitude: lat,
                longitude: lon,
                name: name.map(|s| s.to_string()),
                address: address.map(|s| s.to_string()),
            }),
            ..Default::default()
        }
    }

    /// Build a reaction to message.
    pub fn reaction(to: &str, message_id: &str, emoji: &str) -> Self {
        Self {
            to: to.to_string(),
            msg_type: WaMessageType::Reaction,
            reaction: Some(WaReactionPayload {
                message_id: message_id.to_string(),
                emoji: emoji.to_string(),
            }),
            ..Default::default()
        }
    }

    /// Build a template message.
    pub fn template(to: &str, template_name: &str, language_code: &str) -> Self {
        Self {
            to: to.to_string(),
            msg_type: WaMessageType::Template,
            template: Some(WaTemplatePayload {
                name: template_name.to_string(),
                language: WaTemplateLanguage {
                    code: language_code.to_string(),
                },
                components: Vec::new(),
            }),
            ..Default::default()
        }
    }

    /// Add reply context (quote).
    pub fn with_reply(mut self, reply_to_message_id: &str) -> Self {
        self.context = Some(WaMessageContext {
            message_id: reply_to_message_id.to_string(),
        });
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_values() {
        let json = r#"{"accessToken":"tok","phoneNumberId":"123","businessAccountId":"456"}"#;
        let config: WaConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.api_version, "v21.0");
        assert_eq!(config.base_url, "https://graph.facebook.com");
        assert_eq!(config.timeout_sec, 30);
        assert_eq!(config.max_retries, 3);
    }

    #[test]
    fn test_send_message_builder_text() {
        let msg = WaSendMessageRequest::text("+1234567890", "Hello");
        assert_eq!(msg.messaging_product, "whatsapp");
        assert_eq!(msg.to, "+1234567890");
        assert_eq!(msg.msg_type, WaMessageType::Text);
        assert_eq!(msg.text.unwrap().body, "Hello");
    }

    #[test]
    fn test_send_message_builder_image() {
        let msg = WaSendMessageRequest::image("+1111", "media_123", Some("Look!"));
        assert_eq!(msg.msg_type, WaMessageType::Image);
        let img = msg.image.unwrap();
        assert_eq!(img.id.unwrap(), "media_123");
        assert_eq!(img.caption.unwrap(), "Look!");
    }

    #[test]
    fn test_send_message_builder_reaction() {
        let msg = WaSendMessageRequest::reaction("+1111", "wamid.123", "👍");
        assert_eq!(msg.msg_type, WaMessageType::Reaction);
        let r = msg.reaction.unwrap();
        assert_eq!(r.message_id, "wamid.123");
        assert_eq!(r.emoji, "👍");
    }

    #[test]
    fn test_send_message_builder_template() {
        let msg = WaSendMessageRequest::template("+1111", "hello_world", "en_US");
        assert_eq!(msg.msg_type, WaMessageType::Template);
        let t = msg.template.unwrap();
        assert_eq!(t.name, "hello_world");
        assert_eq!(t.language.code, "en_US");
    }

    #[test]
    fn test_with_reply_context() {
        let msg = WaSendMessageRequest::text("+1111", "reply").with_reply("wamid.original");
        assert_eq!(msg.context.unwrap().message_id, "wamid.original");
    }

    #[test]
    fn test_media_type_constraints() {
        assert_eq!(WaSupportedMediaType::ImageJpeg.mime_type(), "image/jpeg");
        assert_eq!(WaSupportedMediaType::ImageJpeg.max_size_bytes(), 5 * 1024 * 1024);
        assert_eq!(WaSupportedMediaType::VideoMp4.max_size_bytes(), 16 * 1024 * 1024);
        assert_eq!(WaSupportedMediaType::DocumentPdf.max_size_bytes(), 100 * 1024 * 1024);
        assert_eq!(WaSupportedMediaType::StickerWebp.max_size_bytes(), 500 * 1024);
    }

    #[test]
    fn test_message_status_serde() {
        let json = r#""sent""#;
        let status: WaMessageStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status, WaMessageStatus::Sent);
    }

    #[test]
    fn test_template_status_serde() {
        let json = r#""APPROVED""#;
        let status: WaTemplateStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status, WaTemplateStatus::Approved);
    }

    #[test]
    fn test_location_builder() {
        let msg = WaSendMessageRequest::location("+1111", 37.7749, -122.4194, Some("SF"), None);
        let loc = msg.location.unwrap();
        assert!((loc.latitude - 37.7749).abs() < f64::EPSILON);
        assert_eq!(loc.name.unwrap(), "SF");
    }

    #[test]
    fn test_webhook_payload_deserialize() {
        let json = r#"{
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "123",
                "changes": [{
                    "field": "messages",
                    "value": {
                        "messaging_product": "whatsapp",
                        "contacts": [],
                        "messages": [],
                        "statuses": [],
                        "errors": []
                    }
                }]
            }]
        }"#;

        let payload: WaWebhookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.object, "whatsapp_business_account");
        assert_eq!(payload.entry.len(), 1);
        assert_eq!(payload.entry[0].changes[0].field, "messages");
    }

    #[test]
    fn test_interactive_types() {
        let json = r#""list""#;
        let t: WaInteractiveType = serde_json::from_str(json).unwrap();
        assert_eq!(t, WaInteractiveType::List);

        let json = r#""button""#;
        let t: WaInteractiveType = serde_json::from_str(json).unwrap();
        assert_eq!(t, WaInteractiveType::Button);
    }
}
