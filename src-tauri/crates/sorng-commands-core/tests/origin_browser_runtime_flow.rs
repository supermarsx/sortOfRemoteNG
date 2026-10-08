//! Exercise the production async handoffs without initializing CEF or networking.
#[path = "../../../src/origin_browser_runtime_flow.rs"]
mod flow;

use std::{
    cell::{Cell, RefCell},
    time::Duration,
};
use tokio::sync::oneshot;

#[test]
fn shell_reload_replaces_only_its_document_without_reviving_old_holders() {
    let documents = flow::ShellDocuments::default();
    assert!(
        !documents.revoke("main"),
        "initial page load has no old epoch"
    );
    let old = documents.current("main");
    let other = documents.current("other");
    assert!(std::sync::Arc::ptr_eq(&old, &documents.current("main")));
    assert!(documents.revoke("main"));
    let replacement = documents.current("main");
    assert!(!old.current());
    assert!(other.current());
    assert!(replacement.current());
    assert!(!std::sync::Arc::ptr_eq(&old, &replacement));
    assert!(documents.revoke("main"));
    assert!(!replacement.current());
    assert!(other.current());
}

#[tokio::test]
async fn revoked_document_does_not_poll_a_late_create() {
    let documents = flow::ShellDocuments::default();
    let document = documents.current("main");
    documents.revoke("main");
    assert_eq!(
        document
            .run(async { panic!("old command must not authorize") })
            .await,
        None::<()>
    );
    assert_eq!(documents.current("main").run(async { 7 }).await, Some(7));
}

#[tokio::test]
async fn reload_drops_in_flight_authorization_without_waiting_for_its_reply() {
    let documents = flow::ShellDocuments::default();
    let document = documents.current("main");
    let dropped = Cell::new(false);
    let (entered, entry) = oneshot::channel();
    let create = document.run(async {
        let _guard = flow::RevokeOnDrop::new(|| dropped.set(true));
        entered.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    tokio::pin!(create);
    tokio::select! {
        _ = entry => (),
        _ = &mut create => panic!("authorization must be pending"),
    }
    documents.revoke("main");
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), create)
            .await
            .unwrap(),
        None
    );
    assert!(dropped.get());
}

#[tokio::test]
async fn reload_during_owner_recheck_revokes_before_navigation() {
    let documents = flow::ShellDocuments::default();
    let document = documents.current("main");
    let current = Cell::new(true);
    let (entered, entry) = oneshot::channel();
    let create = document.run(async {
        let _guard = flow::RevokeOnDrop::new(|| current.set(false));
        flow::admit_prepared(
            async { Ok::<_, &str>(()) },
            || async {
                entered.send(()).unwrap();
                std::future::pending::<Result<(), &str>>().await
            },
            || async { panic!("revoked document must not navigate") },
        )
        .await
    });
    tokio::pin!(create);
    tokio::select! {
        _ = entry => (),
        _ = &mut create => panic!("owner recheck must be pending"),
    }
    documents.revoke("main");
    assert_eq!(create.await, None::<Result<(), &str>>);
    assert!(!current.get());
}

#[tokio::test]
async fn reload_fences_queued_navigation_even_before_cancelled_future_is_resumed() {
    let documents = flow::ShellDocuments::default();
    let document = documents.current("main");
    let (queued, queue) = oneshot::channel();
    let current = Cell::new(true);
    let create = document.run(async {
        let _guard = flow::RevokeOnDrop::new(|| current.set(false));
        let (reply, receiver) = oneshot::channel::<()>();
        queued.send(reply).unwrap();
        receiver.await
    });
    tokio::pin!(create);
    let reply = tokio::select! {
        reply = queue => reply.unwrap(),
        _ = &mut create => panic!("UI callback must be pending"),
    };
    documents.revoke("main");
    assert!(!reply.is_closed(), "the task has not yet resumed");
    assert!(!document.current(), "UI admission is already fenced");
    assert!(create.await.is_none());
    assert!(reply.is_closed());
    assert!(!current.get());
}

