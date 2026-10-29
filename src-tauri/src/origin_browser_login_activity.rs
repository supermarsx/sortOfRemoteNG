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
        F::LoginAdapterStopped(cause) => stopped(cause),
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

/// A page adapter's fixed stop cause. A verification the user must answer
/// holds the attempt for them; a refusal shown after the submit stops it;
/// every other cause cancels it. The code is the cause's own wire name.
fn stopped(
    cause: sorng_browser_host::native_features::NativeLoginRejection,
) -> (&'static str, Option<&'static str>) {
    use sorng_browser_host::native_features::NativeLoginRejection as R;
    let stage = match cause {
        R::VerificationRequired => "held",
        R::CredentialsRejected => "stopped",
        _ => "cancelled",
    };
    (stage, Some(cause.wire()))
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
    fn every_adapter_stop_cause_reaches_the_activity_as_its_own_fixed_code() {
        use sorng_browser_host::native_features::{
            NativeFeatureStatus as F, NativeLoginRejection as R,
        };
        let mut codes = std::collections::HashSet::new();
        for cause in R::ALL {
            let (stage, code) = for_status(F::LoginAdapterStopped(cause), None).unwrap();
            let code = code.unwrap();
            assert_eq!(code, cause.wire());
            assert!(codes.insert(code));
            // Never the causeless code, and never a native consent cause.
            assert!(!matches!(
                code,
                "adapter-rejected" | "grant-rejected" | "address-mismatch" | "consent-expired"
            ));
            assert_eq!(
                stage,
                match cause {
                    R::VerificationRequired => "held",
                    R::CredentialsRejected => "stopped",
                    _ => "cancelled",
                }
            );
            // A consent refusal never relabels an adapter stop.
            assert_eq!(
                for_status(F::LoginAdapterStopped(cause), Some(ConsentRefusal::Expired)),
                Some((stage, Some(code)))
            );
        }
        assert_eq!(codes.len(), 9);
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
