use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputFrame {
    pub sequence: u64,
    pub data: Vec<u8>,
    /// True when the frame itself exceeded the replay byte limit and only its
    /// tail remains available to a reattaching client.
    pub prefix_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySnapshot {
    pub frames: Vec<OutputFrame>,
    pub first_available_sequence: Option<u64>,
    /// The sequence number that will be assigned to the next output frame.
    pub next_sequence: u64,
    /// Indicates that output requested by the cursor is no longer retained.
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct ReplayBuffer {
    capacity_bytes: usize,
    retained_bytes: usize,
    frames: VecDeque<OutputFrame>,
    next_sequence: u64,
    dropped_through_sequence: Option<u64>,
}

impl ReplayBuffer {
    pub fn new(capacity_bytes: usize) -> Self {
        assert!(capacity_bytes > 0, "replay capacity must be non-zero");
        Self {
            capacity_bytes,
            retained_bytes: 0,
            frames: VecDeque::new(),
            next_sequence: 1,
            dropped_through_sequence: None,
        }
    }

    pub fn push(&mut self, data: &[u8]) -> Option<OutputFrame> {
        if data.is_empty() {
            return None;
        }

        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);

        let (retained, prefix_truncated) = if data.len() > self.capacity_bytes {
            (&data[data.len() - self.capacity_bytes..], true)
        } else {
            (data, false)
        };

        while self.retained_bytes + retained.len() > self.capacity_bytes {
            if let Some(frame) = self.frames.pop_front() {
                self.retained_bytes = self.retained_bytes.saturating_sub(frame.data.len());
                self.dropped_through_sequence = Some(frame.sequence);
            } else {
                break;
            }
        }

        if prefix_truncated {
            if let Some(last) = self.frames.back() {
                self.dropped_through_sequence = Some(last.sequence);
            }
            self.frames.clear();
            self.retained_bytes = 0;
        }

        let frame = OutputFrame {
            sequence,
            data: retained.to_vec(),
            prefix_truncated,
        };
        self.retained_bytes += frame.data.len();
        self.frames.push_back(frame.clone());
        Some(frame)
    }

    pub fn snapshot_after(&self, after_sequence: u64) -> ReplaySnapshot {
        let frames: Vec<_> = self
            .frames
            .iter()
            .filter(|frame| frame.sequence > after_sequence)
            .cloned()
            .collect();
        let cursor_gap = self
            .dropped_through_sequence
            .map(|dropped| after_sequence < dropped)
            .unwrap_or(false);
        let partial_frame = frames.iter().any(|frame| frame.prefix_truncated);

        ReplaySnapshot {
            first_available_sequence: self.frames.front().map(|frame| frame.sequence),
            next_sequence: self.next_sequence,
            frames,
            truncated: cursor_gap || partial_frame,
        }
    }

    /// Discard all buffered output while preserving the monotonic cursor.
    /// Returns the number of retained bytes discarded.
    pub fn discard(&mut self) -> usize {
        let discarded = self.retained_bytes;
        if let Some(last) = self.frames.back() {
            self.dropped_through_sequence = Some(last.sequence);
        }
        self.frames.clear();
        self.retained_bytes = 0;
        discarded
    }

    pub fn last_sequence(&self) -> u64 {
        self.next_sequence.saturating_sub(1)
    }

    pub fn retained_bytes(&self) -> usize {
        self.retained_bytes
    }
}
