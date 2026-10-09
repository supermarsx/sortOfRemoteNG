//! Exercises the exact app sink publication helper without CEF or Tauri.
#[path = "../../../src/origin_browser_display.rs"]
mod display;

use display::{publish, publish_with_reason, scrub_retained, Publication};
use sorng_browser_host::ipc::{
    OriginBrowserFailureReason, OriginBrowserPageState, OriginBrowserPhase, OriginBrowserSnapshot,
};
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};
use std::{cell::Cell, sync::Mutex};

fn identity() -> BrowserIdentity {
    OriginBrowserPolicy::new("owner", "connection", "tab", "https://fixture.test")
        .unwrap()
        .identity()
        .clone()
}

fn private_page() -> OriginBrowserPageState<'static> {
    OriginBrowserPageState {
        url: "https://fixture.test/private?token=synthetic-secret#sensitive-fragment",
        title: "Synthetic private title",
        loading: true,
        can_go_back: true,
        can_go_forward: true,
    }
}

fn retained(identity: &BrowserIdentity) -> Mutex<OriginBrowserSnapshot> {
    Mutex::new(
        OriginBrowserSnapshot::new(identity, 1, OriginBrowserPhase::Attached, private_page())
            .unwrap(),
    )
}

fn wire(snapshot: &OriginBrowserSnapshot) -> serde_json::Value {
    serde_json::to_value(snapshot).unwrap()
}

fn assert_scrubbed(snapshot: &OriginBrowserSnapshot) {
    let value = wire(snapshot);
    for field in ["currentUrl", "displayUrl", "title"] {
        assert_eq!(value[field], "", "private field retained: {field}");
    }
    for field in ["loading", "canGoBack", "canGoForward"] {
        assert_eq!(value[field], false, "stale activity retained: {field}");
    }
}

#[test]
fn current_owner_gets_full_display_and_all_checks_precede_unlocked_emit() {
    let identity = identity();
    let snapshot = retained(&identity);
    let checks = Cell::new(0);
    let result = publish(
        &snapshot,
        &identity,
        2,
        OriginBrowserPhase::Attached,
        private_page(),
        || {
            checks.set(checks.get() + 1);
            true
        },
        |event| {
            assert_eq!(checks.get(), 3);
            let retained = snapshot
                .try_lock()
                .expect("emitter must not run under snapshot lock");
            assert_eq!(event.sequence(), 2);
            assert_eq!(wire(&event), wire(&retained));
            assert_eq!(wire(&event)["currentUrl"], private_page().url);
            assert_eq!(wire(&event)["title"], private_page().title);
            true
        },
    );
    assert_eq!(result, Publication::Published);
}

#[test]
fn stale_owner_blocks_all_nonterminal_events_and_scrubs_retained_state() {
    for phase in [OriginBrowserPhase::Starting, OriginBrowserPhase::Attached] {
        let identity = identity();
        let snapshot = retained(&identity);
        let result = publish(
            &snapshot,
            &identity,
            2,
            phase,
            private_page(),
            || false,
            |_| panic!("stale owner must not receive page event"),
        );
        assert_eq!(result, Publication::OwnerUnavailable);
        assert_scrubbed(&snapshot.lock().unwrap());
    }
}

#[test]
fn terminal_notifications_never_copy_private_payload_even_when_owner_is_current() {
    for phase in [
        OriginBrowserPhase::Closing,
        OriginBrowserPhase::Closed,
        OriginBrowserPhase::Failed,
    ] {
        for owner_current in [false, true] {
            let identity = identity();
            let snapshot = retained(&identity);
            // Even an invalid terminal URL cannot suppress lifecycle delivery.
            let page = OriginBrowserPageState {
                url: "https://user:secret@fixture.test/",
                ..private_page()
            };
            let result = publish(
                &snapshot,
                &identity,
                2,
                phase,
                page,
                || owner_current,
                |event| {
                    assert_scrubbed(&event);
                    assert_eq!(event.sequence(), 2);
                    assert_eq!(
                        wire(&event)["identity"],
                        wire(&snapshot.lock().unwrap())["identity"]
                    );
                    true
                },
            );
            assert_eq!(result, Publication::Published);
            assert_scrubbed(&snapshot.lock().unwrap());
            assert_eq!(
                wire(&snapshot.lock().unwrap())["phase"],
                serde_json::to_value(phase).unwrap()
            );
        }
    }
}

