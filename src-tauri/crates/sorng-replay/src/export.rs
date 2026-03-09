// sorng-replay – Export functionality
//
// Convert replay data to various output formats.

use crate::error::{ReplayError, ReplayResult};
use crate::player::ReplayPlayer;
use crate::types::*;

/// Master export dispatcher.  Returns the exported content as raw bytes.
pub fn export_session(player: &ReplayPlayer, options: ExportOptions) -> ReplayResult<Vec<u8>> {
    match options.format {
        ExportFormat::Json => {
            let json = export_to_json(player, &options)?;
            Ok(json.into_bytes())
        }
        ExportFormat::Asciicast => match &player.frames {
            FrameData::Terminal(frames) => {
                let ac = export_to_asciicast(frames, &options)?;
                Ok(ac.into_bytes())
            }
            _ => Err(ReplayError::ExportError(
                "asciicast export is only available for terminal recordings".into(),
            )),
        },
        ExportFormat::Text => match &player.frames {
            FrameData::Terminal(frames) => {
                let txt = export_to_text(frames, &options)?;
                Ok(txt.into_bytes())
            }
            _ => Err(ReplayError::ExportError(
                "text export is only available for terminal recordings".into(),
            )),
        },
        ExportFormat::Srt => {
            let srt = export_to_srt(&player.session.annotations, &options)?;
            Ok(srt.into_bytes())
        }
        ExportFormat::Gif => Err(ReplayError::ExportError(
            "GIF export requires an external encoder and is not yet implemented in the core crate"
                .into(),
        )),
        ExportFormat::WebM => Err(ReplayError::ExportError(
            "WebM export requires an external encoder and is not yet implemented in the core crate"
                .into(),
        )),
    }
}

/// Export terminal frames to asciicast v2 format.
pub fn export_to_asciicast(
    frames: &[TerminalFrame],
    options: &ExportOptions,
) -> ReplayResult<String> {
    let filtered = filter_frames(frames, options.start_ms, options.end_ms);
    let offset = options.start_ms.unwrap_or(0);

    // Determine terminal dimensions from the last resize event, or default.
    let (cols, rows) = filtered
        .iter()
        .rev()
        .find_map(|f| match f.event_type {
            TerminalEventType::Resize(c, r) => Some((c as u32, r as u32)),
            _ => None,
        })
        .unwrap_or((80, 24));

    let mut out = String::new();

    // Header line
    let header = serde_json::json!({
        "version": 2,
        "width": cols,
        "height": rows,
        "timestamp": chrono::Utc::now().timestamp(),
    });
    out.push_str(&header.to_string());
    out.push('\n');

    // Event lines
    for f in &filtered {
        let time_secs = (f.timestamp_ms.saturating_sub(offset)) as f64 / 1000.0;
        let event_code = match &f.event_type {
            TerminalEventType::Output => "o",
            TerminalEventType::Input => "i",
            TerminalEventType::Resize(_, _) => "r",
        };
        let data = match &f.event_type {
            TerminalEventType::Resize(c, r) => format!("{c}x{r}"),
            _ => f.data.clone(),
        };
        let escaped_data =
            serde_json::to_string(&data).map_err(|e| ReplayError::ExportError(e.to_string()))?;
        out.push_str(&format!(
            "[{time_secs:.6}, \"{event_code}\", {escaped_data}]\n"
        ));
    }

    Ok(out)
}

/// Export terminal frames to plain text (output events only).
pub fn export_to_text(frames: &[TerminalFrame], options: &ExportOptions) -> ReplayResult<String> {
    let filtered = filter_frames(frames, options.start_ms, options.end_ms);

    let mut out = String::new();
    for f in &filtered {
        if matches!(f.event_type, TerminalEventType::Output) {
            out.push_str(&f.data);
        }
    }
    Ok(out)
}

