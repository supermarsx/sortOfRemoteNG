//! No window/GPU is needed: exercise housekeeping with actual private relays.
use super::*;
use sorng_protocols::private_forward_proxy::PrivateProxyState;

#[derive(Default)]
struct Events(Mutex<Vec<BrowserEvent>>);
impl BrowserEventSink for Events {
    fn on_event(&self, event: BrowserEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
}

#[test]
fn idle_dead_proxy_is_reported_once_without_poisoning_a_fresh_attempt() {
    let old_runtime = runtime();
    let events = Arc::new(Events::default());
    let old = old_runtime.block_on(tests::fixture(events.clone()));
    let evidence = old.session.lock().unwrap().failure_state();
    assert!(old.current());
    // Real relay supervisor cancellation, without explicitly revoking the
    // browser or manufacturing a CEF request/renderer callback.
    drop(old_runtime);
    assert_eq!(
        old.session.lock().unwrap().proxy_diagnostics().state,
        PrivateProxyState::TaskEnded
    );

    let next_runtime = runtime();
    let successor_events = Arc::new(Events::default());
    let successor = next_runtime.block_on(tests::fixture(successor_events.clone()));
    assert!(old.identity != successor.identity);
    for _ in 0..3 {
        old.poll_session_health(None);
        successor.poll_session_health(None);
    }
    assert_eq!(evidence.get(), Some(BrowserSessionFailure::PrivateProxy));
    let events = events.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].state.lifecycle, Lifecycle::Faulted);
    assert_eq!(events[0].state.fault, Some(BrowserFault::Session));
    assert!(old
        .session
        .lock()
        .unwrap()
        .with_proxy_credentials(|_, _| ())
        .is_none());
    assert!(successor.current());
    assert!(successor_events.0.lock().unwrap().is_empty());
    assert!(successor
        .session
        .lock()
        .unwrap()
        .with_proxy_credentials(|_, _| ())
        .is_some());
}

#[tokio::test]
async fn health_poll_does_not_wait_for_request_or_state_guards() {
    let events = Arc::new(Events::default());
    let shared = tests::fixture(events.clone()).await;
    let state = shared.state.lock().unwrap();
    shared.poll_session_health(None);
    drop(state);
    let session = shared.session.lock().unwrap();
    shared.poll_session_health(None);
    drop(session);
    assert!(shared.current());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn stale_health_poll_cannot_revoke_another_attempts_session() {
    let events = Arc::new(Events::default());
    let mut old = tests::fixture(events.clone()).await;
    let successor = tests::fixture(Arc::new(Events::default())).await;
    old.session = successor.session.clone();
    old.poll_session_health(None);
    assert!(successor.current());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn health_poll_retains_existing_cause_and_ignores_already_closing_views() {
    let events = Arc::new(Events::default());
    let shared = tests::fixture(events.clone()).await;
    shared
        .session
        .lock()
        .unwrap()
        .revoke_for(&shared.identity, BrowserSessionFailure::CertificateBridge)
        .unwrap();
    shared.poll_session_health(None);
    assert_eq!(
        shared.session.lock().unwrap().failure_reason(),
        Some(BrowserSessionFailure::CertificateBridge)
    );
    assert_eq!(events.0.lock().unwrap().len(), 1);

    let closing_events = Arc::new(Events::default());
    let closing = tests::fixture(closing_events.clone()).await;
    closing
        .state
        .lock()
        .unwrap()
        .control
        .begin_close(&closing.identity)
        .unwrap();
    closing
        .session
        .lock()
        .unwrap()
        .revoke(&closing.identity)
        .unwrap();
    closing.poll_session_health(None);
    assert!(closing_events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn poisoned_session_health_is_reported_without_clearing_poison() {
    let events = Arc::new(Events::default());
    let shared = tests::fixture(events.clone()).await;
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let _guard = shared.session.lock().unwrap();
        panic!("fixture session guard poison");
    }));
    shared.poll_session_health(None);
    assert!(shared.session.is_poisoned());
    let session = shared.session.lock().unwrap_or_else(|e| e.into_inner());
    assert_eq!(
        session.failure_reason(),
        Some(BrowserSessionFailure::NativeState)
    );
    assert!(session.with_proxy_credentials(|_, _| ()).is_none());
    assert_eq!(events.0.lock().unwrap().len(), 1);
}