#[tokio::test]
async fn reload_wakes_all_old_creates_but_not_another_window() {
    let documents = flow::ShellDocuments::default();
    let mut old = Vec::new();
    for _ in 0..64 {
        let document = documents.current("main");
        let (entered, entry) = oneshot::channel();
        old.push(tokio::spawn(async move {
            document
                .run(async {
                    entered.send(()).unwrap();
                    std::future::pending::<()>().await;
                })
                .await
        }));
        entry.await.unwrap();
    }
    let other = documents.current("other");
    let (reply, receiver) = oneshot::channel();
    let task = tokio::spawn(async move { other.run(receiver).await });
    documents.revoke("main");
    for task in old {
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap(),
            None
        );
    }
    assert!(!task.is_finished());
    reply.send(9).unwrap();
    assert_eq!(task.await.unwrap().unwrap().unwrap(), 9);
}

#[test]
fn reload_cancels_queued_native_entry_without_consuming_the_provider() {
    let documents = flow::ShellDocuments::default();
    let document = documents.current("main");
    let startup = flow::StartupGate::default();
    let claim = flow::StartupClaim::default();
    let permit = startup.prepare().unwrap();
    documents.revoke("main");
    assert!(!claim.cancel_abandoned(&document));
    assert!(!claim.claim_native());
    drop(permit);
    assert!(startup.prepare().is_some());
}

#[test]
fn reload_after_native_entry_is_local_but_timeout_and_policy_revocation_stay_terminal() {
    let documents = flow::ShellDocuments::default();
    let old = documents.current("main");
    let startup = flow::StartupGate::default();
    let permit = startup.prepare().unwrap();
    let claim = flow::StartupClaim::default();
    let admission = flow::RuntimeAdmission::default();
    assert!(claim.claim_native());
    assert!(permit.begin_native());
    documents.revoke("main");
    assert!(!admission.timeout_owned_startup(claim.cancel_abandoned(&old)));
    assert!(!admission.ready(), "reload grants no native readiness");
    assert!(!admission.revoked());
    assert!(
        startup.prepare().is_none(),
        "CEF must never be initialized twice"
    );
    admission.observe_policy(true);
    assert!(admission.ready());
    admission.observe_policy(false);
    admission.observe_policy(true);
    assert!(admission.revoked(), "real policy loss remains terminal");

    let live = documents.current("main");
    let timed_out = flow::RuntimeAdmission::default();
    let claim = flow::StartupClaim::default();
    assert!(claim.claim_native());
    assert!(timed_out.timeout_owned_startup(claim.cancel_abandoned(&live)));
    timed_out.observe_policy(true);
    assert!(timed_out.revoked());
}

