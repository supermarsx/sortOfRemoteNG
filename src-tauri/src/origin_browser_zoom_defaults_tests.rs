use super::tests::{connection, Fixture};
use super::*;
use serde_json::json;

const ORIGIN: &str = "https://zoom.us";
const CDN: &str = "https://unlisted-zoom-content.example";

fn zoom() -> Value {
    let mut row = connection();
    row["hostname"] = "https://zoom.us/signin".into();
    row["httpApplication"] = json!({"version":1,"id":"zoom","loginMode":"form"});
    row["httpProxyPolicy"] =
        json!({"version":1,"pageScripts":"allow","allowAllScripts":false,"allowAllRequests":false});
    row
}

fn decision(
    engine: &WebsitePermissionEngine,
    destination: &str,
    class: &str,
    native_denied: bool,
) -> WebsitePermissionDecision {
    engine
        .resolve(WebsitePermissionQuery {
            website_origin: ORIGIN,
            destination_origin: destination,
            request_class: class,
            native_denied,
        })
        .decision
}

#[tokio::test]
async fn zoom_content_default_allows_all_https_classes_but_keeps_encrypted_credential_scope_finite()
{
    let row = zoom();
    let initial = saved_source(&row).unwrap().to_string();
    let mut fixture = Fixture::new(row).await;
    fixture.request.initial_url = initial;
    let authorized = fixture.authorize().await.unwrap();
    for (_, class) in CLASSES {
        assert_eq!(
            decision(&authorized.permissions, CDN, class, false),
            WebsitePermissionDecision::Allow,
            "{class}"
        );
    }
    assert!(authorized.policy.network_origin_grant()(CDN));
    assert!(!authorized
        .policy
        .allowed_origins()
        .iter()
        .any(|origin| origin == CDN));
    assert!(!authorized.login.origins.iter().any(|origin| origin == CDN));
    assert!(authorized
        .policy
        .allowed_origins()
        .iter()
        .any(|origin| origin == ORIGIN));
}

#[test]
fn zoom_defaults_require_exact_profile_origin_and_both_reviewed_metadata_flags() {
    let row = zoom();
    assert!(social_script_defaults::enabled(&row, ORIGIN));
    assert!(social_script_defaults::requests_enabled(&row, ORIGIN));
    for origin in [
        "https://www.zoom.us",
        "https://zoom.us.evil.test",
        "https://zoom.us:8443",
        "http://zoom.us",
        "https://attacker.example",
    ] {
        assert!(!social_script_defaults::enabled(&row, origin));
        assert!(!social_script_defaults::requests_enabled(&row, origin));
    }
    for (field, value) in [
        ("id", json!("generic-form")),
        ("id", json!("instagram")),
        ("version", json!(2)),
        ("invalid", json!(true)),
    ] {
        let mut invalid = row.clone();
        invalid["httpApplication"][field] = value;
        assert!(!social_script_defaults::requests_enabled(&invalid, ORIGIN));
    }
    for id in ["instagram", "linkedin"] {
        let mut other = row.clone();
        other["httpApplication"]["id"] = id.into();
        assert!(!social_script_defaults::requests_enabled(&other, ORIGIN));
    }
    // Test-only immutable catalog snapshots cannot manufacture defaults from
    // the selected app ID alone: the exact reviewed flag/source is required.
    for flag in [json!(false), Value::Null] {
        let mut catalog = native_login_catalog().clone();
        catalog["profiles"]["zoom"]["requestDefaults"]["allowAllRequests"] = flag;
        let catalog = Box::leak(Box::new(catalog));
        NATIVE_LOGIN_CATALOG_OVERRIDE.with(|slot| {
            let previous = slot.replace(Some(catalog));
            assert!(!social_script_defaults::requests_enabled(&row, ORIGIN));
            slot.set(previous);
        });
    }
}

#[test]
fn zoom_full_content_defaults_preserve_every_shared_and_connection_explicit_deny() {
    for shared in [false, true] {
        for per_class in [false, true] {
            for (_, class) in CLASSES {
                let mut row = zoom();
                let permissions = json!({"version":1,"websites":[{"origin":ORIGIN,
                    "requestClasses":if per_class { json!({class:"deny"}) } else { json!({}) },
                    "destinations":if per_class { json!([]) } else { json!([{"origin":CDN,"requestClasses":{class:"deny"}}]) }
                }]});
                let settings = if shared {
                    json!({"webBrowser":{"domainPermissions":permissions}})
                } else {
                    row["websiteDomainPermissions"] = permissions;
                    Value::Null
                };
                let result = saved_permissions(&row, &settings, &Url::parse(ORIGIN).unwrap());
                if per_class && class == "navigation" {
                    assert!(
                        matches!(result, Err(NativeAuthorityError::PolicyInvalid { .. })),
                        "source navigation deny must reject browser creation"
                    );
                    continue;
                }
                let (engine, _) = result.unwrap();
                assert_eq!(
                    decision(&engine, CDN, class, false),
                    WebsitePermissionDecision::Deny,
                    "shared={shared} class={class} class-rule={per_class}"
                );
            }
        }
    }
}

