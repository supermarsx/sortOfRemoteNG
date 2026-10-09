use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

#[derive(Clone, Default)]
struct CefString(String);

impl From<&str> for CefString {
    fn from(value: &str) -> Self {
        Self(value.into())
    }
}

impl From<&CefString> for CefString {
    fn from(value: &CefString) -> Self {
        value.clone()
    }
}

impl Display for CefString {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Default)]
struct CommandLine(BTreeMap<String, String>);

impl CommandLine {
    fn switch_value(&self, name: Option<&CefString>) -> CefString {
        CefString(self.0.get(&name.unwrap().0).cloned().unwrap_or_default())
    }

    fn append_switch(&mut self, name: Option<&CefString>) {
        self.0.insert(name.unwrap().0.clone(), String::new());
    }

    fn append_switch_with_value(&mut self, name: Option<&CefString>, value: Option<&CefString>) {
        self.0
            .insert(name.unwrap().0.clone(), value.unwrap().0.clone());
    }
}

struct RuntimeApplication {
    xslt_enabled: bool,
}

fn start(process: Option<&str>, command: &mut CommandLine) {
    RuntimeApplication { xslt_enabled: true }
        .on_before_command_line_processing(process.map(CefString::from).as_ref(), Some(command));
}

#[test]
fn startup_never_globally_disables_trials_and_repeated_callbacks_are_idempotent() {
    for process in [
        None,
        Some(""),
        Some("renderer"),
        Some("utility"),
        Some("gpu-process"),
    ] {
        let mut command = CommandLine::default();
        start(process, &mut command);
        assert!(!command.0.contains_key("disable-field-trial-config"));
        assert!(feature_override(&command, "XSLTSpecialTrial") == Some(false));
        let first = command.0.clone();
        start(process, &mut command);
        assert_eq!(command.0, first);
    }
    RuntimeApplication { xslt_enabled: true }.on_before_command_line_processing(None, None);
}

#[test]
fn saved_xslt_disable_is_applied_before_renderers_and_preserved_in_helpers() {
    let app = RuntimeApplication {
        xslt_enabled: false,
    };
    let mut command = CommandLine::default();
    command
        .0
        .insert("disable-blink-features".into(), "Other".into());
    for _ in 0..2 {
        app.on_before_command_line_processing(None, Some(&mut command));
        assert_eq!(command.0["disable-blink-features"], "Other,XSLT");
        assert!(!command.0.contains_key("disable-field-trial-config"));
    }
    // Renderer startup receives the browser switches. The helper's default
    // must not undo a saved opt-out or consume application settings itself.
    start(Some("renderer"), &mut command);
    assert_eq!(command.0["disable-blink-features"], "Other,XSLT");
    let mut next_startup = CommandLine::default();
    start(None, &mut next_startup);
    assert!(!next_startup.0.contains_key("disable-blink-features"));
}

#[test]
fn targeted_exclusion_does_not_force_xslt_or_replace_explicit_feature_and_policy_settings() {
    let mut command = CommandLine::default();
    for (name, value) in [
        ("enable-features", "ExistingEnabled<Trial:key/value"),
        ("disable-features", "XSLT,OtherDisabled<Trial:key/value"),
        ("xslt-enabled-policy", "false"),
        ("disable-blink-features", "XSLT"),
        ("force-fieldtrials", "ExplicitTrial/Group/"),
    ] {
        command.0.insert(name.into(), value.into());
    }
    start(None, &mut command);
    assert_eq!(
        command.0["enable-features"],
        "ExistingEnabled<Trial:key/value,SkipIPv6ReachabilityProbe,WebContentsForceDark"
    );
    assert_eq!(command.0["disable-features"], "XSLT,OtherDisabled<Trial:key/value,RecordLockAcquisitionTime,PreemptiveSodaDownload,SodaComponentUpdates,XSLTSpecialTrial");
    assert_eq!(command.0["xslt-enabled-policy"], "false");
    assert_eq!(command.0["disable-blink-features"], "XSLT");
    assert_eq!(command.0["force-fieldtrials"], "ExplicitTrial/Group/");
    assert!(!command.0.contains_key("enable-blink-features"));
    assert!(!command.0.contains_key("disable-variations-safe-mode"));
    assert!(!command.0.contains_key("variations-server-url"));
}

#[test]
fn startup_keeps_sandbox_trust_routes_and_identity_unchanged() {
    let mut command = CommandLine::default();
    start(None, &mut command);
    for forbidden in [
        "no-sandbox",
        "disable-web-security",
        "ignore-certificate-errors",
        "allow-running-insecure-content",
        "user-agent",
        "fake-variations-channel",
        "fake-variations-platform",
        "remote-debugging-port",
        "enable-field-trial-config",
        "enable-benchmarking",
        "disable-variations-safe-mode",
        "accept-empty-variations-seed-signature",
        "disable-field-trial-config",
    ] {
        assert!(!command.0.contains_key(forbidden), "unexpected {forbidden}");
    }
    assert_eq!(command.0["host-resolver-rules"], NATIVE_HOST_RESOLVER_RULES);
    assert_eq!(
        command.0["force-webrtc-ip-handling-policy"],
        "disable_non_proxied_udp"
    );
    assert!(command.0.contains_key("disable-quic"));
    assert!(command.0.contains_key("disable-chrome-login-prompt"));
}

