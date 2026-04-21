//! Reconnect loop (SE-6) — Cedar `Client.c::CiReconnect` analogue.
//!
//! Wraps a session-building closure in an exponential-backoff retry
//! loop. The closure returns `Result<Session, TerminalError>`; on
//! transient errors the loop sleeps and retries, on fatal errors it
//! gives up immediately, and once a session is returned the loop waits
//! on its terminal handle (same `is_transient` taxonomy) before
//! considering another retry.
//!
//! # Cedar reference
//!
//! Cedar's `Client.c::CiReconnect` re-establishes the TCP+TLS session
//! with a bounded retry count (`Session->RetryInterval`, in seconds;
//! Cedar's `Wait(session->HaltEvent, session->RetryInterval)` appears
//! at Client.c:797 and :891). Exponential growth + jitter are not in
//! the stock Cedar but are standard practice for client-driven
//! reconnects and do not violate the protocol.
//!
//! # Threading
//!
//! The loop itself is `async`, driven by a `tokio::spawn`ed task owned
//! by the calling `SoftEtherService`. Retries are `tokio::time::sleep`
//! (never `std::thread::sleep`) so the command thread stays unblocked.

use std::time::Duration;

use rand::Rng;
use tokio::sync::watch;

// ─── Policy ─────────────────────────────────────────────────────────────

/// Reconnect-backoff tunables.
#[derive(Debug, Clone)]
pub struct ReconnectPolicy {
    /// Absolute upper bound on retry attempts before the loop gives up
    /// with [`ReconnectError::MaxAttemptsReached`]. A successful
    /// session resets the counter.
    pub max_attempts: u32,
    /// Base delay before the first retry. Subsequent retries double
    /// this (capped at `max_delay`) and add jitter.
    pub base_delay: Duration,
    /// Ceiling on any single sleep between retries.
    pub max_delay: Duration,
    /// Upper bound on the random jitter (in milliseconds) added to
    /// each backoff. `rand::thread_rng().gen_range(0..=jitter_ms)`.
    pub jitter_ms: u64,
    /// Total time the reconnect loop is allowed to run before bailing
    /// with [`ReconnectError::GiveUpTimeoutExceeded`]. Includes sleeps
    /// + session time. `Duration::MAX` effectively disables this.
    pub give_up_after: Duration,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 10,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
            jitter_ms: 500,
            give_up_after: Duration::from_secs(3600),
        }
    }
}

impl ReconnectPolicy {
    /// Compute the sleep before attempt `attempt_number` (0-indexed:
    /// `0` = the first retry, which still sleeps `base_delay`).
    /// `delay = min(base * 2^attempt + jitter, max_delay)`.
    pub fn backoff(&self, attempt_number: u32) -> Duration {
        // Saturating shift — cap the doubling at `max_delay` immediately
        // once it'd overflow.
        let shift = attempt_number.min(16); // 2^16 is already ~18h with base=1s
        let doubled = self
            .base_delay
            .checked_mul(1u32 << shift)
            .unwrap_or(self.max_delay);
        let jitter = if self.jitter_ms == 0 {
            Duration::ZERO
        } else {
            Duration::from_millis(rand::thread_rng().gen_range(0..=self.jitter_ms))
        };
        (doubled + jitter).min(self.max_delay)
    }
}

// ─── Errors ─────────────────────────────────────────────────────────────

/// Terminal outcome of the reconnect loop.
#[derive(Debug)]
pub enum ReconnectError {
    /// `policy.max_attempts` transient failures in a row.
    MaxAttemptsReached { attempts: u32, last_err: String },
    /// `policy.give_up_after` elapsed before a stable session was held.
    GiveUpTimeoutExceeded { attempts: u32, last_err: String },
    /// Non-retryable (auth, cert, hub missing, etc).
    FatalError(String),
    /// External shutdown signal fired while the loop was running.
    ShutdownRequested,
}

impl std::fmt::Display for ReconnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MaxAttemptsReached { attempts, last_err } => write!(
                f,
                "reconnect exhausted after {} attempts: {}",
                attempts, last_err
            ),
            Self::GiveUpTimeoutExceeded { attempts, last_err } => write!(
                f,
                "reconnect give-up timeout exceeded after {} attempts: {}",
                attempts, last_err
            ),
            Self::FatalError(e) => write!(f, "reconnect fatal: {}", e),
            Self::ShutdownRequested => write!(f, "reconnect cancelled by shutdown"),
        }
    }
}

