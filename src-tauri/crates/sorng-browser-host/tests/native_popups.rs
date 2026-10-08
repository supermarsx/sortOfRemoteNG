//! Standalone std-only lifecycle gate: rustc --edition 2021 --test this file.
//! Uses real registry code; does not claim actual CEF popup integration.
#[allow(dead_code)]
#[path = "../src/native_popups.rs"]
mod native_popups;

use native_popups::*;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

struct Context {
    live: Cell<bool>,
    navigation_allowed: Cell<bool>,
}
struct Authority;
impl PopupAuthority<Context> for Authority {
    fn current(&self, context: &Rc<Context>) -> bool {
        context.live.get()
    }
    fn destination_allowed(&self, context: &Rc<Context>, url: &str) -> bool {
        context.navigation_allowed.get()
            && (url == "about:blank" || url.starts_with("https://allowed.test/"))
    }
}
struct View {
    id: i32,
    closes: Rc<RefCell<Vec<i32>>>,
    fail: Rc<Cell<bool>>,
}
impl PopupView for View {
    fn browser_id(&self) -> i32 {
        self.id
    }
    fn request_close(&mut self) -> Result<(), PopupError> {
        self.closes.borrow_mut().push(self.id);
        if self.fail.get() {
            Err(PopupError::NativeCloseFailed)
        } else {
            Ok(())
        }
    }
}
fn source(database: &str) -> PopupSourceIdentity {
    PopupSourceIdentity {
        owner_database_id: database.into(),
        connection_id: "connection".into(),
        session_id: "source-tab".into(),
        attempt_id: "attempt-1".into(),
    }
}
struct Fixture {
    registry: PopupRegistry<Context, View, Authority>,
    context: Rc<Context>,
    closes: Rc<RefCell<Vec<i32>>>,
    fail: Rc<Cell<bool>>,
    now: Instant,
}
impl Fixture {
    fn new(database: &str) -> Self {
        let context = Rc::new(Context {
            live: Cell::new(true),
            navigation_allowed: Cell::new(true),
        });
        Self {
            registry: PopupRegistry::new(
                source(database),
                "main".into(),
                1,
                context.clone(),
                Authority,
            )
            .unwrap(),
            context,
            closes: Rc::new(RefCell::new(vec![])),
            fail: Rc::new(Cell::new(false)),
            now: Instant::now(),
        }
    }
    fn view(&self, id: i32) -> View {
        View {
            id,
            closes: self.closes.clone(),
            fail: self.fail.clone(),
        }
    }
    fn reserve(&mut self, popup_id: i32, disposition: PopupDisposition) -> String {
        self.registry
            .reserve(
                1,
                popup_id,
                "https://allowed.test/path?private=1",
                disposition,
                true,
                self.now,
            )
            .unwrap()
    }
    fn attach(&mut self, id: &str, browser_id: i32) {
        self.registry
            .attach(id, self.context.clone(), self.view(browser_id), self.now)
            .unwrap();
    }
}

#[test]
fn adopts_actual_child_without_recreating_source_context_and_preserves_disposition() {
    for (db, disposition) in [
        ("saved-db", PopupDisposition::Foreground),
        ("quick-connect:source-tab", PopupDisposition::Background),
    ] {
        let mut f = Fixture::new(db);
        let id = f.reserve(7, disposition);
        assert!(f
            .registry
            .inventory("main", &source(db))
            .unwrap()
            .views
            .is_empty());
        f.attach(&id, 2);
        let available = f.registry.inventory("main", &source(db)).unwrap();
        assert_eq!(available.views[0].phase, PopupPhase::Available);
        assert_eq!(available.views[0].disposition, disposition);
        assert!(available.source_identity == source(db));
        f.registry.adopt("main", &source(db), &id, f.now).unwrap();
        f.registry.adopt("main", &source(db), &id, f.now).unwrap();
        assert_eq!(
            f.registry
                .with_view("main", &source(db), &id, |v| v.browser_id()),
            Ok(2)
        );
        assert!(f.context.live.get());
        assert!(f.closes.borrow().is_empty());
    }
}

#[test]
fn rejects_other_window_database_session_and_attempt_even_with_same_connection_id() {
    let mut f = Fixture::new("db");
    let id = f.reserve(1, PopupDisposition::Foreground);
    f.attach(&id, 2);
    assert_eq!(
        f.registry.adopt("detached", &source("db"), &id, f.now),
        Err(PopupError::InvalidSource)
    );
    for which in 0..3 {
        let mut other = source("db");
        match which {
            0 => other.owner_database_id = "other-db".into(),
            1 => other.session_id = "other-tab".into(),
            _ => other.attempt_id = "attempt-2".into(),
        }
        assert_eq!(
            f.registry.adopt("main", &other, &id, f.now),
            Err(PopupError::InvalidSource)
        );
        assert_eq!(
            f.registry.close_view("main", &other, &id),
            Err(PopupError::InvalidSource)
        );
    }
    assert!(f.closes.borrow().is_empty());
}

