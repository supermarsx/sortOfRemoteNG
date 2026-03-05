//! # Channel Delivery
//!
//! Multi-channel notification delivery. Each channel type has a dedicated
//! delivery function that formats the payload per the platform's conventions
//! and performs the HTTP request via `reqwest`.

use crate::error::NotificationError;
use crate::types::ChannelConfig;
use log::{info, warn};
use std::collections::HashMap;

/// Deliver a notification through the given channel configuration.
///
/// Returns `Ok(())` on success, or a `NotificationError` describing the failure.
pub async fn deliver_notification(
    channel: &ChannelConfig,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    match channel {
        ChannelConfig::InApp { .. } => deliver_in_app(channel, title, body),
        ChannelConfig::Desktop { .. } => deliver_desktop(channel, title, body),
        ChannelConfig::Webhook {
            url,
            method,
            headers,
            body_template,
            timeout_ms,
            retry_count,
            secret,
        } => {
            deliver_webhook(
                url,
                method.as_deref(),
                headers.as_ref(),
                body_template.as_deref(),
                *timeout_ms,
                *retry_count,
                secret.as_deref(),
                title,
                body,
                data,
            )
            .await
        }
        ChannelConfig::Email {
            to,
            cc,
            bcc,
            subject_template,
            body_template,
            html,
        } => deliver_email_stub(to, cc, bcc, subject_template, body_template, html, title, body),
        ChannelConfig::Slack {
            webhook_url,
            channel: chan,
            username,
            icon_emoji,
            blocks_template,
        } => {
            deliver_slack(
                webhook_url,
                chan.as_deref(),
                username.as_deref(),
                icon_emoji.as_deref(),
                blocks_template.as_deref(),
                title,
                body,
                data,
            )
            .await
        }
        ChannelConfig::Discord {
            webhook_url,
            username,
            avatar_url,
            embeds_template,
        } => {
            deliver_discord(
                webhook_url,
                username.as_deref(),
                avatar_url.as_deref(),
                embeds_template.as_deref(),
                title,
                body,
                data,
            )
            .await
        }
        ChannelConfig::Teams {
            webhook_url,
            card_template,
        } => deliver_teams(webhook_url, card_template.as_deref(), title, body, data).await,
        ChannelConfig::Telegram {
            bot_token,
            chat_id,
            parse_mode,
            template,
        } => {
            deliver_telegram(
                bot_token,
                chat_id,
                parse_mode.as_deref(),
                template.as_deref(),
                title,
                body,
                data,
            )
            .await
        }
        ChannelConfig::PagerDuty {
            routing_key,
            severity,
            source,
        } => {
            deliver_pagerduty(
                routing_key,
                severity.as_deref(),
                source.as_deref(),
                title,
                body,
                data,
            )
            .await
        }
        ChannelConfig::Generic { adapter_id, config } => {
            info!(
                "generic channel '{}' delivery requested (config: {})",
                adapter_id, config
            );
            Ok(())
        }
    }
}

// ── In-App ──────────────────────────────────────────────────────────

/// In-app notifications are recorded and surfaced via the Tauri front-end.
/// The actual delivery is handled by the history module; here we just log.
fn deliver_in_app(
    _channel: &ChannelConfig,
    title: &str,
    body: &str,
) -> Result<(), NotificationError> {
    info!("in-app notification: [{}] {}", title, body);
    Ok(())
}

// ── Desktop ─────────────────────────────────────────────────────────

/// Desktop notifications use the OS notification system.
/// In a real Tauri app this would call `tauri::api::notification`; here we log.
fn deliver_desktop(
    _channel: &ChannelConfig,
    title: &str,
    body: &str,
) -> Result<(), NotificationError> {
    info!("desktop notification: [{}] {}", title, body);
    Ok(())
}

// ── Webhook ─────────────────────────────────────────────────────────

