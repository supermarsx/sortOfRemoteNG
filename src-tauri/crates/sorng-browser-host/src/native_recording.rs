//! Opt-in, native CEF metadata recording. Never retains headers, bodies, full
//! paths, query strings, fragments, credentials, or page-provided diagnostics.
//! This observer cannot admit requests or change their routing.
use crate::ipc::OriginBrowserIdentity;
use serde::Serialize;
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use url::Url;

pub const MAX_RECORDINGS: usize = 16;
pub const MAX_ENTRIES: usize = 2048;
pub const MAX_IN_FLIGHT: usize = 256;
pub const MAX_DURATION: Duration = Duration::from_secs(30 * 60);
const MAX_ORIGIN_BYTES: usize = 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Memory-only, exact-attempt owner check. Must not perform IO or acquire a
/// recording lock. The application supplies its native revocable owner lease.
pub trait RecordingOwner: Send + Sync {
    fn current(&self, identity: &BrowserIdentity) -> bool;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum RecordingError {
    #[error("The browser recording owner is unavailable")]
    OwnerUnavailable,
    #[error("Review or discard the existing browser recording first")]
    AlreadyExists,
    #[error("The browser recording limit was reached")]
    Limit,
    #[error("The browser recording is unavailable or changed")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Recording,
    Stopped,
    LimitReached,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub identity: OriginBrowserIdentity,
    pub recording_id: String,
    pub phase: Phase,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub received_body_bytes: u64,
    pub dropped_entries: u64,
    pub metadata_only: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub started_unix_ms: u64,
    pub duration_ms: u64,
    /// Canonical origin plus slash only, even when a token is in the path.
    pub url: String,
    pub method: &'static str,
    pub status: u16,
    pub received_body_bytes: u64,
    pub outcome: Outcome,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Success,
    Redirect,
    Cancelled,
    Failed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingData {
    pub snapshot: Snapshot,
    pub entries: Vec<Entry>,
}

struct Buffer {
    phase: Phase,
    stopped: Option<Instant>,
    entries: Vec<Entry>,
    received: u64,
    dropped: u64,
    in_flight: usize,
}

pub struct Recording {
    identity: BrowserIdentity,
    id: String,
    owner: Arc<dyn RecordingOwner>,
    revoked: AtomicBool,
    started: Instant,
    buffer: Mutex<Buffer>,
}

fn registry() -> &'static Mutex<Vec<Arc<Recording>>> {
    static REGISTRY: OnceLock<Mutex<Vec<Arc<Recording>>>> = OnceLock::new();
    REGISTRY.get_or_init(Mutex::default)
}

fn milliseconds(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(MAX_SAFE_INTEGER)) as u64
}

fn redacted_url(raw: &str) -> Option<String> {
    if raw.len() > 16_384 {
        return None;
    }
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return None;
    }
    let origin = url.origin().ascii_serialization();
    (origin.len() <= MAX_ORIGIN_BYTES).then(|| format!("{origin}/"))
}

fn method(raw: &str) -> &'static str {
    match raw {
        "GET" => "GET",
        "HEAD" => "HEAD",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        "OPTIONS" => "OPTIONS",
        "CONNECT" => "CONNECT",
        "TRACE" => "TRACE",
        _ => "OTHER",
    }
}

