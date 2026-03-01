//! Tauri command handlers for WhatsApp integration.
//!
//! Every command follows the `wa_*` naming convention and accepts
//! `State<'_, WhatsAppServiceState>`.  All return `Result<T, String>`
//! so errors are serialisable across the Tauri IPC bridge.

use crate::whatsapp::pairing::{PairingState, QrCodeData};
use crate::whatsapp::service::WhatsAppServiceState;
use crate::whatsapp::types::*;
use crate::whatsapp::unofficial::UnofficialConnectionState;
use tauri::State;

// Helper to map WhatsAppError → String for Tauri.
macro_rules! map_err {
    ($expr:expr) => {
        $expr.map_err(|e| e.to_string())
    };
}

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

/// Configure the Cloud API credentials.
#[tauri::command]
pub async fn wa_configure(
    state: State<'_, WhatsAppServiceState>,
    config: WaConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    map_err!(svc.configure_cloud_api(config))
}

/// Configure the unofficial WA Web client.
#[tauri::command]
pub async fn wa_configure_unofficial(
    state: State<'_, WhatsAppServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.configure_unofficial(None);
    Ok(())
}

/// Check if Cloud API is configured.
#[tauri::command]
pub async fn wa_is_configured(
    state: State<'_, WhatsAppServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_cloud_configured())
}

// ═══════════════════════════════════════════════════════════════════════
//  Messaging (Official)
// ═══════════════════════════════════════════════════════════════════════

/// Send a text message via Cloud API.
#[tauri::command]
pub async fn wa_send_text(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    body: String,
    preview_url: Option<bool>,
    reply_to: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(
        messaging
            .send_text(&to, &body, preview_url.unwrap_or(false), reply_to.as_deref())
            .await
    )
}

/// Send an image message.
#[tauri::command]
pub async fn wa_send_image(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    media_id: Option<String>,
    link: Option<String>,
    caption: Option<String>,
    reply_to: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(
        messaging
            .send_image(
                &to,
                media_id.as_deref(),
                link.as_deref(),
                caption.as_deref(),
                reply_to.as_deref(),
            )
            .await
    )
}

/// Send a document message.
#[tauri::command]
pub async fn wa_send_document(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    media_id: Option<String>,
    link: Option<String>,
    caption: Option<String>,
    filename: Option<String>,
    reply_to: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(
        messaging
            .send_document(
                &to,
                media_id.as_deref(),
                link.as_deref(),
                caption.as_deref(),
                filename.as_deref(),
                reply_to.as_deref(),
            )
            .await
    )
}

/// Send a video message.
#[tauri::command]
pub async fn wa_send_video(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    media_id: Option<String>,
    link: Option<String>,
    caption: Option<String>,
    reply_to: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(
        messaging
            .send_video(
                &to,
                media_id.as_deref(),
                link.as_deref(),
                caption.as_deref(),
                reply_to.as_deref(),
            )
            .await
    )
}

/// Send an audio message.
#[tauri::command]
pub async fn wa_send_audio(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    media_id: Option<String>,
    link: Option<String>,
    reply_to: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(
        messaging
            .send_audio(&to, media_id.as_deref(), link.as_deref(), reply_to.as_deref())
            .await
    )
}

/// Send a location message.
#[tauri::command]
pub async fn wa_send_location(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    latitude: f64,
    longitude: f64,
    name: Option<String>,
    address: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(
        messaging
            .send_location(&to, latitude, longitude, name.as_deref(), address.as_deref(), None)
            .await
    )
}

/// Send a reaction.
#[tauri::command]
pub async fn wa_send_reaction(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    message_id: String,
    emoji: String,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(messaging.send_reaction(&to, &message_id, &emoji).await)
}

/// Send a template message.
#[tauri::command]
pub async fn wa_send_template(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    template: WaTemplatePayload,
    reply_to: Option<String>,
) -> Result<WaSendMessageResponse, String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(messaging.send_template(&to, &template, reply_to.as_deref()).await)
}

