//! Code-only login bundle, including closed, reviewed provider drivers.
//! This does not select/authorize applications.
//! The native owner must supply the reviewed profile selectors/options and
//! fence every delivery by owner, attempt, document, origin, consent and expiry.
//! Provider stages and deferred form actions use separate, one-shot native grants.

use std::sync::OnceLock;

const FORM_MODULES: &str = concat!(
    include_str!("../../sorng-protocols/src/autologin/common/dom.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/freepbx.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/porkbun.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/cpanel.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/joomla.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/exchange_ecp.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/instagram.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/linkedin.js"),
    include_str!("../../sorng-protocols/src/autologin/apps/vodafone_smart_router.js"),
    include_str!("../../sorng-protocols/src/autologin/forms/generic.js"),
    include_str!("../../sorng-protocols/src/autologin/forms/options.js"),
    include_str!("../../sorng-protocols/src/autologin/common/guards.js"),
    include_str!("../../sorng-protocols/src/autologin/forms/advanced.js"),
    include_str!("../../sorng-protocols/src/autologin/forms/readiness.js"),
);

/// Evaluate once per authorized login-frame context; keep the closure native-only.
/// Factory: (notify, configuration, nativeAdapter) -> deliver.
/// Configuration: reviewed selectors/readiness OR provider identity/timing.
/// deliver(origin, username, password, autoSubmit, deadline, optionsOrStage, stage) -> bool.
/// Preparation and submit grants carry no credential or extra-field values.
/// Configuration and credentials are V8 values, NEVER interpolated source.
/// A true delivery result means accepted, not provider authentication success.
pub fn form_client_source() -> &'static str {
    static SOURCE: OnceLock<String> = OnceLock::new();
    SOURCE.get_or_init(assemble_source).as_str()
}

// Executable code only. The manifest is also consumed by the JavaScript test
// harness, so renderer tests execute the exact production composition.
const FACTORY_MODULES: &[(&str, &str)] = &[
    (
        "/* NATIVE_LOGIN_CHALLENGE */",
        include_str!("native_login/challenge.js"),
    ),
    (
        "/* NATIVE_LOGIN_DRONE_CONSENT */",
        include_str!("native_login/drone_consent.js"),
    ),
    (
        "/* NATIVE_LOGIN_OTP */",
        include_str!("native_login/otp.js"),
    ),
    (
        "/* NATIVE_LOGIN_PROVIDERS */",
        include_str!("native_login/providers.js"),
    ),
    (
        "/* NATIVE_LOGIN_DEFERRED_FORM */",
        include_str!("native_login/deferred_form.js"),
    ),
    (
        "/* NATIVE_LOGIN_DECLARATIVE */",
        include_str!("native_login/declarative.js"),
    ),
    (
        "/* TACTICAL_FOCUS_RETRY */",
        include_str!("native_login/tactical_focus.js"),
    ),
    (
        "/* REVIEWED_TOTP_GUARDS */",
        include_str!("../../sorng-protocols/src/autologin/common/totp_guards.js"),
    ),
    (
        "/* NATIVE_KEYBOARD_CLIENT */",
        include_str!("native_login_typing.js"),
    ),
    (
        "/* REVIEWED_PTISP_TOUR */",
        include_str!("../../sorng-protocols/src/ptisp_tour_client.js"),
    ),
];

fn assemble_source() -> String {
    let mut source =
        include_str!("native_login_client.js").replace("/* REVIEWED_FORM_MODULES */", FORM_MODULES);
    for (marker, module) in FACTORY_MODULES {
        assert_eq!(
            source.matches(marker).count(),
            1,
            "native login module marker"
        );
        source = source.replace(marker, module);
    }
    source
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_reuses_modules_without_proxy_credential_coordinator() {
        let source = form_client_source();
        assert!(!source.contains("/* REVIEWED_FORM_MODULES */"));
        assert!(source.contains("function bootstrapFill("));
        assert!(source.contains("function runLinkedinForm("));
        assert!(!source.contains("fetchCredsAndRun"));
        assert!(!source.contains("/__sortofremoteng_autologin"));
    }

    #[test]
    fn repeated_documents_share_code_only_assembly() {
        let first = form_client_source();
        assert!(std::ptr::eq(first.as_ptr(), form_client_source().as_ptr()));
        for (marker, _) in FACTORY_MODULES {
            assert!(!first.contains(marker));
        }
        assert!(first.contains("function approvedOtpStage("));
        assert!(first.contains("function declarativeClient("));
    }
}
