use super::tests::{connection, Fixture};
use super::*;
use serde_json::json;
use sorng_browser_host::native_automation::{
    NativeAutomationAction, NativeAutomationFailure, NativeAutomationPermissions,
};

struct NoConsentVisit;
impl NativeLoginConsentVerifier for NoConsentVisit {
    fn with_current_consent(
        &self,
        _: &BrowserIdentity,
        _: &str,
        _: Option<&str>,
        _: &mut dyn FnMut(Instant, bool),
    ) {
        panic!("disabled app login must not even request credential consent");
    }
}

fn with_automation(mut row: Value) -> Value {
    row["httpAutomation"] = json!({"version":1,"items":[],"forceDark":true,
        "scriptInjectionEnabled":true,"interactionMacrosEnabled":true});
    row
}

#[tokio::test]
async fn native_extensions_off_opens_without_login_or_automation_and_keeps_forced_dark() {
    let mut row = with_automation(connection());
    row["browserSession"] = json!({"version":1,"websiteExtensionsEnabled":false});
    let fixture = Fixture::new(row).await;
    let authorized = fixture.authorize().await.unwrap();
    assert!(
        !authorized
            .preferences
            .capabilities
            .website_extensions_enabled
    );
    assert!(!authorized.login.enabled()); // LoginHooks::prepare selects Manual for this.
    assert!(authorized.login.consent_origins().is_empty());
    assert!(authorized.login.username.is_empty());
    assert!(authorized.login.password.is_empty());
    authorized.login.with_form_credentials(
        &NativeLoginRequest {
            identity: authorized.policy.identity(),
            origin: "https://source.example",
        },
        &NoConsentVisit,
        &mut |_, _| panic!("credentials released while disabled"),
    );
    let (scripts, macros) = authorized
        .automation
        .permissions(&fixture.window, &fixture.state)
        .await
        .unwrap();
    assert!(!scripts && !macros);
    let permissions = NativeAutomationPermissions { scripts, macros };
    let script = NativeAutomationAction::Script {
        document_token: "document".into(),
        origin: "https://source.example".into(),
        request_id: "request".into(),
        code: "document.title='must not run'".into(),
    };
    assert_eq!(
        script.validate(permissions),
        Err(NativeAutomationFailure::Denied)
    );
    let cancel = NativeAutomationAction::Cancel {
        document_token: "document".into(),
        origin: "https://source.example".into(),
        request_id: "cancel".into(),
    };
    assert!(cancel.validate(permissions).is_ok());
    assert_eq!(
        serde_json::to_value(&fixture.request.policy).unwrap()["darkMode"],
        "forced"
    );
    let baseline = Fixture::new(with_automation(connection())).await;
    let baseline = baseline.authorize().await.unwrap();
    assert_eq!(
        authorized.policy.allowed_origins(),
        baseline.policy.allowed_origins()
    );
}

#[tokio::test]
async fn native_extensions_saved_override_precedes_global_without_creating_grants() {
    for local in [None, Some(false), Some(true)] {
        let mut row = with_automation(connection());
        if let Some(enabled) = local {
            row["browserSession"] = json!({"version":1,"websiteExtensionsEnabled":enabled});
        }
        let fixture = Fixture::new(row).await;
        crate::app_settings_commands::write_app_settings_inner(
            fixture.root.path(),
            &fixture.state,
            json!({"webBrowser":{"version":1,"websiteExtensionsEnabled":false}}),
        )
        .await
        .unwrap();
        let authorized = fixture.authorize().await.unwrap();
        let expected = local.unwrap_or(false);
        assert_eq!(authorized.login.enabled(), expected);
        assert_eq!(
            authorized
                .automation
                .permissions(&fixture.window, &fixture.state)
                .await
                .unwrap(),
            (expected, expected)
        );
    }
    let mut row = connection();
    row["httpAutoLogin"] = false.into();
    row["browserSession"] = json!({"version":1,"websiteExtensionsEnabled":true});
    let fixture = Fixture::new(row).await;
    let authorized = fixture.authorize().await.unwrap();
    assert!(!authorized.login.enabled());
    assert_eq!(
        authorized
            .automation
            .permissions(&fixture.window, &fixture.state)
            .await
            .unwrap(),
        (false, false)
    );
}

#[tokio::test]
async fn native_extensions_inherited_global_revocation_restricts_live_receiver() {
    let fixture = Fixture::new(with_automation(connection())).await;
    let authorized = fixture.authorize().await.unwrap();
    assert_eq!(
        authorized
            .automation
            .permissions(&fixture.window, &fixture.state)
            .await
            .unwrap(),
        (true, true)
    );
    crate::app_settings_commands::write_app_settings_inner(
        fixture.root.path(),
        &fixture.state,
        json!({"webBrowser":{"version":1,"websiteExtensionsEnabled":false}}),
    )
    .await
    .unwrap();
    assert_eq!(
        authorized
            .automation
            .permissions(&fixture.window, &fixture.state)
            .await
            .unwrap(),
        (false, false)
    );
    fixture.state.lock().await;
    assert!(authorized
        .automation
        .permissions(&fixture.window, &fixture.state)
        .await
        .is_err());
}
