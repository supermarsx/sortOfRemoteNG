// sorng-recording – crate root
//
// Re-exports everything the app crate needs.

pub mod compression;
pub mod encoders;
pub mod engine;
pub mod error;
pub mod service;
pub mod storage;
pub mod types;

// Convenience re-exports
pub use engine::{RecordingEngine, RecordingEngineState};
pub use service::{RecordingService, RecordingServiceState};
