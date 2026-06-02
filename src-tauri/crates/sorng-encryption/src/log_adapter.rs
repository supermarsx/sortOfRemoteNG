//! `log::Log` adapter that funnels every `log!` call through the
//! encrypted log sink — the Commit H glue between the global logger
//! and [`crate::log_sink::EncryptedLogSink`].
//!
//! ## The sync/async impedance mismatch
//!
//! `log::Log::log(record)` is called *synchronously* from whichever
//! thread emitted the log. The sink's `flush()` is `async` and grabs
//! a tokio mutex on the encryption state — calling it from the log
//! callback would deadlock anywhere a tokio runtime mutex is already
//! held, and would block the caller for the duration of the file
//! write.
//!
//! We solve it the usual way: `log()` formats the record into a
//! `String` and shoves it down an `unbounded_channel`; a single
//! background task drains the channel, calls `sink.submit()`, and
//! awaits `sink.flush()` when either the sink signals threshold or a
//! 2-second timer fires. The format step is the only work done on
//! the log thread.
//!
//! ## Locked-state behaviour
//!
//! At boot, the encryption state is locked (the user hasn't typed
//! their password yet). The sink already handles this — buffered
//! lines accumulate and the flush returns 0 without dropping them.
//! The adapter doesn't need to special-case unlock: as soon as the
//! state flips to unlocked, the next periodic flush drains the
//! whole accumulated buffer in one envelope.
//!
//! ## Why drop on send failure
//!
//! If the receiver task is gone, the process is shutting down (the
//! drain task lives for the lifetime of `tauri::async_runtime`). A
//! panic in the log path would mask the real shutdown cause; silent
//! drop is the documented behaviour for `log::Log` impls in that
//! state.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{LevelFilter, Log, Metadata, Record};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::log_sink::EncryptedLogSink;
use crate::state::EncryptionState;

/// How often the background task flushes the sink regardless of
/// the threshold signal. Matches the granularity at which an active
/// user expects log lines to land on disk after a crash.
const PERIODIC_FLUSH: Duration = Duration::from_secs(2);

/// `log::Log` implementation that hands every record off to the
/// encrypted log sink via an async channel. Cheap to install once
/// per process at boot; never re-installed.
pub struct EncryptedLogAdapter {
    tx: UnboundedSender<String>,
    level: LevelFilter,
}

impl EncryptedLogAdapter {
    /// Build the adapter, spawn the drain task, register as the
    /// global logger, and set the max level. Call once per process,
    /// after the `EncryptionState` is created (it doesn't have to be
    /// unlocked — the sink buffers until unlock).
    pub fn install(
        state: Arc<EncryptionState>,
        dir: PathBuf,
        level: LevelFilter,
    ) -> Result<(), InstallError> {
        let sink = EncryptedLogSink::new(state, dir, true);
        let (adapter, rx) = Self::new(level);
        Self::spawn_drainer(sink, rx);
        log::set_boxed_logger(Box::new(adapter))
            .map_err(|e| InstallError::SetLogger(e.to_string()))?;
        log::set_max_level(level);
        Ok(())
    }

    /// Build adapter + receiver without spawning a drainer or
    /// registering as the global logger. Tests use this to drive the
    /// channel deterministically; production goes through `install`.
    fn new(level: LevelFilter) -> (Self, UnboundedReceiver<String>) {
        let (tx, rx) = unbounded_channel();
        (Self { tx, level }, rx)
    }

