use super::*;
use axum::http::{HeaderMap, HeaderValue};

const SOURCE: &str = "https://example.quickconnect.to";
const TARGET: &str = "https://example.fr3.quickconnect.to/";

fn origin(headers: &HeaderMap, html: &str, target: &str) -> Option<String> {
    DocumentReferrerPolicy::from_response(headers, html)
        .origin(SOURCE, &reqwest::Url::parse(target).unwrap())
}

#[test]
fn referrer_headers_use_last_known_policy_and_never_copy_paths_or_downgrade() {
    let mut headers = HeaderMap::new();
    assert_eq!(
        origin(&headers, "", TARGET).as_deref(),
        Some("https://example.quickconnect.to/")
    );
    headers.append(
        "referrer-policy",
        HeaderValue::from_static("no-referrer, unknown"),
    );
    assert_eq!(origin(&headers, "", TARGET), None);
    headers.append(
        "referrer-policy",
        HeaderValue::from_static("origin, future-policy"),
    );
    assert!(origin(&headers, "", TARGET).is_some());
    headers.insert("referrer-policy", HeaderValue::from_static("same-origin"));
    assert_eq!(origin(&headers, "", TARGET), None);
    assert_eq!(
        origin(
            &headers,
            "",
            "https://example.quickconnect.to/private?never-copy=secret"
        )
        .as_deref(),
        Some("https://example.quickconnect.to/")
    );
    headers.insert("referrer-policy", HeaderValue::from_static("unsafe-url"));
    assert_eq!(
        origin(&headers, "", "http://example.quickconnect.to/"),
        None
    );
    assert_eq!(
        DocumentReferrerPolicy::OriginAllowed.origin(
            "https://example.quickconnect.to/private",
            &reqwest::Url::parse(TARGET).unwrap()
        ),
        None
    );
}

#[test]
fn only_active_static_referrer_meta_tightens_native_policy() {
    let headers = HeaderMap::new();
    for html in [
        "<head><meta name=referrer content=no-referrer></head>",
        "<body><META CONTENT='same-origin' NAME='REFERRER'></body>",
        "<template><body></body></template><meta name=referrer content=no-referrer>",
        "<meta name=referrer content='no&#45;referrer'>",
        "<meta name='refe&#114;rer' content='no-referrer'>",
        "<meta name=referrer name=description content=no-referrer>",
    ] {
        assert_eq!(origin(&headers, html, TARGET), None, "{html}");
    }
    for html in [
        "<!-- <meta name=referrer content=no-referrer> -->",
        "<script>const example='<meta name=referrer content=no-referrer>';</script>",
        "<template><body><meta name=referrer content=no-referrer></body></template>",
        "<textarea><meta name=referrer content=no-referrer></textarea>",
        "<meta name=description content='referrer policy no-referrer'>",
        "<meta name=referrer content=unknown-future-policy>",
    ] {
        assert!(origin(&headers, html, TARGET).is_some(), "{html}");
    }
    let headers = HeaderMap::from_iter([(
        axum::http::HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    )]);
    assert_eq!(
        origin(&headers, "<meta name=referrer content=unsafe-url>", TARGET),
        None
    );
}

#[test]
fn document_referrer_snapshot_requires_current_issued_native_document() {
    let state = ProxyNetworkState::default();
    let target = reqwest::Url::parse(TARGET).unwrap();
    state.record_document_referrer(1, &HeaderMap::new(), "");
    state.document_issued(1, true);
    assert_eq!(state.selected_document_sequence(), Some(1));
    assert_eq!(state.selected_referrer_document_sequence(), None);
    assert_eq!(state.document_referrer_origin(1, &target, SOURCE), None);
    state.record_document_referrer(1, &HeaderMap::new(), "");
    assert_eq!(state.selected_referrer_document_sequence(), Some(1));
    assert!(state.document_referrer_origin(1, &target, SOURCE).is_some());
    state.document_issued(2, false);
    state.record_document_referrer(
        2,
        &HeaderMap::new(),
        "<meta name=referrer content=no-referrer>",
    );
    assert!(state.document_referrer_origin(1, &target, SOURCE).is_some());
    assert_eq!(state.document_referrer_origin(2, &target, SOURCE), None);
    state.activate_document(2).unwrap();
    assert_eq!(state.selected_referrer_document_sequence(), Some(2));
    assert_eq!(state.document_referrer_origin(1, &target, SOURCE), None);
    assert_eq!(state.document_referrer_origin(2, &target, SOURCE), None);
    state.revoke();
    assert_eq!(state.selected_referrer_document_sequence(), None);
    assert!(state
        .with_selected_document_referrer_origin(&target, SOURCE, None, |value| value)
        .is_err());
}
