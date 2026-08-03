//! Session data logging and capture.
//!
//! Records serial session I/O to files in various formats: plain text,
//! hex dump, timestamped, raw binary, and CSV.  Supports log rotation
//! and export utilities.

use crate::serial::types::*;
use chrono::{DateTime, Utc};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_LOG_PATH_BYTES: usize = 4096;
const DEFAULT_MAX_LOG_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LOG_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_LOG_ENTRY_BYTES: usize = MAX_SERIAL_PAYLOAD_BYTES;
const MAX_LOG_BUFFER_ENTRIES: usize = 1024;
const MAX_LOG_BUFFER_BYTES: usize = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;
const MAX_ROTATED_FILES: u32 = 10_000;

fn bounded_data(data: &[u8]) -> &[u8] {
    &data[..data.len().min(MAX_LOG_ENTRY_BYTES)]
}

fn bounded_entry(mut entry: LogEntry) -> LogEntry {
    entry.data.truncate(MAX_LOG_ENTRY_BYTES);
    entry.text = String::from_utf8_lossy(&entry.data).to_string();
    entry
}

fn entry_cost(entry: &LogEntry) -> usize {
    entry.data.len().saturating_add(entry.text.len())
}

fn validate_log_path(path: &Path, allow_existing: bool) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Serial log path must be absolute".to_string());
    }
    if path.as_os_str().to_string_lossy().len() > MAX_LOG_PATH_BYTES {
        return Err(format!(
            "Serial log path representation exceeds the configured {} byte limit",
            MAX_LOG_PATH_BYTES
        ));
    }
    // These are best-effort snapshot checks. They reject unsafe path state
    // observed here, but do not claim race-free containment across later opens.
    let parent = path
        .parent()
        .ok_or_else(|| "Serial log path has no parent directory".to_string())?;
    for ancestor in parent.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor)
            .map_err(|e| format!("Cannot inspect serial log directory chain: {}", e))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("A serial log parent is a symlink or is not a directory".to_string());
        }
    }
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("Serial log target is a symlink or is not a regular file".to_string());
            }
            if !allow_existing {
                return Err(
                    "Serial log target already exists; refusing to overwrite it".to_string()
                );
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Cannot inspect serial log target: {}", error)),
    }
    Ok(())
}

fn harden_file_permissions(file: &std::fs::File) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = file
            .metadata()
            .map_err(|e| format!("Cannot inspect serial log permissions: {}", e))?
            .permissions();
        permissions.set_mode(0o600);
        file.set_permissions(permissions)
            .map_err(|e| format!("Cannot restrict serial log permissions: {}", e))?;
    }
    #[cfg(not(unix))]
    let _ = file;
    Ok(())
}

fn create_new_log_file(path: &Path) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|e| format!("Failed to create serial log file: {}", e))?;
    harden_file_permissions(&file)?;
    Ok(file)
}

fn copy_with_byte_ceiling(
    source: &mut std::fs::File,
    destination: &mut std::fs::File,
    ceiling: u64,
) -> Result<u64, String> {
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let remaining = ceiling.saturating_sub(copied);
        if remaining == 0 {
            let mut probe = [0_u8; 1];
            if source
                .read(&mut probe)
                .map_err(|e| format!("Failed to probe rotated serial log size: {}", e))?
                != 0
            {
                return Err(format!(
                    "Serial log rotation copy exceeds the {} byte ceiling",
                    ceiling
                ));
            }
            return Ok(copied);
        }

        let read_limit = remaining.min(buffer.len() as u64) as usize;
        let read = source
            .read(&mut buffer[..read_limit])
            .map_err(|e| format!("Failed to read serial log during rotation: {}", e))?;
        if read == 0 {
            return Ok(copied);
        }
        destination
            .write_all(&buffer[..read])
            .map_err(|e| format!("Failed to write rotated serial log: {}", e))?;
        copied = copied.saturating_add(read as u64);
    }
}

fn append_limited(output: &mut String, value: &str) -> bool {
    if output.len().saturating_add(value.len()) > MAX_EXPORT_BYTES {
        const MARKER: &str = "\n[serial log export truncated]\n";
        if output.len().saturating_add(MARKER.len()) <= MAX_EXPORT_BYTES {
            output.push_str(MARKER);
        }
        return false;
    }
    output.push_str(value);
    true
}

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
        let mut data = data;
        data.truncate(MAX_LOG_ENTRY_BYTES);
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
    let text = String::from_utf8_lossy(bounded_data(&entry.data));
    if direction_markers {
        format!("{} {}", entry.direction.arrow(), text)
    } else {
        text.into_owned()
    }
}

