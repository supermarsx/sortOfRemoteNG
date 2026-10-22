//! Declarative-steps authority (t102-e10). Plan rules first, then the real
//! `authorize_create` path with a stand-in catalog (synthetic rows only).
use super::*;
use crate::origin_browser_authority::{
    saved_declarative_login,
    tests::{connection, Fixture},
    NativeLoginConsentVerifier, NativeLoginRequest, NATIVE_LOGIN_CATALOG,
    NATIVE_LOGIN_CATALOG_OVERRIDE,
};
use serde_json::json;
use sorng_protocols::origin_browser::BrowserIdentity;
use std::time::{Duration, Instant};

const OWN: &str = "https://source.example";
const IDP: &str = "https://login.idp.com";

fn identity_first() -> Value {
    json!({
        "mode": "exclusive",
        "credentialOrigins": [IDP],
        "passwordOnly": false,
        "loginSteps": [
            {"kind":"identifier","selectors":{"username":"#user"}},
            {"kind":"submit","submission":"click","selectors":{"control":"#next"}},
            {"kind":"password","origin":IDP,"pathPrefixes":["/signin/"],"selectors":{"password":"#pw"}},
            {"kind":"submit","submission":"enter"}
        ]
    })
}

fn catalog_plan(declarative: &Value) -> Option<LoginStepsPlan> {
    from_catalog(declarative, OWN, false).map(|(plan, _)| plan)
}

fn steps(steps: Value) -> Value {
    json!({"mode":"exclusive","credentialOrigins":[],"passwordOnly":false,"loginSteps":steps})
}

#[test]
fn listed_auxiliary_origin_gets_only_its_own_stage_and_no_unlisted_origin_gets_any() {
    let plan = catalog_plan(&identity_first()).unwrap();
    assert_eq!(plan.credential_origins(), [OWN, IDP]);
    let signin = Some("/signin/v2");
    for (origin, stage, path, expected) in [
        (OWN, "identifier", None, true),
        (OWN, "id-submit", None, true),
        (OWN, "form-prepare", None, true),
        (OWN, "password", None, false),
        (OWN, "pw-submit", None, false),
        (OWN, "form", None, false),
        (IDP, "password", signin, true),
        (IDP, "pw-submit", signin, true),
        (IDP, "identifier", signin, false),
        (IDP, "id-submit", signin, false),
        (IDP, "form", signin, false),
        (IDP, "bound-password", signin, false),
        (IDP, "unknown", signin, false),
        ("https://evil.idp.com", "password", signin, false),
        ("https://other.example", "identifier", None, false),
        ("http://source.example", "identifier", None, false),
    ] {
        assert_eq!(
            plan.permits(origin, stage, path, None),
            expected,
            "{origin} {stage}"
        );
    }
}

#[test]
fn path_and_frame_scopes_use_the_reported_live_values_only() {
    let plan = catalog_plan(&identity_first()).unwrap();
    // No reported path: a gated step never applies.
    assert!(!plan.permits(IDP, "password", None, None));
    assert!(!plan.permits(IDP, "password", Some("/signin"), None));
    assert!(!plan.permits(IDP, "password", Some("/other/signin/"), None));
    assert!(!plan.permits(IDP, "password", Some("signin/x"), None));
    assert!(plan.permits(IDP, "password", Some("/signin/"), None));
    // Wrong frame: the step runs in the top document only.
    assert!(!plan.permits(IDP, "password", Some("/signin/"), Some("login")));
    let framed = catalog_plan(&steps(json!([
        {"kind":"form","frame":"loginFrame","paths":["/ui/login"],"selectors":{"username":"#u","password":"#p"}},
        {"kind":"submit","submission":"spa","selectors":{"control":"#go"}}
    ])))
    .unwrap();
    assert!(framed.permits(OWN, "form", Some("/ui/login"), Some("loginFrame")));
    assert!(framed.permits(OWN, "form-submit", Some("/ui/login"), Some("loginFrame")));
    assert!(!framed.permits(OWN, "form", Some("/ui/login"), None));
    assert!(!framed.permits(OWN, "form", Some("/ui/login/"), Some("loginFrame")));
    assert!(!framed.permits(OWN, "form", Some("/ui/login"), Some("other")));
}

