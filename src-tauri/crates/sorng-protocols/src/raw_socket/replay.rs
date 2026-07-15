use super::RawSocketFrame;
use std::collections::VecDeque;

#[derive(Debug)]
pub(crate) struct ReplayBuffer {
    frames: VecDeque<RawSocketFrame>,
    bytes: usize,
    max_frames: usize,
    max_bytes: usize,
    evicted: u64,
}

impl ReplayBuffer {
    pub(crate) fn new(max_frames: usize, max_bytes: usize) -> Self {
        Self {
            frames: VecDeque::new(),
            bytes: 0,
            max_frames,
            max_bytes,
            evicted: 0,
        }
    }

    pub(crate) fn push(&mut self, frame: RawSocketFrame) -> u64 {
        if self.max_frames == 0 || self.max_bytes == 0 || frame.data.len() > self.max_bytes {
            self.evicted = self.evicted.saturating_add(1);
            return 1;
        }
        self.bytes = self.bytes.saturating_add(frame.data.len());
        self.frames.push_back(frame);
        let mut evicted_now = 0_u64;
        while self.frames.len() > self.max_frames || self.bytes > self.max_bytes {
            if let Some(frame) = self.frames.pop_front() {
                self.bytes = self.bytes.saturating_sub(frame.data.len());
                self.evicted = self.evicted.saturating_add(1);
                evicted_now = evicted_now.saturating_add(1);
            } else {
                break;
            }
        }
        evicted_now
    }

    pub(crate) fn snapshot(&self) -> Vec<RawSocketFrame> {
        self.frames.iter().cloned().collect()
    }

    pub(crate) const fn evicted(&self) -> u64 {
        self.evicted
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw_socket::RawSocketDirection;

    fn frame(sequence: u64, size: usize) -> RawSocketFrame {
        RawSocketFrame {
            sequence,
            timestamp_ms: 0,
            direction: RawSocketDirection::Inbound,
            datagram: false,
            data: vec![0; size],
        }
    }

    #[test]
    fn replay_is_bounded_by_frames_and_bytes() {
        let mut replay = ReplayBuffer::new(2, 5);
        assert_eq!(replay.push(frame(1, 3)), 0);
        assert_eq!(replay.push(frame(2, 3)), 1);
        assert_eq!(replay.push(frame(3, 2)), 0);
        let sequences: Vec<_> = replay
            .snapshot()
            .into_iter()
            .map(|frame| frame.sequence)
            .collect();
        assert_eq!(sequences, vec![2, 3]);
        assert_eq!(replay.evicted(), 1);
    }

    #[test]
    fn oversized_frame_is_not_retained() {
        let mut replay = ReplayBuffer::new(2, 4);
        assert_eq!(replay.push(frame(1, 5)), 1);
        assert!(replay.snapshot().is_empty());
    }
}
