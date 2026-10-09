use super::*;

const SOURCE: &str = "https://source.example";
const NEW: &str = "https://new.example";

fn network(all: bool, scripts: bool) -> WebsiteNetworkPolicy {
    WebsiteNetworkPolicy {
        source_origin: SOURCE.into(),
        destination_defaults: BTreeMap::from([(
            SOURCE.into(),
            BTreeMap::from([
                (
                    WebsiteRequestClass::Navigation,
                    WebsitePermissionDecision::Allow,
                ),
                (
                    WebsiteRequestClass::Script,
                    WebsitePermissionDecision::Allow,
                ),
            ]),
        )]),
        allow_all_requests: all,
        allow_all_scripts: scripts,
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
fn broad_defaults_and_script_only_do_not_change_the_known_origin_defaults() {
    use WebsitePermissionDecision::*;
    for (all, scripts) in [(false, false), (true, false), (false, true)] {
        let e = engine(network(all, scripts));
        assert_eq!(
            decision(&e, NEW, "script"),
            if all || scripts { Allow } else { Deny }
        );
        assert_eq!(
            decision(&e, "http://new.example", "script"),
            if all { Allow } else { Deny }
        );
        for class in [
            "stylesheet",
            "font",
            "image-media",
            "fetch-xhr",
            "frame",
            "worker",
            "websocket",
            "navigation",
        ] {
            assert_eq!(decision(&e, NEW, class), if all { Allow } else { Deny });
        }
        assert_eq!(decision(&e, SOURCE, "navigation"), Allow);
        assert_eq!(decision(&e, NEW, "unmapped-resource"), Deny);
        assert_eq!(
            e.resolve(WebsitePermissionQuery {
                website_origin: SOURCE,
                destination_origin: NEW,
                request_class: "script",
                native_denied: true
            })
            .decision,
            Deny
        );
        assert_eq!(
            e.resolve(WebsitePermissionQuery {
                website_origin: NEW,
                destination_origin: NEW,
                request_class: "script",
                native_denied: false
            })
            .decision,
            Deny
        );
    }
}

#[test]
fn explicit_domain_rules_keep_precedence_over_broad_defaults() {
    use WebsitePermissionDecision::*;
    let shared: WebsiteDomainPermissionsSettings = serde_json::from_value(serde_json::json!({"version":1,"websites":[{
        "origin":SOURCE,"requestClasses":{"script":"deny"},"destinations":[{"origin":NEW,"requestClasses":{"fetch-xhr":"deny"}}]
    }]})).unwrap();
    let own: WebsiteDomainPermissionsSettings = serde_json::from_value(serde_json::json!({"version":1,"websites":[{
        "origin":SOURCE,"requestClasses":{"image-media":"deny"},"destinations":[{"origin":NEW,"requestClasses":{"script":"allow","navigation":"deny"}}]
    }]})).unwrap();
    let e = WebsitePermissionEngine::new(Some(&shared), Some(&own), &BTreeMap::new())
        .unwrap()
        .with_network_policy(network(true, false))
        .unwrap();
    assert_eq!(decision(&e, NEW, "script"), Allow); // explicit connection override
    assert_eq!(decision(&e, "https://unknown.example", "script"), Deny);
    for class in ["fetch-xhr", "image-media", "navigation"] {
        assert_eq!(decision(&e, NEW, class), Deny);
    }
    assert_eq!(decision(&e, "https://unknown.example", "navigation"), Allow);
    let mut p = network(true, true);
    p.destination_defaults.insert(
        "https://static.example".into(),
        BTreeMap::from([(WebsiteRequestClass::Script, Allow)]),
    );
    let e = WebsitePermissionEngine::new(Some(&shared), Some(&own), &BTreeMap::new())
        .unwrap()
        .with_network_policy(p)
        .unwrap();
    assert_eq!(decision(&e, "https://static.example", "script"), Deny);
    assert_eq!(decision(&e, "https://static.example", "image-media"), Deny);
}

#[test]
fn existing_class_allow_without_broad_defaults_does_not_create_new_routes() {
    let shared: WebsiteDomainPermissionsSettings =
        serde_json::from_value(serde_json::json!({"version":1,"websites":[{
            "origin":SOURCE,"requestClasses":{"navigation":"allow","script":"allow"}
        }]}))
        .unwrap();
    let e = WebsitePermissionEngine::new(Some(&shared), None, &BTreeMap::new())
        .unwrap()
        .with_network_policy(network(false, false))
        .unwrap();
    assert!(!e.permits_network_origin(SOURCE, NEW));
    let e = WebsitePermissionEngine::new(Some(&shared), None, &BTreeMap::new())
        .unwrap()
        .with_network_policy(network(false, true))
        .unwrap();
    assert_eq!(
        decision(&e, NEW, "navigation"),
        WebsitePermissionDecision::Deny
    );
    assert_eq!(
        decision(&e, NEW, "script"),
        WebsitePermissionDecision::Allow
    );
}

#[test]
fn https_same_origin_capability_and_downgrade_constraints_are_not_bypassed() {
    use WebsitePermissionDecision::*;
    let e = engine(network(true, false));
    assert_eq!(decision(&e, "http://new.example", "fetch-xhr"), Allow);
    assert_eq!(decision(&e, "http://new.example", "navigation"), Deny);
    assert_eq!(decision(&e, "http://new.example", "frame"), Deny);
    let e = engine(WebsiteNetworkPolicy {
        allow_http_downgrade: true,
        ..network(true, false)
    });
    assert_eq!(decision(&e, "http://new.example", "navigation"), Allow);
    let e = engine(WebsiteNetworkPolicy {
        allow_http_downgrade: true,
        https_only: true,
        ..network(true, false)
    });
    assert!(!e.permits_network_origin(SOURCE, "http://new.example"));
    let e = engine(WebsiteNetworkPolicy {
        same_origin_only: true,
        ..network(true, false)
    });
    assert!(!e.permits_network_origin(SOURCE, NEW));
    assert_eq!(decision(&e, SOURCE, "navigation"), Allow);
    let e = engine(network(true, false))
        .restrict_cross_origin_requests(false)
        .restrict_cross_origin_requests(true);
    assert!(!e.permits_network_origin(SOURCE, NEW));
    assert_eq!(decision(&e, SOURCE, "navigation"), Allow);
}

#[test]
fn broad_defaults_exclude_unsafe_and_local_destinations_without_blocking_reviewed_lan() {
    let e = engine(network(true, false));
    for origin in [
        "file:///tmp/file",
        "ftp://new.example",
        "wss://new.example",
        "https://user:pw@new.example",
        "https://new.example/path",
        "https://new.example:0",
        "http://localhost:3001",
        "https://x.localhost",
        "https://127.0.0.1",
        "http://[::1]",
        "https://[::ffff:127.0.0.1]",
        "http://0.0.0.0",
        "https://[::]",
    ] {
        assert!(!e.permits_network_origin(SOURCE, origin), "{origin}");
    }
    assert!(e.permits_network_origin(SOURCE, "https://192.168.1.1"));
    let mut p = network(true, false);
    p.destination_defaults.insert(
        "https://127.0.0.1:8443".into(),
        BTreeMap::from([(
            WebsiteRequestClass::Navigation,
            WebsitePermissionDecision::Allow,
        )]),
    );
    assert!(engine(p).permits_network_origin(SOURCE, "https://127.0.0.1:8443"));
}

#[test]
fn script_cdn_static_defaults_do_not_acquire_other_classes_without_broad_requests() {
    let mut p = network(false, true);
    p.destination_defaults.insert(
        NEW.into(),
        BTreeMap::from([(
            WebsiteRequestClass::Script,
            WebsitePermissionDecision::Allow,
        )]),
    );
    let e = engine(p.clone());
    assert_eq!(
        decision(&e, NEW, "navigation"),
        WebsitePermissionDecision::Deny
    );
    p.allow_all_requests = true;
    let e = engine(p);
    assert_eq!(
        decision(&e, NEW, "navigation"),
        WebsitePermissionDecision::Allow
    );
}
