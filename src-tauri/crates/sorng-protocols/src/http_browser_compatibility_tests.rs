use super::BrowserCompatibility;
use crate::http::{
    network, proxy_response, BasicAuthProxyConfig, HttpProxyPolicy, ProxyNetworkState,
};
use serde_json::{json, Value};

fn legacy_config() -> Value {
    json!({"target_url":"https://device.test/","username":"","password":""})
}

fn manifest(script: &str) -> Value {
    serde_json::from_str(
        script
            .split_once("var sorngNetworkClient=installWebNetworkClient(")
            .unwrap()
            .1
            .split_once(",function(detail)")
            .unwrap()
            .0,
    )
    .unwrap()
}

#[test]
fn browser_compatibility_is_optional_strict_and_default_false() {
    let legacy: BasicAuthProxyConfig = serde_json::from_value(legacy_config()).unwrap();
    assert_eq!(
        legacy.browser_compatibility,
        BrowserCompatibility::default()
    );
    for options in [
        json!({}),
        json!({"hide_webdriver": false}),
        json!({"hide_webdriver": true}),
    ] {
        let mut input = legacy_config();
        input["browser_compatibility"] = options.clone();
        let config: BasicAuthProxyConfig = serde_json::from_value(input).unwrap();
        assert_eq!(
            config.browser_compatibility.hide_webdriver,
            options["hide_webdriver"].as_bool().unwrap_or(false)
        );
        assert!(config.verify_ssl);
        assert!(!config.require_ca_verification);
        assert!(config.accepted_cert_fingerprint.is_none());
        assert!(config.proxy_policy.is_none());
    }
    for options in [
        Value::Null,
        json!(true),
        json!({"hide_webdriver": "true"}),
        json!({"hide_webdriver": 1}),
        json!({"hide_webdriver": null}),
        json!({"hideWebdriver": true}),
        json!({"hide_webdriver": true, "allow_origins": ["https://foreign.test"]}),
    ] {
        let mut input = legacy_config();
        input["browser_compatibility"] = options;
        assert!(serde_json::from_value::<BasicAuthProxyConfig>(input).is_err());
    }
}

#[test]
fn browser_compatibility_manifest_changes_only_the_explicit_page_preference() {
    let mut manifests = Vec::new();
    for hide_webdriver in [false, true] {
        let network = ProxyNetworkState::default()
            .with_browser_compatibility(BrowserCompatibility { hide_webdriver });
        let script = network::bootstrap(
            "fixture",
            1,
            None,
            "https://device.test",
            "http://p0123456789abcdef0123456789abcdef.localhost:43123",
            &HttpProxyPolicy::default(),
            None,
            None,
            None,
            None,
            None,
            false,
            network.browser_compatibility(),
        );
        let mut config = manifest(&script);
        assert_eq!(
            config
                .as_object_mut()
                .unwrap()
                .remove("browserCompatibility"),
            Some(json!({"hideWebdriver": hide_webdriver}))
        );
        manifests.push(config);
    }
    assert_eq!(manifests[0], manifests[1]);
    assert_eq!(manifests[0]["mappings"], json!([]));
    assert_eq!(
        ProxyNetworkState::default().browser_compatibility(),
        BrowserCompatibility::default()
    );
}

#[test]
fn browser_compatibility_survives_continuation_without_reusing_document_grants() {
    let source = ProxyNetworkState::default().with_browser_compatibility(BrowserCompatibility {
        hide_webdriver: true,
    });
    source.document_issued(7, true);
    let successor = source.successor();
    assert_eq!(
        successor.browser_compatibility(),
        source.browser_compatibility()
    );
    assert!(successor.activate_document(7).is_err());
    assert_eq!(successor.selected_document_sequence(), None);
}

#[test]
fn browser_compatibility_reaches_readiness_before_upstream_scripts() {
    let html = "<!doctype html><html><head><script>upstream()</script></head></html>";
    let rendered = proxy_response::inject_readiness(
        html,
        "fixture",
        None,
        1,
        proxy_response::ReadinessNetworkContext {
            source_origin: "https://device.test",
            proxy_origin: "http://p0123456789abcdef0123456789abcdef.localhost:43123",
            policy: &HttpProxyPolicy::default(),
            tactical_rmm_api: None,
            google: None,
            popup_parent_sequence: None,
            tactical_mesh: None,
            cloudflare_challenge: None,
            exchange_cookies: false,
            exchange_owa: false,
            browser_compatibility: BrowserCompatibility {
                hide_webdriver: true,
            },
        },
    );
    assert_eq!(
        manifest(&rendered)["browserCompatibility"],
        json!({"hideWebdriver": true})
    );
    assert!(
        rendered
            .find("var sorngNetworkClient=installWebNetworkClient(")
            .unwrap()
            < rendered.find("upstream()").unwrap()
    );
}
