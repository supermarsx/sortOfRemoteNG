use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tokio::sync::RwLock;

use crate::engine::ClipEngine;
use crate::history::ClipHistory;
use crate::types::*;

/// Guard object for the background auto-clear watcher.
pub struct AutoClearTask {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for AutoClearTask {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// Spawns a background watcher that periodically checks for auto-clear expiration.
///
/// This runs on a dedicated OS thread so the service can be initialized during
/// Tauri setup before Tokio's async runtime is fully available.
pub fn spawn_auto_clear_task(
    engine: Arc<RwLock<ClipEngine>>,
    history: Arc<RwLock<ClipHistory>>,
) -> AutoClearTask {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let handle = thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));

            let cleared = {
                let mut eng = engine.blocking_write();
                eng.tick_auto_clear()
            };

            if let Some(entry) = cleared {
                let mut hist = history.blocking_write();
                hist.record_clear(&entry, ClearReason::AutoClear);
            }
        }
    });

    AutoClearTask {
        stop,
        handle: Some(handle),
    }
}
