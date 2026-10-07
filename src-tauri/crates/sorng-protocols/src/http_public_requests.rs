//! Opted-in anonymous HTTP exchanges. Never use the authenticated site client,
//! serve foreign documents on its origin, or expose response cookies to it.
use super::{external_fonts, AxumProxyState, HttpProxyPolicy, PageScripts};
use axum::{
    body::Body,
    http::{Method, Response, StatusCode},
};
use reqwest::Url;
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

pub(super) const PATH: &str = "/__sortofremoteng_public_request_v1";
pub(super) const NAVIGATION: &str = "/__sortofremoteng_public_navigation_v1";
const MAX_BODY: usize = 4 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;

pub(super) fn is_path(path: &str) -> bool {
    path == PATH || path == NAVIGATION
}

pub(super) fn override_resource_csp(value: &str) -> String {
    // The independently mandatory policy still denies direct egress. Relax
    // only supported resource sinks; retain sandbox/worker/frame/base rules.
    value.split(',').map(|policy| {
        let mut kept: Vec<_> = policy.split(';').map(str::trim).filter(|v| !v.is_empty())
            .filter(|v| !["connect-src", "img-src", "media-src", "font-src", "style-src", "style-src-elem", "style-src-attr"]
                .iter().any(|name| v.split_ascii_whitespace().next().is_some_and(|v| v.eq_ignore_ascii_case(name))))
            .map(str::to_owned).collect();
        kept.push("connect-src 'self' *; img-src 'self' * data: blob:; media-src 'self' * data: blob:; font-src 'self' * data: blob:; style-src 'self' * 'unsafe-inline'".into());
        kept.join("; ")
    }).collect::<Vec<_>>().join(", ")
}

pub(super) fn manifest(policy: &HttpProxyPolicy, proxy: &str) -> Option<serde_json::Value> {
    policy.allows_all_requests().then(|| {
        serde_json::json!({
            "version":1, "proxyEndpoint":format!("{proxy}{PATH}"),
            "navigationEndpoint":format!("{proxy}{NAVIGATION}"),
            "httpsOnly":policy.https_only,
            "allowHttpDowngrade":policy.allow_http_downgrade_redirects,
            "scripts":policy.page_scripts == PageScripts::Allow
        })
    })
}

fn allowed(policy: &HttpProxyPolicy, source: &str, url: &Url) -> bool {
    policy.allows_all_requests()
        && matches!(url.scheme(), "http" | "https")
        && url.username().is_empty() && url.password().is_none()
        && url.port() != Some(0) && url.as_str().len() <= 4096
        && (!policy.https_only || url.scheme() == "https")
        && (!source.starts_with("https:") || url.scheme() == "https"
            || policy.allow_http_downgrade_redirects)
        // The protected loopback control plane is never a public destination.
        && url.host_str().is_some_and(|host| {
            !host.eq_ignore_ascii_case("localhost") && !host.to_ascii_lowercase().ends_with(".localhost")
                && !host.trim_matches(['[', ']']).parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
        })
}

fn decode(uri: &axum::http::Uri) -> Option<(Url, String, u64)> {
    let query = uri.query()?;
    if query.len() > 13_000 {
        return None;
    }
    let (mut destination, mut kind, mut document) = (None, None, None);
    for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match name.as_ref() {
            "destination" if destination.is_none() => {
                let encoded = url::form_urlencoded::Serializer::new(String::new())
                    .append_pair("destination", &value)
                    .finish();
                destination = Some(super::quickconnect::decode_destination(Some(&encoded))?);
            }
            "kind" if kind.is_none() => kind = Some(value.into_owned()),
            "document" if document.is_none() => {
                let n = value.parse::<u64>().ok()?;
                if n == 0 || n > 9_007_199_254_740_991 || n.to_string() != value {
                    return None;
                }
                document = Some(n);
            }
            _ => return None,
        }
    }
    let kind = if uri.path() == NAVIGATION {
        if kind.is_some() {
            return None;
        }
        "navigation".into()
    } else {
        kind?
    };
    Some((destination?, kind, document?))
}

fn local_url(url: &Url, kind: &str, proxy: &str, document: u64) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("destination", url.as_str())
        .append_pair("kind", kind)
        .append_pair("document", &document.to_string())
        .finish();
    format!("{proxy}{PATH}?{query}")
}

/// Reuse the maintained HTML/CSS tokenizer. This never rewrites JavaScript
/// strings or changes script bytes (including integrity-protected resources).
pub(super) fn rewrite(
    text: &str,
    mime: Option<&str>,
    base: &Url,
    proxy: &str,
    policy: &HttpProxyPolicy,
    document: u64,
) -> String {
    if !policy.allows_all_requests() || document == 0 {
        return text.into();
    }
    let map = |value: &str, kind: external_fonts::Kind| {
        let url = base.join(value).ok()?;
        if url.origin() == base.origin()
            || url.origin().ascii_serialization() == proxy
            || !allowed(policy, base.as_str(), &url)
        {
            return None;
        }
        let kind = match kind {
            external_fonts::Kind::Script if policy.page_scripts == PageScripts::Allow => "script",
            external_fonts::Kind::Script => return None,
            external_fonts::Kind::Stylesheet => "stylesheet",
            external_fonts::Kind::Font => "resource",
        };
        Some(local_url(&url, kind, proxy, document))
    };
    match mime.unwrap_or("").split(';').next().unwrap_or("").trim() {
        "text/html" => external_fonts::rewrite_public_html_with(text, &map),
        "text/css" => {
            external_fonts::rewrite_css_with(text, false, &map).unwrap_or_else(|| text.into())
        }
        _ => text.into(),
    }
}

