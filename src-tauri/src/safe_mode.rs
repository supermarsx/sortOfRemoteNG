//! Safe-mode tracking: counts consecutive unclean exits in the backend so a
//! hang or crash loop is detected even when the frontend never runs.
//!
//! Files in `<app data>/safe-mode/`:
//! * `running.lock`   advisory lock held for the process lifetime. The OS drops
//!                    it when the process dies, so "lock free but marker present"
//!                    means the previous run ended uncleanly (pid-reuse safe), and
//!                    "lock busy" means another instance is alive (it is left alone).
//! * `running.marker` JSON written at start, removed on graceful exit.
//! * `state.json`     JSON counter, history and the user's configuration.
//!
//! Every failure fails open: tracking problems never block startup, a corrupt
//! marker or state file counts as clean, and no user data is read or modified.

use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DEFAULT_THRESHOLD: u32 = 5;
/// A safe-mode run must live this long before a graceful exit clears the counter.
pub const STABLE_RUN_MS: u64 = 60_000;
const HISTORY_LIMIT: usize = 10;
const DIR_NAME: &str = "safe-mode";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PersistedState {
    pub consecutive_unclean: u32,
    pub last_unclean_ms: Vec<u64>,
    /// `None` uses the default; `Some(0)` disables detection.
    pub threshold: Option<u32>,
    pub start_next_time: bool,
    /// Testing aid: consumed at the next start, which then behaves as if this
    /// many consecutive unclean exits had happened.
    pub pending_simulated_unclean: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub pid: u32,
    pub started_at_ms: u64,
    pub version: String,
    pub consecutive_unclean: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    UncleanExits,
    Forced,
    NextStart,
}

/// Everything the environment contributes, so the state machine is testable.
#[derive(Clone, Debug)]
pub struct Inputs {
    pub dir: PathBuf,
    pub now_ms: u64,
    pub pid: u32,
    pub version: String,
    pub debug_build: bool,
    /// Opt in to counting in debug builds (`SORNG_SAFE_MODE_TRACK_DEV=1`).
    pub track_in_debug: bool,
    /// `--safe-mode` or `SORNG_SAFE_MODE=1`.
    pub forced: bool,
    pub env_threshold: Option<u32>,
    /// `SORNG_SAFE_MODE_SIMULATE_UNCLEAN=N`: pretend N consecutive unclean exits.
    pub simulate_unclean: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub active: bool,
    pub reason: Option<Reason>,
    pub consecutive_unclean: u32,
    pub threshold: u32,
    pub last_unclean_ms: Vec<u64>,
    /// The marker of the previous, unclean run, when one was found.
    pub previous_marker: Option<Marker>,
    pub started_at_ms: u64,
    pub start_next_time: bool,
    /// False when tracking was unavailable (IO failure or another instance).
    pub tracking: bool,
    pub dev_exempt: bool,
}

impl Status {
    fn inactive(now_ms: u64) -> Self {
        Self {
            active: false,
            reason: None,
            consecutive_unclean: 0,
            threshold: DEFAULT_THRESHOLD,
            last_unclean_ms: Vec::new(),
            previous_marker: None,
            started_at_ms: now_ms,
            start_next_time: false,
            tracking: false,
            dev_exempt: false,
        }
    }
}

