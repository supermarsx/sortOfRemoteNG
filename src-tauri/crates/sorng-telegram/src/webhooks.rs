//! Webhooks & Updates — long polling and webhook configuration.

use crate::types::*;
use serde_json::json;

/// Build the JSON body for `getUpdates` (long polling).
pub fn build_get_updates(
    offset: Option<i64>,
    limit: Option<i64>,
    timeout: Option<i64>,
    allowed_updates: Option<&[String]>,
) -> serde_json::Value {
    let mut body = json!({});
    if let Some(o) = offset {
        body["offset"] = json!(o);
    }
    if let Some(l) = limit {
        body["limit"] = json!(l);
    }
    if let Some(t) = timeout {
        body["timeout"] = json!(t);
    }
    if let Some(au) = allowed_updates {
        body["allowed_updates"] = json!(au);
    }
    body
}

/// Build the JSON body for `setWebhook`.
pub fn build_set_webhook(config: &WebhookConfig) -> serde_json::Value {
    let mut body = json!({ "url": config.url });
    if let Some(mc) = config.max_connections {
        body["max_connections"] = json!(mc);
    }
    if let Some(ref au) = config.allowed_updates {
        body["allowed_updates"] = json!(au);
    }
    if let Some(ref st) = config.secret_token {
        body["secret_token"] = json!(st);
    }
    if config.drop_pending_updates {
        body["drop_pending_updates"] = json!(true);
    }
    body
}

/// Build the JSON body for `deleteWebhook`.
pub fn build_delete_webhook(drop_pending_updates: bool) -> serde_json::Value {
    json!({ "drop_pending_updates": drop_pending_updates })
}

/// Manage a long-polling update offset.
///
/// After processing updates, use this to compute the next offset.
pub fn next_offset(updates: &[TgUpdate]) -> Option<i64> {
    updates.iter().map(|u| u.update_id).max().map(|id| id + 1)
}

/// Filter updates to only include messages.
pub fn message_updates(updates: &[TgUpdate]) -> Vec<&TgMessage> {
    updates.iter().filter_map(|u| u.message.as_ref()).collect()
}

/// Filter updates to only include callback queries.
pub fn callback_query_updates(updates: &[TgUpdate]) -> Vec<&CallbackQuery> {
    updates
        .iter()
        .filter_map(|u| u.callback_query.as_ref())
        .collect()
}

/// Filter updates to only include edited messages.
pub fn edited_message_updates(updates: &[TgUpdate]) -> Vec<&TgMessage> {
    updates
        .iter()
        .filter_map(|u| u.edited_message.as_ref())
        .collect()
}

/// Filter updates to only include channel posts.
pub fn channel_post_updates(updates: &[TgUpdate]) -> Vec<&TgMessage> {
    updates
        .iter()
        .filter_map(|u| u.channel_post.as_ref())
        .collect()
}

/// Extract text commands (messages starting with `/`) from updates.
pub fn extract_commands(updates: &[TgUpdate]) -> Vec<(&TgMessage, String, Vec<String>)> {
    let mut cmds = Vec::new();
    for msg in message_updates(updates) {
        if let Some(ref text) = msg.text {
            let trimmed = text.trim();
            if trimmed.starts_with('/') {
                let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
                let command = parts[0]
                    .split('@')
                    .next()
                    .unwrap_or(parts[0])
                    .to_string();
                let args: Vec<String> = if parts.len() > 1 {
                    parts[1]
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect()
                } else {
                    Vec::new()
                };
                cmds.push((msg, command, args));
            }
        }
    }
    cmds
}

