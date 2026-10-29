//! Actual-handshake admission for the patched CEF engine. No renderer verdict,
//! URL inspection request, or error-only callback can authorize a certificate.
use super::diagnostics::{self, Navigation, TlsBridgeFailure};
use super::Attempt;
use sorng_browser_host::cef_tls_bridge::{
    self, NativeTlsCaMode, NativeTlsCompletion, NativeTlsDecision, NativeTlsEvidence,
    NativeTlsFailure, NativeTlsHooks,
};
use sorng_commands_core::origin_browser_authority::{
    NativeCertificateAuthority, NativeCertificateDecision, NativeCertificateEvidence,
};
use sorng_encryption::EncryptionState;
use sorng_protocols::origin_browser::BrowserIdentity;
use sorng_protocols::private_forward_proxy::intercept::InterceptAuthority;
use std::sync::{atomic::AtomicU32, Arc, OnceLock, Weak};
use tauri::{Manager, WebviewWindow};
use super::certificate_review::review_certificate;

// t-mitmproxy: upstream trust for intercepting attempts (the proxy's own
// handshake evidence through the same authority, records and prompt).
#[path = "origin_browser_upstream_trust.rs"]
pub(super) mod upstream_trust;

pub(super) struct CertificateHooks {
    attempt: Weak<Attempt>,
    authority: Arc<NativeCertificateAuthority>,
    window: WebviewWindow,
    timing_samples: AtomicU32,
    owner_rechecks: Arc<owner_rechecks::Coalesced>,
    // Set only for an intercepting attempt (CUSTOM_ONLY context whose single
    // anchor is this authority's CA). Unset keeps the verified CEF path.
    intercept: OnceLock<Arc<InterceptAuthority>>,
}

impl CertificateHooks {
    pub(super) fn new(
        attempt: &Arc<Attempt>,
        authority: Arc<NativeCertificateAuthority>,
        window: WebviewWindow,
    ) -> Arc<Self> {
        Arc::new(Self {
            attempt: Arc::downgrade(attempt),
            authority,
            window,
            timing_samples: AtomicU32::new(0),
            owner_rechecks: Arc::default(),
            intercept: OnceLock::new(),
        })
    }

    /// Marks this attempt as intercepting: from now on the engine may only
    /// admit leaves this authority minted (synchronous fast path), and the
    /// app decides upstream trust in the proxy instead. Set once, before the
    /// context is created; a second call is refused.
    pub(super) fn intercept_with(&self, authority: Arc<InterceptAuthority>) -> bool {
        self.intercept.set(authority).is_ok()
    }
}

impl NativeTlsHooks for CertificateHooks {
    fn is_current(&self) -> bool {
        self.attempt
            .upgrade()
            .is_some_and(|attempt| attempt.current())
    }

    fn on_failure(&self) {
        diagnostics::navigation(Navigation::TlsFailed);
        if let Some(attempt) = self.attempt.upgrade() {
            attempt.revoke_for(super::BrowserSessionFailure::CertificateBridge);
        }
    }