/// Holds the lock and the paths needed to finish the run.
pub struct Tracker {
    dir: PathBuf,
    lock: File,
    started_at_ms: u64,
    safe_mode: bool,
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join("state.json")
}
fn marker_path(dir: &Path) -> PathBuf {
    dir.join("running.marker")
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// Missing or corrupt state counts as clean defaults.
pub fn read_state(dir: &Path) -> PersistedState {
    std::fs::read(state_path(dir))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_state(dir: &Path, state: &PersistedState) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    write_atomic(&state_path(dir), &bytes)
}

fn read_marker(dir: &Path) -> Option<Marker> {
    let bytes = std::fs::read(marker_path(dir)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn effective_threshold(state: &PersistedState, env_threshold: Option<u32>) -> u32 {
    env_threshold
        .or(state.threshold)
        .unwrap_or(DEFAULT_THRESHOLD)
}

/// Starts a run. Never fails: any IO problem yields an inactive, untracked status.
pub fn begin(inputs: &Inputs) -> (Status, Option<Tracker>) {
    match begin_inner(inputs) {
        Ok(result) => result,
        Err(error) => {
            log::warn!("Safe mode tracking unavailable, starting normally: {error}");
            let mut status = Status::inactive(inputs.now_ms);
            if inputs.forced {
                status.active = true;
                status.reason = Some(Reason::Forced);
            }
            (status, None)
        }
    }
}

fn begin_inner(inputs: &Inputs) -> std::io::Result<(Status, Option<Tracker>)> {
    std::fs::create_dir_all(&inputs.dir)?;
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(inputs.dir.join("running.lock"))?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => {
            // Another live instance owns the marker: leave it alone entirely.
            let state = read_state(&inputs.dir);
            let mut status = Status::inactive(inputs.now_ms);
            status.threshold = effective_threshold(&state, inputs.env_threshold);
            status.active = inputs.forced;
            status.reason = inputs.forced.then_some(Reason::Forced);
            return Ok((status, None));
        }
        Err(std::fs::TryLockError::Error(error)) => return Err(error),
    }

    let mut state = read_state(&inputs.dir);
    let previous = read_marker(&inputs.dir);
    let dev_exempt = inputs.debug_build && !inputs.track_in_debug;
    // A leftover marker while the lock was free: the previous run did not exit.
    if previous.is_some() && !dev_exempt {
        state.consecutive_unclean = state.consecutive_unclean.saturating_add(1);
        state.last_unclean_ms.push(inputs.now_ms);
        let excess = state.last_unclean_ms.len().saturating_sub(HISTORY_LIMIT);
        state.last_unclean_ms.drain(..excess);
    }
    if let Some(n) = inputs.simulate_unclean.or(state.pending_simulated_unclean) {
        state.consecutive_unclean = n;
        state.last_unclean_ms = vec![inputs.now_ms; (n as usize).min(HISTORY_LIMIT)];
    }
    state.pending_simulated_unclean = None;

    let threshold = effective_threshold(&state, inputs.env_threshold);
    let reason = if inputs.forced {
        Some(Reason::Forced)
    } else if state.start_next_time {
        Some(Reason::NextStart)
    } else if threshold > 0 && state.consecutive_unclean >= threshold {
        Some(Reason::UncleanExits)
    } else {
        None
    };
    // The one-shot request is consumed by the start it applies to.
    state.start_next_time = false;

    let marker = Marker {
        pid: inputs.pid,
        started_at_ms: inputs.now_ms,
        version: inputs.version.clone(),
        consecutive_unclean: state.consecutive_unclean,
    };
    let marker_bytes = serde_json::to_vec(&marker).map_err(std::io::Error::other)?;
    write_atomic(&marker_path(&inputs.dir), &marker_bytes)?;
    if let Err(error) = write_state(&inputs.dir, &state) {
        log::warn!("Safe mode state not saved: {error}");
    }

    let status = Status {
        active: reason.is_some(),
        reason,
        consecutive_unclean: state.consecutive_unclean,
        threshold,
        last_unclean_ms: state.last_unclean_ms.clone(),
        previous_marker: previous,
        started_at_ms: inputs.now_ms,
        start_next_time: false,
        tracking: true,
        dev_exempt,
    };
    let tracker = Tracker {
        dir: inputs.dir.clone(),
        lock,
        started_at_ms: inputs.now_ms,
        safe_mode: status.active,
    };
    Ok((status, Some(tracker)))
}

impl Tracker {
    /// Graceful exit. A safe-mode run clears the counter only after
    /// [`STABLE_RUN_MS`]; a normal run always clears it. `force_reset` is the
    /// user's explicit "Restart normally". Releases the lock so a relaunch is
    /// not mistaken for a second instance.
    pub fn finish(self, now_ms: u64, force_reset: bool) {
        let stable = now_ms.saturating_sub(self.started_at_ms) >= STABLE_RUN_MS;
        if force_reset || !self.safe_mode || stable {
            let mut state = read_state(&self.dir);
            state.consecutive_unclean = 0;
            if let Err(error) = write_state(&self.dir, &state) {
                log::warn!("Safe mode counter not reset: {error}");
            }
        }
        if let Err(error) = std::fs::remove_file(marker_path(&self.dir)) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("Safe mode marker not removed: {error}");
            }
        }
        let _ = self.lock.unlock();
    }
}

