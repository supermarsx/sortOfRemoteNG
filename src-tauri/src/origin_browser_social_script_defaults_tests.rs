use super::tests::{connection, Fixture};
use super::*;
use serde_json::json;

struct Consent;
impl NativeLoginConsentVerifier for Consent {
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

fn social(id: &str, origin: &str) -> Value {
    let mut row = connection();
    row["hostname"] = format!("{origin}/login").into();
    row["httpApplication"] = json!({"version":1,"id":id,"loginMode":"manual"});
    // Explicit script-only permission in Restricted browsing remains narrow.
    row["httpProxyPolicy"] =
        json!({"version":1,"pageScripts":"allow","nativeBrowsingMode":"restricted","allowAllScripts":true,"allowAllRequests":false});
    row
}

#[tokio::test]
async fn social_apps_explicit_script_permission_keeps_other_requests_and_credentials_restricted() {
    const CDN: &str = "https://unlisted-script-cdn.example";
    for (id, origin) in [
        ("instagram", "https://www.instagram.com"),
        ("linkedin", "https://www.linkedin.com"),
    ] {
        let mut row = social(id, origin);
        row["httpApplication"]["loginMode"] = "form".into();
        let initial = saved_source(&row).unwrap().to_string();
        let mut f = Fixture::new(row).await;
        f.request.initial_url = initial;
        let authorized = f.authorize().await.unwrap();
        assert!(authorized.login.enabled());
        assert_eq!(
            authorized
                .permissions
                .resolve(WebsitePermissionQuery {
                    website_origin: origin,
                    destination_origin: CDN,
                    request_class: "script",
                    native_denied: false,
                })
                .decision,
            WebsitePermissionDecision::Allow
        );
        assert!(authorized.policy.network_origin_grant()(CDN));
        assert!(!authorized
            .policy
            .allowed_origins()
            .iter()
            .any(|value| value == CDN));
        for class in [
            "navigation",
            "frame",
            "worker",
            "fetch-xhr",
            "websocket",
            "font",
            "image-media",
        ] {
            assert_eq!(
                authorized
                    .permissions
                    .resolve(WebsitePermissionQuery {
                        website_origin: origin,
                        destination_origin: CDN,
                        request_class: class,
                        native_denied: false,
                    })
                    .decision,
                WebsitePermissionDecision::Deny,
                "{id} {class}"
            );
        }
        for destination in [
            "http://unlisted-script-cdn.example",
            "https://localhost",
            "https://127.0.0.1",
            "https://[::1]",
            "https://0.0.0.0",
            "https://[::]",
        ] {
            assert_eq!(
                authorized
                    .permissions
                    .resolve(WebsitePermissionQuery {
                        website_origin: origin,
                        destination_origin: destination,
                        request_class: "script",
                        native_denied: false,
                    })
                    .decision,
                WebsitePermissionDecision::Deny,
                "{id} {destination}"
            );
        }
        authorized.login.with_credentials(
            &NativeLoginRequest {
                identity: authorized.policy.identity(),
                origin: CDN,
            },
            &Consent,
            &mut |_| panic!("script default granted credential origin"),
        );
    }
}

#[test]
fn social_script_defaults_require_the_selected_valid_profile_and_exact_origin() {
    for (id, origin) in [
        ("instagram", "https://www.instagram.com"),
        ("linkedin", "https://www.linkedin.com"),
    ] {
        let row = social(id, origin);
        assert!(social_script_defaults::enabled(&row, origin));
        for source in [
            "https://attacker.example",
            "https://www.instagram.com.evil.test",
            "https://www.linkedin.com.evil.test",
            "http://www.instagram.com",
            "https://www.instagram.com:8443",
        ] {
            assert!(!social_script_defaults::enabled(&row, source));
        }
        for (field, value) in [
            ("id", json!("generic-form")),
            ("version", json!(2)),
            ("invalid", json!(true)),
        ] {
            let mut bad = row.clone();
            bad["httpApplication"][field] = value;
            assert!(!social_script_defaults::enabled(&bad, origin));
        }
    }
}

#[test]
fn social_script_defaults_keep_explicit_denials_and_same_origin_policy() {
    let origin = "https://www.instagram.com";
    let cdn = "https://unlisted-script-cdn.example";
    for shared in [false, true] {
        for class in [false, true] {
            let mut row = social("instagram", origin);
            let mut settings = json!({});
            let permissions = json!({"version":1,"websites":[{"origin":origin,
                "requestClasses":if class { json!({"script":"deny"}) } else { json!({}) },
                "destinations":if class { json!([]) } else { json!([{"origin":cdn,"requestClasses":{"script":"deny"}}]) }
            }]});
            if shared {
                settings = json!({"webBrowser":{"domainPermissions":permissions}});
            } else {
                row["websiteDomainPermissions"] = permissions;
            }
            let (engine, _) =
                saved_permissions(&row, &settings, &Url::parse(origin).unwrap()).unwrap();
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: origin,
                        destination_origin: cdn,
                        request_class: "script",
                        native_denied: false
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
    }
    let mut row = social("instagram", origin);
    row["httpProxyPolicy"]["sameOriginOnly"] = true.into();
    let (engine, _) = saved_permissions(&row, &Value::Null, &Url::parse(origin).unwrap()).unwrap();
    assert_eq!(
        engine
            .resolve(WebsitePermissionQuery {
                website_origin: origin,
                destination_origin: cdn,
                request_class: "script",
                native_denied: false
            })
            .decision,
        WebsitePermissionDecision::Deny
    );
    for mode in ["block", "inline-only"] {
        row["httpProxyPolicy"]["pageScripts"] = mode.into();
        assert!(saved_permissions(&row, &Value::Null, &Url::parse(origin).unwrap()).is_err());
    }
}
