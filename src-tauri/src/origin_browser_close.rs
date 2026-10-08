//! Bounded, memory-only proof of acknowledged native view cleanup. These
//! receipts authorize only repeated Close, never browsing or credential access.
use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};
use tokio::sync::watch;

const CAPACITY: usize = 128;
const RETAIN_FOR: Duration = Duration::from_secs(300);

#[derive(Clone, PartialEq, Eq)]
pub(super) struct CloseKey {
    window: String,
    owner: String,
    connection: String,
    session: String,
    attempt: String,
}

impl CloseKey {
    pub(super) fn new(
        window: &str,
        owner: &str,
        connection: &str,
        session: &str,
        attempt: &str,
    ) -> Self {
        Self {
            window: window.into(),
            owner: owner.into(),
            connection: connection.into(),
            session: session.into(),
            attempt: attempt.into(),
        }
    }
}

#[derive(Default)]
pub(super) struct CloseReceipts(VecDeque<(CloseKey, Instant)>);
impl CloseReceipts {
    pub(super) fn insert(&mut self, key: CloseKey, now: Instant) {
        self.0.retain(|(existing, at)| {
            existing != &key && now.saturating_duration_since(*at) < RETAIN_FOR
        });
        while self.0.len() >= CAPACITY {
            self.0.pop_front();
        }
        self.0.push_back((key, now));
    }
    pub(super) fn contains(&mut self, key: &CloseKey, now: Instant) -> bool {
        self.0
            .retain(|(_, at)| now.saturating_duration_since(*at) < RETAIN_FOR);
        self.0.iter().any(|(existing, _)| existing == key)
    }
}

pub(super) struct CloseSignal(watch::Sender<bool>);
impl Default for CloseSignal {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}
impl CloseSignal {
    pub(super) fn complete(&self) {
        self.0.send_replace(true);
    }
    pub(super) fn completed(&self) -> bool {
        *self.0.borrow()
    }
    pub(super) async fn wait(&self) {
        let mut receiver = self.0.subscribe();
        let _ = receiver.wait_for(|complete| *complete).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key(attempt: &str) -> CloseKey {
        CloseKey::new("main", "db", "connection", "session", attempt)
    }

    #[test]
    fn late_close_requires_every_owner_component_and_native_receipt() {
        let mut receipts = CloseReceipts::default();
        let now = Instant::now();
        let original = key("one");
        assert!(!receipts.contains(&original, now));
        receipts.insert(original.clone(), now);
        assert!(receipts.contains(&original, now));
        for component in 0..5 {
            let mut wrong = original.clone();
            match component {
                0 => wrong.window.push('x'),
                1 => wrong.owner.push('x'),
                2 => wrong.connection.push('x'),
                3 => wrong.session.push('x'),
                _ => wrong.attempt.push('x'),
            }
            assert!(!receipts.contains(&wrong, now));
        }
        assert!(receipts.contains(&original, now));
    }

    #[test]
    fn receipts_are_bounded_expire_and_do_not_hold_sessions() {
        let mut receipts = CloseReceipts::default();
        let now = Instant::now();
        for n in 0..=CAPACITY {
            receipts.insert(key(&n.to_string()), now);
        }
        assert_eq!(receipts.0.len(), CAPACITY);
        assert!(!receipts.contains(&key("0"), now));
        let newest = key(&CAPACITY.to_string());
        assert!(receipts.contains(&newest, now));
        receipts.insert(newest.clone(), now);
        assert_eq!(receipts.0.len(), CAPACITY);
        assert!(!receipts.contains(&newest, now + RETAIN_FOR));
        assert!(receipts.0.is_empty());
    }

    #[tokio::test]
    async fn close_waits_for_acknowledgment_and_cannot_lose_an_early_ack() {
        let signal = CloseSignal::default();
        assert!(!signal.completed());
        assert!(
            tokio::time::timeout(Duration::from_millis(10), signal.wait())
                .await
                .is_err()
        );
        signal.complete();
        assert!(signal.completed());
        tokio::time::timeout(Duration::from_millis(100), signal.wait())
            .await
            .unwrap();
        // Duplicated close and duplicated native completion are idempotent.
        signal.complete();
        tokio::time::timeout(Duration::from_millis(100), signal.wait())
            .await
            .unwrap();
    }
}
