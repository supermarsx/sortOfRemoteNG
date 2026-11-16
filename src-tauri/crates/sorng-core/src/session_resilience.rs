//! Session resilience primitives shared by the protocol crates.
//!
//! * [`SequencedRing`]: a bounded, sequenced, memory-only output replay ring
//!   (serial and telnet). Its snapshot response mirrors the SSH
//!   `get_terminal_buffer_snapshot` shape so one frontend replay scheduler can
//!   consume every protocol.
//! * [`LiveSessionDescriptor`]: the metadata a freshly loaded frontend needs to
//!   rebuild tabs for backend sessions that outlived the previous document.
//! * [`PresenceTracker`]: frontend presence bookkeeping plus the orphan grace
//!   policy. It never reads a wall clock; every method takes `now_ms`, so tests
//!   drive a fake clock.
//!
//! # Security
//!
//! Ring contents live in process memory only. They are never serialized to
//! disk, never printed by `Debug`, are zeroized when evicted/cleared/dropped,
//! and are bounded by bytes *and* chunk count per ring plus a process-wide
//! budget ([`GLOBAL_RING_BUDGET_BYTES`]).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

// ─────────────────────────────────────────────────────────────────────────────
// Ring buffer
// ─────────────────────────────────────────────────────────────────────────────

/// Default per-session replay budget: 1 MiB.
pub const DEFAULT_RING_BYTES: usize = 1024 * 1024;
/// Hard per-session ceiling no configuration can exceed: 16 MiB.
pub const MAX_RING_BYTES: usize = 16 * 1024 * 1024;
/// Hard per-session chunk-count ceiling.
pub const MAX_RING_CHUNKS: usize = 1024;
/// Chunk granularity. Small pushes are appended into the tail chunk, so the
/// hot path allocates once per `DEFAULT_CHUNK_BYTES`, not once per push.
pub const DEFAULT_CHUNK_BYTES: usize = 16 * 1024;
/// Process-wide ceiling across every ring sharing [`global_ring_budget`].
pub const GLOBAL_RING_BUDGET_BYTES: usize = 64 * 1024 * 1024;
/// Largest page one snapshot call returns (matches the SSH snapshot page cap).
pub const MAX_SNAPSHOT_PAGE_BYTES: usize = 256 * 1024;

static NEXT_RING_GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_generation() -> u64 {
    NEXT_RING_GENERATION.fetch_add(1, Ordering::Relaxed)
}

/// Byte accounting shared by all rings of a process.
#[derive(Debug)]
pub struct RingBudget {
    used: AtomicUsize,
    cap: usize,
}

impl RingBudget {
    pub fn new(cap: usize) -> Arc<Self> {
        Arc::new(Self {
            used: AtomicUsize::new(0),
            cap,
        })
    }

    pub fn used(&self) -> usize {
        self.used.load(Ordering::Relaxed)
    }

    pub fn cap(&self) -> usize {
        self.cap
    }

    fn add(&self, bytes: usize) {
        self.used.fetch_add(bytes, Ordering::Relaxed);
    }

    fn sub(&self, bytes: usize) {
        // Saturating: accounting must never wrap even if a bug double-frees.
        let _ = self
            .used
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |used| {
                Some(used.saturating_sub(bytes))
            });
    }

    fn over(&self) -> bool {
        self.used() > self.cap
    }
}

/// The process-wide budget used by the serial and telnet services.
pub fn global_ring_budget() -> Arc<RingBudget> {
    static BUDGET: OnceLock<Arc<RingBudget>> = OnceLock::new();
    BUDGET
        .get_or_init(|| RingBudget::new(GLOBAL_RING_BUDGET_BYTES))
        .clone()
}

/// How snapshot pages are encoded and aligned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnapshotEncoding {
    /// The ring holds UTF-8 text (telnet). Pages and eviction always land on
    /// character boundaries and `data` is the text itself, like SSH.
    Utf8,
    /// The ring holds arbitrary bytes (serial). `data` is standard base64, the
    /// same encoding the live `serial:output` event uses for its `data` field.
    Base64,
}

/// Per-ring limits. Always passed through [`RingLimits::clamped`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RingLimits {
    pub max_bytes: usize,
    pub max_chunks: usize,
    pub chunk_bytes: usize,
}

impl Default for RingLimits {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_RING_BYTES,
            max_chunks: MAX_RING_CHUNKS,
            chunk_bytes: DEFAULT_CHUNK_BYTES,
        }
    }
}

impl RingLimits {
    pub fn with_max_bytes(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            ..Self::default()
        }
        .clamped()
    }

    /// Clamp into the hard ceilings. A zero budget becomes the minimum useful
    /// ring (one byte) rather than disabling the bound.
    pub fn clamped(self) -> Self {
        let max_bytes = self.max_bytes.clamp(1, MAX_RING_BYTES);
        Self {
            max_bytes,
            max_chunks: self.max_chunks.clamp(1, MAX_RING_CHUNKS),
            chunk_bytes: self
                .chunk_bytes
                .clamp(1, DEFAULT_CHUNK_BYTES.max(max_bytes)),
        }
    }
}

struct Chunk {
    /// Sequence number of `buf[0]`.
    start: u64,
    buf: Vec<u8>,
}

impl Chunk {
    fn end(&self) -> u64 {
        self.start + self.buf.len() as u64
    }
}

impl Drop for Chunk {
    fn drop(&mut self) {
        self.buf.zeroize();
    }
}

