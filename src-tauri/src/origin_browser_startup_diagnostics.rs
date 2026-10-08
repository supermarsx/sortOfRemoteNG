//! Best-effort startup breadcrumbs, never credentials or browser content.
//! A bounded worker performs all file and logging I/O, never the UI or timeout
//! caller. Queue overflow drops breadcrumbs; a native abort/process exit may
//! lose even an accepted final stage. Async last-stage evidence is best effort,
//! not a durability guarantee, diagnosis or containment.

use rand::RngCore;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc::SyncSender,
        Arc, OnceLock,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const MAX_RECORDS: usize = 32;
const MAX_TIMED_STARTUPS: u32 = 32;
const TIMING_SLOTS: usize = 31;
const MAX_TIMING_RECORDS: usize = MAX_TIMED_STARTUPS as usize * (TIMING_SLOTS + 1);
const UNREACHED: u64 = u64::MAX;

/// Numeric schema v1: array offsets and stage codes are stable. Values are
/// cumulative microseconds from native command entry; subtract two reached
/// endpoints to measure a phase. Missing is identified by `reached`, not zero.
/// Prewarm sampling begins only after its once-per-process admission gate.
/// This does not measure frontend IPC transit, paint, login, or page success.
#[repr(usize)]
#[derive(Clone, Copy)]
pub(crate) enum TimingStage {
    CommandEntered = 0,
    CommandValidated = 1,
    Authorized = 2,
    RuntimeRequested = 3,
    PreflightEntered = 4,
    DataPrepared = 5,
    EngineUiQueued = 6,
    EngineUiEntered = 7,
    NativeInitializeEntered = 8,
    NativeInitializeReturned = 9,
    RuntimeInstalled = 10,
    RuntimeReady = 11,
    InitialOwnerChecked = 12,
    RetentionPrepared = 13,
    CookiesLoaded = 14,
    LoginPrepared = 15,
    OwnerCheckedBeforeProxy = 16,
    ProxyReady = 17,
    OwnerCheckedBeforeContext = 18,
    ViewUiQueued = 19,
    UiEntered = 20,
    ContextCreated = 21,
    ContextReady = 22,
    BrowserAttached = 23,
    RendererReady = 24,
    FinalOwnerChecked = 25,
    InitialNavigationQueued = 26,
    InitialNavigationEntered = 27,
    NavigationSubmitted = 28,
    CommandCompleted = 29,
    FirstDocumentComplete = 30,
}

/// All payload values are numeric. `sample` is a bounded process-local ordinal,
/// unrelated to any owner/request/browser ID (the journal filename is random).
/// kind: 1=create, 2=prewarm; outcome: 255=progress, 0=failed/cancelled,
/// 1=prewarm complete, 2=first document complete. stage=31 denotes completion.
#[derive(Clone, Debug, serde::Serialize)]
struct TimingSnapshot {
    timing_version: u8,
    sample: u32,
    kind: u8,
    stage: u8,
    outcome: u8,
    total_us: u64,
    reached: u32,
    elapsed_us: [u64; TIMING_SLOTS],
}

struct ActiveTiming {
    start: Instant,
    sample: u32,
    kind: u8,
    marks: [AtomicU64; TIMING_SLOTS],
    finished: AtomicBool,
    sender: SyncSender<Message>,
}

#[derive(Clone, Default)]
pub(crate) struct Trace(Option<Arc<ActiveTiming>>);