    fn on_failure_reason(&self, reason: NativeTlsFailure) {
        let fixed = match reason {
            NativeTlsFailure::ContextCreation => TlsBridgeFailure::ContextCreation,
            NativeTlsFailure::ProxyConfiguration => TlsBridgeFailure::ProxyConfiguration,
            NativeTlsFailure::InvalidEvidence => TlsBridgeFailure::InvalidEvidence,
            NativeTlsFailure::InvalidState => TlsBridgeFailure::InvalidState,
            NativeTlsFailure::OwnerUnavailable => TlsBridgeFailure::OwnerUnavailable,
            NativeTlsFailure::Callback => TlsBridgeFailure::Callback,
            NativeTlsFailure::CompleteRejected => TlsBridgeFailure::CompleteRejected,
            NativeTlsFailure::RevokeRejected => TlsBridgeFailure::RevokeRejected,
            NativeTlsFailure::EngineRevoked => TlsBridgeFailure::EngineRevoked,
            NativeTlsFailure::EngineFailure => TlsBridgeFailure::EngineFailure,
            NativeTlsFailure::PoisonedState => TlsBridgeFailure::PoisonedState,
            NativeTlsFailure::WrongThread => TlsBridgeFailure::WrongThread,
        };
        diagnostics::navigation(Navigation::TlsBridgeFailed { reason: fixed });
        if let Some(attempt) = self.attempt.upgrade() {
            if reason == NativeTlsFailure::OwnerUnavailable {
                attempt.revoke();
            } else if reason == NativeTlsFailure::ProxyConfiguration {
                attempt.revoke_for(super::BrowserSessionFailure::PrivateProxy);
            } else {
                attempt.revoke_for(super::BrowserSessionFailure::CertificateBridge);
            }
        }
    }

    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion) {
        diagnostics::navigation(Navigation::TlsEvidence {
            code: evidence.native_error,
            fatal: evidence.fatal_error,
        });
        let Some(attempt) = self.attempt.upgrade().filter(|attempt| attempt.current()) else {
            return; // Dropping the single-use completion queues denial.
        };
        if let Some(intercept) = self.intercept.get() {
            // t-mitmproxy fast path: the proxy owns upstream trust, so the
            // engine only has to prove it reached our own minted leaf. No
            // owner recheck, trust store, authority evaluation or prompt.
            let decision = intercepted_admission(attempt.current(), &evidence, intercept.as_ref());
            if decision == NativeTlsDecision::Deny {
                diagnostics::navigation(Navigation::TlsDenied);
                return; // Dropping the completion queues denial.
            }
            diagnostics::navigation(Navigation::TlsAllow);
            let _ = self.window.run_on_main_thread(move || {
                completion.complete(if attempt.current() {
                    decision
                } else {
                    NativeTlsDecision::Deny
                });
                if cef_tls_bridge::pump_tls().is_err() {
                    attempt.revoke();
                }
            });
            return;
        }
        // Do not even create TOFU records for a native failure the engine cannot
        // override (revocation, fatal/HSTS, CT, weak keys, malformed evidence).
        let Some(decision) = admissible_native_result(
            evidence.native_error,
            evidence.fatal_error,
            evidence.allowed_exception_mask,
        ) else {
            return;
        };
        let authority = self.authority.clone();
        let window = self.window.clone();
        let mut timing = tls_timing(&self.timing_samples);
        let rechecks = self.owner_rechecks.clone();
        tauri::async_runtime::spawn(async move {
            timing.phase(timing::Phase::OwnerBefore);
            let state = window.state::<EncryptionState>();
            if !rechecks
                .recheck(|| async { attempt.lease.recheck(&window, &state).await.is_ok() })
                .await
            {
                timing.outcome(timing::Outcome::OwnerDenied);
                return;
            }
            let certificate = cef_certificate_evidence(attempt.identity.clone(), &evidence);
            let origin = evidence.origin;
            let chain = evidence.peer_chain;
            timing.phase(timing::Phase::Certificate);
            let verdict = authority.evaluate(certificate).await;
            timing.phase(timing::Phase::Review);
            let permit = match verdict {
                Ok(NativeCertificateDecision::Allow(permit)) => {
                    diagnostics::navigation(Navigation::TlsAllow);
                    Some(permit)
                }
                Ok(NativeCertificateDecision::Review(review)) => {
                    diagnostics::navigation(Navigation::TlsReview);
                    review_certificate(&window, &state, &attempt, *review).await
                }
                _ => {
                    diagnostics::navigation(Navigation::TlsDenied);
                    timing.outcome(timing::Outcome::PolicyDenied);
                    None
                }
            };
            let Some(permit) = permit else {
                return;
            };
            timing.phase(timing::Phase::OwnerAfter);
            if !rechecks
                .recheck(|| async { attempt.lease.recheck(&window, &state).await.is_ok() })
                .await
            {
                timing.outcome(timing::Outcome::OwnerDenied);
                return;
            }
            // Recheck the exact native chain/owner/expiry on CEF UI immediately
            // before draining the completion. A delayed UI cannot use an
            // expired permit merely because async work previously approved it.
            timing.phase(timing::Phase::UiQueue);
            let _ = window.run_on_main_thread(move || {
                timing.phase(timing::Phase::UiCompletion);
                if attempt.current() && permit.permits(&attempt.identity, &origin, &chain) {
                    completion.complete(decision);
                    timing.outcome(timing::Outcome::Admitted);
                } else {
                    completion.complete(NativeTlsDecision::Deny);
                    timing.outcome(timing::Outcome::OwnerDenied);
                }
                if cef_tls_bridge::pump_tls().is_err() {
                    attempt.revoke();
                    timing.outcome(timing::Outcome::PumpFailed);
                }
            });
        });
    }
}

