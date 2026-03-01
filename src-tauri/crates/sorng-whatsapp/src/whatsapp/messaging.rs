//! Send and manage WhatsApp messages via the Cloud API.
//!
//! Covers every message type: text, image, video, audio, document,
//! sticker, location, contacts, reactions, interactive (buttons / lists /
//! CTA / products / flows), and templates.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::types::*;
use log::{debug, info};
use serde_json::json;

/// Message sender backed by the Cloud API HTTP client.
pub struct WaMessaging {
    client: CloudApiClient,
}

impl WaMessaging {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    // ─── Core send helper ────────────────────────────────────────────

    /// Build the JSON envelope common to every outbound message and POST
    /// it to `/{phone_number_id}/messages`.
    async fn send_raw(
        &self,
        payload: serde_json::Value,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let url = self.client.phone_url("messages");
        let resp = self.client.post_json(&url, &payload).await?;

        let message_id = resp["messages"][0]["id"]
            .as_str()
            .unwrap_or_default()
            .to_string();

        Ok(WaSendMessageResponse {
            messaging_product: "whatsapp".into(),
            contacts: resp["contacts"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|c| {
                            Some(WaResponseContact {
                                input: c["input"].as_str()?.to_string(),
                                wa_id: c["wa_id"].as_str()?.to_string(),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            messages: vec![WaResponseMessage { id: message_id, message_status: None }],
        })
    }

    // ─── Text ────────────────────────────────────────────────────────

    /// Send a plain text message.
    pub async fn send_text(
        &self,
        to: &str,
        body: &str,
        preview_url: bool,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {
                "preview_url": preview_url,
                "body": body,
            }
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        debug!("Sending text to {}", to);
        self.send_raw(payload).await
    }

    // ─── Media messages ──────────────────────────────────────────────

    /// Send an image message (by media ID or link).
    pub async fn send_image(
        &self,
        to: &str,
        media_id: Option<&str>,
        link: Option<&str>,
        caption: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        self.send_media("image", to, media_id, link, caption, None, reply_to)
            .await
    }

    /// Send a video message.
    pub async fn send_video(
        &self,
        to: &str,
        media_id: Option<&str>,
        link: Option<&str>,
        caption: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        self.send_media("video", to, media_id, link, caption, None, reply_to)
            .await
    }

    /// Send an audio message.
    pub async fn send_audio(
        &self,
        to: &str,
        media_id: Option<&str>,
        link: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        self.send_media("audio", to, media_id, link, None, None, reply_to)
            .await
    }

    /// Send a document message.
    pub async fn send_document(
        &self,
        to: &str,
        media_id: Option<&str>,
        link: Option<&str>,
        caption: Option<&str>,
        filename: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        self.send_media("document", to, media_id, link, caption, filename, reply_to)
            .await
    }

    /// Send a sticker message.
    pub async fn send_sticker(
        &self,
        to: &str,
        media_id: Option<&str>,
        link: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        self.send_media("sticker", to, media_id, link, None, None, reply_to)
            .await
    }

    /// Generic media sender.
    async fn send_media(
        &self,
        kind: &str,
        to: &str,
        media_id: Option<&str>,
        link: Option<&str>,
        caption: Option<&str>,
        filename: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let mut media_obj = json!({});
        if let Some(id) = media_id {
            media_obj["id"] = json!(id);
        }
        if let Some(l) = link {
            media_obj["link"] = json!(l);
        }
        if let Some(c) = caption {
            media_obj["caption"] = json!(c);
        }
        if let Some(f) = filename {
            media_obj["filename"] = json!(f);
        }

        if media_obj.as_object().map_or(true, |o| o.is_empty()) {
            return Err(WhatsAppError::internal(
                "Either media_id or link is required".to_string(),
            ));
        }

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": kind,
            kind: media_obj,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        debug!("Sending {} to {}", kind, to);
        self.send_raw(payload).await
    }

    // ─── Location ────────────────────────────────────────────────────

    /// Send a location message.
    pub async fn send_location(
        &self,
        to: &str,
        latitude: f64,
        longitude: f64,
        name: Option<&str>,
        address: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let mut loc = json!({
            "latitude": latitude,
            "longitude": longitude,
        });
        if let Some(n) = name {
            loc["name"] = json!(n);
        }
        if let Some(a) = address {
            loc["address"] = json!(a);
        }

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "location",
            "location": loc,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        self.send_raw(payload).await
    }

    // ─── Contacts ────────────────────────────────────────────────────

    /// Send a contacts card.
    pub async fn send_contacts(
        &self,
        to: &str,
        contacts: &[WaContactCard],
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let contacts_json: Vec<serde_json::Value> = contacts
            .iter()
            .map(|c| serde_json::to_value(c).unwrap_or_default())
            .collect();

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "contacts",
            "contacts": contacts_json,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        self.send_raw(payload).await
    }

    // ─── Reactions ───────────────────────────────────────────────────

    /// React to a message with an emoji. Pass empty `emoji` to remove.
    pub async fn send_reaction(
        &self,
        to: &str,
        message_id: &str,
        emoji: &str,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "reaction",
            "reaction": {
                "message_id": message_id,
                "emoji": emoji,
            }
        });
        self.send_raw(payload).await
    }

    // ─── Interactive (buttons, lists, CTA, product, flow) ────────────

    /// Send an interactive message (buttons, list, CTA URL, product, flow).
    pub async fn send_interactive(
        &self,
        to: &str,
        interactive: &WaInteractivePayload,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let interactive_json = serde_json::to_value(interactive).map_err(|e| {
            WhatsAppError::internal(format!("Serialize interactive: {}", e))
        })?;

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive_json,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        self.send_raw(payload).await
    }

    /// Convenience: send reply buttons (up to 3).
    pub async fn send_buttons(
        &self,
        to: &str,
        body: &str,
        buttons: &[(String, String)], // (id, title)
        header: Option<&str>,
        footer: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let btn_arr: Vec<serde_json::Value> = buttons
            .iter()
            .take(3)
            .map(|(id, title)| {
                json!({
                    "type": "reply",
                    "reply": {
                        "id": id,
                        "title": title,
                    }
                })
            })
            .collect();

        let mut interactive = json!({
            "type": "button",
            "body": { "text": body },
            "action": { "buttons": btn_arr },
        });
        if let Some(h) = header {
            interactive["header"] = json!({ "type": "text", "text": h });
        }
        if let Some(f) = footer {
            interactive["footer"] = json!({ "text": f });
        }

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        self.send_raw(payload).await
    }

    /// Convenience: send a list message (up to 10 sections).
    pub async fn send_list(
        &self,
        to: &str,
        body: &str,
        button_text: &str,
        sections: &[WaListSection],
        header: Option<&str>,
        footer: Option<&str>,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let sections_json: Vec<serde_json::Value> = sections
            .iter()
            .map(|s| serde_json::to_value(s).unwrap_or_default())
            .collect();

        let mut interactive = json!({
            "type": "list",
            "body": { "text": body },
            "action": {
                "button": button_text,
                "sections": sections_json,
            },
        });
        if let Some(h) = header {
            interactive["header"] = json!({ "type": "text", "text": h });
        }
        if let Some(f) = footer {
            interactive["footer"] = json!({ "text": f });
        }

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        self.send_raw(payload).await
    }

    // ─── Template messages ───────────────────────────────────────────

    /// Send a pre-approved template message.
    pub async fn send_template(
        &self,
        to: &str,
        template: &WaTemplatePayload,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<WaSendMessageResponse> {
        let tmpl_json = serde_json::to_value(template).map_err(|e| {
            WhatsAppError::internal(format!("Serialize template: {}", e))
        })?;

        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": tmpl_json,
        });
        if let Some(mid) = reply_to {
            payload["context"] = json!({ "message_id": mid });
        }
        self.send_raw(payload).await
    }

    // ─── Read receipts ──────────────────────────────────────────────

    /// Mark a message as read (blue ticks).
    pub async fn mark_as_read(&self, message_id: &str) -> WhatsAppResult<()> {
        let url = self.client.phone_url("messages");
        let body = json!({
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        });
        self.client.post_json(&url, &body).await?;
        debug!("Marked {} as read", message_id);
        Ok(())
    }

    // ─── Typing indicator ────────────────────────────────────────────

    /// Send a typing indicator (available since v21.0 beta).
    pub async fn send_typing(
        &self,
        to: &str,
        duration_seconds: Option<u32>,
    ) -> WhatsAppResult<()> {
        let url = self.client.phone_url("messages");
        let mut body = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "typing",
        });
        if let Some(d) = duration_seconds {
            body["typing"] = json!({ "duration": d });
        }
        let _ = self.client.post_json(&url, &body).await;
        Ok(())
    }

    // ─── Bulk / broadcast ────────────────────────────────────────────

    /// Send a message to multiple recipients (sequential fan-out).
    ///
    /// Returns aggregated results; failures do not stop the batch.
    pub async fn send_bulk(
        &self,
        request: &WaBulkMessageRequest,
    ) -> WaBulkMessageResult {
        let mut entries = Vec::with_capacity(request.recipients.len());
        let mut succeeded = 0u32;
        let mut failed = 0u32;

        for recipient in &request.recipients {
            let payload_result = self.build_bulk_payload(&request.message, recipient);

            match payload_result {
                Ok(payload) => {
                    let res = self.send_raw(payload).await;
                    let success = res.is_ok();
                    if success {
                        succeeded += 1;
                    } else {
                        failed += 1;
                    }
                    entries.push(WaBulkSendEntry {
                        recipient: recipient.clone(),
                        success,
                        message_id: res.as_ref().ok().and_then(|r| {
                            r.messages.first().map(|m| m.id.clone())
                        }),
                        error: res.err().map(|e| e.message.clone()),
                    });
                }
                Err(e) => {
                    failed += 1;
                    entries.push(WaBulkSendEntry {
                        recipient: recipient.clone(),
                        success: false,
                        message_id: None,
                        error: Some(e.message),
                    });
                }
            }

            // Tiny delay between messages to avoid rate-limit bursts
            tokio::time::sleep(std::time::Duration::from_millis(request.delay_ms)).await;
        }

        let total = entries.len() as u32;
        info!("Bulk send complete: {}/{} succeeded", succeeded, total);
        WaBulkMessageResult {
            total,
            succeeded,
            failed,
            results: entries,
        }
    }

    /// Build the JSON payload from a `WaBulkMessageContent` for one recipient.
    fn build_bulk_payload(
        &self,
        msg: &WaBulkMessageContent,
        to: &str,
    ) -> WhatsAppResult<serde_json::Value> {
        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
        });

        match &msg.msg_type {
            WaMessageType::Text => {
                let text = msg.text.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("text payload required".to_string())
                })?;
                payload["type"] = json!("text");
                payload["text"] = serde_json::to_value(text).unwrap_or_default();
            }
            WaMessageType::Image => {
                let image = msg.image.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("image payload required".to_string())
                })?;
                payload["type"] = json!("image");
                payload["image"] = serde_json::to_value(image).unwrap_or_default();
            }
            WaMessageType::Document => {
                let doc = msg.document.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("document payload required".to_string())
                })?;
                payload["type"] = json!("document");
                payload["document"] = serde_json::to_value(doc).unwrap_or_default();
            }
            WaMessageType::Template => {
                let t = msg.template.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("template payload required".to_string())
                })?;
                payload["type"] = json!("template");
                payload["template"] = serde_json::to_value(t).unwrap_or_default();
            }
            _ => {
                return Err(WhatsAppError::internal(format!(
                    "Bulk send unsupported for message type {:?}",
                    msg.msg_type
                )));
            }
        }

        Ok(payload)
    }

    /// Build the JSON payload for a single `WaSendMessageRequest`.
    #[allow(dead_code)]
    fn build_send_payload(
        &self,
        msg: &WaSendMessageRequest,
        to: &str,
    ) -> WhatsAppResult<serde_json::Value> {
        let mut payload = json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
        });

        match &msg.msg_type {
            WaMessageType::Text => {
                let text = msg.text.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("text payload required".to_string())
                })?;
                payload["type"] = json!("text");
                payload["text"] = serde_json::to_value(text).unwrap_or_default();
            }
            WaMessageType::Image => {
                let media = msg.image.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("image payload required".to_string())
                })?;
                payload["type"] = json!("image");
                payload["image"] = serde_json::to_value(media).unwrap_or_default();
            }
            WaMessageType::Video => {
                let media = msg.video.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("video payload required".to_string())
                })?;
                payload["type"] = json!("video");
                payload["video"] = serde_json::to_value(media).unwrap_or_default();
            }
            WaMessageType::Audio => {
                let media = msg.audio.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("audio payload required".to_string())
                })?;
                payload["type"] = json!("audio");
                payload["audio"] = serde_json::to_value(media).unwrap_or_default();
            }
            WaMessageType::Sticker => {
                let media = msg.sticker.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("sticker payload required".to_string())
                })?;
                payload["type"] = json!("sticker");
                payload["sticker"] = serde_json::to_value(media).unwrap_or_default();
            }
            WaMessageType::Document => {
                let doc = msg.document.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("document payload required".to_string())
                })?;
                payload["type"] = json!("document");
                payload["document"] = serde_json::to_value(doc).unwrap_or_default();
            }
            WaMessageType::Location => {
                let loc = msg.location.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("location payload required".to_string())
                })?;
                payload["type"] = json!("location");
                payload["location"] = serde_json::to_value(loc).unwrap_or_default();
            }
            WaMessageType::Reaction => {
                let r = msg.reaction.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("reaction payload required".to_string())
                })?;
                payload["type"] = json!("reaction");
                payload["reaction"] = serde_json::to_value(r).unwrap_or_default();
            }
            WaMessageType::Contacts => {
                let c = msg.contacts.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("contacts payload required".to_string())
                })?;
                payload["type"] = json!("contacts");
                payload["contacts"] = serde_json::to_value(c).unwrap_or_default();
            }
            WaMessageType::Interactive => {
                let i = msg.interactive.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("interactive payload required".to_string())
                })?;
                payload["type"] = json!("interactive");
                payload["interactive"] = serde_json::to_value(i).unwrap_or_default();
            }
            WaMessageType::Template => {
                let t = msg.template.as_ref().ok_or_else(|| {
                    WhatsAppError::internal("template payload required".to_string())
                })?;
                payload["type"] = json!("template");
                payload["template"] = serde_json::to_value(t).unwrap_or_default();
            }
        }

        if let Some(ref ctx) = msg.context {
            payload["context"] = serde_json::to_value(ctx).unwrap_or_default();
        }

        Ok(payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_text_payload() {
        let cfg = WaConfig {
            access_token: "tok".into(),
            phone_number_id: "123".into(),
            business_account_id: "456".into(),
            api_version: "v21.0".into(),
            base_url: "https://graph.facebook.com".into(),
            webhook_verify_token: None,
            app_secret: None,
            timeout_sec: 30,
            max_retries: 3,
        };
        let client = CloudApiClient::new(&cfg).unwrap();
        let m = WaMessaging::new(client);

        let msg = WaSendMessageRequest::text("1234567890", "Hello!");
        let payload = m
            .build_send_payload(&msg, "1234567890")
            .unwrap();

        assert_eq!(payload["type"], "text");
        assert_eq!(payload["to"], "1234567890");
    }
}
