//! Pure process diagnostic retention + real IPC serialization. No CEF, app,
//! profile, clipboard, credentials, network or production diagnostics are used.
#[path = "../../../src/origin_browser_runtime_failure.rs"]
mod runtime_failure;

use runtime_failure::RuntimeFailureStore;
use serde_json::{json, Value};
use sorng_browser_host::ipc::{
    OriginBrowserCapability, OriginBrowserRuntimeFailure as RuntimeFailure,
    OriginBrowserRuntimeFailureCode as Code, OriginBrowserRuntimeFailureStage as Stage,
    OriginBrowserStatusRequest, OriginBrowserStatusResult, OriginBrowserUnavailableReason,
};

fn status_request() -> OriginBrowserStatusRequest {
    serde_json::from_value(json!({
        "owner": {"ownerDatabaseId":"fixture-db", "connectionId":"fixture-connection", "sessionId":"fixture-tab"}
    })).unwrap()
}

fn status(capability: OriginBrowserCapability, failure: Option<RuntimeFailure>) -> Value {
    serde_json::to_value(
        OriginBrowserStatusResult::from_native(&status_request(), capability, None)
            .unwrap()
            .with_runtime_failure(failure),
    )
    .unwrap()
}

#[test]
fn exact_fixed_wire_codes_and_stages_never_include_other_fields() {
    for (code, expected_code) in [
        (Code::DataDirectory, "data-directory"),
        (Code::RuntimePackage, "runtime-package"),
        (Code::StartupProvider, "startup-provider"),
        (Code::CertificateBridge, "certificate-bridge"),
        (Code::RuntimePolicy, "runtime-policy"),
        (Code::StartupTimeout, "startup-timeout"),
        (Code::UiDispatch, "ui-dispatch"),
        (Code::RuntimeInitialization, "runtime-initialization"),
    ] {
        for (stage, expected_stage) in [
            (Stage::Preparing, "preparing"),
            (Stage::Initializing, "initializing"),
            (Stage::PolicyReadback, "policy-readback"),
        ] {
            assert_eq!(
                serde_json::to_value(RuntimeFailure { code, stage }).unwrap(),
                json!({"code":expected_code,"stage":expected_stage})
            );
        }
    }
}

#[test]
fn optional_diagnostic_is_omitted_not_null() {
    assert_eq!(
        serde_json::to_value(OriginBrowserStatusResult::default()).unwrap(),
        json!({
            "capability":{"availability":"unavailable","reason":"host-unavailable"},
            "snapshot":null,
        })
    );
    assert_eq!(
        status(OriginBrowserCapability::Deferred, None),
        json!({
            "capability":{"availability":"deferred"}, "snapshot":null,
        })
    );
}

#[test]
fn concrete_failure_preserves_engine_unavailable_reason_and_never_adds_a_snapshot() {
    let failure = Some(RuntimeFailure {
        code: Code::CertificateBridge,
        stage: Stage::PolicyReadback,
    });
    for (reason, expected) in [
        (
            OriginBrowserUnavailableReason::RuntimeMissing,
            "runtime-missing",
        ),
        (
            OriginBrowserUnavailableReason::PlatformUnsupported,
            "platform-unsupported",
        ),
        (
            OriginBrowserUnavailableReason::ContainmentUnverified,
            "containment-unverified",
        ),
        (
            OriginBrowserUnavailableReason::PolicyUnavailable,
            "policy-unavailable",
        ),
        (
            OriginBrowserUnavailableReason::HostUnavailable,
            "host-unavailable",
        ),
    ] {
        assert_eq!(
            status(OriginBrowserCapability::Unavailable { reason }, failure),
            json!({
                "capability":{"availability":"unavailable","reason":expected},
                "snapshot":null,
                "runtimeFailure":{"code":"certificate-bridge","stage":"policy-readback"},
            })
        );
    }
}

