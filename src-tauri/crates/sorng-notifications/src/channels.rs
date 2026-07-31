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
        } => {
            deliver_email(
                to,
                cc,
                bcc,
                subject_template,
                body_template,
                html,
                title,
                body,
                data,
            )
            .await
        }
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
        ChannelConfig::Generic { .. } => {
            warn!("generic channel delivery is unsupported and was not attempted");
            Err(NotificationError::ConfigError(
                "generic notification adapters are unsupported and were not executed".to_string(),
            ))
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
    info!(
        "in-app notification queued (title_bytes={}, body_bytes={})",
        title.len(),
        body.len()
    );
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
    info!(
        "desktop notification queued (title_bytes={}, body_bytes={})",
        title.len(),
        body.len()
    );
    Ok(())
}

// ── Webhook ─────────────────────────────────────────────────────────

/// Deliver via a generic HTTP webhook.
#[allow(clippy::too_many_arguments)]
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

    let http_method = parse_webhook_method(method)?;

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(10_000));
    let retries = retry_count.unwrap_or(1).max(1);

    let mut last_err = String::new();

    for attempt in 0..retries {
        let req = build_webhook_request(
            &client,
            url,
            &http_method,
            headers,
            &payload,
            timeout,
            secret,
        )?;

        match client.execute(req).await {
            Ok(resp) if resp.status().is_success() => {
                info!("webhook delivered (attempt {})", attempt + 1);
                return Ok(());
            }
            Ok(resp) => {
                last_err = format!("HTTP {}", resp.status());
                warn!("webhook attempt {} failed: {}", attempt + 1, last_err);
            }
            Err(_) => {
                last_err = "request transport error".to_string();
                warn!("webhook attempt {} failed: {}", attempt + 1, last_err);
            }
        }
    }

    Err(NotificationError::DeliveryError(format!(
        "webhook delivery failed after {retries} attempt(s): {last_err}"
    )))
}

