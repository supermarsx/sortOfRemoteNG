// sorng-replay – Types
//
// All domain types for the session replay engine.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
//  Recording / session types
// ═══════════════════════════════════════════════════════════════════════

/// The kind of recording being replayed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingType {
    SshTerminal,
    RdpVideo,
    VncVideo,
    HttpHar,
    TelnetTerminal,
    SerialTerminal,
    DatabaseQuery,
}

/// Current state of the replay player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackState {
    Stopped,
    Playing,
    Paused,
    Seeking,
    Buffering,
    Finished,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self::Stopped
    }
}

/// Top-level session descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplaySession {
    pub id: String,
    pub recording_id: String,
    pub recording_type: RecordingType,
    pub total_duration_ms: u64,
    pub total_frames: usize,
    pub current_position_ms: u64,
    pub playback_speed: f64,
    pub state: PlaybackState,
    pub annotations: Vec<Annotation>,
    pub bookmarks: Vec<Bookmark>,
    pub created_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Timeline types
// ═══════════════════════════════════════════════════════════════════════

/// One segment of the visual timeline bar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub label: Option<String>,
    pub event_count: usize,
    pub has_activity: bool,
}

/// A point-marker on the timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineMarker {
    pub position_ms: u64,
    pub marker_type: MarkerType,
    pub label: String,
    pub color: Option<String>,
}

/// Kinds of timeline markers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkerType {
    Event,
    Error,
    UserInput,
    Output,
    Bookmark,
    Annotation,
    CommandExecution,
    NetworkRequest,
}

// ═══════════════════════════════════════════════════════════════════════
//  Annotations & bookmarks
// ═══════════════════════════════════════════════════════════════════════

/// A user/system annotation placed at a particular position.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub position_ms: u64,
    pub text: String,
    pub author: Option<String>,
    pub created_at: DateTime<Utc>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

/// A named bookmark on the timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub position_ms: u64,
    pub label: String,
    pub created_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Terminal frames (SSH, Telnet, Serial)
// ═══════════════════════════════════════════════════════════════════════

/// A single terminal event captured during recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalFrame {
    pub timestamp_ms: u64,
    pub data: String,
    pub event_type: TerminalEventType,
}

/// Terminal event kind.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalEventType {
    Output,
    Input,
    Resize(u16, u16),
}

// ═══════════════════════════════════════════════════════════════════════
//  Video frames (RDP, VNC)
// ═══════════════════════════════════════════════════════════════════════

/// A single video capture frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFrame {
    pub timestamp_ms: u64,
    pub width: u32,
    pub height: u32,
    pub data_base64: String,
    pub format: VideoFrameFormat,
}

/// Encoding format of a video frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoFrameFormat {
    Rgba,
    Jpeg,
    Png,
    WebP,
}

// ═══════════════════════════════════════════════════════════════════════
//  HAR entries (HTTP)
// ═══════════════════════════════════════════════════════════════════════

/// A single HTTP request/response captured in HAR-style.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarEntry {
    pub timestamp_ms: u64,
    pub method: String,
    pub url: String,
    pub status: u16,
    pub duration_ms: u64,
    pub request_size: u64,
    pub response_size: u64,
    pub content_type: Option<String>,
    pub headers: Vec<(String, String)>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Search
// ═══════════════════════════════════════════════════════════════════════

/// A single search hit inside a recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub position_ms: u64,
    pub context: String,
    pub match_text: String,
    pub line_number: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════

/// User-facing replay configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayConfig {
    pub default_speed: f64,
    pub auto_play: bool,
    pub loop_playback: bool,
    pub show_timestamps: bool,
    pub terminal_font_size: u16,
    pub max_cached_frames: usize,
}

impl Default for ReplayConfig {
    fn default() -> Self {
        Self {
            default_speed: 1.0,
            auto_play: false,
            loop_playback: false,
            show_timestamps: true,
            terminal_font_size: 14,
            max_cached_frames: 5000,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Seek target
// ═══════════════════════════════════════════════════════════════════════

/// Where to seek to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SeekTarget {
    Absolute(u64),
    Relative(i64),
    NextEvent,
    PreviousEvent,
    NextBookmark,
    PreviousBookmark,
    Percentage(f64),
}

// ═══════════════════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════════════════

/// Export options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub include_annotations: bool,
}

/// Supported export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Json,
    Asciicast,
    Text,
    Gif,
    WebM,
    Srt,
}

// ═══════════════════════════════════════════════════════════════════════
//  Playback stats
// ═══════════════════════════════════════════════════════════════════════

/// Runtime counters for the replay player.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlaybackStats {
    pub frames_rendered: u64,
    pub seek_count: u64,
    pub total_play_time_ms: u64,
    pub buffer_misses: u64,
}

// ═══════════════════════════════════════════════════════════════════════
//  HAR replay helpers
// ═══════════════════════════════════════════════════════════════════════

/// Visual bar for the waterfall diagram.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterfallBar {
    pub entry_index: usize,
    pub start_pct: f64,
    pub width_pct: f64,
    pub color: String,
}

/// Summary statistics for a HAR recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarStats {
    pub total_requests: usize,
    pub total_size: u64,
    pub avg_duration_ms: f64,
    pub by_status: HashMap<u16, usize>,
    pub by_content_type: HashMap<String, usize>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Frame data enum (player uses this to hold whatever type was loaded)
// ═══════════════════════════════════════════════════════════════════════

/// Tagged union of frame data that the player can hold.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameData {
    Terminal(Vec<TerminalFrame>),
    Video(Vec<VideoFrame>),
    Har(Vec<HarEntry>),
}
