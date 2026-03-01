//! Session data logging and capture.
//!
//! Records serial session I/O to files in various formats: plain text,
//! hex dump, timestamped, raw binary, and CSV.  Supports log rotation
//! and export utilities.

use crate::serial::types::*;
use chrono::{DateTime, Utc};
use std::io::Write;
use std::path::{Path, PathBuf};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Direction marker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Data direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DataDirection {
    Tx,
    Rx,
}

impl DataDirection {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Tx => "TX",
            Self::Rx => "RX",
        }
    }

    pub fn arrow(&self) -> &'static str {
        match self {
            Self::Tx => ">>>",
            Self::Rx => "<<<",
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Log entry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A single log entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub direction: DataDirection,
    pub data: Vec<u8>,
    pub text: String,
}

impl LogEntry {
    pub fn new(direction: DataDirection, data: Vec<u8>) -> Self {
        let text = String::from_utf8_lossy(&data).to_string();
        Self {
            timestamp: Utc::now(),
            direction,
            data,
            text,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Formatters
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Format a log entry as plain text.
pub fn format_plain(entry: &LogEntry, direction_markers: bool) -> String {
    if direction_markers {
        format!("{} {}", entry.direction.arrow(), entry.text)
    } else {
        entry.text.clone()
    }
}

/// Format a log entry as a timestamped line.
pub fn format_timestamped(entry: &LogEntry, direction_markers: bool) -> String {
    let ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S%.3f");
    if direction_markers {
        format!("[{}] {} {}", ts, entry.direction.label(), entry.text)
    } else {
        format!("[{}] {}", ts, entry.text)
    }
}

/// Format a log entry as a hex dump.
pub fn format_hex_dump(entry: &LogEntry, offset: usize, direction_markers: bool) -> String {
    let mut output = String::new();
    if direction_markers {
        output.push_str(&format!(
            "--- {} {} bytes {} ---\n",
            entry.direction.label(),
            entry.data.len(),
            entry.timestamp.format("%H:%M:%S%.3f")
        ));
    }
    output.push_str(&crate::serial::transport::hex_dump(&entry.data, offset));
    output
}

/// Format a log entry as CSV.
pub fn format_csv(entry: &LogEntry) -> String {
    let ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S%.3f");
    let hex = crate::serial::transport::bytes_to_hex(&entry.data);
    let ascii = entry
        .data
        .iter()
        .map(|&b| crate::serial::transport::printable_char(b))
        .collect::<String>();
    // CSV: timestamp, direction, length, hex, ascii
    format!(
        "{},{},{},{},\"{}\"",
        ts,
        entry.direction.label(),
        entry.data.len(),
        hex,
        ascii.replace('"', "\"\"")
    )
}

/// CSV header line.
pub fn csv_header() -> &'static str {
    "Timestamp,Direction,Length,Hex,ASCII"
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Log Writer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Session log writer.
pub struct LogWriter {
    config: LogConfig,
    file: Option<std::fs::File>,
    byte_offset: usize,
    bytes_written: u64,
    rotation_count: u32,
    entry_buffer: Vec<LogEntry>,
    max_buffer_size: usize,
}

impl LogWriter {
    /// Create a new log writer.
    pub fn new(config: LogConfig) -> Result<Self, String> {
        let file = if config.enabled && !config.file_path.is_empty() {
            Some(Self::open_file(&config)?)
        } else {
            None
        };

        Ok(Self {
            config,
            file,
            byte_offset: 0,
            bytes_written: 0,
            rotation_count: 0,
            entry_buffer: Vec::new(),
            max_buffer_size: 10000,
        })
    }

    fn open_file(config: &LogConfig) -> Result<std::fs::File, String> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(config.append)
            .truncate(!config.append)
            .open(&config.file_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?;
        Ok(file)
    }

    /// Write header to the log file.
    pub fn write_header(&mut self, session_id: &str, port_name: &str, config_shorthand: &str) -> Result<(), String> {
        if let Some(ref mut file) = self.file {
            match self.config.format {
                LogFormat::Csv => {
                    writeln!(file, "# Session: {} Port: {} Config: {}", session_id, port_name, config_shorthand)
                        .map_err(|e| e.to_string())?;
                    writeln!(file, "{}", csv_header())
                        .map_err(|e| e.to_string())?;
                }
                LogFormat::Timestamped => {
                    writeln!(
                        file,
                        "=== Serial Session Log ==="
                    )
                    .map_err(|e| e.to_string())?;
                    writeln!(
                        file,
                        "Session: {} | Port: {} | Config: {}",
                        session_id, port_name, config_shorthand
                    )
                    .map_err(|e| e.to_string())?;
                    writeln!(file, "Started: {}", Utc::now().format("%Y-%m-%d %H:%M:%S UTC"))
                        .map_err(|e| e.to_string())?;
                    writeln!(file, "===========================")
                        .map_err(|e| e.to_string())?;
                }
                LogFormat::HexDump => {
                    writeln!(file, "--- Hex Dump Log: {} on {} ({}) ---", session_id, port_name, config_shorthand)
                        .map_err(|e| e.to_string())?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Log a data entry.
    pub fn log(&mut self, entry: LogEntry) -> Result<(), String> {
        if !self.config.enabled {
            return Ok(());
        }

        // Check rotation
        if self.config.max_file_size > 0 && self.bytes_written >= self.config.max_file_size {
            if self.config.rotate {
                self.rotate()?;
            } else {
                return Ok(()); // Stop logging
            }
        }

        // Write to file
        if let Some(ref mut file) = self.file {
            let formatted = match self.config.format {
                LogFormat::PlainText => format_plain(&entry, self.config.direction_markers),
                LogFormat::Timestamped => format_timestamped(&entry, self.config.direction_markers),
                LogFormat::HexDump => {
                    let s = format_hex_dump(&entry, self.byte_offset, self.config.direction_markers);
                    self.byte_offset += entry.data.len();
                    s
                }
                LogFormat::RawBinary => {
                    // Write raw bytes directly
                    file.write_all(&entry.data).map_err(|e| e.to_string())?;
                    self.bytes_written += entry.data.len() as u64;
                    self.entry_buffer.push(entry);
                    self.trim_buffer();
                    return Ok(());
                }
                LogFormat::Csv => format_csv(&entry),
            };

            writeln!(file, "{}", formatted).map_err(|e| e.to_string())?;
            self.bytes_written += formatted.len() as u64 + 1;
        }

        self.entry_buffer.push(entry);
        self.trim_buffer();
        Ok(())
    }

    /// Log transmitted data.
    pub fn log_tx(&mut self, data: &[u8]) -> Result<(), String> {
        self.log(LogEntry::new(DataDirection::Tx, data.to_vec()))
    }

    /// Log received data.
    pub fn log_rx(&mut self, data: &[u8]) -> Result<(), String> {
        self.log(LogEntry::new(DataDirection::Rx, data.to_vec()))
    }

    fn trim_buffer(&mut self) {
        if self.entry_buffer.len() > self.max_buffer_size {
            let drain_count = self.entry_buffer.len() - self.max_buffer_size;
            self.entry_buffer.drain(..drain_count);
        }
    }

    /// Rotate the log file.
    fn rotate(&mut self) -> Result<(), String> {
        self.rotation_count += 1;
        if let Some(file) = self.file.take() {
            drop(file);
        }

        let path = Path::new(&self.config.file_path);
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("log");
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("log");
        let parent = path.parent().unwrap_or(Path::new("."));
        let new_name = parent.join(format!("{}_{}.{}", stem, self.rotation_count, ext));

        std::fs::rename(&self.config.file_path, &new_name)
            .map_err(|e| format!("Failed to rotate log: {}", e))?;

        self.file = Some(Self::open_file(&self.config)?);
        self.bytes_written = 0;
        Ok(())
    }

    /// Flush the log file.
    pub fn flush(&mut self) -> Result<(), String> {
        if let Some(ref mut file) = self.file {
            file.flush().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Close the log file.
    pub fn close(&mut self) {
        if let Some(file) = self.file.take() {
            drop(file);
        }
    }

    /// Get the in-memory entry buffer.
    pub fn entries(&self) -> &[LogEntry] {
        &self.entry_buffer
    }

    /// Get total bytes written.
    pub fn bytes_written(&self) -> u64 {
        self.bytes_written
    }

    /// Get rotation count.
    pub fn rotation_count(&self) -> u32 {
        self.rotation_count
    }

    /// Is logging enabled.
    pub fn is_enabled(&self) -> bool {
        self.config.enabled && self.file.is_some()
    }

    /// Get the log config.
    pub fn config(&self) -> &LogConfig {
        &self.config
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Export utilities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Export log entries to CSV string.
pub fn export_csv(entries: &[LogEntry]) -> String {
    let mut output = String::new();
    output.push_str(csv_header());
    output.push('\n');
    for entry in entries {
        output.push_str(&format_csv(entry));
        output.push('\n');
    }
    output
}

/// Export log entries to JSON string.
pub fn export_json(entries: &[LogEntry]) -> Result<String, String> {
    serde_json::to_string_pretty(entries).map_err(|e| e.to_string())
}

/// Export log entries to plain text.
pub fn export_plain(entries: &[LogEntry], timestamps: bool, direction_markers: bool) -> String {
    let mut output = String::new();
    for entry in entries {
        if timestamps {
            output.push_str(&format_timestamped(entry, direction_markers));
        } else {
            output.push_str(&format_plain(entry, direction_markers));
        }
        output.push('\n');
    }
    output
}

/// Export log entries to hex dump.
pub fn export_hex_dump(entries: &[LogEntry], direction_markers: bool) -> String {
    let mut output = String::new();
    let mut offset = 0;
    for entry in entries {
        output.push_str(&format_hex_dump(entry, offset, direction_markers));
        offset += entry.data.len();
    }
    output
}

/// Generate a rotated file path.
pub fn rotated_path(base_path: &str, index: u32) -> PathBuf {
    let path = Path::new(base_path);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("log");
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("log");
    let parent = path.parent().unwrap_or(Path::new("."));
    parent.join(format!("{}_{}.{}", stem, index, ext))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_entry(direction: DataDirection, data: &[u8]) -> LogEntry {
        LogEntry {
            timestamp: Utc::now(),
            direction,
            data: data.to_vec(),
            text: String::from_utf8_lossy(data).to_string(),
        }
    }

    #[test]
    fn test_direction_labels() {
        assert_eq!(DataDirection::Tx.label(), "TX");
        assert_eq!(DataDirection::Rx.label(), "RX");
        assert_eq!(DataDirection::Tx.arrow(), ">>>");
        assert_eq!(DataDirection::Rx.arrow(), "<<<");
    }

    #[test]
    fn test_log_entry_new() {
        let entry = LogEntry::new(DataDirection::Rx, b"Hello".to_vec());
        assert_eq!(entry.direction, DataDirection::Rx);
        assert_eq!(entry.text, "Hello");
    }

    #[test]
    fn test_format_plain() {
        let entry = sample_entry(DataDirection::Tx, b"AT\r\n");
        let plain = format_plain(&entry, true);
        assert!(plain.contains(">>>"));
        assert!(plain.contains("AT"));
    }

    #[test]
    fn test_format_plain_no_direction() {
        let entry = sample_entry(DataDirection::Rx, b"OK");
        let plain = format_plain(&entry, false);
        assert!(!plain.contains("<<<"));
        assert_eq!(plain, "OK");
    }

    #[test]
    fn test_format_timestamped() {
        let entry = sample_entry(DataDirection::Rx, b"data");
        let ts = format_timestamped(&entry, true);
        assert!(ts.contains("["));
        assert!(ts.contains("RX"));
        assert!(ts.contains("data"));
    }

    #[test]
    fn test_format_hex_dump() {
        let entry = sample_entry(DataDirection::Tx, b"Hello, World!");
        let dump = format_hex_dump(&entry, 0, true);
        assert!(dump.contains("TX"));
        assert!(dump.contains("48 65 6C 6C")); // "Hell"
    }

    #[test]
    fn test_format_csv() {
        let entry = sample_entry(DataDirection::Rx, b"\x01\x02\x03");
        let csv = format_csv(&entry);
        assert!(csv.contains("RX"));
        assert!(csv.contains("3")); // length
        assert!(csv.contains("01 02 03")); // hex
    }

    #[test]
    fn test_export_csv() {
        let entries = vec![
            sample_entry(DataDirection::Tx, b"AT\r\n"),
            sample_entry(DataDirection::Rx, b"OK\r\n"),
        ];
        let csv = export_csv(&entries);
        assert!(csv.starts_with("Timestamp,"));
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 3); // header + 2 entries
    }

    #[test]
    fn test_export_json() {
        let entries = vec![sample_entry(DataDirection::Tx, b"test")];
        let json = export_json(&entries).unwrap();
        assert!(json.contains("\"direction\""));
        assert!(json.contains("\"text\""));
    }

    #[test]
    fn test_export_plain() {
        let entries = vec![
            sample_entry(DataDirection::Tx, b"line1"),
            sample_entry(DataDirection::Rx, b"line2"),
        ];
        let plain = export_plain(&entries, false, true);
        assert!(plain.contains(">>>"));
        assert!(plain.contains("<<<"));
    }

    #[test]
    fn test_rotated_path() {
        let path = rotated_path("/tmp/session.log", 1);
        assert_eq!(path, PathBuf::from("/tmp/session_1.log"));

        let path2 = rotated_path("/tmp/capture.txt", 5);
        assert_eq!(path2, PathBuf::from("/tmp/capture_5.txt"));
    }

    #[test]
    fn test_log_writer_disabled() {
        let config = LogConfig {
            enabled: false,
            ..Default::default()
        };
        let mut writer = LogWriter::new(config).unwrap();
        assert!(!writer.is_enabled());
        writer.log_tx(b"test").unwrap(); // Should succeed silently
    }

    #[test]
    fn test_log_writer_in_memory() {
        let config = LogConfig {
            enabled: false,
            ..Default::default()
        };
        let mut writer = LogWriter::new(config).unwrap();
        // Even when disabled, we shouldn't error
        writer.log_tx(b"data").unwrap();
    }

    #[test]
    fn test_csv_header() {
        let hdr = csv_header();
        assert!(hdr.contains("Timestamp"));
        assert!(hdr.contains("Direction"));
        assert!(hdr.contains("Hex"));
        assert!(hdr.contains("ASCII"));
    }

    #[test]
    fn test_export_hex_dump() {
        let entries = vec![
            sample_entry(DataDirection::Tx, b"AB"),
            sample_entry(DataDirection::Rx, b"CD"),
        ];
        let dump = export_hex_dump(&entries, true);
        assert!(dump.contains("TX"));
        assert!(dump.contains("RX"));
    }
}