#[test]
fn retryable_preflight_failure_keeps_deferred_capability() {
    let store = RuntimeFailureStore::default();
    store.begin().record(Code::RuntimePackage);
    assert_eq!(
        status(OriginBrowserCapability::Deferred, store.snapshot()),
        json!({
            "capability":{"availability":"deferred"}, "snapshot":null,
            "runtimeFailure":{"code":"runtime-package","stage":"preparing"},
        })
    );
}

#[test]
fn ready_status_cannot_serialize_stale_diagnostics() {
    assert_eq!(
        status(
            OriginBrowserCapability::Available,
            Some(RuntimeFailure {
                code: Code::StartupTimeout,
                stage: Stage::Initializing,
            })
        ),
        json!({"capability":{"availability":"available"}, "snapshot":null})
    );
}

#[test]
fn owner_unavailable_cannot_inherit_unrelated_engine_diagnostics() {
    assert_eq!(
        status(
            OriginBrowserCapability::Unavailable {
                reason: OriginBrowserUnavailableReason::OwnerUnavailable,
            },
            Some(RuntimeFailure {
                code: Code::RuntimePackage,
                stage: Stage::Preparing
            })
        ),
        json!({
            "capability":{"availability":"unavailable","reason":"owner-unavailable"},
            "snapshot":null,
        })
    );
}

#[test]
fn first_concrete_fault_survives_generic_policy_and_cleanup_failures() {
    let store = RuntimeFailureStore::default();
    let scope = store.begin();
    scope.stage(Stage::PolicyReadback);
    scope.record(Code::CertificateBridge);
    store.record_current(Code::RuntimePolicy);
    store.record_current(Code::UiDispatch);
    scope.record(Code::RuntimeInitialization);
    assert_eq!(
        store.snapshot(),
        Some(RuntimeFailure {
            code: Code::CertificateBridge,
            stage: Stage::PolicyReadback,
        })
    );
}

#[test]
fn fresh_retry_clears_fault_and_rejects_late_error_and_stage_from_old_scope() {
    let store = RuntimeFailureStore::default();
    let old = store.begin();
    old.record(Code::DataDirectory);
    let current = store.begin();
    assert_eq!(store.snapshot(), None);
    old.stage(Stage::Initializing);
    old.record(Code::RuntimePackage);
    assert_eq!(store.snapshot(), None);
    current.record(Code::StartupProvider);
    assert_eq!(
        store.snapshot(),
        Some(RuntimeFailure {
            code: Code::StartupProvider,
            stage: Stage::Preparing,
        })
    );
}

#[test]
fn readiness_clears_fault_and_invalidates_pending_startup_producers() {
    let store = RuntimeFailureStore::default();
    let old = store.begin();
    old.record(Code::RuntimePackage);
    store.ready_if(|| true);
    assert_eq!(store.snapshot(), None);
    old.stage(Stage::Initializing);
    old.record(Code::RuntimeInitialization);
    assert_eq!(store.snapshot(), None);
    // A genuine new global runtime fault still reports after readiness.
    store.record_current(Code::RuntimePolicy);
    assert_eq!(
        store.snapshot(),
        Some(RuntimeFailure {
            code: Code::RuntimePolicy,
            stage: Stage::PolicyReadback,
        })
    );
}

#[test]
fn revoked_readiness_does_not_clear_the_fault() {
    let store = RuntimeFailureStore::default();
    store.begin().record(Code::StartupTimeout);
    store.ready_if(|| false);
    assert_eq!(
        store.snapshot(),
        Some(RuntimeFailure {
            code: Code::StartupTimeout,
            stage: Stage::Preparing,
        })
    );
}

#[test]
fn timeout_retains_the_stage_actually_reached() {
    for stage in [Stage::Preparing, Stage::Initializing, Stage::PolicyReadback] {
        let store = RuntimeFailureStore::default();
        store.begin().stage(stage);
        store.record_current(Code::StartupTimeout);
        assert_eq!(
            store.snapshot(),
            Some(RuntimeFailure {
                code: Code::StartupTimeout,
                stage
            })
        );
    }
}

