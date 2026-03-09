//! # Teleport Audit
//!
//! Audit event filtering, search, event type classification,
//! and audit log summary utilities.

use crate::types::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Known audit event categories for classification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventCategory {
    Authentication,
    Session,
    AccessRequest,
    Resource,
    Configuration,
    Security,
    Unknown,
}

/// Classify an event type string into a category.
pub fn classify_event(event_type: &str) -> EventCategory {
    match event_type {
        "user.login" | "user.login.failed" | "user.logout" | "auth" | "mfa.add" | "mfa.delete" => {
            EventCategory::Authentication
        }
        t if t.starts_with("session.") => EventCategory::Session,
        t if t.starts_with("access_request.") => EventCategory::AccessRequest,
        "node.join" | "node.leave" | "kube.create" | "db.create" | "app.create"
        | "desktop.create" => EventCategory::Resource,
        "role.create"
        | "role.update"
        | "role.delete"
        | "cluster.config.update"
        | "trusted_cluster.create"
        | "trusted_cluster.delete" => EventCategory::Configuration,
        "lock.create" | "lock.delete" | "cert.create" => EventCategory::Security,
        _ => EventCategory::Unknown,
    }
}

/// Filter events by category.
pub fn filter_by_category<'a>(
    events: &[&'a AuditEvent],
    category: EventCategory,
) -> Vec<&'a AuditEvent> {
    events
        .iter()
        .filter(|e| classify_event(&e.event_type) == category)
        .copied()
        .collect()
}

/// Filter events by user.
pub fn filter_by_user<'a>(events: &[&'a AuditEvent], user: &str) -> Vec<&'a AuditEvent> {
    events
        .iter()
        .filter(|e| e.user.as_deref() == Some(user))
        .copied()
        .collect()
}

/// Filter events within a time range.
pub fn filter_by_time_range<'a>(
    events: &[&'a AuditEvent],
    after: DateTime<Utc>,
    before: Option<DateTime<Utc>>,
) -> Vec<&'a AuditEvent> {
    events
        .iter()
        .filter(|e| {
            let after_ok = e.time >= after;
            let before_ok = before.map_or(true, |b| e.time <= b);
            after_ok && before_ok
        })
        .copied()
        .collect()
}

/// Search events by keyword in the event type or details.
pub fn search_events<'a>(events: &[&'a AuditEvent], keyword: &str) -> Vec<&'a AuditEvent> {
    let kw = keyword.to_lowercase();
    events
        .iter()
        .filter(|e| {
            e.event_type.to_lowercase().contains(&kw)
                || e.user.as_deref().unwrap_or("").to_lowercase().contains(&kw)
                || e.message.to_lowercase().contains(&kw)
        })
        .copied()
        .collect()
}

/// Audit summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSummary {
    pub total: u32,
    pub by_category: HashMap<String, u32>,
    pub unique_users: u32,
    pub unique_event_types: u32,
    pub failed_logins: u32,
}

pub fn summarize_audit(events: &[&AuditEvent]) -> AuditSummary {
    let mut by_category: HashMap<String, u32> = HashMap::new();
    let mut users = std::collections::HashSet::new();
    let mut event_types = std::collections::HashSet::new();
    let mut failed_logins = 0u32;

    for e in events {
        let cat = classify_event(&e.event_type);
        *by_category.entry(format!("{:?}", cat)).or_insert(0) += 1;
        if let Some(ref u) = e.user {
            users.insert(u.as_str());
        }
        event_types.insert(&e.event_type);
        if e.event_type == "user.login.failed" {
            failed_logins += 1;
        }
    }

    AuditSummary {
        total: events.len() as u32,
        by_category,
        unique_users: users.len() as u32,
        unique_event_types: event_types.len() as u32,
        failed_logins,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_event() {
        assert_eq!(classify_event("user.login"), EventCategory::Authentication);
        assert_eq!(classify_event("session.start"), EventCategory::Session);
        assert_eq!(
            classify_event("access_request.create"),
            EventCategory::AccessRequest
        );
        assert_eq!(classify_event("node.join"), EventCategory::Resource);
        assert_eq!(classify_event("role.create"), EventCategory::Configuration);
        assert_eq!(classify_event("lock.create"), EventCategory::Security);
        assert_eq!(classify_event("unknown.event"), EventCategory::Unknown);
    }

    #[test]
    fn test_search_events() {
        let evt = AuditEvent {
            id: "1".to_string(),
            event_type: "user.login".to_string(),
            user: Some("admin".to_string()),
            time: Utc::now(),
            cluster_name: Some("main".to_string()),
            message: "User logged in successfully".to_string(),
            code: "T1000I".to_string(),
            login: None,
            namespace: None,
            server_id: None,
            success: true,
            metadata: HashMap::new(),
        };
        let events = vec![&evt];
        let found = search_events(&events, "admin");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn test_filter_by_category() {
        let evt1 = AuditEvent {
            id: "1".to_string(),
            event_type: "user.login".to_string(),
            user: Some("alice".to_string()),
            time: Utc::now(),
            cluster_name: Some("main".to_string()),
            message: "".to_string(),
            code: "T1000I".to_string(),
            login: None,
            namespace: None,
            server_id: None,
            success: true,
            metadata: HashMap::new(),
        };
        let evt2 = AuditEvent {
            id: "2".to_string(),
            event_type: "session.start".to_string(),
            user: Some("bob".to_string()),
            time: Utc::now(),
            cluster_name: Some("main".to_string()),
            message: "".to_string(),
            code: "T2000I".to_string(),
            login: None,
            namespace: None,
            server_id: None,
            success: true,
            metadata: HashMap::new(),
        };
        let events = vec![&evt1, &evt2];
        let auth = filter_by_category(&events, EventCategory::Authentication);
        assert_eq!(auth.len(), 1);
        assert_eq!(auth[0].user.as_deref(), Some("alice"));
    }
}
