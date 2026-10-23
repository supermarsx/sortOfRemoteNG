//! Exercise the production async handoffs without initializing CEF or networking.
#[path = "../../../src/origin_browser_runtime_flow.rs"]
mod flow;
#[path = "../../../src/origin_browser_renderer_startup.rs"]
mod renderer_startup;

use std::{
    cell::{Cell, RefCell},
    time::Duration,
};
use tokio::sync::oneshot;

fn renderer_start_state() -> renderer_startup::StartState {
    renderer_startup::StartState {
        current: true,
        runtime_ready: true,
        document_current: true,
        ordinary_close: false,
        response_open: true,
    }
}

#[tokio::test]
async fn renderer_startup_reports_observed_fault_after_its_own_revocation() {
    use renderer_startup::{Decision, RendererStartup};
    let startup = RendererStartup::default();
    let (sender, receiver) = oneshot::channel();
    startup.observe_renderer_failure(true);
    let mut state = renderer_start_state();
    state.current = false; // The real renderer callback revoked its attempt.
    let decision = startup.decision(state);
    assert_eq!(decision, Decision::RendererFailed);
    sender.send(decision).unwrap();
    assert_eq!(receiver.await.unwrap(), Decision::RendererFailed);
    // The same completed receipt cannot be replayed as a new renderer failure.
    let mut state = renderer_start_state();
    state.current = false;
    assert_eq!(startup.decision(state), Decision::Stale);
}

#[test]
fn renderer_startup_does_not_upgrade_foreign_or_cancelled_events_to_faults() {
    use renderer_startup::{Decision, RendererStartup};
    let startup = RendererStartup::default();
    startup.observe_renderer_failure(false);
    let mut state = renderer_start_state();
    state.current = false;
    assert_eq!(startup.decision(state), Decision::Stale);
    startup.observe_renderer_failure(true);
    let mut state = renderer_start_state();
    state.current = false;
    assert_eq!(startup.decision(state), Decision::Stale);
}

#[test]
fn renderer_startup_discarded_document_close_or_response_supersedes_old_fault() {
    use renderer_startup::{Decision, RendererStartup};
    for invalidation in 0..4 {
        let startup = RendererStartup::default();
        startup.observe_renderer_failure(true);
        let mut state = renderer_start_state();
        match invalidation {
            0 => state.document_current = false,
            1 => state.ordinary_close = true,
            2 => state.response_open = false,
            _ => state.runtime_ready = false,
        }
        assert_eq!(startup.decision(state), Decision::Stale);
        assert_eq!(startup.decision(renderer_start_state()), Decision::Stale);
    }
}

#[test]
fn renderer_startup_success_cannot_inherit_a_later_document_failure() {
    use renderer_startup::{Decision, RendererStartup};
    let startup = RendererStartup::default();
    assert_eq!(startup.decision(renderer_start_state()), Decision::Continue);
    startup.finish();
    startup.observe_renderer_failure(true);
    let mut state = renderer_start_state();
    state.current = false;
    assert_eq!(startup.decision(state), Decision::Stale);
}

#[test]
fn blocked_attempt_revocation_leaves_registry_available() {
    use std::{
        collections::HashMap,
        sync::{mpsc, Arc, Mutex},
        thread,
    };

    let captured = Arc::new(());
    let attempts = Arc::new(Mutex::new(HashMap::from([(
        "old".to_owned(),
        captured.clone(),
    )])));
    let (entered, entry) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let worker_attempts = attempts.clone();
    let worker = thread::spawn(move || {
        flow::visit_attempt_snapshot(&worker_attempts, |attempt| {
            assert!(Arc::ptr_eq(&attempt, &captured));
            entered.send(()).unwrap();
            // Bound the fixture even if an assertion fails on the other thread.
            released.recv_timeout(Duration::from_secs(2)).unwrap();
        });
    });
    entry.recv_timeout(Duration::from_secs(2)).unwrap();
    let available = attempts.try_lock().is_ok_and(|mut registry| {
        assert!(registry.contains_key("old"));
        registry.insert("fresh".into(), Arc::new(()));
        true
    });
    release.send(()).unwrap();
    worker.join().unwrap();
    assert!(
        available,
        "a blocked attempt must not block unrelated lookup/create"
    );
    assert!(attempts.lock().unwrap().contains_key("fresh"));
}

#[test]
fn attempt_snapshot_revokes_captured_instance_not_same_key_successor() {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
    };

    let original = Arc::new(AtomicBool::new(false));
    let replacement = Arc::new(AtomicBool::new(false));
    let attempts = Mutex::new(HashMap::from([("same-id".to_owned(), original.clone())]));
    let mut visited = 0;
    flow::visit_attempt_snapshot(&attempts, |attempt| {
        // Reentrant registry access and replacement cannot alter the captured Arc.
        attempts
            .try_lock()
            .unwrap()
            .insert("same-id".into(), replacement.clone());
        assert!(Arc::ptr_eq(&attempt, &original));
        attempt.store(true, Ordering::Release);
        visited += 1;
    });
    assert_eq!(visited, 1);
    assert!(original.load(Ordering::Acquire));
    assert!(!replacement.load(Ordering::Acquire));
    assert!(Arc::ptr_eq(
        &attempts.lock().unwrap()["same-id"],
        &replacement
    ));
}

