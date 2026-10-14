/// Fixed diagnostic codes only: never renderer text, URLs or credential values.
pub(super) fn for_status(
    status: sorng_browser_host::native_features::NativeFeatureStatus,
) -> Option<(&'static str, Option<&'static str>)> {
    use sorng_browser_host::native_features::{
        NativeFeatureStatus as F, NativeLoginDeliveryStatus as D,
    };
    Some(match status {
        F::LoginChallengeWaiting => ("waiting-page", None),
        F::LoginChallengeReloading => ("submitting", None),
        F::LoginChallengeTimedOut => ("stopped", Some("challenge-timeout")),
        F::LoginFormDetected => ("security-check", None),
        F::LoginAdapterCompleted => ("completed", None),
        F::LoginAdapterRejected => ("cancelled", Some("adapter-rejected")),
        F::LoginDelivery(D::NativeRejectedGrant) => ("held", Some("grant-rejected")),
        F::LoginDelivery(D::NativeRejectedCurrent) => {
            ("cancelled", Some("current-context-rejected"))
        }
        F::LoginDelivery(D::NativeRejectedNavigation) => {
            ("cancelled", Some("navigation-scope-rejected"))
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_activity_preserves_distinct_native_causes_without_page_text() {
        use sorng_browser_host::native_features::{
            NativeFeatureStatus as F, NativeLoginDeliveryStatus as D,
        };
        for (status, expected) in [
            (
                F::LoginDelivery(D::NativeRejectedCurrent),
                ("cancelled", Some("current-context-rejected")),
            ),
            (
                F::LoginDelivery(D::NativeRejectedNavigation),
                ("cancelled", Some("navigation-scope-rejected")),
            ),
            (
                F::LoginAdapterRejected,
                ("cancelled", Some("adapter-rejected")),
            ),
            (
                F::LoginChallengeTimedOut,
                ("stopped", Some("challenge-timeout")),
            ),
            (
                F::LoginDelivery(D::NativeRejectedGrant),
                ("held", Some("grant-rejected")),
            ),
            (F::LoginAdapterCompleted, ("completed", None)),
        ] {
            assert_eq!(for_status(status), Some(expected));
        }
    }
}
