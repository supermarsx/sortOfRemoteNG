//! IPP event subscriptions and notification polling.
//!
//! CUPS supports IPP subscription operations (RFC 3995 / RFC 3996) that
//! let a client register interest in specific events and then poll for
//! notifications. This module wraps the relevant IPP operations:
//!
//! - Create-Printer-Subscriptions (0x0016)
//! - Cancel-Subscription          (0x001B)
//! - Get-Subscriptions            (0x0019)
//! - Get-Notifications            (0x001C)
//! - Renew-Subscription           (0x001A)

use crate::error::CupsError;
use crate::ipp::{self, op, tag, IppRequestBuilder};
use crate::types::*;
use chrono::{TimeZone, Utc};

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/// Default lease duration for subscriptions (seconds). 24 hours.
const DEFAULT_LEASE_SECS: u32 = 86400;

/// Parse a subscription-attributes group into a `SubscriptionInfo`.
fn subscription_from_group(group: &ipp::IppAttributeGroup) -> SubscriptionInfo {
    let id = group.get_integer("notify-subscription-id").unwrap_or(0) as u32;

    let lease_duration = group.get_integer("notify-lease-duration").unwrap_or(0) as u32;

    let created_epoch = group
        .get_integer("notify-time-interval")
        .or_else(|| group.get_integer("notify-subscription-id"))
        .unwrap_or(0) as i64;
    let created_at = if created_epoch > 1_000_000 {
        Utc.timestamp_opt(created_epoch, 0)
            .single()
            .unwrap_or_else(Utc::now)
    } else {
        Utc::now()
    };

    let events: Vec<NotifyEvent> = group
        .get_strings("notify-events")
        .into_iter()
        .filter_map(NotifyEvent::from_keyword)
        .collect();

    let expiration = if lease_duration > 0 {
        Utc.timestamp_opt(created_at.timestamp() + lease_duration as i64, 0)
            .single()
    } else {
        None
    };

    SubscriptionInfo {
        id,
        events,
        printer_uri: group.get_string("notify-printer-uri").map(String::from),
        job_id: group.get_integer("notify-job-id").map(|v| v as u32),
        recipient_uri: group.get_string("notify-recipient-uri").map(String::from),
        lease_duration,
        created_at,
        expiration,
    }
}