impl std::error::Error for ReconnectError {}

// ─── Callback-style attempt outcome ─────────────────────────────────────

/// What the caller returns from a single session-building attempt.
///
/// The generic `Session` slot is whatever the caller treats as a live
/// session — in our real integration it will be a tuple carrying the
/// dataplane `JoinHandle` + metadata. For testing we use `()`.
#[derive(Debug)]
pub enum AttemptOutcome<Session> {
    /// Session built successfully. The reconnect loop will await the
    /// supplied "session done" future before considering a retry.
    Ok(Session),
    /// Attempt failed transiently — sleep and try again.
    Transient(String),
    /// Attempt failed in a non-retryable way — abort the loop.
    Fatal(String),
}

// ─── Public API ─────────────────────────────────────────────────────────

/// Drive a reconnect loop using the user-supplied attempt future.
///
/// * `make_attempt` — async closure that runs one full handshake + data-plane
///   spawn cycle and returns an [`AttemptOutcome`].
/// * `session_done` — async closure that, given a live session, awaits
///   its terminal error (or clean exit). Returns `None` for a clean
///   end (loop exits `Ok(())`), `Some(true)` for a transient error
///   (sleep + retry), or `Some(false)` for a fatal one (abort).
/// * `shutdown` — cancellation signal; any `true` flip exits the loop.
///
/// The two closures are separated so tests can synthesise both halves
/// without needing real TLS + TAP plumbing.
pub async fn reconnect_loop<MakeAttempt, AttemptFut, SessionDone, DoneFut, Session, OnStatus>(
    policy: ReconnectPolicy,
    mut shutdown: watch::Receiver<bool>,
    mut on_status: OnStatus,
    mut make_attempt: MakeAttempt,
    mut session_done: SessionDone,
) -> Result<(), ReconnectError>
where
    MakeAttempt: FnMut() -> AttemptFut,
    AttemptFut: std::future::Future<Output = AttemptOutcome<Session>>,
    SessionDone: FnMut(Session) -> DoneFut,
    DoneFut: std::future::Future<Output = SessionDoneOutcome>,
    OnStatus: FnMut(ReconnectEvent),
{
    let started = tokio::time::Instant::now();
    let mut consecutive_failures: u32 = 0;
    let mut last_err = String::new();

    loop {
        // ── Global give-up budget ───────────────────────────────────
        if started.elapsed() >= policy.give_up_after {
            return Err(ReconnectError::GiveUpTimeoutExceeded {
                attempts: consecutive_failures,
                last_err,
            });
        }

        // ── Attempt-count budget ────────────────────────────────────
        if consecutive_failures >= policy.max_attempts {
            return Err(ReconnectError::MaxAttemptsReached {
                attempts: consecutive_failures,
                last_err,
            });
        }

        // ── Shutdown check (non-blocking) ───────────────────────────
        if *shutdown.borrow() {
            return Err(ReconnectError::ShutdownRequested);
        }

        on_status(ReconnectEvent::Attempting {
            attempt_number: consecutive_failures + 1,
        });

        // ── One attempt ─────────────────────────────────────────────
        let outcome = tokio::select! {
            biased;
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    return Err(ReconnectError::ShutdownRequested);
                }
                continue;
            }
            o = make_attempt() => o,
        };

        match outcome {
            AttemptOutcome::Ok(session) => {
                on_status(ReconnectEvent::Connected {
                    attempt_number: consecutive_failures + 1,
                });
                // Session is live — reset failure counter on entry, then
                // wait for its terminal state.
                consecutive_failures = 0;
                let done = tokio::select! {
                    biased;
                    _ = shutdown.changed() => {
                        if *shutdown.borrow() {
                            return Err(ReconnectError::ShutdownRequested);
                        }
                        continue;
                    }
                    d = session_done(session) => d,
                };
                match done {
                    SessionDoneOutcome::Clean => return Ok(()),
                    SessionDoneOutcome::Transient(e) => {
                        last_err = e;
                        consecutive_failures += 1;
                        // fallthrough to backoff + retry
                    }
                    SessionDoneOutcome::Fatal(e) => {
                        return Err(ReconnectError::FatalError(e));
                    }
                }
            }
            AttemptOutcome::Transient(e) => {
                last_err = e;
                consecutive_failures += 1;
            }
            AttemptOutcome::Fatal(e) => {
                return Err(ReconnectError::FatalError(e));
            }
        }

        // ── Backoff + retry ─────────────────────────────────────────
        let delay = policy.backoff(consecutive_failures - 1);
        on_status(ReconnectEvent::Backoff {
            attempt_number: consecutive_failures + 1,
            next_delay_ms: delay.as_millis() as u64,
        });

        tokio::select! {
            biased;
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    return Err(ReconnectError::ShutdownRequested);
                }
            }
            _ = tokio::time::sleep(delay) => {}
        }
    }
}

