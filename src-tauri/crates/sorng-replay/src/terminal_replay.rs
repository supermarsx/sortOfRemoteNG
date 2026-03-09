// sorng-replay – Terminal replay (SSH / Telnet / Serial)
//
// Parses asciicast-v2 and `script` timing files, renders accumulated
// terminal state at a given timestamp, and extracts command-execution
// events heuristically.

use crate::error::{ReplayError, ReplayResult};
use crate::types::{TerminalEventType, TerminalFrame};

/// Parse an asciicast v2 capture.
///
/// Format: first line is a JSON header; subsequent lines are JSON arrays
/// `[time_seconds, event_type, data]`.
pub fn parse_asciicast(data: &str) -> ReplayResult<Vec<TerminalFrame>> {
    let mut frames = Vec::new();
    let mut lines = data.lines();

    // First line: header — skip (we don't need width/height for replay)
    let header_line = lines
        .next()
        .ok_or_else(|| ReplayError::ParseError("empty asciicast data".into()))?;

    // Validate header is JSON
    let _header: serde_json::Value = serde_json::from_str(header_line)
        .map_err(|e| ReplayError::ParseError(format!("invalid asciicast header: {e}")))?;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let arr: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|e| ReplayError::ParseError(format!("invalid asciicast event: {e}")))?;

        let arr = arr
            .as_array()
            .ok_or_else(|| ReplayError::ParseError("event is not an array".into()))?;

        if arr.len() < 3 {
            continue;
        }

        let time_secs = arr[0]
            .as_f64()
            .ok_or_else(|| ReplayError::ParseError("event time is not a number".into()))?;
        let event_code = arr[1]
            .as_str()
            .ok_or_else(|| ReplayError::ParseError("event type is not a string".into()))?;
        let event_data = arr[2]
            .as_str()
            .ok_or_else(|| ReplayError::ParseError("event data is not a string".into()))?;

        let event_type = match event_code {
            "o" => TerminalEventType::Output,
            "i" => TerminalEventType::Input,
            "r" => {
                // Resize event: data is "COLSxROWS"
                let parts: Vec<&str> = event_data.split('x').collect();
                if parts.len() == 2 {
                    let cols = parts[0].parse::<u16>().unwrap_or(80);
                    let rows = parts[1].parse::<u16>().unwrap_or(24);
                    TerminalEventType::Resize(cols, rows)
                } else {
                    TerminalEventType::Output
                }
            }
            _ => TerminalEventType::Output,
        };

        frames.push(TerminalFrame {
            timestamp_ms: (time_secs * 1000.0) as u64,
            data: event_data.to_string(),
            event_type,
        });
    }

    if frames.is_empty() {
        return Err(ReplayError::ParseError(
            "asciicast contained no events".into(),
        ));
    }

    Ok(frames)
}

/// Parse a UNIX `script` timing file paired with its typescript.
///
/// Timing format is lines of `<delay_seconds> <byte_count>`.
/// The corresponding typescript data is provided as a separate blob.
///
/// For simplicity this function accepts the combined format where
/// the input `data` contains lines of `<delay> <text>` (as produced
/// by e.g. `scriptreplay --timing`-compatible output).
///
/// If the data looks like pure timing lines (`<float> <int>`), we
/// synthesise frames with empty data (the actual bytes would come
/// from the typescript file which is not available here).
pub fn parse_script_recording(data: &str) -> ReplayResult<Vec<TerminalFrame>> {
    let mut frames = Vec::new();
    let mut cumulative_ms: u64 = 0;

    for line in data.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.splitn(2, ' ');
        let delay_str = parts
            .next()
            .ok_or_else(|| ReplayError::ParseError("missing delay in script timing".into()))?;
        let rest = parts.next().unwrap_or("");

        let delay_secs: f64 = delay_str
            .parse()
            .map_err(|_| ReplayError::ParseError(format!("invalid delay: {delay_str}")))?;
        cumulative_ms += (delay_secs * 1000.0) as u64;

        // `rest` may be a byte count or actual text depending on the flavour.
        let frame_data = if rest.parse::<u64>().is_ok() {
            // Pure timing line — no text available
            String::new()
        } else {
            rest.to_string()
        };

        frames.push(TerminalFrame {
            timestamp_ms: cumulative_ms,
            data: frame_data,
            event_type: TerminalEventType::Output,
        });
    }

    if frames.is_empty() {
        return Err(ReplayError::ParseError(
            "script recording contained no events".into(),
        ));
    }

    Ok(frames)
}

/// Build the terminal state at a given position by concatenating all
/// output frames up to (and including) that timestamp.
pub fn render_terminal_at(frames: &[TerminalFrame], position_ms: u64) -> String {
    let mut buf = String::new();
    for f in frames {
        if f.timestamp_ms > position_ms {
            break;
        }
        if matches!(f.event_type, TerminalEventType::Output) {
            buf.push_str(&f.data);
        }
    }
    buf
}

/// Heuristic extraction of command executions.
///
/// Looks for patterns that resemble a shell prompt followed by a
/// command (text before a newline in input events, or after common
/// prompt characters like `$`, `#`, `>` in output).
pub fn get_command_events(frames: &[TerminalFrame]) -> Vec<(u64, String)> {
    let prompt_re = regex::Regex::new(r"[$#>]\s+(.+)").expect("built-in regex must compile");

    let mut commands: Vec<(u64, String)> = Vec::new();

    for f in frames {
        match &f.event_type {
            TerminalEventType::Input => {
                // Input events that end with a newline are likely command submissions
                let trimmed = f.data.trim();
                if !trimmed.is_empty() && (f.data.ends_with('\n') || f.data.ends_with('\r')) {
                    commands.push((f.timestamp_ms, trimmed.to_string()));
                }
            }
            TerminalEventType::Output => {
                // Look for prompt patterns in output
                for cap in prompt_re.captures_iter(&f.data) {
                    if let Some(m) = cap.get(1) {
                        let cmd = m.as_str().trim();
                        if !cmd.is_empty() && cmd.len() < 500 {
                            commands.push((f.timestamp_ms, cmd.to_string()));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    commands.dedup_by(|a, b| a.1 == b.1 && a.0.abs_diff(b.0) < 100);
    commands
}