#[test]
fn attempt_snapshot_recovers_poison_only_to_visit_exact_owners() {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        thread,
    };

    let original = Arc::new(());
    let attempts = Arc::new(Mutex::new(HashMap::from([(
        "old".to_owned(),
        original.clone(),
    )])));
    let poison = attempts.clone();
    assert!(thread::spawn(move || {
        let _guard = poison.lock().unwrap();
        panic!("fixture poisons registry");
    })
    .join()
    .is_err());
    let mut visited = 0;
    flow::visit_attempt_snapshot(&attempts, |attempt| {
        assert!(Arc::ptr_eq(&attempt, &original));
        let guard = match attempts.try_lock() {
            Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
            _ => panic!("snapshot must release the registry without clearing poison"),
        };
        assert_eq!(guard.len(), 1);
        visited += 1;
    });
    assert_eq!(visited, 1);
    assert!(attempts.is_poisoned());
}

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
    assert!(!document.current());
    // Production drops the old document's command, which cancels its claim.
    assert!(
        !claim.cancel(),
        "no start was entered, so none is left running"
    );
    assert!(!claim.claim_native());
    drop(permit);
    assert!(startup.prepare().is_some());
}

#[test]
fn a_caller_that_ends_after_native_entry_is_local_while_policy_loss_and_the_start_watchdog_stay_terminal(
) {
    // The ways a caller ends once its start was entered: its shell document
    // reloads, its prewarm is cancelled or its command is dropped, or its own
    // deadline passes. Each of them only cancels that caller's claim.
    for reload in [true, false] {
        let documents = flow::ShellDocuments::default();
        let old = documents.current("main");
        let startup = flow::StartupGate::default();
        let permit = startup.prepare().unwrap();
        let claim = flow::StartupClaim::default();
        let admission = flow::RuntimeAdmission::default();
        assert!(claim.claim_native());
        assert!(permit.begin_native());
        if reload {
            documents.revoke("main");
            assert!(!old.current());
        }
        assert!(claim.cancel(), "the entered start is left to the runtime");
        assert!(!claim.cancel(), "and that is reported once");
        assert!(admission.pending(), "a caller's end revokes nothing");
        assert!(!admission.ready(), "and grants no native readiness");
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
    }

    let expired = flow::RuntimeAdmission::default();
    assert!(expired.expire_pending_start());
    expired.observe_policy(true);
    assert!(expired.revoked(), "the start watchdog remains terminal");
    assert!(!expired.ready());
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
    // A reload ends its commands like any other caller: the dropped command
    // cancels its own claim, and nothing here can revoke the shared engine.
    let ensure = runtime
        .split("async fn ensure_runtime(")
        .nth(1)
        .unwrap()
        .split("fn watch_native_start()")
        .next()
        .unwrap();
    in_order(
        ensure,
        &[
            "flow::RevokeOnDrop::new(|| {",
            "startup_claim.cancel()",
            "tokio::time::timeout(STARTUP_LIMIT, async {",
        ],
    );
    assert!(!runtime.contains("cancel_abandoned"));
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
        .match_indices(
            "resolver.respond_async(crate::origin_browser_startup_task::task(move || async move",
        )
        .collect();
    assert_eq!(spawns.len(), 2);
    assert!(spawns.iter().all(|(position, _)| *position > capture));
    assert!(!dispatch.contains("resolver.respond_async(async move"));
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
async fn a_callers_deadline_after_its_claim_fails_only_that_caller() {
    let startup = flow::StartupGate::default();
    let admission = flow::RuntimeAdmission::default();
    let claim = flow::StartupClaim::default();
    let permit = startup.prepare().unwrap();
    assert!(claim.claim_native());
    assert!(permit.begin_native());
    drop(permit);
    // The caller that entered native initialization reaches its own deadline
    // while that initialization is still running.
    let first = flow::wait_for_readiness(
        Duration::from_millis(5),
        || Ok::<_, &str>(admission.ready()),
        || "timeout",
    )
    .await;
    assert_eq!(first, Err("timeout"));
    assert!(claim.cancel());
    assert!(admission.pending());
    assert!(!admission.revoked());
    // A second caller joins the same start and is admitted by its readback.
    let checks = Cell::new(0);
    let joined = flow::wait_for_readiness(
        Duration::from_secs(5),
        || {
            checks.set(checks.get() + 1);
            if checks.get() == 3 {
                admission.observe_policy(true);
            }
            Ok::<_, &str>(admission.ready())
        },
        || "timeout",
    )
    .await;
    assert_eq!(joined, Ok(()));
    assert!(admission.ready());
    // The first caller was answered before readiness and stays answered.
    assert_eq!(first, Err("timeout"));
    assert!(startup.prepare().is_none());
}

#[tokio::test]
async fn start_watchdog_revokes_a_start_with_no_readback_and_late_success_cannot_reopen_it() {
    let startup = flow::StartupGate::default();
    let admission = flow::RuntimeAdmission::default();
    let permit = startup.prepare().unwrap();
    assert!(permit.begin_native());
    drop(permit);
    let limit = Duration::from_millis(40);
    let began = std::time::Instant::now();
    assert!(flow::native_start_expired(&admission, limit, Duration::from_millis(10)).await);
    assert!(
        began.elapsed() >= limit,
        "the whole budget is observed first"
    );
    assert!(admission.revoked());
    admission.observe_policy(true);
    assert!(!admission.ready());
    assert!(startup.prepare().is_none());
    // One decision per start: a second watchdog has nothing left to end.
    assert!(
        !flow::native_start_expired(&admission, Duration::ZERO, Duration::from_millis(1)).await
    );
}

#[tokio::test]
async fn start_watchdog_ends_quietly_once_readback_or_a_real_fault_decided_the_start() {
    let admission = flow::RuntimeAdmission::default();
    let watchdog = flow::native_start_expired(
        &admission,
        Duration::from_secs(30),
        Duration::from_millis(5),
    );
    tokio::pin!(watchdog);
    assert!(
        tokio::time::timeout(Duration::from_millis(30), &mut watchdog)
            .await
            .is_err(),
        "a pending start is watched, not ended early"
    );
    assert!(admission.pending());
    admission.observe_policy(true);
    assert!(!tokio::time::timeout(Duration::from_secs(5), watchdog)
        .await
        .unwrap());
    assert!(admission.ready());

    let failed = flow::RuntimeAdmission::default();
    failed.revoke();
    assert!(!flow::native_start_expired(&failed, Duration::ZERO, Duration::from_millis(1)).await);
    assert!(failed.revoked());
}

#[test]
fn start_watchdog_budget_is_two_minutes_spent_in_whole_observed_steps() {
    assert_eq!(flow::NATIVE_START_LIMIT, Duration::from_secs(120));
    let step = flow::NATIVE_START_STEP;
    assert!((Duration::from_millis(50)..=Duration::from_secs(1)).contains(&step));
    assert_eq!(flow::NATIVE_START_LIMIT.as_millis() % step.as_millis(), 0);
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
fn only_the_start_watchdog_can_expire_a_pending_start_and_never_a_ready_runtime() {
    let admission = flow::RuntimeAdmission::default();
    assert!(admission.pending());
    assert!(admission.expire_pending_start());
    assert!(!admission.pending());
    admission.observe_policy(true);
    assert!(admission.revoked());
    assert!(!admission.ready());
    assert!(!admission.expire_pending_start(), "one start, one expiry");

    let healthy = flow::RuntimeAdmission::default();
    healthy.observe_policy(true);
    assert!(!healthy.pending());
    assert!(!healthy.expire_pending_start());
    assert!(healthy.ready());
    // A host suspended for one late UI callback is not a pending start.
    let recovery = healthy.suspend_for_watchdog().unwrap();
    assert!(!healthy.pending());
    assert!(!healthy.expire_pending_start());
    assert!(recovery.complete(true));
    assert!(healthy.ready());
    assert!(!healthy.revoked());
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
fn late_policy_setup_cannot_undo_terminal_revocation() {
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
fn watchdog_suspension_requires_its_one_use_completion_token() {
    let admission = flow::RuntimeAdmission::default();
    assert!(admission.suspend_for_watchdog().is_none());
    admission.observe_policy(true);
    let recovery = admission.suspend_for_watchdog().unwrap();
    assert!(admission.suspended());
    assert!(!admission.ready());
    assert!(!admission.revoked());
    assert!(admission.suspend_for_watchdog().is_none());
    admission.observe_policy(true);
    assert!(admission.suspended(), "unrelated readback cannot recover");
    assert!(recovery.complete(true));
    assert!(admission.ready());
    // Completing consumes the token: a later stall needs its own callback.
    let later = admission.suspend_for_watchdog().unwrap();
    admission.observe_policy(true);
    assert!(!admission.ready());
    assert!(later.complete(true));
    assert!(admission.ready());
}

#[test]
fn dropping_uncompleted_recovery_fails_closed_without_orphaned_suspension() {
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    let recovery = admission.suspend_for_watchdog().unwrap();
    assert!(admission.suspended());
    drop(recovery);
    assert!(!admission.suspended());
    assert!(admission.revoked());
    admission.observe_policy(true);
    assert!(!admission.ready());
    assert!(admission.suspend_for_watchdog().is_none());
}

#[test]
fn abandonment_claim_is_once_only_and_does_not_replace_a_hard_failure() {
    for already_revoked in [false, true] {
        let admission = flow::RuntimeAdmission::default();
        admission.observe_policy(true);
        let mut recovery = admission.suspend_for_watchdog().unwrap();
        if already_revoked {
            admission.revoke(); // Existing policy fault or normal shutdown.
        }
        // Only a winning claim authorizes the runtime's abandonment diagnostic.
        assert_eq!(recovery.abandon(), !already_revoked);
        assert!(!recovery.abandon());
        drop(recovery);
        assert!(admission.revoked());
        admission.observe_policy(true);
        assert!(!admission.ready());
    }
}

#[test]
fn unwinding_recovery_owner_cannot_leave_suspended_admission() {
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    assert!(std::panic::catch_unwind(|| {
        let _recovery = admission.suspend_for_watchdog().unwrap();
        panic!("fixture abandons the recovery owner");
    })
    .is_err());
    assert!(admission.revoked());
    assert!(!admission.suspended());
    admission.observe_policy(true);
    assert!(!admission.ready());
}

#[tokio::test]
async fn dropping_waiting_supervisor_revokes_before_a_late_healthy_callback() {
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    let old_attempt = Cell::new(true);
    let (sender, receiver) = oneshot::channel::<bool>();
    let mut supervisor = Box::pin(async {
        // Match production ownership: the token lives INSIDE the supervisor,
        // not in the outer fixture that survives dropping the future.
        let mut recovery = None;
        let healthy = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
            recovery = admission.suspend_for_watchdog();
            old_attempt.set(false);
        })
        .await
        .unwrap();
        recovery.unwrap().complete(healthy)
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(35), &mut supervisor)
            .await
            .is_err()
    );
    assert!(admission.suspended());
    assert!(!old_attempt.get());
    drop(supervisor);
    assert!(admission.revoked());
    assert!(!admission.suspended());
    assert!(sender.is_closed());
    assert_eq!(sender.send(true), Err(true));
    admission.observe_policy(true);
    assert!(!admission.ready());
    assert!(!old_attempt.get());
}

#[test]
fn suspended_policy_loss_or_failed_completion_is_terminal() {
    for policy_lost in [false, true] {
        let admission = flow::RuntimeAdmission::default();
        admission.observe_policy(true);
        let recovery = admission.suspend_for_watchdog().unwrap();
        if policy_lost {
            admission.observe_policy(false);
            admission.observe_policy(true);
        }
        assert!(!recovery.complete(policy_lost));
        admission.observe_policy(true);
        assert!(admission.revoked());
        assert!(!admission.ready());
        assert!(admission.suspend_for_watchdog().is_none());
    }
}

#[test]
fn hard_revoke_before_or_racing_watchdog_completion_cannot_be_undone() {
    for race in [false, true] {
        for _ in 0..64 {
            let admission = flow::RuntimeAdmission::default();
            admission.observe_policy(true);
            let recovery = admission.suspend_for_watchdog().unwrap();
            if race {
                std::thread::scope(|scope| {
                    let recovering = scope.spawn(|| recovery.complete(true));
                    admission.revoke();
                    recovering.join().unwrap();
                });
            } else {
                admission.revoke();
                assert!(!recovery.complete(true));
            }
            admission.observe_policy(true);
            assert!(admission.revoked());
            assert!(!admission.ready());
        }
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
async fn stalled_ui_recovers_only_after_exact_callback_without_reviving_attempts() {
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    let old_attempt = Cell::new(true);
    let revoked = Cell::new(0);
    let queued = Cell::new(1);
    let (late_ui, receiver) = oneshot::channel();
    let pump = async {
        let mut recovery = None;
        let healthy = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
            recovery = admission.suspend_for_watchdog();
            old_attempt.set(false);
            revoked.set(revoked.get() + 1);
        })
        .await
        .unwrap();
        assert!(!old_attempt.get());
        assert!(recovery.unwrap().complete(healthy));
        // Only completion of the original callback permits another tick.
        queued.set(queued.get() + 1);
    };
    tokio::pin!(pump);
    assert!(tokio::time::timeout(Duration::from_millis(35), &mut pump)
        .await
        .is_err());
    assert!(admission.suspended());
    assert!(!admission.ready());
    assert!(!old_attempt.get());
    assert_eq!(revoked.get(), 1);
    assert_eq!(queued.get(), 1);
    assert!(
        !late_ui.is_closed(),
        "the outstanding callback must survive timeout"
    );
    admission.observe_policy(true);
    assert!(
        !admission.ready(),
        "another policy observation is not this callback"
    );
    late_ui.send(true).unwrap();
    pump.await;
    assert_eq!(queued.get(), 2);
    assert!(admission.ready());
    assert!(
        !old_attempt.get(),
        "recovery never revives old attempt authority"
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
async fn fast_callback_completion_cannot_bypass_a_blocked_attempt_revoker() {
    use std::sync::{mpsc, Arc};
    let admission = Arc::new(flow::RuntimeAdmission::default());
    admission.observe_policy(true);
    let old_attempt = Cell::new(true);
    let (sender, receiver) = oneshot::channel();
    let (stalled, stall) = mpsc::channel();
    let (finished, callback_finished) = mpsc::channel();
    let callback_admission = admission.clone();
    let callback = std::thread::spawn(move || {
        stall.recv_timeout(Duration::from_secs(2)).unwrap();
        // The exact UI callback returns while the revoker still waits.
        sender.send(true).unwrap();
        assert!(callback_admission.suspended());
        assert!(!callback_admission.ready());
        finished.send(()).unwrap();
    });
    let mut recovery = None;
    let healthy = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
        recovery = admission.suspend_for_watchdog();
        stalled.send(()).unwrap();
        callback_finished
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        assert!(old_attempt.get(), "fixture cleanup is still pending");
        assert!(!admission.ready());
        old_attempt.set(false);
    })
    .await
    .unwrap();
    callback.join().unwrap();
    assert!(!old_attempt.get());
    assert!(recovery.unwrap().complete(healthy));
    assert!(admission.ready());
    assert!(!old_attempt.get());
}

#[tokio::test]
async fn prior_revoker_must_publish_completion_before_exact_callback_can_recover() {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Mutex,
        },
    };
    #[derive(Default)]
    struct Attempt {
        cancelled: AtomicBool,
        complete: AtomicBool,
    }
    impl Attempt {
        fn revoke(&self, finish: impl FnOnce()) {
            if self.cancelled.swap(true, Ordering::AcqRel) {
                return;
            }
            finish();
            self.complete.store(true, Ordering::Release);
        }
    }
    let old = Arc::new(Attempt::default());
    let replacement = Arc::new(Attempt::default());
    let attempts = Mutex::new(HashMap::from([("same-id".to_owned(), old.clone())]));
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let revoking = old.clone();
    let prior = std::thread::spawn(move || {
        revoking.revoke(|| {
            started.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(2)).unwrap();
        })
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    let (ui, receiver) = oneshot::channel::<bool>();
    let mut supervisor = Box::pin(async {
        let mut recovery = None;
        let mut captured = Vec::new();
        let healthy = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
            recovery = admission.suspend_for_watchdog();
            captured = flow::snapshot_attempts(&attempts);
            for attempt in &captured {
                attempt.revoke(|| panic!("the prior revoker owns capability cleanup"));
            }
        })
        .await
        .unwrap();
        assert!(Arc::ptr_eq(&captured[0], &old));
        assert!(flow::wait_for_readiness(
            Duration::from_secs(1),
            || Ok::<_, ()>(
                captured
                    .iter()
                    .all(|attempt| attempt.complete.load(Ordering::Acquire))
            ),
            || (),
        )
        .await
        .is_ok());
        recovery.unwrap().complete(healthy)
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(35), &mut supervisor)
            .await
            .is_err()
    );
    assert!(old.cancelled.load(Ordering::Acquire));
    assert!(!old.complete.load(Ordering::Acquire));
    ui.send(true).unwrap(); // Exact callback/policy succeeds, prior revoke still blocked.
    attempts
        .lock()
        .unwrap()
        .insert("same-id".into(), replacement.clone());
    assert!(
        tokio::time::timeout(Duration::from_millis(35), &mut supervisor)
            .await
            .is_err()
    );
    assert!(admission.suspended());
    assert!(
        !admission.ready(),
        "cancelled is not a capability-revocation receipt"
    );
    assert!(!replacement.cancelled.load(Ordering::Acquire));
    release.send(()).unwrap();
    prior.join().unwrap();
    assert!(supervisor.await);
    assert!(admission.ready());
    assert!(old.complete.load(Ordering::Acquire));
    assert!(!replacement.cancelled.load(Ordering::Acquire));
}

