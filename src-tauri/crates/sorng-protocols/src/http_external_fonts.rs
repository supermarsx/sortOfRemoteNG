//! Explicit, anonymous HTTPS typography capability. Source authentication and
//! source TLS exceptions never enter this route. CSS parsing deliberately
//! supports a small grammar; escapes are left blocked, never guessed.
use super::{font_assets, AxumProxyState, HttpProxyPolicy};
use axum::{
    body::Body,
    http::{Method, Response, StatusCode},
};
use reqwest::Url;
use std::{collections::HashSet, sync::Arc, time::Duration};

pub(super) const PATH: &str = "/__sortofremoteng_assets_v1/external-font";
const MAX_URL: usize = 2048;
const MAX_CSS: usize = 256 * 1024;
const BLOCKED: &str = "https://external-font-blocked.invalid/";

pub(super) fn clean_url(value: &str) -> bool {
    clean_url_with_limit(value, MAX_URL)
}

pub(super) fn clean_url_with_limit(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && !value
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
}

pub(super) fn https_url(value: &str) -> Option<Url> {
    https_url_with_limit(value, MAX_URL)
}

pub(super) fn https_url_with_limit(value: &str, limit: usize) -> Option<Url> {
    if !clean_url_with_limit(value, limit) || value.contains('#') {
        return None;
    }
    let (_, authority) = value.split_once("://")?;
    if authority.split(['/', '?', '#']).next()?.contains('@') {
        return None;
    }
    let url = Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.has_host()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

pub(super) fn canonical_origins(values: &[String]) -> Result<Vec<String>, &'static str> {
    let invalid = "Invalid external font origins.";
    if values.len() > 16 {
        return Err(invalid);
    }
    let mut seen = HashSet::new();
    let mut origins = Vec::with_capacity(values.len());
    for value in values {
        // Match the saved-settings contract: trim outer whitespace, but never
        // allow trimming to hide control characters or an overlong raw value.
        if value.len() > MAX_URL || value.chars().any(char::is_control) {
            return Err(invalid);
        }
        let value = value.trim();
        let url = https_url(value).ok_or(invalid)?;
        // Check the raw suffix too: URL parsing normalizes /., /../ and other
        // non-root paths which must not become origin grants.
        let authority = value.split_once("://").ok_or(invalid)?.1;
        let suffix = authority
            .find(['/', '?', '#'])
            .map(|i| &authority[i..])
            .unwrap_or("");
        if value.contains('*')
            || url.host_str().is_some_and(|host| host.contains('*'))
            || !matches!(suffix, "" | "/")
            || url.path() != "/"
            || url.query().is_some()
        {
            return Err(invalid);
        }
        let origin = url.origin().ascii_serialization();
        if !seen.insert(origin.clone()) {
            return Err(invalid);
        }
        origins.push(origin);
    }
    Ok(origins)
}

fn effective_origins(policy: &HttpProxyPolicy) -> Option<Vec<String>> {
    if policy.version != 1 || !policy.allow_external_fonts || policy.same_origin_only {
        return None;
    }
    canonical_origins(&policy.external_font_origins)
        .ok()
        .filter(|origins| !origins.is_empty())
}

pub(super) fn manifest(policy: &HttpProxyPolicy, proxy_origin: &str) -> Option<serde_json::Value> {
    Some(
        serde_json::json!({"version":1, "origins":effective_origins(policy)?,
        "proxyEndpoint":format!("{proxy_origin}{PATH}")}),
    )
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Font,
    Stylesheet,
    Script,
}
impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Font => "font",
            Self::Stylesheet => "stylesheet",
            Self::Script => "script",
        }
    }
}

fn approved(value: &str, origins: &[String]) -> Option<Url> {
    let url = https_url(value)?;
    origins
        .contains(&url.origin().ascii_serialization())
        .then_some(url)
}

fn local_url(url: &Url, kind: Kind, proxy_origin: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("destination", url.as_str())
        .append_pair("kind", kind.name())
        .finish();
    format!("{proxy_origin}{PATH}?{query}")
}

fn destination(uri: &axum::http::Uri, origins: &[String]) -> Option<(Url, Kind)> {
    let query = uri.query()?;
    if query.len() > MAX_URL * 3 + 64 {
        return None;
    }
    let mut target = None;
    let mut kind = None;
    for (name, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match name.as_ref() {
            "destination" if target.is_none() => target = Some(approved(&value, origins)?),
            "kind" if kind.is_none() => {
                kind = Some(match value.as_ref() {
                    "font" => Kind::Font,
                    "stylesheet" => Kind::Stylesheet,
                    _ => return None,
                })
            }
            _ => return None,
        }
    }
    Some((target?, kind?))
}

