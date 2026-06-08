//! Encrypted log sink — Commit H building block.
//!
//! Implements the file-writer half of the logs encryption story.
//! Sits beside the `artifacts::logs` codec and the
//! `redact_sensitive_lines` filter; combines them into a buffered
//! sink that can be driven by any `log::Log` adapter.
//!
//! **Not yet** wired into `tauri_plugin_log` — the plugin owns its
//! own file writer and replacing it is a separate, riskier commit.
//! This module ships the sink primitive plus tests so the next
//! commit (or a downstream user) can swap it in confidently.
//!
//! ## Why a buffered sink, not per-line encrypt
//!
//! `log::Log::log(record)` is sync and is called from every thread
//! that emits a log. Encryption is async (Tokio mutex on the
//! `EncryptionState`) and the v2 envelope adds 64 bytes of preamble
//! plus a 16-byte GCM tag per file — encrypting one byte per line
//! would explode the on-disk size by ~50× and cost a Tokio
//! round-trip per `log!()` invocation.
//!
//! Instead: `submit(line)` appends to an in-memory buffer; `flush()`
//! is the place where the actual encrypt-and-write happens. A
//! background task (or an explicit caller) drives `flush()` on a
//! size threshold + time interval. When the encryption state is
//! locked, lines accumulate in the buffer until unlock, then drain
//! in one envelope. The buffer is bounded by `max_buffer_bytes`
//! so a long-running locked state can't OOM the process.
//!
//! ## On-disk layout
//!
//! Each `flush()` produces one v2 envelope at:
//!
//! ```text
//! <dir>/encrypted-<UTC-date>.log.enc
//! ```
//!
//! Subsequent flushes on the same date append to the same file (one
//! envelope per flush, concatenated). On a new UTC date a fresh
//! file is started; readers walk the file boundary by boundary.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::artifacts::logs;
use crate::envelope::{MasterKeyStorage, SALT_LEN};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

/// Default flush threshold: 16 KiB. Tuned to keep `flush()` cheap
/// (one envelope per ~150 lines at typical log-line width) while
/// preserving useful batching.
pub const DEFAULT_FLUSH_BYTES: usize = 16 * 1024;

/// Bound on the in-memory buffer so a long-running locked encryption
/// state can't OOM the process. Past this size, the oldest half of
/// the buffer is dropped (with a `[REDACTED:overflow-dropped]`
/// sentinel inserted) so newer lines stay.
pub const DEFAULT_MAX_BUFFER_BYTES: usize = 4 * 1024 * 1024;

/// Encrypted log sink. Cheap to clone — shared state is behind `Arc`.
#[derive(Clone)]
pub struct EncryptedLogSink {
    state: Arc<EncryptionState>,
    dir: PathBuf,
    buffer: Arc<Mutex<Vec<u8>>>,
    flush_threshold: usize,
    max_buffer_bytes: usize,
    redact: bool,
}

impl EncryptedLogSink {
    /// Create a new sink writing to `<dir>/encrypted-<UTC-date>.log.enc`.
    /// `redact` toggles the [`logs::redact_sensitive_lines`] filter
    /// applied at flush time.
    pub fn new(state: Arc<EncryptionState>, dir: PathBuf, redact: bool) -> Self {
        Self {
            state,
            dir,
            buffer: Arc::new(Mutex::new(Vec::new())),
            flush_threshold: DEFAULT_FLUSH_BYTES,
            max_buffer_bytes: DEFAULT_MAX_BUFFER_BYTES,
            redact,
        }
    }

    /// Override the default flush threshold. Returns `self` for
    /// chaining.
    pub fn with_flush_threshold(mut self, n: usize) -> Self {
        self.flush_threshold = n;
        self
    }

    /// Override the default max-buffer cap. Returns `self`.
    pub fn with_max_buffer_bytes(mut self, n: usize) -> Self {
        self.max_buffer_bytes = n;
        self
    }