impl Trace {
    fn sampled(count: &AtomicU32, kind: u8, sender: &SyncSender<Message>) -> Self {
        let Ok(sample) = count.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
            (n < MAX_TIMED_STARTUPS).then(|| n + 1)
        }) else {
            return Self::default();
        };
        let trace = Self(Some(Arc::new(ActiveTiming {
            start: Instant::now(),
            sample: sample + 1,
            kind,
            marks: std::array::from_fn(|_| AtomicU64::new(UNREACHED)),
            finished: AtomicBool::new(false),
            sender: sender.clone(),
        })));
        trace.mark(TimingStage::CommandEntered);
        trace
    }

    pub(crate) fn startup(prewarm: bool) -> Self {
        static COUNT: AtomicU32 = AtomicU32::new(0);
        dispatcher().map_or_else(Self::default, |sender| {
            Self::sampled(&COUNT, if prewarm { 2 } else { 1 }, sender)
        })
    }

    pub(crate) fn mark(&self, stage: TimingStage) {
        if let Some(active) = &self.0 {
            active.mark(stage, active.micros());
            if matches!(stage, TimingStage::CommandCompleted) {
                active.finish(2);
            }
        }
    }

    pub(crate) fn finish(&self, outcome: u8) {
        if let Some(active) = &self.0 {
            active.finish(outcome);
        }
    }
}

impl ActiveTiming {
    fn micros(&self) -> u64 {
        self.start
            .elapsed()
            .as_micros()
            .min(u128::from(UNREACHED - 1)) as u64
    }

    fn mark(&self, stage: TimingStage, elapsed: u64) {
        if self.finished.load(Ordering::Acquire)
            || self.marks[stage as usize]
                .compare_exchange(UNREACHED, elapsed, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return;
        }
        // First observations only. Repeated ticks, loads and callbacks cannot
        // overwrite a milestone or generate an unbounded stream. No UI mutex,
        // logging, filesystem work, or waiting for the consumer here.
        self.send(stage as u8, 255);
    }

    fn send(&self, stage: u8, outcome: u8) {
        let mut reached = 0;
        let elapsed_us = std::array::from_fn(|index| {
            let value = self.marks[index].load(Ordering::Acquire);
            if value == UNREACHED {
                0
            } else {
                reached |= 1 << index;
                value
            }
        });
        let total_us = self.micros().max(*elapsed_us.iter().max().unwrap_or(&0));
        // Concurrent callers can enqueue out of order. Each record carries the
        // full observed snapshot so a later milestone recovers dropped earlier
        // progress, and analysis uses monotonic offsets instead of queue order.
        let _ = delivery::enqueue(
            &self.sender,
            Message::Timing(Box::new(TimingSnapshot {
                timing_version: 1,
                sample: self.sample,
                kind: self.kind,
                stage,
                outcome,
                total_us,
                reached,
                elapsed_us,
            })),
        );
    }

    fn finish(&self, outcome: u8) {
        // A very fast document callback may precede the command response. Keep
        // both endpoints, without changing command or document behavior.
        if outcome == 2
            && [
                TimingStage::CommandCompleted,
                TimingStage::FirstDocumentComplete,
            ]
            .iter()
            .any(|stage| self.marks[*stage as usize].load(Ordering::Acquire) == UNREACHED)
        {
            return;
        }
        if !self.finished.swap(true, Ordering::AcqRel) {
            self.send(TIMING_SLOTS as u8, outcome);
        }
    }
}

impl Drop for ActiveTiming {
    fn drop(&mut self) {
        self.finish(0);
    }
}

// BEGIN std-only diagnostic delivery
mod delivery {
    use std::{
        io,
        sync::mpsc::{self, SyncSender},
        thread,
    };

