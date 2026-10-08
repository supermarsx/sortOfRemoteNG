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