#[test]
fn origins_must_be_listed_used_https_and_public() {
    assert!(catalog_plan(&identity_first()).is_some());
    let mut unlisted = identity_first();
    unlisted["credentialOrigins"] = json!([]);
    assert!(catalog_plan(&unlisted).is_none());
    let mut unused = identity_first();
    unused["credentialOrigins"] = json!([IDP, "https://spare.idp.com"]);
    assert!(catalog_plan(&unused).is_none());
    for origin in [
        "http://login.idp.com",
        "https://login.idp.com/",
        "https://login.idp.com:443",
        "https://LOGIN.idp.com",
        "https://nas.local",
        "https://sso.corp.internal",
        "https://idp.localhost",
        "https://login.example",
        "https://192.168.1.10",
        "https://intranet",
        "https://-bad.idp.com",
        "https://login.idp.com:0",
        "https://login.idp.com:70000",
    ] {
        let mut file = identity_first();
        file["credentialOrigins"] = json!([origin]);
        file["loginSteps"][2]["origin"] = origin.into();
        assert!(catalog_plan(&file).is_none(), "{origin}");
    }
    let mut ported = identity_first();
    ported["credentialOrigins"] = json!(["https://login.idp.com:8443"]);
    ported["loginSteps"][2]["origin"] = "https://login.idp.com:8443".into();
    assert!(catalog_plan(&ported).is_some());
}

#[test]
fn order_rules_one_release_per_origin_and_stage_and_password_only() {
    let form = || json!({"kind":"form","selectors":{"username":"#u","password":"#p"}});
    let identifier = || json!({"kind":"identifier","selectors":{"username":"#u"}});
    let password = || json!({"kind":"password","selectors":{"password":"#p"}});
    let submit = || json!({"kind":"submit","submission":"enter"});
    let click = || json!({"kind":"click","selectors":{"control":"#tab"}});
    assert!(catalog_plan(&steps(json!([click(), form(), submit()]))).is_some());
    for bad in [
        json!([password(), submit()]),            // password without identifier
        json!([form(), form()]),                  // two releases on one origin
        json!([identifier(), form()]),            // username typed twice
        json!([submit(), form()]),                // submit before its step
        json!([identifier(), click(), submit()]), // submit not adjacent
        json!([form(), submit(), submit()]),      // two submits per origin and stage
        json!([form(), click()]),                 // click after the last credential step
        json!([click()]),                         // no credential step
        json!([]),                                // empty
    ] {
        assert!(catalog_plan(&steps(bad.clone())).is_none(), "{bad}");
    }
    let mut password_only = steps(json!([password(), submit()]));
    password_only["passwordOnly"] = true.into();
    let plan = catalog_plan(&password_only).unwrap();
    assert!(plan.password_only());
    assert!(plan.permits(OWN, "password", None, None));
    assert!(!plan.permits(OWN, "identifier", None, None));
    password_only["loginSteps"] = json!([form(), submit()]);
    assert!(catalog_plan(&password_only).is_none());
    // A submit separated from its step by a click elsewhere: only adjacency catches it.
    let idp_click = || json!({"kind":"click","origin":IDP,"selectors":{"control":"#c"}});
    let idp_password = || json!({"kind":"password","origin":IDP,"selectors":{"password":"#p"}});
    let mut split = steps(json!([identifier(), submit(), idp_click(), idp_password()]));
    split["credentialOrigins"] = json!([IDP]);
    assert!(catalog_plan(&split).is_some());
    split["loginSteps"] = json!([identifier(), idp_click(), submit(), idp_password()]);
    assert!(catalog_plan(&split).is_none());
    // A listed origin that turns out to be the connection's own is re-checked.
    let own_listed = json!({"mode":"exclusive","credentialOrigins":["https://source.example.com"],
        "passwordOnly":false,"loginSteps":[identifier(),
        {"kind":"identifier","origin":"https://source.example.com","selectors":{"username":"#u"}}]});
    assert!(from_catalog(&own_listed, "https://other.example.com", false).is_some());
    assert!(from_catalog(&own_listed, "https://source.example.com", false).is_none());
}

