//! Exact-origin anonymous script/style capability. Loading a payment SDK does
//! not authorize its frames, API calls, navigation, or a complete payment flow.
//! Uses the font route's proxy-derived, strictly verified TLS client, not the
//! authenticated website client. Script bytes are never transformed (SRI).
use super::proxy_policy::{ExternalResourceKind as Kind, ExternalResourceOrigin};
use super::{
    external_fonts as fonts, font_assets, proxy_policy::PageScripts, AxumProxyState,
    HttpProxyPolicy,
};
use axum::{
    body::Body,
    http::{Method, Response, StatusCode},
};
use reqwest::Url;
use std::{sync::Arc, time::Duration};

pub(super) const PATH: &str = "/__sortofremoteng_assets_v1/external-resource";
const MAX_URL: usize = 8192;
const MAX_SCRIPT: usize = 4 * 1024 * 1024;
const MAX_CSS: usize = 256 * 1024;

pub(super) fn canonical_origins(
    values: &[ExternalResourceOrigin],
) -> Result<Vec<ExternalResourceOrigin>, &'static str> {
    let origins =
        fonts::canonical_origins(&values.iter().map(|v| v.origin.clone()).collect::<Vec<_>>())?;
    values
        .iter()
        .zip(origins)
        .map(|(value, origin)| {
            if value.kinds.is_empty()
                || value.kinds.len() > 2
                || (value.kinds.len() == 2 && value.kinds[0] == value.kinds[1])
            {
                return Err("Invalid external resource kinds.");
            }
            Ok(ExternalResourceOrigin {
                origin,
                kinds: value.kinds.clone(),
            })
        })
        .collect()
}

fn effective_origins(policy: &HttpProxyPolicy) -> Vec<ExternalResourceOrigin> {
    if policy.version != 1 || policy.same_origin_only {
        return vec![];
    }
    let mut origins = canonical_origins(&policy.external_resource_origins).unwrap_or_default();
    if policy.page_scripts != PageScripts::Allow {
        for grant in &mut origins {
            grant.kinds.retain(|kind| *kind != Kind::Script);
        }
        origins.retain(|grant| !grant.kinds.is_empty());
    }
    origins
}

pub(super) fn manifest(policy: &HttpProxyPolicy, proxy: &str) -> Option<serde_json::Value> {
    let origins = effective_origins(policy);
    (!origins.is_empty()).then(|| {
        serde_json::json!({
            "version":1, "origins":origins, "proxyEndpoint":format!("{proxy}{PATH}")
        })
    })
}

fn approved(value: &str, kind: Kind, origins: &[ExternalResourceOrigin]) -> Option<Url> {
    let url = fonts::https_url_with_limit(value, MAX_URL)?;
    origins
        .iter()
        .any(|grant| {
            grant.origin == url.origin().ascii_serialization() && grant.kinds.contains(&kind)
        })
        .then_some(url)
}

fn local_url(url: &Url, kind: Kind, proxy: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("destination", url.as_str())
        .append_pair(
            "kind",
            if kind == Kind::Script {
                "script"
            } else {
                "stylesheet"
            },
        )
        .finish();
    format!("{proxy}{PATH}?{query}")
}

fn mapper<'a>(
    policy: &'a HttpProxyPolicy,
    base: &'a Url,
    proxy: &'a str,
    external_sheet: bool,
) -> impl Fn(&str, fonts::Kind) -> Option<String> + 'a {
    let origins = effective_origins(policy);
    let font = fonts::policy_mapper(policy, base, proxy);
    move |value, kind| {
        // Primary-site resources must retain their authenticated/dedicated
        // route even when that site's origin is in the public catalog. A
        // downloaded external sheet has the opposite requirement: its relative
        // imports/fonts must stay anonymous, not resolve to the primary site.
        if !external_sheet
            && fonts::resolved_with_limit(value, base, MAX_URL)
                .is_some_and(|url| url.origin() == base.origin())
        {
            return None;
        }
        let resource = match kind {
            fonts::Kind::Script => Some(Kind::Script),
            fonts::Kind::Stylesheet => Some(Kind::Stylesheet),
            fonts::Kind::Font => None,
        };
        resource
            .and_then(|kind| {
                let url = fonts::resolved_with_limit(value, base, MAX_URL)?;
                approved(url.as_str(), kind, &origins).map(|url| local_url(&url, kind, proxy))
            })
            .or_else(|| font(value, kind))
    }
}

pub(super) fn rewrite(
    text: &str,
    content_type: Option<&str>,
    base: &Url,
    proxy: &str,
    policy: &HttpProxyPolicy,
) -> String {
    let map = mapper(policy, base, proxy, false);
    let mime = content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if mime.eq_ignore_ascii_case("text/html") {
        fonts::rewrite_html_with(text, &map)
    } else if mime.eq_ignore_ascii_case("text/css") {
        fonts::rewrite_css_with(text, false, &map).unwrap_or_else(|| text.into())
    } else {
        text.into()
    }
}