#[tokio::test]
async fn unfinished_capability_revocation_times_out_without_late_readiness() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    let mut recovery = admission.suspend_for_watchdog().unwrap();
    let complete = AtomicBool::new(false);
    assert!(flow::wait_for_readiness(
        Duration::from_millis(15),
        || Ok::<_, ()>(complete.load(Ordering::Acquire)),
        || (),
    )
    .await
    .is_err());
    assert!(admission.suspended());
    assert!(
        recovery.abandon(),
        "timeout claims the fixed runtime diagnostic once"
    );
    assert!(!recovery.abandon());
    assert!(admission.revoked());
    complete.store(true, Ordering::Release);
    admission.observe_policy(true);
    assert!(
        !admission.ready(),
        "late cleanup cannot undo a terminal timeout"
    );
}

#[tokio::test]
async fn a_slow_first_pump_leaves_a_pending_start_to_its_own_readback() {
    let admission = flow::RuntimeAdmission::default();
    let (sender, receiver) = oneshot::channel();
    let pump = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
        // Production: a start has no ready host to suspend and no attempt to
        // revoke, and the pump timer ends nothing while `pending()`.
        assert!(admission.suspend_for_watchdog().is_none());
        assert!(admission.pending());
    });
    tokio::pin!(pump);
    assert!(tokio::time::timeout(Duration::from_millis(35), &mut pump)
        .await
        .is_err());
    assert!(admission.pending());
    assert!(!admission.revoked());
    // The late callback carries the first true policy readback itself.
    admission.observe_policy(true);
    sender.send(true).unwrap();
    assert!(pump.await.unwrap());
    assert!(admission.ready());
    // From here on a late callback is a ready host's stall again.
    assert!(admission.suspend_for_watchdog().is_some());
}

