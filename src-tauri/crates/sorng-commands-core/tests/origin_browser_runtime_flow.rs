//! Exercise the production async handoffs without initializing CEF or networking.
#[path = "../../../src/origin_browser_runtime_flow.rs"]
mod flow;

use std::{
    cell::{Cell, RefCell},
    time::Duration,
};
use tokio::sync::oneshot;

#[test]
fn native_runtime_stays_pending_until_policy_readback_and_then_admits() {
    let admission = flow::RuntimeAdmission::default();
    assert!(!admission.ready());
    assert!(!admission.revoked());
    admission.observe_policy(false);
    assert!(!admission.ready());
    assert!(!admission.revoked());
    admission.observe_policy(true);
    assert!(admission.ready());
    admission.observe_policy(true);
    assert!(admission.ready());
}

#[test]
fn late_policy_setup_cannot_undo_startup_or_watchdog_revocation() {
    for initially_ready in [false, true] {
        let admission = flow::RuntimeAdmission::default();
        admission.observe_policy(initially_ready);
        admission.revoke();
        admission.observe_policy(true);
        assert!(!admission.ready());
        assert!(admission.revoked());
    }
}

#[test]
fn a_previously_configured_policy_becoming_pending_is_terminal() {
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    admission.observe_policy(false);
    admission.observe_policy(true);
    assert!(!admission.ready());
    assert!(admission.revoked());
}

#[test]
fn concurrent_policy_success_cannot_restore_revoked_runtime() {
    for _ in 0..64 {
        let admission = std::sync::Arc::new(flow::RuntimeAdmission::default());
        let observer = admission.clone();
        let task = std::thread::spawn(move || observer.observe_policy(true));
        admission.revoke();
        task.join().unwrap();
        assert!(!admission.ready());
        assert!(admission.revoked());
    }
}

#[test]
fn abandoned_handoff_revokes_once_but_completed_handoff_does_not() {
    let revoked = Cell::new(0);
    {
        let _guard = flow::RevokeOnDrop::new(|| revoked.set(revoked.get() + 1));
    }
    assert_eq!(revoked.get(), 1);
    flow::RevokeOnDrop::new(|| revoked.set(revoked.get() + 1)).disarm();
    assert_eq!(revoked.get(), 1);
}

#[tokio::test]
async fn dropping_create_after_preparation_revokes_while_owner_recheck_is_pending() {
    let current = Cell::new(true);
    let (started, prepared) = oneshot::channel();
    let mut create = Box::pin(async {
        let _creation = flow::RevokeOnDrop::new(|| current.set(false));
        flow::admit_prepared::<(), &str, _, _>(
            async {
                started.send(()).unwrap();
                Ok::<_, &str>(())
            },
            || std::future::pending::<Result<(), &str>>(),
            || async { panic!("no navigation before owner recheck") },
        )
        .await
    });
    tokio::select! {
        _ = prepared => (),
        _ = &mut create => panic!("creation must still be pending"),
    }
    assert!(current.get());
    drop(create);
    assert!(
        !current.get(),
        "the native attempt must be revoked on cancellation"
    );
}

#[tokio::test]
async fn dropping_create_after_initial_navigation_is_queued_revokes_before_it_executes() {
    let current = Cell::new(true);
    let navigations = Cell::new(0);
    let (queued, queue) = oneshot::channel();
    let mut create = Box::pin(async {
        let _creation = flow::RevokeOnDrop::new(|| current.set(false));
        flow::admit_prepared(
            async { Ok::<_, &str>(()) },
            || async { Ok(()) },
            || async {
                let (reply, receiver) = oneshot::channel::<()>();
                queued.send(reply).unwrap();
                receiver.await.map_err(|_| "abandoned")
            },
        )
        .await
    });
    let reply = tokio::select! {
        callback = queue => callback.unwrap(),
        _ = &mut create => panic!("creation must await the native callback"),
    };
    drop(create);
    assert!(reply.is_closed());
    assert!(!current.get());
    // These are the same admission predicates used by the queued UI callback.
    if !reply.is_closed() && current.get() {
        navigations.set(navigations.get() + 1);
    }
    assert_eq!(navigations.get(), 0);
}

#[tokio::test]
async fn completed_creation_keeps_its_attempt_live() {
    let current = Cell::new(true);
    let creation = flow::RevokeOnDrop::new(|| current.set(false));
    assert_eq!(
        flow::admit_prepared(
            async { Ok::<_, &str>(()) },
            || async { Ok(()) },
            || async { Ok("snapshot") },
        )
        .await,
        Ok("snapshot")
    );
    creation.disarm();
    assert!(current.get());
}

