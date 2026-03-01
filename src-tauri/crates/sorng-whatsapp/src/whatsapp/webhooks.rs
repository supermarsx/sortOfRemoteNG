//! Incoming webhook handling for WhatsApp Cloud API.
//!
//! Handles:
//! - Webhook verification challenge (`GET /webhook`)
//! - Incoming message and status update parsing (`POST /webhook`)
//! - Signature validation using the app secret
//! - Event normalization into internal types

use crate::whatsapp::auth::WaAuthManager;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::types::*;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};

/// Parsed webhook event — either an incoming message or a status update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WaWebhookEvent {
    IncomingMessage(WaIncomingMessageEvent),
    StatusUpdate(WaStatusUpdateEvent),
    Error(WaWebhookErrorEvent),
    Unknown(serde_json::Value),
}

/// Normalized incoming message from a webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaIncomingMessageEvent {
    pub from: String,
    pub message_id: String,
    pub timestamp: String,
    pub message_type: String,
    pub text: Option<String>,
    pub media_id: Option<String>,
    pub media_mime: Option<String>,
    pub caption: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub location_name: Option<String>,
    pub contact_cards: Option<Vec<serde_json::Value>>,
    pub interactive_type: Option<String>,
    pub interactive_reply_id: Option<String>,
    pub interactive_reply_title: Option<String>,
    pub button_text: Option<String>,
    pub button_payload: Option<String>,
    pub reaction_emoji: Option<String>,
    pub reaction_message_id: Option<String>,
    pub context_message_id: Option<String>,
    pub context_from: Option<String>,
    pub forwarded: bool,
    pub frequently_forwarded: bool,
    pub phone_number_id: String,
    pub display_phone_number: Option<String>,
    pub profile_name: Option<String>,
    pub raw: serde_json::Value,
}

/// Delivery / read status update from a webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaStatusUpdateEvent {
    pub message_id: String,
    pub status: WaMessageStatus,
    pub timestamp: String,
    pub recipient_id: String,
    pub phone_number_id: String,
    pub errors: Vec<String>,
}

/// Error reported via webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaWebhookErrorEvent {
    pub code: u32,
    pub title: String,
    pub message: String,
    pub phone_number_id: String,
}

/// Webhook processor.
pub struct WaWebhooks {
    verify_token: Option<String>,
    app_secret: Option<String>,
}

impl WaWebhooks {
    pub fn new(verify_token: Option<String>, app_secret: Option<String>) -> Self {
        Self {
            verify_token,
            app_secret,
        }
    }

    // ─── Verification challenge ─────────────────────────────────────

    /// Handle the GET verification challenge.
    ///
    /// Returns the `hub.challenge` value if the token matches.
    pub fn verify_challenge(
        &self,
        mode: &str,
        token: &str,
        challenge: &str,
    ) -> WhatsAppResult<String> {
        if mode != "subscribe" {
            return Err(WhatsAppError::internal(
                "Invalid webhook mode (expected 'subscribe')",
            ));
        }

        let expected = self.verify_token.as_deref().unwrap_or("");
        if token != expected {
            return Err(WhatsAppError {
                code: crate::whatsapp::error::WhatsAppErrorCode::WebhookVerificationFailed,
                message: "Verify token mismatch".into(),
                details: None,
                http_status: Some(403),
            });
        }

        info!("Webhook verification challenge accepted");
        Ok(challenge.to_string())
    }

    // ─── Signature validation ────────────────────────────────────────

    /// Validate the `x-hub-signature-256` header.
    pub fn validate_signature(
        &self,
        signature_header: &str,
        raw_body: &[u8],
    ) -> bool {
        match &self.app_secret {
            Some(secret) => {
                WaAuthManager::verify_webhook_signature(secret, signature_header, raw_body)
            }
            None => {
                warn!("No app_secret configured — skipping signature check");
                true
            }
        }
    }

    // ─── Payload parsing ─────────────────────────────────────────────