#[tokio::test]
async fn a_lost_first_pump_callback_is_terminal_for_a_pending_start() {
    let admission = flow::RuntimeAdmission::default();
    let (sender, receiver) = oneshot::channel::<bool>();
    let pump = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
        assert!(admission.pending());
    });
    tokio::pin!(pump);
    assert!(tokio::time::timeout(Duration::from_millis(35), &mut pump)
        .await
        .is_err());
    drop(sender);
    // Production: `fail_runtime(RuntimeFailureCode::UiDispatch)` on this error.
    assert!(pump.await.is_err());
    admission.revoke();
    admission.observe_policy(true);
    assert!(admission.revoked());
    assert!(!admission.ready());
}

#[tokio::test]
async fn dropped_callback_after_suspension_cannot_recover_admission() {
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    let (sender, receiver) = oneshot::channel::<bool>();
    let mut recovery = None;
    let pump = async {
        let result = flow::wait_for_pump(receiver, Duration::from_millis(10), || {
            recovery = admission.suspend_for_watchdog();
        })
        .await;
        if result.is_err() {
            admission.revoke();
        }
        result
    };
    tokio::pin!(pump);
    assert!(tokio::time::timeout(Duration::from_millis(35), &mut pump)
        .await
        .is_err());
    assert!(admission.suspended());
    drop(sender);
    assert!(pump.await.is_err());
    admission.observe_policy(true);
    assert!(admission.revoked());
    assert!(!admission.ready());
}