    /// Append one log line to the buffer. Returns `true` when the
    /// buffer has reached the flush threshold; the caller should
    /// schedule a `flush()` (preferably on a non-log thread to avoid
    /// blocking the `log::Log::log` callback).
    pub fn submit(&self, line: &str) -> bool {
        let mut buf = self.buffer.lock().expect("log buffer mutex poisoned");
        buf.extend_from_slice(line.as_bytes());
        if !line.ends_with('\n') {
            buf.push(b'\n');
        }
        // Bound the buffer. When it crosses `max_buffer_bytes`, drop
        // the oldest half — newer lines win because they're more
        // likely to be useful for debugging the active session.
        if buf.len() > self.max_buffer_bytes {
            let keep_from = buf.len() / 2;
            // Find the next newline boundary so we don't split mid-line.
            let nl = buf[keep_from..]
                .iter()
                .position(|&b| b == b'\n')
                .map(|p| keep_from + p + 1)
                .unwrap_or(keep_from);
            let mut new_buf =
                Vec::with_capacity(buf.len() - nl + b"[REDACTED:overflow-dropped]\n".len());
            new_buf.extend_from_slice(b"[REDACTED:overflow-dropped]\n");
            new_buf.extend_from_slice(&buf[nl..]);
            *buf = new_buf;
        }
        buf.len() >= self.flush_threshold
    }

    /// Drain the buffer through redaction + encryption + file append.
    /// Returns the number of plaintext bytes encrypted (zero when the
    /// buffer is empty or the state is locked).
    ///
    /// Locked-state behaviour: leaves the buffer intact and returns
    /// 0. The next flush after unlock drains everything in one
    /// envelope.
    pub async fn flush(&self) -> Result<usize, FlushError> {
        // Take the buffer out of the mutex to release it before
        // awaiting on encryption.
        let plaintext = {
            let mut buf = self.buffer.lock().expect("log buffer mutex poisoned");
            if buf.is_empty() {
                return Ok(0);
            }
            std::mem::take(&mut *buf)
        };
        let len = plaintext.len();

        // If the state is locked, restore the buffer and bail. We
        // don't want to drop log lines just because the user locked
        // mid-session.
        if !self.state.is_unlocked().await {
            let mut buf = self.buffer.lock().expect("log buffer mutex poisoned");
            // Push the drained bytes back to the front.
            let mut restored = plaintext;
            restored.extend_from_slice(&buf);
            *buf = restored;
            return Ok(0);
        }

        let payload = if self.redact {
            let text =
                std::str::from_utf8(&plaintext).map_err(|e| FlushError::Utf8(e.to_string()))?;
            logs::redact_sensitive_lines(text).into_bytes()
        } else {
            plaintext
        };

        let blob = logs::write(
            &self.state,
            &payload,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .map_err(|e| FlushError::Encrypt(e.to_string()))?;

        // Append to today's file. Multiple flushes per day concatenate
        // envelopes; each envelope is independently decryptable.
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| FlushError::Io(format!("mkdir: {}", e)))?;
        let path = self.dir.join(format!("encrypted-{}.log.enc", today_utc_date()));
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| FlushError::Io(format!("open {}: {}", path.display(), e)))?;
        f.write_all(&blob)
            .map_err(|e| FlushError::Io(format!("write: {}", e)))?;
        f.flush().map_err(|e| FlushError::Io(format!("fsync: {}", e)))?;

        Ok(len)
    }

    /// Current in-memory buffer size. Tests use this to verify
    /// drain/restore semantics.
    pub fn buffered_bytes(&self) -> usize {
        self.buffer.lock().map(|b| b.len()).unwrap_or(0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FlushError {
    #[error("encrypt: {0}")]
    Encrypt(String),
    #[error("io: {0}")]
    Io(String),
    #[error("buffered log bytes were not valid UTF-8: {0}")]
    Utf8(String),
}

/// Today's UTC date as `YYYY-MM-DD`. Hand-rolled to avoid pulling
/// `chrono` into this crate just for the filename — the audit
/// module uses the same pattern.
fn today_utc_date() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, da) = days_to_ymd((secs / 86_400) as i64);
    format!("{:04}-{:02}-{:02}", y, mo, da)
}

