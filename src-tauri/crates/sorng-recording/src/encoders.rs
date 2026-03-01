// sorng-recording – Encoders
//
// Each encoder converts a completed recording into a specific export format.
// All encoding functions are pure (no I/O) so they can run on blocking
// threads without locking the engine mutex.

use crate::error::{RecordingError, RecordingResult};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Asciicast v2 encoder  (SSH / Telnet terminal recordings)
// ═══════════════════════════════════════════════════════════════════════

/// Encode a `TerminalRecording` as asciicast v2 (asciinema-compatible).
/// Returns one JSON object per line (header + event lines).
pub fn encode_asciicast(recording: &TerminalRecording) -> RecordingResult<String> {
    let mut lines: Vec<String> = Vec::with_capacity(recording.entries.len() + 1);

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
        "title": format!(
            "{} Session: {}@{}",
            match &recording.metadata.protocol {
                RecordingProtocol::Ssh => "SSH",
                RecordingProtocol::Telnet => "Telnet",
                _ => "Terminal",
            },
            recording.metadata.username,
            recording.metadata.host
        )
    });
    lines.push(header.to_string());

    for entry in &recording.entries {
        let t = entry.timestamp_ms as f64 / 1000.0;
        match &entry.entry_type {
            TerminalEntryType::Output => {
                let ev = serde_json::json!([t, "o", entry.data]);
                lines.push(ev.to_string());
            }
            TerminalEntryType::Input => {
                let ev = serde_json::json!([t, "i", entry.data]);
                lines.push(ev.to_string());
            }
            TerminalEntryType::Resize { cols, rows } => {
                let resize_data = format!("\x1b[8;{};{}t", rows, cols);
                let ev = serde_json::json!([t, "o", resize_data]);
                lines.push(ev.to_string());
            }
        }
    }
    Ok(lines.join("\n"))
}

// ═══════════════════════════════════════════════════════════════════════
//  Unix `script` format encoder
// ═══════════════════════════════════════════════════════════════════════

/// Encode a `TerminalRecording` to the legacy Unix `script` command format.
pub fn encode_script(recording: &TerminalRecording) -> RecordingResult<String> {
    let mut out = String::new();
    out.push_str(&format!(
        "Script started on {}\n",
        recording
            .metadata
            .start_time
            .format("%Y-%m-%d %H:%M:%S UTC")
    ));

    for entry in &recording.entries {
        if let TerminalEntryType::Output = entry.entry_type {
            out.push_str(&entry.data);
        }
    }

    if let Some(end) = recording.metadata.end_time {
        out.push_str(&format!(
            "\nScript done on {}\n",
            end.format("%Y-%m-%d %H:%M:%S UTC")
        ));
    }
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════
//  HAR 1.2 encoder  (HTTP recordings)
// ═══════════════════════════════════════════════════════════════════════

/// Encode an `HttpRecording` as an HAR 1.2 JSON string.
pub fn encode_har(recording: &HttpRecording) -> RecordingResult<String> {
    let entries: Vec<serde_json::Value> = recording
        .entries
        .iter()
        .map(|e| {
            let req_headers: Vec<serde_json::Value> = e
                .request_headers
                .iter()
                .map(|(k, v)| serde_json::json!({"name": k, "value": v}))
                .collect();
            let resp_headers: Vec<serde_json::Value> = e
                .response_headers
                .iter()
                .map(|(k, v)| serde_json::json!({"name": k, "value": v}))
                .collect();

            serde_json::json!({
                "startedDateTime": recording.metadata.start_time.to_rfc3339(),
                "time": e.duration_ms as f64,
                "request": {
                    "method": e.method,
                    "url": e.url,
                    "httpVersion": "HTTP/1.1",
                    "cookies": [],
                    "headers": req_headers,
                    "queryString": [],
                    "headersSize": -1,
                    "bodySize": e.request_body_size
                },
                "response": {
                    "status": e.status,
                    "statusText": "",
                    "httpVersion": "HTTP/1.1",
                    "cookies": [],
                    "headers": resp_headers,
                    "content": {
                        "size": e.response_body_size,
                        "mimeType": e.content_type.as_deref().unwrap_or("application/octet-stream")
                    },
                    "redirectURL": "",
                    "headersSize": -1,
                    "bodySize": e.response_body_size
                },
                "cache": {},
                "timings": {
                    "send": 0,
                    "wait": e.duration_ms as f64,
                    "receive": 0
                },
                "comment": e.error.as_deref().unwrap_or("")
            })
        })
        .collect();

    let har = serde_json::json!({
        "log": {
            "version": "1.2",
            "creator": {
                "name": "SortOfRemote NG",
                "version": "1.0"
            },
            "entries": entries,
            "pages": [{
                "startedDateTime": recording.metadata.start_time.to_rfc3339(),
                "id": recording.metadata.session_id,
                "title": format!("Recording: {}", recording.metadata.target_url),
                "pageTimings": {
                    "onLoad": recording.metadata.duration_ms
                }
            }]
        }
    });

    serde_json::to_string_pretty(&har).map_err(|e| RecordingError::EncodingError(e.to_string()))
}

// ═══════════════════════════════════════════════════════════════════════
//  CSV encoder  (DB queries, HTTP entries)
// ═══════════════════════════════════════════════════════════════════════

/// Encode DB query entries as CSV.
pub fn encode_db_queries_csv(recording: &DbQueryRecording) -> RecordingResult<String> {
    let mut out = String::from("timestamp_ms,query,duration_ms,rows_affected,database,error\n");
    for e in &recording.entries {
        // Escape commas / quotes in query text
        let q = e.query.replace('"', "\"\"");
        out.push_str(&format!(
            "{},\"{}\",{},{},{},{}\n",
            e.timestamp_ms,
            q,
            e.duration_ms,
            e.rows_affected.map(|r| r.to_string()).unwrap_or_default(),
            e.database,
            e.error.as_deref().unwrap_or("")
        ));
    }
    Ok(out)
}

/// Encode HTTP entries as CSV.
pub fn encode_http_csv(recording: &HttpRecording) -> RecordingResult<String> {
    let mut out =
        String::from("timestamp_ms,method,url,status,content_type,request_body_size,response_body_size,duration_ms,error\n");
    for e in &recording.entries {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{}\n",
            e.timestamp_ms,
            e.method,
            e.url,
            e.status,
            e.content_type.as_deref().unwrap_or(""),
            e.request_body_size,
            e.response_body_size,
            e.duration_ms,
            e.error.as_deref().unwrap_or("")
        ));
    }
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════
//  JSON encoder  (generic — any recording)
// ═══════════════════════════════════════════════════════════════════════

