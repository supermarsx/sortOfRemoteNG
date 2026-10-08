//! Actual-handshake admission for the patched CEF engine. No renderer verdict,
//! URL inspection request, or error-only callback can authorize a certificate.
use super::diagnostics::{self, Navigation};
use super::Attempt;
use sorng_browser_host::cef_tls_bridge::{
    self, NativeTlsCompletion, NativeTlsDecision, NativeTlsEvidence, NativeTlsHooks,
};
use sorng_commands_core::origin_browser_authority::{
    NativeCertificateAuthority, NativeCertificateDecision, NativeCertificateEvidence,
};
use sorng_encryption::EncryptionState;
use std::sync::{Arc, OnceLock, Weak};
use tauri::{Manager, WebviewWindow};
use super::certificate_review::review_certificate;

pub(super) struct CertificateHooks {
    attempt: Weak<Attempt>,
    authority: Arc<NativeCertificateAuthority>,
    window: WebviewWindow,
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
        })
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
            attempt.revoke();
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
        let mut timing = tls_timing();
        tauri::async_runtime::spawn(async move {
            timing.phase(timing::Phase::OwnerBefore);
            let state = window.state::<EncryptionState>();
            if attempt.lease.recheck(&window, &state).await.is_err() {
                timing.outcome(timing::Outcome::OwnerDenied);
                return;
            }
            let origin = evidence.origin;
            let chain = evidence.peer_chain;
            timing.phase(timing::Phase::Certificate);
            let verdict = authority
                .evaluate(NativeCertificateEvidence {
                    identity: attempt.identity.clone(),
                    origin: origin.clone(),
                    chain_der: chain.clone(),
                    system_ca_valid: evidence.native_error == 0 && evidence.issued_by_known_root,
                })
                .await;
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
            if attempt.lease.recheck(&window, &state).await.is_err() {
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

fn tls_timing() -> timing::Probe {
    use std::sync::{atomic::AtomicU32, mpsc::SyncSender};
    static SAMPLES: AtomicU32 = AtomicU32::new(0);
    static SENDER: OnceLock<Option<SyncSender<timing::Report>>> = OnceLock::new();
    let sender = SENDER.get_or_init(|| {
        timing::worker(|report| {
            let [queued, before, certificate, review, after, ui_queue, ui] = report.millis;
            log::info!(
                "Native browser TLS timing: outcome={} last_phase={} worker_queue_ms={} owner_before_ms={} certificate_ms={} review_ms={} owner_after_ms={} ui_queue_ms={} ui_completion_ms={}",
                report.outcome as u8, report.last_phase as u8,
                queued, before, certificate, review, after, ui_queue, ui,
            );
        }).ok()
    });
    timing::Probe::new(&SAMPLES, sender.as_ref())
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
        time::Instant,
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

}
