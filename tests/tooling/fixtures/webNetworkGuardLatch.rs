//! Execute the production installation and latch policy of the WebView2
//! navigation guard (`src-tauri/src/web_network_guard.rs`, `mod policy`).
//! No WebView2, window or COM object exists here.

/* PRODUCTION_POLICY */

#[cfg(test)]
mod tests {
    use super::policy::{
        after_failure, latch_report, AfterFailure, InstallFailure, LatchCause, RETRY_DELAY,
    };
    use std::sync::atomic::AtomicBool;

    const NO_INTERFACE: i32 = 0x8000_4002_u32 as i32;
    const ACCESS_DENIED: i32 = 0x8007_0005_u32 as i32;

    #[test]
    fn installation_is_retried_exactly_once_and_then_latched_with_both_causes() {
        let first = InstallFailure::MainWindowMissing;
        assert_eq!(after_failure(None, first), AfterFailure::Retry);
        let retry = InstallFailure::Step {
            step: "resource-filter",
            code: NO_INTERFACE,
        };
        assert_eq!(
            after_failure(Some(first), retry),
            AfterFailure::Latch(LatchCause::Install { first, retry }),
            "a failed retry is final: there is no third attempt"
        );
        // Long enough to outlast a WebView2 that is still starting, short
        // enough to finish before the shell can open a website tab.
        assert!(!RETRY_DELAY.is_zero());
        assert!(RETRY_DELAY <= std::time::Duration::from_secs(2));
    }

    #[test]
    fn every_cause_is_fixed_words_and_an_hresult() {
        let cases = [
            (InstallFailure::MainWindowMissing, "main-window-missing"),
            (
                InstallFailure::DispatchRejected,
                "webview-dispatch-rejected",
            ),
            (
                InstallFailure::CoreUnavailable(ACCESS_DENIED),
                "core-webview-unavailable hresult=0x80070005",
            ),
            (
                InstallFailure::Step {
                    step: "resource-filter",
                    code: NO_INTERFACE,
                },
                "resource-filter hresult=0x80004002",
            ),
        ];
        for (failure, text) in cases {
            assert_eq!(failure.to_string(), text);
        }
        assert_eq!(
            LatchCause::Install {
                first: InstallFailure::DispatchRejected,
                retry: InstallFailure::CoreUnavailable(ACCESS_DENIED),
            }
            .to_string(),
            "stage=install cause=core-webview-unavailable hresult=0x80070005 \
             first_attempt=webview-dispatch-rejected"
        );
        assert_eq!(
            LatchCause::Handler {
                handler: "resource-request",
                code: ACCESS_DENIED,
            }
            .to_string(),
            "stage=handler cause=resource-request hresult=0x80070005"
        );
    }

    #[test]
    fn a_latch_leaves_its_cause_once_however_often_a_handler_fails() {
        let reported = AtomicBool::new(false);
        let cause = LatchCause::Handler {
            handler: "frame-navigation",
            code: ACCESS_DENIED,
        };
        assert_eq!(
            latch_report(&reported, cause).as_deref(),
            Some(
                "Website navigation guard latched failed until restart: stage=handler \
                 cause=frame-navigation hresult=0x80070005; website tabs that use the \
                 embedded proxy are refused"
            )
        );
        for _ in 0..3 {
            assert_eq!(latch_report(&reported, cause), None);
        }
    }
}
