//! Execute the production classification of a failed engine initialization
//! (`src-tauri/src/origin_browser_entry.rs`) and the notice the user is shown
//! (`src-tauri/src/state_registry.rs`, `mod engine_failure`). The two error
//! types are doubles with the variants of the real ones, which the node test
//! compares against the browser-host sources. No CEF, app, window or dialog
//! exists here.

// The payloads only give the doubles the shape of the real variants.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BootstrapError {
    SandboxDisabled,
    InvalidMessageLoop,
    WindowlessRendering,
    BrowserArgumentsEnabled,
    BrowserIdentityOverride,
    RuntimeMismatch,
    ApiUnavailable,
    ProcessDispatchFailed,
    X11BackendRequired,
    X11DisplayRequired,
    InvalidArguments,
    PlatformPrecondition(&'static str),
    InvalidLifecycle,
    InitializeFailed(i32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeError {
    Bootstrap(BootstrapError),
    InvalidPackagePath,
    AlreadyStarted,
    WrongThread,
    SchedulerUnavailable,
    NetworkPolicyUnavailable,
}

/* PRODUCTION_ENGINE_LEFT */

mod engine_failure {
    /* PRODUCTION_NOTICE */
}

#[cfg(test)]
mod tests {
    use super::engine_failure::message;
    use super::{cef_exit_code, engine_left, BootstrapError as B, EngineLeft, RuntimeError as R};

    /// CEF_RESULT_CODE_NORMAL_EXIT_PROCESS_NOTIFIED.
    const PROCESS_NOTIFIED: i32 = 24;
    const PLATFORMS: [bool; 2] = [false, true];

    #[test]
    fn an_error_raised_before_cef_is_entered_keeps_the_application() {
        for macos in PLATFORMS {
            for error in [
                R::AlreadyStarted,
                R::Bootstrap(B::SandboxDisabled),
                R::Bootstrap(B::InvalidMessageLoop),
                R::Bootstrap(B::WindowlessRendering),
                R::Bootstrap(B::BrowserArgumentsEnabled),
                R::Bootstrap(B::BrowserIdentityOverride),
                R::Bootstrap(B::InvalidLifecycle),
            ] {
                assert_eq!(engine_left(&error, macos), EngineLeft::Absent, "{error:?}");
            }
        }
    }

    #[test]
    fn an_engine_that_was_shut_down_again_keeps_the_application() {
        for macos in PLATFORMS {
            for error in [R::SchedulerUnavailable, R::NetworkPolicyUnavailable] {
                assert_eq!(engine_left(&error, macos), EngineLeft::Absent, "{error:?}");
            }
        }
    }

    #[test]
    fn a_platform_precondition_is_before_cef_except_where_a_shutdown_can_be_refused() {
        let error = R::Bootstrap(B::PlatformPrecondition("fixture"));
        assert_eq!(engine_left(&error, false), EngineLeft::Absent);
        assert_eq!(
            engine_left(&error, true),
            EngineLeft::MustExit,
            "on macOS the same answer can mean CEF is still running"
        );
    }

    #[test]
    fn a_failed_initialize_ends_the_process_on_every_platform() {
        for macos in PLATFORMS {
            for code in [0, 1, PROCESS_NOTIFIED] {
                assert_eq!(
                    engine_left(&R::Bootstrap(B::InitializeFailed(code)), macos),
                    EngineLeft::MustExit
                );
            }
        }
    }

    #[test]
    fn an_error_that_initialization_does_not_raise_is_not_assumed_safe() {
        for macos in PLATFORMS {
            for error in [
                R::InvalidPackagePath,
                R::WrongThread,
                R::Bootstrap(B::RuntimeMismatch),
                R::Bootstrap(B::ApiUnavailable),
                R::Bootstrap(B::ProcessDispatchFailed),
                R::Bootstrap(B::X11BackendRequired),
                R::Bootstrap(B::X11DisplayRequired),
                R::Bootstrap(B::InvalidArguments),
            ] {
                assert_eq!(
                    engine_left(&error, macos),
                    EngineLeft::MustExit,
                    "{error:?}"
                );
            }
        }
    }

    #[test]
    fn only_a_failed_initialize_carries_a_cef_code() {
        assert_eq!(
            cef_exit_code(&R::Bootstrap(B::InitializeFailed(PROCESS_NOTIFIED))),
            Some(PROCESS_NOTIFIED)
        );
        assert_eq!(
            cef_exit_code(&R::Bootstrap(B::InitializeFailed(0))),
            Some(0)
        );
        for error in [
            R::AlreadyStarted,
            R::SchedulerUnavailable,
            R::Bootstrap(B::PlatformPrecondition("fixture")),
        ] {
            assert_eq!(cef_exit_code(&error), None, "{error:?}");
        }
    }

    #[test]
    fn the_notice_says_what_failed_that_the_app_closes_and_that_sessions_end() {
        assert_eq!(
            message(Some(PROCESS_NOTIFIED)),
            "The built-in browser could not start, and the application has to close because of \
             it. Open sessions stay connected until you close this message and end when you do. \
             Start sortOfRemoteNG again afterwards.\n\nNative browser stage: initializing, code 24"
        );
        let plain = message(None);
        assert!(plain.ends_with("\n\nNative browser stage: initializing"));
        for text in [plain, message(Some(-1))] {
            assert!(text.starts_with("The built-in browser could not start"));
            for part in ["\\", "/", "Users", "AppData", "com."] {
                assert!(!text.contains(part), "{part:?} in {text}");
            }
        }
    }
}
