//! Drone CI bridged sign-in (r1-drone). Drone has no local accounts: its
//! `/login` sends the tab to the saved Git provider (SCM), which signs the
//! user in and returns to `<drone>/login`. This module is the native half of
//! `src/utils/connection/droneScmBridge.ts` and is the ONLY place that turns
//! a Drone connection into credential and navigation authority:
//!
//! - the SCM origin comes from the saved `httpApplication.droneScmOrigin` (or
//!   the provider's fixed hosted origin), never from a redirect or a page;
//! - username and password go to exactly one origin: the HTTPS SCM origin for
//!   an OAuth provider with a reviewed form, the Drone origin for Gogs (Drone
//!   shows its own form), and never the Drone origin for an OAuth provider;
//! - the reviewed selectors come from the bundled catalog's `droneScm` table;
//!   saved selector overrides are refused.
//!
//! Every rule fails closed: anything unexpected yields `Err(())`, which the
//! caller turns into "this saved automatic-login configuration is not
//! supported" and types nothing.

use serde_json::Value;
use sorng_browser_host::domain_permissions::canonical_website_permission_origin;
use std::sync::LazyLock;

static CATALOG: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../crates/sorng-browser-host/src/native_login_catalog.json"
    ))
    .expect("reviewed native login catalog")
});

pub(super) const APPLICATION_ID: &str = "drone-ci";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DroneBridge {
    pub provider: String,
    /// Exact HTTPS SCM origin the tab must be able to reach (OAuth providers).
    pub scm_origin: Option<String>,
    /// The one origin that may receive the saved username and password.
    pub credential_origin: Option<String>,
    /// Reviewed sign-in selectors for `credential_origin`.
    pub selectors: Option<Value>,
}

pub(super) fn is_drone(connection: &Value) -> bool {
    connection
        .pointer("/httpApplication/id")
        .and_then(Value::as_str)
        == Some(APPLICATION_ID)
}

fn client_id_valid(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b))
}

/// The saved bridge of a Drone connection whose own origin is `source_origin`
/// (the saved source, which the caller has already validated).
pub(super) fn bridge(connection: &Value, source_origin: &str) -> Result<DroneBridge, ()> {
    bridge_with(&CATALOG, connection, source_origin)
}

fn bridge_with(
    catalog: &Value,
    connection: &Value,
    source_origin: &str,
) -> Result<DroneBridge, ()> {
    let application = connection.get("httpApplication").ok_or(())?;
    if !is_drone(connection) || application.get("invalid").is_some() {
        return Err(());
    }
    let provider = application
        .get("droneScmProvider")
        .and_then(Value::as_str)
        .ok_or(())?;
    let spec = catalog
        .pointer("/droneScm")
        .and_then(|table| table.get(provider))
        .filter(|spec| spec.is_object())
        .ok_or(())?;
    let saved_origin = match application.get("droneScmOrigin") {
        None => None,
        Some(value) => {
            let value = value.as_str().ok_or(())?;
            // Exact canonical HTTPS origin, as saved; never repaired.
            if canonical_website_permission_origin(value).as_deref() != Ok(value) {
                return Err(());
            }
            Some(value.to_owned())
        }
    };
    if let Some(value) = application.get("droneScmClientId") {
        if !value.as_str().is_some_and(client_id_valid) {
            return Err(());
        }
    }
    let selectors = spec.get("selectors").filter(|v| v.is_object()).cloned();
    match spec.get("flow").and_then(Value::as_str) {
        Some("drone-form") => {
            // Drone posts the pair to Gogs itself; a saved Gogs origin is
            // informational and grants nothing.
            if saved_origin.as_deref() == Some(source_origin) {
                return Err(());
            }
            Ok(DroneBridge {
                provider: provider.to_owned(),
                scm_origin: None,
                credential_origin: selectors.as_ref().map(|_| source_origin.to_owned()),
                selectors,
            })
        }
        Some("oauth") => {
            let default = spec.get("defaultOrigin").and_then(Value::as_str);
            if spec.get("fixedOrigin") == Some(&Value::Bool(true))
                && saved_origin.is_some()
                && saved_origin.as_deref() != default
            {
                return Err(());
            }
            let scm = saved_origin
                .or_else(|| default.map(str::to_owned))
                .ok_or(())?;
            if canonical_website_permission_origin(&scm).as_deref() != Ok(scm.as_str())
                || scm == source_origin
            {
                return Err(());
            }
            let only = spec.get("onlyOrigin").and_then(Value::as_str);
            let not = spec.get("notOrigin").and_then(Value::as_str);
            let applies = selectors.is_some()
                && only.is_none_or(|only| only == scm)
                && not.is_none_or(|not| not != scm);
            Ok(DroneBridge {
                provider: provider.to_owned(),
                credential_origin: applies.then(|| scm.clone()),
                selectors: if applies { selectors } else { None },
                scm_origin: Some(scm),
            })
        }
        _ => Err(()),
    }
}

