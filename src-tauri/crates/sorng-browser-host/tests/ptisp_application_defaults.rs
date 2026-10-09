//! Production PTisp helper + real permission resolver; no CEF or live requests.
#[path = "../../../src/origin_browser_ptisp_defaults.rs"]
mod ptisp_defaults;

use serde_json::{json, Value};
use sorng_browser_host::domain_permissions::{
    WebsiteDomainPermissionsSettings, WebsiteNetworkPolicy, WebsitePermissionDecision,
    WebsitePermissionEngine, WebsitePermissionQuery, WebsiteRequestClass,
};
use std::collections::BTreeMap;

const SOURCE: &str = "https://my.ptisp.pt";
const API: &str = "https://api3.ptisp.pt";

fn connection(mode: &str) -> Value {
    json!({"httpApplication":{"version":1,"id":"ptisp","loginMode":mode}})
}

fn engine(
    connection: &Value,
    same_origin_only: bool,
    cross_origin: bool,
    shared: Option<&WebsiteDomainPermissionsSettings>,
    own: Option<&WebsiteDomainPermissionsSettings>,
) -> WebsitePermissionEngine {
    let mut destinations = BTreeMap::from([(
        SOURCE.to_owned(),
        BTreeMap::from([(
            WebsiteRequestClass::Navigation,
            WebsitePermissionDecision::Allow,
        )]),
    )]);
    if !same_origin_only {
        if let Some((destination, classes)) = ptisp_defaults::resource_grant(connection, SOURCE) {
            destinations.insert(
                destination.into(),
                classes
                    .iter()
                    .map(|class| (*class, WebsitePermissionDecision::Allow))
                    .collect(),
            );
        }
    }
    WebsitePermissionEngine::new(shared, own, &BTreeMap::new())
        .unwrap()
        .with_network_policy(WebsiteNetworkPolicy {
            source_origin: SOURCE.into(),
            destination_defaults: destinations,
            same_origin_only,
            ..Default::default()
        })
        .unwrap()
        .restrict_cross_origin_requests(cross_origin)
}

fn decision(
    engine: &WebsitePermissionEngine,
    destination: &str,
    class: &str,
) -> WebsitePermissionDecision {
    engine
        .resolve(WebsitePermissionQuery {
            website_origin: SOURCE,
            destination_origin: destination,
            request_class: class,
            native_denied: false,
        })
        .decision
}

#[test]
fn manual_form_and_legacy_missing_mode_share_only_the_exact_api_default() {
    for mode in [Some("manual"), Some("form"), None] {
        let mut connection = connection("manual");
        if let Some(mode) = mode {
            connection["httpApplication"]["loginMode"] = mode.into();
        } else {
            connection["httpApplication"]
                .as_object_mut()
                .unwrap()
                .remove("loginMode");
        }
        assert_eq!(
            ptisp_defaults::resource_grant(&connection, SOURCE),
            Some((API, &[WebsiteRequestClass::FetchXhr][..]))
        );
        let engine = engine(&connection, false, true, None, None);
        assert_eq!(
            decision(&engine, API, "fetch-xhr"),
            WebsitePermissionDecision::Allow
        );
        assert!(engine.permits_network_origin(SOURCE, API));
        assert_eq!(
            decision(&engine, SOURCE, "navigation"),
            WebsitePermissionDecision::Allow
        );
    }
}

#[test]
fn unrelated_missing_and_invalid_application_profiles_do_not_receive_the_grant() {
    for application in [
        Value::Null,
        json!({"version":1,"id":"generic-form"}),
        json!({"version":1,"id":"autodesk"}),
        json!({"version":1,"id":"PTISP"}),
        json!({"version":2,"id":"ptisp"}),
        json!({"version":"1","id":"ptisp"}),
        json!({"id":"ptisp"}),
        json!({"version":1,"id":"ptisp","invalid":false}),
    ] {
        let connection = json!({"httpApplication":application});
        assert!(ptisp_defaults::resource_grant(&connection, SOURCE).is_none());
        assert!(!engine(&connection, false, true, None, None).permits_network_origin(SOURCE, API));
    }
    assert!(ptisp_defaults::resource_grant(&json!({}), SOURCE).is_none());
}

#[test]
fn source_must_be_the_exact_reviewed_canonical_https_origin() {
    for source in [
        "http://my.ptisp.pt",
        "https://my.ptisp.pt:8443",
        "https://my.ptisp.pt.",
        "https://my.ptisp.pt.attacker.test",
        "https://other.ptisp.pt",
        API,
        "https://my.ptisp.pt/login",
        "https://my.ptisp.pt?fixture=1",
        "null",
    ] {
        assert!(
            ptisp_defaults::resource_grant(&connection("manual"), source).is_none(),
            "{source}"
        );
    }
    let source = url::Url::parse("https://MY.PTISP.PT:443/login").unwrap();
    assert!(ptisp_defaults::resource_grant(
        &connection("form"),
        &source.origin().ascii_serialization()
    )
    .is_some());
}