/// Parse a notification event-attributes group into a `NotificationEvent`.
fn event_from_group(group: &ipp::IppAttributeGroup) -> NotificationEvent {
    let sub_id = group.get_integer("notify-subscription-id").unwrap_or(0) as u32;
    let seq = group.get_integer("notify-sequence-number").unwrap_or(0) as u32;
    let event_kw = group
        .get_string("notify-subscribed-event")
        .or_else(|| group.get_string("notify-event"))
        .unwrap_or("unknown")
        .to_string();
    let timestamp_epoch = group.get_integer("notify-time-stamp").unwrap_or(0) as i64;
    let timestamp = if timestamp_epoch > 0 {
        Utc.timestamp_opt(timestamp_epoch, 0)
            .single()
            .unwrap_or_else(Utc::now)
    } else {
        Utc::now()
    };

    let printer_state_val = group.get_integer("printer-state");
    let printer_state = printer_state_val.map(PrinterState::from_ipp);

    let job_state_val = group.get_integer("job-state");
    let job_state = job_state_val.map(JobState::from_ipp);

    NotificationEvent {
        subscription_id: sub_id,
        sequence_number: seq,
        event: event_kw,
        printer_uri: group.get_string("notify-printer-uri").map(String::from),
        printer_name: group
            .get_string("notify-printer-uri")
            .and_then(|u| u.rsplit('/').next())
            .map(String::from),
        printer_state,
        job_id: group.get_integer("notify-job-id").map(|v| v as u32),
        job_state,
        timestamp,
        message: group.get_string("notify-text").map(String::from),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// Create a printer event subscription.
///
/// Asks the CUPS server to start tracking the given events on the specified
/// printer (or server-wide if `printer_name` is `None`).
///
/// # Arguments
///
/// * `events` — List of IPP events to subscribe to.
/// * `printer_name` — Optional printer to scope the subscription.
/// * `lease_secs` — Lease duration in seconds (default 86 400 = 24 h).
/// * `recipient_uri` — Optional push URI (leave `None` for pull-only).
///
/// Returns the subscription ID assigned by the server.
pub async fn create_subscription(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    events: &[NotifyEvent],
    printer_name: Option<&str>,
    lease_secs: Option<u32>,
    recipient_uri: Option<&str>,
) -> Result<u32, CupsError> {
    if events.is_empty() {
        return Err(CupsError::new(
            crate::error::CupsErrorKind::SubscriptionError,
            "At least one event must be specified",
        ));
    }

    let target_uri = match printer_name {
        Some(name) => config.printer_uri(name),
        None => config.ipp_uri(),
    };

    let event_keywords: Vec<&str> = events.iter().map(|e| e.as_ipp_keyword()).collect();
    let lease = lease_secs.unwrap_or(DEFAULT_LEASE_SECS) as i32;

    let mut req = ipp::standard_request(op::CREATE_PRINTER_SUBSCRIPTIONS, &target_uri)
        .name_without_language(
            "requesting-user-name",
            config.username.as_deref().unwrap_or("anonymous"),
        )
        .subscription_attributes()
        .keywords("notify-events", &event_keywords)
        .integer("notify-lease-duration", lease);

    if let Some(uri) = recipient_uri {
        req = req.uri("notify-recipient-uri", uri);
    } else {
        // Pull model: use "ippget" scheme.
        let pull_uri = format!("ippget://{}/", config.host);
        req = req.keyword("notify-pull-method", "ippget");
        req = req.uri("notify-recipient-uri", &pull_uri);
    }

    let body = req.end_of_attributes().build();

    let url = match printer_name {
        Some(name) => format!("{}/printers/{name}", config.base_url()),
        None => format!("{}/", config.base_url()),
    };

    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)?;

    let sub_id = resp
        .group(tag::SUBSCRIPTION_ATTRIBUTES)
        .and_then(|g| g.get_integer("notify-subscription-id"))
        .ok_or_else(|| {
            CupsError::new(
                crate::error::CupsErrorKind::SubscriptionError,
                "No subscription ID in response",
            )
        })? as u32;

    Ok(sub_id)
}

/// Cancel an existing subscription.
pub async fn cancel_subscription(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    subscription_id: u32,
) -> Result<(), CupsError> {
    let uri = config.ipp_uri();

    let body = IppRequestBuilder::new(op::CANCEL_SUBSCRIPTION)
        .operation_attributes()
        .charset("attributes-charset", "utf-8")
        .natural_language("attributes-natural-language", "en")
        .uri("printer-uri", &uri)
        .integer("notify-subscription-id", subscription_id as i32)
        .end_of_attributes()
        .build();

    let url = format!("{}/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}

/// List all subscriptions on the server (or a specific printer).
pub async fn list_subscriptions(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    printer_name: Option<&str>,
) -> Result<Vec<SubscriptionInfo>, CupsError> {
    let target_uri = match printer_name {
        Some(name) => config.printer_uri(name),
        None => config.ipp_uri(),
    };

    let body = ipp::standard_request(op::GET_SUBSCRIPTIONS, &target_uri)
        .name_without_language(
            "requesting-user-name",
            config.username.as_deref().unwrap_or("anonymous"),
        )
        .keywords(
            "requested-attributes",
            &[
                "notify-subscription-id",
                "notify-events",
                "notify-printer-uri",
                "notify-job-id",
                "notify-recipient-uri",
                "notify-lease-duration",
                "notify-time-interval",
            ],
        )
        .end_of_attributes()
        .build();

    let url = match printer_name {
        Some(name) => format!("{}/printers/{name}", config.base_url()),
        None => format!("{}/", config.base_url()),
    };

    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;

    // An empty subscription list may return a client-error-not-found.
    if !resp.is_success() && resp.status_code == IppStatusCode::CLIENT_ERROR_NOT_FOUND {
        return Ok(Vec::new());
    }
    ipp::check_response(&resp)?;

    let subs = resp
        .groups(tag::SUBSCRIPTION_ATTRIBUTES)
        .into_iter()
        .map(subscription_from_group)
        .collect();
    Ok(subs)
}

/// Poll for notification events on a subscription.
///
/// Returns events with a sequence number greater than `since_sequence`
/// (pass 0 to get all available events).
pub async fn get_events(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    subscription_id: u32,
    since_sequence: u32,
) -> Result<Vec<NotificationEvent>, CupsError> {
    let uri = config.ipp_uri();

    let body = IppRequestBuilder::new(op::GET_NOTIFICATIONS)
        .operation_attributes()
        .charset("attributes-charset", "utf-8")
        .natural_language("attributes-natural-language", "en")
        .uri("printer-uri", &uri)
        .integer("notify-subscription-ids", subscription_id as i32)
        .integer("notify-sequence-numbers", since_sequence as i32)
        .end_of_attributes()
        .build();

    let url = format!("{}/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;

    // No events is not an error.
    if !resp.is_success() {
        return Ok(Vec::new());
    }

    let events = resp
        .groups(tag::EVENT_NOTIFICATION)
        .into_iter()
        .map(event_from_group)
        .collect();
    Ok(events)
}

/// Renew an existing subscription's lease.
///
/// Extends the lease duration of the specified subscription by
/// `lease_secs` seconds from now.
pub async fn renew_subscription(
    client: &reqwest::Client,
    config: &CupsConnectionConfig,
    subscription_id: u32,
    lease_secs: Option<u32>,
) -> Result<(), CupsError> {
    let uri = config.ipp_uri();
    let lease = lease_secs.unwrap_or(DEFAULT_LEASE_SECS) as i32;

    let body = IppRequestBuilder::new(op::RENEW_SUBSCRIPTION)
        .operation_attributes()
        .charset("attributes-charset", "utf-8")
        .natural_language("attributes-natural-language", "en")
        .uri("printer-uri", &uri)
        .integer("notify-subscription-id", subscription_id as i32)
        .subscription_attributes()
        .integer("notify-lease-duration", lease)
        .end_of_attributes()
        .build();

    let url = format!("{}/", config.base_url());
    let resp = ipp::send_ipp_request(
        client,
        &url,
        body,
        config.username.as_deref(),
        config.password.as_deref(),
    )
    .await?;
    ipp::check_response(&resp)
}