fn tls_timing(samples: &AtomicU32) -> timing::Probe {
    use std::sync::mpsc::SyncSender;
    static SENDER: OnceLock<Option<SyncSender<timing::Report>>> = OnceLock::new();
    let sender = SENDER.get_or_init(|| {
        timing::worker(|report| {
            let [queued, before, certificate, review, after, ui_queue, ui] = report.millis;
            diagnostics::navigation_at(
                Navigation::TlsTiming {
                    phase_ms: report.millis,
                    outcome: report.outcome as u8,
                    last_phase: report.last_phase as u8,
                },
                report.observed_at,
            );
            log::info!(
                "Native browser TLS timing: outcome={} last_phase={} worker_queue_ms={} owner_before_ms={} certificate_ms={} review_ms={} owner_after_ms={} ui_queue_ms={} ui_completion_ms={}",
                report.outcome as u8, report.last_phase as u8,
                queued, before, certificate, review, after, ui_queue, ui,
            );
        }).ok()
    });
    timing::Probe::new(samples, sender.as_ref())
}

// BEGIN std-only TLS timing
// Reports contain only durations and fixed numeric outcome/phase codes.
// Both sampling and delivery are bounded. Logging never runs on the UI thread;
// a blocked logger, queue overflow or cancellation cannot delay TLS admission.
mod timing {
    use std::{
        io,
        sync::{
            atomic::{AtomicU32, Ordering},
            mpsc::{self, SyncSender},
        },
        time::{Instant, SystemTime},
    };

