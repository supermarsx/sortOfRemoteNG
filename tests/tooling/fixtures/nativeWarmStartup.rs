//! Execute the production warm-runtime branch and adjacent creation handoff.
//! Doubles model owner reads/revocation; no app, user DB, proxy or CEF is started.
use std::{
    future::Future,
    pin::pin,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    task::{Context, Poll, Wake, Waker},
};

const STALE: &str = "stale";
const TLS_UNAVAILABLE: &str = "tls unavailable";
struct Admission;
impl Admission {
    fn ready(&self) -> bool {
        true
    }
}
struct Registry {
    admission: Admission,
    certificate_hooks: AtomicBool,
}
static REGISTRY: Registry = Registry {
    admission: Admission,
    certificate_hooks: AtomicBool::new(true),
};
fn shared() -> &'static Registry {
    &REGISTRY
}
struct Window;
#[derive(Default)]
struct State {
    reject_read: AtomicBool,
    revoke_after_read: AtomicBool,
    reads: AtomicUsize,
}
struct Lease {
    current: AtomicBool,
}
impl Lease {
    fn is_current(&self) -> bool {
        self.current.load(Ordering::Acquire)
    }
}
struct Document {
    current: AtomicBool,
}
impl Document {
    fn current(&self) -> bool {
        self.current.load(Ordering::Acquire)
    }
}
struct Authorized {
    lease: Lease,
}
enum TimingStage {
    InitialOwnerChecked,
}
#[derive(Default)]
struct Timing {
    checked: AtomicBool,
}
impl Timing {
    fn mark(&self, _: TimingStage) {
        self.checked.store(true, Ordering::Release);
    }
}

async fn recheck_startup(
    _: &Window,
    state: &State,
    lease: &Lease,
    _: Option<()>,
) -> Result<(), String> {
    state.reads.fetch_add(1, Ordering::Relaxed);
    if state.reject_read.load(Ordering::Acquire) || !lease.is_current() {
        return Err(STALE.into());
    }
    if state.revoke_after_read.load(Ordering::Acquire) {
        lease.current.store(false, Ordering::Release);
    }
    Ok(())
}
async fn ensure_runtime(
    window: &Window,
    state: &State,
    lease: &Lease,
    prewarm: Option<()>,
    _: &Timing,
    _: &Document,
) -> Result<(), String> {
    /* PRODUCTION_READY */
    panic!("fixture requires an already-warm engine")
}
async fn handoff(
    state: &State,
    authorized: &Authorized,
    document: &Document,
    timing: &Timing,
) -> Result<(), String> {
    let window = Window;
    /* PRODUCTION_HANDOFF */
    Ok(())
}

struct Noop;
impl Wake for Noop {
    fn wake(self: Arc<Self>) {}
}
fn run(future: impl Future<Output = Result<(), String>>) -> Result<(), String> {
    let waker = Waker::from(Arc::new(Noop));
    match pin!(future).as_mut().poll(&mut Context::from_waker(&waker)) {
        Poll::Ready(result) => result,
        Poll::Pending => panic!("the doubles must not perform background work"),
    }
}
fn fixture() -> (State, Authorized, Document, Timing) {
    REGISTRY.certificate_hooks.store(true, Ordering::Release);
    (
        State::default(),
        Authorized {
            lease: Lease {
                current: AtomicBool::new(true),
            },
        },
        Document {
            current: AtomicBool::new(true),
        },
        Timing::default(),
    )
}

#[test]
fn warm_create_has_one_disk_read_not_two() {
    let (state, authorized, document, timing) = fixture();
    assert_eq!(
        run(handoff(&state, &authorized, &document, &timing)),
        Ok(())
    );
    assert_eq!(state.reads.load(Ordering::Relaxed), 1);
    assert!(timing.checked.load(Ordering::Acquire));
}
#[test]
fn every_new_tab_rechecks_instead_of_reusing_another_tabs_authority() {
    let (state, authorized, document, timing) = fixture();
    assert!(run(handoff(&state, &authorized, &document, &timing)).is_ok());
    state.reject_read.store(true, Ordering::Release);
    assert_eq!(
        run(handoff(&state, &authorized, &document, &timing)),
        Err(STALE.into())
    );
    assert_eq!(state.reads.load(Ordering::Relaxed), 2);
}
#[test]
fn rejected_owner_never_finishes_initial_check() {
    let (state, authorized, document, timing) = fixture();
    state.reject_read.store(true, Ordering::Release);
    assert_eq!(
        run(handoff(&state, &authorized, &document, &timing)),
        Err(STALE.into())
    );
    assert!(!timing.checked.load(Ordering::Acquire));
}
#[test]
fn revocation_at_handoff_cannot_reuse_the_completed_read() {
    let (state, authorized, document, timing) = fixture();
    state.revoke_after_read.store(true, Ordering::Release);
    assert_eq!(
        run(handoff(&state, &authorized, &document, &timing)),
        Err(STALE.into())
    );
    assert!(!timing.checked.load(Ordering::Acquire));
}
#[test]
fn replaced_frontend_document_cannot_finish_handoff() {
    let (state, authorized, document, timing) = fixture();
    document.current.store(false, Ordering::Release);
    assert_eq!(
        run(handoff(&state, &authorized, &document, &timing)),
        Err(STALE.into())
    );
    assert!(!timing.checked.load(Ordering::Acquire));
}
#[test]
fn warm_engine_does_not_bypass_certificate_support() {
    let (state, authorized, document, timing) = fixture();
    REGISTRY.certificate_hooks.store(false, Ordering::Release);
    assert_eq!(
        run(handoff(&state, &authorized, &document, &timing)),
        Err(TLS_UNAVAILABLE.into())
    );
    assert!(!timing.checked.load(Ordering::Acquire));
}