#[test]
fn zoom_defaults_preserve_native_same_origin_and_local_endpoint_constraints() {
    let mut row = zoom();
    let (engine, _) = saved_permissions(&row, &Value::Null, &Url::parse(ORIGIN).unwrap()).unwrap();
    for (_, class) in CLASSES {
        assert_eq!(
            decision(&engine, CDN, class, true),
            WebsitePermissionDecision::Deny
        );
        for destination in [
            "https://localhost",
            "https://127.0.0.1",
            "https://[::1]",
            "https://0.0.0.0",
            "https://[::]",
        ] {
            assert_eq!(
                decision(&engine, destination, class, false),
                WebsitePermissionDecision::Deny,
                "{class} {destination}"
            );
        }
    }
    assert_eq!(
        decision(
            &engine,
            "http://unlisted-zoom-content.example",
            "navigation",
            false
        ),
        WebsitePermissionDecision::Deny
    );
    assert_eq!(
        decision(
            &engine,
            "http://unlisted-zoom-content.example",
            "frame",
            false
        ),
        WebsitePermissionDecision::Deny
    );
    let restricted = engine.restrict_cross_origin_requests(false);
    assert_eq!(
        decision(&restricted, CDN, "script", false),
        WebsitePermissionDecision::Deny
    );
    row["httpProxyPolicy"]["sameOriginOnly"] = true.into();
    let (same_origin, _) =
        saved_permissions(&row, &Value::Null, &Url::parse(ORIGIN).unwrap()).unwrap();
    for (_, class) in CLASSES {
        assert_eq!(
            decision(&same_origin, CDN, class, false),
            WebsitePermissionDecision::Deny
        );
    }
    for mode in ["block", "inline-only"] {
        row["httpProxyPolicy"]["pageScripts"] = mode.into();
        assert!(saved_permissions(&row, &Value::Null, &Url::parse(ORIGIN).unwrap()).is_err());
    }
}

#[tokio::test]
async fn zoom_full_content_opt_out_keeps_same_origin_navigation_and_denies_external_content() {
    let mut row = zoom();
    let deny: serde_json::Map<String, Value> = CLASSES
        .iter()
        .map(|(_, class)| ((*class).into(), json!("deny")))
        .collect();
    let allow: serde_json::Map<String, Value> = CLASSES
        .iter()
        .map(|(_, class)| ((*class).into(), json!("allow")))
        .collect();
    row["websiteDomainPermissions"] = json!({"version":1,"websites":[{"origin":ORIGIN,
        "requestClasses":deny,
        "destinations":[{"origin":ORIGIN,"requestClasses":allow}]
    }]});
    let initial = saved_source(&row).unwrap().to_string();
    let mut fixture = Fixture::new(row).await;
    fixture.request.initial_url = initial;
    let authorized = fixture.authorize().await.unwrap();
    for (_, class) in CLASSES {
        assert_eq!(
            decision(&authorized.permissions, ORIGIN, class, false),
            WebsitePermissionDecision::Allow,
            "same-origin {class}"
        );
        assert_eq!(
            decision(&authorized.permissions, CDN, class, false),
            WebsitePermissionDecision::Deny,
            "external {class}"
        );
    }
    assert!(authorized.policy.network_origin_grant()(ORIGIN));
    assert!(!authorized.policy.network_origin_grant()(CDN));
}

#[test]
fn zoom_opt_out_representation_preserves_existing_own_and_shared_source_denials() {
    for shared in [false, true] {
        let mut row = zoom();
        let deny: serde_json::Map<String, Value> = CLASSES
            .iter()
            .map(|(_, class)| ((*class).into(), json!("deny")))
            .collect();
        let mut own_decisions: serde_json::Map<String, Value> = CLASSES
            .iter()
            .map(|(_, class)| ((*class).into(), json!("allow")))
            .collect();
        // The frontend copies effective own-origin decisions instead of blindly
        // granting the source when turning off external content.
        own_decisions.insert("script".into(), json!("deny"));
        row["websiteDomainPermissions"] = json!({"version":1,"websites":[{"origin":ORIGIN,
            "requestClasses":deny,
            "destinations":[{"origin":ORIGIN,"requestClasses":own_decisions}]
        }]});
        let settings = if shared {
            json!({"webBrowser":{"domainPermissions":{"version":1,"websites":[{"origin":ORIGIN,"requestClasses":{"script":"deny"},"destinations":[]}]}}})
        } else {
            Value::Null
        };
        let (engine, _) = saved_permissions(&row, &settings, &Url::parse(ORIGIN).unwrap()).unwrap();
        assert_eq!(
            decision(&engine, ORIGIN, "script", false),
            WebsitePermissionDecision::Deny
        );
        assert_eq!(
            decision(&engine, ORIGIN, "navigation", false),
            WebsitePermissionDecision::Allow
        );
        assert_eq!(
            decision(&engine, CDN, "script", false),
            WebsitePermissionDecision::Deny
        );
    }
}