    /// Parse a raw webhook POST body into structured events.
    ///
    /// A single webhook payload can contain multiple entries/changes
    /// (though Meta usually sends one at a time).
    pub fn parse_payload(
        &self,
        raw_body: &str,
    ) -> WhatsAppResult<Vec<WaWebhookEvent>> {
        let payload: serde_json::Value = serde_json::from_str(raw_body)
            .map_err(|e| WhatsAppError::internal(format!("Webhook JSON parse: {}", e)))?;

        // Verify it's a WhatsApp webhook
        let object = payload["object"].as_str().unwrap_or("");
        if object != "whatsapp_business_account" {
            return Err(WhatsAppError::internal(format!(
                "Unexpected webhook object: {}",
                object
            )));
        }

        let mut events = Vec::new();

        let entries = payload["entry"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        for entry in entries {
            let changes = entry["changes"]
                .as_array()
                .cloned()
                .unwrap_or_default();

            for change in changes {
                let field = change["field"].as_str().unwrap_or("");
                let value = &change["value"];

                if field != "messages" {
                    events.push(WaWebhookEvent::Unknown(change.clone()));
                    continue;
                }

                let phone_number_id = value["metadata"]["phone_number_id"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                let display_phone = value["metadata"]["display_phone_number"]
                    .as_str()
                    .map(String::from);

                // Parse errors
                if let Some(errors) = value["errors"].as_array() {
                    for err in errors {
                        events.push(WaWebhookEvent::Error(WaWebhookErrorEvent {
                            code: err["code"].as_u64().unwrap_or(0) as u32,
                            title: err["title"].as_str().unwrap_or("").to_string(),
                            message: err["message"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            phone_number_id: phone_number_id.clone(),
                        }));
                    }
                }

                // Parse status updates
                if let Some(statuses) = value["statuses"].as_array() {
                    for status in statuses {
                        let s = match status["status"].as_str() {
                            Some("sent") => WaMessageStatus::Sent,
                            Some("delivered") => WaMessageStatus::Delivered,
                            Some("read") => WaMessageStatus::Read,
                            Some("failed") => WaMessageStatus::Failed,
                            _ => WaMessageStatus::Sent,
                        };

                        let error_msgs: Vec<String> = status["errors"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|e| e["message"].as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default();

                        events.push(WaWebhookEvent::StatusUpdate(WaStatusUpdateEvent {
                            message_id: status["id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            status: s,
                            timestamp: status["timestamp"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            recipient_id: status["recipient_id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            phone_number_id: phone_number_id.clone(),
                            errors: error_msgs,
                        }));
                    }
                }

                // Parse incoming messages
                if let Some(messages) = value["messages"].as_array() {
                    let contacts_arr = value["contacts"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();

                    for msg in messages {
                        let from = msg["from"].as_str().unwrap_or_default().to_string();
                        let msg_type =
                            msg["type"].as_str().unwrap_or("unknown").to_string();

                        // Find matching contact profile name
                        let profile_name = contacts_arr.iter().find_map(|c| {
                            if c["wa_id"].as_str() == Some(&from) {
                                c["profile"]["name"].as_str().map(String::from)
                            } else {
                                None
                            }
                        });

                        let evt = WaIncomingMessageEvent {
                            from: from.clone(),
                            message_id: msg["id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            timestamp: msg["timestamp"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            message_type: msg_type.clone(),
                            text: msg["text"]["body"].as_str().map(String::from),
                            media_id: msg[&msg_type]["id"].as_str().map(String::from),
                            media_mime: msg[&msg_type]["mime_type"]
                                .as_str()
                                .map(String::from),
                            caption: msg[&msg_type]["caption"]
                                .as_str()
                                .map(String::from),
                            latitude: msg["location"]["latitude"].as_f64(),
                            longitude: msg["location"]["longitude"].as_f64(),
                            location_name: msg["location"]["name"]
                                .as_str()
                                .map(String::from),
                            contact_cards: msg["contacts"]
                                .as_array()
                                .cloned(),
                            interactive_type: msg["interactive"]["type"]
                                .as_str()
                                .map(String::from),
                            interactive_reply_id: msg["interactive"]["button_reply"]["id"]
                                .as_str()
                                .or_else(|| msg["interactive"]["list_reply"]["id"].as_str())
                                .map(String::from),
                            interactive_reply_title: msg["interactive"]["button_reply"]["title"]
                                .as_str()
                                .or_else(|| msg["interactive"]["list_reply"]["title"].as_str())
                                .map(String::from),
                            button_text: msg["button"]["text"]
                                .as_str()
                                .map(String::from),
                            button_payload: msg["button"]["payload"]
                                .as_str()
                                .map(String::from),
                            reaction_emoji: msg["reaction"]["emoji"]
                                .as_str()
                                .map(String::from),
                            reaction_message_id: msg["reaction"]["message_id"]
                                .as_str()
                                .map(String::from),
                            context_message_id: msg["context"]["id"]
                                .as_str()
                                .map(String::from),
                            context_from: msg["context"]["from"]
                                .as_str()
                                .map(String::from),
                            forwarded: msg["context"]["forwarded"]
                                .as_bool()
                                .unwrap_or(false),
                            frequently_forwarded: msg["context"]["frequently_forwarded"]
                                .as_bool()
                                .unwrap_or(false),
                            phone_number_id: phone_number_id.clone(),
                            display_phone_number: display_phone.clone(),
                            profile_name,
                            raw: msg.clone(),
                        };

                        events.push(WaWebhookEvent::IncomingMessage(evt));
                    }
                }
            }
        }

        debug!("Parsed {} webhook events", events.len());
        Ok(events)
    }

    /// Convenience: parse and validate a webhook request.
    pub fn process_webhook(
        &self,
        signature: Option<&str>,
        raw_body: &str,
    ) -> WhatsAppResult<Vec<WaWebhookEvent>> {
        // Validate signature if present
        if let Some(sig) = signature {
            if !self.validate_signature(sig, raw_body.as_bytes()) {
                return Err(WhatsAppError {
                    code: crate::whatsapp::error::WhatsAppErrorCode::InvalidSignature,
                    message: "Invalid webhook signature".into(),
                    details: None,
                    http_status: Some(401),
                });
            }
        }

        self.parse_payload(raw_body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_webhooks() -> WaWebhooks {
        WaWebhooks::new(Some("my_verify_token".into()), Some("app_secret".into()))
    }

    #[test]
    fn test_verify_challenge_ok() {
        let wh = make_webhooks();
        let result = wh.verify_challenge("subscribe", "my_verify_token", "challenge_123");
        assert_eq!(result.unwrap(), "challenge_123");
    }

    #[test]
    fn test_verify_challenge_bad_token() {
        let wh = make_webhooks();
        let result = wh.verify_challenge("subscribe", "wrong_token", "c");
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_challenge_bad_mode() {
        let wh = make_webhooks();
        let result = wh.verify_challenge("unsubscribe", "my_verify_token", "c");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_text_message_webhook() {
        let wh = make_webhooks();
        let body = serde_json::json!({
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "biz_id",
                "changes": [{
                    "field": "messages",
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {
                            "display_phone_number": "+1234567890",
                            "phone_number_id": "phone_id_1"
                        },
                        "contacts": [{"profile": {"name": "John"}, "wa_id": "15551234567"}],
                        "messages": [{
                            "from": "15551234567",
                            "id": "wamid.msg123",
                            "timestamp": "1700000000",
                            "type": "text",
                            "text": {"body": "Hello there!"}
                        }]
                    }
                }]
            }]
        });

        let events = wh.parse_payload(&body.to_string()).unwrap();
        assert_eq!(events.len(), 1);

        if let WaWebhookEvent::IncomingMessage(evt) = &events[0] {
            assert_eq!(evt.from, "15551234567");
            assert_eq!(evt.text.as_deref(), Some("Hello there!"));
            assert_eq!(evt.profile_name.as_deref(), Some("John"));
            assert_eq!(evt.message_type, "text");
        } else {
            panic!("Expected IncomingMessage");
        }
    }

    #[test]
    fn test_parse_status_update_webhook() {
        let wh = make_webhooks();
        let body = serde_json::json!({
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "biz_id",
                "changes": [{
                    "field": "messages",
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {
                            "display_phone_number": "+1234567890",
                            "phone_number_id": "phone_id_1"
                        },
                        "statuses": [{
                            "id": "wamid.msg456",
                            "status": "delivered",
                            "timestamp": "1700000001",
                            "recipient_id": "15559876543"
                        }]
                    }
                }]
            }]
        });

        let events = wh.parse_payload(&body.to_string()).unwrap();
        assert_eq!(events.len(), 1);

        if let WaWebhookEvent::StatusUpdate(evt) = &events[0] {
            assert_eq!(evt.message_id, "wamid.msg456");
            assert_eq!(evt.status, WaMessageStatus::Delivered);
        } else {
            panic!("Expected StatusUpdate");
        }
    }
}