// Pinned Chromium 154.0.8037.58 ShouldUseFieldTrialTestingConfig predicate:
// components/variations/service/variations_field_trial_creator.cc:143-155.
// A model of the switch contract, NOT an execution of Chromium/enterprise policy.
fn testing_config_selected(command: &CommandLine, branded: bool) -> bool {
    let explicitly_enabled = command.0.contains_key("enable-field-trial-config")
        || command
            .0
            .get("enable-benchmarking")
            .is_some_and(|value| value == "enable-field-trial-config");
    explicitly_enabled
        || (!branded
            && !command.0.contains_key("disable-field-trial-config")
            && !command.0.contains_key("variations-server-url"))
}

fn feature_override(command: &CommandLine, name: &str) -> Option<bool> {
    for (key, enabled) in [("disable-features", false), ("enable-features", true)] {
        if command.0.get(key).is_some_and(|list| {
            list.split(',')
                .any(|entry| entry.trim().split(['<', ':']).next() == Some(name))
        }) {
            return Some(enabled);
        }
    }
    None
}

// Small model of the PINNED source, not a substitute for live CEF acceptance:
// field_trial_util.cc::ShouldSkipExperiment + AssociateParamsFromExperiment;
// fieldtrial_testing_config.json studies PrepopulatedEnginesMigration and
// XSLTSpecialTrial. Both studies have identical settings on our three OSes.
fn pinned_feature_state(command: &CommandLine) -> BTreeMap<&'static str, bool> {
    let mut features = BTreeMap::from([
        ("XSLT", true),
        ("XSLTSpecialTrial", false),
        ("PrepopulatedEnginesMigration", false),
        ("PrepopulatedEnginesShadowVariants", false),
    ]);
    if testing_config_selected(command, false) {
        for experiment in [
            vec![("PrepopulatedEnginesMigration", true)],
            vec![("XSLTSpecialTrial", true), ("XSLT", false)],
        ] {
            if experiment
                .iter()
                .any(|(name, _)| feature_override(command, name).is_some())
            {
                continue;
            }
            features.extend(experiment);
        }
    }
    for (name, value) in &mut features {
        if let Some(explicit) = feature_override(command, name) {
            *value = explicit;
        }
    }
    features
}

// template_url_prepopulate_data_resolver.cc:89-103 rejects stored migration
// bits missing from the active feature set; timestamps/cookies are irrelevant.
fn profile_rollback_assertion(stored_bits: u8, command: &CommandLine) -> bool {
    let features = pinned_feature_state(command);
    let active_bits = u8::from(features["PrepopulatedEnginesMigration"])
        | (u8::from(features["PrepopulatedEnginesShadowVariants"]) << 1);
    stored_bits & !active_bits != 0
}

#[test]
fn already_migrated_profile_reproduces_broad_opt_out_crash_and_survives_targeted_fix() {
    let previous = CommandLine::default();
    assert!(!profile_rollback_assertion(1, &previous));
    assert!(!pinned_feature_state(&previous)["XSLT"]);

    let mut broken = CommandLine::default();
    broken
        .0
        .insert("disable-field-trial-config".into(), String::new());
    assert!(
        profile_rollback_assertion(1, &broken),
        "must reproduce the reported rollback"
    );

    let mut repaired = CommandLine::default();
    start(None, &mut repaired);
    for stored_bits in [0, 1] {
        assert!(!profile_rollback_assertion(stored_bits, &repaired));
    }
    assert!(pinned_feature_state(&repaired)["XSLT"]);
    assert!(!pinned_feature_state(&repaired)["XSLTSpecialTrial"]);
    // Reopening uses the same policy; no resetting or editing the stored DB.
    start(None, &mut repaired);
    assert!(!profile_rollback_assertion(1, &repaired));
}

#[test]
fn explicit_feature_state_is_preserved_including_shadow_migration_and_xslt_denial() {
    let mut command = CommandLine::default();
    command.0.insert(
        "enable-features".into(),
        "PrepopulatedEnginesShadowVariants<Trial".into(),
    );
    command.0.insert("disable-features".into(), "XSLT".into());
    start(None, &mut command);
    assert!(!profile_rollback_assertion(3, &command));
    assert!(!pinned_feature_state(&command)["XSLT"]);
    assert!(pinned_feature_state(&command)["PrepopulatedEnginesMigration"]);
}

#[test]
fn unexpected_shadow_metadata_is_not_silently_rewritten_or_enabled() {
    let mut command = CommandLine::default();
    start(None, &mut command);
    assert!(!pinned_feature_state(&command)["PrepopulatedEnginesShadowVariants"]);
    for unexpected_bits in [2, 3] {
        assert!(profile_rollback_assertion(unexpected_bits, &command));
    }
}

#[test]
fn only_xslt_study_is_excluded_and_global_trial_selection_remains_unchanged() {
    for branded in [false, true] {
        let mut command = CommandLine::default();
        start(None, &mut command);
        assert_eq!(testing_config_selected(&command, branded), !branded);
    }
    let mut command = CommandLine::default();
    command.0.insert(
        "disable-features".into(),
        "XSLTSpecialTrial<Trial:param/value".into(),
    );
    start(None, &mut command);
    assert!(pinned_feature_state(&command)["XSLT"]);
    assert!(!profile_rollback_assertion(1, &command));
}