/// Sequenced response for one snapshot page. Field names (snake_case) and
/// semantics match the SSH `TerminalBufferSnapshot`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutputSnapshot {
    pub session_id: String,
    /// Page payload, encoded per `encoding`.
    pub data: String,
    /// `"utf8"` (data is text) or `"base64"` (data is base64 of raw bytes).
    pub encoding: SnapshotEncoding,
    /// Changes whenever the ring restarts (clear / new ring). A cursor from an
    /// older generation is reported as `generation_changed` + `gap`.
    pub generation: u64,
    /// Sequence number of the first byte of `data`.
    pub sequence_start: u64,
    /// Sequence number one past the last byte of `data`; use it as the next
    /// `after_sequence`.
    pub sequence_end: u64,
    /// Oldest sequence still retained.
    pub retained_start: u64,
    /// Cumulative bytes evicted since the ring was created or cleared.
    pub dropped_bytes: u64,
    /// True when the requested cursor was no longer retained (or the
    /// generation changed), so the caller missed output.
    pub gap: bool,
    pub generation_changed: bool,
    /// True when more retained output exists after `sequence_end`.
    pub has_more: bool,
}

/// Where one push landed. Live output events carry it so a reattaching
/// frontend can drop events already covered by a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppendMeta {
    pub generation: u64,
    /// Sequence of the first byte of the pushed data.
    pub sequence_start: u64,
    /// One past the last byte of the pushed data.
    pub sequence_end: u64,
}

/// Cheap metadata used by the live-session registry (no payload copy).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputRange {
    pub generation: u64,
    /// Oldest retained sequence.
    pub sequence_start: u64,
    /// One past the newest sequence.
    pub sequence_end: u64,
    pub dropped_bytes: u64,
}

/// Bounded, sequenced replay ring. Not internally synchronised: wrap it in a
/// `std::sync::Mutex` (writer: output forwarder; readers: snapshot commands).
pub struct SequencedRing {
    generation: u64,
    encoding: SnapshotEncoding,
    limits: RingLimits,
    chunks: VecDeque<Chunk>,
    retained_bytes: usize,
    retained_start: u64,
    sequence_end: u64,
    dropped_bytes: u64,
    budget: Option<Arc<RingBudget>>,
}

impl std::fmt::Debug for SequencedRing {
    // Deliberately omits the payload.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SequencedRing")
            .field("generation", &self.generation)
            .field("retained_bytes", &self.retained_bytes)
            .field("retained_start", &self.retained_start)
            .field("sequence_end", &self.sequence_end)
            .field("dropped_bytes", &self.dropped_bytes)
            .finish_non_exhaustive()
    }
}