impl Recording {
    /// Only the native application may start this after an explicit menu action.
    pub fn start(
        identity: &BrowserIdentity,
        owner: Arc<dyn RecordingOwner>,
    ) -> Result<Arc<Self>, RecordingError> {
        if !owner.current(identity) {
            return Err(RecordingError::OwnerUnavailable);
        }
        let mut records = registry().lock().map_err(|_| RecordingError::Unavailable)?;
        records.retain(|record| {
            if record.current() {
                true
            } else {
                record.revoke();
                false
            }
        });
        if records.iter().any(|record| record.identity == *identity) {
            return Err(RecordingError::AlreadyExists);
        }
        if records.len() >= MAX_RECORDINGS {
            return Err(RecordingError::Limit);
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let record = Arc::new(Self {
            identity: identity.clone(),
            id: format!(
                "{}-{}",
                identity.attempt_id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ),
            owner,
            revoked: AtomicBool::new(false),
            started: Instant::now(),
            buffer: Mutex::new(Buffer {
                phase: Phase::Recording,
                stopped: None,
                entries: Vec::new(),
                received: 0,
                dropped: 0,
                in_flight: 0,
            }),
        });
        if !record.current() {
            return Err(RecordingError::OwnerUnavailable);
        }
        records.push(record.clone());
        Ok(record)
    }

    fn current(&self) -> bool {
        !self.revoked.load(Ordering::Acquire)
            && self.owner.current(&self.identity)
            && !self.revoked.load(Ordering::Acquire)
    }

    pub fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
        let mut buffer = self.buffer.lock().unwrap_or_else(|e| e.into_inner());
        buffer.entries.clear();
        buffer.phase = Phase::Stopped;
        buffer.in_flight = 0;
        buffer.received = 0;
    }

    fn checked_buffer(&self) -> Result<std::sync::MutexGuard<'_, Buffer>, RecordingError> {
        let mut buffer = self
            .buffer
            .lock()
            .map_err(|_| RecordingError::Unavailable)?;
        if !self.current() {
            self.revoked.store(true, Ordering::Release);
            buffer.entries.clear();
            return Err(RecordingError::OwnerUnavailable);
        }
        if buffer.phase == Phase::Recording && self.started.elapsed() >= MAX_DURATION {
            buffer.phase = Phase::LimitReached;
            buffer.stopped = Some(self.started + MAX_DURATION);
            buffer.dropped = buffer.dropped.saturating_add(buffer.in_flight as u64);
            buffer.in_flight = 0;
        }
        Ok(buffer)
    }

    fn snapshot_locked(&self, buffer: &Buffer) -> Snapshot {
        Snapshot {
            identity: OriginBrowserIdentity::from_native(&self.identity),
            recording_id: self.id.clone(),
            phase: buffer.phase,
            duration_ms: milliseconds(
                buffer
                    .stopped
                    .unwrap_or_else(Instant::now)
                    .saturating_duration_since(self.started),
            ),
            entry_count: buffer.entries.len(),
            received_body_bytes: buffer.received,
            dropped_entries: buffer.dropped,
            metadata_only: true,
        }
    }

    pub fn snapshot(&self) -> Result<Snapshot, RecordingError> {
        let buffer = self.checked_buffer()?;
        Ok(self.snapshot_locked(&buffer))
    }

    pub fn stop(&self) -> Result<Snapshot, RecordingError> {
        let mut buffer = self.checked_buffer()?;
        if buffer.phase == Phase::Recording {
            buffer.phase = Phase::Stopped;
            buffer.stopped = Some(Instant::now());
            // Incomplete requests are explicitly counted, not invented as HAR
            // completions. Their eventual callbacks cannot enter this recording.
            buffer.dropped = buffer.dropped.saturating_add(buffer.in_flight as u64);
            buffer.in_flight = 0;
        }
        Ok(self.snapshot_locked(&buffer))
    }

    pub fn export(&self) -> Result<RecordingData, RecordingError> {
        let buffer = self.checked_buffer()?;
        if buffer.phase == Phase::Recording {
            return Err(RecordingError::Unavailable);
        }
        let data = RecordingData {
            snapshot: self.snapshot_locked(&buffer),
            entries: buffer.entries.clone(),
        };
        if !self.current() {
            return Err(RecordingError::OwnerUnavailable);
        }
        Ok(data)
    }

    fn begin(self: &Arc<Self>, raw_url: &str, raw_method: &str) -> Option<Capture> {
        let url = redacted_url(raw_url)?;
        let mut buffer = self.checked_buffer().ok()?;
        if buffer.phase != Phase::Recording {
            return None;
        }
        if buffer.in_flight >= MAX_IN_FLIGHT {
            buffer.dropped = buffer.dropped.saturating_add(1);
            return None;
        }
        let started_unix_ms = milliseconds(SystemTime::now().duration_since(UNIX_EPOCH).ok()?);
        buffer.in_flight += 1;
        Some(Capture {
            recording: Arc::downgrade(self),
            started: Instant::now(),
            started_unix_ms,
            url,
            method: method(raw_method),
            finished: false,
        })
    }
}