    /// Spawn the single drain task that owns the sink. One task →
    /// no cross-task contention on the buffer mutex.
    fn spawn_drainer(sink: EncryptedLogSink, mut rx: UnboundedReceiver<String>) {
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(PERIODIC_FLUSH);
            // Skip the immediate first tick; we'd rather not flush
            // an empty buffer the instant the app starts.
            interval.tick().await;
            loop {
                tokio::select! {
                    maybe_line = rx.recv() => {
                        match maybe_line {
                            Some(line) => {
                                let crossed = sink.submit(&line);
                                if crossed {
                                    // Threshold-driven flush. Failure here is
                                    // surfaced via eprintln rather than panic —
                                    // logging itself failing must not crash the
                                    // app.
                                    if let Err(e) = sink.flush().await {
                                        eprintln!("encrypted log flush failed: {}", e);
                                    }
                                }
                            }
                            // Sender dropped → app is shutting down; drain task exits.
                            None => break,
                        }
                    }
                    _ = interval.tick() => {
                        if let Err(e) = sink.flush().await {
                            eprintln!("encrypted log flush failed: {}", e);
                        }
                    }
                }
            }
        });
    }
}

impl Log for EncryptedLogAdapter {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        // Re-check the level here: the `log!` macros short-circuit
        // on `max_level`, but direct `Log::log` callers and some
        // filter chains don't, and we'd rather not encrypt records
        // the operator silenced.
        if record.level() > self.level {
            return;
        }
        let line = format_record(record);
        // Drop silently on send failure — the only way this fails
        // is if the drainer task has been torn down, which only
        // happens during shutdown.
        let _ = self.tx.send(line);
    }

    fn flush(&self) {
        // The drainer task runs the actual flush; there's no
        // synchronous handle to await from here. `log::logger().flush()`
        // is best-effort by the trait's own docs.
    }
}

/// Format a record as `[YYYY-MM-DDTHH:MM:SSZ][LEVEL][target] message`.
/// Mirrors `tauri_plugin_log`'s default-ish line shape so existing
/// log-reading muscle memory still works after the switch.
fn format_record(record: &Record) -> String {
    let ts = now_iso_8601();
    format!(
        "[{}][{}][{}] {}",
        ts,
        record.level(),
        record.target(),
        record.args()
    )
}

fn now_iso_8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, da, h, mi, s) = secs_to_civil(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, da, h, mi, s
    )
}