#[test]
fn structure_bounds_and_unknown_fields_reject_the_whole_plan() {
    let ok = json!({"kind":"form","selectors":{"username":"#u","password":"#p"}});
    for bad in [
        json!({"kind":"form","selectors":{"username":"#u"}}),
        json!({"kind":"form","selectors":{"username":"#u","password":"#p","extra":"#x"}}),
        json!({"kind":"form","selectors":{"username":" #u","password":"#p"}}),
        json!({"kind":"form","selectors":{"username":"#u\n","password":"#p"}}),
        json!({"kind":"form","selectors":{"username":"x".repeat(513),"password":"#p"}}),
        json!({"kind":"form","script":"x","selectors":{"username":"#u","password":"#p"}}),
        json!({"kind":"form","paths":["/a/../b"],"selectors":{"username":"#u","password":"#p"}}),
        json!({"kind":"form","paths":["/a?b"],"selectors":{"username":"#u","password":"#p"}}),
        json!({"kind":"form","pathPrefixes":["/"],"selectors":{"username":"#u","password":"#p"}}),
        json!({"kind":"form","pathPrefixes":["/a"],"selectors":{"username":"#u","password":"#p"}}),
        json!({"kind":"form","frame":"a b","selectors":{"username":"#u","password":"#p"}}),
        json!({"kind":"type","selectors":{"username":"#u","password":"#p"}}),
    ] {
        assert!(
            catalog_plan(&steps(json!([bad.clone()]))).is_none(),
            "{bad}"
        );
    }
    let enter_with_control =
        json!({"kind":"submit","submission":"enter","selectors":{"control":"#go"}});
    assert!(catalog_plan(&steps(json!([ok.clone(), enter_with_control]))).is_none());
    let scoped_submit =
        json!({"kind":"submit","submission":"click","origin":OWN,"selectors":{"control":"#go"}});
    assert!(catalog_plan(&steps(json!([ok.clone(), scoped_submit]))).is_none());
    let seventeen: Vec<Value> = std::iter::once(ok.clone())
        .chain(std::iter::repeat_n(
            json!({"kind":"click","selectors":{"control":"#c"}}),
            16,
        ))
        .collect();
    assert!(catalog_plan(&steps(Value::Array(seventeen))).is_none());
    let mut extra = steps(json!([ok.clone()]));
    extra["totpChallenges"] = json!([]);
    assert!(catalog_plan(&extra).is_none());
    let mut mode = steps(json!([ok.clone()]));
    mode["mode"] = "sometimes".into();
    assert!(catalog_plan(&mode).is_none());
}

#[test]
fn http_connection_origin_only_when_the_row_is_saved_as_http() {
    let file = steps(json!([{"kind":"form","selectors":{"username":"#u","password":"#p"}}]));
    assert!(from_catalog(&file, "http://router.lan:8080", false).is_none());
    let (plan, _) = from_catalog(&file, "http://router.lan:8080", true).unwrap();
    assert_eq!(plan.credential_origins(), ["http://router.lan:8080"]);
    assert!(from_catalog(&file, "http://router.lan:8080/", true).is_none());
}