/// Mark a message as read.
#[tauri::command]
pub async fn wa_mark_as_read(
    state: State<'_, WhatsAppServiceState>,
    message_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let messaging = map_err!(svc.messaging())?;
    map_err!(messaging.mark_as_read(&message_id).await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Media
// ═══════════════════════════════════════════════════════════════════════

/// Upload media from base64-encoded bytes.
#[tauri::command]
pub async fn wa_upload_media(
    state: State<'_, WhatsAppServiceState>,
    data_base64: String,
    mime_type: String,
    filename: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    let media = map_err!(svc.media())?;

    let data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &data_base64,
    )
    .map_err(|e| format!("Base64 decode error: {}", e))?;

    let result = map_err!(media.upload(data, &mime_type, filename.as_deref()).await)?;
    Ok(result.id)
}

/// Upload media from a file path.
#[tauri::command]
pub async fn wa_upload_media_file(
    state: State<'_, WhatsAppServiceState>,
    file_path: String,
    mime_type: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    let media = map_err!(svc.media())?;
    let result = map_err!(media.upload_from_file(&file_path, &mime_type).await)?;
    Ok(result.id)
}

/// Get the download URL for a media ID.
#[tauri::command]
pub async fn wa_get_media_url(
    state: State<'_, WhatsAppServiceState>,
    media_id: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    let media = map_err!(svc.media())?;
    let details = map_err!(media.get_url(&media_id).await)?;
    Ok(details.url)
}

/// Download media and return base64-encoded bytes.
#[tauri::command]
pub async fn wa_download_media(
    state: State<'_, WhatsAppServiceState>,
    media_id: String,
) -> Result<(String, String), String> {
    let svc = state.lock().await;
    let media = map_err!(svc.media())?;
    let (bytes, mime) = map_err!(media.download(&media_id).await)?;
    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &bytes,
    );
    Ok((b64, mime))
}

