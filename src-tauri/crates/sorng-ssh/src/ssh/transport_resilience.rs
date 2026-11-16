//! Error classification and bounded retry policy for the libssh2 transport.
//!
//! libssh2 reports `-43` (`LIBSSH2_ERROR_SOCKET_RECV`) whenever the OS
//! `recv()` fails or returns 0 (see `_libssh2_transport_read`). `EINTR` and
//! `EWOULDBLOCK` are already mapped to `EAGAIN` inside libssh2, so a `-43`
//! is never a plain "try again" signal: it is either a hard socket failure
//! (reset, abort, OS keepalive timeout) or an orderly TCP close. A short,
//! bounded verification retry is still worthwhile because the same code also
//! surfaces from brief network blips on an otherwise live socket, and because
//! one failure on an *auxiliary* channel must not condemn the whole session.

use std::io::{self, ErrorKind};
use std::time::Duration;

pub(crate) const LIBSSH2_ERROR_SOCKET_NONE: i32 = -1;
pub(crate) const LIBSSH2_ERROR_SOCKET_SEND: i32 = -7;
pub(crate) const LIBSSH2_ERROR_TIMEOUT: i32 = -9;
pub(crate) const LIBSSH2_ERROR_SOCKET_DISCONNECT: i32 = -13;
pub(crate) const LIBSSH2_ERROR_AUTHENTICATION_FAILED: i32 = -18;
pub(crate) const LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED: i32 = -19;
pub(crate) const LIBSSH2_ERROR_CHANNEL_FAILURE: i32 = -21;
pub(crate) const LIBSSH2_ERROR_SOCKET_TIMEOUT: i32 = -30;
pub(crate) const LIBSSH2_ERROR_EAGAIN: i32 = -37;
pub(crate) const LIBSSH2_ERROR_SOCKET_RECV: i32 = -43;
pub(crate) const LIBSSH2_ERROR_BAD_SOCKET: i32 = -45;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SshErrorClass {
    /// Would-block / timeout: nothing is wrong with the transport.
    Transient,
    /// The socket reported a receive/send failure. Usually fatal, but worth a
    /// bounded verification before the session is declared dead.
    TransportSuspect,
    /// The peer sent a disconnect: retrying cannot help.
    PeerClosed,
    /// Credentials were rejected. Never retried automatically.
    Authentication,
    /// The server refused one more channel; the session itself is healthy.
    ChannelRefused,
    /// Anything else (protocol, crypto, local errors).
    Fatal,
}

impl SshErrorClass {
    /// Whether a bounded retry/verification is worth attempting.
    pub(crate) fn is_retryable(self) -> bool {
        matches!(self, Self::Transient | Self::TransportSuspect)
    }
}

pub(crate) fn classify_code(code: i32) -> SshErrorClass {
    match code {
        LIBSSH2_ERROR_EAGAIN | LIBSSH2_ERROR_TIMEOUT | LIBSSH2_ERROR_SOCKET_TIMEOUT => {
            SshErrorClass::Transient
        }
        LIBSSH2_ERROR_SOCKET_RECV
        | LIBSSH2_ERROR_SOCKET_SEND
        | LIBSSH2_ERROR_BAD_SOCKET
        | LIBSSH2_ERROR_SOCKET_NONE => SshErrorClass::TransportSuspect,
        LIBSSH2_ERROR_SOCKET_DISCONNECT => SshErrorClass::PeerClosed,
        LIBSSH2_ERROR_AUTHENTICATION_FAILED | LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED => {
            SshErrorClass::Authentication
        }
        LIBSSH2_ERROR_CHANNEL_FAILURE => SshErrorClass::ChannelRefused,
        _ => SshErrorClass::Fatal,
    }
}

pub(crate) fn classify_ssh2_error(error: &ssh2::Error) -> SshErrorClass {
    match error.code() {
        ssh2::ErrorCode::Session(code) => classify_code(code),
        _ => SshErrorClass::Fatal,
    }
}

/// `ssh2` flattens its error into an `io::Error` carrying only the message, so
/// the numeric code must come from the session's last error when available.
pub(crate) fn classify_io_error(
    error: &io::Error,
    last_session_code: Option<i32>,
) -> SshErrorClass {
    match error.kind() {
        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted => {
            return SshErrorClass::Transient
        }
        ErrorKind::ConnectionReset
        | ErrorKind::ConnectionAborted
        | ErrorKind::BrokenPipe
        | ErrorKind::UnexpectedEof
        | ErrorKind::NotConnected => return SshErrorClass::TransportSuspect,
        _ => {}
    }
    if let Some(code) = last_session_code {
        let class = classify_code(code);
        if class != SshErrorClass::Fatal {
            return class;
        }
    }
    classify_message(&error.to_string())
}

