//! Bounded SSH terminal replay and recording lifecycle state.
//!
//! Terminal history and active recordings deliberately share one mutex so a
//! disconnect/reconnect hand-off cannot expose half-cleaned session state.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::types::{
    RecordingClosePolicy, RecordingCloseReason, RecordingEntryType, RecordingLimits,
    RecordingState, SessionRecording, SessionRecordingEntry, SessionRecordingMetadata,
};

pub const DEFAULT_RECORDING_MAX_BYTES: u64 = 8 * 1024 * 1024;
pub const DEFAULT_RECORDING_MAX_ENTRIES: usize = 100_000;
pub const DEFAULT_RECORDING_MAX_DURATION_MS: u64 = 8 * 60 * 60 * 1_000;
pub const HARD_RECORDING_MAX_BYTES: u64 = 64 * 1024 * 1024;
pub const HARD_RECORDING_MAX_ENTRIES: usize = 1_000_000;
pub const HARD_RECORDING_MAX_DURATION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MIB: usize = 1024 * 1024;
pub const MAX_TERMINAL_SNAPSHOT_BYTES: usize = 256 * 1024;
const PRESSURE_REPORT_TTL: Duration = Duration::from_secs(30);
const MAX_ACTIVE_RECORDING_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ACTIVE_RECORDING_ENTRIES: usize = 1_000_000;
const MAX_FINALIZED_RECORDINGS: usize = 16;
const MAX_FINALIZED_RECORDING_BYTES: u64 = 64 * 1024 * 1024;
const MAX_FINALIZED_RECORDING_ENTRIES: usize = 1_000_000;

static NEXT_TERMINAL_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalBufferMode {
    #[default]
    Adaptive,
    Fixed,
}

/// Configured bounds; shared fair sharing may override even the minimum.
/// Pressure preserves per-session floors whenever the shared budget permits.
/// Budgets do not eagerly allocate backing storage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(from = "serde_json::Value")]
pub struct TerminalBufferConfig {
    pub mode: TerminalBufferMode,
    #[serde(rename = "minMiB")]
    pub min_mib: usize,
    #[serde(rename = "maxMiB")]
    pub max_mib: usize,
    #[serde(rename = "fixedMiB")]
    pub fixed_mib: usize,
    #[serde(rename = "totalMiB")]
    pub total_mib: usize,
}

impl Default for TerminalBufferConfig {
    fn default() -> Self {
        Self {
            mode: TerminalBufferMode::Adaptive,
            min_mib: 1,
            max_mib: 100,
            fixed_mib: 50,
            total_mib: 256,
        }
    }
}

impl TerminalBufferConfig {
    fn normalized(mut self) -> Self {
        self.max_mib = self.max_mib.clamp(1, 100);
        self.min_mib = self.min_mib.clamp(1, self.max_mib);
        self.fixed_mib = self.fixed_mib.clamp(1, 100);
        self.total_mib = self.total_mib.clamp(16, 1024);
        self
    }
}

impl From<serde_json::Value> for TerminalBufferConfig {
    fn from(value: serde_json::Value) -> Self {
        let defaults = Self::default();
        // Normalize negative, fractional and out-of-range JSON numbers before
        // conversion to usize. Missing/null/wrong-type settings use defaults.
        let number = |key: &str, default: usize, low: usize, high: usize| {
            value
                .get(key)
                .and_then(serde_json::Value::as_f64)
                .filter(|number| number.is_finite())
                .map(|number| number.clamp(low as f64, high as f64) as usize)
                .unwrap_or(default)
        };
        Self {
            mode: if value.get("mode").and_then(serde_json::Value::as_str) == Some("fixed") {
                TerminalBufferMode::Fixed
            } else {
                TerminalBufferMode::Adaptive
            },
            min_mib: number("minMiB", defaults.min_mib, 1, 100),
            max_mib: number("maxMiB", defaults.max_mib, 1, 100),
            fixed_mib: number("fixedMiB", defaults.fixed_mib, 1, 100),
            total_mib: number("totalMiB", defaults.total_mib, 16, 1024),
        }
        .normalized()
    }
}

/// `pressure` is the strongest emergency signal. Warning/critical/pressure
/// divide shared and per-session ceilings by 2/4/8, including in fixed mode,
/// but only shared safety limits can override the per-session floor.
#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum TerminalMemoryPressure {
    #[default]
    Normal,
    Warning,
    Critical,
    Pressure,
}

