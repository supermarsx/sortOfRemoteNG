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

/// How often the watcher looks for an expired entry.
const TICK_INTERVAL: Duration = Duration::from_secs(1);

/// A clear whose ownership check cannot be made is retried on every tick, but
/// reported only when the trouble starts and then once in this many ticks.
const PENDING_CLEAR_REPORT_EVERY: u32 = 60;

/// Guard object for the background auto-clear watcher.
pub struct AutoClearTask {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for AutoClearTask {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            // Wake the watcher instead of waiting out its tick.
            handle.thread().unpark();
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
    spawn_with_interval(engine, history, TICK_INTERVAL)
}

pub(crate) fn spawn_with_interval(
    engine: Arc<RwLock<ClipEngine>>,
    history: Arc<RwLock<ClipHistory>>,
    interval: Duration,
) -> AutoClearTask {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let handle = thread::spawn(move || {
        let mut pending = PendingClear::default();
        loop {
            // An early wake-up only makes one tick come sooner.
            thread::park_timeout(interval);
            if thread_stop.load(Ordering::Relaxed) {
                break;
            }
            tick(&engine, &history, &mut pending);
        }
    });

    AutoClearTask {
        stop,
        handle: Some(handle),
    }
}

/// One look at the engine: retire the entry if its time is up.
///
/// An entry whose clipboard content was replaced by the user or another
/// program is retired without a write and is never looked at again. Only a
/// clipboard that cannot be examined at all leaves the entry for the next tick.
fn tick(engine: &RwLock<ClipEngine>, history: &RwLock<ClipHistory>, pending: &mut PendingClear) {
    let retired = engine.blocking_write().tick_auto_clear();
    match retired {
        Ok(retired) => {
            pending.settle();
            if let Some(entry) = retired {
                history
                    .blocking_write()
                    .record_clear(&entry, ClearReason::AutoClear);
            }
        }
        Err(error) => {
            if pending.should_report() {
                log::warn!("Secure clipboard auto-clear is pending ({error}); retrying every tick");
            }
        }
    }
}

/// Consecutive ticks on which an expired entry could not be cleared.
#[derive(Default)]
struct PendingClear {
    failed_ticks: u32,
}

impl PendingClear {
    fn settle(&mut self) {
        self.failed_ticks = 0;
    }

    /// True for the first failed tick of a run and then for every
    /// [`PENDING_CLEAR_REPORT_EVERY`]th.
    fn should_report(&mut self) -> bool {
        let report = self.failed_ticks.is_multiple_of(PENDING_CLEAR_REPORT_EVERY);
        self.failed_ticks = self.failed_ticks.wrapping_add(1);
        report
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fake::FakeClipboard;
    use std::cell::Cell;
    use std::time::Instant;

    thread_local! {
        static WARNINGS: Cell<usize> = const { Cell::new(0) };
    }

    /// Counts warnings per thread, so that a test sees only what it caused.
    struct WarningCounter;

    impl log::Log for WarningCounter {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata.level() <= log::Level::Warn
        }

        fn log(&self, record: &log::Record<'_>) {
            if self.enabled(record.metadata()) {
                WARNINGS.with(|warnings| warnings.set(warnings.get() + 1));
            }
        }

        fn flush(&self) {}
    }

    /// Warnings logged on this thread since the last call.
    fn take_warnings() -> usize {
        static COUNTER: WarningCounter = WarningCounter;
        // Whichever test asks first installs the counter for the process.
        let _ = log::set_logger(&COUNTER);
        log::set_max_level(log::LevelFilter::Info);
        WARNINGS.with(|warnings| warnings.replace(0))
    }

    struct Watched {
        clipboard: FakeClipboard,
        engine: Arc<RwLock<ClipEngine>>,
        history: Arc<RwLock<ClipHistory>>,
    }

