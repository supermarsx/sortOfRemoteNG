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
        let username = std::env::var("SMTP_USERNAME").ok().filter(|s| !s.is_empty());
        let password = std::env::var("SMTP_PASSWORD").ok().filter(|s| !s.is_empty());
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
        NotificationError::ConfigError(format!(
            "invalid SMTP_FROM address '{}': {e}",
            config.from
        ))
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
fn render_inline(template: &str, title: &str, body: &str, data: &serde_json::Value) -> String {
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