/// Exact native identity only, never a connection ID or renderer lookup key.
pub fn find(identity: &BrowserIdentity) -> Option<Arc<Recording>> {
    let record = registry()
        .lock()
        .ok()?
        .iter()
        .find(|record| record.identity == *identity)
        .cloned()?;
    if record.current() {
        Some(record)
    } else {
        record.revoke();
        None
    }
}

pub fn discard(identity: &BrowserIdentity) {
    if let Ok(mut records) = registry().lock() {
        records.retain(|record| {
            if record.identity == *identity {
                record.revoke();
                false
            } else {
                true
            }
        });
    }
}

/// User discard is compare-and-remove; a delayed UI action must never erase a
/// replacement recording. Owner revocation deliberately uses discard instead.
pub fn discard_exact(identity: &BrowserIdentity, recording_id: &str) -> bool {
    let Ok(mut records) = registry().lock() else {
        return false;
    };
    let Some(index) = records
        .iter()
        .position(|record| record.identity == *identity && record.id == recording_id)
    else {
        return false;
    };
    records.remove(index).revoke();
    true
}

/// Called by housekeeping even when the page is idle. No DB IO.
pub fn reap() {
    if let Ok(mut records) = registry().lock() {
        records.retain(|record| {
            if record.current() {
                drop(record.checked_buffer());
                true
            } else {
                record.revoke();
                false
            }
        });
    }
}

/// A handler gets one native ticket when an admitted request starts. Tickets
/// never rebind to a restarted recording, even for the same connection/URL.
pub fn begin(identity: &BrowserIdentity, url: &str, method: &str) -> Option<Capture> {
    find(identity)?.begin(url, method)
}

pub struct Capture {
    recording: Weak<Recording>,
    started: Instant,
    started_unix_ms: u64,
    url: String,
    method: &'static str,
    finished: bool,
}

impl Capture {
    pub fn redirect(self, status: i32, new_url: &str, raw_method: &str) -> Option<Self> {
        // Retain THIS recording across redirects. A late redirect from an old
        // request cannot attach itself to a newly started recording.
        let record = self.recording.upgrade()?;
        self.complete(status, 0, Outcome::Redirect);
        record.begin(new_url, raw_method)
    }

    pub fn complete(mut self, status: i32, received: i64, outcome: Outcome) {
        self.finished = true;
        let Some(record) = self.recording.upgrade() else {
            return;
        };
        let Ok(mut buffer) = record.checked_buffer() else {
            return;
        };
        if buffer.phase != Phase::Recording {
            return;
        }
        buffer.in_flight = buffer.in_flight.saturating_sub(1);
        if buffer.entries.len() >= MAX_ENTRIES {
            buffer.phase = Phase::LimitReached;
            buffer.stopped = Some(Instant::now());
            buffer.dropped = buffer.dropped.saturating_add(1 + buffer.in_flight as u64);
            buffer.in_flight = 0;
            return;
        }
        let received = (received.max(0) as u64).min(MAX_SAFE_INTEGER);
        buffer.received = buffer
            .received
            .saturating_add(received)
            .min(MAX_SAFE_INTEGER);
        buffer.entries.push(Entry {
            started_unix_ms: self.started_unix_ms,
            duration_ms: milliseconds(self.started.elapsed()),
            url: std::mem::take(&mut self.url),
            method: self.method,
            status: if (100..=599).contains(&status) {
                status as u16
            } else {
                0
            },
            received_body_bytes: received,
            outcome,
        });
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let Some(record) = self.recording.upgrade() else {
            return;
        };
        let Ok(mut buffer) = record.checked_buffer() else {
            return;
        };
        if buffer.phase == Phase::Recording {
            buffer.in_flight = buffer.in_flight.saturating_sub(1);
            buffer.dropped = buffer.dropped.saturating_add(1);
        }
    }
}

#[cfg(test)]
#[path = "native_recording_tests.rs"]
mod tests;