#[test]
fn renderer_failure_after_revocation_is_delivered_once_without_restoring_page_authority() {
    let identity = identity();
    let snapshot = retained(&identity);
    let traffic_current = Cell::new(true);
    let deliveries = Cell::new(0);
    // The native host revokes the session before Sink receives Faulted; Sink
    // then revokes its lease and scrubs its retained state before publication.
    traffic_current.set(false);
    scrub_retained(&snapshot);
    for expected in [Publication::Published, Publication::IgnoredSequence] {
        let result = publish_with_reason(
            &snapshot,
            &identity,
            2,
            (
                OriginBrowserPhase::Failed,
                Some(OriginBrowserFailureReason::Renderer),
            ),
            private_page(),
            || traffic_current.get(),
            |event| {
                assert!(!traffic_current.get());
                assert_scrubbed(&event);
                assert_eq!(wire(&event)["phase"], "failed");
                assert_eq!(wire(&event)["failureReason"], "renderer");
                assert_eq!(
                    wire(&event)["identity"],
                    wire(&snapshot.lock().unwrap())["identity"]
                );
                deliveries.set(deliveries.get() + 1);
                true
            },
        );
        assert_eq!(result, expected);
    }
    assert_eq!(deliveries.get(), 1);
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            3,
            OriginBrowserPhase::Attached,
            private_page(),
            || traffic_current.get(),
            |_| panic!("terminal notification must not restore traffic or disclosure"),
        ),
        Publication::OwnerUnavailable
    );
    assert_eq!(wire(&snapshot.lock().unwrap())["phase"], "failed");
    assert_eq!(wire(&snapshot.lock().unwrap())["failureReason"], "renderer");
    assert!(!traffic_current.get());
    assert_scrubbed(&snapshot.lock().unwrap());
}

#[test]
fn load_failure_reason_survives_terminal_scrubbing_after_owner_revocation() {
    let identity = identity();
    let snapshot = retained(&identity);
    scrub_retained(&snapshot);
    assert_eq!(
        publish_with_reason(
            &snapshot,
            &identity,
            2,
            (
                OriginBrowserPhase::Failed,
                Some(OriginBrowserFailureReason::Load)
            ),
            private_page(),
            || false,
            |event| {
                assert_scrubbed(&event);
                assert_eq!(wire(&event)["phase"], "failed");
                assert_eq!(wire(&event)["failureReason"], "load");
                true
            },
        ),
        Publication::Published
    );
    assert_scrubbed(&snapshot.lock().unwrap());
    assert_eq!(wire(&snapshot.lock().unwrap())["failureReason"], "load");
}

#[test]
fn production_renderer_fault_revokes_before_owner_window_terminal_publication() {
    let host = include_str!("../src/cef_browser.rs");
    let fault = host
        .split("fn fault(&self, browser:")
        .nth(1)
        .unwrap()
        .split("fn publish(&self")
        .next()
        .unwrap();
    assert!(fault.find("self.revoke();").unwrap() < fault.find("self.emit();").unwrap());
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let sink = runtime
        .split("impl BrowserEventSink for Sink")
        .nth(1)
        .unwrap()
        .split("pub(crate) async fn create(")
        .next()
        .unwrap();
    assert!(sink.contains("Lifecycle::Faulted => OriginBrowserPhase::Failed"));
    assert!(
        sink.find("self.attempt.revoke();").unwrap()
            < sink.find("display::publish_with_reason(").unwrap()
    );
    for name in ["Renderer", "Callback", "NativeSurface", "Load"] {
        assert!(sink.contains(&format!(
            "Some(BrowserFault::{name}) => Some(OriginBrowserFailureReason::{name})"
        )));
    }
    assert!(sink.contains("Some(BrowserFault::Session) => Some(self.attempt.failure.get().map(Into::into)"));
    let reason = sink.split("let failure_reason = match").nth(1).unwrap()
        .split("let page =").next().unwrap();
    assert!(!reason.contains("try_lock"));
    assert!(!reason.contains(".lock()"));
    assert!(sink.contains("None => None"));
    assert!(sink.contains("|| self.attempt.current()"));
    assert!(sink.contains("self.window.emit(ORIGIN_BROWSER_STATE_EVENT, next)"));
    assert!(!sink.contains("emit_all("));
}