/// Convert days since the Unix epoch to `(year, month, day)` in UTC.
/// Based on Howard Hinnant's `civil_from_days` algorithm; mirrors
/// `audit::secs_to_civil` so the two file-dating schemes agree.
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y_civil = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (y_civil + if m <= 2 { 1 } else { 0 }) as i32;
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;
    use tempfile::tempdir;

    async fn unlocked(seed: u8) -> Arc<EncryptionState> {
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&[seed; 32]).unwrap()).await;
        Arc::new(s)
    }

    #[tokio::test]
    async fn submit_then_flush_writes_envelope_file() {
        let tmp = tempdir().unwrap();
        let state = unlocked(7).await;
        let sink = EncryptedLogSink::new(state, tmp.path().to_path_buf(), false);
        sink.submit("hello world");
        sink.submit("second line");
        let n = sink.flush().await.unwrap();
        assert!(n > 0);
        // One file written under today's date.
        let entries: Vec<_> = std::fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].starts_with("encrypted-"));
        assert!(entries[0].ends_with(".log.enc"));
        // Subsequent flush with nothing buffered is a no-op.
        assert_eq!(sink.flush().await.unwrap(), 0);
    }

    #[tokio::test]
    async fn locked_state_preserves_buffer_until_unlock() {
        let tmp = tempdir().unwrap();
        let state = Arc::new(EncryptionState::new()); // locked
        let sink = EncryptedLogSink::new(state.clone(), tmp.path().to_path_buf(), false);
        sink.submit("queued line 1");
        sink.submit("queued line 2");
        let pre_buf = sink.buffered_bytes();
        // Flush while locked → returns 0, buffer intact.
        assert_eq!(sink.flush().await.unwrap(), 0);
        assert_eq!(sink.buffered_bytes(), pre_buf);
        assert!(
            std::fs::read_dir(tmp.path()).unwrap().next().is_none(),
            "nothing must be written while locked"
        );
        // Unlock and flush again — file should appear.
        state.install(MasterDek::from_bytes(&[1u8; 32]).unwrap()).await;
        let n = sink.flush().await.unwrap();
        assert!(n > 0);
        assert!(std::fs::read_dir(tmp.path()).unwrap().next().is_some());
    }

    #[tokio::test]
    async fn flush_threshold_signal() {
        let state = unlocked(5).await;
        let sink = EncryptedLogSink::new(state, std::env::temp_dir(), false)
            .with_flush_threshold(50);
        // First short submit: no signal.
        assert!(!sink.submit("short"));
        // Cumulative size crosses 50 bytes → signal.
        assert!(sink.submit(&"x".repeat(60)));
    }

    #[tokio::test]
    async fn redaction_runs_pre_encrypt() {
        let tmp = tempdir().unwrap();
        let state = unlocked(9).await;
        let sink = EncryptedLogSink::new(state.clone(), tmp.path().to_path_buf(), true);
        sink.submit("INFO bearer token: Bearer abcdef1234567890");
        sink.flush().await.unwrap();
        // Decrypt the file and confirm the bearer-token redactor ran.
        let path = tmp.path().join(format!("encrypted-{}.log.enc", today_utc_date()));
        let bytes = std::fs::read(&path).unwrap();
        // Each flush is one envelope; read whichever envelope length
        // we just wrote (currently one).
        let (_h, plain) = crate::envelope::read_envelope(
            &state.sub_key(crate::ArtifactKind::Logs).await.unwrap(),
            &bytes,
        )
        .unwrap();
        let text = String::from_utf8(plain).unwrap();
        assert!(text.contains("[REDACTED:bearer-token]"));
        assert!(!text.contains("abcdef1234567890"));
    }

    #[tokio::test]
    async fn overflow_drops_oldest_half_with_sentinel() {
        let tmp = tempdir().unwrap();
        let state = unlocked(11).await;
        let sink =
            EncryptedLogSink::new(state, tmp.path().to_path_buf(), false).with_max_buffer_bytes(200);
        for i in 0..500 {
            sink.submit(&format!("line {}", i));
        }
        // After 500 lines, buffer is well over 200 bytes but capped
        // to roughly half + sentinel.
        let buffered = sink.buffered_bytes();
        assert!(buffered <= 250, "buffered={}", buffered);
        // The flushed file must contain the overflow sentinel.
        sink.flush().await.unwrap();
        // Decrypt to confirm.
        let path = tmp.path().join(format!("encrypted-{}.log.enc", today_utc_date()));
        let bytes = std::fs::read(&path).unwrap();
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&[11u8; 32]).unwrap()).await;
        let (_h, plain) = crate::envelope::read_envelope(
            &s.sub_key(crate::ArtifactKind::Logs).await.unwrap(),
            &bytes,
        )
        .unwrap();
        let text = String::from_utf8(plain).unwrap();
        assert!(text.contains("[REDACTED:overflow-dropped]"));
    }

    // ─── Gap 4: sustained-pressure overflow coverage ───────────────────
    //
    // The tests below exercise the buffer cap at the production default
    // (4 MiB) rather than the tiny override used by
    // `overflow_drops_oldest_half_with_sentinel`. They prove three
    // sub-properties of the overflow contract that the small-cap test
    // can't really stress:
    //   * the cap still holds at the *real* default size,
    //   * it stays held across many successive overflow events
    //     (long-running locked-state scenario), and
    //   * locked-then-unlocked drain preserves the newest content even
    //     after overflow has shed older lines.
    //
    // Each line embeds an 8-digit zero-padded sequence number so we can
    // unambiguously assert which lines survived in the decrypted file:
    // a substring search for `"line 00000000"` can never collide with
    // the sentinel or with padding bytes.

    #[tokio::test]
    async fn overflow_at_real_default_cap_drops_oldest_preserves_newest() {
        let tmp = tempdir().unwrap();
        let state = unlocked(13).await;
        // No `with_max_buffer_bytes` override — we want the real cap.
        let sink = EncryptedLogSink::new(state.clone(), tmp.path().to_path_buf(), false);

        // Line layout: "line <8-digit seq> " + 48 'x' padding + implicit
        // newline added by `submit` = 5 + 8 + 1 + 48 + 1 = 63 bytes.
        // We deliberately pick a width that's nowhere near a power of
        // two so a half-cut never lands on a tidy boundary.
        let line_bytes = 63usize;
        // Submit enough lines to overshoot the cap by ~25%, exercising
        // *one* overflow event at the real default size.
        let line_count = DEFAULT_MAX_BUFFER_BYTES * 5 / 4 / line_bytes;
        for i in 0..line_count {
            sink.submit(&format!("line {:08} {}", i, "x".repeat(48)));
        }

        // The buffer must have been clamped. Slack covers the
        // 28-byte sentinel plus a few bytes of mid-line-boundary
        // alignment drift.
        let buffered = sink.buffered_bytes();
        assert!(
            buffered <= DEFAULT_MAX_BUFFER_BYTES + 256,
            "buffered={} exceeded cap+slack ({})",
            buffered,
            DEFAULT_MAX_BUFFER_BYTES + 256
        );

        // Drain through a real flush so we can verify what *survived*
        // the overflow on disk, not just the in-memory residue.
        sink.flush().await.unwrap();
        let path = tmp.path().join(format!("encrypted-{}.log.enc", today_utc_date()));
        let bytes = std::fs::read(&path).unwrap();
        let s = EncryptionState::new();
        s.install(MasterDek::from_bytes(&[13u8; 32]).unwrap()).await;
        let (_h, plain) = crate::envelope::read_envelope(
            &s.sub_key(crate::ArtifactKind::Logs).await.unwrap(),
            &bytes,
        )
        .unwrap();
        let text = String::from_utf8(plain).unwrap();

        // Single overflow → exactly one sentinel in the surviving
        // payload. (Multiple sentinels would imply the cap was crossed
        // more than once, which our 25% overshoot deliberately avoids.)
        assert_eq!(
            text.matches("[REDACTED:overflow-dropped]").count(),
            1,
            "expected exactly one sentinel for a single overflow event"
        );

        // The most recent lines must be present. We test the very last
        // line (last `submit` call) and a line a few thousand back from
        // it — both should survive because they fall in the newest
        // half of the buffer.
        let last_seq = line_count - 1;
        let last_marker = format!("line {:08} ", last_seq);
        assert!(
            text.contains(&last_marker),
            "newest line {:08} missing from drained plaintext",
            last_seq
        );
        let near_end = format!("line {:08} ", last_seq - 1000);
        assert!(
            text.contains(&near_end),
            "expected line {:08} (near end) to survive overflow",
            last_seq - 1000
        );

        // And the oldest line — sequence 0 — must be gone, since the
        // overflow path drops the oldest half.
        assert!(
            !text.contains("line 00000000 "),
            "oldest line 00000000 should have been dropped by overflow"
        );

        // Newest line must also be the *last* line in the file — the
        // drain preserves submission order, only chopping from the
        // front. This catches accidental reordering or double-drain
        // regressions.
        let last_line = text.lines().last().expect("plaintext has at least one line");
        assert!(
            last_line.starts_with(&last_marker),
            "expected last line to start with {:?}, got {:?}",
            last_marker,
            last_line
        );
    }

    #[tokio::test]
    async fn repeated_overflows_keep_buffer_bounded() {
        // Simulates "user locked the vault and walked away" — log lines
        // keep arriving for hours, flush is never called, and we must
        // not OOM the process no matter how many times the cap is
        // crossed. Locked state is what defers `flush()` and lets the
        // buffer accumulate in the first place.
        let tmp = tempdir().unwrap();
        let state = Arc::new(EncryptionState::new()); // locked
        let sink = EncryptedLogSink::new(state.clone(), tmp.path().to_path_buf(), false);

        // Line width identical to test 1 so the cycle math is easy.
        let line_bytes = 63usize;
        // First batch fills 0 → just-over-cap (one overflow).
        // Subsequent batches refill ~half-cap → just-over-cap (one
        // overflow each). We oversize each batch by ~10% so a single
        // overflow per cycle is guaranteed even with sentinel slack.
        let first_batch = (DEFAULT_MAX_BUFFER_BYTES + DEFAULT_MAX_BUFFER_BYTES / 10) / line_bytes;
        let refill_batch =
            (DEFAULT_MAX_BUFFER_BYTES / 2 + DEFAULT_MAX_BUFFER_BYTES / 10) / line_bytes;

        let mut seq = 0usize;
        // Batch 0: cold-fill from empty.
        for _ in 0..first_batch {
            sink.submit(&format!("line {:08} {}", seq, "x".repeat(48)));
            seq += 1;
        }
        assert!(
            sink.buffered_bytes() <= DEFAULT_MAX_BUFFER_BYTES + 256,
            "cap violated after batch 0: {}",
            sink.buffered_bytes()
        );

        // Three refill cycles — total of four overflow events. Four is
        // enough to demonstrate the invariant; more is just expensive.
        for cycle in 1..=3 {
            for _ in 0..refill_batch {
                sink.submit(&format!("line {:08} {}", seq, "x".repeat(48)));
                seq += 1;
            }
            assert!(
                sink.buffered_bytes() <= DEFAULT_MAX_BUFFER_BYTES + 256,
                "cap violated after batch {}: {}",
                cycle,
                sink.buffered_bytes()
            );
        }

        // Unlock and flush so we can introspect what actually survived
        // in the buffer at the end. We deliberately do *not* expose a
        // `pub` peek API — the flush+decrypt route mirrors what the
        // operator would do during incident review.
        state.install(MasterDek::from_bytes(&[17u8; 32]).unwrap()).await;
        sink.flush().await.unwrap();
        let path = tmp.path().join(format!("encrypted-{}.log.enc", today_utc_date()));
        let bytes = std::fs::read(&path).unwrap();
        let (_h, plain) = crate::envelope::read_envelope(
            &state.sub_key(crate::ArtifactKind::Logs).await.unwrap(),
            &bytes,
        )
        .unwrap();
        let text = String::from_utf8(plain).unwrap();

        // FINDING: across N overflow cycles we observe at most ONE
        // sentinel in the surviving buffer, not N. The drop algorithm
        // halves the buffer from byte 0, and the sentinel inserted by
        // overflow K sits at byte 0 of the post-drop buffer — which is
        // squarely in the oldest half at overflow K+1, so it gets
        // discarded along with the rest of the old data.
        //
        // This means a decrypted envelope cannot tell a reviewer
        // whether 1 or 1000 overflow events occurred during the locked
        // window — only that at least one did. See report item (f).
        let sentinel_count = text.matches("[REDACTED:overflow-dropped]").count();
        assert_eq!(
            sentinel_count, 1,
            "expected the surviving buffer to coalesce to exactly one sentinel (found {})",
            sentinel_count
        );

        // The newest line must still be there — that's the whole point
        // of the "newer wins" policy.
        let last_marker = format!("line {:08} ", seq - 1);
        assert!(
            text.contains(&last_marker),
            "newest line {} missing from drained plaintext",
            seq - 1
        );

        // And the very first line must be gone — it was dropped by the
        // first overflow and never recovered.
        assert!(
            !text.contains("line 00000000 "),
            "oldest line should have been dropped"
        );
    }

    #[tokio::test]
    async fn post_unlock_drain_preserves_newest_content() {
        // Pins the "locked → ingest under overflow → unlock → flush"
        // path: even when the locked window triggered drops, the
        // unlock+flush must still surface the *newest* content (the
        // window we actually care about for the active session) and
        // emit a single envelope file.
        let tmp = tempdir().unwrap();
        let state = Arc::new(EncryptionState::new()); // locked
        let sink = EncryptedLogSink::new(state.clone(), tmp.path().to_path_buf(), false);

        // Use a wider line (95 bytes total) so 50k lines comfortably
        // overshoot the 4 MiB cap (50_000 * 95 ≈ 4.75 MiB, guaranteed
        // overflow with margin).
        let line_count = 50_000usize;
        for i in 0..line_count {
            sink.submit(&format!("line {:08} {}", i, "x".repeat(80)));
        }

        // Unlock then flush — the same sequence a user would hit when
        // re-entering their passphrase.
        state.install(MasterDek::from_bytes(&[23u8; 32]).unwrap()).await;
        let n = sink.flush().await.unwrap();
        assert!(n > 0, "post-unlock flush must drain something");

        // Exactly one envelope file should exist at today's date —
        // confirms we didn't accidentally double-write or rotate.
        let path = tmp.path().join(format!("encrypted-{}.log.enc", today_utc_date()));
        let bytes = std::fs::read(&path).unwrap();
        let (_h, plain) = crate::envelope::read_envelope(
            &state.sub_key(crate::ArtifactKind::Logs).await.unwrap(),
            &bytes,
        )
        .unwrap();
        let text = String::from_utf8(plain).unwrap();

        // Sentinel must be present (overflow did happen during the
        // locked window), the freshest line must survive, and the
        // first line must be gone.
        assert!(
            text.contains("[REDACTED:overflow-dropped]"),
            "expected overflow sentinel after 4.75 MiB of locked ingest"
        );
        assert!(
            !text.contains("line 00000000 "),
            "first line should have been dropped by overflow"
        );
        let last = line_count - 1;
        assert!(
            text.contains(&format!("line {:08} ", last)),
            "line {:08} (last submitted) should survive",
            last
        );
    }

    #[test]
    fn sustained_pressure_does_not_panic_or_grow_unbounded() {
        // Concurrency stress: four producer threads slam `submit` while
        // the encryption state is locked, so every line piles into the
        // buffer and overflow is hit many, many times. We're proving
        // structural invariants — no `Mutex` poisoning, the cap holds,
        // and a subsequent unlock+flush still produces a non-empty
        // envelope — not exact ordering, which is nondeterministic
        // under contention.
        //
        // This is `#[test]` not `#[tokio::test]` because `submit` is
        // sync and we want a vanilla `std::thread` pool; we build a
        // tiny Tokio runtime by hand for the final flush.
        let tmp = tempdir().unwrap();
        let state = Arc::new(EncryptionState::new()); // locked
        let sink = EncryptedLogSink::new(state.clone(), tmp.path().to_path_buf(), false);

        let threads = 4usize;
        let per_thread = 250_000usize;
        let handles: Vec<_> = (0..threads)
            .map(|tid| {
                // Clone is cheap — only the `Arc`s are duplicated.
                let sink = sink.clone();
                std::thread::spawn(move || {
                    for i in 0..per_thread {
                        // Encode thread id + sequence so two threads
                        // never produce the same line content. Width
                        // is roughly 64 bytes for parity with the
                        // other gap-4 tests.
                        sink.submit(&format!(
                            "line t{:02} {:08} {}",
                            tid,
                            i,
                            "x".repeat(44)
                        ));
                    }
                })
            })
            .collect();
        for h in handles {
            // `join` will surface a panic from a worker thread, which
            // is exactly the signal we want for "did anything blow up".
            h.join().expect("producer thread panicked");
        }

        // Cap held across ~64 MiB of concurrent ingest. The 1 KiB
        // slack covers the sentinel string plus the brief race window
        // where multiple threads can each push past `max_buffer_bytes`
        // before any one of them takes the overflow branch.
        let buffered = sink.buffered_bytes();
        assert!(
            buffered <= DEFAULT_MAX_BUFFER_BYTES + 1024,
            "buffer grew unbounded under contention: {} bytes",
            buffered
        );

        // Build a small runtime to drive the async unlock+flush. A
        // fresh runtime avoids dragging in `#[tokio::test]`'s
        // multi-threaded scheduler just for two awaits.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            state.install(MasterDek::from_bytes(&[29u8; 32]).unwrap()).await;
            let n = sink.flush().await.unwrap();
            assert!(n > 0, "flush after concurrent ingest must be non-empty");
        });

        let path = tmp.path().join(format!("encrypted-{}.log.enc", today_utc_date()));
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.is_empty(), "envelope file must be non-empty");
        // Quick sanity: the file decrypts cleanly. We don't pin which
        // sequence numbers survived — under contention the dropped
        // ranges are nondeterministic.
        let (_h, plain) = rt.block_on(async {
            crate::envelope::read_envelope(
                &state.sub_key(crate::ArtifactKind::Logs).await.unwrap(),
                &bytes,
            )
            .unwrap()
        });
        assert!(!plain.is_empty(), "decrypted plaintext must be non-empty");
    }
}
