use super::*;
use std::collections::BTreeSet;

const SOURCE: &str = "https://portal.example";
const ASSET: &str = "https://random.region.vendor.example";

fn rule() -> WebsiteResourceDomainDefault {
    WebsiteResourceDomainDefault {
        domain: "vendor.example".into(),
        request_classes: [
            WebsiteRequestClass::Script,
            WebsiteRequestClass::Stylesheet,
            WebsiteRequestClass::Frame,
            WebsiteRequestClass::FetchXhr,
            WebsiteRequestClass::ImageMedia,
        ]
        .into(),
    }
}

fn policy() -> WebsiteNetworkPolicy {
    WebsiteNetworkPolicy {
        source_origin: SOURCE.into(),
        resource_domain_defaults: vec![rule()],
        ..Default::default()
    }
}

fn engine(policy: WebsiteNetworkPolicy) -> WebsitePermissionEngine {
    WebsitePermissionEngine::new(None, None, &BTreeMap::new())
        .unwrap()
        .with_network_policy(policy)
        .unwrap()
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
fn resource_families_admit_only_https_base_and_dot_boundary_descendants_of_selected_classes() {
    let engine = engine(policy());
    for destination in [
        "https://vendor.example",
        "https://newassets.vendor.example",
        ASSET,
    ] {
        assert!(engine.permits_network_origin(SOURCE, destination));
        for class in ["script", "stylesheet", "frame", "fetch-xhr", "image-media"] {
            assert_eq!(
                decision(&engine, destination, class),
                WebsitePermissionDecision::Allow
            );
        }
        for class in ["font", "navigation", "worker", "websocket", "unknown"] {
            assert_eq!(
                decision(&engine, destination, class),
                WebsitePermissionDecision::Deny
            );
        }
    }
    for destination in [
        "https://evilvendor.example",
        "https://vendor.example.evil.test",
        "https://vendor.example:8443",
        "http://vendor.example",
        "wss://vendor.example",
        "https://localhost",
        "https://127.0.0.1",
        "https://[::1]",
        "https://user@vendor.example",
        "https://vendor.example/path",
        "https://vendor.example?secret=hidden",
        "https://vendor.example#fragment",
    ] {
        assert!(
            !engine.permits_network_origin(SOURCE, destination),
            "{destination}"
        );
    }
    assert!(!engine.permits_network_origin("https://other-portal.example", ASSET));
    assert_eq!(
        engine
            .resolve(WebsitePermissionQuery {
                website_origin: SOURCE,
                destination_origin: ASSET,
                request_class: "frame",
                native_denied: true
            })
            .decision,
        WebsitePermissionDecision::Deny
    );
}

#[test]
fn resource_families_preserve_native_constraints_and_explicit_connection_and_shared_denials() {
    for shared in [false, true] {
        for destination_specific in [false, true] {
            let settings: WebsiteDomainPermissionsSettings = serde_json::from_value(serde_json::json!({"version":1,"websites":[{
                "origin":SOURCE,"requestClasses":if destination_specific { serde_json::json!({}) } else { serde_json::json!({"frame":"deny"}) },
                "destinations":if destination_specific { serde_json::json!([{"origin":ASSET,"requestClasses":{"frame":"deny"}}]) } else { serde_json::json!([]) }
            }]})).unwrap();
            let e = WebsitePermissionEngine::new(
                if shared { Some(&settings) } else { None },
                if shared { None } else { Some(&settings) },
                &BTreeMap::new(),
            )
            .unwrap()
            .with_network_policy(policy())
            .unwrap();
            assert_eq!(
                decision(&e, ASSET, "frame"),
                WebsitePermissionDecision::Deny
            );
            assert_eq!(
                decision(&e, ASSET, "script"),
                WebsitePermissionDecision::Allow
            );
        }
    }
    let e = engine(WebsiteNetworkPolicy {
        same_origin_only: true,
        ..policy()
    });
    assert!(!e.permits_network_origin(SOURCE, ASSET));
    let e = engine(policy()).restrict_cross_origin_requests(false);
    assert!(!e.permits_network_origin(SOURCE, ASSET));
    let mut p = policy();
    p.destination_defaults.insert(
        ASSET.into(),
        [(WebsiteRequestClass::Frame, WebsitePermissionDecision::Deny)].into(),
    );
    assert_eq!(
        decision(&engine(p), ASSET, "frame"),
        WebsitePermissionDecision::Deny
    );
}

#[test]
fn resource_families_are_empty_by_default_and_invalid_rules_fail_before_installation() {
    assert!(!engine(WebsiteNetworkPolicy {
        source_origin: SOURCE.into(),
        ..Default::default()
    })
    .permits_network_origin(SOURCE, ASSET));
    for domain in [
        "",
        "com",
        "*.vendor.example",
        "Vendor.example",
        "vendor.example.",
        "https://vendor.example",
        "vendor.example:443",
        "vendor.example/path",
        "127.0.0.1",
        "sub.localhost",
        ".vendor.example",
        "x..vendor.example",
        "-x.vendor.example",
        "x_.vendor.example",
    ] {
        let mut p = policy();
        p.resource_domain_defaults[0].domain = domain.into();
        assert!(
            WebsitePermissionEngine::new(None, None, &BTreeMap::new())
                .unwrap()
                .with_network_policy(p)
                .is_err(),
            "{domain}"
        );
    }
    for class in [
        WebsiteRequestClass::Navigation,
        WebsiteRequestClass::Worker,
        WebsiteRequestClass::Websocket,
    ] {
        let mut p = policy();
        p.resource_domain_defaults[0].request_classes = BTreeSet::from([class]);
        assert!(WebsitePermissionEngine::new(None, None, &BTreeMap::new())
            .unwrap()
            .with_network_policy(p)
            .is_err());
    }
    for count in [0, 2, MAX_WEBSITE_PERMISSION_DESTINATIONS + 1] {
        let mut p = policy();
        if count == 0 {
            p.resource_domain_defaults[0].request_classes.clear();
        } else {
            p.resource_domain_defaults = vec![rule(); count];
        }
        assert!(WebsitePermissionEngine::new(None, None, &BTreeMap::new())
            .unwrap()
            .with_network_policy(p)
            .is_err());
    }
}