    /// An engine whose only entry (`fake-secret`) is already due for clearing.
    fn expired_entry() -> Watched {
        let clipboard = FakeClipboard::default();
        let mut engine = clipboard.engine();
        let request = CopyRequest {
            value: "fake-secret".to_string(),
            kind: SecretKind::Password,
            label: None,
            connection_id: None,
            field: None,
            clear_after_secs: None,
            max_pastes: None,
            one_time: false,
        };
        let (entry, _) = engine
            .copy(&request, &SecureClipConfig::default())
            .expect("copy");
        engine.expire_current();
        let mut history = ClipHistory::new(8);
        history.record_copy(&entry);

        Watched {
            clipboard,
            engine: Arc::new(RwLock::new(engine)),
            history: Arc::new(RwLock::new(history)),
        }
    }

    impl Watched {
        fn has_entry(&self) -> bool {
            self.engine.blocking_read().current_entry().is_some()
        }

        fn clear_reason(&self) -> Option<ClearReason> {
            self.history.blocking_read().list()[0].clear_reason
        }
    }

    #[test]
    fn an_expired_entry_is_dropped_once_when_the_clipboard_holds_no_text() {
        let watched = expired_entry();
        watched.clipboard.user_copies_an_image();
        let changes = watched.clipboard.changes().len();
        let sessions = watched.clipboard.sessions();
        let mut pending = PendingClear::default();
        take_warnings();

        for _ in 0..5 {
            tick(&watched.engine, &watched.history, &mut pending);
        }

        assert_eq!(take_warnings(), 0, "no warning, let alone one per tick");
        assert!(!watched.has_entry());
        assert_eq!(watched.clear_reason(), Some(ClearReason::AutoClear));
        assert!(watched.clipboard.holds_an_image());
        assert_eq!(watched.clipboard.changes().len(), changes);
        assert_eq!(
            watched.clipboard.sessions(),
            sessions + 1,
            "the first tick settles it; later ticks have nothing to retry"
        );
    }

    #[test]
    fn a_clipboard_that_cannot_be_examined_is_retried_without_a_warning_per_tick() {
        let watched = expired_entry();
        watched.clipboard.hold_by_another_program(true);
        let mut pending = PendingClear::default();
        take_warnings();

        let ticks = PENDING_CLEAR_REPORT_EVERY * 2 + 1;
        for _ in 0..ticks {
            tick(&watched.engine, &watched.history, &mut pending);
        }

        assert_eq!(pending.failed_ticks, ticks, "every tick retried");
        assert_eq!(
            take_warnings(),
            3,
            "the first failed tick, then one in sixty"
        );
        assert!(watched.has_entry(), "the secret may still be there");
        assert_eq!(watched.clear_reason(), None);
        assert_eq!(watched.clipboard.text().as_deref(), Some("fake-secret"));

        watched.clipboard.hold_by_another_program(false);
        tick(&watched.engine, &watched.history, &mut pending);
        assert!(!watched.has_entry());
        assert!(watched.clipboard.is_empty());
        assert_eq!(watched.clear_reason(), Some(ClearReason::AutoClear));
        assert_eq!(pending.failed_ticks, 0);
        assert_eq!(take_warnings(), 0);
    }

    #[test]
    fn pending_clears_are_reported_at_the_start_and_then_sparsely() {
        let mut pending = PendingClear::default();
        let reported: Vec<u32> = (0..=PENDING_CLEAR_REPORT_EVERY * 2)
            .filter(|_| pending.should_report())
            .collect();
        assert_eq!(
            reported,
            [
                0,
                PENDING_CLEAR_REPORT_EVERY,
                PENDING_CLEAR_REPORT_EVERY * 2
            ]
        );

        pending.settle();
        assert!(pending.should_report(), "a new run is reported again");
    }

    #[test]
    fn the_watcher_clears_an_owned_entry_and_stops_promptly() {
        let watched = expired_entry();
        let task = spawn_with_interval(
            watched.engine.clone(),
            watched.history.clone(),
            Duration::from_millis(5),
        );

        let deadline = Instant::now() + Duration::from_secs(5);
        while watched.has_entry() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!watched.has_entry());
        assert!(watched.clipboard.is_empty());
        drop(task);

        // Dropping must not wait out a long tick.
        let slow = spawn_with_interval(
            watched.engine.clone(),
            watched.history.clone(),
            Duration::from_secs(60),
        );
        let started = Instant::now();
        drop(slow);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
