//! Bridges the framework-agnostic [`AppEventEmitter`] trait to Tauri's
//! `AppHandle::emit()`.

use sorng_core::events::{AppEventEmitter, DynEventEmitter};
use std::sync::Arc;

/// Wraps a `tauri::AppHandle` and implements [`AppEventEmitter`].
struct TauriEventEmitter(tauri::AppHandle);

impl AppEventEmitter for TauriEventEmitter {
    fn emit_event(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        use tauri::Emitter;
        self.0.emit(event, payload).map_err(|e| e.to_string())
    }
}

/// Create a [`DynEventEmitter`] backed by the given Tauri app handle.
pub fn from_app_handle(handle: &tauri::AppHandle) -> DynEventEmitter {
    Arc::new(TauriEventEmitter(handle.clone()))
}
