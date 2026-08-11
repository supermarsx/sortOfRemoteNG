use super::recording::*;

/// Start recording an SSH session's terminal output
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_session_recording(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    record_input: Option<bool>,
    initial_cols: Option<u32>,
    initial_rows: Option<u32>,
    max_bytes: Option<u64>,
    max_entries: Option<usize>,
    max_duration_ms: Option<u64>,
    close_policy: Option<RecordingClosePolicy>,
) -> Result<(), String> {
    let ssh = state.lock().await;

    let session = ssh.sessions.get(&session_id).ok_or("Session not found")?;
    let limits = RecordingLimits::from_options(max_bytes, max_entries, max_duration_ms)?;
    start_recording_state(
        &session_id,
        session.config.host.clone(),
        session.config.username.clone(),
        initial_cols.unwrap_or(80),
        initial_rows.unwrap_or(24),
        record_input.unwrap_or(false),
        limits,
        close_policy.unwrap_or_default(),
    )?;

    log::info!("Started recording SSH session: {}", session_id);
    Ok(())
}

/// Stop recording and return the recording data
#[tauri::command]
pub fn stop_session_recording(session_id: String) -> Result<SessionRecording, String> {
    let recording = stop_recording_state(&session_id)?;
    let duration_ms = recording.metadata.duration_ms;

    log::info!(
        "Stopped recording SSH session: {} ({} entries, {}ms)",
        session_id,
        recording.metadata.entry_count,
        duration_ms
    );

    Ok(recording)
}

/// Check if a session is being recorded
#[tauri::command]
pub fn is_session_recording(session_id: String) -> Result<bool, String> {
    is_recording_active(&session_id)
}

/// Get recording status for a session
#[tauri::command]
pub fn get_recording_status(
    session_id: String,
) -> Result<Option<SessionRecordingMetadata>, String> {
    recording_status(&session_id)
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
        recording
            .metadata
            .start_time
            .format("%Y-%m-%d %H:%M:%S UTC")
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
    active_recording_ids()
}