// Binary container checks, not a font decoder. The browser still validates
// table contents. No SVG, collections, HTML or arbitrary octet streams pass.
fn font_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 12 || bytes.len() > font_assets::MAX_BYTES {
        return None;
    }
    let u16_at = |i| u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
    let u32_at = |i| u32::from_be_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
    match &bytes[..4] {
        b"wOF2" => font_assets::valid_woff2(bytes).then_some("font/woff2"),
        b"wOFF" => {
            if bytes.len() < 44
                || !matches!(&bytes[4..8], b"\0\x01\0\0" | b"OTTO")
                || u32_at(8) != bytes.len()
                || !(1..=256).contains(&u16_at(12))
                || u16_at(14) != 0
                || !(12..=16 * 1024 * 1024).contains(&u32_at(16))
                || 44 + u16_at(12) * 20 > bytes.len()
            {
                return None;
            }
            for i in (44..44 + u16_at(12) * 20).step_by(20) {
                let offset = u32_at(i + 4);
                let size = u32_at(i + 8);
                if offset < 44 + u16_at(12) * 20
                    || size == 0
                    || size > u32_at(i + 12)
                    || offset.checked_add(size)? > bytes.len()
                {
                    return None;
                }
            }
            Some("font/woff")
        }
        b"\0\x01\0\0" | b"OTTO" => {
            let count = u16_at(4);
            if !(1..=256).contains(&count) || 12 + count * 16 > bytes.len() {
                return None;
            }
            for i in (12..12 + count * 16).step_by(16) {
                let offset = u32_at(i + 8);
                if offset < 12 + count * 16
                    || u32_at(i + 12) == 0
                    || offset.checked_add(u32_at(i + 12))? > bytes.len()
                {
                    return None;
                }
            }
            Some(if &bytes[..4] == b"OTTO" {
                "font/otf"
            } else {
                "font/ttf"
            })
        }
        _ => None,
    }
}

fn font_mime(mime: &str) -> bool {
    matches!(
        mime,
        "font/woff"
            | "font/woff2"
            | "font/ttf"
            | "font/otf"
            | "application/font-woff"
            | "application/font-woff2"
            | "application/x-font-woff"
            | "application/x-font-ttf"
            | "application/x-font-opentype"
            | "application/vnd.ms-opentype"
            | "application/octet-stream"
            | "binary/octet-stream"
    )
}

async fn download(
    assets: &font_assets::ReviewedFontAssets,
    mut url: Url,
    kind: Kind,
    origins: &[String],
    proxy_origin: &str,
    user_agent: Option<&reqwest::header::HeaderValue>,
) -> Result<(Vec<u8>, &'static str), &'static str> {
    let _download = assets
        .downloads
        .acquire()
        .await
        .map_err(|_| "Font route ended.")?;
    for hop in 0..=3 {
        // Revalidate every hop before building a fresh anonymous request.
        url = approved(url.as_str(), origins).ok_or("Font destination is not approved.")?;
        let mut request = assets
            .client
            .get(url.clone())
            .header("Accept-Encoding", "identity")
            .header(
                "Accept",
                if kind == Kind::Stylesheet {
                    "text/css"
                } else {
                    "font/woff2,font/woff,font/ttf,font/otf,application/octet-stream"
                },
            );
        if let Some(agent) = user_agent {
            request = request.header("User-Agent", agent);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "Verified font request failed; no alternate route was attempted.")?;
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == 3 || response.headers().get_all("location").iter().count() != 1 {
                return Err("External font redirect limit or location is invalid.");
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|h| h.to_str().ok())
                .filter(|value| clean_url(value) && !value.contains('#'))
                .ok_or("Invalid font redirect.")?;
            let next = url.join(location).map_err(|_| "Invalid font redirect.")?;
            // Empty userinfo is lost by URL serialization; inspect raw absolute
            // and network-path redirects before join too.
            if location.contains("://") && https_url(location).is_none()
                || location.starts_with("//") && https_url(&format!("https:{location}")).is_none()
            {
                return Err("Invalid font redirect.");
            }
            url =
                approved(next.as_str(), origins).ok_or("Font redirect origin is not approved.")?;
            continue;
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err("Unsupported font response status.");
        }
        let headers = response.headers();
        let mime = headers
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.split(';').next())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let max = if kind == Kind::Stylesheet {
            MAX_CSS
        } else {
            font_assets::MAX_BYTES
        };
        if headers.get_all("content-type").iter().count() != 1
            || headers
                .get("content-encoding")
                .is_some_and(|v| v.as_bytes() != b"identity")
            || response
                .content_length()
                .is_some_and(|length| length > max as u64)
            || if kind == Kind::Stylesheet {
                mime != "text/css"
            } else {
                !font_mime(&mime)
            }
        {
            return Err("Unsupported font response type or size.");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Incomplete font response.")?
        {
            if chunk.len() > max - bytes.len() {
                return Err("Font response exceeds size limit.");
            }
            bytes.extend_from_slice(&chunk);
        }
        return if kind == Kind::Stylesheet {
            let css = std::str::from_utf8(&bytes).map_err(|_| "Font CSS must be UTF-8.")?;
            let rewritten = rewrite_css(css, &url, proxy_origin, origins, true)
                .ok_or("Unsupported external font CSS syntax.")?;
            if rewritten.len() > MAX_CSS * 4 {
                return Err("Rewritten font CSS exceeds size limit.");
            }
            Ok((rewritten.into_bytes(), "text/css; charset=utf-8"))
        } else {
            let mime = font_type(&bytes).ok_or("Unsupported font binary.")?;
            Ok((bytes, mime))
        };
    }
    Err("Font redirect limit exceeded.")
}