#[test]
fn closing_child_leaves_parent_and_sibling_live_until_its_native_ack() {
    let mut f = Fixture::new("db");
    let a = f.reserve(1, PopupDisposition::Foreground);
    let b = f.reserve(2, PopupDisposition::Background);
    f.attach(&a, 2);
    f.attach(&b, 3);
    f.registry.adopt("main", &source("db"), &b, f.now).unwrap();
    f.registry.close_view("main", &source("db"), &a).unwrap();
    f.registry.close_view("main", &source("db"), &a).unwrap();
    assert_eq!(*f.closes.borrow(), vec![2]);
    assert!(f.context.live.get());
    assert_eq!(
        f.registry
            .with_view("main", &source("db"), &b, |v| v.browser_id()),
        Ok(3)
    );
    assert_eq!(
        f.registry
            .inventory("main", &source("db"))
            .unwrap()
            .views
            .len(),
        2
    );
    f.registry.before_close(2);
    assert_eq!(
        f.registry
            .inventory("main", &source("db"))
            .unwrap()
            .views
            .len(),
        1
    );
    assert!(!f.registry.drained());
}

#[test]
fn parent_close_cascades_and_retains_pending_creations_until_native_ack() {
    let mut f = Fixture::new("quick-connect:source-tab");
    let a = f.reserve(1, PopupDisposition::Foreground);
    let pending = f.reserve(2, PopupDisposition::Background);
    f.attach(&a, 2);
    f.context.live.set(false); // The real Attempt revokes the relay first.
    f.registry.close_source().unwrap();
    assert!(!f.registry.drained());
    assert_eq!(*f.closes.borrow(), vec![2]);
    assert!(
        f.registry
            .inventory("main", &source("quick-connect:source-tab"))
            .unwrap()
            .source_closed
    );
    assert!(f
        .registry
        .attach(&pending, f.context.clone(), f.view(3), f.now)
        .is_err());
    assert_eq!(*f.closes.borrow(), vec![2, 3]);
    f.registry.before_close(2);
    assert!(!f.registry.drained());
    f.registry.before_close(3);
    assert!(f.registry.drained());
}

#[test]
fn aborted_pending_creation_does_not_release_parent_or_existing_children() {
    let mut f = Fixture::new("db");
    let a = f.reserve(1, PopupDisposition::Foreground);
    f.attach(&a, 2);
    f.registry.creation_aborted(&a); // A late abort must not erase a live handle.
    assert_eq!(
        f.registry
            .inventory("main", &source("db"))
            .unwrap()
            .views
            .len(),
        1
    );
    let pending = f.reserve(2, PopupDisposition::Foreground);
    f.registry.close_source().unwrap();
    f.registry.before_close(2);
    assert!(!f.registry.drained());
    f.registry.creation_aborted(&pending);
    assert!(f.registry.drained());
}

#[test]
fn wrong_context_is_closed_and_retained_until_close_ack_even_if_ids_match() {
    let mut f = Fixture::new("db");
    let id = f.reserve(1, PopupDisposition::Foreground);
    let other = Rc::new(Context {
        live: Cell::new(true),
        navigation_allowed: Cell::new(true),
    });
    let weak = Rc::downgrade(&other);
    assert_eq!(
        f.registry.attach(&id, other, f.view(2), f.now),
        Err(PopupError::ContextMismatch)
    );
    assert!(weak.upgrade().is_some());
    assert_eq!(*f.closes.borrow(), vec![2]);
    f.registry.before_close(2);
    assert!(weak.upgrade().is_none());
    assert!(f.context.live.get());
}