/// Updates the user's configuration in `state.json` (never touches user data).
pub fn update_config(
    dir: &Path,
    threshold: Option<u32>,
    start_next_time: Option<bool>,
) -> std::io::Result<PersistedState> {
    let mut state = read_state(dir);
    if let Some(value) = threshold {
        state.threshold = Some(value.min(1000));
    }
    if let Some(value) = start_next_time {
        state.start_next_time = value;
    }
    std::fs::create_dir_all(dir)?;
    write_state(dir, &state)?;
    Ok(state)
}

// ── Process-wide wiring ──────────────────────────────────────────────────

struct Runtime {
    dir: PathBuf,
    status: Status,
}

static RUNTIME: Mutex<Option<Runtime>> = Mutex::new(None);
static TRACKER: Mutex<Option<Tracker>> = Mutex::new(None);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|v| matches!(v.trim(), "1" | "true" | "TRUE" | "yes"))
        .unwrap_or(false)
}

fn env_u32(name: &str) -> Option<u32> {
    std::env::var(name).ok()?.trim().parse().ok()
}

/// Called once from `setup`, right after the profile is verified.
pub fn begin_for_app(app: &tauri::App) {
    use tauri::Manager;
    let Ok(base) = app.path().app_data_dir() else {
        log::warn!("Safe mode tracking unavailable: no app data dir");
        return;
    };
    let inputs = Inputs {
        dir: base.join(DIR_NAME),
        now_ms: now_ms(),
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        debug_build: cfg!(debug_assertions),
        track_in_debug: env_flag("SORNG_SAFE_MODE_TRACK_DEV"),
        forced: env_flag("SORNG_SAFE_MODE") || std::env::args().any(|a| a == "--safe-mode"),
        env_threshold: env_u32("SORNG_SAFE_MODE_THRESHOLD"),
        simulate_unclean: env_u32("SORNG_SAFE_MODE_SIMULATE_UNCLEAN"),
    };
    let (status, tracker) = begin(&inputs);
    if status.active {
        log::warn!(
            "Starting in SAFE MODE ({:?}, {} consecutive unclean exits)",
            status.reason,
            status.consecutive_unclean
        );
    }
    if let (Ok(mut runtime), Ok(mut slot)) = (RUNTIME.lock(), TRACKER.lock()) {
        *runtime = Some(Runtime {
            dir: inputs.dir,
            status,
        });
        *slot = tracker;
    }
}

/// Graceful exit hook (`RunEvent::Exit`). Idempotent.
pub fn end_session() {
    finish_session(false);
}

fn finish_session(force_reset: bool) {
    let tracker = TRACKER.lock().ok().and_then(|mut slot| slot.take());
    if let Some(tracker) = tracker {
        tracker.finish(now_ms(), force_reset);
    }
}

fn current() -> Option<(PathBuf, Status)> {
    let guard = RUNTIME.lock().ok()?;
    guard.as_ref().map(|r| (r.dir.clone(), r.status.clone()))
}

fn live_status() -> Status {
    match current() {
        Some((dir, mut status)) => {
            let state = read_state(&dir);
            status.start_next_time = state.start_next_time;
            status.threshold = effective_threshold(&state, env_u32("SORNG_SAFE_MODE_THRESHOLD"));
            status
        }
        None => Status::inactive(now_ms()),
    }
}

