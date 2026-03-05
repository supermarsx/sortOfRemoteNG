//! # Escalation Manager
//!
//! Tracks pending escalation chains and determines which levels are due for
//! delivery based on elapsed time since the initial alert.

use crate::types::{ChannelConfig, EscalationConfig};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A pending escalation record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEscalation {
    /// Unique escalation identifier (usually the notification ID).
    pub id: String,
    /// When the escalation chain was started.
    pub started_at: DateTime<Utc>,
    /// The full escalation configuration.
    pub config: EscalationConfig,
    /// The original event data to include when delivering escalation alerts.
    pub event_data: serde_json::Value,
    /// Index of the next level to fire (0-based).
    pub next_level: usize,
    /// Whether this escalation has been acknowledged (stops further levels).
    pub acknowledged: bool,
}

/// An escalation level that is ready to fire.
#[derive(Debug, Clone)]
pub struct DueEscalation {
    /// The escalation ID.
    pub id: String,
    /// The level index that is due.
    pub level: usize,
    /// The channels configured for this escalation level.
    pub channels: Vec<ChannelConfig>,
    /// The original event data.
    pub event_data: serde_json::Value,
}

/// Manages active escalation chains.
pub struct EscalationManager {
    /// Active (unacknowledged) escalation chains keyed by ID.
    pending: HashMap<String, PendingEscalation>,
}

impl EscalationManager {
    /// Create a new, empty escalation manager.
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    /// Start a new escalation chain.
    ///
    /// If an escalation with the same ID already exists it is replaced.
    pub fn start_escalation(
        &mut self,
        id: &str,
        config: &EscalationConfig,
        event_data: serde_json::Value,
    ) {
        let escalation = PendingEscalation {
            id: id.to_string(),
            started_at: Utc::now(),
            config: config.clone(),
            event_data,
            next_level: 0,
            acknowledged: false,
        };
        self.pending.insert(id.to_string(), escalation);
    }

    /// Cancel (remove) an escalation chain, preventing further levels.
    pub fn cancel_escalation(&mut self, id: &str) {
        self.pending.remove(id);
    }

    /// Acknowledge an escalation, stopping further levels from firing.
    /// The escalation record is kept for reference but marked as acknowledged.
    pub fn acknowledge(&mut self, id: &str) -> bool {
        if let Some(esc) = self.pending.get_mut(id) {
            esc.acknowledged = true;
            true
        } else {
            false
        }
    }

    /// Check all pending escalations and return any levels whose delay has
    /// elapsed since the chain started. Advances `next_level` on each returned
    /// escalation so the same level is not returned twice.
    pub fn check_escalations(&mut self) -> Vec<DueEscalation> {
        let now = Utc::now();
        let mut due = Vec::new();

        for esc in self.pending.values_mut() {
            if esc.acknowledged {
                continue;
            }

            let elapsed_minutes = (now - esc.started_at).num_minutes().max(0) as u64;

            // Fire all levels whose delay has been reached but haven't been
            // fired yet (next_level tracks the frontier).
            while esc.next_level < esc.config.levels.len() {
                let level = &esc.config.levels[esc.next_level];
                if elapsed_minutes >= level.delay_minutes {
                    // If the level has an optional condition, we evaluate it
                    // as a simple truthiness check on the event data field.
                    let should_fire = match &level.condition {
                        Some(field) => {
                            let val = resolve_field(&esc.event_data, field);
                            match val {
                                Some(serde_json::Value::Bool(false)) | Some(serde_json::Value::Null) | None => false,
                                _ => true,
                            }
                        }
                        None => true,
                    };

                    if should_fire {
                        due.push(DueEscalation {
                            id: esc.id.clone(),
                            level: esc.next_level,
                            channels: level.channels.clone(),
                            event_data: esc.event_data.clone(),
                        });
                    }
                    esc.next_level += 1;
                } else {
                    break;
                }
            }
        }

        // Clean up fully-escalated or acknowledged chains.
        self.pending.retain(|_, esc| {
            !esc.acknowledged && esc.next_level < esc.config.levels.len()
        });

        due
    }

    /// Return the number of active (unacknowledged) escalation chains.
    pub fn active_count(&self) -> usize {
        self.pending.values().filter(|e| !e.acknowledged).count()
    }

    /// List all pending escalation IDs.
    pub fn list_pending(&self) -> Vec<String> {
        self.pending.keys().cloned().collect()
    }
}

/// Resolve a dot-separated field path in a JSON value.
fn resolve_field<'a>(data: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = data;
    for segment in path.split('.') {
        match current {
            serde_json::Value::Object(map) => {
                current = map.get(segment)?;
            }
            serde_json::Value::Array(arr) => {
                let idx: usize = segment.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{EscalationConfig, EscalationLevel, ChannelConfig};

    fn make_config() -> EscalationConfig {
        EscalationConfig {
            levels: vec![
                EscalationLevel {
                    delay_minutes: 0,
                    channels: vec![ChannelConfig::Desktop {
                        title: "L0".into(),
                        body: "Level 0".into(),
                        sound: None,
                        urgent: None,
                    }],
                    condition: None,
                },
                EscalationLevel {
                    delay_minutes: 5,
                    channels: vec![ChannelConfig::Desktop {
                        title: "L1".into(),
                        body: "Level 1".into(),
                        sound: Some(true),
                        urgent: Some(true),
                    }],
                    condition: None,
                },
            ],
        }
    }

    #[test]
    fn immediate_level_fires() {
        let mut mgr = EscalationManager::new();
        mgr.start_escalation("esc1", &make_config(), serde_json::json!({}));
        let due = mgr.check_escalations();
        // Level 0 has delay_minutes=0 so it fires immediately.
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].level, 0);
    }

    #[test]
    fn acknowledge_stops_escalation() {
        let mut mgr = EscalationManager::new();
        mgr.start_escalation("esc1", &make_config(), serde_json::json!({}));
        mgr.acknowledge("esc1");
        let due = mgr.check_escalations();
        assert!(due.is_empty());
    }

    #[test]
    fn cancel_removes_escalation() {
        let mut mgr = EscalationManager::new();
        mgr.start_escalation("esc1", &make_config(), serde_json::json!({}));
        mgr.cancel_escalation("esc1");
        assert_eq!(mgr.active_count(), 0);
    }
}