#[test]
fn independent_engine_stores_do_not_leak_state() {
    let first = RuntimeFailureStore::default();
    let second = RuntimeFailureStore::default();
    first.begin().record(Code::DataDirectory);
    second.begin().stage(Stage::Initializing);
    assert_eq!(second.snapshot(), None);
    second.record_current(Code::RuntimeInitialization);
    first.ready_if(|| true);
    assert_eq!(first.snapshot(), None);
    assert_eq!(
        second.snapshot(),
        Some(RuntimeFailure {
            code: Code::RuntimeInitialization,
            stage: Stage::Initializing,
        })
    );
}

#[test]
fn another_threads_late_startup_result_cannot_restore_failure_after_retry() {
    let store = RuntimeFailureStore::default();
    let old = store.begin();
    let (resume, wait) = std::sync::mpsc::channel();
    std::thread::scope(|threads| {
        let worker = threads.spawn(move || {
            wait.recv().unwrap();
            old.stage(Stage::Initializing);
            old.record(Code::RuntimeInitialization);
        });
        let current = store.begin();
        resume.send(()).unwrap();
        worker.join().unwrap();
        assert_eq!(store.snapshot(), None);
        current.record(Code::RuntimePackage);
    });
    assert_eq!(
        store.snapshot(),
        Some(RuntimeFailure {
            code: Code::RuntimePackage,
            stage: Stage::Preparing,
        })
    );
}

#[test]
fn status_input_cannot_submit_a_runtime_failure_or_claim_capability() {
    for field in ["runtimeFailure", "capability"] {
        let mut request = serde_json::to_value(status_request()).unwrap();
        request[field] = json!({"code":"runtime-package","stage":"preparing"});
        assert!(serde_json::from_value::<OriginBrowserStatusRequest>(request).is_err());
    }
}

#[test]
fn production_call_sites_keep_owner_view_and_settings_errors_out_of_engine_evidence() {
    // Source wiring checks supplement the behavioral store/serialization tests;
    // they do not claim CEF execution or a full app integration build.
    let source = include_str!("../../../src/origin_browser_runtime.rs");
    for (start, end) in [
        ("fn view_failure(", "struct Attempt"),
        ("impl Attempt {", "#[derive(Default)]"),
        (
            "pub(crate) fn revoke_all()",
            "pub(crate) fn runtime_failed(",
        ),
        ("pub(crate) fn revoke_window(", "pub(crate) fn on_event("),
        (
            "let settings = crate::app_settings_commands::read_app_settings_inner(",
            "let app = window.app_handle()",
        ),
    ] {
        let region = source
            .split(start)
            .nth(1)
            .unwrap()
            .split(end)
            .next()
            .unwrap();
        assert!(
            !region.contains("runtime_failure"),
            "unexpected global diagnostic in {start}"
        );
    }
    let cancel = source
        .split("fn cancel_startup(")
        .nth(1)
        .unwrap()
        .split("struct Pending")
        .next()
        .unwrap();
    assert!(cancel.contains("if matches!(failure, Failure::Timeout)"));
    let entry = include_str!("../../../src/origin_browser_entry.rs");
    let cancellation = entry
        .split("if !begin_native()")
        .nth(1)
        .unwrap()
        .split("let pending =")
        .next()
        .unwrap();
    assert!(!cancellation.contains("runtime_failure.record"));
}

#[test]
fn production_status_is_read_only_and_attaches_only_a_retained_snapshot() {
    let source = include_str!("../../../src/origin_browser_runtime.rs");
    let status = source
        .split("pub(crate) fn status(")
        .nth(1)
        .unwrap()
        .split("struct Sink")
        .next()
        .unwrap();
    assert_eq!(
        status
            .matches("with_runtime_failure(shared().runtime_failure.snapshot())")
            .count(),
        2
    );
    for forbidden in [
        "ensure_runtime",
        "::install(",
        "runtime_failure.begin(",
        "runtime_failure.record",
        "runtime_failure.ready_if",
    ] {
        assert!(
            !status.contains(forbidden),
            "status must not perform {forbidden}"
        );
    }
}
