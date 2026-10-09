//! Exercise the actual Shared/cleanup implementation without a native window.
//! Engine popup creation/adoption still requires the live CEF acceptance gate.
use super::*;

#[derive(Default)]
struct Sink(Mutex<Vec<BrowserEvent>>);
impl BrowserEventSink for Sink {
    fn on_event(&self, event: BrowserEvent) {
        self.0.lock().unwrap().push(event);
    }
}

async fn source() -> Arc<Shared> {
    Arc::new(super::super::tests::fixture(Arc::new(Sink::default())).await)
}

fn child(root: &Arc<Shared>, sink: Arc<dyn BrowserEventSink>) -> Arc<Shared> {
    child_shared(
        root,
        PopupRole {
            group: 42,
            child: Some(("popup-1".into(), Arc::new(AtomicBool::new(false)))),
        },
        sink,
        ViewportBounds::new(0.0, 0.0, 640.0, 480.0).unwrap(),
    )
}

#[tokio::test]
async fn child_close_authorizes_only_child_cleanup_without_revoking_source() {
    let root = source().await;
    let popup = child(&root, Arc::new(Sink::default()));
    assert!(Arc::ptr_eq(&popup.session, &root.session));
    assert!(Arc::ptr_eq(&popup.permissions, &root.permissions));
    assert!(popup.identity == root.identity);
    assert!(!popup.cleanup_owner().revoked_attempt());
    popup.revoke();
    assert!(!popup.current());
    assert!(root.current());
    assert!(popup.cleanup_owner().revoked_attempt());
    assert!(!root.cleanup_owner().revoked_attempt());
    assert_ne!(
        root.session.lock().unwrap().status(),
        BrowserSessionStatus::Revoked
    );
    root.revoke();
}

#[tokio::test]
async fn source_revocation_invalidates_all_children_and_authorizes_cleanup() {
    let root = source().await;
    let first = child(&root, Arc::new(Sink::default()));
    let second = child(&root, Arc::new(Sink::default()));
    first.revoke();
    assert!(second.current());
    root.revoke();
    assert!(!root.current());
    assert!(!second.current());
    assert!(second.cleanup_owner().revoked_attempt());
}

#[tokio::test]
async fn child_controls_and_events_are_distinct_from_parent() {
    let root_sink = Arc::new(Sink::default());
    let root = Arc::new(super::super::tests::fixture(root_sink.clone()).await);
    let events = Arc::new(Events::default());
    let popup = child(
        &root,
        Arc::new(PopupSink {
            events: events.clone(),
            view_id: "popup-1".into(),
        }),
    );
    assert!(!Arc::ptr_eq(&root.state, &popup.state));
    popup.state.lock().unwrap().display.title = "Child only".into();
    popup.revoke();
    assert!(popup.emit());
    assert!(root_sink.0.lock().unwrap().is_empty());
    assert!(root.state.lock().unwrap().display.title.is_empty());
    assert_eq!(
        events.values.lock().unwrap()["popup-1"].display.title,
        "Child only"
    );
    assert_eq!(events.revision.load(Ordering::Relaxed), 1);
    root.revoke();
}

#[tokio::test]
async fn dropping_borrowed_control_facade_does_not_close_child_or_parent() {
    let root = source().await;
    let popup = child(&root, Arc::new(Sink::default()));
    drop(facade(
        popup.clone(),
        Arc::new(Mutex::new(None)),
        DownloadAttachment::default(),
    ));
    assert!(popup.current());
    assert!(root.current());
    root.revoke();
}

fn poison_view_state_during_update(view: &Arc<Shared>) {
    use cef::rc::{ConvertReturnValue, RcImpl};
    use cef::sys::_cef_browser_t;
    use std::sync::mpsc;
    use std::time::Duration;

    #[cfg(target_os = "macos")]
    crate::platform::test_runtime::ensure_loaded();

    extern "C" fn valid(this: *mut _cef_browser_t) -> i32 {
        let signal = &RcImpl::<_cef_browser_t, mpsc::Sender<()>>::get(this).interface;
        let _ = signal.send(());
        1
    }
    extern "C" fn identifier(_: *mut _cef_browser_t) -> i32 {
        41
    }

    {
        let mut state = view.state.lock().unwrap();
        if state.control.lifecycle() == Lifecycle::Starting {
            state.control.attached(&view.identity).unwrap();
        }
        state.browser_id = Some(41);
    }
    let (accepted, accepted_rx) = mpsc::channel::<()>();
    let (locked, locked_rx) = mpsc::channel();
    let state = view.state.clone();
    let session = view.session.clone();
    let worker = std::thread::spawn(move || {
        // Hold current() until accepts() has inspected healthy view state.
        let session_guard = session.lock().unwrap();
        locked.send(()).unwrap();
        accepted_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let poisoned = catch_unwind(AssertUnwindSafe(|| {
            // accepts() releases this guard before current() takes the session.
            let _state = state.lock().unwrap();
            panic!("view-local state fixture");
        }));
        assert!(poisoned.is_err());
        drop(session_guard);
    });
    locked_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let raw = _cef_browser_t {
        is_valid: Some(valid),
        get_identifier: Some(identifier),
        // SAFETY: Unused CEF slots are nullable; RcImpl supplies ref counting.
        ..unsafe { std::mem::zeroed() }
    };
    let raw: *mut _cef_browser_t = RcImpl::new(raw, accepted).cast();
    let browser: Browser = raw.wrap_result();
    // The real production late-poison branch runs, not a copied revocation model.
    view.update_state(Some(&browser), |_| panic!("poisoned state must reject updates"));
    worker.join().unwrap();
    assert!(view.state.is_poisoned());
    assert_eq!(
        view.state.lock().unwrap_or_else(|error| error.into_inner()).page.fault,
        Some(BrowserFault::Session),
    );
}