fn refusal(status: StatusCode, message: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(message))
        .unwrap()
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
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
            .is_some_and(|v| v.to_str().ok() != Some(state.proxy_origin.as_str()))
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| v.as_bytes() == b"cross-site")
    {
        return refusal(StatusCode::FORBIDDEN, "Font request is not authorized.");
    }
    let Some(origins) = effective_origins(&state.proxy_policy) else {
        return refusal(StatusCode::FORBIDDEN, "External fonts are disabled.");
    };
    let Some((url, kind)) = destination(request.uri(), &origins) else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Invalid external font destination or kind.",
        );
    };
    if request.method() != Method::GET
        || headers.contains_key("upgrade")
        || headers.contains_key("sec-websocket-key")
        || headers.contains_key("transfer-encoding")
        || headers.get_all("content-length").iter().count() > 1
        || headers.get_all("sec-fetch-dest").iter().count() > 1
        || headers
            .get("content-length")
            .is_some_and(|v| v.as_bytes() != b"0")
        || headers.get("sec-fetch-dest").is_some_and(|v| {
            let expected: &[u8] = if kind == Kind::Font {
                b"font"
            } else {
                b"style"
            };
            v.as_bytes() != b"empty" && v.as_bytes() != expected
        })
    {
        return refusal(
            StatusCode::BAD_REQUEST,
            "Only anonymous font or stylesheet GET is supported.",
        );
    }
    // The browser UA selects Google Fonts formats. No other browser/source
    // header is forwarded; reject unsuitable/duplicate UA by omitting it.
    let user_agent = (headers.get_all("user-agent").iter().count() == 1)
        .then(|| headers.get("user-agent"))
        .flatten()
        .filter(|v| {
            v.as_bytes().len() <= 1024 && v.as_bytes().iter().all(|b| (32..=126).contains(b))
        })
        .cloned();
    let Some(assets) = state.network.font_assets.as_ref() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Verified font client is unavailable.",
        );
    };
    let Ok(_request) = assets.requests.try_acquire() else {
        return refusal(StatusCode::TOO_MANY_REQUESTS, "Font request limit reached.");
    };
    let operation = async {
        if !axum::body::to_bytes(request.into_body(), 0)
            .await
            .is_ok_and(|b| b.is_empty())
        {
            return refusal(
                StatusCode::BAD_REQUEST,
                "Font requests cannot carry a body.",
            );
        }
        match download(
            assets,
            url,
            kind,
            &origins,
            &state.proxy_origin,
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
                .unwrap(),
            Err(message) => refusal(StatusCode::BAD_GATEWAY, message),
        }
    };
    match state
        .network
        .while_active(tokio::time::timeout(Duration::from_secs(30), operation))
        .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => refusal(
            StatusCode::GATEWAY_TIMEOUT,
            "External font request timed out.",
        ),
        Err(_) => refusal(StatusCode::GONE, "This proxy session has ended."),
    }
}

pub(super) fn resolved(value: &str, base: &Url) -> Option<Url> {
    resolved_with_limit(value, base, MAX_URL)
}

pub(super) fn resolved_with_limit(value: &str, base: &Url, limit: usize) -> Option<Url> {
    if !clean_url_with_limit(value, limit) || value.contains('#') {
        return None;
    }
    if value.contains("://") {
        return https_url_with_limit(value, limit);
    }
    if value.starts_with("//") {
        return https_url_with_limit(&format!("https:{value}"), limit);
    }
    let url = base.join(value).ok()?;
    https_url_with_limit(url.as_str(), limit)
}

fn mapped(value: &str, base: &Url, proxy: &str, origins: &[String], kind: Kind) -> Option<String> {
    if kind == Kind::Script {
        return None;
    }
    let url = resolved(value, base)?;
    approved(url.as_str(), origins)?;
    Some(local_url(&url, kind, proxy))
}

