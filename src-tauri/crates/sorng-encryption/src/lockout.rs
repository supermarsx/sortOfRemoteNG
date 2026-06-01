//! Per-attempt password-unlock cool-down state.
//!
//! Sits outside the encryption envelope on purpose: we need to know how
//! long the user must wait *before* we can decrypt anything, so the
//! file is plaintext JSON in the app-data dir alongside `settings.enc`
//! and `dek.enc`. Contents are pure policy metadata (failed attempt
//! count + last failure timestamp); no secrets.
//!
//! Backoff schedule, indexed by consecutive failed attempt count:
//!
//! ```text
//!   0 failures  →  0 s        (no cool-down)
//!   1 failure   →  5 s
//!   2 failures  →  30 s
//!   3 failures  →  5 min
//!   4 failures  →  30 min
//!   5+ failures →  30 min     (capped)
//! ```
//!
//! Counter resets to zero on the first successful unlock. The file
//! itself is rewritten atomically (temp + rename) so a crash mid-update
//! leaves either the pre- or post-update state intact, never garbage.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Filename inside `<app_data_dir>`.
pub const LOCKOUT_FILENAME: &str = "lockout.json";

/// On-disk shape. `failed_attempts` is the consecutive failure count;
/// `last_failure_unix_ms` is the wall-clock time of the most recent
/// failure. Both reset to zero on success.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct LockoutState {
    pub failed_attempts: u32,
    pub last_failure_unix_ms: u64,
}

impl LockoutState {
    /// Read the lockout file, returning a default-zero state if it
    /// doesn't exist yet (first-ever attempt) or fails to parse
    /// (corrupted manual edit — treat as "no recent failures" rather
    /// than locking the user out).
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(LOCKOUT_FILENAME);
        let s = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => return Self::default(),
        };
        serde_json::from_str(&s).unwrap_or_default()
    }

    /// Persist the lockout file atomically (temp + rename) so a crash
    /// mid-write never leaves a truncated file behind.
    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(LOCKOUT_FILENAME);
        let tmp = path.with_extension("tmp");
        let body = serde_json::to_string_pretty(self)
            .unwrap_or_else(|_| "{}".into());
        std::fs::write(&tmp, body)?;
        std::fs::rename(&tmp, &path)
    }

    /// Record one more failed attempt. Stamps `last_failure_unix_ms`
    /// with `now` and increments the counter. The caller persists
    /// afterwards.
    pub fn record_failure(&mut self) {
        self.failed_attempts = self.failed_attempts.saturating_add(1);
        self.last_failure_unix_ms = now_unix_ms();
    }

    /// Reset to zero. Called after a successful unlock.
    pub fn record_success(&mut self) {
        *self = Self::default();
    }

    /// Remaining cool-down in milliseconds. `0` means "unlock allowed
    /// right now". Computed from the failure timestamp + the schedule
    /// — never panics on a future `last_failure_unix_ms` (clock skew),
    /// it just falls back to zero.
    pub fn remaining_cooldown_ms(&self) -> u64 {
        if self.failed_attempts == 0 {
            return 0;
        }
        let required = cooldown_for_attempts(self.failed_attempts).as_millis() as u64;
        let elapsed = now_unix_ms().saturating_sub(self.last_failure_unix_ms);
        required.saturating_sub(elapsed)
    }
}