fn parse_webhook_method(method: Option<&str>) -> Result<reqwest::Method, NotificationError> {
    match method
        .unwrap_or("POST")
        .trim()
        .to_ascii_uppercase()
        .as_str()
    {
        "POST" => Ok(reqwest::Method::POST),
        "GET" => Ok(reqwest::Method::GET),
        "PUT" => Ok(reqwest::Method::PUT),
        "PATCH" => Ok(reqwest::Method::PATCH),
        _ => Err(NotificationError::ConfigError(
            "webhook method must be POST, GET, PUT, or PATCH".to_string(),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_webhook_request(
    client: &reqwest::Client,
    url: &str,
    method: &reqwest::Method,
    headers: Option<&HashMap<String, String>>,
    payload: &str,
    timeout: std::time::Duration,
    secret: Option<&str>,
) -> Result<reqwest::Request, NotificationError> {
    if headers.is_some_and(|configured| {
        configured
            .keys()
            .any(|name| name.eq_ignore_ascii_case("x-signature"))
    }) {
        return Err(NotificationError::ConfigError(
            "X-Signature is reserved for the webhook signer".to_string(),
        ));
    }

    if secret.is_some_and(|configured| configured.trim().is_empty()) {
        return Err(NotificationError::ConfigError(
            "webhook signing secret must not be empty".to_string(),
        ));
    }

    let mut request = client
        .request(method.clone(), url)
        .timeout(timeout)
        .header("Content-Type", "application/json")
        .body(payload.as_bytes().to_vec());

    if let Some(configured) = headers {
        for (name, value) in configured {
            request = request.header(name.as_str(), value.as_str());
        }
    }

    if let Some(configured) = secret {
        request = request.header("X-Signature", compute_hmac_hex(configured, payload));
    }

    request.build().map_err(|_| {
        NotificationError::ConfigError("invalid webhook request configuration".to_string())
    })
}

// ── Slack ───────────────────────────────────────────────────────────

/// Deliver a Slack notification via incoming webhook.
#[allow(clippy::too_many_arguments)]
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

// ── Email (SMTP via lettre) ─────────────────────────────────────────

/// TLS mode for SMTP connections.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpTlsMode {
    /// No TLS — plain SMTP on port 25 (only use on trusted networks).
    None,
    /// Opportunistic STARTTLS upgrade (typical port 587).
    StartTls,
    /// Implicit TLS from the first byte (typical port 465).
    ImplicitTls,
}

impl SmtpTlsMode {
    fn from_env_str(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "none" | "plain" | "plaintext" => Self::None,
            "starttls" | "start-tls" | "start_tls" => Self::StartTls,
            "tls" | "implicit" | "implicit-tls" | "implicit_tls" | "smtps" => Self::ImplicitTls,
            _ => Self::StartTls,
        }
    }
}

/// Runtime SMTP configuration, typically sourced from environment variables.
///
/// Environment variables (all optional except `host`):
/// - `SMTP_HOST` (required)
/// - `SMTP_PORT` (default: 587 for STARTTLS, 465 for implicit TLS, 25 for none)
/// - `SMTP_USERNAME` / `SMTP_PASSWORD` (optional; enables SMTP AUTH when both present)
/// - `SMTP_FROM` (required — RFC-5322 From address; falls back to `SMTP_USERNAME`)
/// - `SMTP_TLS_MODE` — `starttls` (default), `implicit`, or `none`
#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
    pub tls_mode: SmtpTlsMode,
}

impl SmtpConfig {
    /// Load the SMTP config from process environment variables. Returns `None`
    /// if `SMTP_HOST` is unset or empty.
    pub fn from_env() -> Option<Self> {
        let host = std::env::var("SMTP_HOST").ok().filter(|s| !s.is_empty())?;
        let tls_mode = std::env::var("SMTP_TLS_MODE")
            .ok()
            .map(|s| SmtpTlsMode::from_env_str(&s))
            .unwrap_or(SmtpTlsMode::StartTls);
        let default_port = match tls_mode {
            SmtpTlsMode::None => 25,
            SmtpTlsMode::StartTls => 587,
            SmtpTlsMode::ImplicitTls => 465,
        };
        let port = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(default_port);
        let username = std::env::var("SMTP_USERNAME")
            .ok()
            .filter(|s| !s.is_empty());
        let password = std::env::var("SMTP_PASSWORD")
            .ok()
            .filter(|s| !s.is_empty());
        let from = std::env::var("SMTP_FROM")
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| username.clone())
            .unwrap_or_else(|| format!("sortofremoteng@{host}"));
        Some(Self {
            host,
            port,
            username,
            password,
            from,
            tls_mode,
        })
    }
}

/// Deliver an email through an SMTP relay using the `lettre` crate.
///
/// SMTP connection parameters are loaded from the process environment
/// (see [`SmtpConfig::from_env`]). If `SMTP_HOST` is not set this returns a
/// [`NotificationError::ConfigError`] with actionable guidance rather than
/// silently succeeding.
#[allow(clippy::too_many_arguments)]
pub async fn deliver_email(
    to: &[String],
    cc: &Option<Vec<String>>,
    bcc: &Option<Vec<String>>,
    subject_template: &Option<String>,
    body_template: &Option<String>,
    html: &Option<bool>,
    title: &str,
    body: &str,
    data: &serde_json::Value,
) -> Result<(), NotificationError> {
    let config = SmtpConfig::from_env().ok_or_else(|| {
        NotificationError::ConfigError(
            "SMTP not configured: set SMTP_HOST (and SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM as needed)"
                .to_string(),
        )
    })?;

    let subject = subject_template
        .as_deref()
        .map(|tmpl| render_inline(tmpl, title, body, data))
        .unwrap_or_else(|| title.to_string());

    let rendered_body = body_template
        .as_deref()
        .map(|tmpl| render_inline(tmpl, title, body, data))
        .unwrap_or_else(|| body.to_string());

    send_smtp_email(
        &config,
        to,
        cc.as_deref().unwrap_or(&[]),
        bcc.as_deref().unwrap_or(&[]),
        &subject,
        &rendered_body,
        html.unwrap_or(false),
    )
    .await
}

