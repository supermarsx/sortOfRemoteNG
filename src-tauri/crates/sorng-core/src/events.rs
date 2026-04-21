//! Framework-agnostic event emitter abstraction.
//!
//! Service crates use [`AppEventEmitter`] to send events to the frontend
//! without depending on Tauri directly. The app layer provides a concrete
//! implementation that bridges to `tauri::AppHandle::emit()`.

use std::sync::Arc;

/// Trait for emitting named events with serialized payloads to the frontend.
///
/// Implementations must be `Send + Sync + 'static` so they can be shared
/// across async tasks and thread boundaries.
pub trait AppEventEmitter: Send + Sync + 'static {
    /// Emit a named event with a JSON-serializable payload.
    fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String>;
}

/// Type alias for a shared, boxed event emitter.
pub type DynEventEmitter = Arc<dyn AppEventEmitter>;

/// A no-op emitter that silently discards all events.
///
/// Useful for testing or when event emission is not needed.
pub struct NoopEventEmitter;

impl AppEventEmitter for NoopEventEmitter {
    fn emit_event(&self, _event: &str, _payload: serde_json::Value) -> Result<(), String> {
        Ok(())
    }
}