/// Generic JSON encoder for terminal recordings.
pub fn encode_terminal_json(recording: &TerminalRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

/// Generic JSON encoder for screen recordings.
pub fn encode_screen_json(recording: &RdpRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

/// Generic JSON encoder for HTTP recordings.
pub fn encode_http_json(recording: &HttpRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

/// Generic JSON encoder for Telnet recordings.
pub fn encode_telnet_json(recording: &TelnetRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

/// Generic JSON encoder for serial recordings.
pub fn encode_serial_json(recording: &SerialRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

/// Generic JSON encoder for DB recordings.
pub fn encode_db_json(recording: &DbQueryRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

/// Generic JSON encoder for macros.
pub fn encode_macro_json(recording: &MacroRecording) -> RecordingResult<String> {
    serde_json::to_string_pretty(recording)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}

// ═══════════════════════════════════════════════════════════════════════
//  Telnet → Asciicast  (output-only asciicast from telnet sessions)
// ═══════════════════════════════════════════════════════════════════════

pub fn encode_telnet_asciicast(recording: &TelnetRecording) -> RecordingResult<String> {
    let mut lines: Vec<String> = Vec::with_capacity(recording.entries.len() + 1);

    let header = serde_json::json!({
        "version": 2,
        "width": 80,
        "height": 24,
        "timestamp": recording.metadata.start_time.timestamp(),
        "duration": recording.metadata.duration_ms as f64 / 1000.0,
        "title": format!("Telnet: {}:{}", recording.metadata.host, recording.metadata.port)
    });
    lines.push(header.to_string());

    for entry in &recording.entries {
        let t = entry.timestamp_ms as f64 / 1000.0;
        match &entry.entry_type {
            TelnetEntryType::Output => {
                let ev = serde_json::json!([t, "o", entry.data]);
                lines.push(ev.to_string());
            }
            TelnetEntryType::Input => {
                let ev = serde_json::json!([t, "i", entry.data]);
                lines.push(ev.to_string());
            }
            _ => {}
        }
    }
    Ok(lines.join("\n"))
}

// ═══════════════════════════════════════════════════════════════════════
//  Serial → raw text dump
// ═══════════════════════════════════════════════════════════════════════

pub fn encode_serial_raw(recording: &SerialRecording) -> RecordingResult<String> {
    let mut out = String::new();
    out.push_str(&format!(
        "# Serial recording: {} @ {} baud\n# Started: {}\n\n",
        recording.metadata.port_name,
        recording.metadata.baud_rate,
        recording.metadata.start_time.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    for entry in &recording.entries {
        match &entry.entry_type {
            SerialEntryType::Received => {
                out.push_str(&entry.data);
            }
            SerialEntryType::Sent => {
                out.push_str(&format!("[TX] {}", entry.data));
            }
            SerialEntryType::ControlLine(line) => {
                out.push_str(&format!("[CTRL] {}\n", line));
            }
        }
    }
    if let Some(end) = recording.metadata.end_time {
        out.push_str(&format!(
            "\n# Ended: {}\n",
            end.format("%Y-%m-%d %H:%M:%S UTC")
        ));
    }
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════
//  Frame sequence manifest  (RDP/VNC screen recordings)
// ═══════════════════════════════════════════════════════════════════════

/// Generate a JSON manifest for the recorded frame sequence.
/// The actual frame data stays in `RdpRecording.frames` — this just
/// produces an index suitable for a frontend player.
pub fn encode_frame_sequence_manifest(recording: &RdpRecording) -> RecordingResult<String> {
    let frames_meta: Vec<serde_json::Value> = recording
        .frames
        .iter()
        .map(|f| {
            serde_json::json!({
                "index": f.frame_index,
                "timestamp_ms": f.timestamp_ms,
                "width": f.width,
                "height": f.height,
                "size_bytes": f.data_b64.len()
            })
        })
        .collect();

    let manifest = serde_json::json!({
        "recording_id": recording.metadata.recording_id,
        "width": recording.metadata.width,
        "height": recording.metadata.height,
        "fps": recording.metadata.fps,
        "duration_ms": recording.metadata.duration_ms,
        "frame_count": recording.metadata.frame_count,
        "frames": frames_meta
    });

    serde_json::to_string_pretty(&manifest)
        .map_err(|e| RecordingError::EncodingError(e.to_string()))
}
