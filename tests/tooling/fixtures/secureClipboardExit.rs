//! Execute the production report of the secure clipboard's exit clear
//! (`src-tauri/src/state_registry.rs`, `mod exit_clear`) and the exit hook the
//! updater gives its plugin (`sorng-updater/src/service.rs`, `before_exit`).
//! The log is a double. No clipboard, service, updater, app or window exists
//! here.

use std::sync::Arc;

// The double stays whole when the production slice stops using part of it, so
// that the tests, not an unused double, say what went missing.
#[allow(dead_code, unused_imports, unused_macros)]
mod log {
    use std::cell::RefCell;

    thread_local! {
        static LINES: RefCell<Vec<(&'static str, String)>> = const { RefCell::new(Vec::new()) };
    }

    pub fn record(level: &'static str, line: String) {
        LINES.with(|lines| lines.borrow_mut().push((level, line)));
    }

    pub fn take() -> Vec<(&'static str, String)> {
        LINES.with(|lines| std::mem::take(&mut *lines.borrow_mut()))
    }

    macro_rules! record_info {
        ($($arg:tt)*) => { $crate::log::record("info", format!($($arg)*)) };
    }
    macro_rules! record_warn {
        ($($arg:tt)*) => { $crate::log::record("warn", format!($($arg)*)) };
    }
    macro_rules! record_error {
        ($($arg:tt)*) => { $crate::log::record("error", format!($($arg)*)) };
    }
    pub(crate) use record_error as error;
    pub(crate) use record_info as info;
    pub(crate) use record_warn as warn;
}

mod exit_clear {
    use super::log;

    /* PRODUCTION_EXIT_CLEAR */
}

/* PRODUCTION_BEFORE_EXIT */

#[cfg(test)]
mod tests {
    use super::exit_clear::report;
    use super::{before_exit, log, BeforeExit};
    use std::sync::{Arc, Mutex};

    /// Stands in for the service's fixed refusal code.
    struct Code(&'static str);

    impl std::fmt::Display for Code {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(self.0)
        }
    }

    #[test]
    fn a_release_is_recorded() {
        report(Ok::<_, Code>(true));
        assert_eq!(
            log::take(),
            [(
                "info",
                "Secure clipboard: the owned entry was released on exit".to_owned()
            )]
        );
    }

    #[test]
    fn nothing_owned_is_silent() {
        report(Ok::<_, Code>(false));
        assert!(log::take().is_empty());
    }

    #[test]
    fn a_clear_that_did_not_happen_says_so_with_the_services_code() {
        for code in ["busy", "unavailable"] {
            report(Err(Code(code)));
            assert_eq!(
                log::take(),
                [(
                    "warn",
                    format!(
                        "Secure clipboard: clear on exit failed cause={code}; \
                         an owned secret may remain on the OS clipboard"
                    )
                )]
            );
        }
    }

    /// The hook's two halves record the order they ran in.
    fn recorder() -> (
        Arc<Mutex<Vec<&'static str>>>,
        impl Fn(&'static str) -> BeforeExit,
    ) {
        let order = Arc::new(Mutex::new(Vec::new()));
        let shared = order.clone();
        (order, move |step| {
            let order = shared.clone();
            let record: BeforeExit = Arc::new(move || order.lock().unwrap().push(step));
            record
        })
    }

    #[test]
    fn the_updaters_exit_hook_runs_the_apps_work_and_then_the_plugins_cleanup() {
        let (order, step) = recorder();
        let cleanup = step("cleanup");
        before_exit(Some(step("clear")), move || cleanup())();
        assert_eq!(*order.lock().unwrap(), ["clear", "cleanup"]);
        assert!(log::take().is_empty());
    }

    #[test]
    fn without_app_work_the_hook_is_the_plugins_cleanup_alone() {
        let (order, step) = recorder();
        let cleanup = step("cleanup");
        before_exit(None, move || cleanup())();
        assert_eq!(*order.lock().unwrap(), ["cleanup"]);
    }

    #[test]
    fn app_work_that_panics_cannot_stop_the_update() {
        let (order, step) = recorder();
        let cleanup = step("cleanup");
        let work: BeforeExit = Arc::new(|| panic!("fixture: the app's work failed"));
        // The panic is the point; keep its message out of the test output.
        let reporter = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        before_exit(Some(work), move || cleanup())();
        std::panic::set_hook(reporter);
        assert_eq!(*order.lock().unwrap(), ["cleanup"], "the handoff goes on");
        assert_eq!(
            log::take(),
            [(
                "error",
                "Updater: the app's work before exit panicked; the update continues".to_owned()
            )]
        );
    }
}