pub(super) fn policy_mapper<'a>(
    policy: &HttpProxyPolicy,
    base: &'a Url,
    proxy: &'a str,
) -> impl Fn(&str, Kind) -> Option<String> + 'a {
    let origins = effective_origins(policy).unwrap_or_default();
    move |value, kind| mapped(value, base, proxy, &origins, kind)
}

fn css_safe_url(value: &str) -> String {
    value
        .replace('"', "%22")
        .replace('\'', "%27")
        .replace('(', "%28")
        .replace(')', "%29")
        .replace('<', "%3C")
        .replace('>', "%3E")
}

fn identifier(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte >= 128 || matches!(byte, b'_' | b'-')
}

// Consume a complete CSS identifier, including escapes and the optional
// whitespace terminating a hexadecimal escape. This lets selectors such as
// .sm\:block and .\31 0 survive without treating escaped function/at-rule
// names as ordinary text (they could conceal url(), image-set(), or @import).
fn css_identifier(text: &str, start: usize) -> Option<(usize, bool)> {
    let bytes = text.as_bytes();
    let mut i = start;
    let mut escaped = false;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            escaped = true;
            i += 1;
            if bytes.get(i)?.is_ascii_control() {
                return None;
            }
            if bytes[i].is_ascii_hexdigit() {
                let begin = i;
                while i < begin + 6 && bytes.get(i).is_some_and(u8::is_ascii_hexdigit) {
                    i += 1;
                }
                if bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
                    if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
                        i += 1;
                    }
                    i += 1;
                }
            } else {
                i += text[i..].chars().next()?.len_utf8();
            }
        } else if identifier(bytes[i]) {
            i += text[i..].chars().next()?.len_utf8();
        } else {
            break;
        }
    }
    Some((i, escaped))
}

fn whitespace(bytes: &[u8], mut i: usize) -> usize {
    while bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    i
}

fn trivia(text: &str, mut i: usize) -> Option<usize> {
    loop {
        i = whitespace(text.as_bytes(), i);
        if text[i..].starts_with("/*") {
            i += text[i + 2..].find("*/")? + 4;
        } else {
            return Some(i);
        }
    }
}

fn css_string(text: &str, i: usize) -> Option<(usize, usize, usize)> {
    let quote = *text.as_bytes().get(i)?;
    if !matches!(quote, b'\'' | b'"') {
        return None;
    }
    let mut end = i + 1;
    while let Some(byte) = text.as_bytes().get(end) {
        if *byte == quote {
            return Some((i + 1, end, end + 1));
        }
        if byte.is_ascii_control() {
            return None;
        }
        if *byte == b'\\' {
            end += 1;
            if text.as_bytes().get(end)?.is_ascii_control() {
                return None;
            }
        }
        end += 1;
    }
    None
}

fn css_url(text: &str, i: usize) -> Option<(usize, usize, usize)> {
    let start = whitespace(text.as_bytes(), i + 4); // url(
    if matches!(text.as_bytes().get(start), Some(b'\'' | b'"')) {
        let (from, to, end) = css_string(text, start)?;
        let end = whitespace(text.as_bytes(), end);
        (text.as_bytes().get(end) == Some(&b')')).then_some((from, to, end + 1))
    } else {
        let end = start + text[start..].find(')')?;
        let value = text[start..end].trim_end();
        if value
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '(' | '\'' | '"' | '<'))
        {
            return None;
        }
        Some((start, start + value.len(), end + 1))
    }
}

/// Comments and ordinary strings are copied untouched. All URL tokens in a
/// downloaded sheet are font requests, except @import which is stylesheet-only.
/// Unapproved relative URLs become absolute remote URLs, so they cannot resolve
/// against the local capability endpoint and accidentally hit the source app.
fn rewrite_css(
    text: &str,
    base: &Url,
    proxy: &str,
    origins: &[String],
    external: bool,
) -> Option<String> {
    // Preserve the typography-only parser's existing strict grammar.
    if text.contains('\\') || external && text.contains('<') {
        return None;
    }
    rewrite_css_with(text, external, &|value, kind| {
        mapped(value, base, proxy, origins, kind).or_else(|| {
            external.then(|| {
                resolved(value, base)
                    .map(|url| css_safe_url(url.as_str()))
                    .unwrap_or_else(|| BLOCKED.into())
            })
        })
    })
}

