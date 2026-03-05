// ─── Topology error types ────────────────────────────────────────────────────

use std::fmt;

/// All errors that the topology engine can produce.
#[derive(Debug, Clone)]
pub enum TopologyError {
    NodeNotFound(String),
    EdgeNotFound(String),
    GroupNotFound(String),
    CycleDetected,
    LayoutError(String),
    SnapshotNotFound(String),
    SerializationError(String),
}

impl fmt::Display for TopologyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TopologyError::NodeNotFound(id) => write!(f, "Node not found: {id}"),
            TopologyError::EdgeNotFound(id) => write!(f, "Edge not found: {id}"),
            TopologyError::GroupNotFound(id) => write!(f, "Group not found: {id}"),
            TopologyError::CycleDetected => write!(f, "Cycle detected in topology graph"),
            TopologyError::LayoutError(msg) => write!(f, "Layout error: {msg}"),
            TopologyError::SnapshotNotFound(id) => write!(f, "Snapshot not found: {id}"),
            TopologyError::SerializationError(msg) => write!(f, "Serialization error: {msg}"),
        }
    }
}

impl std::error::Error for TopologyError {}

impl From<serde_json::Error> for TopologyError {
    fn from(err: serde_json::Error) -> Self {
        TopologyError::SerializationError(err.to_string())
    }
}
