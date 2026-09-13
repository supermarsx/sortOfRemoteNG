//! Native-owned provider cookie continuity, deliberately separate from source
//! cookies even when both purposes happen to use the same exact origin.
use super::*;

fn provider_headers(value: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("set-cookie", value.parse().unwrap());
    headers
}

#[test]
fn provider_cookies_survive_only_consumed_attempt_transfer_and_never_enter_website_jar() {
    let global = Url::parse("https://global.quickconnect.to/Serv.php").unwrap();
    let mut registry = AttemptRegistry::default();
    let first = start(
        &mut registry,
        &config("https://global.quickconnect.to/"),
        "global-first",
    );
    set(
        &first,
        global.as_str(),
        "website=private-website; Path=/; Secure",
    );
    first
        .store_provider_control_cookies(
            "example",
            &global,
            &provider_headers("control=provider-private; Domain=quickconnect.to; Path=/; Secure"),
        )
        .unwrap();
    assert_eq!(
        first
            .provider_control_cookie_header("example", &global)
            .unwrap()
            .unwrap(),
        "control=provider-private"
    );
    assert_eq!(cookies(&first, global.as_str()), "website=private-website");
    let regional = transfer(
        &mut registry,
        &first,
        "https://example.fr3.quickconnect.to/",
        "regional-next",
    );
    assert!(first
        .provider_control_cookie_header("example", &global)
        .is_err());
    assert!(first
        .store_provider_control_cookies(
            "example",
            &global,
            &provider_headers("control=stale; Path=/")
        )
        .is_err());
    assert_eq!(
        regional
            .provider_control_cookie_header("example", &global)
            .unwrap()
            .unwrap(),
        "control=provider-private"
    );
    assert!(regional
        .provider_control_cookie_header("other-nas", &global)
        .is_err());
    assert!(regional
        .provider_control_cookie_header(
            "example",
            &Url::parse("https://dec.quickconnect.to/Serv.php").unwrap()
        )
        .unwrap()
        .is_none());
    let returned = transfer(
        &mut registry,
        &regional,
        "https://global.quickconnect.to/",
        "global-returned",
    );
    assert_eq!(
        cookies(&returned, global.as_str()),
        "website=private-website"
    );
    assert_eq!(
        returned
            .provider_control_cookie_header("example", &global)
            .unwrap()
            .unwrap(),
        "control=provider-private"
    );
    registry.stop(&returned, None).unwrap();
    assert!(returned
        .provider_control_cookie_header("example", &global)
        .is_err());
    let fresh = start(
        &mut registry,
        &config("https://global.quickconnect.to/"),
        "global-fresh",
    );
    assert!(fresh
        .provider_control_cookie_header("example", &global)
        .unwrap()
        .is_none());
    assert!(cookies(&fresh, global.as_str()).is_empty());
}

#[test]
fn abandoned_transfer_and_different_native_attempt_cannot_reuse_provider_cookies() {
    let global = Url::parse("https://global.quickconnect.to/Serv.php").unwrap();
    let mut registry = AttemptRegistry::default();
    let source = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "source",
    );
    source
        .store_provider_control_cookies(
            "example",
            &global,
            &provider_headers("control=one; Path=/"),
        )
        .unwrap();
    let independent = start(
        &mut registry,
        &config("https://example.quickconnect.to/"),
        "independent",
    );
    assert!(independent
        .provider_control_cookie_header("example", &global)
        .unwrap()
        .is_none());
    let ticket = registry
        .prepare_transfer(
            &source,
            &Url::parse("https://global.quickconnect.to/").unwrap(),
            "native-reviewed",
        )
        .unwrap();
    assert_eq!(registry.cancel(&ticket), Some("source".into()));
    assert!(source
        .provider_control_cookie_header("example", &global)
        .is_err());
    assert!(source
        .store_provider_control_cookies(
            "example",
            &global,
            &provider_headers("control=late; Path=/")
        )
        .is_err());
    assert!(independent
        .provider_control_cookie_header("example", &global)
        .unwrap()
        .is_none());
}
