use super::*;
use serde_json::json;

#[test]
fn native_browsing_mode_matches_renderer_shared_parity_cases() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/nativeBrowsingDefaults.json"
    ))
    .unwrap();
    for case in cases.as_array().unwrap() {
        assert_eq!(
            browsing_defaults::standard(case.get("policy")),
            case["standard"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn standard_native_browsing_allows_platform_classes_but_restricted_mode_and_denials_win() {
    let destination = "https://new-website-content.example";
    for (profile, origin) in [
        ("generic-form", "https://example.com"),
        ("zoom", "https://zoom.us"),
        ("instagram", "https://www.instagram.com"),
    ] {
        let source = Url::parse(origin).unwrap();
        let mut row = tests::connection();
        row["hostname"] = origin.into();
        row["httpApplication"] = json!({"version":1,"id":profile,"loginMode":"manual"});
        for (mode, expected) in [
            ("standard", WebsitePermissionDecision::Allow),
            ("restricted", WebsitePermissionDecision::Deny),
        ] {
            row["httpProxyPolicy"] = json!({"version":1,"pageScripts":"allow","nativeBrowsingMode":mode,"allowAllRequests":false,"allowAllScripts":false});
            let (engine, static_origins) = saved_permissions(&row, &json!({}), &source).unwrap();
            assert!(!static_origins.iter().any(|value| value == destination));
            for (_, class) in CLASSES {
                assert_eq!(
                    engine
                        .resolve(WebsitePermissionQuery {
                            website_origin: origin,
                            destination_origin: destination,
                            request_class: class,
                            native_denied: false
                        })
                        .decision,
                    expected,
                    "{profile}/{mode}/{class}"
                );
            }
        }
        row["httpProxyPolicy"]["allowAllScripts"] = true.into();
        let (script_engine, _) = saved_permissions(&row, &json!({}), &source).unwrap();
        assert_eq!(
            script_engine
                .resolve(WebsitePermissionQuery {
                    website_origin: origin,
                    destination_origin: destination,
                    request_class: "script",
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Allow
        );
        assert_eq!(
            script_engine
                .resolve(WebsitePermissionQuery {
                    website_origin: origin,
                    destination_origin: destination,
                    request_class: "navigation",
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
        row["httpProxyPolicy"]["allowAllRequests"] = true.into();
        let (all_engine, _) = saved_permissions(&row, &json!({}), &source).unwrap();
        assert_eq!(
            all_engine
                .resolve(WebsitePermissionQuery {
                    website_origin: origin,
                    destination_origin: destination,
                    request_class: "navigation",
                    native_denied: false
                })
                .decision,
            WebsitePermissionDecision::Allow
        );
        row["httpProxyPolicy"]["nativeBrowsingMode"] = "standard".into();
        row["websiteDomainPermissions"] = json!({"version":1,"websites":[{"origin":origin,"requestClasses":{"script":"deny"},"destinations":[{"origin":destination,"requestClasses":{"navigation":"deny"}}]}]});
        let (engine, _) = saved_permissions(&row, &json!({}), &source).unwrap();
        for class in ["script", "navigation"] {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: origin,
                        destination_origin: destination,
                        request_class: class,
                        native_denied: false
                    })
                    .decision,
                WebsitePermissionDecision::Deny
            );
        }
    }
}

#[test]
fn absent_and_old_normalized_policy_default_to_normal_native_browsing() {
    let origin = "https://ordinary.example";
    for policy in [
        None,
        Some(
            json!({"version":1,"pageScripts":"allow","allowAllScripts":false,"allowAllRequests":false}),
        ),
    ] {
        let mut row = tests::connection();
        row["hostname"] = origin.into();
        row.as_object_mut().unwrap().remove("httpProxyPolicy");
        if let Some(policy) = policy {
            row["httpProxyPolicy"] = policy;
        }
        let source = Url::parse(origin).unwrap();
        let (engine, finite) = saved_permissions(&row, &json!({}), &source).unwrap();
        let target = "https://ordinary-content.example";
        for (_, class) in CLASSES {
            assert_eq!(
                engine
                    .resolve(WebsitePermissionQuery {
                        website_origin: origin,
                        destination_origin: target,
                        request_class: class,
                        native_denied: false
                    })
                    .decision,
                WebsitePermissionDecision::Allow
            );
        }
        assert!(!finite.iter().any(|entry| entry == target));
    }
}