/// Last-resort classification for already-rendered messages.
pub(crate) fn classify_message(message: &str) -> SshErrorClass {
    let lower = message.to_ascii_lowercase();
    if lower.contains("socket_recv")
        || lower.contains("libssh2 code -43")
        || lower.contains("transport read")
        || lower.contains("socket_send")
        || lower.contains("libssh2 code -7 ")
    {
        SshErrorClass::TransportSuspect
    } else if lower.contains("socket_disconnect") {
        SshErrorClass::PeerClosed
    } else if lower.contains("authentication failed") {
        SshErrorClass::Authentication
    } else {
        SshErrorClass::Fatal
    }
}

/// Exponential backoff with a ceiling and an attempt cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RetryPolicy {
    pub(crate) max_attempts: u32,
    pub(crate) base_delay: Duration,
    pub(crate) max_delay: Duration,
}

/// Interactive shell read verification: 250 + 500 + 1000 + 2000 ms.
pub(crate) const SHELL_READ_RETRY: RetryPolicy = RetryPolicy {
    max_attempts: 4,
    base_delay: Duration::from_millis(250),
    max_delay: Duration::from_secs(2),
};

/// Keepalive probes run on a slower cadence; tolerate a few misses before the
/// auxiliary task stops.
pub(crate) const KEEPALIVE_RETRY: RetryPolicy = RetryPolicy {
    max_attempts: 5,
    base_delay: Duration::from_millis(0),
    max_delay: Duration::from_millis(0),
};

