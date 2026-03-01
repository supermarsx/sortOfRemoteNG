use crate::google_passwords::types::{
    Credential, GooglePasswordsError, SyncInfo, SyncStatus,
};

/// Represents a sync operation that can track changes between local and remote.
pub struct SyncEngine {
    last_synced: Option<chrono::DateTime<chrono::Utc>>,
    pending_additions: Vec<Credential>,
    pending_updates: Vec<Credential>,
    pending_deletions: Vec<String>,
}

impl SyncEngine {
    pub fn new() -> Self {
        Self {
            last_synced: None,
            pending_additions: Vec::new(),
            pending_updates: Vec::new(),
            pending_deletions: Vec::new(),
        }
    }

    pub fn get_info(&self) -> SyncInfo {
        let pending = self.pending_additions.len()
            + self.pending_updates.len()
            + self.pending_deletions.len();

        SyncInfo {
            status: if pending > 0 {
                SyncStatus::Syncing
            } else if self.last_synced.is_some() {
                SyncStatus::Synced
            } else {
                SyncStatus::NotConfigured
            },
            last_synced: self.last_synced.map(|t| t.to_rfc3339()),
            total_synced: 0,
            pending_changes: pending as u64,
            error_message: None,
        }
    }

    /// Queue a credential for addition on next sync.
    pub fn queue_add(&mut self, credential: Credential) {
        self.pending_additions.push(credential);
    }

    /// Queue a credential for update on next sync.
    pub fn queue_update(&mut self, credential: Credential) {
        self.pending_updates.push(credential);
    }

    /// Queue a credential for deletion on next sync.
    pub fn queue_delete(&mut self, id: String) {
        self.pending_deletions.push(id);
    }

    /// Mark sync as completed.
    pub fn mark_synced(&mut self) {
        self.last_synced = Some(chrono::Utc::now());
        self.pending_additions.clear();
        self.pending_updates.clear();
        self.pending_deletions.clear();
    }

    /// Get pending change count.
    pub fn pending_count(&self) -> usize {
        self.pending_additions.len() + self.pending_updates.len() + self.pending_deletions.len()
    }

    /// Merge remote credentials with local ones.
    /// Returns the merged list and a list of conflicts.
    pub fn merge_credentials(
        local: &[Credential],
        remote: &[Credential],
    ) -> (Vec<Credential>, Vec<SyncConflict>) {
        use std::collections::HashMap;

        let mut local_map: HashMap<String, Credential> =
            local.iter().map(|c| (c.id.clone(), c.clone())).collect();
        let mut conflicts = Vec::new();
        let mut merged = Vec::new();

        for remote_cred in remote {
            if let Some(local_cred) = local_map.remove(&remote_cred.id) {
                // Both have this credential — check for conflicts
                if local_cred.password != remote_cred.password
                    || local_cred.username != remote_cred.username
                {
                    conflicts.push(SyncConflict {
                        credential_id: remote_cred.id.clone(),
                        local: local_cred.clone(),
                        remote: remote_cred.clone(),
                    });
                    // Prefer remote (last-write-wins) for the merged list
                    merged.push(remote_cred.clone());
                } else {
                    merged.push(remote_cred.clone());
                }
            } else {
                // Only in remote
                merged.push(remote_cred.clone());
            }
        }

        // Add remaining local-only credentials
        for (_, cred) in local_map {
            merged.push(cred);
        }

        (merged, conflicts)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncConflict {
    pub credential_id: String,
    pub local: Credential,
    pub remote: Credential,
}