#[test]
fn custom_login_builds_own_origin_steps_like_the_editor() {
    let selectors =
        json!({"usernameSelector":" #u ","passwordSelector":"#p","submitSelector":"#go"});
    assert_eq!(
        from_custom(Some(&selectors), &json!({}), OWN, false),
        Ok(None)
    );
    assert_eq!(
        from_custom(Some(&selectors), &json!({"submission":"click"}), OWN, false),
        Ok(None)
    );
    let plan = from_custom(
        Some(&selectors),
        &json!({"frame":"login","preStepSelector":" #tab "}),
        OWN,
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!(plan.credential_origins(), [OWN]);
    assert!(plan.permits(OWN, "form", None, Some("login")));
    assert!(plan.permits(OWN, "form-submit", None, Some("login")));
    assert!(plan.permits(OWN, "form-prepare", None, Some("login")));
    assert!(!plan.permits(OWN, "form", None, None));
    assert_eq!(
        plan.configuration()["loginSteps"],
        json!([
            {"kind":"click","frame":"login","selectors":{"control":"#tab"}},
            {"kind":"form","frame":"login","selectors":{"username":"#u","password":"#p"}},
            {"kind":"submit","submission":"click","selectors":{"control":"#go"}}
        ])
    );
    let plan = from_custom(
        Some(&selectors),
        &json!({"passwordOnly":true,"submission":"enter"}),
        OWN,
        false,
    )
    .unwrap()
    .unwrap();
    assert!(plan.password_only());
    assert!(plan.permits(OWN, "password", None, None));
    assert!(plan.permits(OWN, "pw-submit", None, None));
    assert!(!plan.permits(OWN, "form", None, None));
    for options in [
        json!({"origin":IDP}),
        json!({"frame":""}),
        json!({"frame":"a/b"}),
        json!({"passwordOnly":"yes"}),
        json!({"preStepSelector":"  "}),
        json!({"submission":"auto"}),
        json!([]),
    ] {
        assert_eq!(
            from_custom(Some(&selectors), &options, OWN, false),
            Err(()),
            "{options}"
        );
    }
    // Options that need a selector the row does not have.
    assert_eq!(
        from_custom(None, &json!({"submission":"spa"}), OWN, false),
        Err(())
    );
}

// ---- Through the real authority (synthetic database) ----

struct Allow;
impl NativeLoginConsentVerifier for Allow {
    fn with_current_consent(
        &self,
        _: &BrowserIdentity,
        _: &str,
        _: Option<&str>,
        deliver: &mut dyn FnMut(Instant, bool),
    ) {
        deliver(Instant::now() + Duration::from_secs(20), true);
    }
}

/// Installs a stand-in catalog for this test thread (`#[tokio::test]` runs on
/// one thread) and returns it. `None` keeps the bundled catalog.
fn use_catalog(edit: impl FnOnce(&mut Value)) {
    let mut catalog = NATIVE_LOGIN_CATALOG.clone();
    edit(&mut catalog);
    let leaked: &'static Value = Box::leak(Box::new(catalog));
    NATIVE_LOGIN_CATALOG_OVERRIDE.with(|cell| cell.set(Some(leaked)));
}

fn supported_with(id: &'static str, declarative: Value) -> impl FnOnce(&mut Value) {
    move |catalog: &mut Value| {
        catalog["declarativeLoginSupported"] = true.into();
        catalog["profiles"][id]["declarativeLogin"] = declarative;
    }
}

fn app_row(id: &str, mode: &str) -> Value {
    let mut row = connection();
    row["httpApplication"] = json!({"version":1,"id":id,"loginMode":mode});
    row
}

#[test]
fn only_selected_windmill_profiles_receive_native_password_pane_preparation() {
    use_catalog(|catalog| {
        let plan = catalog["profiles"]["windmill"]["declarativeLogin"].clone();
        catalog["declarativeLoginSupported"] = true.into();
        catalog["profiles"]["zabbix"]["declarativeLogin"] = plan;
    });
    for id in ["windmill", "windmill-self-hosted", "zabbix"] {
        let mut row = app_row(id, "form");
        row["preparation"] = json!("windmill-password-form");
        let (configuration, _) = saved_declarative_login(&row, &json!({}), id, OWN)
            .unwrap()
            .unwrap();
        let configuration: Value = serde_json::from_str(&configuration).unwrap();
        if id.starts_with("windmill") {
            assert_eq!(configuration["preparation"], "windmill-password-form");
        } else {
            assert!(configuration.get("preparation").is_none());
        }
    }
}

fn deliveries(
    login: &crate::origin_browser_authority::NativeLoginAuthority,
    identity: &BrowserIdentity,
    origin: &str,
) -> usize {
    let mut count = 0;
    login.with_credentials(
        &NativeLoginRequest { identity, origin },
        &Allow,
        &mut |_| count += 1,
    );
    count
}

#[test]
fn bundled_catalog_announces_declarative_support_with_reviewed_steps() {
    assert_eq!(
        NATIVE_LOGIN_CATALOG.get("declarativeLoginSupported"),
        Some(&Value::Bool(true))
    );
    assert!(NATIVE_LOGIN_CATALOG["profiles"]
        .as_object()
        .unwrap()
        .values()
        .any(|profile| profile.get("declarativeLogin").is_some()));
}

#[tokio::test]
async fn custom_login_is_refused_while_the_catalog_does_not_support_steps() {
    use_catalog(|catalog| catalog["declarativeLoginSupported"] = false.into());
    let mut row = app_row("custom", "form");
    row["httpAutoLoginSelectors"] =
        json!({"usernameSelector":"#u","passwordSelector":"#p","submitSelector":"#go"});
    let plain = Fixture::new(row.clone()).await.authorize().await.unwrap();
    assert!(plain.login.supports_default_adapter());
    assert!(!plain.login.declarative());
    row["httpApplication"]["customLogin"] = json!({"frame":"login"});
    let refused = Fixture::new(row.clone()).await.authorize().await.unwrap();
    assert!(
        !refused.login.supports_default_adapter(),
        "customLogin must not run as a plain form"
    );
    assert!(!refused.login.declarative());
    // `{}` sets no option: an ordinary Custom form, as the editor treats it.
    row["httpApplication"]["customLogin"] = json!({});
    assert!(Fixture::new(row.clone())
        .await
        .authorize()
        .await
        .unwrap()
        .login
        .supports_default_adapter());
    // Manual mode types nothing, so nothing needs refusing.
    row["httpApplication"]["customLogin"] = json!({"frame":"login"});
    row["httpApplication"]["loginMode"] = "manual".into();
    let manual = Fixture::new(row).await.authorize().await.unwrap();
    assert!(!manual.login.enabled());
}

#[tokio::test]
async fn supported_steps_grant_exactly_the_listed_origins_and_contract_configuration() {
    use_catalog(supported_with("zabbix", identity_first()));
    let authorized = Fixture::new(app_row("zabbix", "form"))
        .await
        .authorize()
        .await
        .unwrap();
    let login = &authorized.login;
    assert!(login.declarative());
    assert!(login.supports_default_adapter());
    assert_eq!(login.consent_origins(), [OWN, IDP]);
    let setup: Value = serde_json::from_str(login.form_configuration().unwrap()).unwrap();
    assert_eq!(
        setup["declarativeLogin"],
        json!({"connectionOrigin":OWN,"passwordOnly":false,"credentialOrigins":[IDP],
            "loginSteps":identity_first()["loginSteps"]})
    );
    assert_eq!(setup["readiness"]["detectionTimeoutMs"], 8000);
    assert!(setup.get("selectors").is_none());
    let id = authorized.policy.identity();
    assert_eq!(deliveries(login, id, OWN), 1);
    assert_eq!(deliveries(login, id, IDP), 1);
    assert_eq!(deliveries(login, id, "https://evil.idp.com"), 0);
    assert_eq!(deliveries(login, id, "https://other.example"), 0);
    assert!(login.declarative_permits(OWN, "identifier", None, None));
    assert!(!login.declarative_permits(OWN, "password", None, None));
    assert!(login.declarative_permits(IDP, "password", Some("/signin/x"), None));
    assert!(!login.declarative_permits(IDP, "identifier", Some("/signin/x"), None));
}

#[tokio::test]
async fn trusted_redirect_destinations_never_widen_a_steps_login() {
    use_catalog(supported_with("zabbix", identity_first()));
    let mut row = app_row("zabbix", "form");
    row["httpProxyPolicy"] = json!({"version":1,"allowAllRequests":true});
    row["httpRedirectAuthentication"] = json!({"version":1,"mode":"saved-login"});
    row["httpTrustedRedirectDestinations"] =
        json!({"version":1,"origins":["https://sso.trusted.com"]});
    let authorized = Fixture::new(row).await.authorize().await.unwrap();
    assert_eq!(authorized.login.consent_origins(), [OWN, IDP]);
}

#[tokio::test]
async fn exclusive_steps_refuse_overrides_and_additive_steps_keep_the_existing_login() {
    use_catalog(supported_with("zabbix", identity_first()));
    let mut row = app_row("zabbix", "form");
    row["httpAutoLoginSelectors"] = json!({"usernameSelector":"#x"});
    let refused = Fixture::new(row).await.authorize().await.unwrap();
    assert!(!refused.login.supports_default_adapter());
    let mut row = app_row("zabbix", "form");
    row["httpFormAutomation"] = json!({"version":1,"fillDelayMs":0,"submitDelayMs":0,
        "detectionTimeoutMs":8000,"submit":true,"fields":[{"selector":"#t","value":"v"}]});
    assert!(!Fixture::new(row)
        .await
        .authorize()
        .await
        .unwrap()
        .login
        .supports_default_adapter());

    let mut additive = identity_first();
    additive["mode"] = "additive".into();
    let before = Fixture::new(app_row("gitea", "form"))
        .await
        .authorize()
        .await
        .unwrap();
    use_catalog(supported_with("gitea", additive));
    let after = Fixture::new(app_row("gitea", "form"))
        .await
        .authorize()
        .await
        .unwrap();
    assert!(!after.login.declarative());
    assert_eq!(
        after.login.form_configuration(),
        before.login.form_configuration()
    );
    assert_eq!(
        after.login.consent_origins(),
        before.login.consent_origins()
    );
}

#[tokio::test]
async fn flag_on_without_steps_and_google_routing_behave_exactly_as_before() {
    let gitea = Fixture::new(app_row("gitea", "form"))
        .await
        .authorize()
        .await
        .unwrap();
    let mut google = connection();
    google["hostname"] = "https://analytics.google.com/".into();
    google["httpApplication"] = json!({"version":1,"id":"google-analytics","loginMode":"form"});

    use_catalog(|catalog| {
        catalog["declarativeLoginSupported"] = true.into();
        catalog["profiles"]["google-analytics"]["declarativeLogin"] = identity_first();
    });
    let after = Fixture::new(app_row("gitea", "form"))
        .await
        .authorize()
        .await
        .unwrap();
    assert!(!after.login.declarative());
    assert_eq!(
        after.login.form_configuration(),
        gitea.login.form_configuration()
    );
    assert_eq!(after.login.consent_origins(), gitea.login.consent_origins());
    // Google: steps on its profile are ignored; its own route stays.
    let plan = saved_declarative_login(
        &google,
        &Value::Null,
        "google-analytics",
        "https://analytics.google.com",
    );
    assert!(matches!(plan, Ok(None)));
}

#[tokio::test]
async fn password_only_steps_need_the_password_and_not_a_username() {
    let mut file = steps(json!([
        {"kind":"password","selectors":{"password":"#p"}},
        {"kind":"submit","submission":"enter"}
    ]));
    file["passwordOnly"] = true.into();
    use_catalog(supported_with("zabbix", file));
    let mut row = app_row("zabbix", "form");
    row["username"] = "".into();
    let authorized = Fixture::new(row.clone()).await.authorize().await.unwrap();
    assert_eq!(
        authorized.login.availability(),
        crate::origin_browser_authority::NativeCredentialAvailability::Saved
    );
    row["password"] = "".into();
    row["username"] = "someone".into();
    let authorized = Fixture::new(row).await.authorize().await.unwrap();
    assert_eq!(
        authorized.login.availability(),
        crate::origin_browser_authority::NativeCredentialAvailability::Unavailable
    );
}

#[tokio::test]
async fn supported_custom_login_runs_on_the_own_origin_only() {
    use_catalog(|catalog| {
        catalog["declarativeLoginSupported"] = true.into();
    });
    let mut row = app_row("custom", "form");
    row["httpAutoLoginSelectors"] =
        json!({"usernameSelector":"#u","passwordSelector":"#p","submitSelector":"#go"});
    row["httpApplication"]["customLogin"] = json!({"frame":"login","submission":"spa"});
    let authorized = Fixture::new(row.clone()).await.authorize().await.unwrap();
    assert!(authorized.login.declarative());
    assert_eq!(authorized.login.consent_origins(), [OWN]);
    assert!(authorized
        .login
        .declarative_permits(OWN, "form", None, Some("login")));
    assert!(!authorized
        .login
        .declarative_permits(OWN, "form", None, None));
    row["httpApplication"]["customLogin"] = json!({"frame":"login","origin":IDP});
    assert!(!Fixture::new(row)
        .await
        .authorize()
        .await
        .unwrap()
        .login
        .supports_default_adapter());
}
