//! Execute the production startup-step helpers and held-notice queue of
//! `src-tauri/src/state_registry.rs`. The log is a double; no app, window,
//! profile or service is started.

// The double stays whole when a production slice stops using part of it, so
// that the tests, not an unused double, say what went missing.
#[allow(dead_code, unused_imports, unused_macros)]
mod log {
    use std::cell::{Cell, RefCell};

    thread_local! {
        static LINES: RefCell<Vec<(&'static str, String)>> = const { RefCell::new(Vec::new()) };
        static FLUSHES: Cell<usize> = const { Cell::new(0) };
    }

    pub fn record(level: &'static str, line: String) {
        LINES.with(|lines| lines.borrow_mut().push((level, line)));
    }

    pub fn take() -> Vec<(&'static str, String)> {
        LINES.with(|lines| std::mem::take(&mut *lines.borrow_mut()))
    }

    pub fn flushes() -> usize {
        FLUSHES.with(Cell::take)
    }

    pub struct Logger;

    impl Logger {
        pub fn flush(&self) {
            FLUSHES.with(|count| count.set(count.get() + 1));
        }
    }

    pub fn logger() -> Logger {
        Logger
    }

    macro_rules! record_error {
        ($($arg:tt)*) => { $crate::log::record("error", format!($($arg)*)) };
    }
    pub(crate) use record_error as error;
}

/* PRODUCTION_NOTICES */

/* PRODUCTION_STEPS */

mod native_browser_routes {
    /* PRODUCTION_ROUTE_FAILURE */
}

mod scheduler_startup {
    /* PRODUCTION_SCHEDULER_NOTICE */
}

#[cfg(test)]
mod tests {
    use super::native_browser_routes::Failure;
    use super::scheduler_startup::notice as scheduler_notice;
    use super::*;
    use std::io::ErrorKind;

    #[test]
    fn the_scheduler_notice_says_what_is_not_running_and_why() {
        let unreadable = scheduler_notice(Some(ErrorKind::InvalidData));
        assert!(unreadable.starts_with("Scheduled tasks are not running: "));
        assert!(unreadable.contains("the saved schedule could not be read"));
        assert!(unreadable.contains("left unchanged"));

        for cause in [None, Some(ErrorKind::AlreadyExists), Some(ErrorKind::Other)] {
            let not_started = scheduler_notice(cause);
            assert!(not_started.starts_with("Scheduled tasks are not running: "));
            assert!(not_started.contains("the scheduler could not be started"));
            assert!(!not_started.contains("could not be read"), "{cause:?}");
        }
        // The file is named so it can be found; its folder is not.
        for text in [unreadable, scheduler_notice(None)] {
            assert!(!text.contains(['\\', '/']), "no path in {text}");
        }
    }

    fn notice(component: &'static str) -> StartupNotice {
        StartupNotice {
            component,
            message: format!("{component} did not start"),
        }
    }

    #[test]
    fn a_recoverable_step_that_fails_is_logged_once_and_yields_nothing() {
        let absent = recoverable(
            "native-browser-routes",
            "tabs that use a saved chain are refused",
            Err::<u8, _>(Failure::ProfileRootUnavailable(Some(
                std::io::ErrorKind::PermissionDenied,
            ))),
        );
        assert_eq!(absent, None, "the step must not carry an error upwards");
        assert_eq!(
            log::take(),
            [(
                "error",
                "Startup stage=native-browser-routes unavailable \
                 cause=profile-root-unavailable kind=PermissionDenied; \
                 tabs that use a saved chain are refused"
                    .to_owned()
            )]
        );
        assert_eq!(log::flushes(), 0);
    }

    #[test]
    fn a_recoverable_step_that_succeeds_is_silent() {
        assert_eq!(recoverable("splash", "unused", Ok::<_, String>(7)), Some(7));
        assert!(log::take().is_empty());
    }

    /// What a real cause can look like: it names the profile folder.
    const CAUSE: &str = r"unknown path C:\Users\someone\AppData\Roaming\com.example.app";