#[test]
fn destination_gesture_and_native_opener_are_required_blank_is_policy_checked() {
    let mut f = Fixture::new("db");
    assert_eq!(
        f.registry.reserve(
            1,
            1,
            "https://blocked.test/",
            PopupDisposition::Foreground,
            true,
            f.now
        ),
        Err(PopupError::InvalidDestination)
    );
    assert_eq!(
        f.registry.reserve(
            1,
            1,
            "https://allowed.test/",
            PopupDisposition::Foreground,
            false,
            f.now
        ),
        Err(PopupError::GestureRequired)
    );
    assert_eq!(
        f.registry.reserve(
            90,
            1,
            "https://allowed.test/",
            PopupDisposition::Foreground,
            true,
            f.now
        ),
        Err(PopupError::InvalidSource)
    );
    for target in [
        "file:///secret",
        "javascript:alert(1)",
        "data:text/html,test",
        "https://allowed.test/\n",
    ] {
        assert_eq!(
            f.registry
                .reserve(1, 1, target, PopupDisposition::Foreground, true, f.now),
            Err(PopupError::InvalidDestination)
        );
    }
    assert!(f
        .registry
        .reserve(
            1,
            1,
            "about:blank",
            PopupDisposition::Foreground,
            true,
            f.now
        )
        .is_ok());
}

#[test]
fn permits_popup_from_attached_child_but_not_a_closing_opener() {
    let mut f = Fixture::new("db");
    let id = f.reserve(1, PopupDisposition::Foreground);
    f.attach(&id, 2);
    assert!(f
        .registry
        .reserve(
            2,
            1,
            "about:blank",
            PopupDisposition::Background,
            true,
            f.now
        )
        .is_ok());
    f.registry.close_view("main", &source("db"), &id).unwrap();
    assert_eq!(
        f.registry.reserve(
            2,
            2,
            "about:blank",
            PopupDisposition::Background,
            true,
            f.now
        ),
        Err(PopupError::InvalidSource)
    );
}

#[test]
fn bounds_children_and_rejects_duplicate_requests() {
    let mut f = Fixture::new("db");
    f.reserve(0, PopupDisposition::Foreground);
    assert_eq!(
        f.registry.reserve(
            1,
            0,
            "about:blank",
            PopupDisposition::Foreground,
            true,
            f.now
        ),
        Err(PopupError::DuplicateRequest)
    );
    for i in 1..MAX_POPUP_VIEWS {
        f.reserve(i as i32, PopupDisposition::Background);
    }
    assert_eq!(
        f.registry.reserve(
            1,
            99,
            "about:blank",
            PopupDisposition::Foreground,
            true,
            f.now
        ),
        Err(PopupError::LimitReached)
    );
}

#[test]
fn expires_unadopted_view_without_revoking_parent_and_retries_failed_close() {
    let mut f = Fixture::new("db");
    let id = f.reserve(1, PopupDisposition::Foreground);
    f.attach(&id, 2);
    let expired = f.now + POPUP_ADOPTION_TIMEOUT;
    assert_eq!(
        f.registry.adopt("main", &source("db"), &id, expired),
        Err(PopupError::InvalidTransition)
    );
    f.fail.set(true);
    assert_eq!(
        f.registry.maintain(expired),
        Err(PopupError::NativeCloseFailed)
    );
    f.fail.set(false);
    f.registry.maintain(expired).unwrap();
    f.registry.maintain(expired).unwrap();
    assert_eq!(*f.closes.borrow(), vec![2, 2]);
    assert!(f.context.live.get());
}

#[test]
fn owner_revocation_fences_controls_and_closes_all_children() {
    let mut f = Fixture::new("db");
    let id = f.reserve(1, PopupDisposition::Foreground);
    f.attach(&id, 2);
    f.registry.adopt("main", &source("db"), &id, f.now).unwrap();
    f.context.live.set(false);
    assert_eq!(
        f.registry
            .with_view("main", &source("db"), &id, |_| panic!("stale control")),
        Err(PopupError::OwnerUnavailable)
    );
    f.registry.maintain(f.now).unwrap();
    assert_eq!(*f.closes.borrow(), vec![2]);
    f.registry.before_close(2);
    assert!(f.registry.drained());
}

#[test]
fn native_context_mismatch_rejects_even_the_same_rust_anchor() {
    let mut f = Fixture::new("quick-connect:source-tab");
    let id = f.reserve(1, PopupDisposition::Background);
    assert_eq!(
        f.registry
            .attach_verified(&id, f.context.clone(), f.view(2), false, f.now),
        Err(PopupError::ContextMismatch)
    );
    assert_eq!(*f.closes.borrow(), vec![2]);
    assert!(f
        .registry
        .inventory("main", &source("quick-connect:source-tab"))
        .unwrap()
        .views
        .is_empty());
    assert!(f.context.live.get());
    f.registry.close_source().unwrap();
    assert!(!f.registry.drained());
    f.registry.before_close(2);
    assert!(f.registry.drained());
}

