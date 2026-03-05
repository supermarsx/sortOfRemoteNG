//! # Teleport Session Recording
//!
//! Playback, listing, and filtering of session recordings.
//! Wraps `tsh play` and `tsh recordings ls` commands.

use crate::types::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Build `tsh recordings ls` command.
pub fn list_recordings_command(format_json: bool) -> Vec<String> {
    let mut cmd = vec![
        "tsh".to_string(),
        "recordings".to_string(),
        "ls".to_string(),
    ];
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh play` command to replay a session recording.
pub fn play_recording_command(session_id: &str, format: Option<&str>) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "play".to_string()];
    if let Some(fmt) = format {
        cmd.push(format!("--format={}", fmt));
    }
    cmd.push(session_id.to_string());
    cmd
}

/// Build `tsh play --format=json` for structured export.
pub fn export_recording_json_command(session_id: &str) -> Vec<String> {
    play_recording_command(session_id, Some("json"))
}

/// Filter recordings by session type.
pub fn filter_recordings_by_type<'a>(
    recordings: &[&'a SessionRecording],
    session_type: SessionType,
) -> Vec<&'a SessionRecording> {
    recordings
        .iter()
        .filter(|r| r.session_type == session_type)
        .copied()
        .collect()
}

/// Filter recordings that match a time window.
pub fn filter_recordings_by_time<'a>(
    recordings: &[&'a SessionRecording],
    after: DateTime<Utc>,
    before: Option<DateTime<Utc>>,
) -> Vec<&'a SessionRecording> {
    recordings
        .iter()
        .filter(|r| {
            let after_ok = r.created >= after;
            let before_ok = before.map_or(true, |b| r.created <= b);
            after_ok && before_ok
        })
        .copied()
        .collect()
}

/// Group recordings by user.
pub fn group_recordings_by_user<'a>(
    recordings: &[&'a SessionRecording],
) -> HashMap<String, Vec<&'a SessionRecording>> {
    let mut map: HashMap<String, Vec<&'a SessionRecording>> = HashMap::new();
    for r in recordings {
        map.entry(r.participants.first().cloned().unwrap_or_default())
            .or_default()
            .push(r);
    }
    map
}

/// Recording summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingSummary {
    pub total: u32,
    pub by_type: HashMap<String, u32>,
    pub total_duration_secs: u64,
    pub total_size_bytes: u64,
}

pub fn summarize_recordings(recordings: &[&SessionRecording]) -> RecordingSummary {
    let mut by_type: HashMap<String, u32> = HashMap::new();
    let mut total_duration = 0u64;
    let mut total_size = 0u64;
    for r in recordings {
        *by_type
            .entry(format!("{:?}", r.session_type))
            .or_insert(0) += 1;
        total_duration += r.duration_ms / 1000;
        total_size += r.size_bytes;
    }
    RecordingSummary {
        total: recordings.len() as u32,
        by_type,
        total_duration_secs: total_duration,
        total_size_bytes: total_size,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_play_recording_command() {
        let cmd = play_recording_command("rec-abc", None);
        assert_eq!(cmd, vec!["tsh", "play", "rec-abc"]);
    }

    #[test]
    fn test_export_json_command() {
        let cmd = export_recording_json_command("rec-abc");
        assert!(cmd.contains(&"--format=json".to_string()));
    }

    #[test]
    fn test_list_recordings_command() {
        let cmd = list_recordings_command(false);
        assert!(!cmd.contains(&"--format=json".to_string()));
    }
}
