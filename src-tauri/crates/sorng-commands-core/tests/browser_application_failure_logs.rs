// Real production diagnostics and fixed IPC decoder, without CEF or user data.
#[allow(dead_code)]
#[path = "../../../src/application_browser_failure.rs"]
mod client;
#[allow(dead_code)]
#[path = "../../../src/origin_browser_startup_diagnostics.rs"]
mod diagnostics;

struct Capture(std::sync::Mutex<Vec<(String, String)>>);
static LOGGER: Capture = Capture(std::sync::Mutex::new(Vec::new()));
impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        self.0
            .lock()
            .unwrap()
            .push((record.target().to_owned(), record.args().to_string()));
    }
    fn flush(&self) {}
}

#[test]
fn route_rejections_and_native_load_failures_reach_the_real_application_logger() {
    log::set_logger(&LOGGER).unwrap();
    log::set_max_level(log::LevelFilter::Info);
    diagnostics::record(
        diagnostics::Stage::ViewFailed,
        Some(diagnostics::Failure::PrivateProxy),
    );
    diagnostics::authority_failure(
        sorng_commands_core::origin_browser_authority::NativeAuthorityError::RouteUnsupported,
    );
    diagnostics::navigation(diagnostics::Navigation::LoadError {
        code: -130,
        main_frame: true,
    });
    diagnostics::navigation(diagnostics::Navigation::LoadError {
        code: -118,
        main_frame: true,
    });
    diagnostics::navigation(diagnostics::Navigation::SessionFailed {
        reason: sorng_protocols::origin_browser::BrowserSessionFailure::PrivateProxy,
    });
    diagnostics::navigation(diagnostics::Navigation::TlsFailed);
    diagnostics::navigation(diagnostics::Navigation::PrivateRelay {
        sample: 17,
        code: -130,
        snapshot: sorng_protocols::private_forward_proxy::PrivateProxyDiagnostics {
            state: sorng_protocols::private_forward_proxy::PrivateProxyState::Listening,
            accepted_connections: 0,
            authentication_challenges: 0,
            authenticated_requests: 0,
            destination_denials: 0,
            upstream_failures: 1,
            request_rejections: 0,
            capacity_refusals: 0,
        },
    });
    diagnostics::navigation(diagnostics::Navigation::LoadError {
        code: -3,
        main_frame: true,
    });
    diagnostics::navigation(diagnostics::Navigation::LoadError {
        code: -999,
        main_frame: false,
    });
    for _ in 0..200 {
        if LOGGER
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|(_, msg)| msg.contains("private-relay"))
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let rows = LOGGER.0.lock().unwrap();
    assert!(rows
        .iter()
        .any(|(target, msg)| target == "native_browser::startup"
            && msg.contains("timestampUnixMs=")
            && msg.contains("stage=ViewFailed failure=Some(PrivateProxy)")));
    assert!(rows.iter().any(
        |(target, msg)| target == "native_browser::proxy" && msg.contains("code=network-route")
    ));
    assert!(rows
        .iter()
        .any(|(target, msg)| target == "native_browser::proxy"
            && msg.contains("\"code\":-130")
            && msg.contains("timestampUnixMs=")));
    assert!(rows.iter().any(
        |(target, msg)| target == "native_browser::navigation" && msg.contains("\"code\":-118")
    ));
    assert!(rows
        .iter()
        .any(|(target, msg)| target == "native_browser::session" && msg.contains("private-proxy")));
    assert!(rows
        .iter()
        .any(|(target, msg)| target == "native_browser::tls" && msg.contains("tls-failed")));
    assert!(rows
        .iter()
        .any(|(target, msg)| target == "native_browser::proxy"
            && msg.contains("\"sample\":17")
            && msg.contains("\"upstreamFailures\":1")));
    assert!(!rows.iter().any(|(_, msg)| msg.contains("\"code\":-3")
        || msg.contains("-999")
        || msg.contains("https://")));
}
