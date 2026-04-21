//! # Audit Log
//!
//! Immutable, append-only audit log for all collaboration activities.
//! Provides compliance-grade tracking of who did what, when, and where.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Immutable audit log for all collaboration events.
pub struct AuditLog {
    /// Audit entries indexed by workspace_id → Vec<AuditEntry>
    entries: HashMap<String, Vec<AuditEntry>>,
    /// Global entries (not workspace-specific)
    global_entries: Vec<AuditEntry>,
    /// Persistence directory
    data_dir: String,
}

impl AuditLog {
    pub fn new(data_dir: &str) -> Self {
        let mut audit = Self {
            entries: HashMap::new(),
            global_entries: Vec::new(),
            data_dir: data_dir.to_string(),
        };
        audit.load_from_disk();
        audit
    }

    /// Log an auditable action.
    #[allow(clippy::too_many_arguments)]
    pub fn log_action(
        &mut self,
        user_id: &str,
        workspace_id: Option<&str>,
        action: AuditAction,
        resource_id: Option<&str>,
        resource_type: Option<ResourceType>,
        description: String,
        metadata: Option<serde_json::Value>,
    ) {
        let entry = AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            user_id: user_id.to_string(),
            workspace_id: workspace_id.map(|s| s.to_string()),
            action,
            resource_id: resource_id.map(|s| s.to_string()),
            resource_type,
            description,
            metadata,
            client_ip: None,
        };

        log::info!(
            "[AUDIT] user={} action={:?} workspace={:?} resource={:?} — {}",
            entry.user_id,
            entry.action,
            entry.workspace_id,
            entry.resource_id,
            entry.description
        );

        if let Some(ws_id) = workspace_id {
            let ws_entries = self.entries.entry(ws_id.to_string()).or_default();
            ws_entries.push(entry);
        } else {
            self.global_entries.push(entry);
        }

        self.persist();
    }

    /// Query the audit log for a specific workspace.
    pub fn query(
        &self,
        workspace_id: &str,
        limit: usize,
        action_filter: Option<AuditAction>,
    ) -> Vec<AuditEntry> {
        let entries = self
            .entries
            .get(workspace_id)
            .map(|e| e.as_slice())
            .unwrap_or(&[]);

        let filtered: Vec<AuditEntry> = entries
            .iter()
            .rev()
            .filter(|e| {
                if let Some(filter) = &action_filter {
                    e.action == *filter
                } else {
                    true
                }
            })
            .take(limit)
            .cloned()
            .collect();

        filtered
    }

    /// Query global (non-workspace) audit entries.
    pub fn query_global(&self, limit: usize) -> Vec<AuditEntry> {
        self.global_entries
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get audit entries for a specific user across all workspaces.
    pub fn query_by_user(&self, user_id: &str, limit: usize) -> Vec<AuditEntry> {
        let mut all_entries: Vec<&AuditEntry> = self
            .entries
            .values()
            .flat_map(|entries| entries.iter())
            .chain(self.global_entries.iter())
            .filter(|e| e.user_id == user_id)
            .collect();

        all_entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        all_entries.into_iter().take(limit).cloned().collect()
    }

    /// Get audit entries for a specific resource.
    pub fn query_by_resource(
        &self,
        workspace_id: &str,
        resource_id: &str,
        limit: usize,
    ) -> Vec<AuditEntry> {
        let entries = self
            .entries
            .get(workspace_id)
            .map(|e| e.as_slice())
            .unwrap_or(&[]);

        entries
            .iter()
            .rev()
            .filter(|e| e.resource_id.as_deref() == Some(resource_id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get the total count of audit entries.
    pub fn total_entries(&self) -> usize {
        self.entries.values().map(|e| e.len()).sum::<usize>() + self.global_entries.len()
    }

    /// Export audit log as JSON for compliance reports.
    pub fn export_json(&self, workspace_id: &str) -> Result<String, String> {
        let entries = self
            .entries
            .get(workspace_id)
            .map(|e| e.as_slice())
            .unwrap_or(&[]);
        serde_json::to_string_pretty(entries)
            .map_err(|e| format!("Failed to serialize audit log: {}", e))
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_audit.json");
        let data = serde_json::json!({
            "workspace_entries": self.entries,
            "global_entries": self.global_entries,
        });
        if let Ok(json) = serde_json::to_string_pretty(&data) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("collaboration_audit.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(ws) = json.get("workspace_entries") {
                    if let Ok(entries) = serde_json::from_value(ws.clone()) {
                        self.entries = entries;
                    }
                }
                if let Some(global) = json.get("global_entries") {
                    if let Ok(entries) = serde_json::from_value(global.clone()) {
                        self.global_entries = entries;
                    }
                }
            }
        }
    }
}