fn refusal(status: StatusCode, message: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(message))
        .unwrap()
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
) -> Response<Body> {
    if !state.proxy_policy.allows_all_requests() {
        return refusal(
            StatusCode::FORBIDDEN,
            "Anonymous public requests are disabled.",
        );
    }
    let headers = request.headers();
    let scoped = if let Some(google) = &state.network.google {
        match google.request_state(&state, &request) {
            Ok(scoped) => scoped,
            Err(_) => {
                return refusal(
                    StatusCode::FORBIDDEN,
                    "Public request origin is not authorized.",
                )
            }
        }
    } else {
        state.clone()
    };
    if !super::proxy_request_headers_are_authorized(
        headers,
        &scoped.proxy_authority,
        &scoped.proxy_origin,
    ) || headers.get_all("host").iter().count() != 1
        || [
            "origin",
            "sec-fetch-dest",
            "sec-fetch-mode",
            "sec-fetch-site",
            "content-type",
        ]
        .iter()
        .any(|name| headers.get_all(*name).iter().count() > 1)
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| v.as_bytes() == b"cross-site")
    {
        return refusal(
            StatusCode::FORBIDDEN,
            "Public request origin is not authorized.",
        );
    }
    let Some((destination, kind, document)) = decode(request.uri()) else {
        return refusal(StatusCode::BAD_REQUEST, "Invalid anonymous public request.");
    };
    if !allowed(&state.proxy_policy, &scoped.target_origin, &destination) {
        return refusal(
            StatusCode::FORBIDDEN,
            "Public destination violates the connection transport policy.",
        );
    }
    let header = |name| headers.get(name).and_then(|v| v.to_str().ok());
    let navigation = request.uri().path() == NAVIGATION;
    let supported = if navigation {
        request.method() == Method::GET
            && header("sec-fetch-mode") == Some("navigate")
            && matches!(header("sec-fetch-dest"), Some("document" | "iframe"))
            && header("sec-fetch-site") == Some("same-origin")
    } else {
        matches!(
            kind.as_str(),
            "fetch" | "xhr" | "beacon" | "resource" | "font" | "css" | "stylesheet" | "script"
        ) && matches!(
            *request.method(),
            Method::GET
                | Method::HEAD
                | Method::POST
                | Method::PUT
                | Method::PATCH
                | Method::DELETE
                | Method::OPTIONS
        ) && (!matches!(
            kind.as_str(),
            "resource" | "font" | "css" | "stylesheet" | "script"
        ) || matches!(*request.method(), Method::GET | Method::HEAD))
            && header("sec-fetch-mode") != Some("navigate")
            && matches!(
                header("sec-fetch-dest"),
                None | Some("empty" | "image" | "audio" | "video" | "font" | "style" | "script")
            )
            && (state.proxy_policy.page_scripts == PageScripts::Allow
                || kind != "script" && header("sec-fetch-dest") != Some("script"))
    };
    if !supported
        || headers.contains_key("upgrade")
        || headers.contains_key("sec-websocket-key")
        || header("accept").is_some_and(|v| v.contains("text/event-stream"))
    {
        return refusal(StatusCode::METHOD_NOT_ALLOWED,
            "Unsupported public transport: forms, embedded documents, streams and upgrades require a dedicated reviewed route.");
    }
    let passive = matches!(
        kind.as_str(),
        "resource" | "font" | "css" | "stylesheet" | "script"
    );
    if (passive && !state.network.resource_document_is_eligible(document))
        || (!passive && state.network.await_document(document).await.is_err())
    {
        return refusal(
            StatusCode::GONE,
            "Public request document is no longer current.",
        );
    }
    if navigation {
        if !matches!(axum::body::to_bytes(request.into_body(), 0).await, Ok(bytes) if bytes.is_empty())
        {
            return refusal(
                StatusCode::BAD_REQUEST,
                "Public navigation supports empty GET requests only.",
            );
        }
        let sequence = state.document_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        if !super::redirect::record_public(&state, &destination, sequence, document) {
            return refusal(
                StatusCode::FORBIDDEN,
                "Public navigation could not create a current destination receipt.",
            );
        }
        let theme = state.theme.read().map(|v| v.clone()).unwrap_or_default();
        return crate::themed_errors::themed_error_response(
            crate::themed_errors::ProxyErrorKind::RedirectReview,
            &state.target_origin, "Continue through the app's isolated anonymous destination review. No destination request or saved-login transfer has occurred.",
            &theme, &state.session_id);
    }
    let Some(assets) = &state.network.font_assets else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Verified public transport is unavailable.",
        );
    };
    let Ok(_admission) = assets.requests.try_acquire() else {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "Public request capacity is exhausted.",
        );
    };
    // Deliberately CLOSED header set. Even page-supplied bearer/custom headers
    // do not cross this anonymous boundary; nor do native saved query extras.
    let mut forwarded = reqwest::header::HeaderMap::new();
    for name in ["accept", "accept-language", "content-type", "user-agent"] {
        if headers.get_all(name).iter().count() == 1 {
            if let Some(value) = headers.get(name).filter(|v| v.as_bytes().len() <= 1024) {
                forwarded.insert(name, value.clone());
            }
        }
    }
    let method = request.method().clone();
    let operation = async {
        let Ok(body) = axum::body::to_bytes(request.into_body(), MAX_BODY).await else {
            return refusal(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Public request body exceeds its bounded limit.",
            );
        };
        let Ok(_download) = assets.downloads.acquire().await else {
            return refusal(StatusCode::GONE, "Public request session has ended.");
        };
        match exchange(
            &assets.client,
            destination,
            method,
            body,
            forwarded,
            &scoped.proxy_origin,
            &state.proxy_policy,
            document,
            &kind,
        )
        .await
        {
            Ok(response) => response,
            Err(message) => refusal(StatusCode::BAD_GATEWAY, message),
        }
    };
    let timed = tokio::time::timeout(Duration::from_secs(30), operation);
    let result = if passive {
        state.network.while_resource_document(document, timed).await
    } else {
        state.network.while_document(document, timed).await
    };
    match result {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => refusal(StatusCode::GATEWAY_TIMEOUT, "Public request timed out."),
        Err(_) => refusal(StatusCode::GONE, "Public request document has ended."),
    }
}