#[test]
fn runtime_watchdog_wires_fresh_callback_evidence_without_terminal_timer_failure() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let pump = runtime
        .split("pub(crate) fn start_pump(")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn install(")
        .next()
        .unwrap();
    let callback = pump
        .split(".run_on_main_thread(move || {")
        .nth(1)
        .unwrap()
        .split("sender.send(completion)")
        .next()
        .unwrap();
    assert!(
        callback.find("tick();").unwrap() < callback.find("network_policy_configured()").unwrap()
    );
    assert!(callback.contains("Some((deadline, healthy))"));
    assert!(callback.contains("runtime_failed(error)"));
    let stalled = pump
        .split("flow::wait_for_pump(")
        .nth(1)
        .unwrap()
        .split("}).await")
        .next()
        .unwrap();
    let transient = stalled
        .split("if recovery.is_some() {")
        .nth(1)
        .unwrap()
        .split("} else if shared().admission.pending() {")
        .next()
        .unwrap();
    assert!(transient.contains("revoked_attempts = flow::snapshot_attempts(&shared().attempts)"));
    assert!(transient.contains("for attempt in &revoked_attempts"));
    assert!(transient.contains("attempt.revoke_for(BrowserSessionFailure::Watchdog);"));
    // A callback that is late fails nothing for good: a ready host is
    // suspended, and a start whose first pump is slow is still starting.
    assert!(stalled.contains("} else if shared().admission.pending() {"));
    for terminal in ["fail_runtime(", "revoke_all(", "admission.revoke("] {
        assert!(
            !stalled.contains(terminal),
            "a late UI callback must not use {terminal}"
        );
    }
    // A callback that is lost, not late, stays terminal.
    let lost = pump
        .split("}).await")
        .nth(1)
        .unwrap()
        .split("// Shutdown has removed the UI registry")
        .next()
        .unwrap();
    assert!(lost.contains("fail_runtime(RuntimeFailureCode::UiDispatch)"));
    assert!(pump.find("}).await").unwrap() < pump.find("recovery.complete(healthy)").unwrap());
    let revoker = runtime
        .split("fn revoke_attempts() {")
        .nth(1)
        .unwrap()
        .split("/// Runtime callback")
        .next()
        .unwrap();
    assert!(revoker.contains("flow::visit_attempt_snapshot(&shared().attempts"));
    assert!(!revoker.contains("admission.revoke("));
    assert!(!revoker.contains("startup.fail("));
}

