//! Notifications — connection event alerts, rule matching, throttling.

use crate::types::*;
use chrono::Utc;
use log::{debug, info};
use std::collections::HashMap;

/// Manages notification rules and delivers alerts.
#[derive(Debug)]
pub struct NotificationManager {
    rules: Vec<NotificationRule>,
    /// Per-rule last-triggered timestamps for throttling (rule_id → timestamp).
    throttle_map: HashMap<String, chrono::DateTime<Utc>>,
    /// Notification delivery history.
    history: Vec<NotificationResult>,
    /// Maximum history entries to keep.
    max_history: usize,
}

impl NotificationManager {
    pub fn new() -> Self {
        Self {
            rules: Vec::new(),
            throttle_map: HashMap::new(),
            history: Vec::new(),
            max_history: 1000,
        }
    }

    /// Add or update a notification rule.
    pub fn upsert_rule(&mut self, rule: NotificationRule) {
        if let Some(existing) = self.rules.iter_mut().find(|r| r.id == rule.id) {
            *existing = rule;
        } else {
            self.rules.push(rule);
        }
    }

    /// Remove a rule by ID.
    pub fn remove_rule(&mut self, rule_id: &str) -> Result<(), String> {
        let initial = self.rules.len();
        self.rules.retain(|r| r.id != rule_id);
        if self.rules.len() == initial {
            return Err(format!("Rule '{}' not found", rule_id));
        }
        self.throttle_map.remove(rule_id);
        Ok(())
    }

    /// Get a rule by ID.
    pub fn get_rule(&self, rule_id: &str) -> Option<&NotificationRule> {
        self.rules.iter().find(|r| r.id == rule_id)
    }

    /// List all rules.
    pub fn list_rules(&self) -> &[NotificationRule] {
        &self.rules
    }

    /// Enable or disable a rule.
    pub fn set_rule_enabled(&mut self, rule_id: &str, enabled: bool) -> Result<(), String> {
        let rule = self
            .rules
            .iter_mut()
            .find(|r| r.id == rule_id)
            .ok_or_else(|| format!("Rule '{}' not found", rule_id))?;
        rule.enabled = enabled;
        Ok(())
    }

    /// Find matching rules for a given event.
    pub fn match_rules(&self, event: &ConnectionEvent) -> Vec<&NotificationRule> {
        self.rules
            .iter()
            .filter(|rule| {
                if !rule.enabled {
                    return false;
                }
                // Check event type match.
                if !rule.event_types.contains(&event.event_type) {
                    return false;
                }
                // Check severity threshold.
                if let Some(ref min_sev) = rule.min_severity {
                    if severity_level(&event.severity) < severity_level(min_sev) {
                        return false;
                    }
                }
                // Check host filter (simple glob: *pattern*).
                if let Some(ref hf) = rule.host_filter {
                    if !host_matches(&event.host, hf) {
                        return false;
                    }
                }
                // Check protocol filter.
                if let Some(ref pf) = rule.protocol_filter {
                    if !pf.iter().any(|p| p.eq_ignore_ascii_case(&event.protocol)) {
                        return false;
                    }
                }
                true
            })
            .collect()
    }

    /// Check if a rule is throttled (shouldn't fire yet).
    pub fn is_throttled(&self, rule: &NotificationRule) -> bool {
        if let Some(throttle_secs) = rule.throttle_seconds {
            if throttle_secs == 0 {
                return false;
            }
            if let Some(last) = self.throttle_map.get(&rule.id) {
                let elapsed = Utc::now().signed_duration_since(*last);
                return elapsed.num_seconds() < throttle_secs as i64;
            }
        }
        false
    }

    /// Mark a rule as having been triggered now.
    pub fn mark_triggered(&mut self, rule_id: &str) {
        let now = Utc::now();
        self.throttle_map.insert(rule_id.to_string(), now);
        if let Some(rule) = self.rules.iter_mut().find(|r| r.id == rule_id) {
            rule.last_triggered = Some(now);
            rule.trigger_count += 1;
        }
    }

    /// Render a notification message from an event and rule template.
    pub fn render_message(
        &self,
        event: &ConnectionEvent,
        rule: &NotificationRule,
    ) -> String {
        let template = rule.template.as_deref().unwrap_or(DEFAULT_TEMPLATE);
        render_template(template, event)
    }