/// Validate a webhook secret token. 
/// Secret tokens must be 1–256 characters, containing A–Z, a–z, 0–9, _, -.
pub fn validate_secret_token(token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 256 {
        return Err("Secret token must be 1–256 characters".into());
    }
    if !token
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Secret token must only contain A-Z, a-z, 0-9, _, -".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_get_updates_empty() {
        let body = build_get_updates(None, None, None, None);
        assert_eq!(body, json!({}));
    }

    #[test]
    fn build_get_updates_with_params() {
        let body = build_get_updates(Some(100), Some(50), Some(30), None);
        assert_eq!(body["offset"], 100);
        assert_eq!(body["limit"], 50);
        assert_eq!(body["timeout"], 30);
    }

    #[test]
    fn build_get_updates_with_allowed() {
        let allowed = vec!["message".to_string(), "callback_query".to_string()];
        let body = build_get_updates(None, None, None, Some(&allowed));
        assert_eq!(body["allowed_updates"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn build_set_webhook_minimal() {
        let config = WebhookConfig {
            url: "https://example.com/webhook".to_string(),
            max_connections: None,
            allowed_updates: None,
            secret_token: None,
            drop_pending_updates: false,
        };
        let body = build_set_webhook(&config);
        assert_eq!(body["url"], "https://example.com/webhook");
        assert!(body.get("drop_pending_updates").is_none());
    }

    #[test]
    fn build_set_webhook_full() {
        let config = WebhookConfig {
            url: "https://example.com/webhook".to_string(),
            max_connections: Some(40),
            allowed_updates: Some(vec!["message".to_string()]),
            secret_token: Some("my-secret".to_string()),
            drop_pending_updates: true,
        };
        let body = build_set_webhook(&config);
        assert_eq!(body["max_connections"], 40);
        assert_eq!(body["secret_token"], "my-secret");
        assert_eq!(body["drop_pending_updates"], true);
    }

    #[test]
    fn build_delete_webhook_test() {
        let body = build_delete_webhook(true);
        assert_eq!(body["drop_pending_updates"], true);
    }

    #[test]
    fn next_offset_empty() {
        assert_eq!(next_offset(&[]), None);
    }

    #[test]
    fn next_offset_computes() {
        let updates = vec![
            make_update(10),
            make_update(12),
            make_update(11),
        ];
        assert_eq!(next_offset(&updates), Some(13));
    }

    #[test]
    fn message_updates_filter() {
        let updates = vec![
            make_update_with_message(1, "hello"),
            make_update(2), // no message
            make_update_with_message(3, "world"),
        ];
        let msgs = message_updates(&updates);
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn extract_commands_test() {
        let updates = vec![
            make_update_with_message(1, "/start"),
            make_update_with_message(2, "/help arg1 arg2"),
            make_update_with_message(3, "not a command"),
            make_update_with_message(4, "/status@mybot"),
        ];
        let cmds = extract_commands(&updates);
        assert_eq!(cmds.len(), 3);
        assert_eq!(cmds[0].1, "/start");
        assert!(cmds[0].2.is_empty());
        assert_eq!(cmds[1].1, "/help");
        assert_eq!(cmds[1].2, vec!["arg1", "arg2"]);
        assert_eq!(cmds[2].1, "/status");
    }

    #[test]
    fn validate_secret_token_valid() {
        assert!(validate_secret_token("abc-123_XYZ").is_ok());
    }

    #[test]
    fn validate_secret_token_empty() {
        assert!(validate_secret_token("").is_err());
    }

    #[test]
    fn validate_secret_token_too_long() {
        let long = "a".repeat(257);
        assert!(validate_secret_token(&long).is_err());
    }

    #[test]
    fn validate_secret_token_invalid_chars() {
        assert!(validate_secret_token("abc def").is_err());
        assert!(validate_secret_token("abc!").is_err());
    }

    // ------ helpers ------

    fn make_update(id: i64) -> TgUpdate {
        TgUpdate {
            update_id: id,
            message: None,
            edited_message: None,
            channel_post: None,
            edited_channel_post: None,
            callback_query: None,
            poll: None,
        }
    }

    fn make_update_with_message(id: i64, text: &str) -> TgUpdate {
        TgUpdate {
            update_id: id,
            message: Some(TgMessage {
                message_id: id,
                from: None,
                date: 0,
                chat: TgChat {
                    id: 1,
                    chat_type: ChatType::Private,
                    title: None,
                    username: None,
                    first_name: None,
                    last_name: None,
                    description: None,
                    invite_link: None,
                    pinned_message: None,
                    photo: None,
                },
                text: Some(text.to_string()),
                entities: None,
                caption: None,
                caption_entities: None,
                reply_to_message: None,
                photo: None,
                document: None,
                video: None,
                audio: None,
                voice: None,
                sticker: None,
                location: None,
                contact: None,
                poll: None,
                dice: None,
                reply_markup: None,
                forward_from: None,
                forward_date: None,
                edit_date: None,
                media_group_id: None,
            }),
            edited_message: None,
            channel_post: None,
            edited_channel_post: None,
            callback_query: None,
            poll: None,
        }
    }
}
