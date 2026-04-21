//! # Notification Service
//!
//! Top-level orchestration service that ties together the rule engine, template
//! engine, throttle manager, escalation manager, and notification history.
//! Provides the main `process_event` pipeline and Tauri-compatible state.

use crate::channels;
use crate::escalation::EscalationManager;
use crate::history::NotificationHistory;
use crate::rules::RuleEngine;
use crate::templates::TemplateEngine;
use crate::throttle::{self, ThrottleManager};
use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-managed state handle for the notification service.
pub type NotificationServiceState = Arc<Mutex<NotificationService>>;

/// The top-level notification service coordinating all subsystems.
pub struct NotificationService {
    /// Rule engine holding all registered notification rules.
    pub rules: RuleEngine,
    /// Template engine for rendering notification content.
    pub templates: TemplateEngine,
    /// Throttle manager for rate-limiting.
    pub throttle: ThrottleManager,
    /// Escalation manager for time-based alert escalation.
    pub escalation: EscalationManager,
    /// Notification history storage.
    pub history: NotificationHistory,
    /// Global configuration.
    pub config: NotificationsConfig,
}

impl NotificationService {
    /// Create a new notification service with default configuration.
    pub fn new() -> NotificationServiceState {
        Self::with_config(NotificationsConfig::default())
    }

    /// Create a new notification service with the given configuration.
    pub fn with_config(config: NotificationsConfig) -> NotificationServiceState {
        let max_history = config.max_history_size;
        Arc::new(Mutex::new(Self {
            rules: RuleEngine::new(),
            templates: TemplateEngine::new(),
            throttle: ThrottleManager::new(),
            escalation: EscalationManager::new(),
            history: NotificationHistory::new(max_history),
            config,
        }))
    }

    /// Main event processing pipeline.
    ///
    /// 1. Checks the global enabled flag and quiet hours.
    /// 2. Finds all matching rules for the trigger and event data.
    /// 3. For each matching rule: checks throttle, renders template, delivers
    ///    to all configured channels, records history, and starts escalation
    ///    chains if configured.
    ///
    /// Returns the notification records produced (one per channel per rule).
    pub async fn process_event(
        &mut self,
        trigger: NotificationTrigger,
        data: serde_json::Value,
    ) -> Vec<NotificationRecord> {
        if !self.config.enabled {
            info!("notifications disabled globally; ignoring event");
            return Vec::new();
        }

        let mut records = Vec::new();

        // Collect matching rules. We need to clone because we'll mutably borrow
        // other fields during delivery.
        let matching: Vec<NotificationRule> = self
            .rules
            .get_matching_rules(&data, &trigger)
            .into_iter()
            .cloned()
            .collect();

        if matching.is_empty() {
            return records;
        }

        for rule in &matching {
            // ── Quiet hours check ───────────────────────────────────
            if self.is_quiet_hours(&rule.priority) {
                info!(
                    "rule '{}' suppressed during quiet hours (priority: {})",
                    rule.name, rule.priority
                );
                continue;
            }

            // ── Resolve template variables ──────────────────────────
            let variables = Self::extract_variables(&data);
            let (title, body) = self.resolve_template(rule, &variables);

            // ── Throttle check ──────────────────────────────────────
            let group_key = throttle::derive_group_key(
                &data,
                &rule.throttle.as_ref().and_then(|t| t.group_by.clone()),
            );

            if let Some(ref tc) = rule.throttle {
                if self.throttle.should_throttle(&rule.id, &group_key, tc) {
                    info!("rule '{}' throttled for group '{}'", rule.name, group_key);
                    continue;
                }

                // Duplicate suppression
                let hash = throttle::content_hash(&title, &body);
                if self.throttle.is_duplicate(&rule.id, &group_key, hash, tc) {
                    info!("rule '{}' duplicate suppressed", rule.name);
                    continue;
                }

                self.throttle.record_send(&rule.id, &group_key);
                self.throttle.record_hash(&rule.id, &group_key, hash);
            }

            // Also obey the global throttle if set.
            if let Some(ref gt) = self.config.global_throttle {
                if self.throttle.should_throttle("__global__", &group_key, gt) {
                    info!("global throttle exceeded for group '{}'", group_key);
                    continue;
                }
                self.throttle.record_send("__global__", &group_key);
            }

            // ── Determine channels ──────────────────────────────────
            let channels = if rule.channels.is_empty() {
                &self.config.default_channels
            } else {
                &rule.channels
            };

            // ── Deliver to each channel ─────────────────────────────
            for channel_cfg in channels {
                let delivery_result =
                    channels::deliver_notification(channel_cfg, &title, &body, &data).await;

                let record = NotificationRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    rule_id: rule.id.clone(),
                    rule_name: rule.name.clone(),
                    channel: channel_cfg.channel_label().to_string(),
                    priority: rule.priority.clone(),
                    title: title.clone(),
                    body: body.clone(),
                    sent_at: Utc::now(),
                    delivered: delivery_result.is_ok(),
                    error: delivery_result.err().map(|e| e.to_string()),
                    event_data: Some(data.clone()),
                };

                self.history.add(record.clone());
                records.push(record);
            }

            // ── Start escalation chain if configured ────────────────
            if let Some(ref esc_config) = rule.escalation {
                let esc_id = format!("{}_{}", rule.id, Utc::now().timestamp_millis());
                self.escalation
                    .start_escalation(&esc_id, esc_config, data.clone());
                info!(
                    "escalation chain '{}' started for rule '{}'",
                    esc_id, rule.name
                );
            }
        }

