// sorng-replay – crate root
//
// Session replay engine: timeline scrubbing, multi-protocol playback,
// searchable transcripts, bookmarks/annotations, speed control,
// frame-accurate seeking, and export.

pub mod annotations;
pub mod error;
pub mod export;
pub mod har_replay;
pub mod player;
pub mod search;
pub mod service;
pub mod terminal_replay;
pub mod timeline;
pub mod types;
pub mod video_replay;

// Convenience re-exports
pub use service::{ReplayService, ReplayServiceState};