/// Format a log entry as a timestamped line.
pub fn format_timestamped(entry: &LogEntry, direction_markers: bool) -> String {
    let ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S%.3f");
    let text = String::from_utf8_lossy(bounded_data(&entry.data));
    if direction_markers {
        format!("[{}] {} {}", ts, entry.direction.label(), text)
    } else {
        format!("[{}] {}", ts, text)
    }
}

/// Format a log entry as a hex dump.
pub fn format_hex_dump(entry: &LogEntry, offset: usize, direction_markers: bool) -> String {
    let data = bounded_data(&entry.data);
    let mut output = String::new();
    if direction_markers {
        output.push_str(&format!(
            "--- {} {} bytes {} ---\n",
            entry.direction.label(),
            data.len(),
            entry.timestamp.format("%H:%M:%S%.3f")
        ));
    }
    output.push_str(&crate::serial::transport::hex_dump(data, offset));
    output
}

/// Format a log entry as CSV.
pub fn format_csv(entry: &LogEntry) -> String {
    let ts = entry.timestamp.format("%Y-%m-%d %H:%M:%S%.3f");
    let data = bounded_data(&entry.data);
    let hex = crate::serial::transport::bytes_to_hex(data);
    let ascii = data
        .iter()
        .map(|&b| crate::serial::transport::printable_char(b))
        .collect::<String>();
    // CSV: timestamp, direction, length, hex, ascii
    format!(
        "{},{},{},{},\"{}\"",
        ts,
        entry.direction.label(),
        data.len(),
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
    buffered_bytes: usize,
}

impl LogWriter {
    /// Create a new log writer.
    pub fn new(mut config: LogConfig) -> Result<Self, String> {
        if config.enabled {
            if config.file_path.is_empty() {
                return Err("Enabled serial logging requires a file path".to_string());
            }
            if config.max_file_size == 0 {
                config.max_file_size = DEFAULT_MAX_LOG_FILE_BYTES;
            }
            if config.max_file_size > MAX_LOG_FILE_BYTES {
                return Err(format!(
                    "Serial log file limit cannot exceed {} bytes",
                    MAX_LOG_FILE_BYTES
                ));
            }
        }
        let file = if config.enabled && !config.file_path.is_empty() {
            Some(Self::open_file(&config)?)
        } else {
            None
        };

        let bytes_written = file
            .as_ref()
            .and_then(|file| file.metadata().ok())
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let mut writer = Self {
            config,
            file,
            byte_offset: 0,
            bytes_written,
            rotation_count: 0,
            entry_buffer: Vec::new(),
            buffered_bytes: 0,
        };
        if writer.config.enabled && writer.bytes_written > writer.config.max_file_size {
            if writer.config.rotate {
                writer.rotate()?;
            } else {
                return Err(
                    "Existing serial log exceeds the configured file size limit".to_string()
                );
            }
        }
        Ok(writer)
    }

    fn open_file(config: &LogConfig) -> Result<std::fs::File, String> {
        let path = Path::new(&config.file_path);
        validate_log_path(path, config.append)?;
        let file = if config.append && path.exists() {
            let file = std::fs::OpenOptions::new()
                .append(true)
                .open(path)
                .map_err(|e| format!("Failed to append serial log file: {}", e))?;
            harden_file_permissions(&file)?;
            file
        } else {
            create_new_log_file(path)?
        };
        let metadata = file
            .metadata()
            .map_err(|e| format!("Cannot inspect opened serial log: {}", e))?;
        if !metadata.is_file() {
            return Err("Opened serial log target is not a regular file".to_string());
        }
        if metadata.len() > MAX_LOG_FILE_BYTES {
            return Err(format!(
                "Existing serial log exceeds the global {} byte safety limit",
                MAX_LOG_FILE_BYTES
            ));
        }
        Ok(file)
    }

    fn ensure_write_capacity(&mut self, write_size: u64) -> Result<(), String> {
        if write_size > self.config.max_file_size {
            return Err("Serial log entry exceeds the configured file size limit".to_string());
        }
        if self.bytes_written.saturating_add(write_size) > self.config.max_file_size {
            if self.config.rotate {
                self.rotate()?;
            } else {
                return Err("Serial log file size limit has been reached".to_string());
            }
        }
        Ok(())
    }

    /// Write header to the log file.
    pub fn write_header(
        &mut self,
        session_id: &str,
        port_name: &str,
        config_shorthand: &str,
    ) -> Result<(), String> {
        if self.file.is_none() {
            return Ok(());
        }
        let header = match self.config.format {
            LogFormat::Csv => format!(
                "# Session: {} Port: {} Config: {}\n{}\n",
                session_id,
                port_name,
                config_shorthand,
                csv_header()
            ),
            LogFormat::Timestamped => format!(
                "=== Serial Session Log ===\nSession: {} | Port: {} | Config: {}\nStarted: {}\n===========================\n",
                session_id,
                port_name,
                config_shorthand,
                Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
            ),
            LogFormat::HexDump => format!(
                "--- Hex Dump Log: {} on {} ({}) ---\n",
                session_id, port_name, config_shorthand
            ),
            _ => String::new(),
        };
        if header.is_empty() {
            return Ok(());
        }
        let header_size = u64::try_from(header.len()).unwrap_or(u64::MAX);
        self.ensure_write_capacity(header_size)?;
        if let Some(ref mut file) = self.file {
            file.write_all(header.as_bytes())
                .map_err(|e| e.to_string())?;
            self.bytes_written = self.bytes_written.saturating_add(header_size);
        }
        Ok(())
    }

    /// Log a data entry.
    pub fn log(&mut self, entry: LogEntry) -> Result<(), String> {
        if !self.config.enabled {
            return Ok(());
        }

        let entry = bounded_entry(entry);
        let formatted = match self.config.format {
            LogFormat::PlainText => Some(format_plain(&entry, self.config.direction_markers)),
            LogFormat::Timestamped => {
                Some(format_timestamped(&entry, self.config.direction_markers))
            }
            LogFormat::HexDump => Some(format_hex_dump(
                &entry,
                self.byte_offset,
                self.config.direction_markers,
            )),
            LogFormat::RawBinary => None,
            LogFormat::Csv => Some(format_csv(&entry)),
        };
        let write_size = formatted
            .as_ref()
            .map(|value| value.len().saturating_add(1) as u64)
            .unwrap_or(entry.data.len() as u64);

        // Check rotation before the write so the configured ceiling is not crossed.
        self.ensure_write_capacity(write_size)?;

        // Write to file
        if let Some(ref mut file) = self.file {
            if let Some(formatted) = formatted {
                writeln!(file, "{}", formatted).map_err(|e| e.to_string())?;
            } else {
                file.write_all(&entry.data).map_err(|e| e.to_string())?;
            }
            self.bytes_written = self.bytes_written.saturating_add(write_size);
            self.byte_offset = self.byte_offset.saturating_add(entry.data.len());
        }

        self.buffered_bytes = self.buffered_bytes.saturating_add(entry_cost(&entry));
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
        while self.entry_buffer.len() > MAX_LOG_BUFFER_ENTRIES
            || self.buffered_bytes > MAX_LOG_BUFFER_BYTES
        {
            if self.entry_buffer.is_empty() {
                self.buffered_bytes = 0;
                break;
            }
            let removed = self.entry_buffer.remove(0);
            self.buffered_bytes = self.buffered_bytes.saturating_sub(entry_cost(&removed));
        }
    }

    /// Rotate the log file.
    fn rotate(&mut self) -> Result<(), String> {
        if let Some(file) = self.file.take() {
            drop(file);
        }

        let path = Path::new(&self.config.file_path);
        validate_log_path(path, true)?;
        let mut next_index = self.rotation_count;
        let new_name = loop {
            next_index = next_index
                .checked_add(1)
                .ok_or_else(|| "Serial log rotation counter exhausted".to_string())?;
            if next_index > MAX_ROTATED_FILES {
                return Err(format!(
                    "Serial log rotation limit of {} has been reached",
                    MAX_ROTATED_FILES
                ));
            }
            let candidate = rotated_path(&self.config.file_path, next_index);
            match std::fs::symlink_metadata(&candidate) {
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break candidate,
                Err(error) => {
                    return Err(format!("Cannot inspect rotated serial log path: {}", error))
                }
            }
        };
        validate_log_path(&new_name, false)?;

        let mut source = std::fs::File::open(path)
            .map_err(|e| format!("Failed to open serial log for rotation: {}", e))?;
        let copy_ceiling = self.config.max_file_size.min(MAX_LOG_FILE_BYTES);
        let source_length = source
            .metadata()
            .map_err(|e| format!("Cannot inspect serial log before rotation: {}", e))?
            .len();
        if source_length > copy_ceiling {
            return Err(format!(
                "Serial log is {} bytes and exceeds the {} byte rotation ceiling",
                source_length, copy_ceiling
            ));
        }
        let mut destination = create_new_log_file(&new_name)?;
        if let Err(error) = copy_with_byte_ceiling(&mut source, &mut destination, copy_ceiling) {
            drop(destination);
            drop(source);
            let _ = std::fs::remove_file(&new_name);
            return Err(error);
        }
        destination
            .sync_all()
            .map_err(|e| format!("Failed to sync rotated serial log: {}", e))?;
        drop(destination);
        drop(source);
        std::fs::remove_file(path)
            .map_err(|e| format!("Failed to retire active serial log: {}", e))?;

        self.file = Some(Self::open_file(&self.config)?);
        self.bytes_written = 0;
        self.byte_offset = 0;
        self.rotation_count = next_index;
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
    let mut output = String::with_capacity(MAX_EXPORT_BYTES.min(4096));
    output.push_str(csv_header());
    output.push('\n');
    for entry in entries {
        if !append_limited(&mut output, &format!("{}\n", format_csv(entry))) {
            break;
        }
    }
    output
}

/// Export log entries to JSON string.
pub fn export_json(entries: &[LogEntry]) -> Result<String, String> {
    let mut output = String::with_capacity(MAX_EXPORT_BYTES.min(4096));
    output.push('[');
    for (index, entry) in entries.iter().enumerate() {
        let bounded = bounded_entry(entry.clone());
        let serialized = serde_json::to_string(&bounded).map_err(|e| e.to_string())?;
        let separator = if index == 0 { "" } else { "," };
        if output
            .len()
            .saturating_add(separator.len())
            .saturating_add(serialized.len())
            .saturating_add(1)
            > MAX_EXPORT_BYTES
        {
            return Err(format!(
                "Serial log JSON export exceeds {} bytes",
                MAX_EXPORT_BYTES
            ));
        }
        output.push_str(separator);
        output.push_str(&serialized);
    }
    output.push(']');
    Ok(output)
}

/// Export log entries to plain text.
pub fn export_plain(entries: &[LogEntry], timestamps: bool, direction_markers: bool) -> String {
    let mut output = String::with_capacity(MAX_EXPORT_BYTES.min(4096));
    for entry in entries {
        let formatted = if timestamps {
            format_timestamped(entry, direction_markers)
        } else {
            format_plain(entry, direction_markers)
        };
        if !append_limited(&mut output, &format!("{}\n", formatted)) {
            break;
        }
    }
    output
}

/// Export log entries to hex dump.
pub fn export_hex_dump(entries: &[LogEntry], direction_markers: bool) -> String {
    let mut output = String::with_capacity(MAX_EXPORT_BYTES.min(4096));
    let mut offset = 0;
    for entry in entries {
        if !append_limited(
            &mut output,
            &format_hex_dump(entry, offset, direction_markers),
        ) {
            break;
        }
        offset = offset.saturating_add(bounded_data(&entry.data).len());
    }
    output
}

/// Generate a rotated file path.
pub fn rotated_path(base_path: &str, index: u32) -> PathBuf {
    let path = Path::new(base_path);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("log");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("log");
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
    fn bounded_entry_preserves_original_timestamp() {
        let timestamp = Utc::now();
        let entry = LogEntry {
            timestamp,
            direction: DataDirection::Rx,
            data: b"Hello".to_vec(),
            text: "stale".to_string(),
        };

        let bounded = bounded_entry(entry);

        assert_eq!(bounded.timestamp, timestamp);
        assert_eq!(bounded.text, "Hello");
    }

    #[test]
    fn rotation_copy_never_writes_past_its_byte_ceiling() {
        let directory = std::env::temp_dir();
        let source_path = directory.join(format!("serial-copy-source-{}", uuid::Uuid::new_v4()));
        let destination_path =
            directory.join(format!("serial-copy-destination-{}", uuid::Uuid::new_v4()));
        std::fs::write(&source_path, [1_u8; 5]).unwrap();
        let mut source = std::fs::File::open(&source_path).unwrap();
        let mut destination = create_new_log_file(&destination_path).unwrap();

        let error = copy_with_byte_ceiling(&mut source, &mut destination, 4).unwrap_err();

        assert!(error.contains("4 byte ceiling"));
        assert_eq!(destination.metadata().unwrap().len(), 4);
        drop(destination);
        drop(source);
        std::fs::remove_file(source_path).unwrap();
        std::fs::remove_file(destination_path).unwrap();
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