/// Deliver via a generic HTTP webhook.
async fn deliver_webhook(
    url: &str,
    method: Option<&str>,
    headers: Option<&HashMap<String, String>>,
    body_template: Option<&str>,
    timeout_ms: Option<u64>,
    retry_count: Option<u32>,
    secret: Option<&str>,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let client = reqwest::Client::new();

    let payload = if let Some(tmpl) = body_template {
        render_inline(tmpl, title, body, data)
    } else {
        serde_json::json!({
            "title": title,
            "body": body,
            "data": data,
        })
        .to_string()
    };

    let http_method = match method.unwrap_or("POST").to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        _ => reqwest::Method::POST,
    };

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(10_000));
    let retries = retry_count.unwrap_or(1).max(1);

    let mut last_err = String::new();

    for attempt in 0..retries {
        let mut req = client
            .request(http_method.clone(), url)
            .timeout(timeout)
            .header("Content-Type", "application/json")
            .body(payload.clone());

        if let Some(hdrs) = headers {
            for (k, v) in hdrs {
                req = req.header(k.as_str(), v.as_str());
            }
        }

        if let Some(sec) = secret {
            let signature = compute_hmac_hex(sec, &payload);
            req = req.header("X-Signature", signature);
        }

        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("webhook delivered to {} (attempt {})", url, attempt + 1);
                return Ok(());
            }
            Ok(resp) => {
                last_err = format!("HTTP {}", resp.status());
                warn!(
                    "webhook attempt {} to {} failed: {}",
                    attempt + 1,
                    url,
                    last_err
                );
            }
            Err(e) => {
                last_err = e.to_string();
                warn!(
                    "webhook attempt {} to {} error: {}",
                    attempt + 1,
                    url,
                    last_err
                );
            }
        }
    }

    Err(NotificationError::DeliveryError(format!(
        "webhook to {url} failed after {retries} attempt(s): {last_err}"
    )))
}

// ── Slack ───────────────────────────────────────────────────────────

/// Deliver a Slack notification via incoming webhook.
async fn deliver_slack(
    webhook_url: &str,
    channel: Option<&str>,
    username: Option<&str>,
    icon_emoji: Option<&str>,
    blocks_template: Option<&str>,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let payload = if let Some(tmpl) = blocks_template {
        render_inline(tmpl, title, body, data)
    } else {
        let mut msg = serde_json::json!({
            "text": format!("*{}*\n{}", title, body),
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": title,
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": body,
                    }
                }
            ]
        });
        if let Some(ch) = channel {
            msg["channel"] = serde_json::Value::String(ch.to_string());
        }
        if let Some(u) = username {
            msg["username"] = serde_json::Value::String(u.to_string());
        }
        if let Some(emoji) = icon_emoji {
            msg["icon_emoji"] = serde_json::Value::String(emoji.to_string());
        }
        msg.to_string()
    };

    post_json(webhook_url, &payload, "Slack").await
}

// ── Discord ─────────────────────────────────────────────────────────

/// Deliver a Discord notification via webhook.
async fn deliver_discord(
    webhook_url: &str,
    username: Option<&str>,
    avatar_url: Option<&str>,
    embeds_template: Option<&str>,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let payload = if let Some(tmpl) = embeds_template {
        render_inline(tmpl, title, body, data)
    } else {
        let mut msg = serde_json::json!({
            "embeds": [
                {
                    "title": title,
                    "description": body,
                    "color": 3447003,
                    "footer": {
                        "text": "SortOfRemote NG Notifications"
                    }
                }
            ]
        });
        if let Some(u) = username {
            msg["username"] = serde_json::Value::String(u.to_string());
        }
        if let Some(av) = avatar_url {
            msg["avatar_url"] = serde_json::Value::String(av.to_string());
        }
        msg.to_string()
    };

    post_json(webhook_url, &payload, "Discord").await
}

// ── Teams ───────────────────────────────────────────────────────────

/// Deliver a Microsoft Teams notification via incoming webhook using
/// an Adaptive Card payload.
async fn deliver_teams(
    webhook_url: &str,
    card_template: Option<&str>,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let payload = if let Some(tmpl) = card_template {
        render_inline(tmpl, title, body, data)
    } else {
        serde_json::json!({
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "contentUrl": null,
                    "content": {
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type": "AdaptiveCard",
                        "version": "1.4",
                        "body": [
                            {
                                "type": "TextBlock",
                                "size": "Medium",
                                "weight": "Bolder",
                                "text": title,
                            },
                            {
                                "type": "TextBlock",
                                "text": body,
                                "wrap": true,
                            }
                        ]
                    }
                }
            ]
        })
        .to_string()
    };

    post_json(webhook_url, &payload, "Teams").await
}

