// sorng-recording – crate root
//
// Re-exports everything the app crate needs.

pub mod types;
pub mod error;
pub mod engine;
pub mod encoders;
pub mod compression;
pub mod storage;
pub mod service;
pub mod commands;

// Convenience re-exports
pub use service::{RecordingService, RecordingServiceState};
pub use engine::{RecordingEngine, RecordingEngineState};