#[test]
fn opener_close_acknowledges_only_pending_creations_and_late_child_is_closed() {
    let mut f = Fixture::new("db");
    let pending = f.reserve(1, PopupDisposition::Foreground);
    let attached = f.reserve(2, PopupDisposition::Background);
    f.attach(&attached, 2);
    f.registry.close_source().unwrap();
    assert_eq!(f.registry.opener_closed(1), vec![pending.clone()]);
    assert!(!f.registry.drained());
    assert_eq!(
        f.registry
            .attach(&pending, f.context.clone(), f.view(3), f.now),
        Err(PopupError::InvalidTransition)
    );
    f.registry.before_close(2);
    assert!(!f.registry.drained());
    f.registry.before_close(3);
    assert!(f.registry.drained());
}

#[test]
fn queued_tab_rechecks_permission_before_native_creation() {
    let mut f = Fixture::new("db");
    let id = f.reserve(-1, PopupDisposition::Foreground);
    let url = "https://allowed.test/chosen";
    assert!(f.registry.pending_navigation_allowed(&id, url, f.now));
    for target in ["https://elsewhere.test/", "file:///private", "https://allowed.test/\n"] {
        assert!(!f.registry.pending_navigation_allowed(&id, target, f.now));
    }
    f.context.navigation_allowed.set(false);
    assert!(f.registry.pending_current(&id, f.now));
    assert!(!f.registry.pending_navigation_allowed(&id, url, f.now));
    assert!(f.context.live.get());
    f.registry.creation_aborted(&id);
    assert!(!f.registry.pending_navigation_allowed(&id, url, f.now));
}

#[test]
fn queued_tab_never_creates_after_expiry_close_or_owner_revocation() {
    for case in 0..3 {
        let mut f = Fixture::new("db");
        let id = f.reserve(-1, PopupDisposition::Foreground);
        let mut now = f.now;
        match case {
            0 => now += POPUP_ADOPTION_TIMEOUT,
            1 => f.registry.close_view("main", &source("db"), &id).unwrap(),
            _ => f.context.live.set(false),
        }
        assert!(!f.registry.pending_navigation_allowed(&id, "https://allowed.test/", now));
    }
}

#[test]
fn queued_tab_is_single_creation_and_shares_quota_with_page_popups() {
    let mut f = Fixture::new("db");
    let id = f.reserve(-1, PopupDisposition::Foreground);
    f.attach(&id, 2);
    assert!(!f.registry.pending_navigation_allowed(&id, "https://allowed.test/", f.now));
    f.registry.adopt("main", &source("db"), &id, f.now).unwrap();
    assert!(!f.registry.pending_navigation_allowed(&id, "https://allowed.test/", f.now));
    for popup in 1..MAX_POPUP_VIEWS {
        f.reserve(popup as i32, PopupDisposition::Background);
    }
    assert_eq!(
        f.registry.reserve(2, -2, "https://allowed.test/", PopupDisposition::Foreground, true, f.now),
        Err(PopupError::LimitReached)
    );
}

#[test]
fn explicit_tab_uses_native_current_url_including_path_query_and_fragment() {
    let native = "https://allowed.test/selected/path?q=private#anchor";
    assert_eq!(tab_destination(None, || Some(native.into())), Ok(native.into()));
    assert_eq!(tab_destination(None, || None), Err(PopupError::InvalidDestination));
}

#[test]
fn explicit_address_is_distinct_from_current_page_and_never_falls_back() {
    let address = "https://allowed.test/entered";
    assert_eq!(
        tab_destination(Some(address), || panic!("must not read another native URL")),
        Ok(address.into())
    );
    assert_eq!(
        tab_destination(Some(""), || panic!("empty address is not current page")),
        Err(PopupError::InvalidDestination)
    );
}

#[test]
fn explicit_tab_rejects_non_web_control_and_oversized_targets_without_bootstrap() {
    for target in [
        "", "about:blank", "chrome://extensions", "file:///private",
        "javascript:alert(1)", "data:text/html,test", "https://allowed.test/\n",
        "https://allowed.test/\0",
    ] {
        assert_eq!(tab_destination(Some(target), || None), Err(PopupError::InvalidDestination));
        assert_eq!(tab_destination(None, || Some(target.into())), Err(PopupError::InvalidDestination));
    }
    let oversized = format!("https://allowed.test/{}", "x".repeat(16_384));
    assert_eq!(tab_destination(Some(&oversized), || None), Err(PopupError::InvalidDestination));
    // UTF-8 byte bound also applies after the native UTF-16 length check.
    let multibyte = format!("https://allowed.test/{}", "界".repeat(6_000));
    assert_eq!(tab_destination(None, || Some(multibyte)), Err(PopupError::InvalidDestination));
}
