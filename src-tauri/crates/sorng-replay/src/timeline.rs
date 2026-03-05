// sorng-replay – Timeline generation
//
// Builds the visual timeline: segments, markers, activity heat-maps,
// and overview thumbnails.

use crate::player::ReplayPlayer;
use crate::types::*;

/// Divide the total duration into `segment_count` evenly-spaced segments and
/// count how many frame timestamps fall into each.
pub fn generate_timeline(
    frame_timestamps: &[u64],
    total_duration_ms: u64,
    segment_count: usize,
) -> Vec<TimelineSegment> {
    if segment_count == 0 || total_duration_ms == 0 {
        return Vec::new();
    }

    let seg_len = (total_duration_ms as f64 / segment_count as f64).ceil() as u64;
    let mut segments = Vec::with_capacity(segment_count);

    for i in 0..segment_count {
        let start_ms = i as u64 * seg_len;
        let end_ms = ((i as u64 + 1) * seg_len).min(total_duration_ms);

        let event_count = frame_timestamps
            .iter()
            .filter(|&&ts| ts >= start_ms && ts < end_ms)
            .count();

        segments.push(TimelineSegment {
            start_ms,
            end_ms,
            label: None,
            event_count,
            has_activity: event_count > 0,
        });
    }

    segments
}

/// Auto-detect interesting points and return them as timeline markers.
pub fn generate_markers(player: &ReplayPlayer) -> Vec<TimelineMarker> {
    let mut markers: Vec<TimelineMarker> = Vec::new();

    // Mark every bookmark
    for bm in &player.session.bookmarks {
        markers.push(TimelineMarker {
            position_ms: bm.position_ms,
            marker_type: MarkerType::Bookmark,
            label: bm.label.clone(),
            color: Some("#2196F3".to_string()),
        });
    }

    // Mark every annotation
    for ann in &player.session.annotations {
        markers.push(TimelineMarker {
            position_ms: ann.position_ms,
            marker_type: MarkerType::Annotation,
            label: ann.text.clone(),
            color: ann.color.clone(),
        });
    }

    // Type-specific markers
    match &player.frames {
        FrameData::Terminal(frames) => {
            // Mark detected command executions
            let cmds = crate::terminal_replay::get_command_events(frames);
            for (ts, cmd) in cmds {
                markers.push(TimelineMarker {
                    position_ms: ts,
                    marker_type: MarkerType::CommandExecution,
                    label: cmd,
                    color: Some("#4CAF50".to_string()),
                });
            }
            // Mark input events
            for f in frames {
                if matches!(f.event_type, TerminalEventType::Input) {
                    markers.push(TimelineMarker {
                        position_ms: f.timestamp_ms,
                        marker_type: MarkerType::UserInput,
                        label: "input".to_string(),
                        color: Some("#FF9800".to_string()),
                    });
                }
            }
        }
        FrameData::Har(entries) => {
            for (i, e) in entries.iter().enumerate() {
                let mt = if e.status >= 400 {
                    MarkerType::Error
                } else {
                    MarkerType::NetworkRequest
                };
                markers.push(TimelineMarker {
                    position_ms: e.timestamp_ms,
                    marker_type: mt,
                    label: format!("{} {} → {}", e.method, e.url, e.status),
                    color: Some(if e.status >= 400 {
                        "#F44336".to_string()
                    } else {
                        "#9C27B0".to_string()
                    }),
                });
                let _ = i; // suppress unused warning
            }
        }
        FrameData::Video(_frames) => {
            // For video we just mark the first and last frame.
            if let Some(first) = _frames.first() {
                markers.push(TimelineMarker {
                    position_ms: first.timestamp_ms,
                    marker_type: MarkerType::Event,
                    label: "recording start".to_string(),
                    color: Some("#4CAF50".to_string()),
                });
            }
            if let Some(last) = _frames.last() {
                markers.push(TimelineMarker {
                    position_ms: last.timestamp_ms,
                    marker_type: MarkerType::Event,
                    label: "recording end".to_string(),
                    color: Some("#F44336".to_string()),
                });
            }
        }
    }

    markers.sort_by_key(|m| m.position_ms);
    markers
}

/// Build a normalised activity heat-map (0.0 – 1.0) over `bucket_count` buckets.
pub fn get_activity_heatmap(timestamps: &[u64], bucket_count: usize) -> Vec<f64> {
    if bucket_count == 0 || timestamps.is_empty() {
        return vec![0.0; bucket_count];
    }

    let max_ts = *timestamps.iter().max().unwrap_or(&0);
    if max_ts == 0 {
        return vec![0.0; bucket_count];
    }

    let bucket_width = (max_ts as f64 / bucket_count as f64).ceil() as u64;
    let mut counts = vec![0u64; bucket_count];

    for &ts in timestamps {
        let idx = if bucket_width == 0 {
            0
        } else {
            ((ts / bucket_width) as usize).min(bucket_count - 1)
        };
        counts[idx] += 1;
    }

    let peak = *counts.iter().max().unwrap_or(&1) as f64;
    counts.iter().map(|&c| c as f64 / peak).collect()
}

/// Return evenly-spaced overview thumbnails (position_ms, thumbnail_data).
/// For terminal recordings the "thumbnail" is a short text snippet;
/// for video, the base64 frame data; for HAR, a JSON summary string.
pub fn get_overview_thumbnails(player: &ReplayPlayer, count: usize) -> Vec<(u64, String)> {
    if count == 0 || player.session.total_duration_ms == 0 {
        return Vec::new();
    }

    let step = player.session.total_duration_ms / count as u64;
    let mut thumbnails = Vec::with_capacity(count);

    for i in 0..count {
        let pos = i as u64 * step;
        let data = match &player.frames {
            FrameData::Terminal(frames) => {
                let text = crate::terminal_replay::render_terminal_at(frames, pos);
                // Take last 200 chars as preview
                let preview_start = text.len().saturating_sub(200);
                text[preview_start..].to_string()
            }
            FrameData::Video(frames) => {
                crate::video_replay::get_frame_at_position(frames, pos)
                    .map(|f| f.data_base64.clone())
                    .unwrap_or_default()
            }
            FrameData::Har(entries) => {
                let active = crate::har_replay::get_entries_at_time(entries, pos);
                serde_json::to_string(&active).unwrap_or_default()
            }
        };
        thumbnails.push((pos, data));
    }

    thumbnails
}