#[tokio::test]
async fn changed_saved_owner_during_preparation_prevents_initial_navigation() {
    let saved_revision = Cell::new(1);
    let navigations = Cell::new(0);
    let checks = Cell::new(0);
    let (ready, prepared) = oneshot::channel();
    let start = flow::admit_prepared(
        async { prepared.await.unwrap() },
        || async {
            checks.set(checks.get() + 1);
            if saved_revision.get() == 1 {
                Ok(())
            } else {
                Err("saved owner changed")
            }
        },
        || async {
            navigations.set(navigations.get() + 1);
            Ok(())
        },
    );
    tokio::pin!(start);
    // Start has already passed its earlier authorization; preparation is pending.
    assert!(tokio::time::timeout(Duration::from_millis(10), &mut start)
        .await
        .is_err());
    assert_eq!(checks.get(), 0);
    saved_revision.set(2);
    ready.send(Ok(())).unwrap();
    assert_eq!(start.await, Err("saved owner changed"));
    assert_eq!(checks.get(), 1);
    assert_eq!(navigations.get(), 0);
}

#[tokio::test]
async fn readiness_does_not_navigate_while_fresh_recheck_is_pending() {
    let events = RefCell::new(Vec::new());
    let (checked, recheck) = oneshot::channel();
    let start = flow::admit_prepared(
        async {
            events.borrow_mut().push("prepared");
            Ok::<_, &str>(())
        },
        || async {
            events.borrow_mut().push("recheck");
            recheck.await.unwrap()
        },
        || async {
            events.borrow_mut().push("navigate");
            Ok(())
        },
    );
    tokio::pin!(start);
    assert!(tokio::time::timeout(Duration::from_millis(10), &mut start)
        .await
        .is_err());
    assert_eq!(*events.borrow(), ["prepared", "recheck"]);
    checked.send(Ok(())).unwrap();
    assert_eq!(start.await, Ok(()));
    assert_eq!(*events.borrow(), ["prepared", "recheck", "navigate"]);
}

#[tokio::test]
async fn failed_preparation_never_rechecks_or_navigates() {
    let calls = Cell::new(0);
    let result = flow::admit_prepared(
        async { Err::<(), _>("renderer failed") },
        || async {
            calls.set(calls.get() + 1);
            Ok(())
        },
        || async {
            calls.set(calls.get() + 1);
            Ok(())
        },
    )
    .await;
    assert_eq!(result, Err("renderer failed"));
    assert_eq!(calls.get(), 0);
}

#[tokio::test]
async fn cancellation_during_recheck_does_not_enqueue_initial_navigation() {
    let navigations = Cell::new(0);
    let result = tokio::time::timeout(
        Duration::from_millis(10),
        flow::admit_prepared(
            async { Ok::<_, &str>(()) },
            || std::future::pending::<Result<(), &str>>(),
            || async {
                navigations.set(navigations.get() + 1);
                Ok(())
            },
        ),
    )
    .await;
    assert!(result.is_err());
    assert_eq!(navigations.get(), 0);
}

#[tokio::test]
async fn stalled_ui_keeps_one_callback_then_resumes_cleanup_without_admission() {
    let admission = Cell::new(true);
    let revoked = Cell::new(0);
    let queued = Cell::new(1);
    let (late_ui, receiver) = oneshot::channel();
    let pump = async {
        flow::wait_for_pump(receiver, Duration::from_millis(10), || {
            admission.set(false);
            revoked.set(revoked.get() + 1);
        })
        .await
        .unwrap();
        // Only completion of the original callback permits another cleanup tick.
        queued.set(queued.get() + 1);
    };
    tokio::pin!(pump);
    assert!(tokio::time::timeout(Duration::from_millis(35), &mut pump)
        .await
        .is_err());
    assert!(!admission.get());
    assert_eq!(revoked.get(), 1);
    assert_eq!(queued.get(), 1);
    assert!(
        !late_ui.is_closed(),
        "the outstanding callback must survive timeout"
    );
    late_ui.send(()).unwrap();
    pump.await;
    assert_eq!(queued.get(), 2);
    assert!(
        !admission.get(),
        "UI recovery must not restore network admission"
    );
    // Continued cleanup can acknowledge OnBeforeClose after the resumed tick.
    let (closed, receiver) = oneshot::channel();
    closed.send("OnBeforeClose").unwrap();
    assert_eq!(
        flow::wait_for_pump(receiver, Duration::from_secs(1), || panic!("not stalled"))
            .await
            .unwrap(),
        "OnBeforeClose"
    );
}

#[tokio::test]
async fn normal_tick_completes_without_revocation() {
    let (sender, receiver) = oneshot::channel();
    sender.send(7).unwrap();
    assert_eq!(
        flow::wait_for_pump(receiver, Duration::from_secs(1), || panic!("not stalled"))
            .await
            .unwrap(),
        7
    );
}