fn destination(uri: &axum::http::Uri, origins: &[ExternalResourceOrigin]) -> Option<(Url, Kind)> {
    let query = uri.query()?;
    if query.len() > MAX_URL * 3 + 64 {
        return None;
    }
    let mut target = None;
    let mut kind = None;
    for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match name.as_ref() {
            "destination" if target.is_none() => target = Some(value.into_owned()),
            "kind" if kind.is_none() => {
                kind = Some(match value.as_ref() {
                    "script" => Kind::Script,
                    "stylesheet" => Kind::Stylesheet,
                    _ => return None,
                })
            }
            _ => return None,
        }
    }
    let kind = kind?;
    Some((approved(&target?, kind, origins)?, kind))
}

async fn download(
    assets: &font_assets::ReviewedFontAssets,
    mut url: Url,
    kind: Kind,
    origins: &[ExternalResourceOrigin],
    proxy: &str,
    policy: &HttpProxyPolicy,
    user_agent: Option<&reqwest::header::HeaderValue>,
) -> Result<(Vec<u8>, &'static str), &'static str> {
    let _download = assets
        .downloads
        .acquire()
        .await
        .map_err(|_| "Resource route ended.")?;
    for hop in 0..=3 {
        url =
            approved(url.as_str(), kind, origins).ok_or("Resource destination is not approved.")?;
        let mut request = assets
            .client
            .get(url.clone())
            .header("Accept-Encoding", "identity")
            .header(
                "Accept",
                if kind == Kind::Script {
                    "text/javascript,application/javascript"
                } else {
                    "text/css"
                },
            );
        if let Some(agent) = user_agent {
            request = request.header("User-Agent", agent);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "Verified resource request failed; no alternate route was attempted.")?;
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == 3 || response.headers().get_all("location").iter().count() != 1 {
                return Err("External resource redirect limit or location is invalid.");
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|h| h.to_str().ok())
                .filter(|value| fonts::clean_url_with_limit(value, MAX_URL) && !value.contains('#'))
                .ok_or("Invalid resource redirect.")?;
            if (location.contains("://")
                && fonts::https_url_with_limit(location, MAX_URL).is_none())
                || (location.starts_with("//")
                    && fonts::https_url_with_limit(&format!("https:{location}"), MAX_URL).is_none())
            {
                return Err("Invalid resource redirect.");
            }
            let next = url
                .join(location)
                .map_err(|_| "Invalid resource redirect.")?;
            url = approved(next.as_str(), kind, origins)
                .ok_or("Resource redirect origin or kind is not approved.")?;
            continue;
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err("Unsupported resource response status.");
        }
        let headers = response.headers();
        let mime = headers
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.split(';').next())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let max = if kind == Kind::Script {
            MAX_SCRIPT
        } else {
            MAX_CSS
        };
        let mime_ok = if kind == Kind::Script {
            matches!(
                mime.as_str(),
                "text/javascript"
                    | "application/javascript"
                    | "application/ecmascript"
                    | "text/ecmascript"
                    | "application/x-javascript"
            )
        } else {
            mime == "text/css"
        };
        if !mime_ok
            || headers.get_all("content-type").iter().count() != 1
            || headers
                .get("content-encoding")
                .is_some_and(|v| v.as_bytes() != b"identity")
            || response
                .content_length()
                .is_some_and(|length| length > max as u64)
        {
            return Err("Unsupported resource response type or size.");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Incomplete resource response.")?
        {
            if chunk.len() > max - bytes.len() {
                return Err("Resource response exceeds size limit.");
            }
            bytes.extend_from_slice(&chunk);
        }
        // Refuse obvious HTML mislabeled as script/CSS, without re-encoding JS.
        let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(512)])
            .trim_start_matches('\u{feff}')
            .trim_start()
            .to_ascii_lowercase();
        if ["<!doctype", "<html", "<head", "<body", "<script", "<?xml"]
            .iter()
            .any(|tag| prefix.starts_with(tag))
        {
            return Err("HTML is not an external resource.");
        }
        if kind == Kind::Script {
            return Ok((bytes, "text/javascript"));
        }
        let css = std::str::from_utf8(&bytes).map_err(|_| "Resource CSS must be UTF-8.")?;
        let map = mapper(policy, &url, proxy, true);
        let rewritten = fonts::rewrite_css_with(css, true, &|value, kind| {
            // Never let unsupported relative URLs fall into the authenticated
            // website route. Non-granted images and other assets stay blocked.
            Some(
                safe_image_data(value, kind)
                    .or_else(|| map(value, kind))
                    .unwrap_or_else(|| "https://external-resource-blocked.invalid/".into()),
            )
        })
        .ok_or("Unsupported external resource CSS syntax.")?;
        if rewritten.len() > MAX_CSS * 4 {
            return Err("Rewritten resource CSS exceeds size limit.");
        }
        return Ok((rewritten.into_bytes(), "text/css; charset=utf-8"));
    }
    Err("Resource redirect limit exceeded.")
}