impl TerminalMemoryPressure {
    fn divisor(self) -> usize {
        match self {
            Self::Normal => 1,
            Self::Warning => 2,
            Self::Critical => 4,
            Self::Pressure => 8,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalBufferDiagnostics {
    pub config: TerminalBufferConfig,
    /// Maximum shared replay allocation budget under current pressure.
    pub effective_cap_bytes: usize,
    pub per_session_cap_bytes: usize,
    /// Sum of current session budgets (adaptive budgets start at the floor).
    pub budget_bytes: usize,
    pub retained_bytes: usize,
    pub session_count: usize,
    pub pressure: TerminalMemoryPressure,
}

fn next_terminal_generation() -> u64 {
    loop {
        let generation = NEXT_TERMINAL_GENERATION.fetch_add(1, Ordering::Relaxed);
        if generation != 0 {
            return generation;
        }
    }
}

impl Default for RecordingLimits {
    fn default() -> Self {
        Self {
            max_bytes: DEFAULT_RECORDING_MAX_BYTES,
            max_entries: DEFAULT_RECORDING_MAX_ENTRIES,
            max_duration_ms: DEFAULT_RECORDING_MAX_DURATION_MS,
        }
    }
}

impl RecordingLimits {
    pub fn from_options(
        max_bytes: Option<u64>,
        max_entries: Option<usize>,
        max_duration_ms: Option<u64>,
    ) -> Result<Self, String> {
        let limits = Self {
            max_bytes: max_bytes.unwrap_or(DEFAULT_RECORDING_MAX_BYTES),
            max_entries: max_entries.unwrap_or(DEFAULT_RECORDING_MAX_ENTRIES),
            max_duration_ms: max_duration_ms.unwrap_or(DEFAULT_RECORDING_MAX_DURATION_MS),
        };
        limits.validate()?;
        Ok(limits)
    }

    pub fn validate(&self) -> Result<(), String> {
        if !(1..=HARD_RECORDING_MAX_BYTES).contains(&self.max_bytes) {
            return Err(format!(
                "Recording maxBytes must be between 1 and {HARD_RECORDING_MAX_BYTES}"
            ));
        }
        if !(1..=HARD_RECORDING_MAX_ENTRIES).contains(&self.max_entries) {
            return Err(format!(
                "Recording maxEntries must be between 1 and {HARD_RECORDING_MAX_ENTRIES}"
            ));
        }
        if !(1..=HARD_RECORDING_MAX_DURATION_MS).contains(&self.max_duration_ms) {
            return Err(format!(
                "Recording maxDurationMs must be between 1 and {HARD_RECORDING_MAX_DURATION_MS}"
            ));
        }
        Ok(())
    }
}

/// Stateful UTF-8 decoder for arbitrary SSH read boundaries.
///
/// Valid incomplete suffixes are retained until the next read. Invalid byte
/// sequences produce one replacement character and decoding continues.
#[derive(Debug, Default)]
pub struct StreamingUtf8Decoder {
    pending: Vec<u8>,
}

impl StreamingUtf8Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> String {
        let mut combined = std::mem::take(&mut self.pending);
        combined.extend_from_slice(bytes);
        let mut decoded = String::new();
        let mut cursor = 0usize;

        while cursor < combined.len() {
            match std::str::from_utf8(&combined[cursor..]) {
                Ok(valid) => {
                    decoded.push_str(valid);
                    cursor = combined.len();
                }
                Err(error) => {
                    let valid_end = cursor + error.valid_up_to();
                    // SAFETY: `valid_up_to` guarantees this prefix is UTF-8.
                    decoded.push_str(
                        std::str::from_utf8(&combined[cursor..valid_end])
                            .expect("valid_up_to prefix must be UTF-8"),
                    );
                    match error.error_len() {
                        Some(invalid_len) => {
                            decoded.push('\u{fffd}');
                            cursor = valid_end.saturating_add(invalid_len);
                        }
                        None => {
                            self.pending.extend_from_slice(&combined[valid_end..]);
                            cursor = combined.len();
                        }
                    }
                }
            }
        }

        decoded
    }

    /// Flush an incomplete terminal suffix when the transport closes.
    pub fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let pending = std::mem::take(&mut self.pending);
        String::from_utf8_lossy(&pending).into_owned()
    }

    #[cfg(test)]
    fn pending_len(&self) -> usize {
        self.pending.len()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalAppendMetadata {
    pub generation: u64,
    pub sequence_start: u64,
    pub sequence_end: u64,
    pub retained_start: u64,
    /// Cumulative history eviction, never a count of lost live output.
    pub dropped_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalBufferSnapshot {
    pub session_id: String,
    pub data: String,
    pub generation: u64,
    pub sequence_start: u64,
    pub sequence_end: u64,
    pub retained_start: u64,
    pub dropped_bytes: u64,
    pub gap: bool,
    pub generation_changed: bool,
    #[serde(default)]
    pub has_more: bool,
}

#[derive(Debug)]
struct TerminalReplayBuffer {
    generation: u64,
    bytes: VecDeque<u8>,
    max_bytes: usize,
    sequence_end: u64,
    retained_start: u64,
    dropped_bytes: u64,
}

impl TerminalReplayBuffer {
    fn new(max_bytes: usize) -> Self {
        Self {
            generation: next_terminal_generation(),
            // Thousands of connected-but-idle sessions must not reserve their
            // full fair share before receiving output.
            bytes: VecDeque::new(),
            max_bytes,
            sequence_end: 0,
            retained_start: 0,
            dropped_bytes: 0,
        }
    }

    fn append(&mut self, data: &str) -> TerminalAppendMetadata {
        let sequence_start = self.sequence_end;
        self.sequence_end = self
            .sequence_end
            .checked_add(data.len() as u64)
            .expect("terminal sequence counter exhausted");
        let incoming = data.as_bytes();
        let evicted = if incoming.len() >= self.max_bytes {
            let existing = self.bytes.len() as u64;
            self.bytes.clear();
            let mut offset = incoming.len().saturating_sub(self.max_bytes);
            while incoming
                .get(offset)
                .is_some_and(|byte| (*byte & 0b1100_0000) == 0b1000_0000)
            {
                offset += 1;
            }
            self.reserve_for(incoming.len() - offset);
            self.bytes.extend(&incoming[offset..]);
            existing.saturating_add(offset as u64)
        } else {
            let required = self
                .bytes
                .len()
                .saturating_add(incoming.len())
                .saturating_sub(self.max_bytes);
            let evicted = self.evict_front(required);
            self.reserve_for(incoming.len());
            self.bytes.extend(incoming);
            evicted
        };

        self.retained_start = self.retained_start.saturating_add(evicted);
        self.dropped_bytes = self.dropped_bytes.saturating_add(evicted);

        TerminalAppendMetadata {
            generation: self.generation,
            sequence_start,
            sequence_end: self.sequence_end,
            retained_start: self.retained_start,
            dropped_bytes: self.dropped_bytes,
        }
    }

    fn evict_front(&mut self, minimum: usize) -> u64 {
        let count = minimum.min(self.bytes.len());
        // Dropping a prefix of a byte deque advances its head without moving
        // the remaining history or popping millions of individual bytes.
        self.bytes.drain(..count);
        let mut evicted = count as u64;
        // If the byte cap cut through a code point, evict the incomplete tail
        // too. A UTF-8 continuation byte can never begin a valid replay.
        while self
            .bytes
            .front()
            .is_some_and(|byte| (*byte & 0b1100_0000) == 0b1000_0000)
        {
            self.bytes.pop_front();
            evicted += 1;
        }
        evicted
    }

    fn set_max_bytes(&mut self, max_bytes: usize) {
        if self.max_bytes == max_bytes {
            return;
        }
        self.max_bytes = max_bytes;
        let evicted = self.evict_front(self.bytes.len().saturating_sub(max_bytes));
        self.retained_start = self.retained_start.saturating_add(evicted);
        self.dropped_bytes = self.dropped_bytes.saturating_add(evicted);
        if self.bytes.capacity() > max_bytes {
            self.bytes.shrink_to(max_bytes);
        }
    }

    fn reserve_for(&mut self, additional: usize) {
        let needed = self.bytes.len().saturating_add(additional);
        if needed > self.bytes.capacity() {
            // Geometric growth stays inside the session budget, unlike the
            // deque's default power-of-two reserve above e.g. a 100 MiB cap.
            let target = needed
                .max(self.bytes.capacity().saturating_mul(2))
                .min(self.max_bytes);
            self.bytes.reserve_exact(target - self.bytes.len());
        }
    }

    fn is_char_boundary(&self, offset: usize) -> bool {
        self.bytes
            .get(offset)
            .is_none_or(|byte| (*byte & 0b1100_0000) != 0b1000_0000)
    }

    fn text_range(&self, start: usize, end: usize) -> String {
        let (first, second) = self.bytes.as_slices();
        let mut bytes = Vec::with_capacity(end - start);
        if start < first.len() {
            bytes.extend_from_slice(&first[start..end.min(first.len())]);
        }
        if end > first.len() {
            bytes.extend_from_slice(&second[start.saturating_sub(first.len())..end - first.len()]);
        }
        String::from_utf8(bytes).expect("terminal replay buffer must contain valid UTF-8")
    }

    /// Preserve the historical 1 MiB automation lookup window without copying
    /// a potentially 100 MiB retained history.
    fn text(&self) -> String {
        self.tail_text(MIB)
    }

    fn tail_text(&self, max_bytes: usize) -> String {
        let mut start = self.bytes.len().saturating_sub(max_bytes);
        while !self.is_char_boundary(start) {
            start += 1;
        }
        self.text_range(start, self.bytes.len())
    }

    #[cfg(test)]
    fn snapshot(
        &self,
        session_id: &str,
        requested_generation: Option<u64>,
        after_sequence: Option<u64>,
    ) -> TerminalBufferSnapshot {
        self.snapshot_page(session_id, requested_generation, after_sequence, None)
    }

    fn snapshot_page(
        &self,
        session_id: &str,
        requested_generation: Option<u64>,
        after_sequence: Option<u64>,
        max_bytes: Option<usize>,
    ) -> TerminalBufferSnapshot {
        let generation_changed = requested_generation.is_some_and(|value| value != self.generation);
        let mut gap = generation_changed;
        let mut sequence_start = self.retained_start;

        if !generation_changed {
            if let Some(after) = after_sequence {
                if after < self.retained_start || after > self.sequence_end {
                    gap = true;
                } else {
                    let offset = (after - self.retained_start) as usize;
                    if self.is_char_boundary(offset) {
                        sequence_start = after;
                    } else {
                        // A cursor supplied by this API always lands on a UTF-8
                        // boundary. Treat arbitrary/malformed cursors as gaps.
                        gap = true;
                    }
                }
            }
        }

        // Four bytes is the minimum page budget so even an emoji makes
        // progress. Both endpoints are UTF-8 boundaries, including at wrap.
        let page_bytes = max_bytes
            .unwrap_or(MAX_TERMINAL_SNAPSHOT_BYTES)
            .clamp(4, MAX_TERMINAL_SNAPSHOT_BYTES);
        let start = (sequence_start - self.retained_start) as usize;
        let mut end = start.saturating_add(page_bytes).min(self.bytes.len());
        while !self.is_char_boundary(end) {
            end -= 1;
        }
        let data = self.text_range(start, end);
        let sequence_end = sequence_start + data.len() as u64;

        TerminalBufferSnapshot {
            session_id: session_id.to_string(),
            data,
            generation: self.generation,
            sequence_start,
            sequence_end,
            retained_start: self.retained_start,
            dropped_bytes: self.dropped_bytes,
            gap,
            generation_changed,
            has_more: sequence_end < self.sequence_end,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionOutputCleanup {
    pub terminal_buffer_removed: bool,
    pub recording_discarded: bool,
    pub recording_finalized: bool,
}

#[derive(Debug, Clone, Copy)]
struct OutputStateLimits {
    terminal_replay_bytes: usize,
    active_recording_bytes: u64,
    active_recording_entries: usize,
    finalized_recordings: usize,
    finalized_recording_bytes: u64,
    finalized_recording_entries: usize,
}

impl Default for OutputStateLimits {
    fn default() -> Self {
        Self {
            terminal_replay_bytes: TerminalBufferConfig::default().total_mib * MIB,
            active_recording_bytes: MAX_ACTIVE_RECORDING_BYTES,
            active_recording_entries: MAX_ACTIVE_RECORDING_ENTRIES,
            finalized_recordings: MAX_FINALIZED_RECORDINGS,
            finalized_recording_bytes: MAX_FINALIZED_RECORDING_BYTES,
            finalized_recording_entries: MAX_FINALIZED_RECORDING_ENTRIES,
        }
    }
}

#[derive(Debug)]
struct FinalizedRecordingState {
    recording: SessionRecording,
    estimated_bytes: u64,
    entries: usize,
}

fn estimated_recording_base_bytes(session_id: &str, host: &str, username: &str) -> u64 {
    (std::mem::size_of::<RecordingState>() as u64)
        // Active map key plus finalized metadata/session key.
        .saturating_add((session_id.len() as u64).saturating_mul(2))
        .saturating_add(host.len() as u64)
        .saturating_add(username.len() as u64)
}

fn estimated_recording_entry_bytes(entry: &SessionRecordingEntry) -> u64 {
    // Vec growth can reserve roughly twice the live element count. Charging
    // two structs per entry conservatively covers that allocation headroom;
    // every variant, including a zero-data resize, therefore consumes budget.
    (std::mem::size_of::<SessionRecordingEntry>() as u64)
        .saturating_mul(2)
        .saturating_add(entry.data.len() as u64)
}

struct SessionOutputStateRegistry {
    limits: OutputStateLimits,
    terminal_config: TerminalBufferConfig,
    pressure: TerminalMemoryPressure,
    pressure_reports: HashMap<String, (TerminalMemoryPressure, Instant)>,
    next_pressure_expiry: Option<Instant>,
    terminal_buffers: HashMap<String, TerminalReplayBuffer>,
    terminal_bytes: usize,
    active_recordings: HashMap<String, RecordingState>,
    active_recording_bytes: u64,
    active_recording_entries: usize,
    finalized_recordings: HashMap<String, FinalizedRecordingState>,
    finalized_order: VecDeque<String>,
    finalized_bytes: u64,
    finalized_entries: usize,
}

impl Default for SessionOutputStateRegistry {
    fn default() -> Self {
        Self::with_limits(OutputStateLimits::default())
    }
}

impl SessionOutputStateRegistry {
    fn with_limits(limits: OutputStateLimits) -> Self {
        Self {
            limits,
            terminal_config: TerminalBufferConfig::default(),
            pressure: TerminalMemoryPressure::Normal,
            pressure_reports: HashMap::new(),
            next_pressure_expiry: None,
            terminal_buffers: HashMap::new(),
            terminal_bytes: 0,
            active_recordings: HashMap::new(),
            active_recording_bytes: 0,
            active_recording_entries: 0,
            finalized_recordings: HashMap::new(),
            finalized_order: VecDeque::new(),
            finalized_bytes: 0,
            finalized_entries: 0,
        }
    }

    fn ensure_terminal_buffer(&mut self, session_id: &str) -> &mut TerminalReplayBuffer {
        if !self.terminal_buffers.contains_key(session_id) {
            self.terminal_buffers.insert(
                session_id.to_string(),
                TerminalReplayBuffer::new(self.terminal_config.min_mib * MIB),
            );
            self.rebalance_terminal_budgets();
        }
        self.terminal_buffers
            .get_mut(session_id)
            .expect("terminal buffer inserted above")
    }

    fn append_terminal_output(&mut self, session_id: &str, data: &str) -> TerminalAppendMetadata {
        let before = self.ensure_terminal_buffer(session_id).bytes.len();
        let ceiling = self.per_session_cap();
        let buffer = self
            .terminal_buffers
            .get_mut(session_id)
            .expect("terminal buffer ensured above");
        if self.terminal_config.mode == TerminalBufferMode::Adaptive
            && self.pressure == TerminalMemoryPressure::Normal
            && before.saturating_add(data.len()) > buffer.max_bytes
        {
            let demanded = before.saturating_add(data.len());
            buffer.set_max_bytes(
                demanded
                    .max(buffer.max_bytes.saturating_mul(2))
                    .min(ceiling),
            );
        }
        let metadata = buffer.append(data);
        self.terminal_bytes = self
            .terminal_bytes
            .saturating_sub(before)
            .saturating_add(buffer.bytes.len());
        debug_assert!(self.terminal_bytes <= self.effective_terminal_cap());
        metadata
    }

    fn effective_terminal_cap(&self) -> usize {
        self.limits.terminal_replay_bytes / self.pressure.divisor()
    }

    fn per_session_cap(&self) -> usize {
        let configured = match self.terminal_config.mode {
            TerminalBufferMode::Adaptive => self.terminal_config.max_mib,
            TerminalBufferMode::Fixed => self.terminal_config.fixed_mib,
        } * MIB
            / self.pressure.divisor();
        configured
            .max(self.configured_terminal_floor())
            .min(self.effective_terminal_cap() / self.terminal_buffers.len().max(1))
    }

    fn configured_terminal_floor(&self) -> usize {
        match self.terminal_config.mode {
            TerminalBufferMode::Adaptive => self.terminal_config.min_mib * MIB,
            TerminalBufferMode::Fixed => MIB,
        }
    }

    fn rebalance_terminal_budgets(&mut self) {
        let count = self.terminal_buffers.len();
        if count == 0 {
            self.terminal_bytes = 0;
            return;
        }
        // Leave at most count-1 remainder bytes unused instead of sorting and
        // cloning all session IDs on every join/leave. Idle sessions count too.
        let ceiling = self.per_session_cap();
        let floor = self.configured_terminal_floor().min(ceiling);
        for buffer in self.terminal_buffers.values_mut() {
            let max_bytes = match self.terminal_config.mode {
                TerminalBufferMode::Adaptive => buffer.max_bytes.clamp(floor, ceiling),
                TerminalBufferMode::Fixed => ceiling,
            };
            buffer.set_max_bytes(max_bytes);
        }
        self.terminal_bytes = self
            .terminal_buffers
            .values()
            .map(|buffer| buffer.bytes.len())
            .sum();
        debug_assert!(self.terminal_bytes <= self.effective_terminal_cap());
    }

    fn refresh_pressure(&mut self, now: Instant) {
        self.pressure_reports.retain(|_, (_, reported)| {
            now.saturating_duration_since(*reported) < PRESSURE_REPORT_TTL
        });
        self.next_pressure_expiry = self
            .pressure_reports
            .values()
            .map(|(_, reported)| *reported + PRESSURE_REPORT_TTL)
            .min();
        let pressure = self
            .pressure_reports
            .values()
            .map(|(pressure, _)| *pressure)
            .max()
            .unwrap_or_default();
        if pressure != self.pressure {
            let previous_pressure = self.pressure;
            self.pressure = pressure;
            if pressure > previous_pressure
                && self.terminal_config.mode == TerminalBufferMode::Adaptive
            {
                let ceiling = self.per_session_cap();
                let floor = self.configured_terminal_floor().min(ceiling);
                for buffer in self.terminal_buffers.values_mut() {
                    buffer.set_max_bytes(
                        (buffer.max_bytes * previous_pressure.divisor() / pressure.divisor())
                            .clamp(floor, ceiling),
                    );
                }
            }
            self.rebalance_terminal_budgets();
        }
    }

    fn expire_pressure(&mut self, now: Instant) {
        // Hot output/snapshot operations only scan reports when one is due.
        if self
            .next_pressure_expiry
            .is_some_and(|expiry| now >= expiry)
        {
            self.refresh_pressure(now);
        }
    }

    fn configure_terminal_buffering(
        &mut self,
        window_label: &str,
        config: Option<TerminalBufferConfig>,
        pressure: TerminalMemoryPressure,
        now: Instant,
    ) -> Result<TerminalBufferDiagnostics, String> {
        if config.is_some() && window_label != "main" {
            return Err("Only the main window can configure global terminal buffering".to_string());
        }
        if let Some(config) = config {
            self.terminal_config = config.normalized();
            self.limits.terminal_replay_bytes = self.terminal_config.total_mib * MIB;
        }
        self.pressure_reports
            .insert(window_label.to_string(), (pressure, now));
        self.refresh_pressure(now);
        self.rebalance_terminal_budgets();
        Ok(self.terminal_diagnostics())
    }

    fn terminal_diagnostics(&self) -> TerminalBufferDiagnostics {
        TerminalBufferDiagnostics {
            config: self.terminal_config.clone(),
            effective_cap_bytes: self.effective_terminal_cap(),
            per_session_cap_bytes: self.per_session_cap(),
            budget_bytes: self
                .terminal_buffers
                .values()
                .map(|buffer| buffer.max_bytes)
                .sum(),
            retained_bytes: self.terminal_bytes,
            session_count: self.terminal_buffers.len(),
            pressure: self.pressure,
        }
    }

    fn remove_terminal_buffer(&mut self, session_id: &str) -> bool {
        let Some(buffer) = self.terminal_buffers.remove(session_id) else {
            return false;
        };
        self.terminal_bytes = self.terminal_bytes.saturating_sub(buffer.bytes.len());
        self.rebalance_terminal_budgets();
        true
    }

    fn clear_terminal_buffer(&mut self, session_id: &str) -> bool {
        let Some(buffer) = self.terminal_buffers.get_mut(session_id) else {
            return false;
        };
        self.terminal_bytes = self.terminal_bytes.saturating_sub(buffer.bytes.len());
        // Clearing history does not disconnect the shell. Keep its fair-share
        // slot and reset the generation so in-flight cursors detect the reset.
        *buffer = TerminalReplayBuffer::new(buffer.max_bytes);
        true
    }

    fn empty_snapshot(
        session_id: &str,
        requested_generation: Option<u64>,
        after_sequence: Option<u64>,
    ) -> TerminalBufferSnapshot {
        let generation_changed = requested_generation.is_some_and(|value| value != 0);
        TerminalBufferSnapshot {
            session_id: session_id.to_string(),
            data: String::new(),
            generation: 0,
            sequence_start: 0,
            sequence_end: 0,
            retained_start: 0,
            dropped_bytes: 0,
            gap: generation_changed || after_sequence.is_some_and(|value| value != 0),
            generation_changed,
            has_more: false,
        }
    }

    fn terminal_snapshot(
        &self,
        session_id: &str,
        requested_generation: Option<u64>,
        after_sequence: Option<u64>,
    ) -> TerminalBufferSnapshot {
        self.terminal_snapshot_page(session_id, requested_generation, after_sequence, None)
    }

    fn terminal_snapshot_page(
        &self,
        session_id: &str,
        requested_generation: Option<u64>,
        after_sequence: Option<u64>,
        max_bytes: Option<usize>,
    ) -> TerminalBufferSnapshot {
        self.terminal_buffers.get(session_id).map_or_else(
            || Self::empty_snapshot(session_id, requested_generation, after_sequence),
            |buffer| {
                buffer.snapshot_page(session_id, requested_generation, after_sequence, max_bytes)
            },
        )
    }

    fn terminal_text(&self, session_id: &str) -> String {
        self.terminal_buffers
            .get(session_id)
            .map(TerminalReplayBuffer::text)
            .unwrap_or_default()
    }

    fn terminal_legacy_text(&self, session_id: &str) -> String {
        self.terminal_buffers
            .get(session_id)
            .map(|buffer| buffer.tail_text(MAX_TERMINAL_SNAPSHOT_BYTES))
            .unwrap_or_default()
    }

    #[allow(clippy::too_many_arguments)]
    fn start_recording(
        &mut self,
        session_id: &str,
        host: String,
        username: String,
        cols: u32,
        rows: u32,
        record_input: bool,
        limits: RecordingLimits,
        close_policy: RecordingClosePolicy,
    ) -> Result<(), String> {
        limits.validate()?;
        if self.active_recordings.contains_key(session_id) {
            return Err("Recording already active for this session".to_string());
        }
        let estimated_bytes = estimated_recording_base_bytes(session_id, &host, &username);
        let next_active_bytes = self
            .active_recording_bytes
            .checked_add(estimated_bytes)
            .ok_or_else(|| "Active recording memory counter exhausted".to_string())?;
        if next_active_bytes > self.limits.active_recording_bytes {
            return Err(format!(
                "Active recording memory budget exceeded ({} bytes)",
                self.limits.active_recording_bytes
            ));
        }
        self.remove_finalized(session_id);
        self.active_recordings.insert(
            session_id.to_string(),
            RecordingState {
                start_time: Instant::now(),
                start_utc: Utc::now(),
                host,
                username,
                cols,
                rows,
                entries: Vec::new(),
                record_input,
                captured_bytes: 0,
                estimated_bytes,
                dropped_entries: 0,
                dropped_bytes: 0,
                limit_reached: false,
                limits,
                close_policy,
            },
        );
        self.active_recording_bytes = next_active_bytes;
        Ok(())
    }

    fn record_entry(&mut self, session_id: &str, entry: SessionRecordingEntry) {
        let Some(state) = self.active_recordings.get_mut(session_id) else {
            return;
        };
        let entry_bytes = entry.data.len() as u64;
        let estimated_entry_bytes = estimated_recording_entry_bytes(&entry);
        let duration_exceeded =
            state.start_time.elapsed().as_millis() as u64 >= state.limits.max_duration_ms;
        let entry_limit_reached = state.entries.len() >= state.limits.max_entries;
        let byte_limit_reached = match state.captured_bytes.checked_add(entry_bytes) {
            Some(total) => total > state.limits.max_bytes,
            None => true,
        };
        let aggregate_entry_limit_reached =
            self.active_recording_entries >= self.limits.active_recording_entries;
        let aggregate_byte_limit_reached = match self
            .active_recording_bytes
            .checked_add(estimated_entry_bytes)
        {
            Some(total) => total > self.limits.active_recording_bytes,
            None => true,
        };

        if duration_exceeded
            || entry_limit_reached
            || byte_limit_reached
            || aggregate_entry_limit_reached
            || aggregate_byte_limit_reached
        {
            state.limit_reached = true;
            state.dropped_entries = state.dropped_entries.saturating_add(1);
            state.dropped_bytes = state.dropped_bytes.saturating_add(entry_bytes);
            return;
        }

        state.captured_bytes += entry_bytes;
        state.estimated_bytes = state.estimated_bytes.saturating_add(estimated_entry_bytes);
        self.active_recording_bytes = self
            .active_recording_bytes
            .saturating_add(estimated_entry_bytes);
        self.active_recording_entries = self.active_recording_entries.saturating_add(1);
        if let RecordingEntryType::Resize { cols, rows } = &entry.entry_type {
            state.cols = *cols;
            state.rows = *rows;
        }
        state.entries.push(entry);
    }

    fn finalize_recording(
        session_id: &str,
        state: RecordingState,
        close_reason: RecordingCloseReason,
    ) -> SessionRecording {
        let duration_ms = state.start_time.elapsed().as_millis() as u64;
        SessionRecording {
            metadata: SessionRecordingMetadata {
                session_id: session_id.to_string(),
                start_time: state.start_utc,
                end_time: Some(Utc::now()),
                host: state.host,
                username: state.username,
                cols: state.cols,
                rows: state.rows,
                duration_ms,
                entry_count: state.entries.len(),
                captured_bytes: state.captured_bytes,
                estimated_bytes: state.estimated_bytes,
                dropped_entries: state.dropped_entries,
                dropped_bytes: state.dropped_bytes,
                truncated: state.limit_reached,
                close_reason: Some(close_reason),
            },
            entries: state.entries,
        }
    }

    fn active_recording_metadata(&self, session_id: &str) -> Option<SessionRecordingMetadata> {
        self.active_recordings
            .get(session_id)
            .map(|state| SessionRecordingMetadata {
                session_id: session_id.to_string(),
                start_time: state.start_utc,
                end_time: None,
                host: state.host.clone(),
                username: state.username.clone(),
                cols: state.cols,
                rows: state.rows,
                duration_ms: state.start_time.elapsed().as_millis() as u64,
                entry_count: state.entries.len(),
                captured_bytes: state.captured_bytes,
                estimated_bytes: state.estimated_bytes,
                dropped_entries: state.dropped_entries,
                dropped_bytes: state.dropped_bytes,
                truncated: state.limit_reached,
                close_reason: None,
            })
    }

    fn store_finalized(&mut self, session_id: &str, recording: SessionRecording) -> bool {
        self.remove_finalized(session_id);
        let estimated_bytes = recording.metadata.estimated_bytes;
        let entries = recording.entries.len();
        self.finalized_bytes = self.finalized_bytes.saturating_add(estimated_bytes);
        self.finalized_entries = self.finalized_entries.saturating_add(entries);
        self.finalized_order.push_back(session_id.to_string());
        self.finalized_recordings.insert(
            session_id.to_string(),
            FinalizedRecordingState {
                recording,
                estimated_bytes,
                entries,
            },
        );

        while self.finalized_recordings.len() > self.limits.finalized_recordings
            || self.finalized_bytes > self.limits.finalized_recording_bytes
            || self.finalized_entries > self.limits.finalized_recording_entries
        {
            let Some(oldest) = self.finalized_order.pop_front() else {
                break;
            };
            if let Some(evicted) = self.finalized_recordings.remove(&oldest) {
                self.finalized_bytes = self.finalized_bytes.saturating_sub(evicted.estimated_bytes);
                self.finalized_entries = self.finalized_entries.saturating_sub(evicted.entries);
            }
        }
        self.finalized_recordings.contains_key(session_id)
    }

    fn remove_finalized(&mut self, session_id: &str) -> Option<SessionRecording> {
        let state = self.finalized_recordings.remove(session_id)?;
        self.finalized_bytes = self.finalized_bytes.saturating_sub(state.estimated_bytes);
        self.finalized_entries = self.finalized_entries.saturating_sub(state.entries);
        self.finalized_order.retain(|id| id != session_id);
        Some(state.recording)
    }

    fn remove_active_recording(&mut self, session_id: &str) -> Option<RecordingState> {
        let state = self.active_recordings.remove(session_id)?;
        self.active_recording_bytes = self
            .active_recording_bytes
            .saturating_sub(state.estimated_bytes);
        self.active_recording_entries = self
            .active_recording_entries
            .saturating_sub(state.entries.len());
        Some(state)
    }

    fn stop_recording(&mut self, session_id: &str) -> Result<SessionRecording, String> {
        if let Some(state) = self.remove_active_recording(session_id) {
            return Ok(Self::finalize_recording(
                session_id,
                state,
                RecordingCloseReason::Manual,
            ));
        }
        self.remove_finalized(session_id)
            .ok_or_else(|| "No active or finalized recording for this session".to_string())
    }

    fn cleanup_session(&mut self, session_id: &str) -> SessionOutputCleanup {
        let terminal_buffer_removed = self.remove_terminal_buffer(session_id);
        let mut recording_discarded = false;
        let mut recording_finalized = false;
        if let Some(recording) = self.remove_active_recording(session_id) {
            match recording.close_policy {
                RecordingClosePolicy::Discard => recording_discarded = true,
                RecordingClosePolicy::Finalize => {
                    let finalized = Self::finalize_recording(
                        session_id,
                        recording,
                        RecordingCloseReason::Disconnect,
                    );
                    recording_finalized = self.store_finalized(session_id, finalized);
                    recording_discarded = !recording_finalized;
                }
            }
        }
        SessionOutputCleanup {
            terminal_buffer_removed,
            recording_discarded,
            recording_finalized,
        }
    }

    fn transfer_session(
        &mut self,
        old_session_id: &str,
        new_session_id: &str,
    ) -> Result<(), String> {
        if old_session_id == new_session_id {
            return Ok(());
        }
        if self.terminal_buffers.contains_key(new_session_id)
            || self.active_recordings.contains_key(new_session_id)
            || self.finalized_recordings.contains_key(new_session_id)
        {
            return Err(format!(
                "Output state already exists for destination session {new_session_id}"
            ));
        }
        let adjusted_recording_estimate = self.active_recordings.get(old_session_id).map(|state| {
            let old_id_bytes = (old_session_id.len() as u64).saturating_mul(2);
            let new_id_bytes = (new_session_id.len() as u64).saturating_mul(2);
            state
                .estimated_bytes
                .saturating_sub(old_id_bytes)
                .saturating_add(new_id_bytes)
        });
        if let Some(adjusted) = adjusted_recording_estimate {
            let next_active_bytes = self
                .active_recording_bytes
                .saturating_sub(
                    self.active_recordings
                        .get(old_session_id)
                        .map(|state| state.estimated_bytes)
                        .unwrap_or_default(),
                )
                .saturating_add(adjusted);
            if next_active_bytes > self.limits.active_recording_bytes {
                return Err(format!(
                    "Transferring recording state would exceed the active recording memory budget ({} bytes)",
                    self.limits.active_recording_bytes
                ));
            }
        }
        if let Some(buffer) = self.terminal_buffers.remove(old_session_id) {
            self.terminal_buffers
                .insert(new_session_id.to_string(), buffer);
        }
        if let Some(mut recording) = self.active_recordings.remove(old_session_id) {
            let previous_estimate = recording.estimated_bytes;
            recording.estimated_bytes = adjusted_recording_estimate.unwrap_or(previous_estimate);
            self.active_recording_bytes = self
                .active_recording_bytes
                .saturating_sub(previous_estimate)
                .saturating_add(recording.estimated_bytes);
            self.active_recordings
                .insert(new_session_id.to_string(), recording);
        }
        self.rebalance_terminal_budgets();
        Ok(())
    }

    #[cfg(test)]
    fn counts(&self) -> OutputStateCounts {
        OutputStateCounts {
            terminal_buffers: self.terminal_buffers.len(),
            terminal_bytes: self.terminal_bytes,
            active_recordings: self.active_recordings.len(),
            active_recording_bytes: self.active_recording_bytes,
            active_recording_entries: self.active_recording_entries,
            finalized_recordings: self.finalized_recordings.len(),
            finalized_bytes: self.finalized_bytes,
            finalized_entries: self.finalized_entries,
        }
    }
}

#[cfg(test)]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct OutputStateCounts {
    terminal_buffers: usize,
    terminal_bytes: usize,
    active_recordings: usize,
    active_recording_bytes: u64,
    active_recording_entries: usize,
    finalized_recordings: usize,
    finalized_bytes: u64,
    finalized_entries: usize,
}

lazy_static::lazy_static! {
    static ref SESSION_OUTPUT_STATES: StdMutex<SessionOutputStateRegistry> =
        StdMutex::new(SessionOutputStateRegistry::default());
}

fn lock_output_states() -> Result<std::sync::MutexGuard<'static, SessionOutputStateRegistry>, String>
{
    let mut states = SESSION_OUTPUT_STATES
        .lock()
        .map_err(|error| format!("Failed to lock SSH output state: {error}"))?;
    states.expire_pressure(Instant::now());
    Ok(states)
}

/// The command supplies the trusted Tauri window label, never a JS argument.
/// Windows should renew their pressure report every five seconds.
pub fn configure_terminal_buffering_state(
    window_label: &str,
    config: Option<TerminalBufferConfig>,
    pressure: TerminalMemoryPressure,
) -> Result<TerminalBufferDiagnostics, String> {
    lock_output_states()?.configure_terminal_buffering(
        window_label,
        config,
        pressure,
        Instant::now(),
    )
}

pub fn ensure_terminal_buffer(session_id: &str) -> Result<u64, String> {
    let mut states = lock_output_states()?;
    Ok(states.ensure_terminal_buffer(session_id).generation)
}

pub fn append_terminal_output(
    session_id: &str,
    data: &str,
) -> Result<TerminalAppendMetadata, String> {
    let mut states = lock_output_states()?;
    Ok(states.append_terminal_output(session_id, data))
}

pub fn terminal_buffer_text(session_id: &str) -> Result<String, String> {
    Ok(lock_output_states()?.terminal_text(session_id))
}

/// Bounded tail for the legacy renderer command; internal automation keeps
/// using terminal_buffer_text's historical 1 MiB search window.
pub fn terminal_buffer_legacy_text(session_id: &str) -> Result<String, String> {
    Ok(lock_output_states()?.terminal_legacy_text(session_id))
}

pub fn terminal_buffer_snapshot(
    session_id: &str,
    generation: Option<u64>,
    after_sequence: Option<u64>,
) -> Result<TerminalBufferSnapshot, String> {
    Ok(lock_output_states()?.terminal_snapshot(session_id, generation, after_sequence))
}

pub fn terminal_buffer_snapshot_page(
    session_id: &str,
    generation: Option<u64>,
    after_sequence: Option<u64>,
    max_bytes: Option<usize>,
) -> Result<TerminalBufferSnapshot, String> {
    Ok(lock_output_states()?.terminal_snapshot_page(
        session_id,
        generation,
        after_sequence,
        max_bytes,
    ))
}

pub fn clear_terminal_buffer_state(session_id: &str) -> Result<bool, String> {
    Ok(lock_output_states()?.clear_terminal_buffer(session_id))
}

pub fn cleanup_session_output_state(session_id: &str) -> Result<SessionOutputCleanup, String> {
    Ok(lock_output_states()?.cleanup_session(session_id))
}

/// Atomically move replay and active recording state to a replacement session.
/// Same-id SSH reattach does not need this; a future reconnect that allocates a
/// replacement id must use it instead of copying the maps independently.
pub fn transfer_session_output_state(
    old_session_id: &str,
    new_session_id: &str,
) -> Result<(), String> {
    lock_output_states()?.transfer_session(old_session_id, new_session_id)
}

#[allow(clippy::too_many_arguments)]
pub fn start_recording_state(
    session_id: &str,
    host: String,
    username: String,
    cols: u32,
    rows: u32,
    record_input: bool,
    limits: RecordingLimits,
    close_policy: RecordingClosePolicy,
) -> Result<(), String> {
    lock_output_states()?.start_recording(
        session_id,
        host,
        username,
        cols,
        rows,
        record_input,
        limits,
        close_policy,
    )
}

pub fn stop_recording_state(session_id: &str) -> Result<SessionRecording, String> {
    lock_output_states()?.stop_recording(session_id)
}

pub fn is_recording_active(session_id: &str) -> Result<bool, String> {
    Ok(lock_output_states()?
        .active_recordings
        .contains_key(session_id))
}

pub fn recording_status(session_id: &str) -> Result<Option<SessionRecordingMetadata>, String> {
    Ok(lock_output_states()?.active_recording_metadata(session_id))
}

pub fn active_recording_ids() -> Result<Vec<String>, String> {
    Ok(lock_output_states()?
        .active_recordings
        .keys()
        .cloned()
        .collect())
}

pub fn record_output_entry(session_id: &str, data: &str) {
    if let Ok(mut states) = SESSION_OUTPUT_STATES.lock() {
        let timestamp_ms = states
            .active_recordings
            .get(session_id)
            .map(|state| state.start_time.elapsed().as_millis() as u64);
        if let Some(timestamp_ms) = timestamp_ms {
            states.record_entry(
                session_id,
                SessionRecordingEntry {
                    timestamp_ms,
                    data: data.to_string(),
                    entry_type: RecordingEntryType::Output,
                },
            );
        }
    }
}

pub fn record_input_entry(session_id: &str, data: &str) {
    if let Ok(mut states) = SESSION_OUTPUT_STATES.lock() {
        let timestamp_ms = states.active_recordings.get(session_id).and_then(|state| {
            state
                .record_input
                .then(|| state.start_time.elapsed().as_millis() as u64)
        });
        if let Some(timestamp_ms) = timestamp_ms {
            states.record_entry(
                session_id,
                SessionRecordingEntry {
                    timestamp_ms,
                    data: data.to_string(),
                    entry_type: RecordingEntryType::Input,
                },
            );
        }
    }
}

pub fn record_resize_entry(session_id: &str, cols: u32, rows: u32) {
    if let Ok(mut states) = SESSION_OUTPUT_STATES.lock() {
        let timestamp_ms = states
            .active_recordings
            .get(session_id)
            .map(|state| state.start_time.elapsed().as_millis() as u64);
        if let Some(timestamp_ms) = timestamp_ms {
            states.record_entry(
                session_id,
                SessionRecordingEntry {
                    timestamp_ms,
                    data: String::new(),
                    entry_type: RecordingEntryType::Resize { cols, rows },
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::types::SshShellOutput;

    #[test]
    fn terminal_buffer_config_defaults_and_json_names_are_stable() {
        let expected = serde_json::json!({
            "mode": "adaptive", "minMiB": 1, "maxMiB": 100,
            "fixedMiB": 50, "totalMiB": 256
        });
        assert_eq!(
            serde_json::to_value(TerminalBufferConfig::default()).unwrap(),
            expected
        );
        for value in [expected, serde_json::json!({}), serde_json::Value::Null] {
            assert_eq!(
                serde_json::from_value::<TerminalBufferConfig>(value).unwrap(),
                TerminalBufferConfig::default()
            );
        }
    }

    #[test]
    fn terminal_buffer_config_normalizes_invalid_native_and_json_bounds() {
        let config: TerminalBufferConfig = serde_json::from_value(serde_json::json!({
            "mode": "unexpected", "minMiB": -12, "maxMiB": 1e100,
            "fixedMiB": 0, "totalMiB": -1
        }))
        .unwrap();
        assert_eq!(config.mode, TerminalBufferMode::Adaptive);
        assert_eq!(
            (
                config.min_mib,
                config.max_mib,
                config.fixed_mib,
                config.total_mib
            ),
            (1, 100, 1, 16)
        );
        let config: TerminalBufferConfig = serde_json::from_value(serde_json::json!({
            "mode": "fixed", "minMiB": 80.9, "maxMiB": 2,
            "fixedMiB": 1e100, "totalMiB": 100000
        }))
        .unwrap();
        assert_eq!(config.mode, TerminalBufferMode::Fixed);
        assert_eq!(
            (
                config.min_mib,
                config.max_mib,
                config.fixed_mib,
                config.total_mib
            ),
            (2, 2, 100, 1024)
        );
        let wrong_types = serde_json::json!({"mode": false, "minMiB": "big", "maxMiB": null, "fixedMiB": [], "totalMiB": {}});
        assert_eq!(
            serde_json::from_value::<TerminalBufferConfig>(wrong_types).unwrap(),
            TerminalBufferConfig::default()
        );
        let mut registry = SessionOutputStateRegistry::default();
        let diagnostics = registry
            .configure_terminal_buffering(
                "main",
                Some(TerminalBufferConfig {
                    min_mib: usize::MAX,
                    max_mib: 0,
                    fixed_mib: 0,
                    total_mib: usize::MAX,
                    ..TerminalBufferConfig::default()
                }),
                TerminalMemoryPressure::Normal,
                Instant::now(),
            )
            .unwrap();
        assert_eq!(
            (
                diagnostics.config.min_mib,
                diagnostics.config.max_mib,
                diagnostics.config.fixed_mib,
                diagnostics.config.total_mib
            ),
            (1, 1, 1, 1024)
        );
    }

    #[test]
    fn adaptive_starts_at_floor_and_allocates_only_on_output_demand() {
        let mut registry = SessionOutputStateRegistry::default();
        registry.ensure_terminal_buffer("idle");
        assert_eq!(registry.terminal_buffers["idle"].max_bytes, MIB);
        assert_eq!(registry.terminal_buffers["idle"].bytes.capacity(), 0);
        registry.append_terminal_output("idle", "hello");
        assert!(registry.terminal_buffers["idle"].bytes.capacity() < MIB);
        let now = Instant::now();
        registry
            .configure_terminal_buffering(
                "main",
                Some(TerminalBufferConfig {
                    max_mib: 3,
                    ..TerminalBufferConfig::default()
                }),
                TerminalMemoryPressure::Normal,
                now,
            )
            .unwrap();
        registry.append_terminal_output("idle", &"a".repeat(MIB));
        assert_eq!(registry.terminal_buffers["idle"].max_bytes, 2 * MIB);
        registry.append_terminal_output("idle", &"b".repeat(4 * MIB));
        let buffer = &registry.terminal_buffers["idle"];
        assert_eq!(buffer.max_bytes, 3 * MIB);
        assert_eq!(buffer.bytes.len(), 3 * MIB);
        assert!(buffer.bytes.capacity() <= buffer.max_bytes);
        assert_eq!(buffer.dropped_bytes, (2 * MIB + 5) as u64);
    }

    #[test]
    fn fixed_target_is_lazy_and_independent_of_adaptive_min_max() {
        let mut registry = SessionOutputStateRegistry::default();
        registry
            .configure_terminal_buffering(
                "main",
                Some(TerminalBufferConfig {
                    mode: TerminalBufferMode::Fixed,
                    min_mib: 80,
                    max_mib: 90,
                    fixed_mib: 3,
                    ..TerminalBufferConfig::default()
                }),
                TerminalMemoryPressure::Normal,
                Instant::now(),
            )
            .unwrap();
        registry.ensure_terminal_buffer("fixed");
        assert_eq!(registry.terminal_buffers["fixed"].max_bytes, 3 * MIB);
        assert_eq!(registry.terminal_buffers["fixed"].bytes.capacity(), 0);
        registry.append_terminal_output("fixed", &"a".repeat(4 * MIB));
        assert_eq!(registry.terminal_bytes, 3 * MIB);
        assert_eq!(registry.terminal_buffers["fixed"].dropped_bytes, MIB as u64);
    }

    #[test]
    fn fixed_and_adaptive_share_with_idle_sessions_even_below_minimum() {
        for mode in [TerminalBufferMode::Adaptive, TerminalBufferMode::Fixed] {
            let mut registry = SessionOutputStateRegistry::default();
            registry
                .configure_terminal_buffering(
                    "main",
                    Some(TerminalBufferConfig {
                        mode,
                        total_mib: 16,
                        ..TerminalBufferConfig::default()
                    }),
                    TerminalMemoryPressure::Normal,
                    Instant::now(),
                )
                .unwrap();
            registry.append_terminal_output("busy", &"x".repeat(10 * MIB));
            for index in 0..31 {
                registry.ensure_terminal_buffer(&format!("idle-{index}"));
            }
            assert_eq!(registry.terminal_buffers.len(), 32);
            assert_eq!(registry.per_session_cap(), MIB / 2);
            assert_eq!(registry.terminal_bytes, MIB / 2);
            assert_eq!(registry.terminal_diagnostics().budget_bytes, 16 * MIB);
            assert!(registry
                .terminal_buffers
                .values()
                .all(|buffer| buffer.bytes.capacity() <= MIB / 2));
            for index in 0..31 {
                assert!(registry.remove_terminal_buffer(&format!("idle-{index}")));
            }
            registry.append_terminal_output("busy", &"y".repeat(2 * MIB));
            assert!(registry.terminal_buffers["busy"].max_bytes > MIB / 2);
            assert!(registry.terminal_bytes <= 16 * MIB);
        }
    }

    #[test]
    fn each_pressure_level_shrinks_once_then_recovers_on_normal_demand() {
        for mode in [TerminalBufferMode::Adaptive, TerminalBufferMode::Fixed] {
            let now = Instant::now();
            let mut registry = SessionOutputStateRegistry::default();
            registry
                .configure_terminal_buffering(
                    "main",
                    Some(TerminalBufferConfig {
                        mode,
                        fixed_mib: 8,
                        ..TerminalBufferConfig::default()
                    }),
                    TerminalMemoryPressure::Normal,
                    now,
                )
                .unwrap();
            let meta = registry.append_terminal_output("s", &"x".repeat(8 * MIB));
            for pressure in [
                TerminalMemoryPressure::Warning,
                TerminalMemoryPressure::Critical,
                TerminalMemoryPressure::Pressure,
            ] {
                let diagnostics = registry
                    .configure_terminal_buffering("main", None, pressure, now)
                    .unwrap();
                let target = 8 * MIB / pressure.divisor();
                assert_eq!(registry.terminal_buffers["s"].max_bytes, target);
                assert_eq!(diagnostics.retained_bytes, target);
                assert_eq!(
                    diagnostics.effective_cap_bytes,
                    256 * MIB / pressure.divisor()
                );
                assert_eq!(
                    registry.terminal_buffers["s"].dropped_bytes,
                    (8 * MIB - target) as u64
                );
                assert_eq!(
                    registry.terminal_buffers["s"].sequence_end,
                    meta.sequence_end
                );
                for seconds in [5, 10, 15] {
                    registry
                        .configure_terminal_buffering(
                            "main",
                            None,
                            pressure,
                            now + Duration::from_secs(seconds),
                        )
                        .unwrap();
                    assert_eq!(registry.terminal_buffers["s"].max_bytes, target);
                }
            }
            registry
                .configure_terminal_buffering(
                    "main",
                    None,
                    TerminalMemoryPressure::Normal,
                    now + Duration::from_secs(20),
                )
                .unwrap();
            registry.append_terminal_output("s", &"z".repeat(2 * MIB));
            assert!(registry.terminal_buffers["s"].max_bytes > MIB);
            assert_eq!(
                registry.terminal_buffers["s"].dropped_bytes,
                (7 * MIB) as u64
            );
        }
    }

    #[test]
    fn worst_window_pressure_wins_and_stale_reports_expire() {
        let now = Instant::now();
        let mut registry = SessionOutputStateRegistry::default();
        registry
            .configure_terminal_buffering("detached", None, TerminalMemoryPressure::Critical, now)
            .unwrap();
        let diagnostics = registry
            .configure_terminal_buffering(
                "main",
                None,
                TerminalMemoryPressure::Normal,
                now + Duration::from_secs(5),
            )
            .unwrap();
        assert_eq!(diagnostics.pressure, TerminalMemoryPressure::Critical);
        registry
            .configure_terminal_buffering(
                "other",
                None,
                TerminalMemoryPressure::Warning,
                now + Duration::from_secs(10),
            )
            .unwrap();
        registry.expire_pressure(now + Duration::from_secs(29));
        assert_eq!(registry.pressure, TerminalMemoryPressure::Critical);
        registry.expire_pressure(now + PRESSURE_REPORT_TTL);
        assert_eq!(registry.pressure, TerminalMemoryPressure::Warning);
        assert!(!registry.pressure_reports.contains_key("detached"));
        registry.expire_pressure(now + Duration::from_secs(40));
        assert_eq!(registry.pressure, TerminalMemoryPressure::Normal);
        assert!(registry.pressure_reports.is_empty());
        assert!(registry.next_pressure_expiry.is_none());
    }

    #[test]
    fn pressure_preserves_adaptive_floor_before_eviction_and_for_new_sessions() {
        for minimum in [1, 3] {
            let now = Instant::now();
            let mut registry = SessionOutputStateRegistry::default();
            registry
                .configure_terminal_buffering(
                    "main",
                    Some(TerminalBufferConfig {
                        min_mib: minimum,
                        max_mib: minimum,
                        ..TerminalBufferConfig::default()
                    }),
                    TerminalMemoryPressure::Normal,
                    now,
                )
                .unwrap();
            registry.append_terminal_output("existing", &"x".repeat(minimum * MIB));
            for pressure in [
                TerminalMemoryPressure::Warning,
                TerminalMemoryPressure::Critical,
                TerminalMemoryPressure::Pressure,
            ] {
                registry
                    .configure_terminal_buffering("main", None, pressure, now)
                    .unwrap();
                let buffer = &registry.terminal_buffers["existing"];
                assert_eq!(buffer.max_bytes, minimum * MIB);
                assert_eq!(buffer.bytes.len(), minimum * MIB);
                assert_eq!(
                    buffer.retained_start, 0,
                    "floor must be applied before destructive eviction"
                );
                assert_eq!(buffer.dropped_bytes, 0);
                registry.ensure_terminal_buffer("new");
                assert_eq!(registry.terminal_buffers["new"].max_bytes, minimum * MIB);
                assert_eq!(registry.terminal_buffers["new"].bytes.capacity(), 0);
                registry.remove_terminal_buffer("new");
            }
        }
    }

    #[test]
    fn fixed_pressure_preserves_one_mib_floor_but_shared_safety_can_override_it() {
        let now = Instant::now();
        let mut registry = SessionOutputStateRegistry::default();
        registry
            .configure_terminal_buffering(
                "main",
                Some(TerminalBufferConfig {
                    mode: TerminalBufferMode::Fixed,
                    fixed_mib: 1,
                    total_mib: 16,
                    ..TerminalBufferConfig::default()
                }),
                TerminalMemoryPressure::Normal,
                now,
            )
            .unwrap();
        registry.append_terminal_output("existing", &"x".repeat(MIB));
        registry
            .configure_terminal_buffering("main", None, TerminalMemoryPressure::Pressure, now)
            .unwrap();
        assert_eq!(registry.terminal_buffers["existing"].max_bytes, MIB);
        assert_eq!(registry.terminal_buffers["existing"].dropped_bytes, 0);
        registry.ensure_terminal_buffer("second");
        assert_eq!(registry.terminal_buffers["second"].max_bytes, MIB);
        registry.ensure_terminal_buffer("third");
        let fair_share = 2 * MIB / 3;
        assert_eq!(registry.per_session_cap(), fair_share);
        assert_eq!(
            registry.terminal_buffers["existing"].bytes.len(),
            fair_share
        );
        assert_eq!(
            registry.terminal_buffers["existing"].dropped_bytes,
            (MIB - fair_share) as u64
        );
        assert!(registry.terminal_diagnostics().budget_bytes <= 2 * MIB);
        assert_eq!(registry.terminal_buffers["third"].bytes.capacity(), 0);
    }

    #[test]
    fn detached_windows_cannot_change_global_config() {
        let now = Instant::now();
        let mut registry = SessionOutputStateRegistry::default();
        assert!(registry
            .configure_terminal_buffering(
                "detached",
                Some(TerminalBufferConfig {
                    total_mib: 16,
                    ..TerminalBufferConfig::default()
                }),
                TerminalMemoryPressure::Normal,
                now
            )
            .is_err());
        assert_eq!(registry.terminal_config, TerminalBufferConfig::default());
        let diagnostics = registry
            .configure_terminal_buffering("detached", None, TerminalMemoryPressure::Pressure, now)
            .unwrap();
        assert_eq!(diagnostics.pressure, TerminalMemoryPressure::Pressure);
        let json = serde_json::to_value(diagnostics).unwrap();
        assert_eq!(json["effectiveCapBytes"], 32 * MIB);
        assert_eq!(json["sessionCount"], 0);
        assert_eq!(json["retainedBytes"], 0);
        assert_eq!(json["pressure"], "pressure");
    }

    #[test]
    fn config_shrink_and_mode_switch_preserve_sequences_and_eviction_counters() {
        let mut registry = SessionOutputStateRegistry::default();
        let now = Instant::now();
        let meta = registry.append_terminal_output("s", &"🙂".repeat(MIB));
        registry
            .configure_terminal_buffering(
                "main",
                Some(TerminalBufferConfig {
                    mode: TerminalBufferMode::Fixed,
                    fixed_mib: 1,
                    ..TerminalBufferConfig::default()
                }),
                TerminalMemoryPressure::Normal,
                now,
            )
            .unwrap();
        let buffer = &registry.terminal_buffers["s"];
        assert_eq!(buffer.generation, meta.generation);
        assert_eq!(buffer.sequence_end, (4 * MIB) as u64);
        assert_eq!(buffer.retained_start, (3 * MIB) as u64);
        assert_eq!(buffer.dropped_bytes, (3 * MIB) as u64);
        assert!(buffer.text().chars().all(|character| character == '🙂'));
        registry
            .configure_terminal_buffering(
                "main",
                Some(TerminalBufferConfig::default()),
                TerminalMemoryPressure::Normal,
                now,
            )
            .unwrap();
        let live = registry.append_terminal_output("s", "live");
        assert_eq!(live.sequence_start, meta.sequence_end);
        assert_eq!(live.sequence_end - live.sequence_start, 4);
        assert_eq!(live.dropped_bytes, (3 * MIB) as u64);
    }

    #[test]
    fn shrink_evicts_only_oldest_complete_utf8_and_zero_budget_still_advances_live_sequence() {
        let mut buffer = TerminalReplayBuffer::new(8);
        buffer.append("aé🙂z");
        buffer.set_max_bytes(4);
        assert_eq!(buffer.text(), "z");
        assert_eq!(buffer.dropped_bytes, 7);
        buffer.set_max_bytes(0);
        let live = buffer.append("🙂");
        assert_eq!((live.sequence_start, live.sequence_end), (8, 12));
        assert_eq!(live.dropped_bytes, 12);
        let page = buffer.snapshot("s", None, Some(8));
        assert!(page.data.is_empty());
        assert!(page.gap);
        assert!(!page.has_more);
        assert_eq!(page.sequence_end, 12);
        assert_eq!(buffer.bytes.capacity(), 0);
    }

    #[test]
    fn paginated_utf8_round_trips_wrapped_ring_without_skips() {
        let mut buffer = TerminalReplayBuffer::new(16);
        buffer.append("abcdefghijkl");
        buffer.append("é🙂é🙂");
        assert!(
            !buffer.bytes.as_slices().1.is_empty(),
            "exercise physical wrap"
        );
        for page_size in [0, 1, 4, 5, 9, usize::MAX] {
            let mut after = None;
            let mut combined = String::new();
            loop {
                let page =
                    buffer.snapshot_page("s", Some(buffer.generation), after, Some(page_size));
                assert!(!page.gap);
                assert_eq!(
                    page.sequence_end - page.sequence_start,
                    page.data.len() as u64
                );
                assert!(page.data.len() <= page_size.clamp(4, MAX_TERMINAL_SNAPSHOT_BYTES));
                combined.push_str(&page.data);
                after = Some(page.sequence_end);
                if !page.has_more {
                    break;
                }
                assert!(!page.data.is_empty());
            }
            assert_eq!(combined, buffer.text());
            let empty = buffer.snapshot_page("s", None, after, Some(page_size));
            assert!(empty.data.is_empty());
            assert!(!empty.has_more);
            assert!(!empty.gap);
        }
    }

    #[test]
    fn page_cursors_report_eviction_generation_and_malformed_gaps() {
        let mut buffer = TerminalReplayBuffer::new(16);
        let first = buffer.append("é🙂hello");
        for (generation, cursor, changed) in [
            (first.generation, 1, false),
            (first.generation, 100, false),
            (first.generation + 1, 4, true),
        ] {
            let page = buffer.snapshot_page("s", Some(generation), Some(cursor), Some(4));
            assert!(page.gap);
            assert_eq!(page.generation_changed, changed);
            assert_eq!(page.data, "é");
            assert_eq!(page.sequence_end, 2);
            assert!(page.has_more);
        }
        buffer.append("0123456789abcdef");
        let evicted = buffer.snapshot_page("s", Some(first.generation), Some(2), Some(4));
        assert!(evicted.gap);
        assert_eq!(evicted.sequence_start, 11);
        assert_eq!(evicted.sequence_end, 15);
        assert_eq!(evicted.data, "0123");
        assert!(evicted.has_more);
    }

    #[test]
    fn hundred_mib_history_pages_and_legacy_tail_are_bounded() {
        let mut registry = SessionOutputStateRegistry::default();
        let chunk = "x".repeat(MIB);
        for _ in 0..100 {
            registry.append_terminal_output("large", &chunk);
        }
        let buffer = &registry.terminal_buffers["large"];
        assert_eq!(buffer.bytes.len(), 100 * MIB);
        assert!(buffer.bytes.capacity() <= 100 * MIB);
        assert_eq!(buffer.dropped_bytes, 0);
        let first = registry.terminal_snapshot("large", None, None);
        assert_eq!(first.data.len(), MAX_TERMINAL_SNAPSHOT_BYTES);
        assert!(first.has_more);
        let mut after = 0;
        let mut pages = 0;
        loop {
            let page = registry.terminal_snapshot_page(
                "large",
                Some(buffer.generation),
                Some(after),
                Some(usize::MAX),
            );
            assert_eq!(page.sequence_start, after);
            assert_eq!(page.data.len(), MAX_TERMINAL_SNAPSHOT_BYTES);
            assert_eq!(page.data.capacity(), MAX_TERMINAL_SNAPSHOT_BYTES);
            assert!(page.data.bytes().all(|byte| byte == b'x'));
            after = page.sequence_end;
            pages += 1;
            if !page.has_more {
                break;
            }
        }
        assert_eq!(pages, 400);
        assert_eq!(after, (100 * MIB) as u64);
        assert_eq!(
            registry.terminal_legacy_text("large").len(),
            MAX_TERMINAL_SNAPSHOT_BYTES
        );
        assert_eq!(registry.terminal_text("large").len(), MIB);
    }

    #[test]
    fn legacy_tail_starts_on_utf8_boundary_and_clear_keeps_active_fair_share() {
        let mut registry = SessionOutputStateRegistry::default();
        let original = registry.append_terminal_output(
            "s",
            &format!("{}!", "🙂".repeat(MAX_TERMINAL_SNAPSHOT_BYTES / 4)),
        );
        let tail = registry.terminal_legacy_text("s");
        assert_eq!(tail.len(), MAX_TERMINAL_SNAPSHOT_BYTES - 3);
        assert!(tail.starts_with('🙂'));
        assert!(tail.ends_with('!'));
        assert!(registry.clear_terminal_buffer("s"));
        assert_eq!(registry.terminal_diagnostics().session_count, 1);
        assert_eq!(registry.terminal_bytes, 0);
        assert_eq!(registry.terminal_buffers["s"].bytes.capacity(), 0);
        let page =
            registry.terminal_snapshot("s", Some(original.generation), Some(original.sequence_end));
        assert!(page.generation_changed);
        assert!(!page.has_more);
        assert_eq!(page.dropped_bytes, 0);
        let missing = registry.terminal_snapshot_page("missing", Some(42), Some(123), Some(4));
        assert!(missing.gap);
        assert!(missing.generation_changed);
        assert!(!missing.has_more);
    }

    #[test]
    fn automation_keeps_one_mib_search_window_while_legacy_ipc_is_one_page() {
        let mut registry = SessionOutputStateRegistry::default();
        registry.append_terminal_output("s", &"old".repeat(MIB));
        let marker = "automation-pattern-marker";
        let latest = format!("{marker}{}", "x".repeat(MIB - marker.len()));
        registry.append_terminal_output("s", &latest);
        assert!(registry.terminal_buffers["s"].bytes.len() > MIB);
        let automation = registry.terminal_text("s");
        assert_eq!(automation.len(), MIB);
        assert_eq!(automation, latest);
        assert!(automation.contains(marker));
        let legacy = registry.terminal_legacy_text("s");
        assert_eq!(legacy.len(), MAX_TERMINAL_SNAPSHOT_BYTES);
        assert!(!legacy.contains(marker));
        assert!(legacy.bytes().all(|byte| byte == b'x'));
        assert!(registry.terminal_legacy_text("missing").is_empty());
    }

    #[test]
    fn streaming_utf8_decoder_preserves_split_multibyte_codepoints() {
        let input = "prefix-é-🙂-suffix".as_bytes();
        let mut decoder = StreamingUtf8Decoder::new();
        let mut decoded = String::new();
        for byte in input {
            decoded.push_str(&decoder.push(std::slice::from_ref(byte)));
        }
        decoded.push_str(&decoder.finish());
        assert_eq!(decoded, "prefix-é-🙂-suffix");
        assert_eq!(decoder.pending_len(), 0);
    }

    #[test]
    fn streaming_utf8_decoder_replaces_only_invalid_or_terminal_incomplete_input() {
        let mut decoder = StreamingUtf8Decoder::new();
        assert_eq!(decoder.push(&[b'a', 0xff, b'b', 0xf0, 0x9f]), "a\u{fffd}b");
        assert_eq!(decoder.pending_len(), 2);
        assert_eq!(decoder.finish(), "\u{fffd}");
    }

    #[test]
    fn replay_cap_never_splits_utf8_and_accounts_every_dropped_byte() {
        let mut buffer = TerminalReplayBuffer::new(5);
        let first = buffer.append("aé🙂");
        assert_eq!(first.sequence_start, 0);
        assert_eq!(first.sequence_end, 7);
        assert_eq!(first.retained_start, 3);
        assert_eq!(first.dropped_bytes, 3);
        assert_eq!(buffer.text(), "🙂");

        let second = buffer.append("x");
        assert_eq!(second.sequence_start, 7);
        assert_eq!(second.sequence_end, 8);
        assert_eq!(buffer.text(), "🙂x");

        let suffix = buffer.snapshot("s", Some(first.generation), Some(7));
        assert_eq!(suffix.data, "x");
        assert_eq!(suffix.sequence_start, 7);
        assert!(!suffix.gap);

        let old = buffer.snapshot("s", Some(first.generation), Some(0));
        assert_eq!(old.data, "🙂x");
        assert!(old.gap);
        assert_eq!(old.retained_start, 3);

        let mid_codepoint = buffer.snapshot("s", Some(first.generation), Some(4));
        assert!(mid_codepoint.gap);
        assert_eq!(mid_codepoint.sequence_start, 3);
    }

    #[test]
    fn snapshots_are_ordered_and_report_generation_changes() {
        let mut buffer = TerminalReplayBuffer::new(64);
        let meta = buffer.append("hello ");
        buffer.append("world");
        let suffix = buffer.snapshot("session", Some(meta.generation), Some(6));
        assert_eq!(suffix.data, "world");
        assert_eq!(suffix.sequence_start, 6);
        assert_eq!(suffix.sequence_end, 11);
        assert!(!suffix.gap);
        assert!(!suffix.generation_changed);

        let changed = buffer.snapshot("session", Some(meta.generation + 1), Some(6));
        assert_eq!(changed.data, "hello world");
        assert!(changed.gap);
        assert!(changed.generation_changed);
        assert_eq!(changed.sequence_start, 0);
    }

    #[test]
    fn legacy_event_and_plain_text_contract_remain_compatible() {
        let legacy = SshShellOutput {
            session_id: "legacy".to_string(),
            data: "hello".to_string(),
            generation: None,
            sequence_start: None,
            sequence_end: None,
            retained_start: None,
            dropped_bytes: None,
        };
        assert_eq!(
            serde_json::to_value(legacy).unwrap(),
            serde_json::json!({"session_id": "legacy", "data": "hello"})
        );

        let mut registry = SessionOutputStateRegistry::default();
        let original = registry.append_terminal_output("legacy", "hello");
        assert_eq!(registry.terminal_text("legacy"), "hello");
        assert!(registry.terminal_buffers.remove("legacy").is_some());
        assert_eq!(registry.terminal_text("legacy"), "");
        let replacement = registry.append_terminal_output("legacy", "new");
        assert_ne!(replacement.generation, original.generation);
        assert_eq!(replacement.sequence_start, 0);
    }

    #[test]
    fn enriched_event_and_snapshot_use_the_frozen_snake_case_contract() {
        let event = SshShellOutput {
            session_id: "session".to_string(),
            data: "é".to_string(),
            generation: Some(7),
            sequence_start: Some(10),
            sequence_end: Some(12),
            retained_start: Some(4),
            dropped_bytes: Some(4),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "session_id": "session",
                "data": "é",
                "generation": 7,
                "sequence_start": 10,
                "sequence_end": 12,
                "retained_start": 4,
                "dropped_bytes": 4
            })
        );

        let snapshot = TerminalBufferSnapshot {
            session_id: "session".to_string(),
            data: "é".to_string(),
            generation: 7,
            sequence_start: 10,
            sequence_end: 12,
            retained_start: 4,
            dropped_bytes: 4,
            gap: true,
            generation_changed: false,
            has_more: false,
        };
        assert_eq!(
            serde_json::to_value(snapshot).unwrap(),
            serde_json::json!({
                "session_id": "session",
                "data": "é",
                "generation": 7,
                "sequence_start": 10,
                "sequence_end": 12,
                "retained_start": 4,
                "dropped_bytes": 4,
                "gap": true,
                "generation_changed": false,
                "has_more": false
            })
        );
    }

    #[test]
    fn recording_limits_and_finalize_policy_are_bounded_and_explicit() {
        let mut registry = SessionOutputStateRegistry::default();
        let limits = RecordingLimits {
            max_bytes: 5,
            max_entries: 2,
            max_duration_ms: 60_000,
        };
        registry
            .start_recording(
                "s",
                "host".into(),
                "user".into(),
                80,
                24,
                true,
                limits,
                RecordingClosePolicy::Finalize,
            )
            .unwrap();
        registry.record_entry(
            "s",
            SessionRecordingEntry {
                timestamp_ms: 0,
                data: "abc".into(),
                entry_type: RecordingEntryType::Output,
            },
        );
        registry.record_entry(
            "s",
            SessionRecordingEntry {
                timestamp_ms: 1,
                data: String::new(),
                entry_type: RecordingEntryType::Resize {
                    cols: 100,
                    rows: 40,
                },
            },
        );
        registry.record_entry(
            "s",
            SessionRecordingEntry {
                timestamp_ms: 2,
                data: "xyz".into(),
                entry_type: RecordingEntryType::Input,
            },
        );

        let cleanup = registry.cleanup_session("s");
        assert!(cleanup.recording_finalized);
        assert!(!cleanup.recording_discarded);
        let recording = registry.stop_recording("s").unwrap();
        assert_eq!(recording.entries.len(), 2);
        assert_eq!(recording.metadata.captured_bytes, 3);
        assert!(recording.metadata.estimated_bytes > recording.metadata.captured_bytes);
        assert_eq!(recording.metadata.dropped_entries, 1);
        assert_eq!(recording.metadata.dropped_bytes, 3);
        assert!(recording.metadata.truncated);
        assert_eq!(
            recording.metadata.close_reason,
            Some(RecordingCloseReason::Disconnect)
        );
        assert_eq!(recording.metadata.cols, 100);
        assert_eq!(recording.metadata.rows, 40);
        assert_eq!(registry.counts(), OutputStateCounts::default());
    }

    #[test]
    fn recording_duration_limit_rejects_late_entries() {
        let mut registry = SessionOutputStateRegistry::default();
        registry
            .start_recording(
                "duration",
                "host".into(),
                "user".into(),
                80,
                24,
                false,
                RecordingLimits {
                    max_bytes: 100,
                    max_entries: 10,
                    max_duration_ms: 1,
                },
                RecordingClosePolicy::Discard,
            )
            .unwrap();
        registry
            .active_recordings
            .get_mut("duration")
            .unwrap()
            .start_time = Instant::now() - std::time::Duration::from_millis(10);
        registry.record_entry(
            "duration",
            SessionRecordingEntry {
                timestamp_ms: 10,
                data: "late".into(),
                entry_type: RecordingEntryType::Output,
            },
        );
        let state = registry.active_recordings.get("duration").unwrap();
        assert!(state.entries.is_empty());
        assert_eq!(state.dropped_entries, 1);
        assert_eq!(state.dropped_bytes, 4);
        assert!(state.limit_reached);
    }

    #[test]
    fn aggregate_replay_budget_is_fair_and_bounded_at_100_500_1000_sessions() {
        const RETAINED_PER_SESSION: usize = 5;
        const OUTPUT: &str = "abcdefghijklmnopqrstuvwxyz012345";
        for count in [100usize, 500, 1_000] {
            let aggregate_cap = count * RETAINED_PER_SESSION;
            let mut registry = SessionOutputStateRegistry::with_limits(OutputStateLimits {
                terminal_replay_bytes: aggregate_cap,
                ..OutputStateLimits::default()
            });
            for index in 0..count {
                registry.append_terminal_output(&format!("pressure-{count}-{index}"), OUTPUT);
            }

            let counts = registry.counts();
            assert_eq!(counts.terminal_buffers, count);
            assert_eq!(counts.terminal_bytes, aggregate_cap);
            assert!(counts.terminal_bytes <= registry.limits.terminal_replay_bytes);
            for index in 0..count {
                let session_id = format!("pressure-{count}-{index}");
                let snapshot = registry.terminal_snapshot(&session_id, None, None);
                assert_eq!(snapshot.data, "12345");
                assert_eq!(snapshot.sequence_end, OUTPUT.len() as u64);
                assert_eq!(snapshot.retained_start, (OUTPUT.len() - 5) as u64);
                assert_eq!(snapshot.dropped_bytes, (OUTPUT.len() - 5) as u64);
            }

            // Every session continues to make progress at full pressure; no
            // oldest-session/LRU starvation is hidden by the aggregate cap.
            for index in 0..count {
                registry.append_terminal_output(&format!("pressure-{count}-{index}"), "x");
            }
            assert_eq!(registry.counts().terminal_bytes, aggregate_cap);
            for index in 0..count {
                let session_id = format!("pressure-{count}-{index}");
                let snapshot = registry.terminal_snapshot(&session_id, None, None);
                assert_eq!(snapshot.data, "2345x");
                assert_eq!(snapshot.sequence_end, (OUTPUT.len() + 1) as u64);
                assert_eq!(snapshot.retained_start, (OUTPUT.len() - 4) as u64);
            }

            for index in 0..count {
                assert!(registry.remove_terminal_buffer(&format!("pressure-{count}-{index}")));
            }
            assert_eq!(registry.counts(), OutputStateCounts::default());
        }
    }

    #[test]
    fn aggregate_recording_bytes_and_entries_bound_1000_session_pressure() {
        const COUNT: usize = 1_000;
        let ids: Vec<String> = (0..COUNT)
            .map(|index| format!("recording-pressure-{index}"))
            .collect();
        let resize_entry = SessionRecordingEntry {
            timestamp_ms: 0,
            data: String::new(),
            entry_type: RecordingEntryType::Resize { cols: 81, rows: 25 },
        };
        let entry_estimate = estimated_recording_entry_bytes(&resize_entry);
        let base_total: u64 = ids
            .iter()
            .map(|id| estimated_recording_base_bytes(id, "host", "user"))
            .sum();
        let one_entry_total = base_total + entry_estimate * COUNT as u64;
        let largest_recording = ids
            .iter()
            .map(|id| estimated_recording_base_bytes(id, "host", "user") + entry_estimate)
            .max()
            .unwrap();

        // Byte pressure: every zero-payload resize consumes an estimated
        // allocation; a second wave is rejected and explicitly truncates each
        // recording even though payload bytes remain zero.
        let mut byte_limited = SessionOutputStateRegistry::with_limits(OutputStateLimits {
            active_recording_bytes: one_entry_total,
            active_recording_entries: usize::MAX,
            finalized_recordings: COUNT,
            finalized_recording_bytes: largest_recording * 10,
            finalized_recording_entries: usize::MAX,
            ..OutputStateLimits::default()
        });
        for id in &ids {
            byte_limited
                .start_recording(
                    id,
                    "host".into(),
                    "user".into(),
                    80,
                    24,
                    false,
                    RecordingLimits::default(),
                    RecordingClosePolicy::Finalize,
                )
                .unwrap();
        }
        for id in &ids {
            byte_limited.record_entry(id, resize_entry.clone());
        }
        assert_eq!(byte_limited.active_recording_bytes, one_entry_total);
        assert_eq!(byte_limited.active_recording_entries, COUNT);
        for id in &ids {
            byte_limited.record_entry(id, resize_entry.clone());
            let state = byte_limited.active_recordings.get(id).unwrap();
            assert_eq!(state.entries.len(), 1);
            assert_eq!(state.dropped_entries, 1);
            assert!(state.limit_reached);
        }
        for id in &ids {
            assert!(byte_limited.cleanup_session(id).recording_finalized);
        }
        assert_eq!(byte_limited.active_recording_bytes, 0);
        assert_eq!(byte_limited.active_recording_entries, 0);
        assert!(byte_limited.finalized_bytes <= byte_limited.limits.finalized_recording_bytes);
        assert!(byte_limited.finalized_entries <= byte_limited.limits.finalized_recording_entries);
        let retained_by_bytes = byte_limited.finalized_recordings.len();
        assert!((1..=10).contains(&retained_by_bytes));
        let mut retrieved = 0;
        for id in &ids {
            if let Ok(recording) = byte_limited.stop_recording(id) {
                retrieved += 1;
                assert!(recording.metadata.truncated);
                assert_eq!(recording.entries.len(), 1);
                assert_eq!(recording.metadata.captured_bytes, 0);
                assert!(recording.metadata.estimated_bytes > 0);
                assert_eq!(
                    recording.metadata.close_reason,
                    Some(RecordingCloseReason::Disconnect)
                );
            }
        }
        assert_eq!(retrieved, retained_by_bytes);
        assert_eq!(byte_limited.counts(), OutputStateCounts::default());

        // Entry pressure is independent of bytes, both while active and after
        // finalize. The finalized cache counts resize entries, not payload.
        let mut entry_limited = SessionOutputStateRegistry::with_limits(OutputStateLimits {
            active_recording_bytes: u64::MAX,
            active_recording_entries: COUNT,
            finalized_recordings: COUNT,
            finalized_recording_bytes: u64::MAX,
            finalized_recording_entries: 10,
            ..OutputStateLimits::default()
        });
        for id in &ids {
            entry_limited
                .start_recording(
                    id,
                    "host".into(),
                    "user".into(),
                    80,
                    24,
                    false,
                    RecordingLimits::default(),
                    RecordingClosePolicy::Finalize,
                )
                .unwrap();
        }
        for id in &ids {
            entry_limited.record_entry(id, resize_entry.clone());
        }
        for id in &ids {
            entry_limited.record_entry(id, resize_entry.clone());
            assert!(
                entry_limited
                    .active_recordings
                    .get(id)
                    .unwrap()
                    .limit_reached
            );
        }
        assert_eq!(entry_limited.active_recording_entries, COUNT);
        for id in &ids {
            assert!(entry_limited.cleanup_session(id).recording_finalized);
        }
        assert_eq!(entry_limited.finalized_entries, 10);
        assert_eq!(entry_limited.finalized_recordings.len(), 10);
        for id in &ids {
            let _ = entry_limited.stop_recording(id);
        }
        assert_eq!(entry_limited.counts(), OutputStateCounts::default());
    }

    #[test]
    fn disconnect_churn_at_100_500_1000_returns_all_maps_to_baseline() {
        for count in [100usize, 500, 1_000] {
            let mut registry = SessionOutputStateRegistry::default();
            let baseline = registry.counts();
            for index in 0..count {
                let session_id = format!("churn-{count}-{index}");
                registry.append_terminal_output(&session_id, "é-output");
                registry
                    .start_recording(
                        &session_id,
                        "host".into(),
                        "user".into(),
                        80,
                        24,
                        false,
                        RecordingLimits::default(),
                        RecordingClosePolicy::Discard,
                    )
                    .unwrap();
            }
            assert_eq!(registry.terminal_buffers.len(), count);
            assert_eq!(registry.active_recordings.len(), count);
            for index in 0..count {
                let session_id = format!("churn-{count}-{index}");
                let cleanup = registry.cleanup_session(&session_id);
                assert!(cleanup.terminal_buffer_removed);
                assert!(cleanup.recording_discarded);
            }
            assert_eq!(registry.counts(), baseline);
        }
    }

    #[test]
    fn reconnect_transfer_moves_buffer_and_recording_atomically() {
        let mut registry = SessionOutputStateRegistry::default();
        let old_meta = registry.append_terminal_output("old", "hello");
        registry
            .start_recording(
                "old",
                "host".into(),
                "user".into(),
                80,
                24,
                false,
                RecordingLimits::default(),
                RecordingClosePolicy::Discard,
            )
            .unwrap();

        let old_recording_bytes = registry.active_recording_bytes;
        registry.transfer_session("old", "replacement").unwrap();
        assert_eq!(registry.terminal_text("old"), "");
        let snapshot =
            registry.terminal_snapshot("replacement", Some(old_meta.generation), Some(0));
        assert_eq!(snapshot.data, "hello");
        assert!(!snapshot.generation_changed);
        assert!(!registry.active_recordings.contains_key("old"));
        assert!(registry.active_recordings.contains_key("replacement"));
        assert_eq!(
            registry.active_recording_bytes,
            old_recording_bytes + (("replacement".len() - "old".len()) * 2) as u64
        );
    }
}
