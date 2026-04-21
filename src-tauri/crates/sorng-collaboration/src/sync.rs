//! # Sync Engine
//!
//! Real-time synchronization engine using vector clocks for causal ordering.
//! Handles operation distribution across collaborating nodes.

use crate::types::*;
use std::collections::HashMap;

/// The sync engine manages operation queues and distributes changes
/// across all connected collaboration nodes.
pub struct SyncEngine {
    /// Operations indexed by workspace_id → Vec<SyncOperation>
    operations: HashMap<String, Vec<SyncOperation>>,
    /// Current vector clock for the local node
    local_clock: VectorClock,
    /// Local node identifier
    node_id: String,
}

impl Default for SyncEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SyncEngine {
    pub fn new() -> Self {
        let node_id = uuid::Uuid::new_v4().to_string();
        Self {
            operations: HashMap::new(),
            local_clock: VectorClock::new(),
            node_id,
        }
    }

    /// Push a new sync operation to the queue.
    pub fn push(&mut self, mut op: SyncOperation) {
        // Update local vector clock
        self.local_clock.tick(&self.node_id);
        op.vector_clock = self.local_clock.clone();
        op.origin_node = self.node_id.clone();

        let workspace_ops = self.operations.entry(op.workspace_id.clone()).or_default();
        workspace_ops.push(op);
    }

    /// Pull operations for a workspace that are causally after the given clock.
    pub fn pull(&self, workspace_id: &str, since_clock: &VectorClock) -> Vec<SyncOperation> {
        if let Some(ops) = self.operations.get(workspace_id) {
            ops.iter()
                .filter(|op| {
                    matches!(
                        since_clock.partial_cmp_causal(&op.vector_clock),
                        CausalOrdering::Before | CausalOrdering::Concurrent
                    )
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Merge remote operations into the local operation log.
    pub fn merge_remote(&mut self, remote_ops: Vec<SyncOperation>) {
        for op in remote_ops {
            self.local_clock.merge(&op.vector_clock);
            let workspace_ops = self.operations.entry(op.workspace_id.clone()).or_default();

            // Avoid duplicates
            if !workspace_ops.iter().any(|existing| existing.id == op.id) {
                workspace_ops.push(op);
            }
        }
    }

    /// Get the current local vector clock.
    pub fn local_clock(&self) -> &VectorClock {
        &self.local_clock
    }

    /// Get the local node ID.
    pub fn node_id(&self) -> &str {
        &self.node_id
    }

    /// Get all operations for a workspace.
    pub fn get_workspace_operations(&self, workspace_id: &str) -> Vec<&SyncOperation> {
        self.operations
            .get(workspace_id)
            .map(|ops| ops.iter().collect())
            .unwrap_or_default()
    }

    /// Get total operation count across all workspaces.
    pub fn total_operation_count(&self) -> usize {
        self.operations.values().map(|ops| ops.len()).sum()
    }

    /// Compact the operation log by removing operations older than a threshold.
    /// Keeps the most recent `keep_count` operations per workspace.
    pub fn compact(&mut self, keep_count: usize) {
        for ops in self.operations.values_mut() {
            if ops.len() > keep_count {
                let drain_count = ops.len() - keep_count;
                ops.drain(..drain_count);
            }
        }
    }

    /// Clear all operations for a workspace (used after full re-sync).
    pub fn clear_workspace(&mut self, workspace_id: &str) {
        self.operations.remove(workspace_id);
    }
}
