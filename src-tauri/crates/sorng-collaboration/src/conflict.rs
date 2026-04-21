//! # Conflict Resolution
//!
//! Vector-clock based conflict resolution for concurrent edits to shared resources.
//! Uses a last-writer-wins strategy with causal ordering awareness.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Resolves conflicts between concurrent sync operations.
pub struct ConflictResolver {
    /// Conflict resolution strategy
    strategy: ConflictStrategy,
    /// History of resolved conflicts (for audit/debugging)
    resolved_conflicts: Vec<ResolvedConflict>,
}

/// Strategies for resolving concurrent edits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConflictStrategy {
    /// Last writer (by wall-clock time) wins — simplest, good for most cases
    LastWriterWins,
    /// First writer wins — more conservative
    FirstWriterWins,
    /// Keep both versions and flag for manual resolution
    ManualResolution,
    /// Merge field-by-field (if applicable)
    FieldMerge,
}

/// A record of a resolved conflict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedConflict {
    /// Unique conflict ID
    pub id: String,
    /// The resource that had conflicting changes
    pub resource_id: String,
    /// The "winning" operation
    pub winner_op_id: String,
    /// The "losing" operation(s)
    pub loser_op_ids: Vec<String>,
    /// The strategy used to resolve
    pub strategy_used: ConflictStrategy,
    /// When the conflict was resolved
    pub resolved_at: chrono::DateTime<chrono::Utc>,
    /// Human-readable description
    pub description: String,
}

/// A conflict to be resolved.
#[derive(Debug, Clone)]
pub struct ConflictPair {
    pub op_a: SyncOperation,
    pub op_b: SyncOperation,
}

impl Default for ConflictResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl ConflictResolver {
    pub fn new() -> Self {
        Self {
            strategy: ConflictStrategy::LastWriterWins,
            resolved_conflicts: Vec::new(),
        }
    }

    /// Set the conflict resolution strategy.
    pub fn set_strategy(&mut self, strategy: ConflictStrategy) {
        self.strategy = strategy;
    }

    /// Get the current strategy.
    pub fn strategy(&self) -> ConflictStrategy {
        self.strategy
    }

    /// Detect conflicts between two operations on the same resource.
    pub fn detect_conflict(&self, op_a: &SyncOperation, op_b: &SyncOperation) -> bool {
        if op_a.resource_id != op_b.resource_id || op_a.workspace_id != op_b.workspace_id {
            return false;
        }
        matches!(
            op_a.vector_clock.partial_cmp_causal(&op_b.vector_clock),
            CausalOrdering::Concurrent
        )
    }

    /// Resolve a conflict between two concurrent operations.
    /// Returns the "winning" operation.
    pub fn resolve(&mut self, conflict: ConflictPair) -> ResolvedConflict {
        let (winner, loser) = match self.strategy {
            ConflictStrategy::LastWriterWins => {
                if conflict.op_a.timestamp >= conflict.op_b.timestamp {
                    (&conflict.op_a, &conflict.op_b)
                } else {
                    (&conflict.op_b, &conflict.op_a)
                }
            }
            ConflictStrategy::FirstWriterWins => {
                if conflict.op_a.timestamp <= conflict.op_b.timestamp {
                    (&conflict.op_a, &conflict.op_b)
                } else {
                    (&conflict.op_b, &conflict.op_a)
                }
            }
            ConflictStrategy::ManualResolution | ConflictStrategy::FieldMerge => {
                // For manual/field-merge, we default to LWW but flag it
                if conflict.op_a.timestamp >= conflict.op_b.timestamp {
                    (&conflict.op_a, &conflict.op_b)
                } else {
                    (&conflict.op_b, &conflict.op_a)
                }
            }
        };

        let resolved = ResolvedConflict {
            id: uuid::Uuid::new_v4().to_string(),
            resource_id: winner.resource_id.clone(),
            winner_op_id: winner.id.clone(),
            loser_op_ids: vec![loser.id.clone()],
            strategy_used: self.strategy,
            resolved_at: chrono::Utc::now(),
            description: format!(
                "Conflict on resource {} resolved: {} won over {} ({:?})",
                winner.resource_id, winner.origin_node, loser.origin_node, self.strategy
            ),
        };

        log::info!("[CONFLICT] {}", resolved.description);
        self.resolved_conflicts.push(resolved.clone());
        resolved
    }

    /// Resolve conflicts in a batch of operations for a workspace.
    /// Returns operations in resolved order (no remaining conflicts).
    pub fn resolve_batch(&mut self, mut operations: Vec<SyncOperation>) -> Vec<SyncOperation> {
        // Sort by timestamp first as a baseline
        operations.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

        // Group by resource
        let mut by_resource: std::collections::HashMap<String, Vec<SyncOperation>> =
            std::collections::HashMap::new();
        for op in operations {
            by_resource
                .entry(op.resource_id.clone())
                .or_default()
                .push(op);
        }

        let mut resolved_ops = Vec::new();

        for (_resource_id, resource_ops) in by_resource {
            if resource_ops.len() <= 1 {
                resolved_ops.extend(resource_ops);
                continue;
            }

            // Check each pair for conflicts
            let mut winners: Vec<SyncOperation> = Vec::new();
            let mut remaining = resource_ops;

            while let Some(current) = remaining.pop() {
                let mut is_winner = true;
                let mut new_remaining = Vec::new();

                for other in remaining.drain(..) {
                    if self.detect_conflict(&current, &other) {
                        let conflict = ConflictPair {
                            op_a: current.clone(),
                            op_b: other.clone(),
                        };
                        let resolved = self.resolve(conflict);
                        if resolved.winner_op_id == other.id {
                            is_winner = false;
                            new_remaining.push(other);
                        } else {
                            // current wins, other is discarded
                        }
                    } else {
                        new_remaining.push(other);
                    }
                }

                remaining = new_remaining;
                if is_winner {
                    winners.push(current);
                }
            }

            resolved_ops.extend(winners);
        }

        // Final sort by timestamp
        resolved_ops.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        resolved_ops
    }

    /// Get the history of resolved conflicts.
    pub fn resolved_conflicts(&self) -> &[ResolvedConflict] {
        &self.resolved_conflicts
    }

    /// Get resolved conflict count.
    pub fn conflict_count(&self) -> usize {
        self.resolved_conflicts.len()
    }
}
