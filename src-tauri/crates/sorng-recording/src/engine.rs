// sorng-recording – Core threaded recording engine
//
// This module owns every active recording session.  Each session runs its
// data-collection on the tokio runtime; encoding / compression / saving
// are dispatched to a background job queue so the hot path (appending
// entries) is never blocked.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::{RecordingError, RecordingResult};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Internal live-session state  (never serialised across the bridge)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug)]
pub(crate) struct LiveTerminalRecording {
    pub recording_id: String,
    pub session_id: String,
    pub protocol: RecordingProtocol,
    pub start_instant: Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub host: String,
    pub username: String,
    pub cols: u32,
    pub rows: u32,
    pub record_input: bool,
    pub entries: Vec<TerminalRecordingEntry>,
    pub status: RecordingStatus,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct LiveScreenRecording {
    pub recording_id: String,
    pub session_id: String,
    pub protocol: RecordingProtocol,
    pub start_instant: Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub host: String,
    pub connection_name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frames: Vec<RdpFrame>,
    pub status: RecordingStatus,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct LiveHttpRecording {
    pub recording_id: String,
    pub session_id: String,
    pub start_instant: Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub host: String,
    pub target_url: String,
    pub record_headers: bool,
    pub entries: Vec<HttpRecordingEntry>,
    pub status: RecordingStatus,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct LiveTelnetRecording {
    pub recording_id: String,
    pub session_id: String,
    pub start_instant: Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub host: String,
    pub port: u16,
    pub entries: Vec<TelnetRecordingEntry>,
    pub status: RecordingStatus,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct LiveSerialRecording {
    pub recording_id: String,
    pub session_id: String,
    pub start_instant: Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub port_name: String,
    pub baud_rate: u32,
    pub entries: Vec<SerialRecordingEntry>,
    pub total_bytes: u64,
    pub status: RecordingStatus,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct LiveDbQueryRecording {
    pub recording_id: String,
    pub session_id: String,
    pub start_instant: Instant,
    pub start_utc: chrono::DateTime<chrono::Utc>,
    pub host: String,
    pub database_type: String,
    pub database_name: String,
    pub entries: Vec<DbQueryEntry>,
    pub status: RecordingStatus,
    pub tags: Vec<String>,
}

#[derive(Debug)]
pub(crate) struct LiveMacroRecording {
    pub recording_id: String,
    pub session_id: String,
    pub target_protocol: RecordingProtocol,
    pub start_instant: Instant,
    pub last_step_time: Instant,
    pub steps: Vec<MacroStep>,
    pub command_buffer: String,
    pub status: RecordingStatus,
}

// ═══════════════════════════════════════════════════════════════════════
//  The engine itself
// ═══════════════════════════════════════════════════════════════════════

/// Central recording engine.  Thread-safe — stored inside `Arc<Mutex<…>>`
/// as a Tauri managed state.
pub struct RecordingEngine {
    // ── live sessions ────────────────────────────────────────────────
    pub(crate) terminal_recordings: HashMap<String, LiveTerminalRecording>,
    pub(crate) screen_recordings: HashMap<String, LiveScreenRecording>,
    pub(crate) http_recordings: HashMap<String, LiveHttpRecording>,
    pub(crate) telnet_recordings: HashMap<String, LiveTelnetRecording>,
    pub(crate) serial_recordings: HashMap<String, LiveSerialRecording>,
    pub(crate) db_recordings: HashMap<String, LiveDbQueryRecording>,
    pub(crate) macro_recordings: HashMap<String, LiveMacroRecording>,

    // ── macro library (in memory until persisted) ────────────────────
    pub(crate) macro_library: Vec<MacroRecording>,
    pub(crate) macro_replay_status: HashMap<String, MacroReplayStatus>,

    // ── background jobs ──────────────────────────────────────────────
    pub(crate) jobs: HashMap<String, JobInfo>,

    // ── configuration ────────────────────────────────────────────────
    pub(crate) config: RecordingGlobalConfig,

    // ── library (persisted envelopes loaded on init) ─────────────────
    pub(crate) library: Vec<SavedRecordingEnvelope>,
}

impl RecordingEngine {
    pub fn new() -> Self {
        Self {
            terminal_recordings: HashMap::new(),
            screen_recordings: HashMap::new(),
            http_recordings: HashMap::new(),
            telnet_recordings: HashMap::new(),
            serial_recordings: HashMap::new(),
            db_recordings: HashMap::new(),
            macro_recordings: HashMap::new(),
            macro_library: Vec::new(),
            macro_replay_status: HashMap::new(),
            jobs: HashMap::new(),
            config: RecordingGlobalConfig::default(),
            library: Vec::new(),
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  Terminal recording (SSH, Telnet-as-terminal, Rlogin…)
    // ──────────────────────────────────────────────────────────────────

    pub fn start_terminal_recording(
        &mut self,
        session_id: String,
        protocol: RecordingProtocol,
        host: String,
        username: String,
        cols: u32,
        rows: u32,
        record_input: bool,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        if self.terminal_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        self.terminal_recordings.insert(
            session_id.clone(),
            LiveTerminalRecording {
                recording_id: recording_id.clone(),
                session_id,
                protocol,
                start_instant: Instant::now(),
                start_utc: Utc::now(),
                host,
                username,
                cols,
                rows,
                record_input,
                entries: Vec::new(),
                status: RecordingStatus::Recording,
                tags,
            },
        );
        log::info!("Started terminal recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn append_terminal_output(&mut self, session_id: &str, data: &str) {
        if let Some(rec) = self.terminal_recordings.get_mut(session_id) {
            let ts = rec.start_instant.elapsed().as_millis() as u64;
            rec.entries.push(TerminalRecordingEntry {
                timestamp_ms: ts,
                data: data.to_string(),
                entry_type: TerminalEntryType::Output,
            });
        }
    }

    pub fn append_terminal_input(&mut self, session_id: &str, data: &str) {
        if let Some(rec) = self.terminal_recordings.get_mut(session_id) {
            if rec.record_input {
                let ts = rec.start_instant.elapsed().as_millis() as u64;
                rec.entries.push(TerminalRecordingEntry {
                    timestamp_ms: ts,
                    data: data.to_string(),
                    entry_type: TerminalEntryType::Input,
                });
            }
        }
    }

    pub fn append_terminal_resize(&mut self, session_id: &str, cols: u32, rows: u32) {
        if let Some(rec) = self.terminal_recordings.get_mut(session_id) {
            let ts = rec.start_instant.elapsed().as_millis() as u64;
            rec.entries.push(TerminalRecordingEntry {
                timestamp_ms: ts,
                data: String::new(),
                entry_type: TerminalEntryType::Resize { cols, rows },
            });
            rec.cols = cols;
            rec.rows = rows;
        }
    }

    pub fn stop_terminal_recording(
        &mut self,
        session_id: &str,
    ) -> RecordingResult<TerminalRecording> {
        let rec = self
            .terminal_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
        let recording = TerminalRecording {
            metadata: TerminalRecordingMetadata {
                recording_id: rec.recording_id,
                session_id: rec.session_id,
                protocol: rec.protocol,
                start_time: rec.start_utc,
                end_time: Some(Utc::now()),
                host: rec.host,
                username: rec.username,
                cols: rec.cols,
                rows: rec.rows,
                duration_ms,
                entry_count: rec.entries.len(),
                record_input: rec.record_input,
                tags: rec.tags,
            },
            entries: rec.entries,
        };
        log::info!(
            "Stopped terminal recording {} ({} entries, {}ms)",
            recording.metadata.recording_id,
            recording.metadata.entry_count,
            duration_ms
        );
        Ok(recording)
    }

    pub fn get_terminal_recording_status(
        &self,
        session_id: &str,
    ) -> Option<TerminalRecordingMetadata> {
        self.terminal_recordings.get(session_id).map(|rec| {
            let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
            TerminalRecordingMetadata {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: rec.protocol.clone(),
                start_time: rec.start_utc,
                end_time: None,
                host: rec.host.clone(),
                username: rec.username.clone(),
                cols: rec.cols,
                rows: rec.rows,
                duration_ms,
                entry_count: rec.entries.len(),
                record_input: rec.record_input,
                tags: rec.tags.clone(),
            }
        })
    }

    pub fn is_terminal_recording(&self, session_id: &str) -> bool {
        self.terminal_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Screen recording (RDP, VNC)
    // ──────────────────────────────────────────────────────────────────

    pub fn start_screen_recording(
        &mut self,
        session_id: String,
        protocol: RecordingProtocol,
        host: String,
        connection_name: String,
        width: u32,
        height: u32,
        fps: u32,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        if self.screen_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        self.screen_recordings.insert(
            session_id.clone(),
            LiveScreenRecording {
                recording_id: recording_id.clone(),
                session_id,
                protocol,
                start_instant: Instant::now(),
                start_utc: Utc::now(),
                host,
                connection_name,
                width,
                height,
                fps,
                frames: Vec::new(),
                status: RecordingStatus::Recording,
                tags,
            },
        );
        log::info!("Started screen recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn append_screen_frame(
        &mut self,
        session_id: &str,
        width: u32,
        height: u32,
        data_b64: String,
    ) {
        if let Some(rec) = self.screen_recordings.get_mut(session_id) {
            let ts = rec.start_instant.elapsed().as_millis() as u64;
            let idx = rec.frames.len() as u64;
            rec.frames.push(RdpFrame {
                timestamp_ms: ts,
                width,
                height,
                data_b64,
                frame_index: idx,
            });
            rec.width = width;
            rec.height = height;
        }
    }

    pub fn stop_screen_recording(
        &mut self,
        session_id: &str,
    ) -> RecordingResult<RdpRecording> {
        let rec = self
            .screen_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
        let total_size: u64 = rec.frames.iter().map(|f| f.data_b64.len() as u64).sum();
        let recording = RdpRecording {
            metadata: RdpRecordingMetadata {
                recording_id: rec.recording_id,
                session_id: rec.session_id,
                start_time: rec.start_utc,
                end_time: Some(Utc::now()),
                host: rec.host,
                connection_name: rec.connection_name,
                width: rec.width,
                height: rec.height,
                fps: rec.fps,
                duration_ms,
                frame_count: rec.frames.len() as u64,
                format: VideoFormat::PngSequence,
                size_bytes: total_size,
                tags: rec.tags,
            },
            frames: rec.frames,
        };
        log::info!(
            "Stopped screen recording {} ({} frames, {}ms)",
            recording.metadata.recording_id,
            recording.metadata.frame_count,
            duration_ms
        );
        Ok(recording)
    }

    pub fn get_screen_recording_status(
        &self,
        session_id: &str,
    ) -> Option<RdpRecordingMetadata> {
        self.screen_recordings.get(session_id).map(|rec| {
            let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
            let total_size: u64 = rec.frames.iter().map(|f| f.data_b64.len() as u64).sum();
            RdpRecordingMetadata {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                start_time: rec.start_utc,
                end_time: None,
                host: rec.host.clone(),
                connection_name: rec.connection_name.clone(),
                width: rec.width,
                height: rec.height,
                fps: rec.fps,
                duration_ms,
                frame_count: rec.frames.len() as u64,
                format: VideoFormat::PngSequence,
                size_bytes: total_size,
                tags: rec.tags.clone(),
            }
        })
    }

    pub fn is_screen_recording(&self, session_id: &str) -> bool {
        self.screen_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  HTTP / HAR recording
    // ──────────────────────────────────────────────────────────────────

    pub fn start_http_recording(
        &mut self,
        session_id: String,
        host: String,
        target_url: String,
        record_headers: bool,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        if self.http_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        self.http_recordings.insert(
            session_id.clone(),
            LiveHttpRecording {
                recording_id: recording_id.clone(),
                session_id,
                start_instant: Instant::now(),
                start_utc: Utc::now(),
                host,
                target_url,
                record_headers,
                entries: Vec::new(),
                status: RecordingStatus::Recording,
                tags,
            },
        );
        log::info!("Started HTTP recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn append_http_entry(&mut self, session_id: &str, entry: HttpRecordingEntry) {
        if let Some(rec) = self.http_recordings.get_mut(session_id) {
            rec.entries.push(entry);
        }
    }

    pub fn stop_http_recording(
        &mut self,
        session_id: &str,
    ) -> RecordingResult<HttpRecording> {
        let rec = self
            .http_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
        let total_bytes: u64 = rec
            .entries
            .iter()
            .map(|e| e.request_body_size + e.response_body_size)
            .sum();
        let recording = HttpRecording {
            metadata: HttpRecordingMetadata {
                recording_id: rec.recording_id,
                session_id: rec.session_id,
                start_time: rec.start_utc,
                end_time: Some(Utc::now()),
                host: rec.host,
                target_url: rec.target_url,
                duration_ms,
                entry_count: rec.entries.len(),
                total_bytes_transferred: total_bytes,
                record_headers: rec.record_headers,
                tags: rec.tags,
            },
            entries: rec.entries,
        };
        log::info!(
            "Stopped HTTP recording {} ({} entries, {}ms)",
            recording.metadata.recording_id,
            recording.metadata.entry_count,
            duration_ms
        );
        Ok(recording)
    }

    pub fn get_http_recording_status(
        &self,
        session_id: &str,
    ) -> Option<HttpRecordingMetadata> {
        self.http_recordings.get(session_id).map(|rec| {
            let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
            let total_bytes: u64 = rec
                .entries
                .iter()
                .map(|e| e.request_body_size + e.response_body_size)
                .sum();
            HttpRecordingMetadata {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                start_time: rec.start_utc,
                end_time: None,
                host: rec.host.clone(),
                target_url: rec.target_url.clone(),
                duration_ms,
                entry_count: rec.entries.len(),
                total_bytes_transferred: total_bytes,
                record_headers: rec.record_headers,
                tags: rec.tags.clone(),
            }
        })
    }

    pub fn is_http_recording(&self, session_id: &str) -> bool {
        self.http_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Telnet recording
    // ──────────────────────────────────────────────────────────────────

    pub fn start_telnet_recording(
        &mut self,
        session_id: String,
        host: String,
        port: u16,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        if self.telnet_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        self.telnet_recordings.insert(
            session_id.clone(),
            LiveTelnetRecording {
                recording_id: recording_id.clone(),
                session_id,
                start_instant: Instant::now(),
                start_utc: Utc::now(),
                host,
                port,
                entries: Vec::new(),
                status: RecordingStatus::Recording,
                tags,
            },
        );
        log::info!("Started Telnet recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn append_telnet_entry(&mut self, session_id: &str, entry: TelnetRecordingEntry) {
        if let Some(rec) = self.telnet_recordings.get_mut(session_id) {
            rec.entries.push(entry);
        }
    }

    pub fn stop_telnet_recording(
        &mut self,
        session_id: &str,
    ) -> RecordingResult<TelnetRecording> {
        let rec = self
            .telnet_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
        let recording = TelnetRecording {
            metadata: TelnetRecordingMetadata {
                recording_id: rec.recording_id,
                session_id: rec.session_id,
                start_time: rec.start_utc,
                end_time: Some(Utc::now()),
                host: rec.host,
                port: rec.port,
                duration_ms,
                entry_count: rec.entries.len(),
                tags: rec.tags,
            },
            entries: rec.entries,
        };
        log::info!(
            "Stopped Telnet recording {} ({} entries, {}ms)",
            recording.metadata.recording_id,
            recording.metadata.entry_count,
            duration_ms
        );
        Ok(recording)
    }

    pub fn get_telnet_recording_status(
        &self,
        session_id: &str,
    ) -> Option<TelnetRecordingMetadata> {
        self.telnet_recordings.get(session_id).map(|rec| {
            let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
            TelnetRecordingMetadata {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                start_time: rec.start_utc,
                end_time: None,
                host: rec.host.clone(),
                port: rec.port,
                duration_ms,
                entry_count: rec.entries.len(),
                tags: rec.tags.clone(),
            }
        })
    }

    pub fn is_telnet_recording(&self, session_id: &str) -> bool {
        self.telnet_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Serial port recording
    // ──────────────────────────────────────────────────────────────────

    pub fn start_serial_recording(
        &mut self,
        session_id: String,
        port_name: String,
        baud_rate: u32,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        if self.serial_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        self.serial_recordings.insert(
            session_id.clone(),
            LiveSerialRecording {
                recording_id: recording_id.clone(),
                session_id,
                start_instant: Instant::now(),
                start_utc: Utc::now(),
                port_name,
                baud_rate,
                entries: Vec::new(),
                total_bytes: 0,
                status: RecordingStatus::Recording,
                tags,
            },
        );
        log::info!("Started Serial recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn append_serial_entry(&mut self, session_id: &str, entry: SerialRecordingEntry) {
        if let Some(rec) = self.serial_recordings.get_mut(session_id) {
            rec.total_bytes += entry.data.len() as u64;
            rec.entries.push(entry);
        }
    }

    pub fn stop_serial_recording(
        &mut self,
        session_id: &str,
    ) -> RecordingResult<SerialRecording> {
        let rec = self
            .serial_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
        let recording = SerialRecording {
            metadata: SerialRecordingMetadata {
                recording_id: rec.recording_id,
                session_id: rec.session_id,
                start_time: rec.start_utc,
                end_time: Some(Utc::now()),
                port_name: rec.port_name,
                baud_rate: rec.baud_rate,
                duration_ms,
                entry_count: rec.entries.len(),
                total_bytes: rec.total_bytes,
                tags: rec.tags,
            },
            entries: rec.entries,
        };
        log::info!(
            "Stopped Serial recording {} ({} entries, {}ms)",
            recording.metadata.recording_id,
            recording.metadata.entry_count,
            duration_ms
        );
        Ok(recording)
    }

    pub fn get_serial_recording_status(
        &self,
        session_id: &str,
    ) -> Option<SerialRecordingMetadata> {
        self.serial_recordings.get(session_id).map(|rec| {
            let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
            SerialRecordingMetadata {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                start_time: rec.start_utc,
                end_time: None,
                port_name: rec.port_name.clone(),
                baud_rate: rec.baud_rate,
                duration_ms,
                entry_count: rec.entries.len(),
                total_bytes: rec.total_bytes,
                tags: rec.tags.clone(),
            }
        })
    }

    pub fn is_serial_recording(&self, session_id: &str) -> bool {
        self.serial_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Database query recording
    // ──────────────────────────────────────────────────────────────────

    pub fn start_db_recording(
        &mut self,
        session_id: String,
        host: String,
        database_type: String,
        database_name: String,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        if self.db_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        self.db_recordings.insert(
            session_id.clone(),
            LiveDbQueryRecording {
                recording_id: recording_id.clone(),
                session_id,
                start_instant: Instant::now(),
                start_utc: Utc::now(),
                host,
                database_type,
                database_name,
                entries: Vec::new(),
                status: RecordingStatus::Recording,
                tags,
            },
        );
        log::info!("Started DB query recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn append_db_entry(&mut self, session_id: &str, entry: DbQueryEntry) {
        if let Some(rec) = self.db_recordings.get_mut(session_id) {
            rec.entries.push(entry);
        }
    }

    pub fn stop_db_recording(
        &mut self,
        session_id: &str,
    ) -> RecordingResult<DbQueryRecording> {
        let rec = self
            .db_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
        let recording = DbQueryRecording {
            metadata: DbQueryRecordingMetadata {
                recording_id: rec.recording_id,
                session_id: rec.session_id,
                start_time: rec.start_utc,
                end_time: Some(Utc::now()),
                host: rec.host,
                database_type: rec.database_type,
                database_name: rec.database_name,
                duration_ms,
                entry_count: rec.entries.len(),
                tags: rec.tags,
            },
            entries: rec.entries,
        };
        log::info!(
            "Stopped DB query recording {} ({} entries, {}ms)",
            recording.metadata.recording_id,
            recording.metadata.entry_count,
            duration_ms
        );
        Ok(recording)
    }

    pub fn get_db_recording_status(
        &self,
        session_id: &str,
    ) -> Option<DbQueryRecordingMetadata> {
        self.db_recordings.get(session_id).map(|rec| {
            let duration_ms = rec.start_instant.elapsed().as_millis() as u64;
            DbQueryRecordingMetadata {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                start_time: rec.start_utc,
                end_time: None,
                host: rec.host.clone(),
                database_type: rec.database_type.clone(),
                database_name: rec.database_name.clone(),
                duration_ms,
                entry_count: rec.entries.len(),
                tags: rec.tags.clone(),
            }
        })
    }

    pub fn is_db_recording(&self, session_id: &str) -> bool {
        self.db_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Macro recording & replay
    // ──────────────────────────────────────────────────────────────────

    pub fn start_macro_recording(
        &mut self,
        session_id: String,
        target_protocol: RecordingProtocol,
    ) -> RecordingResult<String> {
        if self.macro_recordings.contains_key(&session_id) {
            return Err(RecordingError::RecordingAlreadyActive(session_id));
        }
        let recording_id = Uuid::new_v4().to_string();
        let now = Instant::now();
        self.macro_recordings.insert(
            session_id.clone(),
            LiveMacroRecording {
                recording_id: recording_id.clone(),
                session_id,
                target_protocol,
                start_instant: now,
                last_step_time: now,
                steps: Vec::new(),
                command_buffer: String::new(),
                status: RecordingStatus::Recording,
            },
        );
        log::info!("Started macro recording {}", recording_id);
        Ok(recording_id)
    }

    pub fn macro_record_input(&mut self, session_id: &str, data: &str) {
        if let Some(rec) = self.macro_recordings.get_mut(session_id) {
            for ch in data.chars() {
                match ch {
                    '\r' | '\n' => {
                        let now = Instant::now();
                        let delay_ms = if rec.steps.is_empty() {
                            0
                        } else {
                            now.duration_since(rec.last_step_time).as_millis() as u64
                        };
                        rec.steps.push(MacroStep {
                            command: rec.command_buffer.clone(),
                            delay_ms,
                            send_newline: true,
                        });
                        rec.last_step_time = now;
                        rec.command_buffer.clear();
                    }
                    '\x7f' | '\x08' => {
                        rec.command_buffer.pop();
                    }
                    c if c >= ' ' => {
                        rec.command_buffer.push(c);
                    }
                    _ => {}
                }
            }
        }
    }

    pub fn stop_macro_recording(
        &mut self,
        session_id: &str,
        name: String,
        description: Option<String>,
        category: Option<String>,
        tags: Vec<String>,
    ) -> RecordingResult<MacroRecording> {
        let mut rec = self
            .macro_recordings
            .remove(session_id)
            .ok_or_else(|| RecordingError::RecordingNotActive(session_id.to_string()))?;
        // Flush remaining buffer as a final step without newline
        if !rec.command_buffer.is_empty() {
            let now = Instant::now();
            let delay_ms = if rec.steps.is_empty() {
                0
            } else {
                now.duration_since(rec.last_step_time).as_millis() as u64
            };
            rec.steps.push(MacroStep {
                command: rec.command_buffer.clone(),
                delay_ms,
                send_newline: false,
            });
        }
        let now = Utc::now();
        let macro_rec = MacroRecording {
            id: rec.recording_id.clone(),
            name,
            description,
            category,
            steps: rec.steps,
            created_at: now,
            updated_at: now,
            tags,
            target_protocol: rec.target_protocol,
        };
        self.macro_library.push(macro_rec.clone());
        log::info!(
            "Stopped macro recording {} ({} steps)",
            rec.recording_id,
            macro_rec.steps.len()
        );
        Ok(macro_rec)
    }

    pub fn get_macro_recording_status(
        &self,
        session_id: &str,
    ) -> Option<(String, usize, String)> {
        self.macro_recordings.get(session_id).map(|rec| {
            (
                rec.recording_id.clone(),
                rec.steps.len(),
                rec.command_buffer.clone(),
            )
        })
    }

    pub fn is_macro_recording(&self, session_id: &str) -> bool {
        self.macro_recordings.contains_key(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Aggregate helpers
    // ──────────────────────────────────────────────────────────────────

    pub fn list_active_recordings(&self) -> Vec<ActiveRecordingInfo> {
        let mut out = Vec::new();

        for rec in self.terminal_recordings.values() {
            out.push(ActiveRecordingInfo {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: rec.protocol.clone(),
                status: rec.status.clone(),
                host: rec.host.clone(),
                start_time: rec.start_utc,
                duration_ms: rec.start_instant.elapsed().as_millis() as u64,
                entry_count: rec.entries.len(),
                size_bytes: rec.entries.iter().map(|e| e.data.len() as u64).sum(),
            });
        }

        for rec in self.screen_recordings.values() {
            out.push(ActiveRecordingInfo {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: rec.protocol.clone(),
                status: rec.status.clone(),
                host: rec.host.clone(),
                start_time: rec.start_utc,
                duration_ms: rec.start_instant.elapsed().as_millis() as u64,
                entry_count: rec.frames.len(),
                size_bytes: rec.frames.iter().map(|f| f.data_b64.len() as u64).sum(),
            });
        }

        for rec in self.http_recordings.values() {
            out.push(ActiveRecordingInfo {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: RecordingProtocol::Http,
                status: rec.status.clone(),
                host: rec.host.clone(),
                start_time: rec.start_utc,
                duration_ms: rec.start_instant.elapsed().as_millis() as u64,
                entry_count: rec.entries.len(),
                size_bytes: rec
                    .entries
                    .iter()
                    .map(|e| e.request_body_size + e.response_body_size)
                    .sum(),
            });
        }

        for rec in self.telnet_recordings.values() {
            out.push(ActiveRecordingInfo {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: RecordingProtocol::Telnet,
                status: rec.status.clone(),
                host: rec.host.clone(),
                start_time: rec.start_utc,
                duration_ms: rec.start_instant.elapsed().as_millis() as u64,
                entry_count: rec.entries.len(),
                size_bytes: rec.entries.iter().map(|e| e.data.len() as u64).sum(),
            });
        }

        for rec in self.serial_recordings.values() {
            out.push(ActiveRecordingInfo {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: RecordingProtocol::Serial,
                status: rec.status.clone(),
                host: rec.port_name.clone(),
                start_time: rec.start_utc,
                duration_ms: rec.start_instant.elapsed().as_millis() as u64,
                entry_count: rec.entries.len(),
                size_bytes: rec.total_bytes,
            });
        }

        for rec in self.db_recordings.values() {
            out.push(ActiveRecordingInfo {
                recording_id: rec.recording_id.clone(),
                session_id: rec.session_id.clone(),
                protocol: RecordingProtocol::DatabaseQuery,
                status: rec.status.clone(),
                host: rec.host.clone(),
                start_time: rec.start_utc,
                duration_ms: rec.start_instant.elapsed().as_millis() as u64,
                entry_count: rec.entries.len(),
                size_bytes: rec.entries.iter().map(|e| e.query.len() as u64).sum(),
            });
        }

        out
    }

    pub fn active_count(&self) -> usize {
        self.terminal_recordings.len()
            + self.screen_recordings.len()
            + self.http_recordings.len()
            + self.telnet_recordings.len()
            + self.serial_recordings.len()
            + self.db_recordings.len()
            + self.macro_recordings.len()
    }

    pub fn stop_all(&mut self) -> Vec<String> {
        let mut stopped = Vec::new();
        let terminal_ids: Vec<String> = self.terminal_recordings.keys().cloned().collect();
        for id in terminal_ids {
            if self.stop_terminal_recording(&id).is_ok() {
                stopped.push(id);
            }
        }
        let screen_ids: Vec<String> = self.screen_recordings.keys().cloned().collect();
        for id in screen_ids {
            if self.stop_screen_recording(&id).is_ok() {
                stopped.push(id);
            }
        }
        let http_ids: Vec<String> = self.http_recordings.keys().cloned().collect();
        for id in http_ids {
            if self.stop_http_recording(&id).is_ok() {
                stopped.push(id);
            }
        }
        let telnet_ids: Vec<String> = self.telnet_recordings.keys().cloned().collect();
        for id in telnet_ids {
            if self.stop_telnet_recording(&id).is_ok() {
                stopped.push(id);
            }
        }
        let serial_ids: Vec<String> = self.serial_recordings.keys().cloned().collect();
        for id in serial_ids {
            if self.stop_serial_recording(&id).is_ok() {
                stopped.push(id);
            }
        }
        let db_ids: Vec<String> = self.db_recordings.keys().cloned().collect();
        for id in db_ids {
            if self.stop_db_recording(&id).is_ok() {
                stopped.push(id);
            }
        }
        stopped
    }

    // ──────────────────────────────────────────────────────────────────
    //  Macro library CRUD
    // ──────────────────────────────────────────────────────────────────

    pub fn list_macros(&self) -> Vec<MacroRecording> {
        self.macro_library.clone()
    }

    pub fn get_macro(&self, macro_id: &str) -> Option<MacroRecording> {
        self.macro_library.iter().find(|m| m.id == macro_id).cloned()
    }

    pub fn update_macro(&mut self, updated: MacroRecording) -> RecordingResult<()> {
        if let Some(m) = self.macro_library.iter_mut().find(|m| m.id == updated.id) {
            *m = updated;
            Ok(())
        } else {
            Err(RecordingError::RecordingNotFound(
                "Macro not found".to_string(),
            ))
        }
    }

    pub fn delete_macro(&mut self, macro_id: &str) -> RecordingResult<()> {
        let before = self.macro_library.len();
        self.macro_library.retain(|m| m.id != macro_id);
        if self.macro_library.len() == before {
            Err(RecordingError::RecordingNotFound(
                "Macro not found".to_string(),
            ))
        } else {
            Ok(())
        }
    }

    pub fn import_macro(&mut self, macro_rec: MacroRecording) {
        self.macro_library.push(macro_rec);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Config
    // ──────────────────────────────────────────────────────────────────

    pub fn get_config(&self) -> RecordingGlobalConfig {
        self.config.clone()
    }

    pub fn update_config(&mut self, config: RecordingGlobalConfig) {
        self.config = config;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Library CRUD
    // ──────────────────────────────────────────────────────────────────

    pub fn save_to_library(&mut self, envelope: SavedRecordingEnvelope) {
        // Enforce max stored recordings
        if self.library.len() >= self.config.max_stored_recordings {
            // Remove oldest
            if !self.library.is_empty() {
                self.library.sort_by(|a, b| a.saved_at.cmp(&b.saved_at));
                self.library.remove(0);
            }
        }
        self.library.push(envelope);
    }

    pub fn get_from_library(&self, id: &str) -> Option<SavedRecordingEnvelope> {
        self.library.iter().find(|e| e.id == id).cloned()
    }

    pub fn list_library(&self) -> Vec<SavedRecordingEnvelope> {
        self.library.clone()
    }

    pub fn list_library_by_protocol(
        &self,
        protocol: &RecordingProtocol,
    ) -> Vec<SavedRecordingEnvelope> {
        self.library
            .iter()
            .filter(|e| &e.protocol == protocol)
            .cloned()
            .collect()
    }

    pub fn search_library(&self, query: &str) -> Vec<SavedRecordingEnvelope> {
        let q = query.to_lowercase();
        self.library
            .iter()
            .filter(|e| {
                e.name.to_lowercase().contains(&q)
                    || e.description
                        .as_ref()
                        .map(|d| d.to_lowercase().contains(&q))
                        .unwrap_or(false)
                    || e.host
                        .as_ref()
                        .map(|h| h.to_lowercase().contains(&q))
                        .unwrap_or(false)
                    || e.connection_name
                        .as_ref()
                        .map(|c| c.to_lowercase().contains(&q))
                        .unwrap_or(false)
                    || e.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .cloned()
            .collect()
    }

    pub fn rename_in_library(&mut self, id: &str, name: String) -> RecordingResult<()> {
        if let Some(e) = self.library.iter_mut().find(|e| e.id == id) {
            e.name = name;
            Ok(())
        } else {
            Err(RecordingError::RecordingNotFound(id.to_string()))
        }
    }

    pub fn update_library_tags(&mut self, id: &str, tags: Vec<String>) -> RecordingResult<()> {
        if let Some(e) = self.library.iter_mut().find(|e| e.id == id) {
            e.tags = tags;
            Ok(())
        } else {
            Err(RecordingError::RecordingNotFound(id.to_string()))
        }
    }

    pub fn delete_from_library(&mut self, id: &str) -> RecordingResult<()> {
        let before = self.library.len();
        self.library.retain(|e| e.id != id);
        if self.library.len() == before {
            Err(RecordingError::RecordingNotFound(id.to_string()))
        } else {
            Ok(())
        }
    }

    pub fn clear_library(&mut self) -> usize {
        let count = self.library.len();
        self.library.clear();
        count
    }

    pub fn library_summary(&self) -> RecordingLibrarySummary {
        let mut by_protocol: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for e in &self.library {
            let key = serde_json::to_string(&e.protocol).unwrap_or_default();
            *by_protocol.entry(key).or_insert(0) += 1;
        }
        RecordingLibrarySummary {
            total_recordings: self.library.len(),
            total_size_bytes: self.library.iter().map(|e| e.size_bytes).sum(),
            by_protocol,
            oldest: self.library.iter().map(|e| e.saved_at).min(),
            newest: self.library.iter().map(|e| e.saved_at).max(),
        }
    }

    pub fn auto_cleanup(&mut self) -> usize {
        if !self.config.auto_cleanup_enabled {
            return 0;
        }
        let cutoff = Utc::now()
            - chrono::Duration::days(self.config.auto_cleanup_older_than_days as i64);
        let before = self.library.len();
        self.library.retain(|e| e.saved_at >= cutoff);
        before - self.library.len()
    }

    // ──────────────────────────────────────────────────────────────────
    //  Job tracking
    // ──────────────────────────────────────────────────────────────────

    pub fn create_job(&mut self, kind: JobKind, recording_id: Option<String>) -> JobId {
        let id = JobId::new();
        self.jobs.insert(
            id.0.clone(),
            JobInfo {
                id: id.clone(),
                kind,
                status: JobStatus::Queued,
                recording_id,
                created_at: Utc::now(),
                started_at: None,
                completed_at: None,
                progress_pct: 0.0,
                message: None,
            },
        );
        id
    }

    pub fn update_job_status(&mut self, job_id: &str, status: JobStatus, progress: f64, msg: Option<String>) {
        if let Some(job) = self.jobs.get_mut(job_id) {
            if job.started_at.is_none() && matches!(status, JobStatus::Running) {
                job.started_at = Some(Utc::now());
            }
            if matches!(status, JobStatus::Completed | JobStatus::Failed(_) | JobStatus::Cancelled) {
                job.completed_at = Some(Utc::now());
            }
            job.status = status;
            job.progress_pct = progress;
            job.message = msg;
        }
    }

    pub fn get_job(&self, job_id: &str) -> Option<JobInfo> {
        self.jobs.get(job_id).cloned()
    }

    pub fn list_jobs(&self) -> Vec<JobInfo> {
        self.jobs.values().cloned().collect()
    }

    pub fn clear_completed_jobs(&mut self) -> usize {
        let before = self.jobs.len();
        self.jobs.retain(|_, j| !matches!(j.status, JobStatus::Completed | JobStatus::Failed(_) | JobStatus::Cancelled));
        before - self.jobs.len()
    }
}

/// The managed Tauri state type.
pub type RecordingEngineState = Arc<Mutex<RecordingEngine>>;

/// Create a new engine wrapped in Arc<Mutex<…>> ready for `app.manage()`.
pub fn new_engine_state() -> RecordingEngineState {
    Arc::new(Mutex::new(RecordingEngine::new()))
}