/// Low-level SMTP send. Public so callers (e.g. 2FA) can reuse the transport.
pub async fn send_smtp_email(
    config: &SmtpConfig,
    to: &[String],
    cc: &[String],
    bcc: &[String],
    subject: &str,
    body: &str,
    html: bool,
) -> Result<(), NotificationError> {
    use lettre::message::{header::ContentType, Mailbox};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::transport::smtp::AsyncSmtpTransport;
    use lettre::{AsyncTransport, Message, Tokio1Executor};

    if to.is_empty() {
        return Err(NotificationError::ConfigError(
            "email delivery: no recipients specified".to_string(),
        ));
    }

    let from_mbox: Mailbox = config.from.parse().map_err(|e| {
        NotificationError::ConfigError(format!("invalid SMTP_FROM address '{}': {e}", config.from))
    })?;

    let mut builder = Message::builder().from(from_mbox).subject(subject);

    for addr in to {
        let mbox: Mailbox = addr
            .parse()
            .map_err(|e| NotificationError::ConfigError(format!("invalid To '{addr}': {e}")))?;
        builder = builder.to(mbox);
    }
    for addr in cc {
        let mbox: Mailbox = addr
            .parse()
            .map_err(|e| NotificationError::ConfigError(format!("invalid Cc '{addr}': {e}")))?;
        builder = builder.cc(mbox);
    }
    for addr in bcc {
        let mbox: Mailbox = addr
            .parse()
            .map_err(|e| NotificationError::ConfigError(format!("invalid Bcc '{addr}': {e}")))?;
        builder = builder.bcc(mbox);
    }

    let content_type = if html {
        ContentType::TEXT_HTML
    } else {
        ContentType::TEXT_PLAIN
    };

    let email = builder
        .header(content_type)
        .body(body.to_string())
        .map_err(|e| {
            NotificationError::DeliveryError(format!("failed to build email message: {e}"))
        })?;

    let mut transport_builder = match config.tls_mode {
        SmtpTlsMode::None => {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(config.host.clone())
                .port(config.port)
        }
        SmtpTlsMode::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
            .map_err(|e| {
                NotificationError::ConfigError(format!("SMTP STARTTLS setup failed: {e}"))
            })?
            .port(config.port),
        SmtpTlsMode::ImplicitTls => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
            .map_err(|e| NotificationError::ConfigError(format!("SMTP TLS setup failed: {e}")))?
            .port(config.port),
    };

    if let (Some(user), Some(pass)) = (&config.username, &config.password) {
        transport_builder =
            transport_builder.credentials(Credentials::new(user.clone(), pass.clone()));
    }

    let transport = transport_builder.build();

    transport.send(email).await.map_err(|e| {
        NotificationError::DeliveryError(format!(
            "SMTP delivery to {}:{} failed: {e}",
            config.host, config.port
        ))
    })?;

    info!(
        "email delivered via {}:{} to {} recipient(s), subject='{}'",
        config.host,
        config.port,
        to.len() + cc.len() + bcc.len(),
        subject
    );
    Ok(())
}

// ── Shared helpers ──────────────────────────────────────────────────

/// POST a JSON payload and return a delivery result.
async fn post_json(url: &str, payload: &str, channel_name: &str) -> Result<(), NotificationError> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| {
            NotificationError::DeliveryError(format!(
                "{channel_name} request failed due to a transport error"
            ))
        })?;

    if resp.status().is_success() {
        info!("{} notification delivered", channel_name);
        Ok(())
    } else {
        let status = resp.status();
        Err(NotificationError::DeliveryError(format!(
            "{channel_name} returned HTTP {status}"
        )))
    }
}

/// Simple inline template rendering: replaces `{{title}}`, `{{body}}`, and
/// `{{data}}` (JSON-encoded) in the template string.
fn render_inline(template: &str, title: &str, body: &str, data: &serde_json::Value) -> String {
    template
        .replace("{{title}}", title)
        .replace("{{body}}", body)
        .replace("{{data}}", &data.to_string())
}