    const LIMIT: u32 = 32;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum Phase {
        WorkerQueue,
        OwnerBefore,
        Certificate,
        Review,
        OwnerAfter,
        UiQueue,
        UiCompletion,
    }
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) enum Outcome {
        Cancelled,
        OwnerDenied,
        PolicyDenied,
        Admitted,
        PumpFailed,
    }
    #[derive(Debug)]
    pub(super) struct Report {
        pub millis: [u64; 7],
        pub last_phase: Phase,
        pub outcome: Outcome,
        pub observed_at: SystemTime,
    }
    struct Active {
        report: Report,
        checkpoint: Instant,
        sender: SyncSender<Report>,
    }
    pub(super) struct Probe(Option<Active>);

    pub(super) fn worker(
        mut consume: impl FnMut(Report) + Send + 'static,
    ) -> io::Result<SyncSender<Report>> {
        let (sender, receiver) = mpsc::sync_channel(LIMIT as usize);
        std::thread::Builder::new()
            .name("browser-tls-timing".into())
            .spawn(move || {
                for report in receiver {
                    consume(report);
                }
            })?;
        Ok(sender)
    }

    impl Probe {
        pub(super) fn new(samples: &AtomicU32, sender: Option<&SyncSender<Report>>) -> Self {
            let active = sender.and_then(|sender| {
                samples
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                        (n < LIMIT).then(|| n + 1)
                    })
                    .ok()?;
                Some(Active {
                    report: Report {
                        millis: [0; 7],
                        last_phase: Phase::WorkerQueue,
                        outcome: Outcome::Cancelled,
                        observed_at: SystemTime::now(),
                    },
                    checkpoint: Instant::now(),
                    sender: sender.clone(),
                })
            });
            Self(active)
        }
        pub(super) fn phase(&mut self, phase: Phase) {
            self.phase_at(phase, Instant::now());
        }
        fn phase_at(&mut self, phase: Phase, now: Instant) {
            if let Some(active) = &mut self.0 {
                let elapsed = now.saturating_duration_since(active.checkpoint).as_millis();
                let slot = &mut active.report.millis[active.report.last_phase as usize];
                *slot = slot.saturating_add(elapsed.min(u128::from(u64::MAX)) as u64);
                active.checkpoint = now;
                active.report.last_phase = phase;
            }
        }
        pub(super) fn outcome(&mut self, outcome: Outcome) {
            if let Some(active) = &mut self.0 {
                active.report.outcome = outcome;
            }
        }
    }
    impl Drop for Probe {
        fn drop(&mut self) {
            if let Some(mut active) = self.0.take() {
                active.report.observed_at = SystemTime::now();
                let elapsed = active.checkpoint.elapsed().as_millis();
                let slot = &mut active.report.millis[active.report.last_phase as usize];
                *slot = slot.saturating_add(elapsed.min(u128::from(u64::MAX)) as u64);
                let _ = active.sender.try_send(active.report);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{sync::Arc, time::Duration};

        #[test]
        fn concurrent_sampling_is_bounded() {
            let count = Arc::new(AtomicU32::new(0));
            let (sender, receiver) = mpsc::sync_channel(LIMIT as usize);
            std::thread::scope(|scope| {
                for _ in 0..8 {
                    let count = count.clone();
                    let sender = sender.clone();
                    scope.spawn(move || {
                        for _ in 0..32 {
                            drop(Probe::new(&count, Some(&sender)));
                        }
                    });
                }
            });
            assert_eq!(receiver.try_iter().count(), LIMIT as usize);
            assert_eq!(count.load(Ordering::Relaxed), LIMIT);
        }

        #[test]
        fn later_attempts_keep_their_own_bounded_samples() {
            let (sender, receiver) = mpsc::sync_channel((LIMIT * 2) as usize);
            for _ in 0..2 {
                let attempt = AtomicU32::new(0);
                for _ in 0..LIMIT + 8 {
                    drop(Probe::new(&attempt, Some(&sender)));
                }
                assert_eq!(attempt.load(Ordering::Relaxed), LIMIT);
            }
            assert_eq!(receiver.try_iter().count(), (LIMIT * 2) as usize);
        }

        #[test]
        fn phases_separate_queue_certificate_and_review_time() {
            let count = AtomicU32::new(0);
            let (sender, receiver) = mpsc::sync_channel(1);
            let mut probe = Probe::new(&count, Some(&sender));
            let start = probe.0.as_ref().unwrap().checkpoint;
            probe.phase_at(Phase::OwnerBefore, start + Duration::from_millis(10));
            probe.phase_at(Phase::Certificate, start + Duration::from_millis(30));
            probe.phase_at(Phase::Review, start + Duration::from_millis(730));
            probe.phase_at(Phase::OwnerAfter, start + Duration::from_millis(5730));
            probe.phase_at(Phase::UiQueue, start + Duration::from_millis(5740));
            probe.phase_at(Phase::UiCompletion, start + Duration::from_millis(5773));
            probe.outcome(Outcome::Admitted);
            drop(probe);
            let report = receiver.try_recv().unwrap();
            assert_eq!(report.millis, [10, 20, 700, 5000, 10, 33, 0]);
            assert_eq!(report.last_phase, Phase::UiCompletion);
            assert_eq!(report.outcome, Outcome::Admitted);
        }

        #[test]
        fn stalled_consumer_and_missing_delivery_do_not_block_or_change_outcome() {
            let (entered_tx, entered_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel::<()>();
            let sender = worker(move |_| {
                let _ = entered_tx.send(());
                let _ = release_rx.recv();
            })
            .unwrap();
            let count = AtomicU32::new(0);
            drop(Probe::new(&count, Some(&sender)));
            entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            // Fill the queue to exercise overflow independently of the sample cap.
            for _ in 0..LIMIT {
                sender
                    .try_send(Report {
                        millis: [0; 7],
                        last_phase: Phase::Review,
                        outcome: Outcome::Cancelled,
                        observed_at: SystemTime::now(),
                    })
                    .unwrap();
            }
            let (done_tx, done_rx) = mpsc::channel();
            let producer = std::thread::spawn(move || {
                drop(Probe::new(&count, Some(&sender)));
                drop(Probe::new(&count, None));
                done_tx.send(()).unwrap();
            });
            let completed = done_rx.recv_timeout(Duration::from_secs(2));
            drop(release_tx);
            producer.join().unwrap();
            assert!(completed.is_ok());
        }
    }
}
// END std-only TLS timing

// BEGIN owner recheck coalescing
// A page opens many TLS sockets at once and each admission rechecks the owner
// lease twice. Every recheck takes the global database-operation lock and
// re-verifies the encrypted database, so concurrent admissions used to queue
// one full recheck each. A caller now shares a result only when that recheck
// STARTED after the caller asked: the freshness each admission relies on is
// unchanged, while a burst of N waiters costs at most two rechecks.
mod owner_rechecks {
    use std::future::Future;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[derive(Default)]
    pub(super) struct Coalesced {
        requested: AtomicU64,
        // (highest ticket covered by the last completed recheck, its result)
        last: tokio::sync::Mutex<(u64, bool)>,
    }

    impl Coalesced {
        pub(super) async fn recheck<F, Fut>(&self, check: F) -> bool
        where
            F: FnOnce() -> Fut,
            Fut: Future<Output = bool>,
        {
            let ticket = self.requested.fetch_add(1, Ordering::AcqRel) + 1;
            let mut last = self.last.lock().await;
            if last.0 >= ticket {
                return last.1;
            }
            // Every ticket up to here was issued before this recheck begins.
            let covered = self.requested.load(Ordering::Acquire);
            let current = check().await;
            *last = (covered, current);
            current
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;
        use std::time::Duration;

        #[tokio::test]
        async fn a_burst_shares_rechecks_that_started_after_each_request() {
            let coalesced = Arc::new(Coalesced::default());
            let runs = Arc::new(AtomicUsize::new(0));
            let mut tasks = Vec::new();
            for _ in 0..16 {
                let coalesced = coalesced.clone();
                let runs = runs.clone();
                tasks.push(tokio::spawn(async move {
                    coalesced
                        .recheck(|| async move {
                            runs.fetch_add(1, Ordering::SeqCst);
                            tokio::time::sleep(Duration::from_millis(20)).await;
                            true
                        })
                        .await
                }));
            }
            for task in tasks {
                assert!(task.await.unwrap());
            }
            let runs = runs.load(Ordering::SeqCst);
            assert!((1..=2).contains(&runs), "{runs}");
        }

        #[tokio::test]
        async fn a_request_made_during_a_recheck_waits_for_a_fresh_one() {
            let coalesced = Arc::new(Coalesced::default());
            let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel::<()>();
            let first = {
                let coalesced = coalesced.clone();
                tokio::spawn(async move {
                    coalesced
                        .recheck(|| async move {
                            entered_tx.send(()).unwrap();
                            release_rx.await.unwrap();
                            true
                        })
                        .await
                })
            };
            entered_rx.await.unwrap();
            // Asked while the first recheck is already running: its result
            // predates this request and must not be reused.
            let second_ran = Arc::new(AtomicUsize::new(0));
            let second = {
                let coalesced = coalesced.clone();
                let second_ran = second_ran.clone();
                tokio::spawn(async move {
                    coalesced
                        .recheck(|| async move {
                            second_ran.fetch_add(1, Ordering::SeqCst);
                            false
                        })
                        .await
                })
            };
            tokio::task::yield_now().await;
            release_tx.send(()).unwrap();
            assert!(first.await.unwrap());
            assert!(!second.await.unwrap());
            assert_eq!(second_ran.load(Ordering::SeqCst), 1);
        }

        #[tokio::test]
        async fn sequential_requests_each_recheck_and_failures_are_returned() {
            let coalesced = Coalesced::default();
            let runs = AtomicUsize::new(0);
            for expected in [true, false, true] {
                let result = coalesced
                    .recheck(|| async {
                        runs.fetch_add(1, Ordering::SeqCst);
                        expected
                    })
                    .await;
                assert_eq!(result, expected);
            }
            assert_eq!(runs.load(Ordering::SeqCst), 3);
        }

        #[tokio::test]
        async fn a_cancelled_recheck_publishes_nothing() {
            let coalesced = Arc::new(Coalesced::default());
            let pending = {
                let coalesced = coalesced.clone();
                tokio::spawn(async move {
                    coalesced
                        .recheck(std::future::pending::<bool>)
                        .await
                })
            };
            tokio::task::yield_now().await;
            pending.abort();
            let _ = pending.await;
            let ran = AtomicUsize::new(0);
            assert!(!coalesced
                .recheck(|| async {
                    ran.fetch_add(1, Ordering::SeqCst);
                    false
                })
                .await);
            assert_eq!(ran.load(Ordering::SeqCst), 1);
        }
    }
}
// END owner recheck coalescing

/// The authority's evidence for a CEF-verified handshake: the chain exactly
/// as the peer sent it, CA-valid only for a native success on a known root.
/// The proxy builds the same shape from its own handshake
/// (`upstream_trust::upstream_certificate_evidence`).
fn cef_certificate_evidence(
    identity: BrowserIdentity,
    evidence: &NativeTlsEvidence,
) -> NativeCertificateEvidence {
    NativeCertificateEvidence {
        identity,
        origin: evidence.origin.clone(),
        chain_der: evidence.peer_chain.clone(),
        system_ca_valid: evidence.native_error == 0 && evidence.issued_by_known_root,
    }
}

/// What the fast path needs from the attempt's interception CA.
trait InterceptLeaves {
    fn anchor_der(&self) -> &[u8];
    fn admits_leaf(&self, host: &str, port: u16, leaf_der: &[u8]) -> bool;
}

impl InterceptLeaves for InterceptAuthority {
    fn anchor_der(&self) -> &[u8] {
        InterceptAuthority::anchor_der(self)
    }
    fn admits_leaf(&self, host: &str, port: u16, leaf_der: &[u8]) -> bool {
        InterceptAuthority::admits_leaf(self, host, port, leaf_der)
    }
}

/// Intercepting attempts: admit natively only a clean native verification
/// (no error, not fatal, no exception) that chained to this attempt's own
/// anchor in a CUSTOM_ONLY context and presented the leaf the proxy minted
/// for exactly this host and port. Everything else is denied; there is no
/// exception, review or authority evaluation on this path.
fn intercepted_admission(
    current: bool,
    evidence: &NativeTlsEvidence,
    intercept: &impl InterceptLeaves,
) -> NativeTlsDecision {
    let admitted = current
        && evidence.native_error == 0
        && !evidence.fatal_error
        && evidence.allowed_exception_mask == 0
        && evidence.ca_mode == NativeTlsCaMode::CustomOnly
        && evidence
            .verified_chain
            .last()
            .is_some_and(|anchor| anchor.as_slice() == intercept.anchor_der())
        && evidence
            .peer_chain
            .first()
            .is_some_and(|leaf| intercept.admits_leaf(&evidence.hostname, evidence.port, leaf));
    if admitted {
        NativeTlsDecision::AdmitNative
    } else {
        NativeTlsDecision::Deny
    }
}

fn admissible_native_result(error: i32, fatal: bool, mask: u32) -> Option<NativeTlsDecision> {
    if fatal {
        return None;
    }
    match (error, mask) {
        (0, 0) => Some(NativeTlsDecision::AdmitNative),
        (error, mask) if error < 0 && mask != 0 && mask & !7 == 0 => {
            Some(NativeTlsDecision::AdmitException { mask })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_success_and_exact_scoped_exceptions_are_distinct() {
        assert_eq!(
            admissible_native_result(0, false, 0),
            Some(NativeTlsDecision::AdmitNative)
        );
        for mask in 1..=7 {
            assert_eq!(
                admissible_native_result(-202, false, mask),
                Some(NativeTlsDecision::AdmitException { mask })
            );
        }
        for (error, fatal, mask) in [
            (0, true, 0),
            (-202, true, 4),
            (-202, false, 0),
            (-202, false, 8),
            (0, false, 4),
            (1, false, 0),
        ] {
            assert_eq!(admissible_native_result(error, fatal, mask), None);
        }
    }

    struct FakeIntercept {
        anchor: Vec<u8>,
        leaf: Vec<u8>,
    }

    impl InterceptLeaves for FakeIntercept {
        fn anchor_der(&self) -> &[u8] {
            &self.anchor
        }
        fn admits_leaf(&self, host: &str, port: u16, leaf_der: &[u8]) -> bool {
            host == "device.test" && port == 443 && leaf_der == self.leaf
        }
    }

    pub(super) fn evidence(peer_chain: Vec<Vec<u8>>, verified_chain: Vec<Vec<u8>>) -> NativeTlsEvidence {
        NativeTlsEvidence {
            context_token: 1,
            generation: 1,
            challenge: 1,
            hostname: "device.test".into(),
            port: 443,
            origin: "https://device.test".into(),
            native_error: 0,
            certificate_status: 0,
            fatal_error: false,
            issued_by_known_root: false,
            peer_chain,
            verified_chain,
            ca_mode: NativeTlsCaMode::CustomOnly,
            allowed_exception_mask: 0,
        }
    }

    #[test]
    fn intercept_fast_path_admits_only_our_minted_leaf_on_a_current_attempt() {
        let intercept = FakeIntercept {
            anchor: b"attempt-ca".to_vec(),
            leaf: b"minted-leaf".to_vec(),
        };
        let good = || evidence(vec![intercept.leaf.clone()], vec![intercept.leaf.clone(), intercept.anchor.clone()]);
        assert_eq!(
            intercepted_admission(true, &good(), &intercept),
            NativeTlsDecision::AdmitNative
        );
        let with = |change: fn(&mut NativeTlsEvidence)| {
            let mut e = good();
            change(&mut e);
            e
        };
        let denied: Vec<(&str, bool, NativeTlsEvidence)> = vec![
            ("stale attempt", false, good()),
            ("native error", true, with(|e| e.native_error = -202)),
            ("scoped exception", true, with(|e| {
                e.native_error = -202;
                e.allowed_exception_mask = 4;
            })),
            ("mask without error", true, with(|e| e.allowed_exception_mask = 4)),
            ("fatal", true, with(|e| e.fatal_error = true)),
            ("system roots context", true, with(|e| e.ca_mode = NativeTlsCaMode::System)),
            ("system plus custom context", true, with(|e| e.ca_mode = NativeTlsCaMode::SystemPlusCustom)),
            ("other root", true, with(|e| e.verified_chain[1] = b"public-root".to_vec())),
            ("no verified chain", true, with(|e| e.verified_chain.clear())),
            ("foreign leaf under our CA", true, with(|e| e.peer_chain[0] = b"other-leaf".to_vec())),
            ("no peer chain", true, with(|e| e.peer_chain.clear())),
            ("other host", true, with(|e| e.hostname = "other.test".into())),
            ("other port", true, with(|e| e.port = 8443)),
        ];
        for (case, current, evidence) in denied {
            assert_eq!(
                intercepted_admission(current, &evidence, &intercept),
                NativeTlsDecision::Deny,
                "{case}"
            );
        }
    }

    #[test]
    fn cef_evidence_is_ca_valid_only_for_native_success_on_a_known_root() {
        let identity = super::upstream_trust::tests::identity();
        for (native_error, known_root, valid) in [(0, true, true), (0, false, false), (-202, true, false)] {
            let mut e = evidence(vec![b"leaf".to_vec(), b"ca".to_vec()], Vec::new());
            e.native_error = native_error;
            e.issued_by_known_root = known_root;
            let built = cef_certificate_evidence(identity.clone(), &e);
            assert_eq!(built.system_ca_valid, valid);
            assert_eq!(built.chain_der, e.peer_chain);
            assert_eq!(built.origin, "https://device.test");
            assert!(built.identity == identity);
        }
    }
}
