use super::consent::ConsentRefusal;

/// Fixed diagnostic codes only: never renderer text, URLs or credential values.
/// `refusal` is the native consent cause behind a refused delivery, if any.
pub(super) fn for_status(
    status: sorng_browser_host::native_features::NativeFeatureStatus,
    refusal: Option<ConsentRefusal>,
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
        // Native refused this step without sending anything. Each page asks
        // for a step once, so leaving the status on "security check" would
        // hang there; say why instead, with a fixed cause when consent knows it.
        F::LoginDelivery(D::NativeNotDelivered) => match refusal {
            Some(ConsentRefusal::AddressMismatch) => ("held", Some("address-mismatch")),
            Some(ConsentRefusal::Expired) => ("held", Some("consent-expired")),
            None => ("held", Some("grant-rejected")),
        },
        F::LoginDelivery(D::NativeMessageFailed) => ("held", Some("grant-rejected")),
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
            (
                F::LoginDelivery(D::NativeNotDelivered),
                ("held", Some("grant-rejected")),
            ),
            (
                F::LoginDelivery(D::NativeMessageFailed),
                ("held", Some("grant-rejected")),
            ),
            (F::LoginAdapterCompleted, ("completed", None)),
        ] {
            assert_eq!(for_status(status, None), Some(expected));
        }
    }

    #[test]
    fn a_refused_delivery_names_its_fixed_consent_cause_and_nothing_else_does() {
        use sorng_browser_host::native_features::{
            NativeFeatureStatus as F, NativeLoginDeliveryStatus as D,
        };
        let not_delivered = F::LoginDelivery(D::NativeNotDelivered);
        assert_eq!(
            for_status(not_delivered, Some(ConsentRefusal::AddressMismatch)),
            Some(("held", Some("address-mismatch")))
        );
        assert_eq!(
            for_status(not_delivered, Some(ConsentRefusal::Expired)),
            Some(("held", Some("consent-expired")))
        );
        // A consent cause never relabels another status.
        for refusal in [ConsentRefusal::AddressMismatch, ConsentRefusal::Expired] {
            assert_eq!(
                for_status(F::LoginDelivery(D::NativeMessageFailed), Some(refusal)),
                Some(("held", Some("grant-rejected")))
            );
            assert_eq!(
                for_status(F::LoginFormDetected, Some(refusal)),
                Some(("security-check", None))
            );
        }
        // Renderer-side observations still leave the status unchanged.
        assert_eq!(for_status(F::LoginDelivery(D::RendererReplay), None), None);
        assert_eq!(for_status(F::LoginDelivery(D::NativeSent), None), None);
    }
}