/// Compute an HMAC-SHA256 hex digest for webhook signature verification.
fn compute_hmac_hex(secret: &str, payload: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::fmt::Write as _;

    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .expect("HMAC-SHA256 accepts keys of any length");
    mac.update(payload.as_bytes());

    let digest = mac.finalize().into_bytes();
    let mut encoded = String::with_capacity("sha256=".len() + digest.len() * 2);
    encoded.push_str("sha256=");
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_signature_matches_rfc_4231_hmac_sha256_vector() {
        let key = "\x0b".repeat(20);
        assert_eq!(
            compute_hmac_hex(&key, "Hi There"),
            concat!(
                "sha256=",
                "b0344c61d8db38535ca8afceaf0bf12b",
                "881dc200c9833da726e9376c2e32cff7"
            )
        );
    }

    #[test]
    fn signed_webhook_request_uses_exact_body_and_single_signature_header() {
        let client = reqwest::Client::new();
        let payload = "what do ya want for nothing?";
        let request = build_webhook_request(
            &client,
            "https://example.invalid/hooks",
            &reqwest::Method::POST,
            None,
            payload,
            std::time::Duration::from_secs(1),
            Some("Jefe"),
        )
        .expect("valid signed webhook request");

        assert_eq!(
            request.body().and_then(reqwest::Body::as_bytes),
            Some(payload.as_bytes())
        );
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(
            request.headers().get(reqwest::header::CONTENT_TYPE),
            Some(&reqwest::header::HeaderValue::from_static(
                "application/json"
            ))
        );

        let signatures: Vec<_> = request.headers().get_all("x-signature").iter().collect();
        assert_eq!(signatures.len(), 1);
        assert_eq!(
            signatures[0],
            "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn unsigned_webhook_request_omits_signature_header() {
        let request = build_webhook_request(
            &reqwest::Client::new(),
            "https://example.invalid/hooks",
            &reqwest::Method::POST,
            None,
            "{}",
            std::time::Duration::from_secs(1),
            None,
        )
        .expect("valid unsigned webhook request");

        assert!(!request.headers().contains_key("x-signature"));
    }

    #[test]
    fn configured_signature_header_is_rejected() {
        let headers = HashMap::from([("X-SIGNATURE".to_string(), "attacker".to_string())]);
        let result = build_webhook_request(
            &reqwest::Client::new(),
            "https://example.invalid/hooks",
            &reqwest::Method::POST,
            Some(&headers),
            "{}",
            std::time::Duration::from_secs(1),
            Some("secret"),
        );

        assert!(matches!(
            result,
            Err(NotificationError::ConfigError(message))
                if message == "X-Signature is reserved for the webhook signer"
        ));
    }

    #[test]
    fn empty_webhook_secret_is_rejected() {
        let result = build_webhook_request(
            &reqwest::Client::new(),
            "https://example.invalid/hooks",
            &reqwest::Method::POST,
            None,
            "{}",
            std::time::Duration::from_secs(1),
            Some("  "),
        );

        assert!(matches!(
            result,
            Err(NotificationError::ConfigError(message))
                if message == "webhook signing secret must not be empty"
        ));
    }

    #[test]
    fn unsupported_webhook_method_is_rejected() {
        let result = parse_webhook_method(Some("DELETE"));

        assert!(matches!(
            result,
            Err(NotificationError::ConfigError(message))
                if message == "webhook method must be POST, GET, PUT, or PATCH"
        ));
    }

    #[tokio::test]
    async fn generic_channel_without_adapter_fails_closed() {
        let channel = ChannelConfig::Generic {
            adapter_id: "missing".to_string(),
            config: serde_json::json!({}),
        };
        let data = serde_json::json!({});
        let result = deliver_notification(&channel, "title", "body", &data).await;

        assert!(matches!(
            result,
            Err(NotificationError::ConfigError(message))
                if message == "generic notification adapters are unsupported and were not executed"
        ));
    }
}