/// Status ticks emitted to the caller-supplied `on_status` callback.
/// The service layer maps these to `vpn::status-changed` events.
#[derive(Debug, Clone)]
pub enum ReconnectEvent {
    /// About to try attempt N.
    Attempting { attempt_number: u32 },
    /// Attempt N succeeded — a session is live.
    Connected { attempt_number: u32 },
    /// Attempt N failed transiently; will sleep `next_delay_ms`.
    Backoff {
        attempt_number: u32,
        next_delay_ms: u64,
    },
}

/// Outcome of awaiting a live session to termination.
#[derive(Debug)]
pub enum SessionDoneOutcome {
    /// Session closed cleanly (graceful shutdown).
    Clean,
    /// Session errored in a retryable way.
    Transient(String),
    /// Session errored in a fatal way — stop the loop.
    Fatal(String),
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    fn tiny_policy() -> ReconnectPolicy {
        ReconnectPolicy {
            max_attempts: 5,
            base_delay: Duration::from_millis(5),
            max_delay: Duration::from_millis(50),
            jitter_ms: 2,
            give_up_after: Duration::from_secs(60),
        }
    }

    fn noop_status() -> impl FnMut(ReconnectEvent) {
        |_| {}
    }

    #[test]
    fn backoff_is_monotonic_and_bounded() {
        let p = ReconnectPolicy {
            max_attempts: 20,
            base_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(64),
            jitter_ms: 0,
            give_up_after: Duration::from_secs(60),
        };
        // No jitter — deterministic.
        assert_eq!(p.backoff(0), Duration::from_millis(1));
        assert_eq!(p.backoff(1), Duration::from_millis(2));
        assert_eq!(p.backoff(2), Duration::from_millis(4));
        assert_eq!(p.backoff(6), Duration::from_millis(64));
        // Ceiling enforced.
        assert_eq!(p.backoff(10), Duration::from_millis(64));
        // Saturating shift — even u32::MAX shouldn't panic.
        assert_eq!(p.backoff(u32::MAX), Duration::from_millis(64));
    }

    #[test]
    fn backoff_jitter_stays_within_max_delay() {
        let p = ReconnectPolicy {
            max_attempts: 20,
            base_delay: Duration::from_millis(10),
            max_delay: Duration::from_millis(20),
            jitter_ms: 1000, // huge jitter — must be clamped
            give_up_after: Duration::from_secs(60),
        };
        for _ in 0..20 {
            let d = p.backoff(0);
            assert!(d <= Duration::from_millis(20), "{:?}", d);
        }
    }

    #[tokio::test]
    async fn immediate_success_exits_ok() {
        let (_tx, rx) = watch::channel(false);
        let res = reconnect_loop(
            tiny_policy(),
            rx,
            noop_status(),
            || async { AttemptOutcome::Ok(()) },
            |()| async { SessionDoneOutcome::Clean },
        )
        .await;
        assert!(matches!(res, Ok(())));
    }

