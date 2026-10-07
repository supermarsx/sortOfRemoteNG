//! Code-only login bundle, including closed, reviewed provider drivers.
//! This does not select/authorize applications.
//! The native owner must supply the reviewed profile selectors/options and
//! fence every delivery by owner, attempt, document, origin, consent and expiry.
//! Provider stages and deferred form actions use separate, one-shot native grants.

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

/// Evaluate once per main-frame context; keep the returned closure native-only.
/// Factory: (notify, configuration, nativeAdapter) -> deliver.
/// Configuration: reviewed selectors/readiness OR provider identity/timing.
/// deliver(origin, username, password, autoSubmit, deadline, optionsOrStage, stage) -> bool.
/// Preparation and submit grants carry no credential or extra-field values.
/// Configuration and credentials are V8 values, NEVER interpolated source.
/// A true delivery result means accepted, not provider authentication success.
pub fn form_client_source() -> String {
    include_str!("native_login_client.js").replace("/* REVIEWED_FORM_MODULES */", FORM_MODULES)
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
}