    #[test]
    fn a_fatal_step_stays_fatal_and_leaves_its_flushed_cause_in_the_log() {
        let result = fatal(FatalStep::AppData, Err::<(), _>(CAUSE));
        assert_eq!(result, Err(FatalStep::AppData), "a fatal step stays fatal");
        assert_eq!(
            log::take(),
            [(
                "error",
                format!(
                    "Startup stage=app-data failed cause={CAUSE}; the application cannot start"
                )
            )]
        );
        assert_eq!(log::flushes(), 1, "the process ends right after this line");

        // The step is all that travels on: the cause stays in the log.
        assert_eq!(
            fatal(FatalStep::CredentialLifecycle, Err::<(), _>(CAUSE)),
            Err(FatalStep::CredentialLifecycle)
        );
        assert_eq!(log::take().len(), 1);
        assert_eq!(log::flushes(), 1);

        assert_eq!(fatal(FatalStep::AppData, Ok::<_, String>(3)), Ok(3));
        assert!(log::take().is_empty());
        assert_eq!(log::flushes(), 0);
    }

    #[test]
    fn the_user_is_told_fixed_words_with_the_stage_and_what_to_do_next() {
        assert_eq!(
            FatalStep::AppData.message(),
            "The application data folder could not be opened. Check that the folder is \
             reachable and writable, then start the application again.\n\n\
             Startup stage: app-data"
        );
        assert_eq!(
            FatalStep::CredentialLifecycle.message(),
            "The credential tracking file could not be read or created. An existing file was \
             left unchanged. Check that credentials/tracker-state-v1.json in the application \
             data folder is readable and writable, or restore it from a backup, then start the \
             application again.\n\nStartup stage: credential-lifecycle"
        );
        // Nothing of a cause, and nothing that locates the profile.
        for step in [FatalStep::AppData, FatalStep::CredentialLifecycle] {
            let text = step.message();
            for part in ["\\", "Users", "AppData", "Roaming", "com.", "unknown path"] {
                assert!(!text.contains(part), "{part:?} in {text}");
            }
        }
    }

    #[test]
    fn a_harness_run_ends_without_a_dialog_and_a_person_gets_one() {
        assert_eq!(failed_start_ending(true), FailedStartEnding::ExitNow);
        assert_eq!(failed_start_ending(false), FailedStartEnding::Dialog);
    }

    #[test]
    fn route_service_causes_are_fixed_words_and_an_error_kind() {
        let cases = [
            (Failure::EncryptionStateMissing, "encryption-state-missing"),
            (Failure::ChainingStateMissing, "chaining-state-missing"),
            (
                Failure::ProfileRootUnavailable(Some(std::io::ErrorKind::NotFound)),
                "profile-root-unavailable kind=NotFound",
            ),
            (
                Failure::ProfileRootUnavailable(None),
                "profile-root-unavailable",
            ),
        ];
        for (failure, text) in cases {
            assert_eq!(failure.to_string(), text);
            assert!(!text.contains(['\\', '/', ':']), "no path in {text}");
        }
    }

    #[test]
    fn notices_wait_for_the_shell_and_are_then_sent_exactly_once() {
        let mut notices = StartupNotices::new();
        assert_eq!(notices.report(notice("routes")), None, "nobody listens yet");
        assert_eq!(notices.report(notice("rest")), None);
        let due = notices.shell_ready();
        assert_eq!(due, [notice("routes"), notice("rest")]);
        assert_eq!(due[0].component, "routes");
        assert_eq!(due[0].message, "routes did not start");
        assert!(notices.shell_ready().is_empty(), "never sent twice");
        assert_eq!(
            notices.report(notice("late")),
            Some(notice("late")),
            "once the shell listens a failure is due at once"
        );
        assert!(notices.shell_ready().is_empty(), "and is not held as well");
    }

    #[test]
    fn held_notices_are_bounded() {
        let mut notices = StartupNotices::new();
        for _ in 0..HELD_NOTICE_LIMIT + 5 {
            assert_eq!(notices.report(notice("loop")), None);
        }
        assert_eq!(notices.shell_ready().len(), HELD_NOTICE_LIMIT);
    }
}