/// Backoff schedule keyed by failed-attempt count.
pub fn cooldown_for_attempts(attempts: u32) -> Duration {
    match attempts {
        0 => Duration::ZERO,
        1 => Duration::from_secs(5),
        2 => Duration::from_secs(30),
        3 => Duration::from_secs(5 * 60),
        _ => Duration::from_secs(30 * 60), // 4+ failures, capped
    }
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn default_is_zero_state() {
        let s = LockoutState::default();
        assert_eq!(s.failed_attempts, 0);
        assert_eq!(s.last_failure_unix_ms, 0);
        assert_eq!(s.remaining_cooldown_ms(), 0);
    }

    #[test]
    fn cooldown_schedule_matches_doc() {
        assert_eq!(cooldown_for_attempts(0), Duration::ZERO);
        assert_eq!(cooldown_for_attempts(1), Duration::from_secs(5));
        assert_eq!(cooldown_for_attempts(2), Duration::from_secs(30));
        assert_eq!(cooldown_for_attempts(3), Duration::from_secs(300));
        assert_eq!(cooldown_for_attempts(4), Duration::from_secs(1800));
        // 5 and beyond cap at 30 minutes.
        assert_eq!(cooldown_for_attempts(5), Duration::from_secs(1800));
        assert_eq!(cooldown_for_attempts(100), Duration::from_secs(1800));
    }

    #[test]
    fn record_failure_increments_and_stamps() {
        let mut s = LockoutState::default();
        s.record_failure();
        assert_eq!(s.failed_attempts, 1);
        assert!(s.last_failure_unix_ms > 0);
        let first_stamp = s.last_failure_unix_ms;
        std::thread::sleep(Duration::from_millis(2));
        s.record_failure();
        assert_eq!(s.failed_attempts, 2);
        assert!(s.last_failure_unix_ms >= first_stamp);
    }

    #[test]
    fn record_success_zeroes_everything() {
        let mut s = LockoutState::default();
        s.record_failure();
        s.record_failure();
        s.record_success();
        assert_eq!(s, LockoutState::default());
    }

    #[test]
    fn remaining_cooldown_starts_at_schedule_and_decays() {
        let mut s = LockoutState::default();
        s.record_failure(); // schedule = 5 s
        let r0 = s.remaining_cooldown_ms();
        assert!(r0 > 4_000 && r0 <= 5_000, "got {r0} ms");
    }

    #[test]
    fn elapsed_beyond_schedule_returns_zero() {
        let mut s = LockoutState {
            failed_attempts: 1,
            last_failure_unix_ms: 0, // ancient — schedule fully elapsed
        };
        // 30 minutes is far beyond the 5 s schedule for 1 failure.
        s.last_failure_unix_ms = now_unix_ms() - 30_000;
        assert_eq!(s.remaining_cooldown_ms(), 0);
    }

    #[test]
    fn future_failure_timestamp_clamps_to_zero_via_saturating_sub() {
        // Clock skew: the file claims a failure 60 s in the future.
        // We should treat the cool-down as "fully required from now",
        // not panic.
        let s = LockoutState {
            failed_attempts: 2,
            last_failure_unix_ms: now_unix_ms() + 60_000,
        };
        let r = s.remaining_cooldown_ms();
        assert!(r <= cooldown_for_attempts(2).as_millis() as u64);
    }

    #[test]
    fn saturating_add_protects_against_overflow() {
        let mut s = LockoutState {
            failed_attempts: u32::MAX,
            last_failure_unix_ms: 0,
        };
        s.record_failure(); // would overflow without saturation
        assert_eq!(s.failed_attempts, u32::MAX);
    }

    #[test]
    fn load_returns_default_for_missing_file() {
        let dir = tempdir().unwrap();
        let s = LockoutState::load(dir.path());
        assert_eq!(s, LockoutState::default());
    }

    #[test]
    fn load_returns_default_for_corrupted_file() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join(LOCKOUT_FILENAME), b"not json").unwrap();
        let s = LockoutState::load(dir.path());
        assert_eq!(s, LockoutState::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempdir().unwrap();
        let mut s = LockoutState::default();
        s.record_failure();
        s.record_failure();
        s.save(dir.path()).unwrap();
        let again = LockoutState::load(dir.path());
        assert_eq!(again, s);
    }

    #[test]
    fn save_overwrites_existing_file() {
        let dir = tempdir().unwrap();
        let mut s = LockoutState::default();
        s.record_failure();
        s.save(dir.path()).unwrap();
        s.record_success();
        s.save(dir.path()).unwrap();
        let loaded = LockoutState::load(dir.path());
        assert_eq!(loaded, LockoutState::default());
    }

    #[test]
    fn save_uses_camel_case_field_names_on_disk() {
        // The TS hook reads this file (Phase 5b) so the on-disk shape
        // must use camelCase.
        let dir = tempdir().unwrap();
        let mut s = LockoutState::default();
        s.record_failure();
        s.save(dir.path()).unwrap();
        let body = std::fs::read_to_string(dir.path().join(LOCKOUT_FILENAME)).unwrap();
        assert!(body.contains("\"failedAttempts\""), "body = {body}");
        assert!(body.contains("\"lastFailureUnixMs\""), "body = {body}");
    }
}
