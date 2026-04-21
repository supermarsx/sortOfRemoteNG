// ── sorng-prometheus/src/recording.rs ────────────────────────────────────────
//! Recording rule helpers – extracts recording rules from /api/v1/rules.

use crate::client::PrometheusClient;
use crate::error::PrometheusResult;
use crate::rules::RuleManager;
use crate::types::*;

pub struct RecordingManager;

impl RecordingManager {
    /// List all recording rules across all groups.
    pub async fn list(client: &PrometheusClient) -> PrometheusResult<Vec<RecordingRule>> {
        let groups = RuleManager::list(client, Some("record")).await?;
        let mut rules = Vec::new();
        for group in groups {
            for rule_val in group.rules {
                if let Ok(rec) = serde_json::from_value::<RecordingRule>(rule_val) {
                    rules.push(rec);
                }
            }
        }
        Ok(rules)
    }

    /// List recording rules for a specific group by name.
    pub async fn get_group_rules(
        client: &PrometheusClient,
        group_name: &str,
    ) -> PrometheusResult<Vec<RecordingRule>> {
        let group = RuleManager::get_group(client, group_name).await?;
        let mut rules = Vec::new();
        for rule_val in group.rules {
            if let Ok(rec) = serde_json::from_value::<RecordingRule>(rule_val) {
                rules.push(rec);
            }
        }
        Ok(rules)
    }
}
