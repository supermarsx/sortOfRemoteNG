use super::*;
use crate::origin_browser_authority::tests::{connection, Fixture};
use serde_json::json;

async fn authorize(row: Value) -> (Fixture, NativeAuthorizedBrowser) {
    let initial = saved_source(&row).unwrap().to_string();
    let mut fixture = Fixture::new(row).await;
    fixture.request.initial_url = initial;
    let authorized = fixture.authorize().await.unwrap();
    (fixture, authorized)
}

#[tokio::test]
async fn native_login_reads_the_website_editors_dedicated_credentials() {
    for generic in [false, true] {
        let mut row = connection();
        if !generic {
            row.as_object_mut().unwrap().remove("username");
            row.as_object_mut().unwrap().remove("password");
        }
        row["basicAuthUsername"] = "website-user".into();
        row["basicAuthPassword"] = "website-secret".into();
        let (_fixture, authorized) = authorize(row).await;
        assert_eq!(
            authorized.login.availability(),
            NativeCredentialAvailability::Saved
        );
        assert_eq!(authorized.login.username.as_str(), "website-user");
        assert_eq!(authorized.login.password.as_str(), "website-secret");
    }
}

#[tokio::test]
async fn partial_website_credentials_never_mix_with_generic_credentials() {
    for (username, password) in [("website-user", ""), ("", "website-secret")] {
        let mut row = connection();
        row["basicAuthUsername"] = username.into();
        row["basicAuthPassword"] = password.into();
        let (_fixture, authorized) = authorize(row).await;
        assert_eq!(
            authorized.login.availability(),
            NativeCredentialAvailability::Unavailable
        );
    }
}

#[tokio::test]
async fn empty_website_fields_preserve_legacy_generic_credentials() {
    for empty in [Value::Null, json!("")] {
        let mut row = connection();
        row["basicAuthUsername"] = empty.clone();
        row["basicAuthPassword"] = empty;
        let (_fixture, authorized) = authorize(row).await;
        assert_eq!(
            authorized.login.availability(),
            NativeCredentialAvailability::Saved
        );
        assert_eq!(authorized.login.username.as_str(), "test-user");
        assert_eq!(authorized.login.password.as_str(), "fixture-secret");
    }
}

#[tokio::test]
async fn selected_website_fields_are_validated_without_generic_fallback() {
    for invalid in [
        json!(false),
        json!(["secret"]),
        json!("bad\0value"),
        json!("x".repeat(MAX_CREDENTIAL_BYTES + 1)),
    ] {
        for key in ["basicAuthUsername", "basicAuthPassword"] {
            let mut row = connection();
            row["basicAuthUsername"] = "website-user".into();
            row["basicAuthPassword"] = "website-secret".into();
            row[key] = invalid.clone();
            let fixture = Fixture::new(row).await;
            assert!(matches!(
                fixture.authorize().await,
                Err(NativeAuthorityError::CredentialUnavailable)
            ));
        }
    }
}

#[tokio::test]
async fn claude_email_only_does_not_require_or_release_a_password() {
    for dedicated in [false, true] {
        let mut row = connection();
        row["httpApplication"] = json!({"version":1,"id":"claude","loginMode":"form"});
        row["username"] = "email-only@example.invalid".into();
        // Email assistance must not even validate an unrelated password.
        row["password"] = json!({"not":"an email credential"});
        row["basicAuthPassword"] = json!(false);
        if dedicated {
            row["basicAuthUsername"] = "website-email@example.invalid".into();
        }
        let (_fixture, authorized) = authorize(row).await;
        assert_eq!(
            authorized.login.availability(),
            NativeCredentialAvailability::Saved
        );
        assert_eq!(
            authorized.login.username.as_str(),
            if dedicated {
                "website-email@example.invalid"
            } else {
                "email-only@example.invalid"
            }
        );
        assert!(authorized.login.password.is_empty());
    }
}

#[tokio::test]
async fn proxmox_realm_survives_final_native_credential_resolution() {
    for (username, realm, expected) in [
        ("root", "pam", "root@pam"),
        ("operator", "pve", "operator@pve"),
        ("operator@custom", "pam", "operator@custom"),
    ] {
        let mut row = connection();
        row["httpApplication"] =
            json!({"version":1,"id":"proxmox","loginMode":"form","realm":realm});
        row["basicAuthUsername"] = username.into();
        row["basicAuthPassword"] = "website-secret".into();
        let (_fixture, authorized) = authorize(row).await;
        assert_eq!(
            authorized.login.availability(),
            NativeCredentialAvailability::Saved
        );
        assert_eq!(authorized.login.username.as_str(), expected);
    }
}