#[allow(clippy::too_many_arguments)]
async fn exchange(
    client: &reqwest::Client,
    mut url: Url,
    mut method: Method,
    mut body: axum::body::Bytes,
    mut headers: reqwest::header::HeaderMap,
    proxy: &str,
    policy: &HttpProxyPolicy,
    document: u64,
    kind: &str,
) -> Result<Response<Body>, &'static str> {
    for hop in 0..=5 {
        url.set_fragment(None);
        let mut response = client
            .request(method.clone(), url.clone())
            .headers(headers.clone())
            .header("Accept-Encoding", "identity")
            .body(body.clone())
            .send()
            .await
            .map_err(|_| "Anonymous public upstream request failed.")?;
        let status = response.status();
        if matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == 5 {
                return Err("Public redirect limit exceeded.");
            }
            let next = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| url.join(v).ok())
                .filter(|next| allowed(policy, url.as_str(), next))
                .ok_or("Public redirect violates the connection transport policy.")?;
            if (status.as_u16() == 303 && method != Method::HEAD)
                || matches!(status.as_u16(), 301 | 302) && method == Method::POST
            {
                method = Method::GET;
                body = axum::body::Bytes::new();
                headers.remove("content-type");
            }
            url = next;
            continue;
        }
        if response
            .headers()
            .get("content-encoding")
            .is_some_and(|v| v.as_bytes() != b"identity")
        {
            return Err("Encoded public responses are unsupported.");
        }
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.len() <= 256)
            .unwrap_or("application/octet-stream")
            .to_string();
        if mime
            .split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("text/event-stream"))
        {
            return Err("Public event streams require a dedicated reviewed route.");
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE as u64)
        {
            return Err("Public response exceeds its bounded limit.");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Public response read failed.")?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
                return Err("Public response exceeds its bounded limit.");
            }
            bytes.extend_from_slice(&chunk);
        }
        if kind == "stylesheet" {
            if !mime
                .split(';')
                .next()
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("text/css"))
            {
                return Err("Public stylesheet response is not CSS.");
            }
            let css = std::str::from_utf8(&bytes).map_err(|_| "Public CSS must be UTF-8.")?;
            let rewritten = external_fonts::rewrite_css_with(css, true, &|value, css_kind| {
                if value.starts_with("data:") {
                    return None;
                }
                let mapped = url
                    .join(value)
                    .ok()
                    .filter(|next| allowed(policy, url.as_str(), next))
                    .map(|next| {
                        local_url(
                            &next,
                            if matches!(css_kind, external_fonts::Kind::Stylesheet) {
                                "stylesheet"
                            } else {
                                "resource"
                            },
                            proxy,
                            document,
                        )
                    });
                Some(mapped.unwrap_or_else(|| "about:blank".into()))
            })
            .ok_or("Unsupported public CSS URL grammar.")?;
            bytes = rewritten.into_bytes();
        }
        return Ok(Response::builder()
            .status(status)
            .header("content-type", mime)
            .header("cache-control", "no-store")
            .header("x-content-type-options", "nosniff")
            .header("content-disposition", "attachment")
            .header("cross-origin-resource-policy", "same-origin")
            .body(Body::from(bytes))
            .unwrap());
    }
    Err("Public redirect limit exceeded.")
}