impl RetryPolicy {
    /// Delay before the 1-based `attempt`.
    pub(crate) fn delay_for(&self, attempt: u32) -> Duration {
        let exponent = attempt.saturating_sub(1).min(16);
        let scaled = self
            .base_delay
            .checked_mul(1u32 << exponent)
            .unwrap_or(self.max_delay);
        scaled.min(self.max_delay)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RetryDecision {
    Retry { attempt: u32, delay: Duration },
    GiveUp { attempts: u32 },
}

/// Tracks consecutive failures on one transport path. Never loops forever:
/// the attempt counter only resets on a confirmed success.
#[derive(Debug, Clone)]
pub(crate) struct FailureTracker {
    policy: RetryPolicy,
    consecutive: u32,
}

impl FailureTracker {
    pub(crate) fn new(policy: RetryPolicy) -> Self {
        Self {
            policy,
            consecutive: 0,
        }
    }

    pub(crate) fn consecutive(&self) -> u32 {
        self.consecutive
    }

    pub(crate) fn max_attempts(&self) -> u32 {
        self.policy.max_attempts
    }

    /// Records a failure. Non-retryable classes give up immediately.
    pub(crate) fn on_failure(&mut self, class: SshErrorClass) -> RetryDecision {
        if !class.is_retryable() {
            return RetryDecision::GiveUp {
                attempts: self.consecutive,
            };
        }
        if self.consecutive >= self.policy.max_attempts {
            return RetryDecision::GiveUp {
                attempts: self.consecutive,
            };
        }
        self.consecutive += 1;
        RetryDecision::Retry {
            attempt: self.consecutive,
            delay: self.policy.delay_for(self.consecutive),
        }
    }

    /// Records a success; returns true when this recovered from failures.
    pub(crate) fn on_success(&mut self) -> bool {
        let recovered = self.consecutive > 0;
        self.consecutive = 0;
        recovered
    }
}

/// What the keepalive task should do after one probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KeepaliveAction {
    Continue,
    Stop,
}

pub(crate) fn keepalive_step(
    tracker: &mut FailureTracker,
    result: Result<(), &ssh2::Error>,
) -> KeepaliveAction {
    match result {
        Ok(()) => {
            tracker.on_success();
            KeepaliveAction::Continue
        }
        Err(error) => match tracker.on_failure(classify_ssh2_error(error)) {
            RetryDecision::Retry { .. } => KeepaliveAction::Continue,
            RetryDecision::GiveUp { .. } => KeepaliveAction::Stop,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_error(code: i32) -> ssh2::Error {
        ssh2::Error::new(ssh2::ErrorCode::Session(code), "synthetic")
    }

    #[test]
    fn socket_recv_is_suspect_not_transient_or_fatal() {
        assert_eq!(classify_code(-43), SshErrorClass::TransportSuspect);
        assert!(classify_code(-43).is_retryable());
        assert_eq!(
            classify_ssh2_error(&session_error(-43)),
            SshErrorClass::TransportSuspect
        );
    }

    #[test]
    fn code_classes_cover_transient_peer_auth_and_refusal() {
        assert_eq!(classify_code(-37), SshErrorClass::Transient);
        assert_eq!(classify_code(-9), SshErrorClass::Transient);
        assert_eq!(classify_code(-30), SshErrorClass::Transient);
        assert_eq!(classify_code(-13), SshErrorClass::PeerClosed);
        assert_eq!(classify_code(-18), SshErrorClass::Authentication);
        assert_eq!(classify_code(-19), SshErrorClass::Authentication);
        assert_eq!(classify_code(-21), SshErrorClass::ChannelRefused);
        assert_eq!(classify_code(-5), SshErrorClass::Fatal);
        assert!(!SshErrorClass::PeerClosed.is_retryable());
        assert!(!SshErrorClass::Authentication.is_retryable());
        assert!(!SshErrorClass::Fatal.is_retryable());
    }

    #[test]
    fn io_errors_use_kind_then_session_code_then_message() {
        let would_block = io::Error::from(ErrorKind::WouldBlock);
        assert_eq!(
            classify_io_error(&would_block, None),
            SshErrorClass::Transient
        );
        let flattened = io::Error::new(ErrorKind::Other, "transport read");
        assert_eq!(
            classify_io_error(&flattened, Some(-43)),
            SshErrorClass::TransportSuspect
        );
        // The message alone still identifies the receive failure.
        assert_eq!(
            classify_io_error(&flattened, None),
            SshErrorClass::TransportSuspect
        );
        // A stale last-error must not downgrade a recognisable message.
        assert_eq!(
            classify_io_error(&flattened, Some(-5)),
            SshErrorClass::TransportSuspect
        );
        let reset = io::Error::from(ErrorKind::ConnectionReset);
        assert_eq!(
            classify_io_error(&reset, None),
            SshErrorClass::TransportSuspect
        );
        let other = io::Error::new(ErrorKind::Other, "something else");
        assert_eq!(classify_io_error(&other, None), SshErrorClass::Fatal);
    }

    #[test]
    fn backoff_is_exponential_and_capped() {
        let delays: Vec<u64> = (1..=6)
            .map(|attempt| SHELL_READ_RETRY.delay_for(attempt).as_millis() as u64)
            .collect();
        assert_eq!(delays, vec![250, 500, 1000, 2000, 2000, 2000]);
        // Absurd attempt counts must not overflow.
        assert_eq!(SHELL_READ_RETRY.delay_for(u32::MAX), Duration::from_secs(2));
    }

    #[test]
    fn tracker_retries_then_gives_up_within_the_bound() {
        let mut tracker = FailureTracker::new(SHELL_READ_RETRY);
        let mut total = Duration::ZERO;
        for expected in 1..=4 {
            match tracker.on_failure(SshErrorClass::TransportSuspect) {
                RetryDecision::Retry { attempt, delay } => {
                    assert_eq!(attempt, expected);
                    total += delay;
                }
                other => panic!("expected retry, got {other:?}"),
            }
        }
        assert_eq!(total, Duration::from_millis(3750));
        assert_eq!(
            tracker.on_failure(SshErrorClass::TransportSuspect),
            RetryDecision::GiveUp { attempts: 4 }
        );
        // Giving up is sticky until a success is observed: no unbounded loop.
        assert!(matches!(
            tracker.on_failure(SshErrorClass::TransportSuspect),
            RetryDecision::GiveUp { .. }
        ));
    }

    #[test]
    fn tracker_never_retries_authentication_or_peer_close() {
        for class in [
            SshErrorClass::Authentication,
            SshErrorClass::PeerClosed,
            SshErrorClass::Fatal,
            SshErrorClass::ChannelRefused,
        ] {
            let mut tracker = FailureTracker::new(SHELL_READ_RETRY);
            assert_eq!(
                tracker.on_failure(class),
                RetryDecision::GiveUp { attempts: 0 },
                "{class:?}"
            );
        }
    }

    #[test]
    fn success_clears_the_failure_state_and_reports_recovery() {
        let mut tracker = FailureTracker::new(SHELL_READ_RETRY);
        assert!(!tracker.on_success());
        tracker.on_failure(SshErrorClass::TransportSuspect);
        tracker.on_failure(SshErrorClass::TransportSuspect);
        assert_eq!(tracker.consecutive(), 2);
        assert!(tracker.on_success());
        assert_eq!(tracker.consecutive(), 0);
        // A fresh blip gets the full budget again.
        assert!(matches!(
            tracker.on_failure(SshErrorClass::TransportSuspect),
            RetryDecision::Retry { attempt: 1, .. }
        ));
    }

    #[test]
    fn keepalive_survives_isolated_failures_and_stops_when_persistent() {
        let mut tracker = FailureTracker::new(KEEPALIVE_RETRY);
        let recv = session_error(-43);
        for _ in 0..KEEPALIVE_RETRY.max_attempts {
            assert_eq!(
                keepalive_step(&mut tracker, Err(&recv)),
                KeepaliveAction::Continue
            );
        }
        assert_eq!(
            keepalive_step(&mut tracker, Err(&recv)),
            KeepaliveAction::Stop
        );

        let mut tracker = FailureTracker::new(KEEPALIVE_RETRY);
        assert_eq!(
            keepalive_step(&mut tracker, Err(&recv)),
            KeepaliveAction::Continue
        );
        assert_eq!(
            keepalive_step(&mut tracker, Ok(())),
            KeepaliveAction::Continue
        );
        assert_eq!(tracker.consecutive(), 0);
    }

    #[test]
    fn keepalive_stops_immediately_on_peer_disconnect() {
        let mut tracker = FailureTracker::new(KEEPALIVE_RETRY);
        let closed = session_error(-13);
        assert_eq!(
            keepalive_step(&mut tracker, Err(&closed)),
            KeepaliveAction::Stop
        );
    }
}
