//! Versioned QuickConnect navigation bridge. It only records a reviewed
//! destination; it never sends a request, forwards a body, or reads credentials.
use super::{proxy_request_headers_are_authorized, proxy_response, redirect, AxumProxyState};
use axum::body::Body;
use axum::http::{HeaderMap, Method, Response, StatusCode};
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub(super) const PATH: &str = "/__sortofremoteng_quickconnect_redirect_v1";
const MAX_DESTINATION_BYTES: usize = 4096;
const PREFIX: &str = "destination=";

/// Native-only observation marker; a receipt pause is not an upstream failure.
#[derive(Clone, Copy)]
pub(super) struct ReviewPending;

/// Presentation only, after the caller has recorded a real receipt. This does
/// not consume that receipt or authorize any destination connection.
pub(super) fn default_handoff(state: &AxumProxyState, destination: &reqwest::Url) -> bool {
    (!state.proxy_policy.https_only || destination.scheme() == "https")
        && state
            .proxy_policy
            .synology_quick_connect_defaults
            .as_ref()
            .is_some_and(|defaults| defaults.permits(&state.target_origin, destination))
}

pub(super) fn pending_response(state: &AxumProxyState, source: &str) -> Response<Body> {
    let theme = state
        .theme
        .read()
        .map(|theme| theme.clone())
        .unwrap_or_default();
    let title = "Preparing destination handoff";
    let detail = "The destination matches this connection's Synology defaults. Waiting for the app to finish certificate and connection checks. Any additional approval is shown in the app; no destination request or login transfer has been authorized by this page.";
    let bridge = crate::themed_errors::proxy_failure_bridge_script(
        &state.session_id,
        "redirect_review",
        202,
        title,
        source,
        detail,
        detail,
    );
    let html = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} — sortOfRemoteNG</title><style>{theme_css}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--proxy-bg);color:var(--proxy-text);font:16px system-ui,sans-serif}}main{{max-width:36rem;padding:2rem}}h1{{font-size:1.3rem}}p{{line-height:1.6;color:var(--proxy-text-2)}}</style></head><body><main role="status"><h1>{title}</h1><p>{detail}</p></main>{bridge}</body></html>"#,
        theme_css = theme.css_block()
    );
    Response::builder()
        .status(StatusCode::ACCEPTED)
        .extension(ReviewPending)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(html))
        .expect("static pending handoff response")
}

fn known_source(origin: &str) -> Option<reqwest::Url> {
    let source = reqwest::Url::parse(origin).ok()?;
    let host = source.host_str()?;
    let known = ["quickconnect.to", "quickconnect.cn"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")));
    (known
        && matches!(source.scheme(), "http" | "https")
        && source.username().is_empty()
        && source.password().is_none()
        && source.port() != Some(0)
        && source.origin().ascii_serialization() == origin)
        .then_some(source)
}

fn authorized_source(state: &AxumProxyState) -> Option<reqwest::Url> {
    known_source(&state.target_origin).or_else(|| {
        let source = reqwest::Url::parse(&state.target_origin).ok()?;
        state
            .proxy_policy
            .synology_quick_connect_defaults
            .as_ref()?;
        state.proxy_policy.validate(&source).ok()?;
        Some(source)
    })
}

pub(super) fn decode_destination(query: Option<&str>) -> Option<reqwest::Url> {
    let query = query?;
    if query.len() > PREFIX.len() + 3 * MAX_DESTINATION_BYTES || query.contains('&') {
        return None;
    }
    let bytes = query.strip_prefix(PREFIX)?.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len().min(MAX_DESTINATION_BYTES));
    let mut index = 0;
    let hex = |byte: u8| (byte as char).to_digit(16).map(|value| value as u8);
    while index < bytes.len() {
        let byte = match bytes[index] {
            b'%' => {
                let high = hex(*bytes.get(index + 1)?)?;
                let low = hex(*bytes.get(index + 2)?)?;
                index += 2;
                high * 16 + low
            }
            b'+' => b' ',
            value => value,
        };
        decoded.push(byte);
        if decoded.len() > MAX_DESTINATION_BYTES {
            return None;
        }
        index += 1;
    }
    let text = std::str::from_utf8(&decoded).ok()?;
    if text.is_empty()
        || text
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return None;
    }
    let authority = text.split_once("://")?.1.split(['/', '?', '#']).next()?;
    if authority.contains('@') {
        return None;
    }
    let url = reqwest::Url::parse(text).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port() != Some(0)
        && url.as_str().len() <= MAX_DESTINATION_BYTES)
        .then_some(url)
}

fn policy_response(
    state: &AxumProxyState,
    kind: crate::themed_errors::ProxyErrorKind,
) -> Response<Body> {
    let theme = state
        .theme
        .read()
        .map(|theme| theme.clone())
        .unwrap_or_default();
    // Never echo the reserved query: it can contain a vendor's session URL.
    let source = authorized_source(state)
        .map(|url| url.to_string())
        .unwrap_or_else(|| "https://quickconnect.to/".into());
    let mut response = crate::themed_errors::themed_error_response(
        kind,
        &source,
        kind.hint(),
        &theme,
        &state.session_id,
    );
    if kind == crate::themed_errors::ProxyErrorKind::RedirectReview {
        response.extensions_mut().insert(ReviewPending);
    }
    response
}

pub(super) fn handle(
    state: &Arc<AxumProxyState>,
    method: &Method,
    headers: &HeaderMap,
    query: Option<&str>,
    document_sequence: u64,
    navigation_token: Option<String>,
) -> Response<Body> {
    use crate::themed_errors::ProxyErrorKind;
    if !proxy_request_headers_are_authorized(headers, &state.proxy_authority, &state.proxy_origin) {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header("Cache-Control", "no-store")
            .body(Body::from(
                "This protected proxy request is not authorized.",
            ))
            .expect("static access refusal");
    }
    let header = |name| headers.get(name).and_then(|value| value.to_str().ok());
    // A navigation marker is not proof of a document request. This endpoint
    // requires browser-owned Fetch Metadata and an internal same-origin hop.
    let navigation = matches!(
        header("sec-fetch-dest"),
        Some("document" | "iframe" | "frame")
    ) && header("sec-fetch-mode") == Some("navigate")
        && header("sec-fetch-site") == Some("same-origin")
        && proxy_response::is_document_request(headers, None);
    let empty_body = !headers.contains_key("transfer-encoding")
        && header("content-length").is_none_or(|length| length == "0");
    let Some(source) = authorized_source(state) else {
        return policy_response(state, ProxyErrorKind::BadRequest);
    };
    if method != Method::GET
        || !navigation
        || !empty_body
        || document_sequence == 0
        || state.document_sequence.load(Ordering::SeqCst) != document_sequence
    {
        return policy_response(state, ProxyErrorKind::BadRequest);
    }
    let Some(destination) = decode_destination(query) else {
        return policy_response(state, ProxyErrorKind::BadRequest);
    };
    if destination.origin() == source.origin() {
        return policy_response(state, ProxyErrorKind::BadRequest);
    }
    let kind = if redirect::record_vendor(
        state,
        &destination,
        document_sequence,
        navigation_token,
        headers,
    ) {
        if default_handoff(state, &destination) {
            return pending_response(state, source.as_str());
        }
        ProxyErrorKind::RedirectReview
    } else if source.scheme() == "https" && destination.scheme() == "http" {
        ProxyErrorKind::InsecureRedirect
    } else {
        ProxyErrorKind::CrossOriginRedirect
    };
    policy_response(state, kind)
}
