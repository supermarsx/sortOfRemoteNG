// sorng-replay – Core player
//
// Holds loaded recording data, current playback position, and supports
// play / pause / stop / seek / speed-change operations.

use chrono::Utc;
use uuid::Uuid;

use crate::error::{ReplayError, ReplayResult};
use crate::types::*;

/// The central replay player.
#[derive(Debug, Clone)]
pub struct ReplayPlayer {
    pub session: ReplaySession,
    pub frames: FrameData,
    pub config: ReplayConfig,
    pub stats: PlaybackStats,
}

impl ReplayPlayer {
    // ── Constructors ──────────────────────────────────────────────────

    /// Create a player for terminal-type recordings.
    pub fn new_terminal(recording_data: Vec<TerminalFrame>, config: ReplayConfig) -> Self {
        let total_duration_ms = recording_data.last().map(|f| f.timestamp_ms).unwrap_or(0);
        let total_frames = recording_data.len();
        Self {
            session: ReplaySession {
                id: Uuid::new_v4().to_string(),
                recording_id: Uuid::new_v4().to_string(),
                recording_type: RecordingType::SshTerminal,
                total_duration_ms,
                total_frames,
                current_position_ms: 0,
                playback_speed: config.default_speed,
                state: PlaybackState::Stopped,
                annotations: Vec::new(),
                bookmarks: Vec::new(),
                created_at: Utc::now(),
            },
            frames: FrameData::Terminal(recording_data),
            config,
            stats: PlaybackStats::default(),
        }
    }

    /// Create a player for video-type recordings (RDP / VNC).
    pub fn new_video(frames: Vec<VideoFrame>, config: ReplayConfig) -> Self {
        let total_duration_ms = frames.last().map(|f| f.timestamp_ms).unwrap_or(0);
        let total_frames = frames.len();
        Self {
            session: ReplaySession {
                id: Uuid::new_v4().to_string(),
                recording_id: Uuid::new_v4().to_string(),
                recording_type: RecordingType::RdpVideo,
                total_duration_ms,
                total_frames,
                current_position_ms: 0,
                playback_speed: config.default_speed,
                state: PlaybackState::Stopped,
                annotations: Vec::new(),
                bookmarks: Vec::new(),
                created_at: Utc::now(),
            },
            frames: FrameData::Video(frames),
            config,
            stats: PlaybackStats::default(),
        }
    }

    /// Create a player for HTTP HAR recordings.
    pub fn new_har(entries: Vec<HarEntry>, config: ReplayConfig) -> Self {
        let total_duration_ms = entries
            .iter()
            .map(|e| e.timestamp_ms + e.duration_ms)
            .max()
            .unwrap_or(0);
        let total_frames = entries.len();
        Self {
            session: ReplaySession {
                id: Uuid::new_v4().to_string(),
                recording_id: Uuid::new_v4().to_string(),
                recording_type: RecordingType::HttpHar,
                total_duration_ms,
                total_frames,
                current_position_ms: 0,
                playback_speed: config.default_speed,
                state: PlaybackState::Stopped,
                annotations: Vec::new(),
                bookmarks: Vec::new(),
                created_at: Utc::now(),
            },
            frames: FrameData::Har(entries),
            config,
            stats: PlaybackStats::default(),
        }
    }

    // ── Transport controls ────────────────────────────────────────────

    /// Begin or resume playback.
    pub fn play(&mut self) {
        match self.session.state {
            PlaybackState::Finished if self.config.loop_playback => {
                self.session.current_position_ms = 0;
                self.session.state = PlaybackState::Playing;
            }
            PlaybackState::Stopped | PlaybackState::Paused => {
                self.session.state = PlaybackState::Playing;
            }
            _ => {}
        }
    }

    /// Pause playback.
    pub fn pause(&mut self) {
        if self.session.state == PlaybackState::Playing {
            self.session.state = PlaybackState::Paused;
        }
    }

    /// Stop playback and reset to the beginning.
    pub fn stop(&mut self) {
        self.session.state = PlaybackState::Stopped;
        self.session.current_position_ms = 0;
    }

    // ── Seeking ───────────────────────────────────────────────────────