#[test]
fn production_shell_hook_fences_creates_and_callbacks_without_global_revocation() {
    let app = include_str!("../../../src/lib.rs");
    assert!(app.contains(".on_page_load(|webview, payload|"));
    assert!(app.contains("payload.event() == tauri::webview::PageLoadEvent::Started"));
    assert!(app.contains("webview.label() == webview.window().label()"));
    assert!(app.contains("shell_document_started(webview.window().label())"));
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let window_revoke = runtime
        .split("pub(crate) fn revoke_window(")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn on_event(")
        .next()
        .unwrap();
    assert!(window_revoke.contains("shared().documents.revoke(label)"));
    assert!(window_revoke.contains("!attempt.document.current()"));
    assert!(!window_revoke.contains("revoke_all("));
    assert!(!window_revoke.contains("admission.revoke("));
    assert!(runtime.contains(".run(create_document("));
    assert!(runtime.contains(".run(prewarm_document("));
    assert!(runtime.contains("startup_claim.cancel_abandoned(document)"));
    assert!(runtime.contains("&& queued_document.current()"));
    assert!(runtime.contains("|| !queued_document.current()"));
    assert!(runtime.contains("if !shared().admission.ready() || !attempt.current()"));
}

#[tokio::test]
async fn synchronously_admitted_unpolled_startups_cannot_borrow_replacement_document() {
    let documents = flow::ShellDocuments::default();
    let other = documents.current("other");
    let admissions = Cell::new(0);
    let admission_count = &admissions;
    // Model both sync invoke branches: capture BEFORE constructing the task,
    // then deliberately leave the entire task unpolled until after reload.
    let queued = ["create", "prewarm"].map(|_| {
        let captured = documents.current("main");
        async move {
            captured
                .run(async {
                    admission_count.set(admission_count.get() + 1);
                    "authorized"
                })
                .await
        }
    });
    assert_eq!(admissions.get(), 0);
    assert!(documents.revoke("main"));
    let replacement = documents.current("main");
    for unpolled in queued {
        assert_eq!(unpolled.await, None);
    }
    assert_eq!(admissions.get(), 0, "neither old task may authorize");
    assert!(other.current());
    assert_eq!(
        replacement.run(async { "new document" }).await,
        Some("new document")
    );
}

#[test]
fn startup_dispatch_captures_before_spawn_and_async_runtime_never_recaptures() {
    let commands = include_str!("../../../src/origin_browser_commands.rs");
    let dispatch = commands
        .split("pub(crate) fn dispatch_startup(")
        .nth(1)
        .unwrap()
        .split("const UNAVAILABLE:")
        .next()
        .unwrap();
    let capture = dispatch
        .find("capture_startup_document(window.label())")
        .unwrap();
    let spawns: Vec<_> = dispatch
        .match_indices("resolver.respond_async(async move")
        .collect();
    assert_eq!(spawns.len(), 2);
    assert!(spawns.iter().all(|(position, _)| *position > capture));
    assert!(dispatch.contains("WebviewWindow::from_command(CommandItem"));
    assert!(dispatch.contains("<$ty>::from_command(CommandItem"));
    assert_eq!(dispatch.matches("acl: &acl").count(), 4);
    assert!(dispatch.contains("origin_browser_create(window, state, request, document)"));
    assert!(dispatch.contains("origin_browser_prewarm(window, state, request, document)"));
    assert!(dispatch.contains("resolver.reject(\"Browser creation request is invalid\")"));

    let router = include_str!("../../../src/invoke_handler.rs");
    assert!(
        router.find("dispatch_startup(invoke)").unwrap()
            < router
                .find("return origin_browser_handler(invoke)")
                .unwrap()
    );
    assert!(!router.contains("crate::origin_browser_commands::origin_browser_create,"));
    assert!(!router.contains("crate::origin_browser_commands::origin_browser_prewarm,"));

    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    assert_eq!(runtime.matches("shared().documents.current(").count(), 1);
    for (entry, next) in [
        ("create", "create_document"),
        ("prewarm", "prewarm_document"),
    ] {
        let start = format!("pub(crate) async fn {entry}(");
        let end = format!("async fn {next}(");
        let wrapper = runtime
            .split(&start)
            .nth(1)
            .unwrap()
            .split(&end)
            .next()
            .unwrap();
        assert!(wrapper.contains("document: StartupDocument"));
        assert!(wrapper.contains("let document = document.0;"));
        assert!(!wrapper.contains("documents.current("));
        assert!(!wrapper.contains("capture_startup_document("));
    }
}

#[test]
fn deferred_preflight_is_exclusive_and_retryable_until_native_entry() {
    let startup = flow::StartupGate::default();
    assert!(startup.deferred());
    let permit = startup.prepare().unwrap();
    assert!(startup.prepare().is_none());
    assert!(!startup.started());
    // A path/settings failure or canceled command does not consume the provider.
    drop(permit);
    let permit = startup.prepare().unwrap();
    assert!(permit.begin_native());
    assert!(!permit.begin_native());
    drop(permit);
    assert!(startup.started());
    assert!(!startup.deferred());
    assert!(startup.prepare().is_none());
    startup.fail();
    assert!(startup.prepare().is_none());
}

#[test]
fn revoked_queued_startup_cannot_initialize_or_restore_deferred() {
    let startup = flow::StartupGate::default();
    let queued = startup.prepare().unwrap();
    startup.fail();
    assert!(!queued.begin_native());
    drop(queued);
    assert!(!startup.deferred());
    assert!(startup.prepare().is_none());
}

#[tokio::test]
async fn cancelled_queued_owner_releases_preflight_without_entering_native() {
    let startup = flow::StartupGate::default();
    let permit = startup.prepare().unwrap();
    let (reply, caller) = oneshot::channel::<()>();
    drop(caller);
    let owner_current = false;
    assert!(!(!reply.is_closed() && owner_current && permit.begin_native()));
    drop(permit);
    assert!(!startup.started());
    assert!(startup.prepare().is_some());
}

#[test]
fn concurrent_first_connections_issue_exactly_one_native_initialization() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    let startup = Arc::new(flow::StartupGate::default());
    let starts = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(8));
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let (startup, starts, barrier) = (startup.clone(), starts.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                if let Some(permit) = startup.prepare() {
                    if permit.begin_native() {
                        starts.fetch_add(1, Ordering::AcqRel);
                    }
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(starts.load(Ordering::Acquire), 1);
}

#[tokio::test]
async fn policy_wait_is_bounded_and_late_success_cannot_reopen_admission() {
    let startup = flow::StartupGate::default();
    let admission = flow::RuntimeAdmission::default();
    let permit = startup.prepare().unwrap();
    assert!(permit.begin_native());
    let outcome = flow::wait_for_readiness(
        Duration::from_millis(5),
        || Ok::<_, &str>(admission.ready()),
        || {
            startup.fail();
            admission.revoke();
            "timeout"
        },
    )
    .await;
    assert_eq!(outcome, Err("timeout"));
    admission.observe_policy(true);
    assert!(!admission.ready());
    assert!(startup.prepare().is_none());
}

#[tokio::test]
async fn readiness_wait_rejects_lost_owner_and_does_not_mistake_startup_for_ready() {
    let admission = flow::RuntimeAdmission::default();
    assert_eq!(
        flow::wait_for_readiness(
            Duration::from_secs(1),
            || Err::<bool, _>("owner revoked"),
            || "timeout"
        )
        .await,
        Err("owner revoked")
    );
    let checks = Cell::new(0);
    flow::wait_for_readiness(
        Duration::from_secs(1),
        || {
            checks.set(checks.get() + 1);
            if checks.get() == 2 {
                admission.observe_policy(true);
            }
            Ok::<_, &str>(admission.ready())
        },
        || "timeout",
    )
    .await
    .unwrap();
    assert_eq!(checks.get(), 2);
}

#[test]
fn caller_timeout_only_revokes_its_own_pending_native_startup() {
    let admission = flow::RuntimeAdmission::default();
    assert!(!admission.timeout_owned_startup(false));
    assert!(!admission.revoked());
    assert!(admission.timeout_owned_startup(true));
    admission.observe_policy(true);
    assert!(admission.revoked());
    assert!(!admission.ready());

    let healthy = flow::RuntimeAdmission::default();
    healthy.observe_policy(true);
    for owns_startup in [false, true] {
        assert!(!healthy.timeout_owned_startup(owns_startup));
        assert!(healthy.ready());
        assert!(!healthy.revoked());
    }
}

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
            std::future::pending::<Result<(), &str>>,
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
            std::future::pending::<Result<(), &str>>,
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

#[test]
fn timeout_between_ui_checks_and_entry_claim_prevents_native_start() {
    use std::sync::{Arc, Barrier};
    let gate = flow::StartupGate::default();
    let claim = flow::StartupClaim::default();
    let barrier = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        let ui = scope.spawn(|| {
            let permit = gate.prepare().unwrap();
            barrier.wait(); // Earlier UI cancellation/owner checks succeeded.
            barrier.wait(); // Timeout wins before entry can be claimed.
            assert!(!claim.claim_native());
            drop(permit);
        });
        barrier.wait();
        assert!(!claim.cancel()); // No native ownership: don't revoke others.
        barrier.wait();
        ui.join().unwrap();
    });
    assert!(gate.deferred());
    assert!(gate.prepare().is_some()); // A fresh manual retry remains possible.
}

#[test]
fn timeout_after_claim_before_global_started_revokes_late_readiness() {
    use std::sync::{Arc, Barrier};
    let gate = flow::StartupGate::default();
    let claim = flow::StartupClaim::default();
    let admission = flow::RuntimeAdmission::default();
    let barrier = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        let ui = scope.spawn(|| {
            let permit = gate.prepare().unwrap();
            assert!(claim.claim_native());
            barrier.wait(); // Ownership published, global STARTED not yet set.
            barrier.wait();
            assert!(!permit.begin_native());
            admission.observe_policy(true); // A late callback cannot revive it.
        });
        barrier.wait();
        assert!(!gate.started());
        assert!(admission.timeout_owned_startup(claim.cancel()));
        gate.fail();
        barrier.wait();
        ui.join().unwrap();
    });
    assert!(admission.revoked());
    assert!(!admission.ready());
    assert!(!claim.claim_native());
    assert!(!claim.cancel());
}
