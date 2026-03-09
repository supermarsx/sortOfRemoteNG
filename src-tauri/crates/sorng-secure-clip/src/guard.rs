use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

use crate::engine::ClipEngine;
use crate::history::ClipHistory;
use crate::types::*;

/// Spawns a background task that periodically checks for auto-clear expiration.
/// Returns the `JoinHandle` so the caller can abort it on shutdown.
pub fn spawn_auto_clear_task(
    engine: Arc<RwLock<ClipEngine>>,
    history: Arc<RwLock<ClipHistory>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(1));
        loop {
            tick.tick().await;
            let cleared = {
                let mut eng = engine.write().await;
                eng.tick_auto_clear()
            };
            if let Some(entry) = cleared {
                let mut hist: tokio::sync::RwLockWriteGuard<'_, ClipHistory> =
                    history.write().await;
                hist.record_clear(&entry, ClearReason::AutoClear);
            }
        }
    })
}
