//! Test-only socket evidence. No CEF dependency: exercise with `rustc --test`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Pending,
    AllowSubmitted,
    Deny,
    Cancel,
    StaleAttempt,
}
impl Decision {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::AllowSubmitted => "allow-submitted",
            Self::Deny => "deny",
            Self::Cancel => "cancel",
            Self::StaleAttempt => "stale-attempt",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Completed,
    Eof,
    TlsError,
    IoError,
    Timeout,
    Cancelled,
}
impl Outcome {
    pub fn label(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Eof => "eof",
            Self::TlsError => "tls-error",
            Self::IoError => "io-error",
            Self::Timeout => "timeout",
            Self::Cancelled => "cancelled",
        }
    }
}
pub struct Socket {
    pub id: u64,
    leaf: Vec<u8>,
    pub challenge: Option<(u64, u64, u64)>,
    pub decision: Decision,
    pub tls_completed: bool,
    pub http_bytes: usize,
    pub before_decision_bytes: usize,
    pub post_revoke_bytes: usize,
    pub outcome: Option<Outcome>,
}
#[derive(Default)]
pub struct Ledger {
    pub sockets: Vec<Socket>,
    pub errors: usize,
}
impl Ledger {
    pub fn register(&mut self, id: u64, leaf: Vec<u8>) -> bool {
        if id == 0
            || leaf.is_empty()
            || self.sockets.len() >= 256
            || self.sockets.iter().any(|s| s.id == id || s.leaf == leaf)
        {
            self.errors += 1;
            return false;
        }
        self.sockets.push(Socket {
            id,
            leaf,
            challenge: None,
            decision: Decision::Pending,
            tls_completed: false,
            http_bytes: 0,
            before_decision_bytes: 0,
            post_revoke_bytes: 0,
            outcome: None,
        });
        true
    }
    pub fn bind(&mut self, leaf: &[u8], key: (u64, u64, u64)) -> Option<u64> {
        if key.0 == 0
            || key.1 == 0
            || key.2 == 0
            || self.sockets.iter().any(|s| s.challenge == Some(key))
        {
            self.errors += 1;
            return None;
        }
        let Some(socket) = self.sockets.iter_mut().find(|s| s.leaf == leaf) else {
            self.errors += 1;
            return None;
        };
        if socket.challenge.is_some() || socket.outcome.is_some() {
            self.errors += 1;
            return None;
        }
        socket.challenge = Some(key);
        Some(socket.id)
    }
    pub fn decide(&mut self, id: u64, decision: Decision) -> bool {
        let Some(socket) = self.sockets.iter_mut().find(|s| s.id == id) else {
            self.errors += 1;
            return false;
        };
        if socket.challenge.is_none()
            || socket.decision != Decision::Pending
            || decision == Decision::Pending
        {
            self.errors += 1;
            return false;
        }
        socket.decision = decision;
        true
    }
    pub fn bytes(&mut self, id: u64, n: usize, revoked: bool) {
        if let Some(s) = self.sockets.iter_mut().find(|s| s.id == id) {
            s.http_bytes += n;
            if s.decision != Decision::AllowSubmitted || s.challenge.is_none() {
                s.before_decision_bytes += n;
            }
            if revoked {
                s.post_revoke_bytes += n;
            }
        } else {
            self.errors += 1;
        }
    }
    pub fn handshake(&mut self, id: u64) {
        if let Some(s) = self.sockets.iter_mut().find(|s| s.id == id) {
            s.tls_completed = true;
        } else {
            self.errors += 1;
        }
    }
    pub fn finish(&mut self, id: u64, outcome: Outcome) {
        if let Some(s) = self.sockets.iter_mut().find(|s| s.id == id) {
            if s.outcome.is_some() {
                self.errors += 1;
            } else {
                s.outcome = Some(outcome);
            }
        } else {
            self.errors += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn another_sockets_allow_cannot_hide_pending_bytes() {
        let mut l = Ledger::default();
        assert!(l.register(1, vec![1]));
        assert!(l.register(2, vec![2]));
        assert_eq!(l.bind(&[1], (7, 7, 1)), Some(1));
        assert_eq!(l.bind(&[2], (7, 7, 2)), Some(2));
        l.decide(2, Decision::AllowSubmitted);
        l.bytes(1, 8, false);
        l.bytes(2, 9, false);
        assert_eq!(l.sockets[0].before_decision_bytes, 8);
        assert_eq!(l.sockets[1].before_decision_bytes, 0);
    }
    #[test]
    fn duplicate_leaf_and_replayed_or_unknown_challenge_fail() {
        let mut l = Ledger::default();
        l.register(1, vec![1]);
        assert!(!l.register(2, vec![1]));
        l.register(2, vec![2]);
        assert_eq!(l.bind(&[1], (1, 1, 1)), Some(1));
        assert_eq!(l.bind(&[2], (1, 1, 1)), None);
        assert_eq!(l.bind(&[9], (1, 1, 2)), None);
        assert_eq!(l.bind(&[1], (1, 1, 3)), None);
        assert_eq!(l.errors, 4);
    }
    #[test]
    fn deny_cancel_and_stale_need_no_completed_handshake() {
        for decision in [Decision::Deny, Decision::Cancel, Decision::StaleAttempt] {
            let mut l = Ledger::default();
            l.register(1, vec![1]);
            l.bind(&[1], (1, 1, 1));
            l.decide(1, decision);
            l.finish(1, Outcome::TlsError);
            assert!(!l.sockets[0].tls_completed);
            assert_eq!(l.sockets[0].http_bytes, 0);
            assert_eq!(l.errors, 0);
            l.bytes(1, 1, true);
            assert_eq!(l.sockets[0].before_decision_bytes, 1);
            assert_eq!(l.sockets[0].post_revoke_bytes, 1);
        }
    }
    #[test]
    fn only_one_decision_and_outcome_per_transport() {
        let mut l = Ledger::default();
        l.register(1, vec![1]);
        l.bind(&[1], (1, 1, 1));
        assert!(l.decide(1, Decision::AllowSubmitted));
        assert!(!l.decide(1, Decision::AllowSubmitted));
        l.handshake(1);
        l.finish(1, Outcome::Completed);
        l.finish(1, Outcome::Cancelled);
        assert_eq!(l.errors, 2);
    }
    #[test]
    fn outcomes_preserve_timeouts_io_and_cancellation() {
        let outcomes = [
            Outcome::Completed,
            Outcome::Eof,
            Outcome::TlsError,
            Outcome::IoError,
            Outcome::Timeout,
            Outcome::Cancelled,
        ];
        let mut l = Ledger::default();
        for (i, outcome) in outcomes.into_iter().enumerate() {
            l.register(i as u64 + 1, vec![i as u8]);
            l.finish(i as u64 + 1, outcome);
        }
        assert!(l
            .sockets
            .iter()
            .zip(outcomes)
            .all(|(s, o)| s.outcome == Some(o)));
        assert_eq!(l.errors, 0);
        assert_eq!(Decision::Pending.label(), "pending");
        assert_eq!(Outcome::Timeout.label(), "timeout");
    }

    #[test]
    fn retained_predecessor_does_not_lend_authority_to_successor() {
        let mut old = Ledger::default();
        old.register(1, vec![1]);
        old.bind(&[1], (7, 7, 1));
        let mut next = Ledger::default();
        next.register(2, vec![2]);
        next.bind(&[2], (8, 8, 1));
        assert_eq!(old.sockets[0].decision, Decision::Pending);
        old.decide(1, Decision::StaleAttempt);
        next.decide(2, Decision::AllowSubmitted);
        old.bytes(1, 3, true);
        next.bytes(2, 5, false);
        assert_eq!(old.sockets[0].before_decision_bytes, 3);
        assert_eq!(old.sockets[0].post_revoke_bytes, 3);
        assert_eq!(next.sockets[0].before_decision_bytes, 0);
        assert_eq!(next.sockets[0].post_revoke_bytes, 0);
        assert_eq!(next.bind(&[1], (7, 7, 1)), None);
    }
}