pub(super) fn rewrite_css_with(
    text: &str,
    external: bool,
    map: &impl Fn(&str, Kind) -> Option<String>,
) -> Option<String> {
    if text.contains('\0') {
        return None;
    }
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut copied = 0;
    let mut output = String::with_capacity(text.len());
    while i < text.len() {
        // Slice only at ASCII token starts (i may be within UTF-8 otherwise).
        if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i += text[i + 2..].find("*/")? + 4;
            continue;
        }
        if matches!(bytes[i], b'\'' | b'"') {
            i = css_string(text, i)?.2;
            continue;
        }
        let boundary = i == 0 || !identifier(bytes[i - 1]);
        if boundary && (identifier(bytes[i]) || bytes[i] == b'\\') {
            let (end, escaped) = css_identifier(text, i)?;
            if escaped {
                if bytes.get(end) == Some(&b'(') || (i > 0 && bytes[i - 1] == b'@') {
                    return None;
                }
                i = end;
                continue;
            }
            // These functions can treat plain strings as resource URLs.
            // Refuse unsupported grammar rather than letting a relative
            // string resolve against the authenticated source application's
            // loopback origin. Ordinary strings/local() do not fetch URLs.
            if external
                && bytes.get(end) == Some(&b'(')
                && matches!(
                    &lower[i..end],
                    "image-set" | "-webkit-image-set" | "image" | "src"
                )
            {
                return None;
            }
            // Consume non-URL identifiers as complete UTF-8 tokens. Revisiting
            // continuation bytes would not be a valid string slicing boundary.
            if &lower[i..end] != "url" || bytes.get(end) != Some(&b'(') {
                i = end;
                continue;
            }
        }
        let import = bytes[i] == b'@'
            && lower[i..].starts_with("@import")
            && !bytes.get(i + 7).is_some_and(|b| identifier(*b));
        let url_token =
            boundary && matches!(bytes[i], b'u' | b'U') && lower[i..].starts_with("url(");
        let (range, kind) = if import {
            let value = trivia(text, i + 7)?;
            let range = if lower[value..].starts_with("url(") {
                css_url(text, value)?
            } else {
                css_string(text, value)?
            };
            (range, Kind::Stylesheet)
        } else if url_token {
            (css_url(text, i)?, Kind::Font)
        } else {
            i += 1;
            continue;
        };
        let (from, to, end) = range;
        let value = &text[from..to];
        let replacement = map(value, kind);
        if let Some(replacement) = replacement {
            output.push_str(&text[copied..from]);
            output.push_str(&replacement);
            copied = to;
        }
        i = end;
        if output.len() > MAX_CSS * 4 {
            return None;
        }
    }
    output.push_str(&text[copied..]);
    Some(output)
}

struct Attribute<'a> {
    name: &'a str,
    start: usize,
    end: usize,
    quoted: bool,
}

fn attributes(tag: &str, name_end: usize) -> Option<Vec<Attribute<'_>>> {
    let bytes = tag.as_bytes();
    let mut i = name_end;
    let mut attributes = Vec::new();
    let mut names = HashSet::new();
    loop {
        i = whitespace(bytes, i);
        if matches!(&tag[i..], ">" | "/>") {
            return Some(attributes);
        }
        let name_start = i;
        while bytes
            .get(i)
            .is_some_and(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
        {
            i += 1;
        }
        if i == name_start {
            return None;
        }
        let name = &tag[name_start..i];
        if !names.insert(name.to_ascii_lowercase()) {
            return None;
        }
        i = whitespace(bytes, i);
        if bytes.get(i) != Some(&b'=') {
            continue;
        }
        i = whitespace(bytes, i + 1);
        let quoted = matches!(bytes.get(i), Some(b'\'' | b'"'));
        let start;
        let end;
        if quoted {
            let quote = bytes[i];
            start = i + 1;
            end = start + tag[start..].find(quote as char)?;
            i = end + 1;
            if !bytes
                .get(i)
                .is_some_and(|b| b.is_ascii_whitespace() || matches!(b, b'/' | b'>'))
            {
                return None;
            }
        } else {
            start = i;
            while bytes
                .get(i)
                .is_some_and(|b| !b.is_ascii_whitespace() && *b != b'>')
            {
                if matches!(bytes[i], b'\'' | b'"' | b'<' | b'=' | b'`') {
                    return None;
                }
                i += 1;
            }
            end = i;
            if start == end {
                return None;
            }
        }
        attributes.push(Attribute {
            name,
            start,
            end,
            quoted,
        });
    }
}

fn html_decode(value: &str) -> Option<String> {
    let mut output = String::new();
    let mut rest = value;
    while let Some(i) = rest.find('&') {
        output.push_str(&rest[..i]);
        rest = &rest[i + 1..];
        // A bare &name=value in an HTML attribute is literal (the '=' also
        // prevents a legacy semicolon-less named reference). Google Fonts
        // links commonly use this form for &display=swap.
        let name_end = rest.bytes().take_while(u8::is_ascii_alphanumeric).count();
        if name_end > 0 && rest.as_bytes().get(name_end) == Some(&b'=') {
            output.push('&');
            continue;
        }
        let end = rest.find(';')?;
        let entity = &rest[..end];
        let c = match entity {
            "amp" => '&',
            "quot" => '"',
            "apos" | "#39" => '\'',
            "lt" => '<',
            "gt" => '>',
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                char::from_u32(u32::from_str_radix(&entity[2..], 16).ok()?)?
            }
            _ if entity.starts_with('#') => char::from_u32(entity[1..].parse().ok()?)?,
            _ => return None,
        };
        output.push(c);
        rest = &rest[end + 1..];
    }
    output.push_str(rest);
    Some(output)
}

