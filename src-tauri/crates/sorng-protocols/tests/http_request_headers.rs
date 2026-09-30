//! Standalone header contract tests; no native application build is required.
//! rustc --edition=2021 --test tests/http_request_headers.rs -o <temp>/headers.exe
//! Actual forwarding paths are covered by src/http_request_header_tests.rs.

#[path = "../src/http_request_headers.rs"]
mod request_headers;

use request_headers::{is_cloudflare_browser_header, is_hop_by_hop};

#[test]
fn strips_standard_and_legacy_connection_fields_case_insensitively() {
    for name in [
        "Connection",
        "Keep-Alive",
        "Proxy-Connection",
        "Proxy-Authenticate",
        "Proxy-Authorization",
        "TE",
        "Trailer",
        "Transfer-Encoding",
        "Upgrade",
    ] {
        assert!(is_hop_by_hop(name, []), "{name}");
    }
}

#[test]
fn strips_options_from_every_connection_line_with_exact_case_insensitive_matching() {
    let values = [
        b"keep-alive, X-Local-Only".as_slice(),
        b"\tSec-CH-UA-Arch , , x-other\t",
    ];
    for name in ["x-local-only", "SEC-CH-UA-ARCH", "X-Other"] {
        assert!(is_hop_by_hop(name, values), "{name}");
    }
    for name in ["x-local", "x-local-only-extra", "sec-ch-ua", "other"] {
        assert!(!is_hop_by_hop(name, values), "{name}");
    }
}

#[test]
fn a_non_ascii_option_does_not_hide_other_connection_options() {
    let values = [b"\xff, x-private".as_slice(), b"x-second, \xfe"];
    assert!(is_hop_by_hop("x-private", values));
    assert!(is_hop_by_hop("x-second", values));
    assert!(!is_hop_by_hop("user-agent", values));
}

#[test]
fn ordinary_end_to_end_fields_are_not_classified_as_hop_headers() {
    for name in [
        "user-agent",
        "sec-ch-ua",
        "sec-ch-ua-full-version-list",
        "sec-fetch-site",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-user",
        "accept",
        "accept-language",
        "origin",
        "referer",
        "cookie",
        "authorization",
        "content-type",
        "content-length",
        "accept-encoding",
        "range",
        "if-none-match",
        "x-sorng-google-credentials",
    ] {
        assert!(!is_hop_by_hop(name, []), "{name}");
    }
}

#[test]
fn challenge_preserves_actual_ua_and_all_known_ua_hints_without_changing_values() {
    let incoming = [
        ("User-Agent", "Native-WebView-Fixture/1"),
        (
            "sec-ch-ua",
            "\"Native WebView\";v=\"1\", \"Not;A=Brand\";v=\"99\"",
        ),
        ("sec-ch-ua-mobile", "?0"),
        ("sec-ch-ua-platform", "\"Windows\""),
        ("sec-ch-ua-arch", "\"x86\""),
        ("sec-ch-ua-bitness", "\"64\""),
        ("sec-ch-ua-form-factors", "\"Desktop\""),
        ("sec-ch-ua-full-version", "\"1.2.3.4\""),
        (
            "sec-ch-ua-full-version-list",
            "\"Native WebView\";v=\"1.2.3.4\"",
        ),
        ("sec-ch-ua-model", "\"\""),
        ("sec-ch-ua-platform-version", "\"19.0.0\""),
        ("sec-ch-ua-wow64", "?0"),
    ];
    let forwarded: Vec<_> = incoming
        .into_iter()
        .filter(|(name, _)| is_cloudflare_browser_header(name))
        .collect();
    assert_eq!(forwarded, incoming);
}

#[test]
fn challenge_keeps_its_existing_non_identity_allowlist() {
    for name in [
        "accept",
        "Accept-Language",
        "content-type",
        "access-control-request-method",
        "access-control-request-headers",
    ] {
        assert!(is_cloudflare_browser_header(name), "{name}");
    }
}

#[test]
fn challenge_does_not_widen_cookie_auth_origin_or_fetch_metadata_policies() {
    for name in [
        "cookie",
        "authorization",
        "proxy-authorization",
        "x-api-key",
        "x-dashboard-secret",
        "origin",
        "referer",
        "host",
        "connection",
        "content-length",
        "accept-encoding",
        "if-none-match",
        "range",
        "sec-fetch-site",
        "sec-fetch-mode",
        "sec-fetch-dest",
        "sec-fetch-user",
        "sec-ch-ua-secret",
        "sec-ch-ua-platform-version-extra",
        "x-sorng-google-credentials",
    ] {
        assert!(!is_cloudflare_browser_header(name), "{name}");
    }
}

#[test]
fn connection_nominated_fields_take_precedence_over_the_challenge_allowlist() {
    let incoming = [
        ("connection", "sec-ch-ua-arch, accept-language"),
        ("user-agent", "native"),
        ("sec-ch-ua-arch", "\"x86\""),
        ("accept-language", "en-GB"),
        ("cookie", "dashboard-secret=1"),
    ];
    let forwarded: Vec<_> = incoming
        .into_iter()
        .filter(|(name, _)| {
            !is_hop_by_hop(name, [incoming[0].1.as_bytes()]) && is_cloudflare_browser_header(name)
        })
        .collect();
    assert_eq!(forwarded, [("user-agent", "native")]);
}

#[test]
fn no_ua_or_client_hints_are_invented_when_the_webview_does_not_send_them() {
    let incoming = [("accept", "text/html"), ("cookie", "local-only=1")];
    let forwarded: Vec<_> = incoming
        .into_iter()
        .filter(|(name, _)| is_cloudflare_browser_header(name))
        .collect();
    assert_eq!(forwarded, [("accept", "text/html")]);
}
