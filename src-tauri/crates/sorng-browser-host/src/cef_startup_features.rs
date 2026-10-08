//! Startup policy tied to the frozen CEF 682c378 / Chromium 154 build.
//! Background-service and native-dialog policy, not security exceptions.

const DISABLED_FEATURES: &[&str] = &[
    "RecordLockAcquisitionTime",
    // SODA's eager speech-model download is unrelated to getUserMedia/WebRTC.
    // In components/soda/soda_installer.cc it can register an on-demand update
    // during profile startup without any website or user asking for speech.
    // The app's unowned system context deliberately has no network route.
    // This upstream gate alone does not cover active or recently used profiles.
    "PreemptiveSodaDownload",
    // Companion pinned-engine feature (default enabled), not an upstream flag:
    // gate SodaInstaller::Init and SodaInstallerImpl::{InstallSoda,InstallLanguage}
    // before preference/download-state changes or component registration.
    // This prevents SODA provisioning, including explicit speech-model installs;
    // it does not disable microphone capture, WebRTC or other component updates.
    // An unpatched libcef ignores this name: policy tests are not engine proof.
    "SodaComponentUpdates",
];

// GetGpuDriverOverlayInfo's missing ID3D11VideoDevice1 path leaves overlays
// unsupported and returns; it is not a reason to disable GPU/WebGL or logging.

// chrome/browser/extensions/external_provider_impl.cc checks this BEFORE
// constructing the Windows registry and Unix external-directory providers.
// Do not import another browser's machine-installed/default extensions into
// app-private profiles. Explicitly installed extensions and the internal PDF
// component loader remain enabled; this is NOT --disable-extensions.
pub(crate) const DISABLE_DEFAULT_APPS: &str = "disable-default-apps";

// Pinned CEF 682c378 BrowserPlatformDelegate::IsPrintPreviewSupported checks
// this before Chrome-style's preview default. Chromium StartPrint(..., true)
// chooses PrintNow (system dialog), not the embedded Chrome print-preview UI.
// This changes presentation only; sandbox and private-context routing remain.
pub(crate) const DISABLE_PRINT_PREVIEW: &str = "disable-print-preview";

// Companion engine flag: Chromium only reaches our numeric IPv4 loopback relay.
// The backend owns upstream IPv6; no direct IPv6/NAT64 route probe is needed.
// Merge paint policy here too: a later enable-features append would overwrite
// the route policy and any features already selected by CEF.
pub(crate) fn enabled_features(existing: &str) -> String {
    merge_features(
        existing,
        &["SkipIPv6ReachabilityProbe", "WebContentsForceDark"],
    )
}

pub(crate) fn disabled_features(existing: &str) -> String {
    merge_features(existing, DISABLED_FEATURES)
}

fn merge_features(existing: &str, required_features: &[&str]) -> String {
    let mut features: Vec<_> = existing
        .split(',')
        .map(str::trim)
        .filter(|feature| !feature.is_empty())
        .collect();
    for required in required_features {
        if !features
            .iter()
            .any(|feature| feature.split(['<', ':']).next() == Some(*required))
        {
            features.push(required);
        }
    }
    features.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_proxy_route_probe_skip_and_dark_paint_without_duplicates() {
        assert_eq!(
            enabled_features(""),
            "SkipIPv6ReachabilityProbe,WebContentsForceDark"
        );
        assert_eq!(
            enabled_features("Other<Trial:key/value"),
            "Other<Trial:key/value,SkipIPv6ReachabilityProbe,WebContentsForceDark"
        );
        for value in [
            "SkipIPv6ReachabilityProbe,WebContentsForceDark",
            "SkipIPv6ReachabilityProbe<Trial:key/value,WebContentsForceDark<DarkTrial",
        ] {
            assert_eq!(enabled_features(value), value);
        }
        assert_eq!(
            enabled_features("WebContentsForceDark<Trial"),
            "WebContentsForceDark<Trial,SkipIPv6ReachabilityProbe"
        );
        assert_eq!(
            enabled_features("SkipIPv6ReachabilityProbe<Trial:key/value"),
            "SkipIPv6ReachabilityProbe<Trial:key/value,WebContentsForceDark"
        );
        let first = enabled_features("Other");
        assert_eq!(enabled_features(&first), first);
    }

    #[test]
    fn disables_only_optional_lock_metrics_and_soda_provisioning() {
        let expected = "RecordLockAcquisitionTime,PreemptiveSodaDownload,SodaComponentUpdates";
        assert_eq!(disabled_features(""), expected);
        assert_eq!(disabled_features(" , "), expected);
    }

    #[test]
    fn retains_existing_cef_disables_including_trial_parameters() {
        assert_eq!(
            disabled_features("LensOverlay,TcpSocketIoCompletionPortWin,Other<Trial:key/value"),
            "LensOverlay,TcpSocketIoCompletionPortWin,Other<Trial:key/value,RecordLockAcquisitionTime,PreemptiveSodaDownload,SodaComponentUpdates"
        );
    }

    #[test]
    fn repeated_process_initialization_does_not_duplicate_the_workaround() {
        for value in [
            "RecordLockAcquisitionTime,PreemptiveSodaDownload,SodaComponentUpdates",
            "LensOverlay,RecordLockAcquisitionTime<Trial,PreemptiveSodaDownload<Trial,SodaComponentUpdates<Trial",
            "RecordLockAcquisitionTime:key/value,Other,PreemptiveSodaDownload:key/value,SodaComponentUpdates:key/value",
        ] {
            assert_eq!(disabled_features(value), value);
        }
        let first = disabled_features("Other");
        assert_eq!(disabled_features(&first), first);
    }

    #[test]
    fn completes_partial_policies_without_duplicate_parameterized_features() {
        assert_eq!(
            disabled_features("PreemptiveSodaDownload<Trial:key/value"),
            "PreemptiveSodaDownload<Trial:key/value,RecordLockAcquisitionTime,SodaComponentUpdates"
        );
        assert_eq!(
            disabled_features("RecordLockAcquisitionTime<Trial"),
            "RecordLockAcquisitionTime<Trial,PreemptiveSodaDownload,SodaComponentUpdates"
        );
        assert_eq!(DISABLE_DEFAULT_APPS, "disable-default-apps");
        assert_eq!(DISABLE_PRINT_PREVIEW, "disable-print-preview");
    }

    #[test]
    fn upgrades_eager_only_policy_with_the_companion_engine_feature() {
        assert_eq!(
            disabled_features("RecordLockAcquisitionTime,PreemptiveSodaDownload"),
            "RecordLockAcquisitionTime,PreemptiveSodaDownload,SodaComponentUpdates"
        );
        assert_eq!(
            disabled_features("SodaComponentUpdates<Trial:key/value"),
            "SodaComponentUpdates<Trial:key/value,RecordLockAcquisitionTime,PreemptiveSodaDownload"
        );
    }
}