    pub(super) fn start_worker<T: Send + 'static>(
        capacity: usize,
        mut consume: impl FnMut(T) + Send + 'static,
    ) -> io::Result<SyncSender<T>> {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        // Detached deliberately: shutdown must not wait on a stalled file write.
        thread::Builder::new()
            .name("browser-diagnostics".into())
            .spawn(move || {
                for message in receiver {
                    consume(message);
                }
            })?;
        Ok(sender)
    }

    pub(super) fn enqueue<T>(sender: &SyncSender<T>, message: T) -> bool {
        sender.try_send(message).is_ok()
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::time::Duration;

        #[test]
        fn stalled_writer_does_not_block_callers_and_queue_is_bounded() {
            let (started_tx, started_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let (written_tx, written_rx) = mpsc::channel();
            let sender = start_worker(2, move |message: u8| {
                if message == 0 {
                    started_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                written_tx.send(message).unwrap();
            })
            .unwrap();
            assert!(enqueue(&sender, 0));
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let (returned_tx, returned_rx) = mpsc::channel();
            let caller = sender.clone();
            thread::spawn(move || {
                let accepted = [
                    enqueue(&caller, 1),
                    enqueue(&caller, 2),
                    enqueue(&caller, 3),
                ];
                for _ in 0..10_000 {
                    assert!(!enqueue(&caller, 4));
                }
                let _ = returned_tx.send(accepted);
            });
            let returned = returned_rx.recv_timeout(Duration::from_secs(2));
            release_tx.send(()).unwrap();
            assert_eq!(returned.unwrap(), [true, true, false]);
            drop(sender);
            assert_eq!(written_rx.iter().collect::<Vec<_>>(), vec![0, 1, 2]);
        }

        #[test]
        fn disconnected_writer_drops_records_without_waiting() {
            let (sender, receiver) = mpsc::sync_channel(1);
            drop(receiver);
            assert!(!enqueue(&sender, ()));
        }
    }
}
// END std-only diagnostic delivery

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Stage {
    Preparing,
    Initializing,
    Ready,
    Failed,
    ViewFailed,
    Closing,
    Closed,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Failure {
    DataDirectory,
    Package,
    Initialization,
    Policy,
    Timeout,
    Shutdown,
    PrivateProxy,
    PrivateContext,
    CookieRestore,
    NativeSurface,
    RendererSetup,
    InitialZoom,
    InitialNavigation,
}

struct Journal {
    file: File,
    records: usize,
    navigation_records: usize,
    timing_records: usize,
}

/// Fixed, secret-free observations from the native browser callbacks. Separate
/// budget so a noisy page cannot consume the lifecycle failure breadcrumbs.
#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(tag = "event", rename_all = "kebab-case")]
pub(crate) enum Navigation {
    Requested,
    Browse { allowed: bool, main_frame: bool },
    ProxyAuth { callback_present: bool },
    AuthCompleted { handled: bool },
    LoadError { code: i32, main_frame: bool },
    TlsEvidence { code: i32, fatal: bool },
    TlsReview,
    TlsAllow,
    TlsDenied,
    TlsFailed,
}

enum Message {
    Begin(PathBuf, SystemTime),
    Record(Stage, Option<Failure>, SystemTime),
    Navigation(Navigation, SystemTime),
    Timing(Box<TimingSnapshot>),
}

fn dispatcher() -> Option<&'static SyncSender<Message>> {
    static WORKER: OnceLock<Option<SyncSender<Message>>> = OnceLock::new();
    WORKER.get_or_init(|| {
        let mut journal: Option<Journal> = None;
        // Command/authorization milestones precede the working-root selection.
        // Buffer only bounded numeric snapshots until Begin, never UI file I/O.
        let mut early_timing = Vec::new();
        delivery::start_worker(MAX_RECORDS, move |message| {
            match message {
                Message::Begin(root, timestamp) => {
                    if journal.is_some() {
                        return;
                    }
                    match open_journal(&root) {
                        Ok(mut opened) => match opened.record(Stage::Preparing, None, timestamp) {
                            Ok(()) => {
                                if let Err(error) = flush_early_timing(&mut opened, &mut early_timing) {
                                    log::warn!("Native browser timing write failed (IO kind {:?})", error.kind());
                                } else {
                                    journal = Some(opened);
                                }
                            }
                            Err(error) => log::warn!("Native browser diagnostic journal unavailable (IO kind {:?}); startup may continue", error.kind()),
                        },
                        Err(error) => log::warn!("Native browser diagnostic journal unavailable (IO kind {:?}); startup may continue", error.kind()),
                    }
                }
                Message::Record(stage, failure, timestamp) => {
                    if failure.is_some() {
                        log::error!("Native browser lifecycle: stage={stage:?} failure={failure:?}");
                    } else {
                        log::info!("Native browser lifecycle: stage={stage:?}");
                    }
                    if let Some(opened) = journal.as_mut() {
                        if let Err(error) = opened.record(stage, failure, timestamp) {
                            log::warn!("Native browser diagnostic write failed (IO kind {:?}); further journal writes disabled", error.kind());
                            journal = None;
                        }
                    }
                }
                Message::Navigation(status, timestamp) => {
                    if let Some(opened) = journal.as_mut() {
                        if let Err(error) = opened.navigation(status, timestamp) {
                            log::warn!("Native browser diagnostic write failed (IO kind {:?})", error.kind());
                            journal = None;
                        }
                    }
                }
                Message::Timing(snapshot) => {
                    log::info!("Native browser startup timing: sample={} kind={} stage={} outcome={} total_us={} reached={} elapsed_us={:?}",
                        snapshot.sample, snapshot.kind, snapshot.stage, snapshot.outcome,
                        snapshot.total_us, snapshot.reached, snapshot.elapsed_us);
                    if let Some(opened) = journal.as_mut() {
                        if let Err(error) = opened.timing(&snapshot) {
                            log::warn!("Native browser timing write failed (IO kind {:?})", error.kind());
                            journal = None;
                        }
                    } else if early_timing.len() < MAX_TIMING_RECORDS {
                        early_timing.push(*snapshot);
                    }
                }
            }
        }).ok()
    }).as_ref()
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn open_journal(root: &Path) -> io::Result<Journal> {
    if !root.is_absolute() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let metadata = fs::symlink_metadata(root)?;
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    // A unique new file never truncates a previous report or follows an existing
    // file link. Hold its handle, not a path to reopen after startup.
    let mut nonce = [0u8; 16];
    rand::rngs::OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|_| io::Error::other("Diagnostic report entropy is unavailable"))?;
    let file_name = format!("browser-startup-{:032x}.jsonl", u128::from_le_bytes(nonce));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(Journal {
        file: options.open(root.join(file_name))?,
        records: 0,
        navigation_records: 0,
        timing_records: 0,
    })
}

impl Journal {
    fn timing(&mut self, snapshot: &TimingSnapshot) -> io::Result<()> {
        if self.timing_records >= MAX_TIMING_RECORDS {
            return Ok(());
        }
        let mut bytes = serde_json::to_vec(snapshot)?;
        bytes.push(b'\n');
        self.file.write_all(&bytes)?;
        self.file.sync_data()?;
        self.timing_records += 1;
        Ok(())
    }

    fn navigation(&mut self, status: Navigation, timestamp: SystemTime) -> io::Result<()> {
        if self.navigation_records >= 128 {
            return Ok(());
        }
        let record = serde_json::json!({
            "version": 1,
            "timestampUnixMs": timestamp.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
            "processId": std::process::id(),
            "navigationSequence": self.navigation_records,
            "navigation": status,
        });
        let mut bytes = serde_json::to_vec(&record)?;
        bytes.push(b'\n');
        self.file.write_all(&bytes)?;
        self.file.sync_data()?;
        self.navigation_records += 1;
        Ok(())
    }

    fn record(
        &mut self,
        stage: Stage,
        failure: Option<Failure>,
        timestamp: SystemTime,
    ) -> io::Result<()> {
        if self.records >= MAX_RECORDS {
            return Ok(());
        }
        let timestamp = timestamp.duration_since(UNIX_EPOCH).unwrap_or_default();
        // Fixed schema and enums only. Never add an arbitrary native/page error,
        // URL, command line, cookie, connection name or database identifier.
        let record = serde_json::json!({
            "version": 1,
            "timestampUnixMs": timestamp.as_millis(),
            "processId": std::process::id(),
            "sequence": self.records,
            "stage": stage,
            "failure": failure,
        });
        let mut bytes = serde_json::to_vec(&record)?;
        bytes.push(b'\n');
        self.file.write_all(&bytes)?;
        self.file.sync_data()?;
        self.records += 1;
        Ok(())
    }
}

fn flush_early_timing(journal: &mut Journal, early: &mut Vec<TimingSnapshot>) -> io::Result<()> {
    for snapshot in early.drain(..) {
        journal.timing(&snapshot)?;
    }
    Ok(())
}

pub(crate) fn begin(root: &Path) {
    if let Some(sender) = dispatcher() {
        let _ = delivery::enqueue(
            sender,
            Message::Begin(root.to_path_buf(), SystemTime::now()),
        );
    }
}

pub(crate) fn record(stage: Stage, failure: Option<Failure>) {
    if let Some(sender) = dispatcher() {
        let _ = delivery::enqueue(sender, Message::Record(stage, failure, SystemTime::now()));
    }
}

pub(crate) fn navigation(status: Navigation) {
    if let Some(sender) = dispatcher() {
        let _ = delivery::enqueue(sender, Message::Navigation(status, SystemTime::now()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn snapshots(receiver: &mpsc::Receiver<Message>) -> Vec<TimingSnapshot> {
        receiver
            .try_iter()
            .map(|message| match message {
                Message::Timing(snapshot) => *snapshot,
                _ => panic!("timing fixture emitted a non-timing record"),
            })
            .collect()
    }

    #[test]
    fn startup_progress_is_immediate_numeric_and_first_observation_wins() {
        let (sender, receiver) = mpsc::sync_channel(32);
        let trace = Trace::sampled(&AtomicU32::new(0), 1, &sender);
        let active = trace.0.as_ref().unwrap();
        active.mark(TimingStage::Authorized, 1_000);
        active.mark(TimingStage::Authorized, 9_000);
        active.mark(TimingStage::NativeInitializeEntered, 3_000);
        // Evidence exists while native initialization has not returned.
        let records = snapshots(&receiver);
        assert_eq!(records.len(), 3);
        let last = records.last().unwrap();
        assert_eq!(last.stage, TimingStage::NativeInitializeEntered as u8);
        assert_eq!(last.outcome, 255);
        assert_eq!(last.elapsed_us[TimingStage::Authorized as usize], 1_000);
        assert_eq!(
            last.elapsed_us[TimingStage::NativeInitializeEntered as usize],
            3_000
        );
        assert_eq!(
            last.reached & (1 << TimingStage::NativeInitializeReturned as usize),
            0
        );
        assert!(last.total_us >= 3_000);
        let value = serde_json::to_value(last).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 8);
        assert!(value.as_object().unwrap().values().all(|value| {
            value.is_u64()
                || value
                    .as_array()
                    .is_some_and(|array| array.iter().all(|v| v.is_u64()))
        }));
        assert!(serde_json::to_vec(last).unwrap().len() < 1_536);
    }

    #[test]
    fn completion_and_cancellation_do_not_wait_for_retained_ui_clones() {
        let (sender, receiver) = mpsc::sync_channel(32);
        let trace = Trace::sampled(&AtomicU32::new(0), 1, &sender);
        let hung_ui = trace.clone();
        trace.mark(TimingStage::NativeInitializeEntered);
        trace.finish(0); // cancelled command, native callback still retained
        hung_ui.mark(TimingStage::NativeInitializeReturned);
        hung_ui.finish(2);
        drop(trace);
        drop(hung_ui);
        let records = snapshots(&receiver);
        assert_eq!(records.len(), 3);
        let terminal = records.last().unwrap();
        assert_eq!(terminal.stage, TIMING_SLOTS as u8);
        assert_eq!(terminal.outcome, 0);
        assert_eq!(
            terminal.reached & (1 << TimingStage::NativeInitializeReturned as usize),
            0
        );

        let trace = Trace::sampled(&AtomicU32::new(0), 1, &sender);
        trace.mark(TimingStage::FirstDocumentComplete);
        trace.finish(2);
        assert!(snapshots(&receiver)
            .iter()
            .all(|record| record.outcome == 255));
        trace.mark(TimingStage::CommandCompleted);
        trace.finish(0);
        let records = snapshots(&receiver);
        assert_eq!(records.len(), 2);
        assert_eq!(records.last().unwrap().outcome, 2);
        assert_ne!(
            records.last().unwrap().reached & (1 << TimingStage::CommandCompleted as usize),
            0
        );
    }

    #[test]
    fn dropped_progress_is_recovered_by_later_snapshot_and_closed_queue_is_safe() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let trace = Trace::sampled(&AtomicU32::new(0), 1, &sender);
        trace.mark(TimingStage::Authorized); // full queue drops delivery only
        assert_eq!(snapshots(&receiver).len(), 1);
        trace.mark(TimingStage::RuntimeRequested);
        let recovered = snapshots(&receiver).pop().unwrap();
        assert_ne!(
            recovered.reached & (1 << TimingStage::Authorized as usize),
            0
        );
        drop(receiver);
        trace.mark(TimingStage::EngineUiQueued);
        trace.finish(0);
    }

    #[test]
    fn concurrent_startup_samples_and_per_stage_output_are_bounded() {
        let count = AtomicU32::new(0);
        let (sender, receiver) = mpsc::sync_channel(MAX_TIMING_RECORDS);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                let count = &count;
                let sender = &sender;
                scope.spawn(move || {
                    for _ in 0..16 {
                        let trace = Trace::sampled(count, 1, sender);
                        for _ in 0..100 {
                            trace.mark(TimingStage::Authorized);
                        }
                        trace.finish(0);
                        trace.finish(1);
                    }
                });
            }
        });
        let records = snapshots(&receiver);
        assert_eq!(count.load(Ordering::Relaxed), MAX_TIMED_STARTUPS);
        assert_eq!(records.len(), MAX_TIMED_STARTUPS as usize * 3);
        let samples: std::collections::BTreeSet<_> = records.iter().map(|r| r.sample).collect();
        assert_eq!(samples.len(), MAX_TIMED_STARTUPS as usize);
        assert!(samples.into_iter().eq(1..=MAX_TIMED_STARTUPS));
    }

    #[test]
    fn early_timing_is_preserved_and_has_an_independent_bounded_journal_budget() {
        let (sender, receiver) = mpsc::sync_channel(32);
        let trace = Trace::sampled(&AtomicU32::new(0), 1, &sender);
        trace.mark(TimingStage::Authorized);
        let mut early = snapshots(&receiver);
        let snapshot = early[0].clone();
        let temp = tempfile::tempdir().unwrap();
        let mut journal = open_journal(temp.path()).unwrap();
        flush_early_timing(&mut journal, &mut early).unwrap();
        assert!(early.is_empty());
        assert_eq!(journal.timing_records, 2);
        assert_eq!(journal.records, 0);
        assert_eq!(journal.navigation_records, 0);
        journal.timing_records = MAX_TIMING_RECORDS - 1;
        journal.timing(&snapshot).unwrap();
        journal.timing(&snapshot).unwrap();
        assert_eq!(journal.timing_records, MAX_TIMING_RECORDS);
        journal
            .record(Stage::Failed, Some(Failure::Timeout), SystemTime::now())
            .unwrap();
        journal
            .navigation(Navigation::Requested, SystemTime::now())
            .unwrap();
        drop(journal);
        let path = fs::read_dir(temp.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let text = fs::read_to_string(path).unwrap();
        let rows: Vec<serde_json::Value> = text
            .lines()
            .map(|row| serde_json::from_str(row).unwrap())
            .collect();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0]["stage"], TimingStage::CommandEntered as usize);
        assert_eq!(rows[1]["stage"], TimingStage::Authorized as usize);
        assert_eq!(rows[3]["failure"], "timeout");
        assert_eq!(rows[4]["navigation"]["event"], "requested");
    }

    #[test]
    fn navigation_is_fixed_bounded_and_does_not_consume_lifecycle_budget() {
        let temp = tempfile::tempdir().unwrap();
        let mut journal = open_journal(temp.path()).unwrap();
        for _ in 0..256 {
            journal
                .navigation(
                    Navigation::LoadError {
                        code: -7,
                        main_frame: true,
                    },
                    SystemTime::now(),
                )
                .unwrap();
        }
        journal
            .record(
                Stage::ViewFailed,
                Some(Failure::InitialNavigation),
                SystemTime::now(),
            )
            .unwrap();
        drop(journal);
        let path = fs::read_dir(temp.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let rows = fs::read_to_string(path).unwrap();
        assert_eq!(rows.lines().count(), 129);
        let first: serde_json::Value = serde_json::from_str(rows.lines().next().unwrap()).unwrap();
        assert_eq!(
            first["navigation"],
            serde_json::json!({"event":"load-error", "code":-7, "main_frame":true})
        );
        let last: serde_json::Value = serde_json::from_str(rows.lines().last().unwrap()).unwrap();
        assert_eq!(last["stage"], "view-failed");
    }

    #[test]
    fn per_view_failures_record_the_step_without_claiming_engine_failure() {
        let temp = tempfile::tempdir().unwrap();
        let mut journal = open_journal(temp.path()).unwrap();
        for failure in [
            Failure::PrivateProxy,
            Failure::PrivateContext,
            Failure::CookieRestore,
            Failure::NativeSurface,
            Failure::RendererSetup,
            Failure::InitialZoom,
            Failure::InitialNavigation,
            Failure::Timeout,
        ] {
            journal
                .record(Stage::ViewFailed, Some(failure), SystemTime::now())
                .unwrap();
        }
        drop(journal);
        let path = fs::read_dir(temp.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let rows = fs::read_to_string(path).unwrap();
        let failures: Vec<_> = rows
            .lines()
            .map(|row| {
                let value: serde_json::Value = serde_json::from_str(row).unwrap();
                assert_eq!(value["stage"], "view-failed");
                assert_eq!(value.as_object().unwrap().len(), 6);
                value["failure"].as_str().unwrap().to_owned()
            })
            .collect();
        assert_eq!(
            failures,
            [
                "private-proxy",
                "private-context",
                "cookie-restore",
                "native-surface",
                "renderer-setup",
                "initial-zoom",
                "initial-navigation",
                "timeout"
            ]
        );
    }

    #[test]
    fn journal_is_bounded_flushed_and_contains_only_fixed_diagnostics() {
        let temp = tempfile::tempdir().unwrap();
        let mut journal = open_journal(temp.path()).unwrap();
        let timestamp = SystemTime::now();
        journal.record(Stage::Preparing, None, timestamp).unwrap();
        journal
            .record(Stage::Initializing, None, timestamp)
            .unwrap();
        journal
            .record(Stage::Failed, Some(Failure::Initialization), timestamp)
            .unwrap();
        for _ in 0..40 {
            journal.record(Stage::Closed, None, timestamp).unwrap();
        }
        // This exercises the worker's synchronous sink, not caller durability.
        let path = fs::read_dir(temp.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.len() < 8192);
        let rows = String::from_utf8(bytes).unwrap();
        assert_eq!(rows.lines().count(), MAX_RECORDS);
        for (index, row) in rows.lines().enumerate() {
            let value: serde_json::Value = serde_json::from_str(row).unwrap();
            assert_eq!(value["sequence"], index);
            assert!(value["timestampUnixMs"].as_u64().is_some());
            assert_eq!(value.as_object().unwrap().len(), 6);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn reports_never_replace_each_other_and_bad_roots_are_not_created() {
        let temp = tempfile::tempdir().unwrap();
        let first = open_journal(temp.path()).unwrap();
        let second = open_journal(temp.path()).unwrap();
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
        assert!(open_journal(Path::new("relative")).is_err());
        let missing = temp.path().join("missing");
        assert!(open_journal(&missing).is_err());
        assert!(!missing.exists());
        drop((first, second));
    }
}