/// Delete a media asset.
#[tauri::command]
pub async fn wa_delete_media(
    state: State<'_, WhatsAppServiceState>,
    media_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let media = map_err!(svc.media())?;
    map_err!(media.delete(&media_id).await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Templates
// ═══════════════════════════════════════════════════════════════════════

/// Create a message template.
#[tauri::command]
pub async fn wa_create_template(
    state: State<'_, WhatsAppServiceState>,
    request: WaCreateTemplateRequest,
) -> Result<WaTemplateInfo, String> {
    let svc = state.lock().await;
    let templates = map_err!(svc.templates())?;
    map_err!(templates.create(&request).await)
}

/// List message templates (paginated).
#[tauri::command]
pub async fn wa_list_templates(
    state: State<'_, WhatsAppServiceState>,
    limit: Option<u32>,
    after: Option<String>,
) -> Result<WaPaginatedResponse<WaTemplateInfo>, String> {
    let svc = state.lock().await;
    let templates = map_err!(svc.templates())?;
    map_err!(templates.list(limit, after.as_deref()).await)
}

/// Delete a template by name.
#[tauri::command]
pub async fn wa_delete_template(
    state: State<'_, WhatsAppServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let templates = map_err!(svc.templates())?;
    map_err!(templates.delete(&name).await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Contacts
// ═══════════════════════════════════════════════════════════════════════

/// Check if a phone number is on WhatsApp.
#[tauri::command]
pub async fn wa_check_contact(
    state: State<'_, WhatsAppServiceState>,
    phone_number: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    let contacts = map_err!(svc.contacts())?;
    map_err!(contacts.is_on_whatsapp(&phone_number).await)
}

/// Generate a wa.me link.
#[tauri::command]
pub async fn wa_me_link(
    phone_number: String,
    message: Option<String>,
) -> Result<String, String> {
    Ok(crate::whatsapp::contacts::WaContacts::wa_me_link(
        &phone_number,
        message.as_deref(),
    ))
}

// ═══════════════════════════════════════════════════════════════════════
//  Groups
// ═══════════════════════════════════════════════════════════════════════

/// Create a WhatsApp group.
#[tauri::command]
pub async fn wa_create_group(
    state: State<'_, WhatsAppServiceState>,
    subject: String,
    participants: Vec<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    let groups = map_err!(svc.groups())?;
    let req = WaCreateGroupRequest {
        subject,
        participants,
        description: None,
    };
    let result = map_err!(groups.create_group(&req).await)?;
    Ok(result.group_id)
}

/// Get group info.
#[tauri::command]
pub async fn wa_get_group_info(
    state: State<'_, WhatsAppServiceState>,
    group_id: String,
) -> Result<WaGroupInfo, String> {
    let svc = state.lock().await;
    let groups = map_err!(svc.groups())?;
    map_err!(groups.get_group_info(&group_id).await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Business Profile
// ═══════════════════════════════════════════════════════════════════════

/// Get the business profile.
#[tauri::command]
pub async fn wa_get_business_profile(
    state: State<'_, WhatsAppServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    let bp = map_err!(svc.business_profile())?;
    let profile = map_err!(bp.get().await)?;
    serde_json::to_value(profile).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Phone Numbers
// ═══════════════════════════════════════════════════════════════════════

/// List phone numbers for the WABA.
#[tauri::command]
pub async fn wa_list_phone_numbers(
    state: State<'_, WhatsAppServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    let pn = map_err!(svc.phone_numbers())?;
    let numbers = map_err!(pn.list().await)?;
    serde_json::to_value(numbers).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Webhooks
// ═══════════════════════════════════════════════════════════════════════

/// Handle webhook verification challenge.
#[tauri::command]
pub async fn wa_webhook_verify(
    state: State<'_, WhatsAppServiceState>,
    mode: String,
    token: String,
    challenge: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    let webhooks = map_err!(svc.webhooks())?;
    map_err!(webhooks.verify_challenge(&mode, &token, &challenge))
}

/// Process an incoming webhook payload.
#[tauri::command]
pub async fn wa_webhook_process(
    state: State<'_, WhatsAppServiceState>,
    signature: Option<String>,
    raw_body: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    let webhooks = map_err!(svc.webhooks())?;
    let events =
        map_err!(webhooks.process_webhook(signature.as_deref(), &raw_body))?;
    serde_json::to_value(events).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Sessions
// ═══════════════════════════════════════════════════════════════════════

/// List all active WhatsApp sessions.
#[tauri::command]
pub async fn wa_list_sessions(
    state: State<'_, WhatsAppServiceState>,
) -> Result<Vec<WaSessionSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

// ═══════════════════════════════════════════════════════════════════════
//  Unofficial (WA Web) commands
// ═══════════════════════════════════════════════════════════════════════

/// Connect to WhatsApp Web (unofficial).
#[tauri::command]
pub async fn wa_unofficial_connect(
    state: State<'_, WhatsAppServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let client = map_err!(svc.unofficial())?;
    map_err!(client.connect().await)
}

/// Disconnect from WhatsApp Web.
#[tauri::command]
pub async fn wa_unofficial_disconnect(
    state: State<'_, WhatsAppServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let client = map_err!(svc.unofficial())?;
    map_err!(client.disconnect().await)
}

/// Get unofficial client connection state.
#[tauri::command]
pub async fn wa_unofficial_state(
    state: State<'_, WhatsAppServiceState>,
) -> Result<UnofficialConnectionState, String> {
    let svc = state.lock().await;
    let client = map_err!(svc.unofficial())?;
    Ok(client.connection_state().await)
}

/// Send a text message via unofficial WA Web.
#[tauri::command]
pub async fn wa_unofficial_send_text(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    text: String,
    reply_to: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    let client = map_err!(svc.unofficial())?;
    let jid = crate::whatsapp::unofficial::UnofficialClient::phone_to_jid(&to);
    map_err!(client.send_text(&jid, &text, reply_to.as_deref()).await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Pairing commands
// ═══════════════════════════════════════════════════════════════════════

/// Start QR code pairing.
#[tauri::command]
pub async fn wa_pairing_start_qr(
    state: State<'_, WhatsAppServiceState>,
) -> Result<QrCodeData, String> {
    let svc = state.lock().await;
    let pairing = map_err!(svc.pairing())?;
    map_err!(pairing.start_qr_pairing().await)
}

/// Refresh the pairing QR code.
#[tauri::command]
pub async fn wa_pairing_refresh_qr(
    state: State<'_, WhatsAppServiceState>,
) -> Result<Option<QrCodeData>, String> {
    let svc = state.lock().await;
    let pairing = map_err!(svc.pairing())?;
    map_err!(pairing.refresh_qr().await)
}

/// Start phone number pairing.
#[tauri::command]
pub async fn wa_pairing_start_phone(
    state: State<'_, WhatsAppServiceState>,
    phone_number: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    let pairing = map_err!(svc.pairing())?;
    map_err!(pairing.start_phone_pairing(&phone_number).await)
}

/// Get current pairing state.
#[tauri::command]
pub async fn wa_pairing_state(
    state: State<'_, WhatsAppServiceState>,
) -> Result<PairingState, String> {
    let svc = state.lock().await;
    let pairing = map_err!(svc.pairing())?;
    Ok(pairing.state().await)
}

/// Cancel pairing.
#[tauri::command]
pub async fn wa_pairing_cancel(
    state: State<'_, WhatsAppServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let pairing = map_err!(svc.pairing())?;
    pairing.cancel().await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Chat history
// ═══════════════════════════════════════════════════════════════════════

/// Get messages for a conversation thread.
#[tauri::command]
pub async fn wa_get_messages(
    state: State<'_, WhatsAppServiceState>,
    thread_id: String,
) -> Result<Vec<WaChatMessage>, String> {
    let svc = state.lock().await;
    Ok(svc.get_messages(&thread_id).await)
}

/// Send text via the best available channel.
#[tauri::command]
pub async fn wa_send_auto(
    state: State<'_, WhatsAppServiceState>,
    to: String,
    text: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    map_err!(svc.send_text_auto(&to, &text).await)
}