#[inline]
fn is_continuation(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

impl SequencedRing {
    pub fn new(encoding: SnapshotEncoding, limits: RingLimits) -> Self {
        Self::with_budget(encoding, limits, None)
    }

    pub fn with_budget(
        encoding: SnapshotEncoding,
        limits: RingLimits,
        budget: Option<Arc<RingBudget>>,
    ) -> Self {
        Self {
            generation: next_generation(),
            encoding,
            limits: limits.clamped(),
            chunks: VecDeque::new(),
            retained_bytes: 0,
            retained_start: 0,
            sequence_end: 0,
            dropped_bytes: 0,
            budget,
        }
    }

    pub fn limits(&self) -> RingLimits {
        self.limits
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn retained_bytes(&self) -> usize {
        self.retained_bytes
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    pub fn range(&self) -> OutputRange {
        OutputRange {
            generation: self.generation,
            sequence_start: self.retained_start,
            sequence_end: self.sequence_end,
            dropped_bytes: self.dropped_bytes,
        }
    }

    /// Append output. Amortised allocation-free: bytes go into the tail chunk
    /// until it fills; eviction is O(1) per chunk (a partial trim moves at
    /// most one chunk).
    pub fn push(&mut self, data: &[u8]) -> AppendMeta {
        let sequence_start = self.sequence_end;
        if data.is_empty() {
            return self.append_meta(sequence_start);
        }
        let total = data.len() as u64;
        let mut data = data;
        let max = self.limits.max_bytes;
        if data.len() >= max {
            // The newest `max` bytes replace everything retained.
            let existing = self.retained_bytes as u64;
            self.release_all();
            let skip = data.len() - max;
            self.dropped_bytes = self.dropped_bytes.saturating_add(existing + skip as u64);
            self.retained_start = self.sequence_end + skip as u64;
            data = &data[skip..];
            if self.encoding == SnapshotEncoding::Utf8 {
                let lead = data.iter().take_while(|b| is_continuation(**b)).count();
                self.dropped_bytes = self.dropped_bytes.saturating_add(lead as u64);
                self.retained_start += lead as u64;
                data = &data[lead..];
            }
        }
        self.sequence_end += total;
        let mut position = self.retained_start + self.retained_bytes as u64;
        let mut remaining = data;
        while !remaining.is_empty() {
            let chunk_bytes = self.limits.chunk_bytes;
            let room = match self.chunks.back() {
                Some(chunk) => chunk_bytes.saturating_sub(chunk.buf.len()),
                None => 0,
            };
            if room == 0 {
                self.chunks.push_back(Chunk {
                    start: position,
                    buf: Vec::with_capacity(chunk_bytes.min(max)),
                });
                continue;
            }
            let take = room.min(remaining.len());
            let chunk = self.chunks.back_mut().expect("tail chunk exists");
            chunk.buf.extend_from_slice(&remaining[..take]);
            position += take as u64;
            remaining = &remaining[take..];
        }
        let added = data.len();
        self.retained_bytes += added;
        if let Some(budget) = &self.budget {
            budget.add(added);
        }
        self.enforce();
        self.append_meta(sequence_start)
    }

    fn append_meta(&self, sequence_start: u64) -> AppendMeta {
        AppendMeta {
            generation: self.generation,
            sequence_start,
            sequence_end: self.sequence_end,
        }
    }

    /// Drop retained output and start a new generation. Existing bytes are
    /// zeroized. Sequence numbers restart from zero.
    pub fn clear(&mut self) {
        self.release_all();
        self.generation = next_generation();
        self.retained_start = 0;
        self.sequence_end = 0;
        self.dropped_bytes = 0;
    }

    fn release_all(&mut self) {
        if let Some(budget) = &self.budget {
            budget.sub(self.retained_bytes);
        }
        self.retained_bytes = 0;
        // Chunk::drop zeroizes each buffer.
        self.chunks.clear();
    }

    fn account_evicted(&mut self, bytes: usize) {
        self.retained_bytes -= bytes;
        self.retained_start += bytes as u64;
        self.dropped_bytes = self.dropped_bytes.saturating_add(bytes as u64);
        if let Some(budget) = &self.budget {
            budget.sub(bytes);
        }
    }

    fn enforce(&mut self) {
        loop {
            let over_bytes = self.retained_bytes > self.limits.max_bytes;
            let over_chunks = self.chunks.len() > self.limits.max_chunks;
            let over_budget = self.budget.as_ref().is_some_and(|b| b.over());
            if !(over_bytes || over_chunks || over_budget) {
                break;
            }
            let Some(front) = self.chunks.front() else {
                break;
            };
            let front_len = front.buf.len();
            let excess = self.retained_bytes.saturating_sub(self.limits.max_bytes);
            if over_chunks || over_budget || excess >= front_len {
                let chunk = self.chunks.pop_front().expect("front exists");
                let len = chunk.buf.len();
                drop(chunk);
                self.account_evicted(len);
            } else {
                let front = self.chunks.front_mut().expect("front exists");
                let new_len = front_len - excess;
                front.buf.copy_within(excess.., 0);
                front.buf[new_len..front_len].zeroize();
                front.buf.truncate(new_len);
                front.start += excess as u64;
                self.account_evicted(excess);
            }
        }
        if self.encoding == SnapshotEncoding::Utf8 {
            // Never leave a torn character at the head of the ring.
            while let Some(front) = self.chunks.front_mut() {
                match front.buf.first() {
                    Some(b) if is_continuation(*b) => {
                        front.buf.copy_within(1.., 0);
                        let last = front.buf.len() - 1;
                        front.buf[last] = 0;
                        front.buf.truncate(last);
                        front.start += 1;
                        self.account_evicted(1);
                    }
                    Some(_) => break,
                    None => {
                        self.chunks.pop_front();
                    }
                }
            }
        }
    }

    fn byte_at(&self, sequence: u64) -> Option<u8> {
        if sequence < self.retained_start || sequence >= self.sequence_end {
            return None;
        }
        self.chunks
            .iter()
            .find(|chunk| sequence >= chunk.start && sequence < chunk.end())
            .map(|chunk| chunk.buf[(sequence - chunk.start) as usize])
    }

    fn copy_from(&self, start: u64, max: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(max.min(self.retained_bytes));
        for chunk in &self.chunks {
            if chunk.end() <= start {
                continue;
            }
            let offset = start.saturating_sub(chunk.start) as usize;
            let want = max - out.len();
            let slice = &chunk.buf[offset..];
            out.extend_from_slice(&slice[..slice.len().min(want)]);
            if out.len() >= max {
                break;
            }
        }
        out
    }

    /// Read one page. `generation` and `after_sequence` come from a previous
    /// response; both `None` reads from the oldest retained byte.
    pub fn snapshot(
        &self,
        session_id: &str,
        generation: Option<u64>,
        after_sequence: Option<u64>,
        max_bytes: Option<usize>,
    ) -> OutputSnapshot {
        let generation_changed = generation.is_some_and(|value| value != self.generation);
        let mut gap = generation_changed;
        let mut start = self.retained_start;
        if !generation_changed {
            if let Some(after) = after_sequence {
                // Out of range, or (utf8) inside a character: a gap.
                if after < self.retained_start
                    || after > self.sequence_end
                    || (self.encoding == SnapshotEncoding::Utf8
                        && self.byte_at(after).is_some_and(is_continuation))
                {
                    gap = true;
                } else {
                    start = after;
                }
            }
        }
        let floor = if self.encoding == SnapshotEncoding::Utf8 {
            4
        } else {
            1
        };
        let page = max_bytes
            .unwrap_or(MAX_SNAPSHOT_PAGE_BYTES)
            .clamp(floor, MAX_SNAPSHOT_PAGE_BYTES);
        let mut bytes = self.copy_from(start, page);
        let mut end = start + bytes.len() as u64;
        if self.encoding == SnapshotEncoding::Utf8 && end < self.sequence_end {
            let mut next = self.byte_at(end);
            while next.is_some_and(is_continuation) {
                match bytes.pop() {
                    Some(popped) => {
                        end -= 1;
                        next = Some(popped);
                    }
                    None => break,
                }
            }
        }
        let data = match self.encoding {
            SnapshotEncoding::Utf8 => String::from_utf8_lossy(&bytes).into_owned(),
            SnapshotEncoding::Base64 => base64::engine::general_purpose::STANDARD.encode(&bytes),
        };
        bytes.zeroize();
        OutputSnapshot {
            session_id: session_id.to_string(),
            data,
            encoding: self.encoding,
            generation: self.generation,
            sequence_start: start,
            sequence_end: end,
            retained_start: self.retained_start,
            dropped_bytes: self.dropped_bytes,
            gap,
            generation_changed,
            has_more: end < self.sequence_end,
        }
    }
}

impl Drop for SequencedRing {
    fn drop(&mut self) {
        self.release_all();
    }
}

/// Thread-safe handle: one writer (the output forwarder) and any number of
/// snapshot readers. The lock is held only for a memcpy-sized critical
/// section and is separate from every write path.
#[derive(Debug)]
pub struct SharedRing {
    ring: Mutex<SequencedRing>,
    closed: std::sync::atomic::AtomicBool,
}

impl SharedRing {
    pub fn new(encoding: SnapshotEncoding, limits: RingLimits) -> Arc<Self> {
        Self::with_ring(SequencedRing::with_budget(
            encoding,
            limits,
            Some(global_ring_budget()),
        ))
    }

    pub fn with_ring(ring: SequencedRing) -> Arc<Self> {
        Arc::new(Self {
            ring: Mutex::new(ring),
            closed: std::sync::atomic::AtomicBool::new(false),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, SequencedRing> {
        // A poisoned ring is still memory-safe; keep serving it.
        self.ring
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Append output; a closed ring ignores late writes.
    pub fn push(&self, data: &[u8]) -> AppendMeta {
        if self.closed.load(Ordering::Acquire) {
            let ring = self.lock();
            return ring.append_meta(ring.sequence_end);
        }
        self.lock().push(data)
    }

    /// Real close: zeroize and drop everything, and ignore later pushes.
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.lock().clear();
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub fn clear(&self) {
        self.lock().clear();
    }

    pub fn range(&self) -> OutputRange {
        self.lock().range()
    }

    pub fn snapshot(
        &self,
        session_id: &str,
        generation: Option<u64>,
        after_sequence: Option<u64>,
        max_bytes: Option<usize>,
    ) -> OutputSnapshot {
        self.lock()
            .snapshot(session_id, generation, after_sequence, max_bytes)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live session registry types
// ─────────────────────────────────────────────────────────────────────────────

/// Identifies one backend session.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionKey {
    pub protocol: String,
    pub backend_session_id: String,
}

impl SessionKey {
    pub fn new(protocol: &str, backend_session_id: &str) -> Self {
        Self {
            protocol: protocol.to_string(),
            backend_session_id: backend_session_id.to_string(),
        }
    }
}

/// One session a frontend window says it currently holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionClaim {
    pub protocol: String,
    pub backend_session_id: String,
    /// Optional tab id so a fresh frontend can rebuild the exact tab.
    #[serde(default)]
    pub frontend_session_id: Option<String>,
}

impl SessionClaim {
    pub fn key(&self) -> SessionKey {
        SessionKey::new(&self.protocol, &self.backend_session_id)
    }
}

/// Orphan bookkeeping attached to each descriptor.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanStatus {
    /// A frontend window claimed this session within the attach TTL.
    pub claimed: bool,
    /// Seconds since the last claim (or since first seen when never claimed).
    pub unclaimed_for_secs: u64,
    /// Seconds until the reaper closes it; `None` when the reaper is off or
    /// the session is claimed.
    pub reap_in_secs: Option<u64>,
}

/// Everything a new frontend needs to rebuild a tab for a live session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionDescriptor {
    /// `ssh` | `rdp` | `vnc` | `telnet` | `serial`.
    pub protocol: String,
    pub backend_session_id: String,
    /// Tab id the frontend last claimed this session under, when known.
    pub frontend_session_id: Option<String>,
    pub connection_id: Option<String>,
    pub title: String,
    /// Host (or serial port name) the session targets.
    pub target: String,
    pub port: Option<u16>,
    pub username: Option<String>,
    /// `connected` | `detached` | `disconnected`.
    pub state: String,
    /// RDP only: whether the native viewer channel is attached.
    pub viewer_attached: Option<bool>,
    /// RFC 3339 timestamps.
    pub created_at: Option<String>,
    pub last_activity_at: Option<String>,
    /// Replay buffer sequence range (ssh, telnet, serial).
    pub buffer: Option<OutputRange>,
    pub orphan: OrphanStatus,
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontend presence + orphan grace policy
// ─────────────────────────────────────────────────────────────────────────────

/// Default grace before an unclaimed session is reaped: 5 minutes.
pub const GRACE_DEFAULT_SECS: u64 = 300;
/// Shortest non-zero grace (shorter would race a slow webview reload).
pub const GRACE_MIN_SECS: u64 = 30;
/// Longest grace: 24 hours.
pub const GRACE_MAX_SECS: u64 = 86_400;
/// Frontends heartbeat about every 5 seconds.
pub const HEARTBEAT_INTERVAL_MS: u64 = 5_000;
/// A claim younger than this counts as "a frontend is attached".
pub const ATTACH_TTL_MS: u64 = 20_000;
/// Reaper cadence.
pub const REAPER_TICK_MS: u64 = 15_000;

/// `0` disables reaping entirely (sessions then live until closed); other
/// values are clamped to `[GRACE_MIN_SECS, GRACE_MAX_SECS]`.
pub fn normalize_grace_secs(secs: u64) -> u64 {
    if secs == 0 {
        0
    } else {
        secs.clamp(GRACE_MIN_SECS, GRACE_MAX_SECS)
    }
}

#[derive(Debug, Clone)]
struct Presence {
    first_seen_ms: u64,
    last_claimed_ms: Option<u64>,
    frontend_session_id: Option<String>,
}

#[derive(Debug)]
struct PresenceState {
    grace_secs: u64,
    /// Reaping only arms after a heartbeat-capable frontend has been seen, so
    /// legacy/headless frontends can never lose sessions.
    frontend_seen: bool,
    windows: HashMap<String, u64>,
    sessions: HashMap<SessionKey, Presence>,
    last_tick_ms: Option<u64>,
}

/// Tracks which backend sessions a frontend claims and decides which are
/// orphaned. Pure state: callers pass `now_ms` (monotonic milliseconds).
#[derive(Debug)]
pub struct PresenceTracker {
    inner: Mutex<PresenceState>,
}

/// Result of one heartbeat, returned to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatAck {
    /// Effective (normalized) grace in seconds; 0 means reaping is disabled.
    pub grace_seconds: u64,
    pub reaper_enabled: bool,
    pub heartbeat_interval_ms: u64,
    /// Claims that no longer exist in the backend (already closed/reaped).
    pub missing: Vec<SessionKey>,
}

impl Default for PresenceTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl PresenceTracker {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(PresenceState {
                grace_secs: GRACE_DEFAULT_SECS,
                frontend_seen: false,
                windows: HashMap::new(),
                sessions: HashMap::new(),
                last_tick_ms: None,
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PresenceState> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn grace_secs(&self) -> u64 {
        self.lock().grace_secs
    }

    /// Set the grace; returns the normalized value actually applied.
    pub fn set_grace_secs(&self, secs: u64) -> u64 {
        let applied = normalize_grace_secs(secs);
        self.lock().grace_secs = applied;
        applied
    }

    /// True once a heartbeating frontend has been seen and grace is non-zero.
    pub fn reaper_armed(&self) -> bool {
        let state = self.lock();
        state.frontend_seen && state.grace_secs > 0
    }

    /// Record a window heartbeat and refresh its claims.
    pub fn heartbeat(&self, window: &str, claims: &[SessionClaim], now_ms: u64) {
        let mut state = self.lock();
        state.frontend_seen = true;
        state.windows.insert(window.to_string(), now_ms);
        for claim in claims {
            let entry = state.sessions.entry(claim.key()).or_insert(Presence {
                first_seen_ms: now_ms,
                last_claimed_ms: None,
                frontend_session_id: None,
            });
            entry.last_claimed_ms = Some(now_ms);
            if claim.frontend_session_id.is_some() {
                entry.frontend_session_id = claim.frontend_session_id.clone();
            }
        }
    }

    /// Forget a destroyed window. Its claims keep aging toward the grace.
    pub fn window_closed(&self, window: &str) {
        self.lock().windows.remove(window);
    }

    /// Align the tracker with the sessions that really exist. Unknown live
    /// sessions start their grace clock now; vanished ones are dropped.
    /// Returns which of `claimed` no longer exist.
    pub fn reconcile_live(&self, live: &[SessionKey], now_ms: u64) -> Vec<SessionKey> {
        let mut state = self.lock();
        let live_set: std::collections::HashSet<&SessionKey> = live.iter().collect();
        let missing: Vec<SessionKey> = state
            .sessions
            .keys()
            .filter(|key| !live_set.contains(key))
            .cloned()
            .collect();
        state.sessions.retain(|key, _| live_set.contains(key));
        for key in live {
            state.sessions.entry(key.clone()).or_insert(Presence {
                first_seen_ms: now_ms,
                last_claimed_ms: None,
                frontend_session_id: None,
            });
        }
        missing
    }

    /// Stop tracking a session (closed through the normal path).
    pub fn forget(&self, key: &SessionKey) {
        self.lock().sessions.remove(key);
    }

    /// Orphan view for one session.
    pub fn status(&self, key: &SessionKey, now_ms: u64) -> (OrphanStatus, Option<String>) {
        let state = self.lock();
        let grace_ms = state.grace_secs.saturating_mul(1000);
        let armed = state.frontend_seen && state.grace_secs > 0;
        match state.sessions.get(key) {
            None => (OrphanStatus::default(), None),
            Some(presence) => {
                let claimed = presence
                    .last_claimed_ms
                    .is_some_and(|at| now_ms.saturating_sub(at) < ATTACH_TTL_MS);
                let baseline = presence.last_claimed_ms.unwrap_or(presence.first_seen_ms);
                let idle = now_ms.saturating_sub(baseline);
                // Only sessions a frontend once claimed can be reaped; a
                // never-claimed session (legacy frontend, tunnel helper,
                // automation) is left alone.
                let reap_in_secs = if armed && !claimed && presence.last_claimed_ms.is_some() {
                    Some(grace_ms.saturating_sub(idle).div_ceil(1000))
                } else {
                    None
                };
                (
                    OrphanStatus {
                        claimed,
                        unclaimed_for_secs: if claimed { 0 } else { idle / 1000 },
                        reap_in_secs,
                    },
                    presence.frontend_session_id.clone(),
                )
            }
        }
    }

    /// Detect a process suspend / long stall: if the reaper itself was not
    /// ticked for `max_gap_ms`, no frontend could have heartbeated either, so
    /// every clock restarts instead of reaping everything on resume.
    pub fn note_tick(&self, now_ms: u64, max_gap_ms: u64) -> bool {
        let mut state = self.lock();
        let stalled = state
            .last_tick_ms
            .is_some_and(|last| now_ms.saturating_sub(last) > max_gap_ms);
        state.last_tick_ms = Some(now_ms);
        if stalled {
            for presence in state.sessions.values_mut() {
                presence.first_seen_ms = now_ms;
                if presence.last_claimed_ms.is_some() {
                    presence.last_claimed_ms = Some(now_ms);
                }
            }
        }
        stalled
    }

    /// Remove and return every session whose last claim is at least `grace`
    /// old. Never returns a session claimed within the grace, a session no
    /// frontend ever claimed, or anything while the reaper is unarmed.
    pub fn take_expired(&self, now_ms: u64) -> Vec<SessionKey> {
        let mut state = self.lock();
        if !state.frontend_seen || state.grace_secs == 0 {
            return Vec::new();
        }
        let grace_ms = state.grace_secs.saturating_mul(1000);
        let expired: Vec<SessionKey> = state
            .sessions
            .iter()
            .filter(|(_, presence)| {
                presence
                    .last_claimed_ms
                    .is_some_and(|claimed| now_ms.saturating_sub(claimed) >= grace_ms)
            })
            .map(|(key, _)| key.clone())
            .collect();
        for key in &expired {
            state.sessions.remove(key);
        }
        expired
    }
}

/// The process-wide tracker used by the Tauri commands.
pub fn global_presence() -> &'static PresenceTracker {
    static TRACKER: OnceLock<PresenceTracker> = OnceLock::new();
    TRACKER.get_or_init(PresenceTracker::new)
}

/// Monotonic milliseconds since the first call in this process.
pub fn monotonic_ms() -> u64 {
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(max: usize, chunk: usize, enc: SnapshotEncoding) -> SequencedRing {
        SequencedRing::new(
            enc,
            RingLimits {
                max_bytes: max,
                max_chunks: MAX_RING_CHUNKS,
                chunk_bytes: chunk,
            },
        )
    }

    #[test]
    fn push_and_replay_from_start() {
        let mut r = ring(1024, 16, SnapshotEncoding::Utf8);
        r.push(b"hello ");
        r.push(b"world");
        let s = r.snapshot("s", None, None, None);
        assert_eq!(s.data, "hello world");
        assert_eq!((s.sequence_start, s.sequence_end), (0, 11));
        assert!(!s.gap && !s.has_more && !s.generation_changed);
    }

    #[test]
    fn after_sequence_resumes_without_duplicates() {
        let mut r = ring(1024, 4, SnapshotEncoding::Utf8);
        r.push(b"abcdef");
        let first = r.snapshot("s", None, None, Some(4));
        assert_eq!(first.data, "abcd");
        assert!(first.has_more);
        r.push(b"gh");
        let next = r.snapshot("s", Some(first.generation), Some(first.sequence_end), None);
        assert_eq!(next.data, "efgh");
        assert_eq!(next.sequence_start, 4);
        assert!(!next.gap);
        let done = r.snapshot("s", Some(next.generation), Some(next.sequence_end), None);
        assert!(done.data.is_empty() && !done.has_more && !done.gap);
    }

    #[test]
    fn wraparound_evicts_oldest_and_reports_gap() {
        let mut r = ring(10, 4, SnapshotEncoding::Base64);
        for i in 0..25u8 {
            r.push(&[b'a' + (i % 26)]);
        }
        assert_eq!(r.retained_bytes(), 10);
        let range = r.range();
        assert_eq!(range.sequence_end, 25);
        assert_eq!(range.sequence_start, 15);
        assert_eq!(range.dropped_bytes, 15);
        // A stale cursor is flagged and clamped to the retained start.
        let s = r.snapshot("s", None, Some(3), None);
        assert!(s.gap);
        assert_eq!(s.sequence_start, 15);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s.data)
            .unwrap();
        assert_eq!(bytes, b"pqrstuvwxy");
        // A cursor past the end is also a gap.
        assert!(r.snapshot("s", None, Some(999), None).gap);
    }

    #[test]
    fn single_push_larger_than_cap_keeps_newest_tail() {
        let mut r = ring(8, 4, SnapshotEncoding::Base64);
        r.push(b"01234567890123456789");
        assert_eq!(r.retained_bytes(), 8);
        let range = r.range();
        assert_eq!((range.sequence_start, range.sequence_end), (12, 20));
        assert_eq!(range.dropped_bytes, 12);
    }

    #[test]
    fn byte_cap_and_chunk_cap_are_enforced() {
        let mut r = SequencedRing::new(
            SnapshotEncoding::Base64,
            RingLimits {
                max_bytes: 1000,
                max_chunks: 3,
                chunk_bytes: 10,
            },
        );
        for _ in 0..100 {
            r.push(&[7u8; 10]);
        }
        assert!(r.chunk_count() <= 3);
        assert!(r.retained_bytes() <= 30);
        let r2 = {
            let mut r = ring(100, 16, SnapshotEncoding::Base64);
            r.push(&vec![1u8; 100_000]);
            r
        };
        assert_eq!(r2.retained_bytes(), 100);
    }

    #[test]
    fn limits_clamp_to_hard_ceiling() {
        let l = RingLimits::with_max_bytes(usize::MAX);
        assert_eq!(l.max_bytes, MAX_RING_BYTES);
        assert_eq!(RingLimits::with_max_bytes(0).max_bytes, 1);
    }

    #[test]
    fn clear_changes_generation_and_flags_old_cursor() {
        let mut r = ring(64, 8, SnapshotEncoding::Utf8);
        r.push(b"secret");
        let before = r.snapshot("s", None, None, None);
        r.clear();
        assert_eq!(r.retained_bytes(), 0);
        assert_ne!(r.generation(), before.generation);
        let after = r.snapshot(
            "s",
            Some(before.generation),
            Some(before.sequence_end),
            None,
        );
        assert!(after.generation_changed && after.gap);
        assert!(after.data.is_empty());
        assert_eq!(after.sequence_end, 0);
    }

    #[test]
    fn utf8_pages_and_eviction_stay_on_char_boundaries() {
        let mut r = ring(7, 3, SnapshotEncoding::Utf8);
        // 4 + 4 bytes; cap 7 would cut the first emoji mid-character.
        r.push("😀😀".as_bytes());
        let s = r.snapshot("s", None, None, None);
        assert_eq!(s.data, "😀");
        assert!(std::str::from_utf8(s.data.as_bytes()).is_ok());
        assert_eq!(s.sequence_start, 4);
        // Paging through multi-byte text never splits a character.
        let mut r = ring(1024, 8, SnapshotEncoding::Utf8);
        r.push("aé😀z".as_bytes());
        let mut cursor = None;
        let mut text = String::new();
        loop {
            let page = r.snapshot("s", None, cursor, Some(4));
            text.push_str(&page.data);
            cursor = Some(page.sequence_end);
            if !page.has_more {
                break;
            }
        }
        assert_eq!(text, "aé😀z");
        // A cursor inside a character is a gap, not torn text.
        assert!(r.snapshot("s", None, Some(2), None).gap);
    }

    #[test]
    fn eviction_zeroizes_dropped_bytes() {
        let mut r = ring(8, 8, SnapshotEncoding::Base64);
        r.push(b"AAAAAAAA");
        r.push(b"BBBB");
        // The partial trim moved bytes in place and cleared the vacated tail.
        let front = r.chunks.front().expect("front chunk");
        let kept = front.buf.len();
        assert_eq!(kept, 4);
        // Test-only look at bytes that were initialized before the trim.
        let whole = unsafe { std::slice::from_raw_parts(front.buf.as_ptr(), 8) };
        assert!(whole[kept..].iter().all(|b| *b == 0), "tail not zeroized");
        assert_eq!(r.retained_bytes(), 8);
        let s = r.snapshot("s", None, None, None);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s.data)
            .unwrap();
        assert_eq!(bytes, b"AAAABBBB");
    }

    #[test]
    fn push_reports_where_it_landed() {
        let mut r = ring(64, 8, SnapshotEncoding::Utf8);
        let a = r.push(b"abc");
        let b = r.push(b"de");
        assert_eq!((a.sequence_start, a.sequence_end), (0, 3));
        assert_eq!((b.sequence_start, b.sequence_end), (3, 5));
        assert_eq!(a.generation, b.generation);
    }

    #[test]
    fn closed_ring_drops_data_and_ignores_late_pushes() {
        let shared = SharedRing::with_ring(ring(64, 8, SnapshotEncoding::Utf8));
        shared.push(b"secret");
        shared.close();
        assert!(shared.is_closed());
        shared.push(b"late");
        let s = shared.snapshot("s", None, None, None);
        assert!(s.data.is_empty());
        assert_eq!(shared.range().sequence_end, 0);
    }

    #[test]
    fn debug_never_prints_contents() {
        let mut r = ring(64, 8, SnapshotEncoding::Utf8);
        r.push(b"hunter2-password");
        let printed = format!("{r:?}");
        assert!(!printed.contains("hunter2"));
        let shared = SharedRing::with_ring(r);
        assert!(!format!("{shared:?}").contains("hunter2"));
    }

    #[test]
    fn global_budget_bounds_total_and_is_released_on_drop() {
        let budget = RingBudget::new(100);
        let mut a = SequencedRing::with_budget(
            SnapshotEncoding::Base64,
            RingLimits {
                max_bytes: 80,
                max_chunks: 64,
                chunk_bytes: 10,
            },
            Some(budget.clone()),
        );
        let mut b = SequencedRing::with_budget(
            SnapshotEncoding::Base64,
            RingLimits {
                max_bytes: 80,
                max_chunks: 64,
                chunk_bytes: 10,
            },
            Some(budget.clone()),
        );
        for _ in 0..20 {
            a.push(&[1u8; 10]);
            b.push(&[2u8; 10]);
        }
        assert!(budget.used() <= 100 + 10, "used {}", budget.used());
        let (ua, ub) = (a.retained_bytes(), b.retained_bytes());
        assert_eq!(budget.used(), ua + ub);
        drop(a);
        assert_eq!(budget.used(), ub);
        drop(b);
        assert_eq!(budget.used(), 0);
    }

    #[test]
    fn concurrent_push_and_read_keep_invariants() {
        let ring = SharedRing::with_ring(SequencedRing::new(
            SnapshotEncoding::Base64,
            RingLimits {
                max_bytes: 4096,
                max_chunks: 64,
                chunk_bytes: 256,
            },
        ));
        let writer = {
            let ring = ring.clone();
            std::thread::spawn(move || {
                for i in 0..5000u32 {
                    ring.push(&i.to_le_bytes());
                }
            })
        };
        let reader = {
            let ring = ring.clone();
            std::thread::spawn(move || {
                let mut last_end = 0;
                let mut cursor = None;
                let mut generation = None;
                for _ in 0..2000 {
                    let s = ring.snapshot("s", generation, cursor, Some(512));
                    assert!(s.sequence_start <= s.sequence_end);
                    assert!(s.sequence_end >= last_end || s.gap);
                    assert!(s.retained_start <= s.sequence_start);
                    last_end = s.sequence_end;
                    cursor = Some(s.sequence_end);
                    generation = Some(s.generation);
                }
            })
        };
        writer.join().unwrap();
        reader.join().unwrap();
        let range = ring.range();
        assert_eq!(range.sequence_end, 5000 * 4);
        assert!(range.sequence_end - range.sequence_start <= 4096);
    }

    // ── presence / grace ───────────────────────────────────────────────────

    fn claim(proto: &str, id: &str) -> SessionClaim {
        SessionClaim {
            protocol: proto.into(),
            backend_session_id: id.into(),
            frontend_session_id: None,
        }
    }

    #[test]
    fn grace_is_normalized() {
        assert_eq!(normalize_grace_secs(0), 0);
        assert_eq!(normalize_grace_secs(1), GRACE_MIN_SECS);
        assert_eq!(normalize_grace_secs(300), 300);
        assert_eq!(normalize_grace_secs(u64::MAX), GRACE_MAX_SECS);
    }

    #[test]
    fn nothing_is_reaped_before_a_frontend_ever_heartbeats() {
        let t = PresenceTracker::new();
        t.reconcile_live(&[SessionKey::new("telnet", "a")], 0);
        assert!(!t.reaper_armed());
        assert!(t.take_expired(10_000_000).is_empty());
        // Even a session recorded as claimed stays safe until a heartbeat
        // has armed the reaper.
        assert!(t.take_expired(10_000_000).is_empty());
    }

    #[test]
    fn lost_session_is_reaped_only_after_the_grace() {
        let t = PresenceTracker::new();
        t.set_grace_secs(60);
        let key = SessionKey::new("serial", "s1");
        t.heartbeat("main", &[claim("serial", "s1")], 1_000);
        t.reconcile_live(std::slice::from_ref(&key), 1_000);
        // The frontend stops claiming (webview reloaded and dialled anew).
        assert!(t.take_expired(60_999).is_empty());
        assert_eq!(t.take_expired(61_000), vec![key.clone()]);
        // Removed from the tracker once taken.
        assert!(t.take_expired(10_000_000).is_empty());
    }

    #[test]
    fn a_session_no_frontend_ever_claimed_is_never_reaped() {
        let t = PresenceTracker::new();
        t.set_grace_secs(60);
        let key = SessionKey::new("ssh", "tunnel-helper");
        t.heartbeat("main", &[], 0); // a heartbeating frontend exists
        t.reconcile_live(std::slice::from_ref(&key), 0);
        assert!(t.reaper_armed());
        assert!(t.take_expired(100 * 60_000).is_empty());
        assert_eq!(t.status(&key, 100 * 60_000).0.reap_in_secs, None);
    }

    #[test]
    fn claimed_sessions_are_never_reaped() {
        let t = PresenceTracker::new();
        t.set_grace_secs(60);
        let key = SessionKey::new("ssh", "s1");
        let mut now = 0;
        while now < 60_000 * 10 {
            t.heartbeat("main", &[claim("ssh", "s1")], now);
            t.reconcile_live(std::slice::from_ref(&key), now);
            assert!(t.take_expired(now).is_empty(), "reaped at {now}");
            let (status, _) = t.status(&key, now);
            assert!(status.claimed && status.reap_in_secs.is_none());
            now += HEARTBEAT_INTERVAL_MS;
        }
    }

    #[test]
    fn frontend_that_vanishes_leaves_sessions_to_expire_from_last_claim() {
        let t = PresenceTracker::new();
        t.set_grace_secs(60);
        let key = SessionKey::new("rdp", "r1");
        t.heartbeat("main", &[claim("rdp", "r1")], 100_000);
        t.reconcile_live(std::slice::from_ref(&key), 100_000);
        t.window_closed("main");
        let (status, _) = t.status(&key, 130_000);
        assert!(!status.claimed);
        assert_eq!(status.reap_in_secs, Some(30));
        assert!(t.take_expired(159_999).is_empty());
        assert_eq!(t.take_expired(160_000), vec![key]);
    }

    #[test]
    fn reattach_inside_grace_cancels_reaping() {
        let t = PresenceTracker::new();
        t.set_grace_secs(60);
        let key = SessionKey::new("vnc", "v1");
        t.heartbeat("main", &[claim("vnc", "v1")], 0);
        t.reconcile_live(std::slice::from_ref(&key), 0);
        // Webview reloads; reattaches 50 s later, then runs 10 more minutes.
        t.heartbeat("main", &[claim("vnc", "v1")], 50_000);
        assert!(t.take_expired(109_999).is_empty());
        t.heartbeat("main", &[claim("vnc", "v1")], 105_000);
        assert!(t.take_expired(164_999).is_empty());
    }

    #[test]
    fn zero_grace_disables_reaping() {
        let t = PresenceTracker::new();
        t.set_grace_secs(0);
        t.heartbeat("main", &[claim("ssh", "x")], 0);
        t.reconcile_live(&[SessionKey::new("ssh", "x")], 0);
        assert!(!t.reaper_armed());
        assert!(t.take_expired(u64::MAX / 2).is_empty());
    }

    #[test]
    fn suspend_detection_restarts_clocks_instead_of_reaping() {
        let t = PresenceTracker::new();
        t.set_grace_secs(60);
        let key = SessionKey::new("ssh", "s");
        t.heartbeat("main", &[claim("ssh", "s")], 0);
        t.reconcile_live(std::slice::from_ref(&key), 0);
        t.note_tick(15_000, 60_000);
        // The whole process stalls for 10 minutes (laptop sleep).
        assert!(t.note_tick(15_000 + 600_000, 60_000));
        assert!(t.take_expired(15_000 + 600_000).is_empty());
        // Still claimable afterwards; reaped one grace later if nobody returns.
        assert_eq!(t.take_expired(15_000 + 600_000 + 60_000), vec![key]);
    }

    #[test]
    fn vanished_sessions_are_dropped_and_reported() {
        let t = PresenceTracker::new();
        let a = SessionKey::new("ssh", "a");
        t.heartbeat("main", &[claim("ssh", "a")], 0);
        t.reconcile_live(std::slice::from_ref(&a), 0);
        let missing = t.reconcile_live(&[], 1_000);
        assert_eq!(missing, vec![a.clone()]);
        assert_eq!(t.status(&a, 2_000).0, OrphanStatus::default());
    }

    #[test]
    fn frontend_session_id_binding_is_remembered() {
        let t = PresenceTracker::new();
        let key = SessionKey::new("telnet", "t1");
        let mut c = claim("telnet", "t1");
        c.frontend_session_id = Some("tab-9".into());
        t.heartbeat("main", &[c], 0);
        assert_eq!(t.status(&key, 1).1.as_deref(), Some("tab-9"));
        // A later claim without a tab id keeps the binding.
        t.heartbeat("main", &[claim("telnet", "t1")], 5);
        assert_eq!(t.status(&key, 6).1.as_deref(), Some("tab-9"));
    }

    #[test]
    fn descriptor_serializes_camel_case_without_payload() {
        let d = LiveSessionDescriptor {
            protocol: "telnet".into(),
            backend_session_id: "t1".into(),
            frontend_session_id: None,
            connection_id: None,
            title: "router".into(),
            target: "10.0.0.1".into(),
            port: Some(23),
            username: None,
            state: "connected".into(),
            viewer_attached: None,
            created_at: None,
            last_activity_at: None,
            buffer: Some(OutputRange {
                generation: 3,
                sequence_start: 0,
                sequence_end: 9,
                dropped_bytes: 0,
            }),
            orphan: OrphanStatus::default(),
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["backendSessionId"], "t1");
        assert_eq!(v["buffer"]["sequenceEnd"], 9);
        assert_eq!(v["orphan"]["claimed"], false);
    }
}