#[test]
fn create_rejections_drop_registry_before_revocation_without_splitting_admission() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let admission = runtime
        .split("let mut attempts = shared().attempts.lock().map_err(|_| STALE)?;")
        .nth(1)
        .unwrap()
        .split("let (sender, receiver)")
        .next()
        .unwrap();
    let normalized = admission.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(
        normalized
            .matches("drop(attempts); attempt.revoke();")
            .count(),
        2
    );
    assert_eq!(normalized.matches("attempt.revoke();").count(), 2);
    assert!(normalized.contains("if !shared().admission.ready() || !attempt.current()"));
    assert!(normalized.contains("if attempts.len() >= MAX_ATTEMPTS"));
    assert!(normalized.contains("attempts.values().any("));
    assert!(normalized
        .contains("attempts.insert(attempt.identity.attempt_id().to_string(), attempt.clone());"));
    assert!(
        !normalized.contains("attempts.lock()"),
        "check/insert keeps one registry guard"
    );
}

#[test]
fn capability_receipt_and_bounded_wait_precede_readiness_without_ui_waits() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let revoke = runtime
        .split("impl Attempt {")
        .nth(1)
        .unwrap()
        .split("#[derive(Default)]")
        .next()
        .unwrap();
    assert!(
        revoke.find(".revoke(&self.identity)").unwrap()
            < revoke
                .find("self.revocation_complete.store(true, Ordering::Release)")
                .unwrap()
    );
    assert!(revoke.contains("if revoked.is_ok()"));
    assert!(
        !revoke.contains("RevokeOnDrop"),
        "unwind must not publish a receipt"
    );
    assert!(runtime.contains("revocation_complete: AtomicBool::new(false)"));
    let fence = runtime
        .split("if let Some(recovery) = recovery {")
        .nth(1)
        .unwrap()
        .split("let exit_code")
        .next()
        .unwrap();
    assert!(fence.contains("Duration::from_secs(5)"));
    assert!(fence.contains("attempt.revocation_complete.load(Ordering::Acquire)"));
    assert!(
        fence.find("flow::wait_for_readiness(").unwrap()
            < fence.find("recovery.complete(healthy)").unwrap()
    );
    assert!(fence.contains("recovery.incomplete_revocation()"));
    assert!(!fence.contains("run_on_main_thread("));
    let timeout = runtime
        .split("fn incomplete_revocation(mut self) {")
        .nth(1)
        .unwrap()
        .split("impl Drop for PumpSupervisorRecovery")
        .next()
        .unwrap();
    assert!(timeout.contains("recovery.abandon()"));
    assert!(timeout.contains("record_current(RuntimeFailureCode::UiDispatch)"));
    for forbidden in [
        "fail_runtime(",
        "revoke_all(",
        "revoke_attempts(",
        ".lock(",
        "UI.with(",
    ] {
        assert!(
            !timeout.contains(forbidden),
            "bounded timeout cannot use {forbidden}"
        );
    }
}

#[test]
fn supervisor_abandonment_guard_only_reports_a_winning_local_transition() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let complete = runtime
        .split("impl PumpSupervisorRecovery {")
        .nth(1)
        .unwrap()
        .split("impl Drop for PumpSupervisorRecovery {")
        .next()
        .unwrap();
    assert!(
        complete.find("self.0.take()").unwrap()
            < complete.find("recovery.complete(healthy)").unwrap()
    );
    let guard = runtime
        .split("impl Drop for PumpSupervisorRecovery {")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn start_pump(")
        .next()
        .unwrap();
    assert!(guard.contains("if self.0.as_mut().is_some_and(|recovery| recovery.abandon())"));
    assert!(guard.contains("record_current(RuntimeFailureCode::UiDispatch)"));
    assert!(guard.contains("Native browser watchdog recovery supervisor abandoned"));
    for forbidden in [
        "revoke_all(",
        "revoke_attempts(",
        "fail_runtime(",
        "UI.with(",
        ".attempts",
        ".session",
        "startup.fail(",
    ] {
        assert!(
            !guard.contains(forbidden),
            "destructor must not use {forbidden}"
        );
    }
    assert!(runtime.contains(".map(|token| PumpSupervisorRecovery(Some(token)))"));
    let flow_source = include_str!("../../../src/origin_browser_runtime_flow.rs");
    let complete = flow_source
        .split("impl PumpRecovery<'_> {")
        .nth(1)
        .unwrap()
        .split("pub(super) fn abandon(")
        .next()
        .unwrap();
    assert!(
        complete.find("self.armed = false;").unwrap()
            < complete.find(".compare_exchange(").unwrap()
    );
    // Diagnostics use the existing first-cause store, not a new overwrite path.
    let failure_store = include_str!("../../../src/origin_browser_runtime_failure.rs");
    let record = failure_store
        .split("pub(crate) fn record_current(")
        .nth(1)
        .unwrap()
        .split("pub(crate) fn snapshot(")
        .next()
        .unwrap();
    assert!(record.contains("state.failure.get_or_insert("));
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
fn caller_ending_after_claim_before_global_started_neither_stops_nor_repeats_the_start() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    let gate = flow::StartupGate::default();
    let claim = flow::StartupClaim::default();
    let admission = flow::RuntimeAdmission::default();
    let initializations = AtomicUsize::new(0);
    let barrier = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        let ui = scope.spawn(|| {
            let permit = gate.prepare().unwrap();
            assert!(claim.claim_native());
            barrier.wait(); // Entry claimed, global STARTED not yet set.
            barrier.wait();
            // The caller ended in between. The claimed entry still commits,
            // exactly once, and its readback admits.
            if permit.begin_native() {
                initializations.fetch_add(1, Ordering::AcqRel);
            }
            assert!(!permit.begin_native());
            drop(permit);
            admission.observe_policy(true);
        });
        barrier.wait();
        assert!(!gate.started());
        assert!(claim.cancel());
        assert!(admission.pending());
        barrier.wait();
        ui.join().unwrap();
    });
    assert_eq!(initializations.load(Ordering::Acquire), 1);
    assert!(admission.ready());
    assert!(!admission.revoked());
    assert!(gate.started());
    assert!(gate.prepare().is_none(), "no second native initialization");
    assert!(!claim.claim_native());
    assert!(!claim.cancel());
}

