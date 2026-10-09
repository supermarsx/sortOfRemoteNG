// Exercise the production journal without initializing CEF or the app UI.
#[allow(dead_code)]
#[path = "../../../src/origin_browser_startup_diagnostics.rs"]
mod diagnostics;

#[test]
fn relay_failure_hook_is_identity_fenced_nonblocking_and_diagnostic_only() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let hook = runtime
        .split("fn on_event(&self, event: BrowserEvent)")
        .nth(1)
        .unwrap()
        .split("let mut finished_load = false;")
        .next()
        .unwrap();
    in_order(
        hook,
        &[
            "event.identity != self.attempt.identity",
            "return;",
            "!self.attempt.cancelled.load(Ordering::Acquire)",
            "if let Some(failure) = event.state.load_failure",
            ".try_lock()",
            ".ok()",
            "session.proxy_diagnostics()",
            "relay_load_error(failure.code, relay)",
        ],
    );
    for forbidden in [
        ".lock()",
        ".revoke(",
        "into_inner",
        "clear_poison",
        "event.display",
    ] {
        assert!(
            !hook.contains(forbidden),
            "unexpected diagnostic operation: {forbidden}"
        );
    }
}

#[test]
fn renderer_lifecycle_fault_is_a_distinct_enum_only_diagnostic() {
    assert_eq!(
        serde_json::to_value(diagnostics::Stage::RuntimeFault).unwrap(),
        "runtime-fault"
    );
    assert_eq!(
        serde_json::to_value(diagnostics::Failure::RendererFault).unwrap(),
        "renderer-fault"
    );
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    let fault = runtime
        .split("Some(BrowserFault::Renderer)")
        .nth(1)
        .unwrap()
        .split("if matches!(phase, OriginBrowserPhase::Attached)")
        .next()
        .unwrap();
    assert!(
        fault.contains("diagnostics::record(Stage::RuntimeFault, Some(Failure::RendererFault))")
    );
    assert!(!fault.contains("event.display"));
}

fn in_order(source: &str, needles: &[&str]) {
    let mut rest = source;
    for needle in needles {
        let offset = rest
            .find(needle)
            .unwrap_or_else(|| panic!("missing timing boundary: {needle}"));
        rest = &rest[offset + needle.len()..];
    }
}

#[test]
fn native_command_and_engine_timings_bracket_existing_work_without_new_checks() {
    let commands = include_str!("../../../src/origin_browser_commands.rs");
    let create = commands
        .split("async fn origin_browser_create(")
        .nth(1)
        .unwrap();
    in_order(
        create,
        &[
            "Trace::startup(false)",
            "request.validate()",
            "TimingStage::CommandValidated",
            "origin_browser_runtime::create(window, &state, request, timing, document)",
        ],
    );
    let entry = include_str!("../../../src/origin_browser_entry.rs");
    in_order(
        entry,
        &[
            "if !begin_native()",
            "TimingStage::NativeInitializeEntered",
            "CefRuntime::initialize_owned(",
            "TimingStage::NativeInitializeReturned",
            "origin_browser_runtime::install(runtime)",
            "TimingStage::RuntimeInstalled",
        ],
    );
}

#[test]
fn runtime_journals_admission_ui_handoffs_and_navigation_separately() {
    let runtime = include_str!("../../../src/origin_browser_runtime.rs");
    assert!(!runtime.contains("database_protection::native_browser_timing"));
    in_order(
        runtime,
        &[
            "async fn ensure_runtime(",
            "TimingStage::RuntimeRequested",
            "TimingStage::PreflightEntered",
            "TimingStage::DataPrepared",
            "TimingStage::EngineUiQueued",
            "run_on_main_thread(move ||",
            "TimingStage::EngineUiEntered",
            "origin_browser_entry::install(",
            "TimingStage::RuntimeReady",
        ],
    );
    in_order(
        runtime,
        &[
            "pub(crate) async fn create(",
            "RevokeOnDrop::new(|| timing.finish(0))",
            "authorize_create_with_certificate_hooks",
            "TimingStage::Authorized",
            "ensure_runtime(",
            "TimingStage::ViewUiQueued",
            "TimingStage::UiEntered",
            "TimingStage::ContextCreated",
            "TimingStage::FinalOwnerChecked",
            "TimingStage::CommandCompleted",
            "interrupted.disarm()",
        ],
    );
    in_order(
        runtime,
        &[
            "async fn operate(",
            "TimingStage::InitialNavigationQueued",
            "run_on_main_thread(move ||",
            "TimingStage::InitialNavigationEntered",
            "view.host.navigate(id, &url)",
            "TimingStage::NavigationSubmitted",
        ],
    );
    in_order(
        runtime,
        &[
            "TimingStage::FirstDocumentComplete",
            "self.attempt.timing.finish(2)",
        ],
    );
}
