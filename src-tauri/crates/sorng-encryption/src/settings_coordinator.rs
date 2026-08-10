//! Process-wide serialization for settings representation transitions.
//!
//! Ordinary application settings writes live in the app crate while
//! encryption enable/migrate/disable commands live here. Keeping the mutex in
//! this lowest shared dependency gives both call paths one transaction order.

use tokio::sync::{Mutex, MutexGuard};

static SETTINGS_COORDINATOR: Mutex<()> = Mutex::const_new(());

/// Acquire exclusive ownership of the canonical settings representation.
///
/// Callers must take this guard before reading either `settings.json` or
/// `settings.enc` when the read will feed a later write or representation
/// transition, and retain it through verification and old-file cleanup.
pub async fn lock() -> MutexGuard<'static, ()> {
    SETTINGS_COORDINATOR.lock().await
}
