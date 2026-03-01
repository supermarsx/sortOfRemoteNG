//! Remote Windows Event Log management via WMI (Win32_NTLogEvent).
//!
//! Provides operations for querying, filtering, and managing event log entries
//! on remote Windows hosts through the WMI-over-WinRM transport.

use crate::transport::{parse_wmi_datetime, WmiTransport};
use crate::types::*;
use crate::wql::{WqlBuilder, WqlQueries};
use chrono::Utc;
use log::{debug, info};
use std::collections::HashMap;

/// Manages remote Windows Event Logs via WMI.
pub struct EventLogManager;

impl EventLogManager {
    // ─── Log Metadata ────────────────────────────────────────────────

    /// List available event logs on the remote host.
    pub async fn list_logs(
        transport: &mut WmiTransport,
    ) -> Result<Vec<EventLogInfo>, String> {
        let query = WqlQueries::event_log_list();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_log_info(r)).collect())
    }

    /// Get metadata for a specific log.
    pub async fn get_log_info(
        transport: &mut WmiTransport,
        log_name: &str,
    ) -> Result<EventLogInfo, String> {
        let query = WqlBuilder::select("Win32_NTEventlogFile")
            .where_eq("LogfileName", log_name)
            .build();
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or_else(|| format!("Event log '{}' not found", log_name))?;
        Ok(Self::row_to_log_info(row))
    }

    /// Get unique event sources for a specific log.
    pub async fn get_event_sources(
        transport: &mut WmiTransport,
        log_name: &str,
    ) -> Result<Vec<String>, String> {
        let query = WqlBuilder::select("Win32_NTLogEvent")
            .fields(&["SourceName"])
            .where_eq("Logfile", log_name)
            .build();
        let rows = transport.wql_query(&query).await?;

        let mut sources: Vec<String> = rows
            .iter()
            .filter_map(|r| r.get("SourceName").cloned())
            .collect();

        // Deduplicate
        sources.sort();
        sources.dedup();
        Ok(sources)
    }

    // ─── Query Events ────────────────────────────────────────────────

    /// Query event log entries with a filter.
    pub async fn query_events(
        transport: &mut WmiTransport,
        filter: &EventLogFilter,
    ) -> Result<Vec<EventLogEntry>, String> {
        let query = Self::build_event_query(filter);
        debug!("Event log query: {}", query);

        let rows = transport.wql_query(&query).await?;

        let mut entries: Vec<EventLogEntry> = rows
            .iter()
            .map(|r| Self::row_to_event(r))
            .collect();

        // Apply client-side message filter if specified
        if let Some(ref msg_filter) = filter.message_contains {
            let lower = msg_filter.to_lowercase();
            entries.retain(|e| {
                e.message
                    .as_ref()
                    .map(|m| m.to_lowercase().contains(&lower))
                    .unwrap_or(false)
            });
        }

        // Sort
        if filter.newest_first {
            entries.sort_by(|a, b| b.time_generated.cmp(&a.time_generated));
        } else {
            entries.sort_by(|a, b| a.time_generated.cmp(&b.time_generated));
        }

        // Apply limit
        if entries.len() > filter.max_results as usize {
            entries.truncate(filter.max_results as usize);
        }

        Ok(entries)
    }

    /// Get recent events from a log (shortcut).
    pub async fn recent_events(
        transport: &mut WmiTransport,
        log_name: &str,
        count: u32,
    ) -> Result<Vec<EventLogEntry>, String> {
        let filter = EventLogFilter {
            log_names: vec![log_name.to_string()],
            max_results: count,
            newest_first: true,
            ..Default::default()
        };
        Self::query_events(transport, &filter).await
    }

    /// Get error events from a log.
    pub async fn error_events(
        transport: &mut WmiTransport,
        log_name: &str,
        count: u32,
    ) -> Result<Vec<EventLogEntry>, String> {
        let filter = EventLogFilter {
            log_names: vec![log_name.to_string()],
            levels: vec![EventLogLevel::Error],
            max_results: count,
            newest_first: true,
            ..Default::default()
        };
        Self::query_events(transport, &filter).await
    }

    /// Get events by event ID.
    pub async fn events_by_id(
        transport: &mut WmiTransport,
        log_name: &str,
        event_id: u32,
        count: u32,
    ) -> Result<Vec<EventLogEntry>, String> {
        let filter = EventLogFilter {
            log_names: vec![log_name.to_string()],
            event_ids: vec![event_id],
            max_results: count,
            newest_first: true,
            ..Default::default()
        };
        Self::query_events(transport, &filter).await
    }

    /// Get events by source name.
    pub async fn events_by_source(
        transport: &mut WmiTransport,
        log_name: &str,
        source: &str,
        count: u32,
    ) -> Result<Vec<EventLogEntry>, String> {
        let filter = EventLogFilter {
            log_names: vec![log_name.to_string()],
            sources: vec![source.to_string()],
            max_results: count,
            newest_first: true,
            ..Default::default()
        };
        Self::query_events(transport, &filter).await
    }

    /// Get events within a time range.
    pub async fn events_in_range(
        transport: &mut WmiTransport,
        log_name: &str,
        start: chrono::DateTime<Utc>,
        end: chrono::DateTime<Utc>,
        count: u32,
    ) -> Result<Vec<EventLogEntry>, String> {
        let filter = EventLogFilter {
            log_names: vec![log_name.to_string()],
            start_time: Some(start),
            end_time: Some(end),
            max_results: count,
            newest_first: true,
            ..Default::default()
        };
        Self::query_events(transport, &filter).await
    }

    // ─── Log Management ──────────────────────────────────────────────

    /// Clear an event log.
    pub async fn clear_log(
        transport: &mut WmiTransport,
        log_name: &str,
    ) -> Result<(), String> {
        info!("Clearing event log '{}'", log_name);

        let result = transport
            .invoke_method(
                "Win32_NTEventlogFile",
                "ClearEventlog",
                Some(&[("LogfileName", log_name)]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        if return_value != 0 {
            return Err(format!(
                "Failed to clear event log '{}': error code {}",
                log_name, return_value
            ));
        }

        Ok(())
    }

    /// Backup an event log to a file on the remote host.
    pub async fn backup_log(
        transport: &mut WmiTransport,
        log_name: &str,
        archive_path: &str,
    ) -> Result<(), String> {
        info!(
            "Backing up event log '{}' to '{}'",
            log_name, archive_path
        );

        let mut params = HashMap::new();
        params.insert("ArchiveFileName".to_string(), archive_path.to_string());

        let result = transport
            .invoke_method(
                "Win32_NTEventlogFile",
                "BackupEventlog",
                Some(&[("LogfileName", log_name)]),
                &params,
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        if return_value != 0 {
            return Err(format!(
                "Failed to backup event log '{}': error code {}",
                log_name, return_value
            ));
        }

        Ok(())
    }

    // ─── Statistics ──────────────────────────────────────────────────

    /// Get event count grouped by level for a log.
    pub async fn event_statistics(
        transport: &mut WmiTransport,
        log_name: &str,
    ) -> Result<HashMap<String, u64>, String> {
        let mut stats = HashMap::new();

        for level_val in [1u8, 2, 3, 4, 5] {
            let level = EventLogLevel::from_wmi(level_val);
            let query = WqlBuilder::select("Win32_NTLogEvent")
                .fields(&["RecordNumber"])
                .where_eq("Logfile", log_name)
                .where_eq_num("EventType", level_val as i64)
                .build();

            let rows = transport.wql_query(&query).await.unwrap_or_default();
            stats.insert(level.name().to_string(), rows.len() as u64);
        }

        Ok(stats)
    }

    /// Get the most recent N unique event sources with counts.
    pub async fn top_sources(
        transport: &mut WmiTransport,
        log_name: &str,
        limit: usize,
    ) -> Result<Vec<(String, u64)>, String> {
        let query = WqlBuilder::select("Win32_NTLogEvent")
            .fields(&["SourceName"])
            .where_eq("Logfile", log_name)
            .build();
        let rows = transport.wql_query(&query).await?;

        let mut counts: HashMap<String, u64> = HashMap::new();
        for row in &rows {
            if let Some(source) = row.get("SourceName") {
                *counts.entry(source.clone()).or_insert(0) += 1;
            }
        }

        let mut sorted: Vec<(String, u64)> = counts.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        sorted.truncate(limit);
        Ok(sorted)
    }

    // ─── Export ──────────────────────────────────────────────────────

    /// Export events to a CSV-like format for Tauri frontend.
    pub fn export_events_csv(events: &[EventLogEntry]) -> String {
        let mut csv =
            String::from("RecordNumber,LogFile,EventCode,EventType,Source,TimeGenerated,Message\n");

        for e in events {
            let msg = e
                .message
                .as_deref()
                .unwrap_or("")
                .replace('"', "\"\"")
                .replace('\n', " ")
                .replace('\r', "");
            csv.push_str(&format!(
                "{},{},{},{:?},{},{},\"{}\"\n",
                e.record_number,
                e.log_file,
                e.event_code,
                e.event_type,
                e.source_name,
                e.time_generated.to_rfc3339(),
                msg
            ));
        }

        csv
    }

    /// Export events as JSON.
    pub fn export_events_json(events: &[EventLogEntry]) -> Result<String, String> {
        serde_json::to_string_pretty(events)
            .map_err(|e| format!("Failed to serialize events: {}", e))
    }

    // ─── Query Builder ───────────────────────────────────────────────

    /// Build a WQL query string from an EventLogFilter.
    fn build_event_query(filter: &EventLogFilter) -> String {
        let mut conditions = Vec::new();

        // Log name filter
        if !filter.log_names.is_empty() {
            if filter.log_names.len() == 1 {
                conditions.push(format!(
                    "Logfile = '{}'",
                    filter.log_names[0].replace('\'', "\\'")
                ));
            } else {
                let _names = filter
                    .log_names
                    .iter()
                    .map(|n| format!("'{}'", n.replace('\'', "\\'")))
                    .collect::<Vec<_>>()
                    .join(", ");
                // WQL doesn't support IN for strings in all implementations,
                // use OR instead
                let or_clauses = filter
                    .log_names
                    .iter()
                    .map(|n| format!("Logfile = '{}'", n.replace('\'', "\\'")))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                conditions.push(format!("({})", or_clauses));
            }
        }

        // Level filter
        if !filter.levels.is_empty() {
            if filter.levels.len() == 1 {
                conditions.push(format!("EventType = {}", filter.levels[0].to_wmi()));
            } else {
                let or_clauses = filter
                    .levels
                    .iter()
                    .map(|l| format!("EventType = {}", l.to_wmi()))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                conditions.push(format!("({})", or_clauses));
            }
        }

        // Source filter
        if !filter.sources.is_empty() {
            if filter.sources.len() == 1 {
                conditions.push(format!(
                    "SourceName = '{}'",
                    filter.sources[0].replace('\'', "\\'")
                ));
            } else {
                let or_clauses = filter
                    .sources
                    .iter()
                    .map(|s| format!("SourceName = '{}'", s.replace('\'', "\\'")))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                conditions.push(format!("({})", or_clauses));
            }
        }

        // Event ID filter
        if !filter.event_ids.is_empty() {
            if filter.event_ids.len() == 1 {
                conditions.push(format!("EventCode = {}", filter.event_ids[0]));
            } else {
                let or_clauses = filter
                    .event_ids
                    .iter()
                    .map(|id| format!("EventCode = {}", id))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                conditions.push(format!("({})", or_clauses));
            }
        }

        // Time range
        if let Some(ref start) = filter.start_time {
            let wmi_dt = crate::transport::format_wmi_datetime(start);
            conditions.push(format!("TimeGenerated >= '{}'", wmi_dt));
        }
        if let Some(ref end) = filter.end_time {
            let wmi_dt = crate::transport::format_wmi_datetime(end);
            conditions.push(format!("TimeGenerated <= '{}'", wmi_dt));
        }

        // Computer name filter
        if let Some(ref cn) = filter.computer_name {
            conditions.push(format!("ComputerName = '{}'", cn.replace('\'', "\\'")));
        }

        let mut query = "SELECT RecordNumber, Logfile, EventCode, EventIdentifier, EventType, \
            SourceName, Category, CategoryString, TimeGenerated, TimeWritten, \
            Message, ComputerName, User, InsertionStrings \
            FROM Win32_NTLogEvent"
            .to_string();

        if !conditions.is_empty() {
            query.push_str(" WHERE ");
            query.push_str(&conditions.join(" AND "));
        }

        query
    }

    // ─── Parsing ─────────────────────────────────────────────────────

    /// Convert a WMI result row to an EventLogEntry.
    fn row_to_event(row: &HashMap<String, String>) -> EventLogEntry {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u64 = |key: &str| row.get(key).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        let get_u32 = |key: &str| row.get(key).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);

        let event_type_val = row
            .get("EventType")
            .and_then(|v| v.parse::<u8>().ok())
            .unwrap_or(0);

        let time_generated = row
            .get("TimeGenerated")
            .and_then(|v| parse_wmi_datetime(v))
            .unwrap_or_else(Utc::now);

        let time_written = row
            .get("TimeWritten")
            .and_then(|v| parse_wmi_datetime(v))
            .unwrap_or_else(Utc::now);

        // Parse InsertionStrings — comes as comma-separated or array notation
        let insertion_strings = row
            .get("InsertionStrings")
            .map(|s| {
                s.split(',')
                    .map(|part| part.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        EventLogEntry {
            record_number: get_u64("RecordNumber"),
            log_file: get_or("Logfile", ""),
            event_code: get_u32("EventCode"),
            event_identifier: get_u64("EventIdentifier"),
            event_type: EventLogLevel::from_wmi(event_type_val),
            source_name: get_or("SourceName", ""),
            category: row.get("Category").and_then(|v| v.parse().ok()),
            category_string: get("CategoryString"),
            time_generated,
            time_written,
            message: get("Message"),
            computer_name: get_or("ComputerName", ""),
            user: get("User"),
            insertion_strings,
            data: Vec::new(), // Binary data not returned in WQL queries
        }
    }

    /// Convert a WMI result row to EventLogInfo.
    fn row_to_log_info(row: &HashMap<String, String>) -> EventLogInfo {
        let _get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u64 = |key: &str| row.get(key).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);

        EventLogInfo {
            name: get_or("LogfileName", &get_or("Name", "")),
            file_name: get_or("FileName", ""),
            number_of_records: get_u64("NumberOfRecords"),
            max_file_size: get_u64("MaxFileSize"),
            current_size: get_u64("FileSize"),
            overwrite_policy: get_or("OverwritePolicy", "Unknown"),
            overwrite_outdated: row.get("OverWriteOutDated").and_then(|v| v.parse().ok()),
            sources: Vec::new(), // populated separately
            status: get_or("Status", "OK"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_event_query_basic() {
        let filter = EventLogFilter {
            log_names: vec!["System".to_string()],
            ..Default::default()
        };
        let query = EventLogManager::build_event_query(&filter);
        assert!(query.contains("Logfile = 'System'"));
        assert!(query.contains("Win32_NTLogEvent"));
    }

    #[test]
    fn test_build_event_query_multiple_levels() {
        let filter = EventLogFilter {
            log_names: vec!["Application".to_string()],
            levels: vec![EventLogLevel::Error, EventLogLevel::Warning],
            ..Default::default()
        };
        let query = EventLogManager::build_event_query(&filter);
        assert!(query.contains("EventType = 1"));
        assert!(query.contains("EventType = 2"));
        assert!(query.contains(" OR "));
    }

    #[test]
    fn test_build_event_query_with_source() {
        let filter = EventLogFilter {
            log_names: vec!["Application".to_string()],
            sources: vec!["MyApp".to_string()],
            ..Default::default()
        };
        let query = EventLogManager::build_event_query(&filter);
        assert!(query.contains("SourceName = 'MyApp'"));
    }

    #[test]
    fn test_row_to_event() {
        let mut row = HashMap::new();
        row.insert("RecordNumber".to_string(), "12345".to_string());
        row.insert("Logfile".to_string(), "Application".to_string());
        row.insert("EventCode".to_string(), "1000".to_string());
        row.insert("EventIdentifier".to_string(), "1000".to_string());
        row.insert("EventType".to_string(), "1".to_string());
        row.insert("SourceName".to_string(), "TestApp".to_string());
        row.insert(
            "TimeGenerated".to_string(),
            "20231015143022.000000+000".to_string(),
        );
        row.insert(
            "TimeWritten".to_string(),
            "20231015143022.000000+000".to_string(),
        );
        row.insert("Message".to_string(), "Test error message".to_string());
        row.insert("ComputerName".to_string(), "SERVER01".to_string());

        let event = EventLogManager::row_to_event(&row);
        assert_eq!(event.record_number, 12345);
        assert_eq!(event.log_file, "Application");
        assert_eq!(event.event_code, 1000);
        assert_eq!(event.event_type, EventLogLevel::Error);
        assert_eq!(event.source_name, "TestApp");
        assert_eq!(
            event.message.as_deref(),
            Some("Test error message")
        );
    }

    #[test]
    fn test_export_csv() {
        let events = vec![EventLogEntry {
            record_number: 1,
            log_file: "Application".to_string(),
            event_code: 1000,
            event_identifier: 1000,
            event_type: EventLogLevel::Error,
            source_name: "TestApp".to_string(),
            category: None,
            category_string: None,
            time_generated: Utc::now(),
            time_written: Utc::now(),
            message: Some("Test message".to_string()),
            computer_name: "SERVER01".to_string(),
            user: None,
            insertion_strings: Vec::new(),
            data: Vec::new(),
        }];

        let csv = EventLogManager::export_events_csv(&events);
        assert!(csv.starts_with("RecordNumber,"));
        assert!(csv.contains("TestApp"));
        assert!(csv.contains("Test message"));
    }
}