/// Navigation for the SCM leg. Not a credential grant; the caller applies it
/// only outside same-origin-only mode, under the ordinary deny precedence.
pub(super) fn navigation_origin(connection: &Value, source_origin: &str) -> Option<String> {
    if !is_drone(connection)
        || connection
            .pointer("/httpApplication/loginMode")
            .and_then(Value::as_str)
            != Some("form")
    {
        return None;
    }
    bridge(connection, source_origin).ok()?.scm_origin
}

/// A one-time code only on the bridged Gitea origin.
pub(super) fn totp_origin_allowed(connection: &Value, source_origin: &str, origin: &str) -> bool {
    bridge(connection, source_origin).is_ok_and(|bridge| {
        bridge.provider == "gitea"
            && bridge.scm_origin.as_deref() == Some(origin)
            && bridge.credential_origin.as_deref() == Some(origin)
    })
}

/// Only the reviewed Gitea consent for the saved public OAuth client id.
pub(super) fn consent_configuration(connection: &Value) -> Result<Option<Value>, ()> {
    if connection.pointer("/httpApplication/droneScmProvider").and_then(Value::as_str) != Some("gitea") { return Ok(None); }
    let Some(client_id) = connection.pointer("/httpApplication/droneScmClientId").and_then(Value::as_str) else { return Ok(None); };
    if !client_id_valid(client_id) { return Err(()); }
    let source = super::saved_source(connection).map_err(|_| ())?;
    let source_origin = source.origin().ascii_serialization();
    let bridge = bridge(connection, &source_origin)?;
    let origin = bridge.scm_origin.ok_or(())?;
    let mut consent = CATALOG.pointer("/droneScm/gitea/consent").filter(|value| value.is_object()).cloned().ok_or(())?;
    consent["origin"] = origin.into();
    consent["clientId"] = client_id.into();
    consent["redirectUri"] = format!("{source_origin}/login").into();
    Ok(Some(consent))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DRONE: &str = "https://ci.example.test";
    const GITEA: &str = "https://git.example.test";

    fn row(app: Value) -> Value {
        let mut app = app;
        app["version"] = 1.into();
        app["id"] = APPLICATION_ID.into();
        app["loginMode"] = "form".into();
        json!({"protocol":"https","hostname":"ci.example.test","httpApplication":app})
    }

    #[test]
    fn gitea_types_only_on_the_saved_scm_and_never_on_drone() {
        let b = bridge(
            &row(json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA})),
            DRONE,
        )
        .unwrap();
        assert_eq!(b.scm_origin.as_deref(), Some(GITEA));
        assert_eq!(b.credential_origin.as_deref(), Some(GITEA));
        assert_eq!(
            b.selectors.unwrap()["usernameSelector"],
            CATALOG["profiles"]["gitea"]["selectors"]["usernameSelector"]
        );
        assert_eq!(
            navigation_origin(
                &row(json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA})),
                DRONE
            )
            .as_deref(),
            Some(GITEA)
        );
    }

    #[test]
    fn catalog_bridge_selectors_equal_the_reviewed_profiles() {
        for (provider, profile) in [
            ("gitea", "gitea"),
            ("github", "github"),
            ("gitlab", "gitlab-self-hosted"),
        ] {
            assert_eq!(
                CATALOG["droneScm"][provider]["selectors"],
                CATALOG["profiles"][profile]["selectors"],
                "{provider}"
            );
        }
        assert!(CATALOG["droneScm"]["bitbucket"].get("selectors").is_none());
        assert_eq!(
            CATALOG["profiles"][APPLICATION_ID]["capability"],
            "known-form"
        );
        assert!(CATALOG["profiles"][APPLICATION_ID]
            .get("selectors")
            .is_none());
    }

    #[test]
    fn refuses_missing_unknown_or_non_canonical_settings() {
        for app in [
            json!({}),
            json!({"droneScmProvider":"gitee","droneScmOrigin":GITEA}),
            json!({"droneScmProvider":"gitea"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":"https://GIT.example.test"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":"https://git.example.test/"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":"https://git.example.test/gitea"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":"http://git.example.test"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":"https://u@git.example.test"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":DRONE}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA,"droneScmClientId":"a b"}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA,"droneScmClientId":7}),
            json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA,"invalid":true}),
            json!({"droneScmProvider":"bitbucket","droneScmOrigin":"https://bb.example.test"}),
            json!({"droneScmProvider":"gogs","droneScmOrigin":DRONE}),
            json!({"droneScmProvider":["gitea"],"droneScmOrigin":GITEA}),
        ] {
            assert!(bridge(&row(app.clone()), DRONE).is_err(), "{app}");
            assert!(
                navigation_origin(&row(app.clone()), DRONE).is_none(),
                "{app}"
            );
        }
        let mut other = row(json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA}));
        other["httpApplication"]["id"] = "gitea".into();
        assert!(bridge(&other, DRONE).is_err());
        assert!(navigation_origin(&other, DRONE).is_none());
    }

    #[test]
    fn gogs_types_on_drone_and_grants_no_navigation() {
        let b = bridge(&row(json!({"droneScmProvider":"gogs"})), DRONE).unwrap();
        assert_eq!(b.scm_origin, None);
        assert_eq!(b.credential_origin.as_deref(), Some(DRONE));
        let b = bridge(
            &row(json!({"droneScmProvider":"gogs","droneScmOrigin":"https://gogs.example.test"})),
            DRONE,
        )
        .unwrap();
        assert_eq!(b.scm_origin, None);
        assert!(navigation_origin(&row(json!({"droneScmProvider":"gogs"})), DRONE).is_none());
    }

    #[test]
    fn hosted_defaults_and_unreviewed_sign_in_types_nothing() {
        let b = bridge(&row(json!({"droneScmProvider":"github"})), DRONE).unwrap();
        assert_eq!(b.credential_origin.as_deref(), Some("https://github.com"));
        let b = bridge(
            &row(json!({"droneScmProvider":"github","droneScmOrigin":"https://ghe.example.test"})),
            DRONE,
        )
        .unwrap();
        assert_eq!(b.scm_origin.as_deref(), Some("https://ghe.example.test"));
        assert_eq!(b.credential_origin, None);
        assert_eq!(b.selectors, None);
        let b = bridge(
            &row(json!({"droneScmProvider":"gitlab","droneScmOrigin":"https://gitlab.com"})),
            DRONE,
        )
        .unwrap();
        assert_eq!(b.credential_origin, None);
        let b = bridge(
            &row(
                json!({"droneScmProvider":"gitlab","droneScmOrigin":"https://gitlab.example.test"}),
            ),
            DRONE,
        )
        .unwrap();
        assert_eq!(
            b.credential_origin.as_deref(),
            Some("https://gitlab.example.test")
        );
        let b = bridge(&row(json!({"droneScmProvider":"bitbucket"})), DRONE).unwrap();
        assert_eq!(b.scm_origin.as_deref(), Some("https://bitbucket.org"));
        assert_eq!(b.credential_origin, None);
        assert!(bridge(&row(json!({"droneScmProvider":"gitlab"})), DRONE).is_err());
    }

    #[test]
    fn navigation_only_in_form_mode_and_totp_only_on_bridged_gitea() {
        let mut manual = row(json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA}));
        manual["httpApplication"]["loginMode"] = "manual".into();
        assert!(navigation_origin(&manual, DRONE).is_none());
        let gitea = row(json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA}));
        assert!(totp_origin_allowed(&gitea, DRONE, GITEA));
        assert!(!totp_origin_allowed(&gitea, DRONE, DRONE));
        assert!(!totp_origin_allowed(
            &gitea,
            DRONE,
            "https://other.example.test"
        ));
        let gitlab = row(
            json!({"droneScmProvider":"gitlab","droneScmOrigin":"https://gitlab.example.test"}),
        );
        assert!(!totp_origin_allowed(
            &gitlab,
            DRONE,
            "https://gitlab.example.test"
        ));
        assert!(!totp_origin_allowed(
            &row(json!({"droneScmProvider":"gogs"})),
            DRONE,
            DRONE
        ));
    }

    #[test]
    fn an_unknown_flow_in_the_catalog_fails_closed() {
        let catalog = json!({"droneScm":{"gitea":{"flow":"magic","selectors":{}}}});
        assert!(bridge_with(
            &catalog,
            &row(json!({"droneScmProvider":"gitea","droneScmOrigin":GITEA})),
            DRONE
        )
        .is_err());
    }
}
