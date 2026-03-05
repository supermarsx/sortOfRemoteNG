// sorng-replay – crate root
//
// Session replay engine: timeline scrubbing, multi-protocol playback,
// searchable transcripts, bookmarks/annotations, speed control,
// frame-accurate seeking, and export.

pub mod types;
pub mod error;
pub mod player;
pub mod timeline;
pub mod terminal_replay;
pub mod video_replay;
pub mod har_replay;
pub mod search;
pub mod annotations;
pub mod export;
pub mod service;
pub mod commands;

// Convenience re-exports
pub use service::{ReplayService, ReplayServiceState};
