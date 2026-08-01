use std::collections::VecDeque;

use super::{PowerShellEventReplay, PowerShellSessionEvent, MAX_EVENT_BYTES};

pub(crate) struct ReplayBuffer {
    session_id: String,
    events: VecDeque<(PowerShellSessionEvent, usize)>,
    capacity: usize,
    bytes: usize,
    evicted: u64,
}

impl ReplayBuffer {
    pub(crate) fn new(session_id: String, capacity: usize) -> Self {
        Self {
            session_id,
            events: VecDeque::with_capacity(capacity),
            capacity,
            bytes: 0,
            evicted: 0,
        }
    }

    pub(crate) fn push(&mut self, event: PowerShellSessionEvent) -> u64 {
        let size = serde_json::to_vec(&event).map_or(0, |bytes| bytes.len());
        self.bytes = self.bytes.saturating_add(size);
        self.events.push_back((event, size));
        let before = self.evicted;
        while self.events.len() > self.capacity || self.bytes > MAX_EVENT_BYTES {
            if let Some((_, removed_size)) = self.events.pop_front() {
                self.bytes = self.bytes.saturating_sub(removed_size);
                self.evicted = self.evicted.saturating_add(1);
            } else {
                break;
            }
        }
        self.evicted.saturating_sub(before)
    }

    pub(crate) fn snapshot(
        &self,
        after_sequence: Option<u64>,
        next_sequence: u64,
    ) -> PowerShellEventReplay {
        let oldest_sequence = self
            .events
            .front()
            .map_or(next_sequence, |(event, _)| event.sequence);
        let requested = after_sequence
            .map(|sequence| sequence.saturating_add(1))
            .unwrap_or(oldest_sequence);
        PowerShellEventReplay {
            session_id: self.session_id.clone(),
            oldest_sequence,
            next_sequence,
            truncated: requested < oldest_sequence,
            evicted_events: self.evicted,
            events: self
                .events
                .iter()
                .filter(|(event, _)| after_sequence.is_none_or(|after| event.sequence > after))
                .map(|(event, _)| event.clone())
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runspace_session::PowerShellStreamKind;

    fn event(sequence: u64) -> PowerShellSessionEvent {
        PowerShellSessionEvent {
            session_id: "session".into(),
            sequence,
            timestamp_ms: sequence as i64,
            pipeline_id: None,
            kind: PowerShellStreamKind::Output,
            text: format!("event-{sequence}"),
            value: None,
            progress: None,
            pipeline_state: None,
        }
    }

    #[test]
    fn replay_is_bounded_and_reports_truncation() {
        let mut replay = ReplayBuffer::new("session".into(), 2);
        replay.push(event(1));
        replay.push(event(2));
        replay.push(event(3));
        let snapshot = replay.snapshot(Some(0), 4);
        assert!(snapshot.truncated);
        assert_eq!(snapshot.evicted_events, 1);
        assert_eq!(
            snapshot
                .events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
    }
}