    /// Seek to the given target. Returns the new position in ms.
    pub fn seek(&mut self, target: SeekTarget) -> ReplayResult<u64> {
        let max = self.session.total_duration_ms;
        let current = self.session.current_position_ms;

        let new_pos = match target {
            SeekTarget::Absolute(ms) => ms.min(max),
            SeekTarget::Relative(delta) => {
                let signed = current as i64 + delta;
                (signed.max(0) as u64).min(max)
            }
            SeekTarget::Percentage(pct) => {
                let clamped = pct.clamp(0.0, 100.0);
                ((max as f64 * clamped / 100.0) as u64).min(max)
            }
            SeekTarget::NextEvent => self.find_next_event_position(current).unwrap_or(max),
            SeekTarget::PreviousEvent => self.find_prev_event_position(current).unwrap_or(0),
            SeekTarget::NextBookmark => self
                .session
                .bookmarks
                .iter()
                .filter(|b| b.position_ms > current)
                .min_by_key(|b| b.position_ms)
                .map(|b| b.position_ms)
                .unwrap_or(current),
            SeekTarget::PreviousBookmark => self
                .session
                .bookmarks
                .iter()
                .filter(|b| b.position_ms < current)
                .max_by_key(|b| b.position_ms)
                .map(|b| b.position_ms)
                .unwrap_or(current),
        };

        if new_pos > max {
            return Err(ReplayError::SeekOutOfRange {
                requested_ms: new_pos,
                max_ms: max,
            });
        }

        self.session.current_position_ms = new_pos;
        self.stats.seek_count += 1;

        // If was playing or paused, stay in that state; otherwise go to paused.
        if self.session.state == PlaybackState::Stopped
            || self.session.state == PlaybackState::Finished
        {
            self.session.state = PlaybackState::Paused;
        }

        Ok(new_pos)
    }

    /// Set playback speed (clamped 0.25 – 16.0).
    pub fn set_speed(&mut self, speed: f64) {
        self.session.playback_speed = speed.clamp(0.25, 16.0);
    }

    pub fn get_current_position(&self) -> u64 {
        self.session.current_position_ms
    }

    pub fn get_state(&self) -> PlaybackState {
        self.session.state
    }

    // ── Frame access ──────────────────────────────────────────────────

    /// Return a JSON-serialisable snapshot of frame data at the given position.
    /// For terminal recordings the result is the accumulated terminal text;
    /// for video, the frame closest to the timestamp; for HAR, active entries.
    pub fn get_frame_at(&self, position_ms: u64) -> ReplayResult<serde_json::Value> {
        let _ = self.stats.clone(); // touched – in a real impl we'd track cache misses
        match &self.frames {
            FrameData::Terminal(frames) => {
                let text = crate::terminal_replay::render_terminal_at(frames, position_ms);
                Ok(serde_json::json!({
                    "type": "terminal",
                    "position_ms": position_ms,
                    "text": text,
                }))
            }
            FrameData::Video(frames) => {
                let frame = crate::video_replay::get_frame_at_position(frames, position_ms);
                match frame {
                    Some(vf) => Ok(serde_json::json!({
                        "type": "video",
                        "position_ms": vf.timestamp_ms,
                        "width": vf.width,
                        "height": vf.height,
                        "format": vf.format,
                        "data_base64": vf.data_base64,
                    })),
                    None => Err(ReplayError::NotFound(format!(
                        "no video frame at {position_ms} ms"
                    ))),
                }
            }
            FrameData::Har(entries) => {
                let active = crate::har_replay::get_entries_at_time(entries, position_ms);
                Ok(serde_json::json!({
                    "type": "har",
                    "position_ms": position_ms,
                    "entries": active,
                }))
            }
        }
    }

    /// Concatenate terminal output between two timestamps (inclusive ends).
    pub fn get_terminal_output_range(&self, start_ms: u64, end_ms: u64) -> String {
        match &self.frames {
            FrameData::Terminal(frames) => frames
                .iter()
                .filter(|f| {
                    f.timestamp_ms >= start_ms
                        && f.timestamp_ms <= end_ms
                        && matches!(f.event_type, TerminalEventType::Output)
                })
                .map(|f| f.data.as_str())
                .collect::<Vec<_>>()
                .join(""),
            _ => String::new(),
        }
    }

    /// Advance to the next frame after the current position.
    /// Returns the new frame's timestamp if one exists.
    pub fn advance_frame(&mut self) -> Option<u64> {
        let current = self.session.current_position_ms;
        let next_ts = self.timestamps().into_iter().find(|&ts| ts > current);

        if let Some(ts) = next_ts {
            self.session.current_position_ms = ts;
            self.stats.frames_rendered += 1;
            if ts >= self.session.total_duration_ms {
                self.session.state = PlaybackState::Finished;
            }
            Some(ts)
        } else {
            self.session.state = PlaybackState::Finished;
            None
        }
    }

    pub fn get_stats(&self) -> PlaybackStats {
        self.stats.clone()
    }

    // ── Internal helpers ──────────────────────────────────────────────

    /// Collect all timestamps from whatever frame data is loaded.
    pub fn timestamps(&self) -> Vec<u64> {
        match &self.frames {
            FrameData::Terminal(frames) => frames.iter().map(|f| f.timestamp_ms).collect(),
            FrameData::Video(frames) => frames.iter().map(|f| f.timestamp_ms).collect(),
            FrameData::Har(entries) => entries.iter().map(|e| e.timestamp_ms).collect(),
        }
    }

    fn find_next_event_position(&self, after_ms: u64) -> Option<u64> {
        self.timestamps().into_iter().find(|&ts| ts > after_ms)
    }

    fn find_prev_event_position(&self, before_ms: u64) -> Option<u64> {
        self.timestamps()
            .into_iter()
            .rev()
            .find(|&ts| ts < before_ms)
    }
}