#[tauri::command]
pub(crate) fn safe_mode_status() -> Status {
    live_status()
}

#[tauri::command]
pub(crate) fn safe_mode_update_config(
    threshold: Option<u32>,
    start_next_time: Option<bool>,
) -> Result<Status, String> {
    let (dir, _) = current().ok_or_else(|| "safe mode tracking is unavailable".to_string())?;
    update_config(&dir, threshold, start_next_time).map_err(|e| e.to_string())?;
    Ok(live_status())
}

/// Testing aid: makes the next start behave as if `count` unclean exits
/// happened (defaults to the current threshold).
#[tauri::command]
pub(crate) fn safe_mode_simulate_unclean_exits(count: Option<u32>) -> Result<Status, String> {
    let (dir, _) = current().ok_or_else(|| "safe mode tracking is unavailable".to_string())?;
    let mut state = read_state(&dir);
    let wanted = count
        .unwrap_or_else(|| effective_threshold(&state, env_u32("SORNG_SAFE_MODE_THRESHOLD")));
    state.pending_simulated_unclean = Some(wanted);
    write_state(&dir, &state).map_err(|e| e.to_string())?;
    Ok(live_status())
}

/// "Restart normally": clears the counter and relaunches without safe mode.
#[tauri::command]
pub(crate) fn safe_mode_restart_normally(app: tauri::AppHandle) {
    finish_session(true);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(dir: &Path) -> Inputs {
        Inputs {
            dir: dir.join("safe-mode"),
            now_ms: 1_000,
            pid: 7,
            version: "1.0.0".into(),
            debug_build: false,
            track_in_debug: false,
            forced: false,
            env_threshold: None,
            simulate_unclean: None,
        }
    }

    /// Starts and abandons a run: the lock is released, the marker is left.
    fn crash(i: &Inputs) -> Status {
        let (status, tracker) = begin(i);
        drop(tracker);
        status
    }

    #[test]
    fn clean_exit_resets_counter_and_removes_marker() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        crash(&i);
        crash(&i);
        let (status, tracker) = begin(&i);
        assert_eq!(status.consecutive_unclean, 2);
        tracker.unwrap().finish(2_000, false);
        assert!(!marker_path(&i.dir).exists());
        assert_eq!(read_state(&i.dir).consecutive_unclean, 0);
        assert_eq!(begin(&i).0.consecutive_unclean, 0);
    }

    #[test]
    fn first_run_is_not_unclean() {
        let dir = tempfile::tempdir().unwrap();
        let status = crash(&inputs(dir.path()));
        assert_eq!(status.consecutive_unclean, 0);
        assert!(!status.active && status.tracking);
    }

    #[test]
    fn five_unclean_exits_start_safe_mode() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        crash(&i);
        for expected in 1..=4 {
            let s = crash(&i);
            assert_eq!(s.consecutive_unclean, expected);
            assert!(!s.active);
        }
        let s = crash(&i);
        assert_eq!(s.consecutive_unclean, 5);
        assert!(s.active);
        assert_eq!(s.reason, Some(Reason::UncleanExits));
        assert_eq!(s.last_unclean_ms.len(), 5);
        assert!(s.previous_marker.is_some());
    }

    #[test]
    fn threshold_zero_disables_and_env_overrides_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut i = inputs(dir.path());
        update_config(&i.dir, Some(0), None).unwrap();
        for _ in 0..8 {
            assert!(!crash(&i).active);
        }
        i.env_threshold = Some(2);
        assert!(crash(&i).active);
        update_config(&i.dir, Some(3), None).unwrap();
        i.env_threshold = None;
        assert!(crash(&i).active, "counter already above the new threshold");
    }

    #[test]
    fn corrupted_marker_and_state_count_as_clean() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        std::fs::create_dir_all(&i.dir).unwrap();
        std::fs::write(marker_path(&i.dir), b"{not json").unwrap();
        std::fs::write(state_path(&i.dir), b"\x00\xff garbage").unwrap();
        let s = crash(&i);
        assert_eq!(s.consecutive_unclean, 0);
        assert!(!s.active && s.tracking);
    }

    #[test]
    fn debug_builds_do_not_count_unless_opted_in() {
        let dir = tempfile::tempdir().unwrap();
        let mut i = inputs(dir.path());
        i.debug_build = true;
        for _ in 0..8 {
            let s = crash(&i);
            assert_eq!(s.consecutive_unclean, 0);
            assert!(!s.active && s.dev_exempt);
        }
        i.track_in_debug = true;
        for _ in 0..5 {
            crash(&i);
        }
        assert!(crash(&i).active);
    }

    #[test]
    fn live_instance_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        let (_, first) = begin(&i);
        let first = first.unwrap();
        let (second, tracker) = begin(&i);
        assert!(tracker.is_none() && !second.tracking && !second.active);
        // The live run's marker survives and is not counted.
        assert!(marker_path(&i.dir).exists());
        first.finish(2_000, false);
        assert_eq!(begin(&i).0.consecutive_unclean, 0);
    }

    #[test]
    fn fail_open_when_directory_cannot_be_created() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, b"x").unwrap();
        let mut i = inputs(dir.path());
        i.dir = blocker.join("safe-mode");
        let (status, tracker) = begin(&i);
        assert!(tracker.is_none() && !status.tracking && !status.active);
        i.forced = true;
        assert!(begin(&i).0.active, "a forced start works without tracking");
    }

    #[test]
    fn forced_start_and_one_shot_next_start() {
        let dir = tempfile::tempdir().unwrap();
        let mut i = inputs(dir.path());
        i.forced = true;
        let s = crash(&i);
        assert_eq!((s.active, s.reason), (true, Some(Reason::Forced)));
        i.forced = false;
        update_config(&i.dir, None, Some(true)).unwrap();
        let s = crash(&i);
        assert_eq!(s.reason, Some(Reason::NextStart));
        assert!(!read_state(&i.dir).start_next_time);
        assert!(!crash(&i).active);
    }

    #[test]
    fn safe_mode_run_needs_to_be_stable_before_reset() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        for _ in 0..6 {
            crash(&i);
        }
        let (s, tracker) = begin(&i);
        assert!(s.active);
        tracker.unwrap().finish(i.now_ms + 5_000, false);
        let (s, tracker) = begin(&i);
        assert!(s.active, "short graceful safe-mode run keeps the counter");
        assert!(s.consecutive_unclean >= 5);
        tracker.unwrap().finish(i.now_ms + STABLE_RUN_MS, false);
        assert!(!begin(&i).0.active);
    }

    #[test]
    fn restart_normally_resets_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        for _ in 0..6 {
            crash(&i);
        }
        let (s, tracker) = begin(&i);
        assert!(s.active);
        tracker.unwrap().finish(i.now_ms, true);
        let s = begin(&i).0;
        assert!(!s.active && s.consecutive_unclean == 0);
    }

    #[test]
    fn pending_simulation_survives_a_clean_exit_and_applies_once() {
        let dir = tempfile::tempdir().unwrap();
        let i = inputs(dir.path());
        let (_, tracker) = begin(&i);
        let mut state = read_state(&i.dir);
        state.pending_simulated_unclean = Some(5);
        write_state(&i.dir, &state).unwrap();
        tracker.unwrap().finish(2_000, false);
        let (s, tracker) = begin(&i);
        assert!(s.active && s.consecutive_unclean == 5);
        tracker.unwrap().finish(i.now_ms + STABLE_RUN_MS, false);
        assert!(!begin(&i).0.active);
    }

    #[test]
    fn simulation_input_sets_the_counter() {
        let dir = tempfile::tempdir().unwrap();
        let mut i = inputs(dir.path());
        i.simulate_unclean = Some(5);
        assert!(crash(&i).active);
    }
}