    /// Record a notification delivery result.
    pub fn record_result(&mut self, result: NotificationResult) {
        self.history.push(result);
        while self.history.len() > self.max_history {
            self.history.remove(0);
        }
    }

    /// Get notification history.
    pub fn history(&self) -> &[NotificationResult] {
        &self.history
    }

    /// Get the number of active rules.
    pub fn active_rule_count(&self) -> usize {
        self.rules.iter().filter(|r| r.enabled).count()
    }

    /// Get the total number of notifications sent.
    pub fn total_sent(&self) -> u64 {
        self.history.iter().filter(|r| r.success).count() as u64
    }

    /// Clear all history.
    pub fn clear_history(&mut self) {
        self.history.clear();
    }

    /// Process an event: find matching rules, check throttling,
    /// return the list of (rule, rendered_message) pairs that should fire.
    pub fn process_event(
        &self,
        event: &ConnectionEvent,
    ) -> Vec<(&NotificationRule, String)> {
        let matched = self.match_rules(event);
        let mut to_fire = Vec::new();

        for rule in matched {
            if self.is_throttled(rule) {
                debug!(
                    "Rule '{}' throttled, skipping notification for {:?}",
                    rule.name, event.event_type
                );
                continue;
            }
            let msg = self.render_message(event, rule);
            to_fire.push((rule, msg));
        }

        if to_fire.is_empty() {
            debug!("No rules matched event {:?} on {}", event.event_type, event.host);
        } else {
            info!(
                "{} rules matched event {:?} on {}",
                to_fire.len(),
                event.event_type,
                event.host
            );
        }

        to_fire
    }
}

impl Default for NotificationManager {
    fn default() -> Self {
        Self::new()
    }
}

const DEFAULT_TEMPLATE: &str =
    "🔔 *{{event_type}}*\nHost: `{{host}}` ({{protocol}})\n{{message}}\n_{{timestamp}}_";

/// Render a template with event variables.
pub fn render_template(template: &str, event: &ConnectionEvent) -> String {
    let mut result = template.to_string();
    result = result.replace("{{event_type}}", &format!("{:?}", event.event_type));
    result = result.replace("{{severity}}", &format!("{:?}", event.severity));
    result = result.replace("{{host}}", &event.host);
    result = result.replace("{{protocol}}", &event.protocol);
    result = result.replace("{{message}}", &event.message);
    result = result.replace(
        "{{session_id}}",
        event.session_id.as_deref().unwrap_or("N/A"),
    );
    result = result.replace(
        "{{username}}",
        event.username.as_deref().unwrap_or("N/A"),
    );
    result = result.replace("{{timestamp}}", &event.timestamp.to_rfc3339());

    // Replace any detail variables.
    if let Some(ref details) = event.details {
        for (key, value) in details {
            result = result.replace(&format!("{{{{{}}}}}", key), value);
        }
    }

    result
}

/// Map severity to a numeric level for comparison.
fn severity_level(s: &NotificationSeverity) -> u8 {
    match s {
        NotificationSeverity::Info => 0,
        NotificationSeverity::Warning => 1,
        NotificationSeverity::Error => 2,
        NotificationSeverity::Critical => 3,
    }
}