/// Export the full player state to a JSON document.
pub fn export_to_json(player: &ReplayPlayer, options: &ExportOptions) -> ReplayResult<String> {
    let start = options.start_ms.unwrap_or(0);
    let end = options.end_ms.unwrap_or(player.session.total_duration_ms);

    let annotations: Vec<&Annotation> = if options.include_annotations {
        player
            .session
            .annotations
            .iter()
            .filter(|a| a.position_ms >= start && a.position_ms <= end)
            .collect()
    } else {
        Vec::new()
    };

    let bookmarks: Vec<&Bookmark> = player
        .session
        .bookmarks
        .iter()
        .filter(|b| b.position_ms >= start && b.position_ms <= end)
        .collect();

    let value = serde_json::json!({
        "session": {
            "id": player.session.id,
            "recording_id": player.session.recording_id,
            "recording_type": player.session.recording_type,
            "total_duration_ms": player.session.total_duration_ms,
            "total_frames": player.session.total_frames,
            "created_at": player.session.created_at,
        },
        "export_range": {
            "start_ms": start,
            "end_ms": end,
        },
        "annotations": annotations,
        "bookmarks": bookmarks,
        "frames": export_frame_data_json(&player.frames, start, end),
    });

    serde_json::to_string_pretty(&value).map_err(|e| ReplayError::ExportError(e.to_string()))
}

/// Export annotations as SRT subtitles.
pub fn export_to_srt(annotations: &[Annotation], options: &ExportOptions) -> ReplayResult<String> {
    let start = options.start_ms.unwrap_or(0);
    let end = options.end_ms.unwrap_or(u64::MAX);

    let filtered: Vec<&Annotation> = annotations
        .iter()
        .filter(|a| a.position_ms >= start && a.position_ms <= end)
        .collect();

    let mut out = String::new();
    for (i, ann) in filtered.iter().enumerate() {
        let seq = i + 1;
        let start_ts = format_srt_time(ann.position_ms);
        // Each subtitle is shown for 3 seconds (or until the next annotation).
        let show_until = filtered
            .get(i + 1)
            .map(|next| next.position_ms)
            .unwrap_or(ann.position_ms + 3000);
        let end_ts = format_srt_time(show_until);

        out.push_str(&format!("{seq}\n{start_ts} --> {end_ts}\n{}\n\n", ann.text));
    }

    Ok(out)
}

// ── Helpers ───────────────────────────────────────────────────────────

fn filter_frames(
    frames: &[TerminalFrame],
    start_ms: Option<u64>,
    end_ms: Option<u64>,
) -> Vec<&TerminalFrame> {
    let s = start_ms.unwrap_or(0);
    let e = end_ms.unwrap_or(u64::MAX);
    frames
        .iter()
        .filter(|f| f.timestamp_ms >= s && f.timestamp_ms <= e)
        .collect()
}

fn export_frame_data_json(frames: &FrameData, start_ms: u64, end_ms: u64) -> serde_json::Value {
    match frames {
        FrameData::Terminal(f) => {
            let filtered: Vec<&TerminalFrame> = f
                .iter()
                .filter(|fr| fr.timestamp_ms >= start_ms && fr.timestamp_ms <= end_ms)
                .collect();
            serde_json::json!(filtered)
        }
        FrameData::Video(f) => {
            let filtered: Vec<&VideoFrame> = f
                .iter()
                .filter(|fr| fr.timestamp_ms >= start_ms && fr.timestamp_ms <= end_ms)
                .collect();
            serde_json::json!(filtered)
        }
        FrameData::Har(f) => {
            let filtered: Vec<&HarEntry> = f
                .iter()
                .filter(|fr| fr.timestamp_ms >= start_ms && fr.timestamp_ms <= end_ms)
                .collect();
            serde_json::json!(filtered)
        }
    }
}

/// Format milliseconds as SRT timestamp: HH:MM:SS,mmm
fn format_srt_time(ms: u64) -> String {
    let total_secs = ms / 1000;
    let millis = ms % 1000;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}