fn html_encode(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
fn rewrite_html(text: &str, base: &Url, proxy: &str, origins: &[String]) -> String {
    rewrite_html_with(text, &|value, kind| {
        mapped(value, base, proxy, origins, kind)
    })
}

pub(super) fn rewrite_html_with(text: &str, map: &impl Fn(&str, Kind) -> Option<String>) -> String {
    let lower = text.to_ascii_lowercase();
    let mut i = 0;
    let mut edits = Vec::new();
    while let Some(offset) = lower[i..].find('<') {
        let start = i + offset;
        if lower[start..].starts_with("<!--") {
            let Some(end) = lower[start + 4..].find("-->") else {
                break;
            };
            i = start + 4 + end + 3;
            continue;
        }
        let Some((name, closing, end)) = super::proxy_response::html_tag(&lower, start) else {
            break;
        };
        i = end;
        if closing || name.is_empty() {
            continue;
        }
        let tag = &text[start..end];
        if let Some(attrs) = attributes(tag, 1 + name.len()) {
            let attr = |name: &str| attrs.iter().find(|a| a.name.eq_ignore_ascii_case(name));
            let value = |name: &str| attr(name).and_then(|a| html_decode(&tag[a.start..a.end]));
            let kind = if name == "link" {
                let rel = value("rel").unwrap_or_default().to_ascii_lowercase();
                if rel.split_ascii_whitespace().any(|v| v == "stylesheet") {
                    Some(Kind::Stylesheet)
                } else if rel.split_ascii_whitespace().any(|v| v == "modulepreload") {
                    Some(Kind::Script)
                } else if rel.split_ascii_whitespace().any(|v| v == "preload") {
                    match value("as")
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                        .as_str()
                    {
                        "font" => Some(Kind::Font),
                        "style" => Some(Kind::Stylesheet),
                        "script" => Some(Kind::Script),
                        _ => None,
                    }
                } else {
                    None
                }
            } else if name == "script" {
                Some(Kind::Script)
            } else {
                None
            };
            for a in &attrs {
                let Some(value) = html_decode(&tag[a.start..a.end]) else {
                    continue;
                };
                let replacement = if (name == "link" && a.name.eq_ignore_ascii_case("href"))
                    || (name == "script" && a.name.eq_ignore_ascii_case("src"))
                {
                    kind.and_then(|kind| map(&value, kind))
                } else if a.name.eq_ignore_ascii_case("style") {
                    rewrite_css_with(&value, false, map).filter(|s| s != &value)
                } else {
                    None
                };
                if let Some(replacement) = replacement {
                    let encoded = html_encode(&replacement);
                    edits.push((
                        start + a.start,
                        start + a.end,
                        if a.quoted {
                            encoded
                        } else {
                            format!("\"{encoded}\"")
                        },
                    ));
                }
            }
        }
        // Do not interpret apparent tags in raw text, scripts, or RCDATA.
        if matches!(
            name,
            "script"
                | "style"
                | "textarea"
                | "title"
                | "xmp"
                | "iframe"
                | "noembed"
                | "noframes"
                | "plaintext"
        ) {
            if name == "plaintext" {
                break;
            }
            let close = format!("</{name}");
            let mut scan = end;
            while let Some(offset) = lower[scan..].find(&close) {
                let at = scan + offset;
                if let Some((closed, true, close_end)) = super::proxy_response::html_tag(&lower, at)
                {
                    if closed == name
                        && lower
                            .as_bytes()
                            .get(at + close.len())
                            .is_some_and(|b| b.is_ascii_whitespace() || matches!(b, b'/' | b'>'))
                    {
                        if name == "style" {
                            if let Some(css) = rewrite_css_with(&text[end..at], false, map) {
                                if css != text[end..at] {
                                    edits.push((end, at, css));
                                }
                            }
                        }
                        i = close_end;
                        break;
                    }
                }
                scan = at + close.len();
            }
            if i == end {
                break;
            }
        }
    }
    let mut output = String::with_capacity(text.len());
    let mut copied = 0;
    for (start, end, replacement) in edits {
        output.push_str(&text[copied..start]);
        output.push_str(&replacement);
        copied = end;
    }
    output.push_str(&text[copied..]);
    output
}

#[cfg(test)]
pub(super) fn rewrite(
    text: &str,
    content_type: Option<&str>,
    base: &Url,
    proxy_origin: &str,
    policy: &HttpProxyPolicy,
) -> String {
    let Some(origins) = effective_origins(policy) else {
        return text.into();
    };
    let mime = content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if mime.eq_ignore_ascii_case("text/css") {
        rewrite_css(text, base, proxy_origin, &origins, false).unwrap_or_else(|| text.into())
    } else if mime.eq_ignore_ascii_case("text/html") {
        rewrite_html(text, base, proxy_origin, &origins)
    } else {
        text.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> HttpProxyPolicy {
        HttpProxyPolicy {
            allow_external_fonts: true,
            external_font_origins: vec!["  HTTPS://Fonts.Example:443/  ".into()],
            ..Default::default()
        }
    }

    #[test]
    fn external_font_policy_is_backwards_compatible_canonical_and_bounded() {
        let old = r#"{"version":1,"pageScripts":"allow","httpsOnly":false,"sameOriginOnly":false,"cacheMode":"normal","queryParameters":[]}"#;
        let decoded: HttpProxyPolicy = serde_json::from_str(old).unwrap();
        assert!(decoded.allow_external_fonts);
        assert_eq!(
            decoded.external_font_origins,
            [
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net"
            ]
        );
        let target = Url::parse("https://source.example").unwrap();
        let policy = policy();
        assert!(policy.validate(&target).is_ok());
        let serialized = serde_json::to_value(&policy).unwrap();
        assert_eq!(serialized["allowExternalFonts"], true);
        assert!(serialized.get("externalFontOrigins").is_some());
        assert_eq!(
            canonical_origins(&policy.external_font_origins).unwrap(),
            ["https://fonts.example"]
        );
        for invalid in [
            "http://fonts.example",
            "https://u:p@fonts.example",
            "https://@fonts.example",
            "https://fonts.example/path",
            "https://fonts.example/.",
            "https://fonts.example/%2e/",
            "https://fonts.example?",
            "https://fonts.example#",
            "https://*.example",
            "https://%2a.example",
            "https://fonts.example\\",
            "\nhttps://fonts.example",
            "https://fonts.example\t",
            "",
        ] {
            let invalid = HttpProxyPolicy {
                external_font_origins: vec![invalid.into()],
                ..policy.clone()
            };
            assert!(
                invalid.validate(&target).is_err(),
                "{:?}",
                invalid.external_font_origins
            );
        }
        assert!(canonical_origins(&[
            "https://fonts.example".into(),
            " HTTPS://FONTS.EXAMPLE:443/ ".into()
        ])
        .is_err());
        assert!(canonical_origins(
            &(0..17)
                .map(|i| format!("https://font{i}.example"))
                .collect::<Vec<_>>()
        )
        .is_err());
        assert!(
            canonical_origins(&[format!("{}https://fonts.example", " ".repeat(MAX_URL))]).is_err()
        );
    }

    #[test]
    fn manifest_absence_and_same_origin_override_are_exact() {
        let mut policy = policy();
        let expected = serde_json::json!({"version":1,"origins":["https://fonts.example"],
            "proxyEndpoint":"http://proxy.local/__sortofremoteng_assets_v1/external-font"});
        assert_eq!(manifest(&policy, "http://proxy.local"), Some(expected));
        policy.same_origin_only = true;
        assert!(manifest(&policy, "http://proxy.local").is_none());
        policy.same_origin_only = false;
        policy.allow_external_fonts = false;
        assert!(manifest(&policy, "http://proxy.local").is_none());
        assert!(manifest(&HttpProxyPolicy::default(), "http://proxy.local").is_some());
    }

    #[test]
    fn css_parser_handles_imports_relative_urls_strings_comments_and_blocks_escapes() {
        let base = Url::parse("https://fonts.example/nested/style.css").unwrap();
        let origins = vec!["https://fonts.example".into()];
        let css = "/* url('ignore') */ @import /* comment */ '../next.css' screen; @IMPORT url(./more.css); @font-face { src: local('Inter'), URL('../fonts/a.woff2'); } .x{content:\"url('untouched')\";--label:'日本語'; background:url(https://denied.example/image.svg)}";
        let output = rewrite_css(css, &base, "http://proxy.local", &origins, true).unwrap();
        assert!(output.contains("%2Fnext.css&kind=stylesheet"));
        assert!(output.contains("%2Fnested%2Fmore.css&kind=stylesheet"));
        assert!(output.contains("%2Ffonts%2Fa.woff2&kind=font"));
        assert!(output.contains("/* url('ignore') */"));
        assert!(output.contains("content:\"url('untouched')\""));
        assert!(output.contains("https://denied.example/image.svg"));
        assert!(rewrite_css(
            r"@import '\68ttps://fonts.example/a';",
            &base,
            "http://proxy.local",
            &origins,
            true
        )
        .is_none());
        assert!(rewrite_css(
            "url('unterminated)",
            &base,
            "http://proxy.local",
            &origins,
            true
        )
        .is_none());
        for function in ["image-set", "-webkit-image-set", "image", "src"] {
            assert!(rewrite_css(
                &format!(".a{{background:{function}('/source-private')}}"),
                &base,
                "http://proxy.local",
                &origins,
                true,
            )
            .is_none());
        }
        for denied in [
            "http://fonts.example/a",
            "https://u:p@fonts.example/a",
            "//u:p@fonts.example/a",
            "data:font/woff2;base64,a",
            "javascript:alert(1)",
        ] {
            let output = rewrite_css(
                &format!("url('{denied}')"),
                &base,
                "http://proxy.local",
                &origins,
                true,
            )
            .unwrap();
            assert!(!output.contains(PATH));
        }
        let empty: Vec<String> = vec![];
        assert_eq!(
            rewrite_css(
                "url(../unapproved.woff2)",
                &base,
                "http://proxy.local",
                &empty,
                true
            )
            .unwrap(),
            "url(https://fonts.example/unapproved.woff2)"
        );
    }

    #[test]
    fn unsupported_html_entities_or_css_escapes_never_acquire_a_capability() {
        let base = Url::parse("https://source.example/").unwrap();
        let input = r#"<!-- <link rel="stylesheet" href="https://fonts.example/a"> --><script>const t='<link rel="stylesheet" href="https://fonts.example/a">';</script><link rel="stylesheet" href="https://fonts.example/a&unknown;"><div style="src:url('https://fonts.example/\61.woff2')"></div>"#;
        assert_eq!(
            rewrite(
                input,
                Some("text/html"),
                &base,
                "http://proxy.local",
                &policy()
            ),
            input
        );
        let html = "<link REL=stylesheet HREF=https://fonts.example/css><link rel=preload as=font href=https://fonts.example/a.woff2>";
        let output = rewrite(
            html,
            Some("text/html"),
            &base,
            "http://proxy.local",
            &policy(),
        );
        assert!(output.contains("kind=stylesheet\""));
        assert!(output.contains("kind=font\""));
        let bare_query =
            r#"<link rel="stylesheet" href="https://fonts.example/css?family=Inter&display=swap">"#;
        assert!(rewrite(
            bare_query,
            Some("text/html"),
            &base,
            "http://proxy.local",
            &policy()
        )
        .contains("family%3DInter%26display%3Dswap&amp;kind=stylesheet"));
        let disabled = HttpProxyPolicy {
            same_origin_only: true,
            ..policy()
        };
        assert_eq!(
            rewrite(
                html,
                Some("text/html"),
                &base,
                "http://proxy.local",
                &disabled
            ),
            html
        );
    }

    #[test]
    fn binary_magic_and_container_size_accept_woff_ttf_otf_and_reject_masquerades() {
        for magic in [b"\0\x01\0\0", b"OTTO"] {
            let mut bytes = vec![0; 32];
            bytes[..4].copy_from_slice(magic);
            bytes[4..6].copy_from_slice(&1u16.to_be_bytes());
            bytes[20..24].copy_from_slice(&28u32.to_be_bytes());
            bytes[24..28].copy_from_slice(&4u32.to_be_bytes());
            assert!(font_type(&bytes).is_some());
            bytes[24..28].copy_from_slice(&u32::MAX.to_be_bytes());
            assert!(font_type(&bytes).is_none());
        }
        let mut woff = vec![0; 68];
        woff[..4].copy_from_slice(b"wOFF");
        woff[4..8].copy_from_slice(b"OTTO");
        woff[8..12].copy_from_slice(&68u32.to_be_bytes());
        woff[12..14].copy_from_slice(&1u16.to_be_bytes());
        woff[16..20].copy_from_slice(&32u32.to_be_bytes());
        woff[48..52].copy_from_slice(&64u32.to_be_bytes());
        woff[52..56].copy_from_slice(&4u32.to_be_bytes());
        woff[56..60].copy_from_slice(&4u32.to_be_bytes());
        assert_eq!(font_type(&woff), Some("font/woff"));
        woff[8..12].copy_from_slice(&67u32.to_be_bytes());
        assert!(font_type(&woff).is_none());
        for invalid in [
            b"<html>font masquerade</html>".as_slice(),
            b"<svg>font masquerade</svg>",
            b"wOF2invalid",
            b"ttcfunsupported",
        ] {
            assert!(font_type(invalid).is_none());
        }
    }
}
