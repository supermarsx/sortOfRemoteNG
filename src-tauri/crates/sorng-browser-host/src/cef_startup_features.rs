//! Workarounds tied to the frozen CEF 682c378 build, not security exceptions.

const LOCK_METRICS: &str = "RecordLockAcquisitionTime";

pub(crate) fn disabled_features(existing: &str) -> String {
    let mut features: Vec<_> = existing
        .split(',')
        .map(str::trim)
        .filter(|feature| !feature.is_empty())
        .collect();
    if !features
        .iter()
        .any(|feature| feature.split(['<', ':']).next() == Some(LOCK_METRICS))
    {
        features.push(LOCK_METRICS);
    }
    features.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disables_only_the_optional_lock_metrics_feature() {
        assert_eq!(disabled_features(""), LOCK_METRICS);
        assert_eq!(disabled_features(" , "), LOCK_METRICS);
    }

    #[test]
    fn retains_existing_cef_disables_including_trial_parameters() {
        assert_eq!(
            disabled_features("LensOverlay,TcpSocketIoCompletionPortWin,Other<Trial:key/value"),
            "LensOverlay,TcpSocketIoCompletionPortWin,Other<Trial:key/value,RecordLockAcquisitionTime"
        );
    }

    #[test]
    fn repeated_process_initialization_does_not_duplicate_the_workaround() {
        for value in [
            "RecordLockAcquisitionTime",
            "LensOverlay,RecordLockAcquisitionTime<Trial",
            "RecordLockAcquisitionTime:key/value,Other",
        ] {
            assert_eq!(disabled_features(value), value);
        }
        let first = disabled_features("Other");
        assert_eq!(disabled_features(&first), first);
    }
}
