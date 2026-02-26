use chrono::Utc;

use super::types::*;
use super::ACTIVE_RECORDINGS;

// ===============================
// Internal recording helpers
// ===============================

/// Add output data to an active recording (internal helper)
pub(crate) fn record_output(session_id: &str, data: &str) {
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
pub(crate) fn record_input(session_id: &str, data: &str) {
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
pub(crate) fn record_resize(session_id: &str, cols: u32, rows: u32) {
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

/// Start recording an SSH session's terminal output
#[tauri::command]
pub async fn start_session_recording(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    record_input: Option<bool>,
    initial_cols: Option<u32>,
    initial_rows: Option<u32>,
) -> Result<(), String> {
    let ssh = state.lock().await;

    let session = ssh.sessions.get(&session_id)
        .ok_or("Session not found")?;

    let mut recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;

    if recordings.contains_key(&session_id) {
        return Err("Recording already active for this session".to_string());
    }

    recordings.insert(session_id.clone(), RecordingState {
        start_time: std::time::Instant::now(),
        start_utc: Utc::now(),
        host: session.config.host.clone(),
        username: session.config.username.clone(),
        cols: initial_cols.unwrap_or(80),
        rows: initial_rows.unwrap_or(24),
        entries: Vec::new(),
        record_input: record_input.unwrap_or(false),
    });

    log::info!("Started recording SSH session: {}", session_id);
    Ok(())
}

/// Stop recording and return the recording data
#[tauri::command]
pub fn stop_session_recording(
    session_id: String,
) -> Result<SessionRecording, String> {
    let mut recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;

    let state = recordings.remove(&session_id)
        .ok_or("No active recording for this session")?;

    let duration_ms = state.start_time.elapsed().as_millis() as u64;

    let recording = SessionRecording {
        metadata: SessionRecordingMetadata {
            session_id: session_id.clone(),
            start_time: state.start_utc,
            end_time: Some(Utc::now()),
            host: state.host,
            username: state.username,
            cols: state.cols,
            rows: state.rows,
            duration_ms,
            entry_count: state.entries.len(),
        },
        entries: state.entries,
    };

    log::info!("Stopped recording SSH session: {} ({} entries, {}ms)",
               session_id, recording.metadata.entry_count, duration_ms);

    Ok(recording)
}

/// Check if a session is being recorded
#[tauri::command]
pub fn is_session_recording(session_id: String) -> Result<bool, String> {
    let recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    Ok(recordings.contains_key(&session_id))
}

/// Get recording status for a session
#[tauri::command]
pub fn get_recording_status(session_id: String) -> Result<Option<SessionRecordingMetadata>, String> {
    let recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;

    if let Some(state) = recordings.get(&session_id) {
        let duration_ms = state.start_time.elapsed().as_millis() as u64;
        Ok(Some(SessionRecordingMetadata {
            session_id: session_id.clone(),
            start_time: state.start_utc,
            end_time: None,
            host: state.host.clone(),
            username: state.username.clone(),
            cols: state.cols,
            rows: state.rows,
            duration_ms,
            entry_count: state.entries.len(),
        }))
    } else {
        Ok(None)
    }
}

/// Export recording to asciicast v2 format (compatible with asciinema)
#[tauri::command]
pub fn export_recording_asciicast(recording: SessionRecording) -> Result<String, String> {
    let mut output = Vec::new();

    let header = serde_json::json!({
        "version": 2,
        "width": recording.metadata.cols,
        "height": recording.metadata.rows,
        "timestamp": recording.metadata.start_time.timestamp(),
        "duration": recording.metadata.duration_ms as f64 / 1000.0,
        "env": {
            "SHELL": "/bin/bash",
            "TERM": "xterm-256color"
        },
        "title": format!("SSH Session: {}@{}", recording.metadata.username, recording.metadata.host)
    });
    output.push(header.to_string());

    for entry in &recording.entries {
        let time_secs = entry.timestamp_ms as f64 / 1000.0;
        match &entry.entry_type {
            RecordingEntryType::Output => {
                let event = serde_json::json!([time_secs, "o", entry.data]);
                output.push(event.to_string());
            }
            RecordingEntryType::Input => {
                let event = serde_json::json!([time_secs, "i", entry.data]);
                output.push(event.to_string());
            }
            RecordingEntryType::Resize { cols, rows } => {
                let resize_data = format!("\x1b[8;{};{}t", rows, cols);
                let event = serde_json::json!([time_secs, "o", resize_data]);
                output.push(event.to_string());
            }
        }
    }

    Ok(output.join("\n"))
}

/// Export recording to script/typescript format (Unix script command format)
#[tauri::command]
pub fn export_recording_script(recording: SessionRecording) -> Result<String, String> {
    let mut output = String::new();

    output.push_str(&format!(
        "Script started on {}\n",
        recording.metadata.start_time.format("%Y-%m-%d %H:%M:%S UTC")
    ));

    for entry in &recording.entries {
        if let RecordingEntryType::Output = entry.entry_type {
            output.push_str(&entry.data);
        }
    }

    if let Some(end_time) = recording.metadata.end_time {
        output.push_str(&format!(
            "\nScript done on {}\n",
            end_time.format("%Y-%m-%d %H:%M:%S UTC")
        ));
    }

    Ok(output)
}

/// List all active recordings
#[tauri::command]
pub fn list_active_recordings() -> Result<Vec<String>, String> {
    let recordings = ACTIVE_RECORDINGS.lock()
        .map_err(|e| format!("Failed to lock recordings: {}", e))?;
    Ok(recordings.keys().cloned().collect())
}
