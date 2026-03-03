//! # MCP Logging
//!
//! Structured logging via MCP notifications. Allows log messages to be
//! sent to connected clients that have the logging capability.

use crate::types::*;
use crate::protocol;
use chrono::Utc;
use std::collections::VecDeque;

/// Maximum number of log entries to keep in the buffer.
const MAX_LOG_BUFFER: usize = 500;

/// Log buffer for recent MCP log entries.
#[derive(Debug)]
pub struct McpLogBuffer {
    entries: VecDeque<McpLogEntry>,
    min_level: McpLogLevel,
}

/// A single log entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLogEntry {
    pub id: String,
    pub level: McpLogLevel,
    pub logger: String,
    pub message: String,
    pub timestamp: chrono::DateTime<Utc>,
    pub data: Option<serde_json::Value>,
}

impl McpLogBuffer {
    pub fn new(min_level: McpLogLevel) -> Self {
        Self {
            entries: VecDeque::with_capacity(MAX_LOG_BUFFER),
            min_level,
        }
    }

    /// Set the minimum log level.
    pub fn set_level(&mut self, level: McpLogLevel) {
        self.min_level = level;
    }

    /// Get the current minimum log level.
    pub fn get_level(&self) -> McpLogLevel {
        self.min_level
    }

    /// Add a log entry if it meets the minimum level.
    pub fn log(
        &mut self,
        level: McpLogLevel,
        logger: &str,
        message: &str,
        data: Option<serde_json::Value>,
    ) -> Option<McpLogEntry> {
        if !self.should_log(level) {
            return None;
        }

        let entry = McpLogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            level,
            logger: logger.to_string(),
            message: message.to_string(),
            timestamp: Utc::now(),
            data,
        };

        if self.entries.len() >= MAX_LOG_BUFFER {
            self.entries.pop_front();
        }
        self.entries.push_back(entry.clone());
        Some(entry)
    }

    /// Check if a level should be logged.
    fn should_log(&self, level: McpLogLevel) -> bool {
        level_priority(level) >= level_priority(self.min_level)
    }

    /// Get recent log entries.
    pub fn get_entries(&self, limit: usize) -> Vec<McpLogEntry> {
        self.entries
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    /// Clear all log entries.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Get total entry count.
    pub fn count(&self) -> usize {
        self.entries.len()
    }
}

/// Build a JSON-RPC log notification from a log entry.
pub fn entry_to_notification(entry: &McpLogEntry) -> JsonRpcNotification {
    protocol::build_log_notification(
        entry.level,
        &entry.logger,
        serde_json::json!({
            "message": entry.message,
            "timestamp": entry.timestamp.to_rfc3339(),
            "data": entry.data,
        }),
    )
}

/// Get the priority of a log level (higher = more severe).
fn level_priority(level: McpLogLevel) -> u8 {
    match level {
        McpLogLevel::Debug => 0,
        McpLogLevel::Info => 1,
        McpLogLevel::Warning => 2,
        McpLogLevel::Error => 3,
        McpLogLevel::Critical => 4,
        McpLogLevel::Alert => 5,
        McpLogLevel::Emergency => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_buffer_basic() {
        let mut buf = McpLogBuffer::new(McpLogLevel::Info);
        let entry = buf.log(McpLogLevel::Info, "test", "hello", None);
        assert!(entry.is_some());
        assert_eq!(buf.count(), 1);
    }

    #[test]
    fn test_log_level_filtering() {
        let mut buf = McpLogBuffer::new(McpLogLevel::Warning);
        let debug = buf.log(McpLogLevel::Debug, "test", "debug msg", None);
        let info = buf.log(McpLogLevel::Info, "test", "info msg", None);
        let warn = buf.log(McpLogLevel::Warning, "test", "warn msg", None);
        let error = buf.log(McpLogLevel::Error, "test", "error msg", None);
        assert!(debug.is_none());
        assert!(info.is_none());
        assert!(warn.is_some());
        assert!(error.is_some());
        assert_eq!(buf.count(), 2);
    }

    #[test]
    fn test_log_buffer_limit() {
        let mut buf = McpLogBuffer::new(McpLogLevel::Debug);
        for i in 0..600 {
            buf.log(McpLogLevel::Info, "test", &format!("msg {i}"), None);
        }
        assert_eq!(buf.count(), MAX_LOG_BUFFER);
    }

    #[test]
    fn test_get_entries() {
        let mut buf = McpLogBuffer::new(McpLogLevel::Debug);
        buf.log(McpLogLevel::Info, "a", "first", None);
        buf.log(McpLogLevel::Info, "b", "second", None);
        buf.log(McpLogLevel::Info, "c", "third", None);
        let entries = buf.get_entries(2);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "second");
        assert_eq!(entries[1].message, "third");
    }
}