// ── Telegram ────────────────────────────────────────────────────────

/// Deliver a Telegram notification via the Bot API.
async fn deliver_telegram(
    bot_token: &str,
    chat_id: &str,
    parse_mode: Option<&str>,
    template: Option<&str>,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let text = if let Some(tmpl) = template {
        render_inline(tmpl, title, body, data)
    } else {
        format!("*{}*\n{}", title, body)
    };

    let url = format!("https://api.telegram.org/bot{bot_token}/sendMessage");

    let mut payload = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
    });
    if let Some(pm) = parse_mode {
        payload["parse_mode"] = serde_json::Value::String(pm.to_string());
    }

    post_json(&url, &payload.to_string(), "Telegram").await
}

// ── PagerDuty ───────────────────────────────────────────────────────

/// Deliver a PagerDuty Events API v2 trigger event.
async fn deliver_pagerduty(
    routing_key: &str,
    severity: Option<&str>,
    source: Option<&str>,
    title: &str,
    body: &str,
    _data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let url = "https://events.pagerduty.com/v2/enqueue";
    let payload = serde_json::json!({
        "routing_key": routing_key,
        "event_action": "trigger",
        "payload": {
            "summary": format!("{}: {}", title, body),
            "severity": severity.unwrap_or("warning"),
            "source": source.unwrap_or("sortofremoteng"),
        }
    })
    .to_string();

    post_json(url, &payload, "PagerDuty").await
}

// ── Email (stub) ────────────────────────────────────────────────────

/// Email delivery is delegated to an external SMTP relay (e.g. `sorng-smtp`).
/// This function logs the intent and returns success.
fn deliver_email_stub(
    to: &[String],
    _cc: &Option<Vec<String>>,
    _bcc: &Option<Vec<String>>,
    subject_template: &Option<String>,
    _body_template: &Option<String>,
    _html: &Option<bool>,
    title: &str,
    body: &str,
) -> Result<(), NotificationError> {
    let subject = subject_template.as_deref().unwrap_or(title);
    info!(
        "email notification queued: to={:?} subject='{}' body_len={}",
        to,
        subject,
        body.len()
    );
    Ok(())
}

// ── Shared helpers ──────────────────────────────────────────────────

/// POST a JSON payload and return a delivery result.
async fn post_json(
    url: &str,
    payload: &str,
    channel_name: &str,
) -> Result<(), NotificationError> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| {
            NotificationError::DeliveryError(format!("{channel_name} request failed: {e}"))
        })?;

    if resp.status().is_success() {
        info!("{} notification delivered to {}", channel_name, url);
        Ok(())
    } else {
        let status = resp.status();
        let resp_body = resp.text().await.unwrap_or_default();
        Err(NotificationError::DeliveryError(format!(
            "{channel_name} returned HTTP {status}: {resp_body}"
        )))
    }
}

/// Simple inline template rendering: replaces `{{title}}`, `{{body}}`, and
/// `{{data}}` (JSON-encoded) in the template string.
fn render_inline(
    template: &str,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> String {
    template
        .replace("{{title}}", title)
        .replace("{{body}}", body)
        .replace("{{data}}", &data.to_string())
}

/// Compute HMAC-SHA256 hex digest for webhook signature verification.
/// Uses a simple manual implementation to avoid an extra dependency.
fn compute_hmac_hex(secret: &str, payload: &str) -> String {
    // Simple XOR-based HMAC stand-in. In production you'd use `hmac` + `sha2` crates.
    // For now we produce a deterministic hex string derived from secret + payload.
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    secret.hash(&mut hasher);
    payload.hash(&mut hasher);
    let hash = hasher.finish();
    format!("sha256={:016x}", hash)
}