    #[tokio::test]
    async fn transient_failures_then_success() {
        let (_tx, rx) = watch::channel(false);
        let counter = Arc::new(AtomicU32::new(0));
        let c1 = counter.clone();
        let res = reconnect_loop(
            tiny_policy(),
            rx,
            noop_status(),
            move || {
                let c = c1.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n < 3 {
                        AttemptOutcome::Transient(format!("fail-{}", n))
                    } else {
                        AttemptOutcome::Ok(())
                    }
                }
            },
            |()| async { SessionDoneOutcome::Clean },
        )
        .await;
        assert!(matches!(res, Ok(())));
        assert_eq!(counter.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn fatal_failure_returns_fatal_without_retrying() {
        let (_tx, rx) = watch::channel(false);
        let counter = Arc::new(AtomicU32::new(0));
        let c1 = counter.clone();
        let res = reconnect_loop(
            tiny_policy(),
            rx,
            noop_status(),
            move || {
                let c = c1.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    AttemptOutcome::Fatal("bad password".into())
                }
            },
            |()| async { SessionDoneOutcome::Clean },
        )
        .await;
        assert!(matches!(res, Err(ReconnectError::FatalError(_))));
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn max_attempts_exhausted() {
        let (_tx, rx) = watch::channel(false);
        let mut policy = tiny_policy();
        policy.max_attempts = 3;
        let res = reconnect_loop(
            policy,
            rx,
            noop_status(),
            || async { AttemptOutcome::Transient("persist".into()) },
            |()| async { SessionDoneOutcome::Clean },
        )
        .await;
        match res {
            Err(ReconnectError::MaxAttemptsReached { attempts, .. }) => {
                assert_eq!(attempts, 3);
            }
            other => panic!("expected MaxAttemptsReached, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn give_up_after_timeout() {
        let (_tx, rx) = watch::channel(false);
        let policy = ReconnectPolicy {
            max_attempts: u32::MAX,
            base_delay: Duration::from_millis(20),
            max_delay: Duration::from_millis(20),
            jitter_ms: 0,
            give_up_after: Duration::from_millis(80),
        };
        let res = reconnect_loop(
            policy,
            rx,
            noop_status(),
            || async { AttemptOutcome::Transient("slow".into()) },
            |()| async { SessionDoneOutcome::Clean },
        )
        .await;
        match res {
            Err(ReconnectError::GiveUpTimeoutExceeded { .. }) => {}
            other => panic!("expected GiveUpTimeoutExceeded, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn shutdown_mid_retry_exits_with_shutdown_error() {
        let (tx, rx) = watch::channel(false);
        let policy = ReconnectPolicy {
            max_attempts: 10,
            base_delay: Duration::from_millis(200),
            max_delay: Duration::from_millis(200),
            jitter_ms: 0,
            give_up_after: Duration::from_secs(60),
        };
        let handle = tokio::spawn(async move {
            reconnect_loop(
                policy,
                rx,
                noop_status(),
                || async { AttemptOutcome::Transient("x".into()) },
                |()| async { SessionDoneOutcome::Clean },
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let _ = tx.send(true);
        let res = tokio::time::timeout(Duration::from_millis(500), handle).await;
        match res {
            Ok(Ok(Err(ReconnectError::ShutdownRequested))) => {}
            other => panic!("expected ShutdownRequested, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn session_transient_triggers_retry() {
        let (_tx, rx) = watch::channel(false);
        let counter = Arc::new(AtomicU32::new(0));
        let c1 = counter.clone();
        let res = reconnect_loop(
            tiny_policy(),
            rx,
            noop_status(),
            || async { AttemptOutcome::Ok(()) },
            move |()| {
                let c = c1.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n < 2 {
                        SessionDoneOutcome::Transient(format!("drop-{}", n))
                    } else {
                        SessionDoneOutcome::Clean
                    }
                }
            },
        )
        .await;
        assert!(matches!(res, Ok(())));
        assert_eq!(counter.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn session_fatal_exits_fatal() {
        let (_tx, rx) = watch::channel(false);
        let res = reconnect_loop(
            tiny_policy(),
            rx,
            noop_status(),
            || async { AttemptOutcome::Ok(()) },
            |()| async { SessionDoneOutcome::Fatal("auth revoked mid-session".into()) },
        )
        .await;
        assert!(matches!(res, Err(ReconnectError::FatalError(_))));
    }

    #[tokio::test]
    async fn status_events_fire_in_order() {
        let (_tx, rx) = watch::channel(false);
        let log: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log2 = log.clone();
        let on_status = move |ev: ReconnectEvent| {
            let tag = match ev {
                ReconnectEvent::Attempting { .. } => "attempt",
                ReconnectEvent::Connected { .. } => "connected",
                ReconnectEvent::Backoff { .. } => "backoff",
            };
            log2.lock().unwrap().push(tag.to_string());
        };
        let counter = Arc::new(AtomicU32::new(0));
        let c1 = counter.clone();
        let _ = reconnect_loop(
            tiny_policy(),
            rx,
            on_status,
            move || {
                let c = c1.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n == 0 {
                        AttemptOutcome::Transient("x".into())
                    } else {
                        AttemptOutcome::Ok(())
                    }
                }
            },
            |()| async { SessionDoneOutcome::Clean },
        )
        .await;
        let events = log.lock().unwrap().clone();
        // Expect: attempt, backoff, attempt, connected.
        assert_eq!(events, vec!["attempt", "backoff", "attempt", "connected"]);
    }
}
