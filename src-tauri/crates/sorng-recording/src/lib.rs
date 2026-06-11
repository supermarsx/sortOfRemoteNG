// sorng-recording – crate root
//
// Re-exports everything the app crate needs.

// ── Vendor dylib re-exports ──────────────────────────────────────────────
pub(crate) use sorng_compression_vendor::flate2;
pub(crate) use sorng_compression_vendor::zstd;

pub mod compression;
pub mod encoders;
pub mod engine;
pub mod error;
pub mod redact;
pub mod service;
pub mod storage;
pub mod types;

pub use redact::{redact_secrets, redact_stream};

// Convenience re-exports
pub use engine::{RecordingEngine, RecordingEngineState};
pub use service::{RecordingService, RecordingServiceState};