#[test]
fn a_second_native_initialization_is_impossible_whatever_ends_the_first_caller_or_the_start() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    };
    // Sixteen first connections race; every other one has already ended.
    let startup = Arc::new(flow::StartupGate::default());
    let starts = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(16));
    let threads: Vec<_> = (0..16)
        .map(|caller| {
            let (startup, starts, barrier) = (startup.clone(), starts.clone(), barrier.clone());
            std::thread::spawn(move || {
                let claim = flow::StartupClaim::default();
                if caller % 2 == 1 {
                    claim.cancel();
                }
                barrier.wait();
                if let Some(permit) = startup.prepare() {
                    if claim.claim_native() && permit.begin_native() {
                        starts.fetch_add(1, Ordering::AcqRel);
                    }
                    // A caller that ends after its claim changes nothing.
                    claim.cancel();
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    // A caller that had ended releases its permit unused, so a live one may
    // still enter afterwards. Settle the race with one more live caller.
    if let Some(permit) = startup.prepare() {
        if permit.begin_native() {
            starts.fetch_add(1, Ordering::AcqRel);
        }
    }
    assert_eq!(starts.load(Ordering::Acquire), 1);
    assert!(startup.started());
    assert!(startup.prepare().is_none());
    // Neither readiness, nor expiry, nor a real fault reopens the gate.
    let admission = flow::RuntimeAdmission::default();
    admission.observe_policy(true);
    assert!(startup.prepare().is_none());
    let expired = flow::RuntimeAdmission::default();
    assert!(expired.expire_pending_start());
    startup.fail();
    assert!(startup.prepare().is_none());
    assert!(!startup.deferred());

    // Production has one entry into native initialization, behind that gate,
    // and it consumes the one provider the process was started with.
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    assert_eq!(runtime.matches("origin_browser_entry::install(").count(), 1);
    assert_eq!(runtime.matches("permit.begin_native()").count(), 1);
    let entry = include_str!("../../../src/origin_browser_entry.rs");
    assert_eq!(entry.matches("CefRuntime::initialize_owned(").count(), 1);
    in_order(
        entry,
        &[
            "if !begin_native()",
            ".with(|slot| slot.borrow_mut().take())",
            "CefRuntime::initialize_owned(",
        ],
    );
}

#[test]
fn an_edit_that_ended_the_lease_is_the_recorded_cause_unless_the_revoker_named_one() {
    use sorng_protocols::origin_browser::BrowserSessionFailure as Reason;
    let lost_owner = || Reason::owner_loss(true, false, false);
    assert_eq!(lost_owner(), Some(Reason::DatabaseOwner));
    // The same stale lease reads as a lost database owner. When its recheck
    // latched an edit instead, that is the cause, serialized for the shell.
    assert_eq!(
        flow::revocation_reason(None, true, lost_owner),
        Some(Reason::SourceChanged)
    );
    assert_eq!(
        serde_json::to_value(flow::revocation_reason(None, true, lost_owner)).unwrap(),
        "source-changed"
    );
    assert_eq!(
        flow::revocation_reason(None, false, lost_owner),
        Some(Reason::DatabaseOwner)
    );
    // An edit is never invented: without the lease's own evidence the old
    // readings stand, including no cause at all for an ordinary close.
    assert_eq!(
        flow::revocation_reason(None, false, || Reason::owner_loss(false, false, false)),
        Some(Reason::OwnerWindow)
    );
    assert_eq!(
        flow::revocation_reason(None, false, || Reason::owner_loss(true, true, false)),
        None
    );
    // Evidence a revoker names is kept over both readings, without reading them.
    for named in [
        Reason::Watchdog,
        Reason::RuntimeUnavailable,
        Reason::CertificateBridge,
    ] {
        assert_eq!(
            flow::revocation_reason(Some(named), true, || panic!("a named cause wins")),
            Some(named)
        );
    }
}

fn in_order(source: &str, needles: &[&str]) {
    let mut rest = source;
    for needle in needles {
        let offset = rest
            .find(needle)
            .unwrap_or_else(|| panic!("missing or out of order: {needle}"));
        rest = &rest[offset + needle.len()..];
    }
}

fn squeezed(source: &str) -> String {
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn only_real_faults_and_the_start_watchdog_revoke_a_start_never_its_callers() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let ensure = runtime
        .split("async fn ensure_runtime(")
        .nth(1)
        .unwrap()
        .split("fn watch_native_start()")
        .next()
        .unwrap();
    // All a caller does on its way out, however it ends: cancel its own claim.
    assert_eq!(ensure.matches("startup_claim.cancel()").count(), 1);
    for forbidden in [
        "cancel_startup(",
        "cancel_abandoned",
        "timeout_owned_startup",
        "expire_pending_start",
        "admission.revoke(",
        "startup.fail(",
        "fail_runtime(",
        "StartupTimeout",
    ] {
        assert!(
            !ensure.contains(forbidden),
            "a caller must not use {forbidden}"
        );
    }
    // The two revocations left in this function run inside the entered native
    // callback and answer a real fault: a missing certificate bridge, and an
    // initialization error after native entry.
    let native = ensure
        .split(".run_on_main_thread(move || {")
        .nth(1)
        .unwrap()
        .split("receiver.await")
        .next()
        .unwrap();
    assert_eq!(ensure.matches("revoke_all()").count(), 2);
    assert_eq!(native.matches("revoke_all()").count(), 2);
    in_order(
        native,
        &[
            "Ok(()) => {",
            "certificate_hooks.load(Ordering::Acquire)",
            "revoke_all();",
            "RuntimeFailureCode::CertificateBridge",
            "Err(error) => {",
            "if shared().startup.started() {",
            "revoke_all();",
        ],
    );
    // A caller's own deadline answers with the failure the shell retries.
    let outcome = squeezed(ensure.split("receiver.await").nth(1).unwrap());
    assert!(outcome.contains(".unwrap_or_else(|_| Err(STARTUP_TIMED_OUT.to_owned()))"));
    assert!(outcome.contains("|| STARTUP_TIMED_OUT.to_owned(),"));

    // The watchdog is armed once, at native entry, by no caller's clock.
    in_order(
        native,
        &[
            "queued_startup_claim.claim_native()",
            "permit.begin_native()",
            "watch_native_start();",
            "prepared.commit()",
        ],
    );
    assert_eq!(runtime.matches("watch_native_start()").count(), 2);
    assert_eq!(runtime.matches("native_start_expired(").count(), 1);
    let watchdog = runtime
        .split("fn watch_native_start()")
        .nth(1)
        .unwrap()
        .split("struct Pending")
        .next()
        .unwrap();
    in_order(
        watchdog,
        &[
            "tauri::async_runtime::spawn(",
            "if flow::native_start_expired(",
            "&shared().admission",
            "flow::NATIVE_START_LIMIT",
            "record_current(RuntimeFailureCode::StartupTimeout)",
            "log::error!(",
            "revoke_all();",
        ],
    );
    assert_eq!(
        runtime
            .matches("record_current(RuntimeFailureCode::StartupTimeout)")
            .count(),
        1
    );
    let flow_source = include_str!("../../../src/origin_browser_runtime_flow.rs");
    assert!(!flow_source.contains("timeout_owned_startup"));
    assert!(!flow_source.contains("cancel_abandoned"));
}

#[test]
fn native_initialization_failure_after_entry_and_exit_stay_terminal() {
    let startup = flow::StartupGate::default();
    let admission = flow::RuntimeAdmission::default();
    let permit = startup.prepare().unwrap();
    assert!(permit.begin_native());
    drop(permit);
    // Production: `if shared().startup.started() { revoke_all(); }`.
    assert!(startup.started());
    startup.fail();
    admission.revoke();
    admission.observe_policy(true);
    assert!(admission.revoked());
    assert!(!admission.ready());
    assert!(startup.prepare().is_none());
    assert!(admission.suspend_for_watchdog().is_none());

    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let revoke_all = runtime
        .split("pub(crate) fn revoke_all() {")
        .nth(1)
        .unwrap()
        .split("fn revoke_attempts() {")
        .next()
        .unwrap();
    in_order(
        revoke_all,
        &[
            "shared().startup.fail();",
            "shared().admission.revoke();",
            "revoke_attempts();",
        ],
    );
    let exit = runtime
        .split("tauri::RunEvent::Exit => {")
        .nth(1)
        .unwrap()
        .split("fn lookup(")
        .next()
        .unwrap();
    assert!(exit.contains("revoke_all();"));
}

#[test]
fn a_relay_that_cannot_start_or_ends_during_preparation_is_the_retried_private_proxy_failure() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    // The two fixed texts the shell retries by itself, byte for byte.
    assert!(runtime.contains("const PROXY_FAILED: &str = \"Native browser private proxy could not start. Reopen the tab and check the native startup diagnostics; no direct-network fallback was used.\";"));
    assert!(runtime.contains("const STARTUP_TIMED_OUT: &str = \"Native browser initialization or policy readiness timed out. Check the native startup diagnostics and restart the app.\";"));
    let create = squeezed(
        runtime
            .split("async fn create_document(")
            .nth(1)
            .unwrap()
            .split("enum Operation {")
            .next()
            .unwrap(),
    );
    // A relay that could not start: its fixed cause is logged, and what the
    // attempt had prepared so far is released before the caller is answered.
    in_order(
        &create,
        &[
            "OriginBrowserSession::start(authorized.policy, authorized.route, ProxyLimits::default())",
            ".map_err(|error| {",
            "log::error!(\"Native browser stage=private-proxy error={error}\");",
            "login.revoke();",
            "view_failure(Failure::PrivateProxy, PROXY_FAILED)",
        ],
    );
    // A relay that ended while the tab was prepared: whichever step noticed,
    // the attempt is revoked first and its first recorded cause decides.
    let failed = create
        .split("Err(error) => { attempt.revoke();")
        .nth(1)
        .expect("one arm ends every preparation that did not finish");
    in_order(
        failed,
        &[
            "if attempt.failure.get() == Some(BrowserSessionFailure::PrivateProxy) {",
            "return Err(view_failure(Failure::PrivateProxy, PROXY_FAILED));",
            "Err(error)",
        ],
    );
}