#[test]
fn api_default_never_grants_navigation_frames_scripts_workers_or_other_transports() {
    let engine = engine(&connection("manual"), false, true, None, None);
    for class in [
        "navigation",
        "frame",
        "script",
        "stylesheet",
        "font",
        "image-media",
        "worker",
        "websocket",
        "unknown",
    ] {
        assert_eq!(
            decision(&engine, API, class),
            WebsitePermissionDecision::Deny,
            "{class}"
        );
    }
    for destination in [
        "http://api3.ptisp.pt",
        "https://api3.ptisp.pt:8443",
        "https://api3.ptisp.pt.",
        "https://api3.ptisp.pt.attacker.test",
        "https://api4.ptisp.pt",
        "https://api.ptisp.pt",
    ] {
        assert!(
            !engine.permits_network_origin(SOURCE, destination),
            "{destination}"
        );
    }
    assert_eq!(
        decision(&engine, "https://api3.ptisp.pt:443", "fetch-xhr"),
        WebsitePermissionDecision::Allow
    );
}

#[test]
fn same_origin_only_and_disabled_cross_origin_capability_keep_denial() {
    for mode in ["manual", "form"] {
        for (same_origin, cross_origin) in [(true, true), (false, false), (true, false)] {
            let engine = engine(&connection(mode), same_origin, cross_origin, None, None);
            assert_eq!(
                decision(&engine, API, "fetch-xhr"),
                WebsitePermissionDecision::Deny
            );
            assert!(!engine.permits_network_origin(SOURCE, API));
            assert_eq!(
                decision(&engine, SOURCE, "navigation"),
                WebsitePermissionDecision::Allow
            );
        }
    }
}

#[test]
fn shared_and_connection_class_or_destination_denies_override_the_default() {
    for row in [
        json!({"origin":SOURCE,"requestClasses":{"fetch-xhr":"deny"}}),
        json!({"origin":SOURCE,"destinations":[{"origin":API,"requestClasses":{"fetch-xhr":"deny"}}]}),
    ] {
        let rules: WebsiteDomainPermissionsSettings =
            serde_json::from_value(json!({"version":1,"websites":[row]})).unwrap();
        for (shared, own) in [(Some(&rules), None), (None, Some(&rules))] {
            for mode in ["manual", "form"] {
                let engine = engine(&connection(mode), false, true, shared, own);
                assert_eq!(
                    decision(&engine, API, "fetch-xhr"),
                    WebsitePermissionDecision::Deny
                );
                assert!(!engine.permits_network_origin(SOURCE, API));
            }
        }
    }
}

#[test]
fn native_denial_and_foreign_initiating_website_remain_denied() {
    let engine = engine(&connection("form"), false, true, None, None);
    for (website, denied) in [(SOURCE, true), ("https://other.ptisp.pt", false)] {
        assert_eq!(
            engine
                .resolve(WebsitePermissionQuery {
                    website_origin: website,
                    destination_origin: API,
                    request_class: "fetch-xhr",
                    native_denied: denied,
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
    }
}

#[test]
fn authority_installs_default_once_inside_same_origin_gate_before_normal_resolution() {
    let source = include_str!("../../../src/origin_browser_authority.rs");
    let compiler = source
        .split("fn saved_permissions_inner(")
        .nth(1)
        .unwrap()
        .split("enum ProxyKind")
        .next()
        .unwrap();
    let call = "ptisp_defaults::resource_grant(connection, &origin)";
    assert_eq!(source.matches(call).count(), 1);
    let gate = compiler.find("if !same_origin {").unwrap();
    let invocation = compiler.find(call).unwrap();
    let resolver = compiler.find("WebsitePermissionEngine::new").unwrap();
    assert!(gate < invocation && invocation < resolver);
    let gated = &compiler[gate..invocation];
    assert_eq!(gated.matches('{').count(), gated.matches('}').count() + 1);
    assert!(compiler[invocation..].starts_with(&format!("{call} {{\n            grant(")));
    assert!(source.contains(
        ".restrict_cross_origin_requests(preferences.capabilities.cross_origin_requests_enabled)"
    ));
    let login = source
        .split("fn saved_login(")
        .nth(1)
        .unwrap()
        .split("fn ")
        .next()
        .unwrap();
    assert!(login.contains("vec![policy.source_origin().to_owned()]"));
    assert!(!login.contains("ptisp_defaults"));
}