#[test]
fn session_failure_causes_survive_terminal_publication_without_private_data_or_access() {
    use sorng_protocols::origin_browser::BrowserSessionFailure as Reason;
    for (reason, expected) in [
        (Reason::DatabaseOwner, "database-owner"),
        (Reason::Watchdog, "watchdog"),
        (Reason::PrivateContext, "private-context"),
        (Reason::PrivateProxy, "private-proxy"),
        (Reason::NativeState, "native-state"),
        (Reason::CertificateBridge, "certificate-bridge"),
        (Reason::RedirectDenied, "redirect-denied"),
        (Reason::RuntimeUnavailable, "runtime-unavailable"),
        (Reason::OwnerWindow, "owner-window"),
    ] {
        let identity = identity();
        let snapshot = retained(&identity);
        assert_eq!(publish_with_reason(&snapshot, &identity, 53,
            (OriginBrowserPhase::Failed, Some(reason.into())), private_page(), || false,
            |event| {
                assert_scrubbed(&event);
                assert_eq!(wire(&event)["failureReason"], expected);
                assert_eq!(wire(&event)["sequence"], 53);
                assert!(wire(&event).get("loadFailure").is_none());
                true
            }), Publication::Published);
        scrub_retained(&snapshot);
        assert_eq!(wire(&snapshot.lock().unwrap())["failureReason"], expected);
        assert_eq!(publish(&snapshot, &identity, 54, OriginBrowserPhase::Attached,
            private_page(), || false, |_| panic!("diagnostics cannot restore ownership")),
            Publication::OwnerUnavailable);
    }
}

#[test]
fn production_session_invalidation_records_native_evidence_before_cleanup() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let revoke = runtime.split("fn revoke_inner(&self, reason:").nth(1).unwrap()
        .split("#[derive(Default)]").next().unwrap();
    assert!(revoke.find("BrowserSessionFailure::owner_loss").unwrap()
        < revoke.find("self.lease.revoke()").unwrap());
    assert!(revoke.contains("self.lease.is_temporary()"));
    let watchdog = runtime.split("suspend_for_watchdog()").nth(1).unwrap()
        .split("}).await").next().unwrap();
    assert!(watchdog.contains("attempt.revoke_for(BrowserSessionFailure::Watchdog)"));
    assert!(!watchdog.contains("attempt.revoke();"));
    let context = include_str!("../src/cef_context.rs");
    let fail = context.split("fn fail(&self, reason:").nth(1).unwrap()
        .split("fn revoke(&self)").next().unwrap();
    assert!(fail.contains("ContextError::ProxyRejected | ContextError::ProxyMismatch"));
    assert!(fail.find("revoke_for").unwrap() < fail.find("self.revoke()").unwrap());
}

#[test]
fn owner_loss_before_retention_or_at_final_publish_boundary_stops_disclosure() {
    for fail_at in [2, 3] {
        let identity = identity();
        let snapshot = retained(&identity);
        let checks = Cell::new(0);
        let result = publish(
            &snapshot,
            &identity,
            2,
            OriginBrowserPhase::Attached,
            private_page(),
            || {
                checks.set(checks.get() + 1);
                checks.get() < fail_at
            },
            |_| panic!("owner lost before emit"),
        );
        assert_eq!(result, Publication::OwnerUnavailable);
        assert_eq!(checks.get(), fail_at);
        assert_scrubbed(&snapshot.lock().unwrap());
    }
}

#[test]
fn revocation_scrub_is_idempotent_and_preserves_lifecycle_identity_and_sequence() {
    let identity = identity();
    let snapshot = retained(&identity);
    let before = wire(&snapshot.lock().unwrap());
    scrub_retained(&snapshot);
    scrub_retained(&snapshot);
    let after = snapshot.lock().unwrap();
    assert_scrubbed(&after);
    for field in ["identity", "phase", "sequence"] {
        assert_eq!(wire(&after)[field], before[field]);
    }
}

#[test]
fn revocation_during_emitter_can_scrub_without_lock_reentrancy_deadlock() {
    let identity = identity();
    let snapshot = retained(&identity);
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            2,
            OriginBrowserPhase::Attached,
            private_page(),
            || true,
            |_| {
                scrub_retained(&snapshot);
                true
            }
        ),
        Publication::Published
    );
    assert_scrubbed(&snapshot.lock().unwrap());
}

#[test]
fn failed_emit_or_invalid_live_payload_clears_retained_page_state() {
    let identity = identity();
    let snapshot = retained(&identity);
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            2,
            OriginBrowserPhase::Attached,
            private_page(),
            || true,
            |_| false
        ),
        Publication::Failed
    );
    assert_scrubbed(&snapshot.lock().unwrap());
    let snapshot = retained(&identity);
    let invalid = OriginBrowserPageState {
        url: "javascript:alert(1)",
        ..private_page()
    };
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            2,
            OriginBrowserPhase::Attached,
            invalid,
            || true,
            |_| panic!("invalid state must not emit")
        ),
        Publication::Failed
    );
    assert_scrubbed(&snapshot.lock().unwrap());
}