/// Mirror of `audit::secs_to_civil` — kept private here so this
/// module doesn't reach across files for a single formatter.
fn secs_to_civil(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let time = secs % 86_400;
    let h = (time / 3600) as u32;
    let mi = ((time / 60) % 60) as u32;
    let s = (time % 60) as u32;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y_civil = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y_civil + 1 } else { y_civil };
    (y as i32, m as u32, d as u32, h, mi, s)
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("log::set_boxed_logger failed: {0}")]
    SetLogger(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;
    use crate::log_sink::EncryptedLogSink;
    use std::sync::Arc;
    use tempfile::tempdir;

    async fn unlocked_state(seed: u8) -> Arc<EncryptionState> {
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&[seed; 32]).unwrap()).await;
        Arc::new(s)
    }

    /// Build (adapter, sink, receiver) without spawning the drainer
    /// task. Tests then drive the channel manually so there's no
    /// timing race with `tokio::time::interval`.
    fn build_for_test(
        state: Arc<EncryptionState>,
        dir: PathBuf,
        level: LevelFilter,
    ) -> (EncryptedLogAdapter, EncryptedLogSink, UnboundedReceiver<String>) {
        let sink = EncryptedLogSink::new(state, dir, false);
        let (adapter, rx) = EncryptedLogAdapter::new(level);
        (adapter, sink, rx)
    }

    /// Manually pump everything currently in the channel through the
    /// sink. Mirrors the drainer's submit step without the flush /
    /// interval logic.
    fn drain_into(sink: &EncryptedLogSink, rx: &mut UnboundedReceiver<String>) -> usize {
        let mut n = 0;
        while let Ok(line) = rx.try_recv() {
            sink.submit(&line);
            n += 1;
        }
        n
    }

    /// Build, log, and discard a Record in-place — `Record` borrows
    /// from a `format_args!` whose lifetime is the call expression,
    /// so we can't factor the construction into a function.
    macro_rules! log_at {
        ($adapter:expr, $level:expr, $msg:expr) => {
            $adapter.log(
                &Record::builder()
                    .args(format_args!("{}", $msg))
                    .level($level)
                    .target("test")
                    .build(),
            )
        };
    }

    #[tokio::test]
    async fn multiple_records_produce_file_on_flush() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state(7).await;
        let (adapter, sink, mut rx) =
            build_for_test(state, tmp.path().to_path_buf(), LevelFilter::Info);
        for i in 0..5 {
            log_at!(adapter, log::Level::Info, format!("line {}", i));
        }
        let drained = drain_into(&sink, &mut rx);
        assert_eq!(drained, 5);
        let n = sink.flush().await.unwrap();
        assert!(n > 0);
        let entries: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].ends_with(".log.enc"));
    }

    #[tokio::test]
    async fn concurrent_log_does_not_lose_records() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state(13).await;
        let (adapter, sink, mut rx) =
            build_for_test(state.clone(), tmp.path().to_path_buf(), LevelFilter::Trace);
        let adapter = Arc::new(adapter);

        // 8 threads × 100 records each. The channel is the only
        // shared state; if our adapter ever lost a record the count
        // would come up short.
        let mut handles = Vec::new();
        for t in 0..8u32 {
            let a = adapter.clone();
            handles.push(std::thread::spawn(move || {
                for i in 0..100u32 {
                    log_at!(
                        a,
                        log::Level::Info,
                        format!("thread {} line {}", t, i)
                    );
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let drained = drain_into(&sink, &mut rx);
        assert_eq!(drained, 800);
        sink.flush().await.unwrap();

        // Decrypt and count lines.
        let path = std::fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .next()
            .unwrap()
            .path();
        let bytes = std::fs::read(&path).unwrap();
        let plain = crate::artifacts::logs::read(&state, &bytes).await.unwrap();
        let text = String::from_utf8(plain).unwrap();
        let count = text.lines().filter(|l| l.contains("thread ")).count();
        assert_eq!(count, 800);
    }

    #[tokio::test]
    async fn lock_cycle_does_not_panic_and_post_unlock_flush_writes_file() {
        let tmp = tempdir().unwrap();
        let state = Arc::new(EncryptionState::new()); // locked
        let (adapter, sink, mut rx) =
            build_for_test(state.clone(), tmp.path().to_path_buf(), LevelFilter::Info);

        // First batch: state still locked.
        for i in 0..5 {
            log_at!(adapter, log::Level::Info, format!("pre {}", i));
        }
        drain_into(&sink, &mut rx);
        // Flush while locked is a no-op; sink preserves the buffer.
        assert_eq!(sink.flush().await.unwrap(), 0);

        // Second batch.
        for i in 0..5 {
            log_at!(adapter, log::Level::Info, format!("post {}", i));
        }
        drain_into(&sink, &mut rx);

        // Install a master and flush. We don't assert *which* lines
        // survived — the sink's own lock-cycle test covers that —
        // only that nothing panicked and an envelope file appears.
        state.install(MasterDek::from_bytes(&[42u8; 32]).unwrap()).await;
        let n = sink.flush().await.unwrap();
        assert!(n > 0);
        assert!(std::fs::read_dir(tmp.path()).unwrap().next().is_some());
    }

    #[tokio::test]
    async fn level_filter_is_respected() {
        let tmp = tempdir().unwrap();
        let state = unlocked_state(3).await;
        let (adapter, sink, mut rx) =
            build_for_test(state, tmp.path().to_path_buf(), LevelFilter::Warn);

        // Info < Warn → dropped at the adapter, never reaches the sink.
        log_at!(adapter, log::Level::Info, "info line");
        let drained_info = drain_into(&sink, &mut rx);
        assert_eq!(drained_info, 0);
        assert_eq!(sink.buffered_bytes(), 0);

        // Error >= Warn → makes it through.
        log_at!(adapter, log::Level::Error, "error line");
        let drained_err = drain_into(&sink, &mut rx);
        assert_eq!(drained_err, 1);
        assert!(sink.buffered_bytes() > 0);
    }
}