fn mark_source_ready(root: &Shared) {
    let mut session = root.session.lock().unwrap();
    let report = sorng_protocols::origin_browser::NativeHostReadiness::Ready {
        profile_key: session.policy().profile_key().to_owned(),
        proxy_endpoint: session.proxy_endpoint(),
    };
    session.report_host(&root.identity, report).unwrap();
    assert_eq!(session.status(), BrowserSessionStatus::Ready);
}

#[tokio::test]
async fn child_state_poison_keeps_source_and_sibling_relay_ready() {
    let root = source().await;
    mark_source_ready(&root);
    let popup = child(&root, Arc::new(Sink::default()));
    let sibling = child(&root, Arc::new(Sink::default()));

    poison_view_state_during_update(&popup);

    assert!(!popup.current());
    assert!(popup.popup.view_closed().unwrap().load(Ordering::Acquire));
    assert!(root.current());
    assert!(sibling.current());
    {
        let session = root.session.lock().unwrap();
        assert_eq!(session.status(), BrowserSessionStatus::Ready);
        assert_eq!(session.failure_reason(), None);
        assert_eq!(session.with_proxy_credentials(|_, _| true), Some(true));
        assert!(session.authorize_source_navigation(
            &root.identity, "https://fixture.invalid",
        ).is_ok());
    }
    root.revoke();
}

#[tokio::test]
async fn source_state_poison_records_native_state_and_revokes_child_relay() {
    let root = source().await;
    mark_source_ready(&root);
    let popup = child(&root, Arc::new(Sink::default()));

    poison_view_state_during_update(&root);

    assert!(!root.current());
    assert!(!popup.current());
    let session = root.session.lock().unwrap();
    assert_eq!(session.status(), BrowserSessionStatus::Revoked);
    assert_eq!(session.failure_reason(), Some(BrowserSessionFailure::NativeState));
    assert!(session.with_proxy_credentials(|_, _| ()).is_none());
}

#[tokio::test]
async fn child_shared_session_poison_still_revokes_source_relay() {
    let root = source().await;
    mark_source_ready(&root);
    let popup = child(&root, Arc::new(Sink::default()));
    let poisoned = catch_unwind(AssertUnwindSafe(|| {
        let _session = popup.session.lock().unwrap();
        panic!("shared session fixture");
    }));
    assert!(poisoned.is_err());

    assert!(!popup.current());
    assert!(!root.current());
    let session = root.session.lock().unwrap_or_else(|error| error.into_inner());
    assert_eq!(session.status(), BrowserSessionStatus::Revoked);
    assert_eq!(session.failure_reason(), Some(BrowserSessionFailure::NativeState));
    assert!(session.with_proxy_credentials(|_, _| ()).is_none());
}

#[test]
fn only_supported_native_dispositions_are_adoptable() {
    assert_eq!(
        disposition(WindowOpenDisposition::NEW_FOREGROUND_TAB),
        Some(PopupDisposition::Foreground)
    );
    assert_eq!(
        disposition(WindowOpenDisposition::NEW_POPUP),
        Some(PopupDisposition::Foreground)
    );
    assert_eq!(
        disposition(WindowOpenDisposition::NEW_BACKGROUND_TAB),
        Some(PopupDisposition::Background)
    );
    for unsupported in [
        WindowOpenDisposition::CURRENT_TAB,
        WindowOpenDisposition::SAVE_TO_DISK,
        WindowOpenDisposition::OFF_THE_RECORD,
        WindowOpenDisposition::UNKNOWN,
    ] {
        assert_eq!(disposition(unsupported), None);
    }
}