/// Simple glob-style host matching. Supports `*` as wildcard.
fn host_matches(host: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let host_lower = host.to_lowercase();
    let pattern_lower = pattern.to_lowercase();

    if pattern_lower.starts_with('*') && pattern_lower.ends_with('*') {
        let inner = &pattern_lower[1..pattern_lower.len() - 1];
        host_lower.contains(inner)
    } else if let Some(suffix) = pattern_lower.strip_prefix('*') {
        host_lower.ends_with(suffix)
    } else if pattern_lower.ends_with('*') {
        let prefix = &pattern_lower[..pattern_lower.len() - 1];
        host_lower.starts_with(prefix)
    } else {
        host_lower == pattern_lower
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_event(event_type: ConnectionEventType, host: &str) -> ConnectionEvent {
        ConnectionEvent {
            event_type,
            severity: NotificationSeverity::Warning,
            host: host.to_string(),
            protocol: "SSH".to_string(),
            session_id: Some("sess-1".to_string()),
            username: Some("admin".to_string()),
            message: "Connection timed out".to_string(),
            details: None,
            timestamp: Utc::now(),
        }
    }

    fn test_rule(
        id: &str,
        event_types: Vec<ConnectionEventType>,
    ) -> NotificationRule {
        NotificationRule {
            id: id.to_string(),
            name: format!("Rule {}", id),
            enabled: true,
            bot_name: "testbot".to_string(),
            chat_id: ChatId::Numeric(12345),
            event_types,
            min_severity: None,
            host_filter: None,
            protocol_filter: None,
            template: None,
            parse_mode: None,
            throttle_seconds: None,
            created_at: Utc::now(),
            last_triggered: None,
            trigger_count: 0,
        }
    }

    #[test]
    fn add_and_list_rules() {
        let mut mgr = NotificationManager::new();
        mgr.upsert_rule(test_rule("r1", vec![ConnectionEventType::Connected]));
        mgr.upsert_rule(test_rule("r2", vec![ConnectionEventType::Disconnected]));
        assert_eq!(mgr.list_rules().len(), 2);
    }

    #[test]
    fn update_existing_rule() {
        let mut mgr = NotificationManager::new();
        mgr.upsert_rule(test_rule("r1", vec![ConnectionEventType::Connected]));
        let mut updated = test_rule("r1", vec![ConnectionEventType::Disconnected]);
        updated.name = "Updated Rule".to_string();
        mgr.upsert_rule(updated);
        assert_eq!(mgr.list_rules().len(), 1);
        assert_eq!(mgr.get_rule("r1").unwrap().name, "Updated Rule");
    }

    #[test]
    fn remove_rule_test() {
        let mut mgr = NotificationManager::new();
        mgr.upsert_rule(test_rule("r1", vec![ConnectionEventType::Connected]));
        mgr.remove_rule("r1").unwrap();
        assert_eq!(mgr.list_rules().len(), 0);
        assert!(mgr.remove_rule("r1").is_err());
    }

    #[test]
    fn enable_disable_rule() {
        let mut mgr = NotificationManager::new();
        mgr.upsert_rule(test_rule("r1", vec![ConnectionEventType::Connected]));
        mgr.set_rule_enabled("r1", false).unwrap();
        assert!(!mgr.get_rule("r1").unwrap().enabled);
        assert_eq!(mgr.active_rule_count(), 0);
    }

    #[test]
    fn match_rules_event_type() {
        let mut mgr = NotificationManager::new();
        mgr.upsert_rule(test_rule("r1", vec![ConnectionEventType::Connected]));
        mgr.upsert_rule(test_rule("r2", vec![ConnectionEventType::Disconnected]));

        let event = test_event(ConnectionEventType::Connected, "server1");
        let matched = mgr.match_rules(&event);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].id, "r1");
    }

    #[test]
    fn match_rules_severity_filter() {
        let mut mgr = NotificationManager::new();
        let mut rule = test_rule("r1", vec![ConnectionEventType::Connected]);
        rule.min_severity = Some(NotificationSeverity::Error);
        mgr.upsert_rule(rule);

        // Warning < Error, so rule should NOT match.
        let event = test_event(ConnectionEventType::Connected, "server1");
        assert_eq!(mgr.match_rules(&event).len(), 0);
    }

    #[test]
    fn match_rules_host_filter() {
        let mut mgr = NotificationManager::new();
        let mut rule = test_rule("r1", vec![ConnectionEventType::Connected]);
        rule.host_filter = Some("*.example.com".to_string());
        mgr.upsert_rule(rule);

        let event1 = test_event(ConnectionEventType::Connected, "web.example.com");
        assert_eq!(mgr.match_rules(&event1).len(), 1);

        let event2 = test_event(ConnectionEventType::Connected, "web.other.com");
        assert_eq!(mgr.match_rules(&event2).len(), 0);
    }

    #[test]
    fn match_rules_protocol_filter() {
        let mut mgr = NotificationManager::new();
        let mut rule = test_rule("r1", vec![ConnectionEventType::Connected]);
        rule.protocol_filter = Some(vec!["RDP".to_string()]);
        mgr.upsert_rule(rule);

        let event = test_event(ConnectionEventType::Connected, "server1");
        // event protocol is "SSH", rule filters for "RDP"
        assert_eq!(mgr.match_rules(&event).len(), 0);
    }

    #[test]
    fn throttling() {
        let mut mgr = NotificationManager::new();
        let mut rule = test_rule("r1", vec![ConnectionEventType::Connected]);
        rule.throttle_seconds = Some(60);
        mgr.upsert_rule(rule.clone());

        assert!(!mgr.is_throttled(&rule));
        mgr.mark_triggered("r1");
        assert!(mgr.is_throttled(mgr.get_rule("r1").unwrap()));
    }

    #[test]
    fn render_default_template() {
        let mgr = NotificationManager::new();
        let event = test_event(ConnectionEventType::Disconnected, "web-01");
        let rule = test_rule("r1", vec![ConnectionEventType::Disconnected]);
        let msg = mgr.render_message(&event, &rule);
        assert!(msg.contains("Disconnected"));
        assert!(msg.contains("web-01"));
        assert!(msg.contains("SSH"));
    }

    #[test]
    fn render_custom_template() {
        let mgr = NotificationManager::new();
        let event = test_event(ConnectionEventType::Connected, "srv");
        let mut rule = test_rule("r1", vec![ConnectionEventType::Connected]);
        rule.template = Some("Alert on {{host}}: {{message}}".to_string());
        let msg = mgr.render_message(&event, &rule);
        assert_eq!(msg, "Alert on srv: Connection timed out");
    }

    #[test]
    fn render_template_with_details() {
        let mut event = test_event(ConnectionEventType::ErrorOccurred, "srv");
        let mut details = HashMap::new();
        details.insert("error_code".to_string(), "E001".to_string());
        event.details = Some(details);

        let _rule = test_rule("r1", vec![ConnectionEventType::ErrorOccurred]);
        let template = "Error {{error_code}} on {{host}}";
        let result = render_template(template, &event);
        assert_eq!(result, "Error E001 on srv");
    }

    #[test]
    fn process_event_flow() {
        let mut mgr = NotificationManager::new();
        mgr.upsert_rule(test_rule("r1", vec![ConnectionEventType::Connected]));
        mgr.upsert_rule(test_rule("r2", vec![ConnectionEventType::Disconnected]));

        let event = test_event(ConnectionEventType::Connected, "host1");
        let to_fire = mgr.process_event(&event);
        assert_eq!(to_fire.len(), 1);
    }

    #[test]
    fn record_and_query_history() {
        let mut mgr = NotificationManager::new();
        mgr.record_result(NotificationResult {
            rule_id: "r1".to_string(),
            rule_name: "Rule 1".to_string(),
            success: true,
            message_id: Some(100),
            error: None,
            timestamp: Utc::now(),
        });
        assert_eq!(mgr.history().len(), 1);
        assert_eq!(mgr.total_sent(), 1);
        mgr.clear_history();
        assert_eq!(mgr.history().len(), 0);
    }

    #[test]
    fn host_matching() {
        assert!(host_matches("web.example.com", "*"));
        assert!(host_matches("web.example.com", "*.example.com"));
        assert!(!host_matches("web.other.com", "*.example.com"));
        assert!(host_matches("web-01.prod", "web-01*"));
        assert!(host_matches("web.example.com", "*example*"));
        assert!(host_matches("SERVER.EXAMPLE.COM", "*.example.com"));
        assert!(host_matches("myhost", "myhost"));
        assert!(!host_matches("myhost", "otherhost"));
    }

    #[test]
    fn severity_ordering() {
        assert!(severity_level(&NotificationSeverity::Info) < severity_level(&NotificationSeverity::Warning));
        assert!(severity_level(&NotificationSeverity::Warning) < severity_level(&NotificationSeverity::Error));
        assert!(severity_level(&NotificationSeverity::Error) < severity_level(&NotificationSeverity::Critical));
    }

    #[test]
    fn default_notification_manager() {
        let mgr = NotificationManager::default();
        assert_eq!(mgr.list_rules().len(), 0);
        assert_eq!(mgr.active_rule_count(), 0);
    }
}