#[test]
fn poisoned_retention_fails_closed_and_only_recovers_to_scrub() {
    let identity = identity();
    let snapshot = retained(&identity);
    let _ = std::panic::catch_unwind(|| {
        let _guard = snapshot.lock().unwrap();
        panic!("synthetic poisoned retention");
    });
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            2,
            OriginBrowserPhase::Attached,
            private_page(),
            || true,
            |_| panic!("poisoned state must not emit")
        ),
        Publication::Failed
    );
    assert_scrubbed(&snapshot.lock().unwrap_or_else(|error| error.into_inner()));
}

#[test]
fn out_of_order_events_still_scrub_when_terminal_or_owner_becomes_stale() {
    let identity = identity();
    let snapshot = retained(&identity);
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            1,
            OriginBrowserPhase::Closed,
            private_page(),
            || false,
            |_| panic!("duplicate terminal sequence must not emit")
        ),
        Publication::IgnoredSequence
    );
    assert_scrubbed(&snapshot.lock().unwrap());
    let snapshot = retained(&identity);
    let checks = Cell::new(0);
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            1,
            OriginBrowserPhase::Attached,
            private_page(),
            || {
                checks.set(checks.get() + 1);
                checks.get() == 1
            },
            |_| panic!("stale owner must not emit")
        ),
        Publication::OwnerUnavailable
    );
    assert_scrubbed(&snapshot.lock().unwrap());
}

#[test]
fn stale_sequences_cannot_overwrite_newer_scrubbed_terminal_snapshot() {
    let identity = identity();
    let snapshot = retained(&identity);
    assert_eq!(
        publish(
            &snapshot,
            &identity,
            3,
            OriginBrowserPhase::Closed,
            private_page(),
            || false,
            |_| true
        ),
        Publication::Published
    );
    for sequence in [1, 2, 3] {
        assert_eq!(
            publish(
                &snapshot,
                &identity,
                sequence,
                OriginBrowserPhase::Attached,
                private_page(),
                || true,
                |_| panic!("old event must not emit")
            ),
            Publication::IgnoredSequence
        );
    }
    assert_scrubbed(&snapshot.lock().unwrap());
    assert_eq!(snapshot.lock().unwrap().sequence(), 3);
}

#[tokio::test]
async fn session_failure_observation_does_not_depend_on_session_lock_availability() {
    use sorng_protocols::origin_browser::{BrowserSessionFailure, OriginBrowserSession};
    use sorng_protocols::private_forward_proxy::{Authority, DialFuture, ProxyLimits};
    let policy = OriginBrowserPolicy::new("owner", "connection", "tab", "https://fixture.test").unwrap();
    let mut current = OriginBrowserSession::start(policy,
        std::sync::Arc::new(|_: Authority| -> DialFuture {
            Box::pin(async { Err(std::io::Error::other("fixture must not dial")) })
        }), ProxyLimits::default()).await.unwrap();
    let identity = current.policy().identity().clone();
    let snapshot = retained(&identity);
    let evidence = current.failure_state();
    current.revoke_for(&identity, BrowserSessionFailure::CertificateBridge).unwrap();
    // Hold the actual native session guard throughout publication.
    let session_lock = Mutex::new(current);
    let guard = session_lock.lock().unwrap();
    assert!(session_lock.try_lock().is_err());
    assert_eq!(publish_with_reason(&snapshot, &identity, 2,
        (OriginBrowserPhase::Failed, evidence.get().map(Into::into)), private_page(),
        || false, |event| {
            assert_scrubbed(&event);
            assert_eq!(wire(&event)["failureReason"], "certificate-bridge");
            true
        }), Publication::Published);
    assert_eq!(wire(&snapshot.lock().unwrap())["failureReason"], "certificate-bridge");
    drop(guard);
    session_lock.into_inner().unwrap().stop().await.unwrap();
}

#[test]
fn cancellation_records_explicit_evidence_before_publication_and_repeated_cleanup() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let body = runtime.split("fn revoke_inner(&self, reason:").nth(1).unwrap()
        .split("// Inspect owner evidence").next().unwrap();
    assert!(body.contains("self.cancelled.swap(true, Ordering::AcqRel)"));
    assert!(body.contains("if let Some(reason) = reason"));
    assert!(body.find("self.failure.record_first(reason)").unwrap()
        < body.find("self.cancelled.swap(true").unwrap());
    assert!(body.contains("self.report_failure();"));
    for cleanup in ["self.lease.revoke()", "session.revoke", ".lock()", "cancelled.store(false"] {
        assert!(!body.contains(cleanup));
    }
    let body = runtime.split("fn revoke_inner(&self, reason:").nth(1).unwrap()
        .split("fn report_failure").next().unwrap();
    let owner = body.split("// Inspect owner evidence").nth(1).unwrap();
    assert!(owner.find("self.failure.record_first(reason)").unwrap()
        < owner.find("self.login.revoke()").unwrap());
}
