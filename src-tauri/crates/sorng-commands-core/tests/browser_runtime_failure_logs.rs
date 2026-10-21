//! The real process-wide failure store, application logger and public status DTO.
//! No CEF runtime, user data or network is involved.
#[allow(dead_code)]
#[path = "../../../src/origin_browser_runtime_failure.rs"]
mod failure;

use failure::RuntimeFailureStore;
use sorng_browser_host::ipc::{
    OriginBrowserRuntimeFailureCode as Code, OriginBrowserRuntimeFailureStage as Stage,
    OriginBrowserStatusResult, OriginBrowserUnavailableReason,
};
use std::sync::{Arc, Mutex};

struct Capture {
    rows: Mutex<Vec<String>>,
    inspect: Mutex<Option<Arc<RuntimeFailureStore>>>,
}
static LOGGER: Capture = Capture {
    rows: Mutex::new(Vec::new()),
    inspect: Mutex::new(None),
};
impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        if record.target() != "native_browser::startup::runtime" {
            return;
        }
        let inspect = LOGGER.inspect.lock().unwrap().clone();
        if let Some(store) = inspect {
            // A logger that reads native status must not deadlock the producer.
            assert!(store.snapshot().is_some());
        }
        self.rows.lock().unwrap().push(record.args().to_string());
    }
    fn flush(&self) {}
}

#[test]
fn runtime_fault_is_logged_once_and_status_keeps_the_exact_native_cause() {
    log::set_logger(&LOGGER).unwrap();
    log::set_max_level(log::LevelFilter::Error);
    let (done, result) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let store = Arc::new(RuntimeFailureStore::default());
        *LOGGER.inspect.lock().unwrap() = Some(store.clone());
        let startup = store.begin();
        startup.stage(Stage::PolicyReadback);
        store.record_current(Code::UiDispatch);
        // Later cleanup and repeated new-tab attempts cannot replace or spam it.
        store.record_current(Code::RuntimePolicy);
        startup.record(Code::CertificateBridge);
        assert_eq!(LOGGER.rows.lock().unwrap().len(), 1);
        let status = OriginBrowserStatusResult::unavailable(
            OriginBrowserUnavailableReason::PolicyUnavailable,
        )
        .with_runtime_failure(store.snapshot());
        let status = serde_json::to_value(status).unwrap();
        assert_eq!(status["runtimeFailure"]["code"], "ui-dispatch");
        assert_eq!(status["runtimeFailure"]["stage"], "policy-readback");
        assert!(!status.to_string().contains("private-proxy"));

        // Successful recovery invalidates old producers. It does not invent a
        // fault for a recovered slow callback; a later genuine fault logs once.
        store.ready_if(|| true);
        startup.record(Code::RuntimeInitialization);
        assert!(store.snapshot().is_none());
        assert_eq!(LOGGER.rows.lock().unwrap().len(), 1);
        store.record_current(Code::CertificateBridge);
        assert_eq!(LOGGER.rows.lock().unwrap().len(), 2);

        let next = store.begin();
        next.stage(Stage::Initializing);
        startup.record(Code::RuntimePolicy);
        assert!(store.snapshot().is_none());
        next.record(Code::RuntimeInitialization);
        next.record(Code::RuntimePackage);
        assert_eq!(LOGGER.rows.lock().unwrap().len(), 3);

        // A separate store has its own first-cause state and cannot inherit it.
        let other = Arc::new(RuntimeFailureStore::default());
        assert!(other.snapshot().is_none());
        *LOGGER.inspect.lock().unwrap() = Some(other.clone());
        other.record_current(Code::DataDirectory);
        assert_eq!(other.snapshot().unwrap().code, Code::DataDirectory);
        assert_eq!(store.snapshot().unwrap().code, Code::RuntimeInitialization);

        let rows = LOGGER.rows.lock().unwrap();
        assert_eq!(rows.len(), 4);
        for (row, expected) in rows.iter().zip([
            "code=ui-dispatch stage=policy-readback",
            "code=certificate-bridge stage=policy-readback",
            "code=runtime-initialization stage=initializing",
            "code=data-directory stage=preparing",
        ]) {
            assert!(row.starts_with("Native browser runtime failure: timestampUnixMs="));
            let millis = row
                .split("timestampUnixMs=")
                .nth(1)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .parse::<u128>()
                .unwrap();
            assert!(millis > 0);
            assert!(row.ends_with(expected));
            for forbidden in [
                "https:",
                "secret",
                "password",
                "ownerDatabaseId",
                "connectionId",
            ] {
                assert!(!row.contains(forbidden));
            }
        }
        done.send(()).unwrap();
    });
    // Also fails deterministically if logging accidentally holds the store lock.
    result
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    worker.join().unwrap();
}
