
use super::types::*;
use super::ACTIVE_RECORDINGS;

// ===============================
// Internal recording helpers
// ===============================

/// Add output data to an active recording (internal helper)
pub fn record_output(session_id: &str, data: &str) {
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(state) = recordings.get_mut(session_id) {
            let timestamp_ms = state.start_time.elapsed().as_millis() as u64;
            state.entries.push(SessionRecordingEntry {
                timestamp_ms,
                data: data.to_string(),
                entry_type: RecordingEntryType::Output,
            });
        }
    }
}

/// Add input data to an active recording (internal helper)
pub fn record_input(session_id: &str, data: &str) {
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(state) = recordings.get_mut(session_id) {
            if state.record_input {
                let timestamp_ms = state.start_time.elapsed().as_millis() as u64;
                state.entries.push(SessionRecordingEntry {
                    timestamp_ms,
                    data: data.to_string(),
                    entry_type: RecordingEntryType::Input,
                });
            }
        }
    }
}

/// Record a resize event
pub fn record_resize(session_id: &str, cols: u32, rows: u32) {
    if let Ok(mut recordings) = ACTIVE_RECORDINGS.lock() {
        if let Some(state) = recordings.get_mut(session_id) {
            let timestamp_ms = state.start_time.elapsed().as_millis() as u64;
            state.entries.push(SessionRecordingEntry {
                timestamp_ms,
                data: String::new(),
                entry_type: RecordingEntryType::Resize { cols, rows },
            });
            state.cols = cols;
            state.rows = rows;
        }
    }
}

// ===============================
// Tauri commands for recording
// ===============================