fn safe_image_data(value: &str, kind: fonts::Kind) -> Option<String> {
    if kind != fonts::Kind::Font || value.contains('\\') || value.chars().any(char::is_control) {
        return None;
    }
    let (metadata, _) = value.split_once(',')?;
    let mut parts = metadata.split(';');
    if !matches!(
        parts.next()?.to_ascii_lowercase().as_str(),
        "data:image/svg+xml"
            | "data:image/png"
            | "data:image/jpeg"
            | "data:image/gif"
            | "data:image/webp"
            | "data:image/avif"
    ) {
        return None;
    }
    if parts.any(|part| {
        !matches!(
            part.to_ascii_lowercase().as_str(),
            "base64" | "charset=utf-8" | "utf8"
        )
    }) {
        return None;
    }
    // Image-mode SVG is non-executable in CSS and cannot access the website
    // client. Quote/HTML delimiters are encoded, never inserted into CSS raw.
    Some(
        value
            .replace('"', "%22")
            .replace('\'', "%27")
            .replace('(', "%28")
            .replace(')', "%29")
            .replace('<', "%3C")
            .replace('>', "%3E")
            .replace(' ', "%20"),
    )
}

fn refusal(status: StatusCode, message: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(message))
        .expect("static resource refusal")
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
) -> Response<Body> {
    handle_with_timeout(state, request, Duration::from_secs(30)).await
}

// Internal deadline seam lets tests exercise stalled bodies without a 30s
// wall-clock wait. Production callers always use the fixed bounded wrapper.
pub(super) async fn handle_with_timeout(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
    deadline: Duration,
) -> Response<Body> {
    let headers = request.headers();
    if !super::proxy_request_headers_are_authorized(
        headers,
        &state.proxy_authority,
        &state.proxy_origin,
    ) || headers.get_all("host").iter().count() != 1
        || headers.get_all("origin").iter().count() > 1
        || headers.get_all("sec-fetch-site").iter().count() > 1
        || headers
            .get("origin")
            .is_some_and(|v| v.as_bytes() != state.proxy_origin.as_bytes())
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"cross-site"))
    {
        return refusal(
            StatusCode::FORBIDDEN,
            "Resource request origin is not authorized.",
        );
    }
    let origins = effective_origins(&state.proxy_policy);
    if origins.is_empty() {
        return refusal(
            StatusCode::FORBIDDEN,
            "External resources are not enabled for this session.",
        );
    }
    let Some((url, kind)) = destination(request.uri(), &origins) else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Invalid external resource request.",
        );
    };
    if request.method() != Method::GET
        || headers.contains_key("upgrade")
        || headers.contains_key("sec-websocket-key")
        || headers.contains_key("transfer-encoding")
        || headers.get_all("content-length").iter().count() > 1
        || headers
            .get("content-length")
            .is_some_and(|v| v.as_bytes() != b"0")
        || headers.get_all("sec-fetch-dest").iter().count() > 1
        || headers.get("sec-fetch-dest").is_some_and(|v| {
            v.as_bytes() != b"empty"
                && v.as_bytes()
                    != if kind == Kind::Script {
                        b"script".as_slice()
                    } else {
                        b"style".as_slice()
                    }
        })
    {
        return refusal(
            StatusCode::METHOD_NOT_ALLOWED,
            "External resources support empty GET resource requests only.",
        );
    }
    let user_agent = (headers.get_all("user-agent").iter().count() == 1)
        .then(|| headers.get("user-agent").cloned())
        .flatten()
        .filter(|value| {
            value.as_bytes().len() <= 1024
                && value.as_bytes().iter().all(|b| (0x20..=0x7e).contains(b))
        });
    let Some(assets) = state.network.font_assets.as_ref() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Verified external resource transport is unavailable.",
        );
    };
    let Ok(_request) = assets.requests.try_acquire() else {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "External resource request capacity is exhausted.",
        );
    };
    let operation = async {
        if !matches!(axum::body::to_bytes(request.into_body(), 0).await, Ok(body) if body.is_empty())
        {
            return refusal(
                StatusCode::BAD_REQUEST,
                "External resource requests must have no body.",
            );
        }
        match download(
            assets,
            url,
            kind,
            &origins,
            &state.proxy_origin,
            &state.proxy_policy,
            user_agent.as_ref(),
        )
        .await
        {
            Ok((bytes, mime)) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .header("Content-Length", bytes.len())
                .header("X-Content-Type-Options", "nosniff")
                .header("Cache-Control", "no-store")
                .header("Cross-Origin-Resource-Policy", "same-origin")
                .body(Body::from(bytes))
                .expect("bounded external resource response"),
            Err(message) => refusal(StatusCode::BAD_GATEWAY, message),
        }
    };
    match state
        .network
        .while_active(tokio::time::timeout(deadline, operation))
        .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => refusal(
            StatusCode::GATEWAY_TIMEOUT,
            "External resource request timed out.",
        ),
        Err(_) => refusal(StatusCode::GONE, "External resource session ended."),
    }
}
