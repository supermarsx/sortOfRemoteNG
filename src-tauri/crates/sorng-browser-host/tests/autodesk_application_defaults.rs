//! Production Autodesk helper + real permission resolver; no CEF/live requests.
#[path = "../../../src/origin_browser_autodesk_defaults.rs"]
mod autodesk_defaults;

use serde_json::{json, Value};
use sorng_browser_host::domain_permissions::{
    WebsiteDomainPermissionsSettings, WebsiteNetworkPolicy, WebsitePermissionDecision,
    WebsitePermissionEngine, WebsitePermissionQuery, WebsiteRequestClass,
};
use std::collections::BTreeMap;

const SOURCE: &str = "https://manage.autodesk.com";
const CFP: &str = "https://prd-cfp.autodesk.com";

fn connection() -> Value {
    json!({"httpApplication":{"version":1,"id":"autodesk","loginMode":"manual"}})
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
        if let Some((destination, classes)) = autodesk_defaults::resource_grant(connection, SOURCE)
        {
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
fn missing_profile_reproduces_bootstrap_denial_and_reviewed_profile_allows_scripts() {
    let ordinary = engine(&json!({}), false, true, None, None);
    assert_eq!(
        decision(&ordinary, CFP, "script"),
        WebsitePermissionDecision::Deny
    );
    assert!(!ordinary.permits_network_origin(SOURCE, CFP));
    assert_eq!(
        autodesk_defaults::resource_grant(&connection(), SOURCE),
        Some((CFP, &[WebsiteRequestClass::Script][..]))
    );
    let reviewed = engine(&connection(), false, true, None, None);
    for path in [
        "/cfp-vendors/current/main.js",
        "/cfp-runtime/current/main.js",
    ] {
        let url = url::Url::parse(&format!("{CFP}{path}")).unwrap();
        let destination = url.origin().ascii_serialization();
        assert_eq!(
            decision(&reviewed, &destination, "script"),
            WebsitePermissionDecision::Allow
        );
        assert!(reviewed.permits_network_origin(SOURCE, &destination));
    }
    assert_eq!(
        decision(&reviewed, SOURCE, "navigation"),
        WebsitePermissionDecision::Allow
    );
}

#[test]
fn resource_default_does_not_depend_on_password_or_automatic_login_consent() {
    let mut row = connection();
    for mode in [Some("manual"), Some("form"), None] {
        if let Some(mode) = mode {
            row["httpApplication"]["loginMode"] = mode.into();
        } else {
            row["httpApplication"]
                .as_object_mut()
                .unwrap()
                .remove("loginMode");
        }
        assert_eq!(
            autodesk_defaults::resource_grant(&row, SOURCE),
            Some((CFP, &[WebsiteRequestClass::Script][..]))
        );
    }
}

#[test]
fn unrelated_missing_and_invalid_profiles_get_no_resource_grant() {
    for application in [
        Value::Null,
        json!({"version":1,"id":"generic-form"}),
        json!({"version":1,"id":"ptisp"}),
        json!({"version":1,"id":"Autodesk"}),
        json!({"version":2,"id":"autodesk"}),
        json!({"version":"1","id":"autodesk"}),
        json!({"id":"autodesk"}),
        json!({"version":1,"id":"autodesk","invalid":false}),
    ] {
        let row = json!({"httpApplication":application});
        assert!(autodesk_defaults::resource_grant(&row, SOURCE).is_none());
        assert!(!engine(&row, false, true, None, None).permits_network_origin(SOURCE, CFP));
    }
}

#[test]
fn source_must_be_the_exact_reviewed_canonical_https_origin() {
    for source in [
        "http://manage.autodesk.com",
        "https://manage.autodesk.com:8443",
        "https://manage.autodesk.com.",
        "https://manage.autodesk.com.attacker.test",
        "https://auth.autodesk.com",
        "https://signin.autodesk.com",
        CFP,
        "https://manage.autodesk.com/home",
        "https://manage.autodesk.com?fixture=1",
        "null",
    ] {
        assert!(
            autodesk_defaults::resource_grant(&connection(), source).is_none(),
            "{source}"
        );
    }
    let url = url::Url::parse("https://MANAGE.AUTODESK.COM:443/home").unwrap();
    assert!(
        autodesk_defaults::resource_grant(&connection(), &url.origin().ascii_serialization())
            .is_some()
    );
}

#[test]
fn cfp_never_gains_document_fetch_worker_or_unreviewed_origin_authority() {
    let reviewed = engine(&connection(), false, true, None, None);
    for class in [
        "navigation",
        "frame",
        "fetch-xhr",
        "stylesheet",
        "font",
        "image-media",
        "worker",
        "websocket",
        "unknown",
    ] {
        assert_eq!(
            decision(&reviewed, CFP, class),
            WebsitePermissionDecision::Deny,
            "{class}"
        );
    }
    for destination in [
        "http://prd-cfp.autodesk.com",
        "https://prd-cfp.autodesk.com:8443",
        "https://prd-cfp.autodesk.com.",
        "https://prd-cfp.autodesk.com.attacker.test",
        "https://stg-cfp.autodesk.com",
        "https://dev-cfp.autodesk.com",
        "https://cfp-mfe-prd.autodesk.com",
        "https://auth.autodesk.com",
        "https://idp.auth.autodesk.com",
        "https://developer.api.autodesk.com",
        "https://ase-cdn.autodesk.com",
        "https://swc.autodesk.com",
    ] {
        assert!(
            !reviewed.permits_network_origin(SOURCE, destination),
            "{destination}"
        );
    }
    assert_eq!(
        decision(&reviewed, "https://prd-cfp.autodesk.com:443", "script"),
        WebsitePermissionDecision::Allow
    );
}

#[test]
fn same_origin_only_and_disabled_cross_origin_capability_keep_denial() {
    for (same_origin, cross_origin) in [(true, true), (false, false), (true, false)] {
        let restricted = engine(&connection(), same_origin, cross_origin, None, None);
        assert_eq!(
            decision(&restricted, CFP, "script"),
            WebsitePermissionDecision::Deny
        );
        assert!(!restricted.permits_network_origin(SOURCE, CFP));
        assert_eq!(
            decision(&restricted, SOURCE, "navigation"),
            WebsitePermissionDecision::Allow
        );
    }
}

#[test]
fn shared_and_connection_class_or_destination_denies_override_the_default() {
    for row in [
        json!({"origin":SOURCE,"requestClasses":{"script":"deny"}}),
        json!({"origin":SOURCE,"destinations":[{"origin":CFP,"requestClasses":{"script":"deny"}}]}),
    ] {
        let rules: WebsiteDomainPermissionsSettings =
            serde_json::from_value(json!({"version":1,"websites":[row]})).unwrap();
        for (shared, own) in [(Some(&rules), None), (None, Some(&rules))] {
            let restricted = engine(&connection(), false, true, shared, own);
            assert_eq!(
                decision(&restricted, CFP, "script"),
                WebsitePermissionDecision::Deny
            );
            assert!(!restricted.permits_network_origin(SOURCE, CFP));
        }
    }
}

#[test]
fn native_denial_and_foreign_initiating_website_remain_denied() {
    let reviewed = engine(&connection(), false, true, None, None);
    for (website, denied) in [(SOURCE, true), ("https://other.autodesk.com", false)] {
        assert_eq!(
            reviewed
                .resolve(WebsitePermissionQuery {
                    website_origin: website,
                    destination_origin: CFP,
                    request_class: "script",
                    native_denied: denied,
                })
                .decision,
            WebsitePermissionDecision::Deny
        );
    }
}