        // Periodic cleanup
        self.throttle.cleanup_expired_windows();

        records
    }

    /// Check pending escalations and deliver any due levels.
    pub async fn process_escalations(&mut self) -> Vec<NotificationRecord> {
        let mut records = Vec::new();
        let due = self.escalation.check_escalations();

        for esc in due {
            for channel_cfg in &esc.channels {
                let title = format!("[ESCALATION L{}] Alert {}", esc.level, esc.id);
                let body = format!(
                    "Escalation level {} triggered for alert {}",
                    esc.level, esc.id
                );
                let delivery_result =
                    channels::deliver_notification(channel_cfg, &title, &body, &esc.event_data)
                        .await;

                let record = NotificationRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    rule_id: format!("escalation_{}", esc.id),
                    rule_name: format!("Escalation {}", esc.id),
                    channel: channel_cfg.channel_label().to_string(),
                    priority: NotificationPriority::Critical,
                    title,
                    body,
                    sent_at: Utc::now(),
                    delivered: delivery_result.is_ok(),
                    error: delivery_result.err().map(|e| e.to_string()),
                    event_data: Some(esc.event_data.clone()),
                };

                self.history.add(record.clone());
                records.push(record);
            }
        }

        records
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// Resolve the template for a rule: use the rule's template_id if set,
    /// otherwise produce a simple default title/body from variables.
    fn resolve_template(
        &self,
        rule: &NotificationRule,
        variables: &HashMap<String, String>,
    ) -> (String, String) {
        if let Some(ref tmpl_id) = rule.template_id {
            if let Ok((t, b)) = self.templates.render_by_id(tmpl_id, variables) {
                return (t, b);
            }
            warn!(
                "template '{}' not found for rule '{}', falling back to default",
                tmpl_id, rule.name
            );
        }

        // Fallback: construct from rule name + summary of variables.
        let title = format!("[{}] {}", rule.priority, rule.name);
        let body = variables
            .iter()
            .map(|(k, v)| format!("{}: {}", k, v))
            .collect::<Vec<_>>()
            .join("\n");
        (title, body)
    }

    /// Extract template variables from event data by flattening the top-level
    /// JSON object keys into a `String → String` map.
    fn extract_variables(data: &serde_json::Value) -> HashMap<String, String> {
        let mut vars = HashMap::new();
        if let serde_json::Value::Object(map) = data {
            for (key, value) in map {
                let v = match value {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Null => String::new(),
                    other => other.to_string(),
                };
                vars.insert(key.clone(), v);
            }
        }
        // Always inject a timestamp variable.
        vars.entry("timestamp".into())
            .or_insert_with(|| Utc::now().to_rfc3339());
        vars
    }

    /// Check whether the current time falls within configured quiet hours.
    /// Critical-priority notifications may bypass quiet hours if configured.
    fn is_quiet_hours(&self, priority: &NotificationPriority) -> bool {
        let Some(ref qh) = self.config.quiet_hours else {
            return false;
        };
        if !qh.enabled {
            return false;
        }
        if qh.override_for_critical && *priority == NotificationPriority::Critical {
            return false;
        }

        // Parse HH:MM times and compare against the current wall-clock time
        // (UTC for simplicity; a full implementation would convert to qh.timezone).
        let now = Utc::now();
        let current_minutes = now.format("%H:%M").to_string();

        if qh.start_time <= qh.end_time {
            // Same-day window: e.g. 22:00–06:00 does NOT satisfy this branch.
            current_minutes >= qh.start_time && current_minutes < qh.end_time
        } else {
            // Overnight window: e.g. 22:00–06:00.
            current_minutes >= qh.start_time || current_minutes < qh.end_time
        }
    }
}
