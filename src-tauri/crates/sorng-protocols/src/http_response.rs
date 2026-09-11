//! Bounded decoding of editable proxy documents. Opaque payloads retain their
//! original bytes and Content-Encoding; only HTML/CSS/JavaScript are decoded.

use axum::http::HeaderMap;
use std::io::Read;

pub(super) const MAX_EDITABLE_BODY_BYTES: usize = 32 * 1024 * 1024;
pub(super) const ACCEPT_ENCODING: &str = "gzip, deflate";
const NAVIGATION_MARKER: &str = "__sorng_navigation_v1";

/// Keep absolute URLs absolute: app scripts commonly pass these strings to
/// URL() without a base. Removing the origin breaks those scripts. Never turn
/// a different authority with a matching prefix into a local proxy address.
pub(super) fn rewrite_target_origin(text: &str, target: &str, proxy: &str) -> String {
    if target.is_empty() || proxy.is_empty() {
        return text.to_string();
    }
    let mut output = String::with_capacity(text.len());
    let mut copied = 0;
    for (start, _) in text.match_indices(target) {
        let end = start + target.len();
        let boundary = text[end..].chars().next();
        if boundary.is_some_and(|c| {
            !matches!(
                c,
                '/' | '?' | '#' | '\'' | '"' | '`' | '<' | '>' | ')' | ']' | '}' | ';' | ','
            ) && !c.is_ascii_whitespace()
        }) {
            continue;
        }
        output.push_str(&text[copied..start]);
        output.push_str(proxy);
        copied = end;
    }
    output.push_str(&text[copied..]);
    output
}

// Versioned compatibility fix for Synology's published QuickConnect client:
// https://quickconnect.to/connect_lib.da3fae9c5d057ef58d3a.bundle.js
// The separate error page bundles the same cached URL utility. It needs its
// own versioned adapter or the error title/retry fall back to the proxy nonce.
// https://quickconnect.to/error.5f00273a9cb73fd1c411.bundle.js
// Its redirect() appends location.port to location.host (which includes port),
// yielding an invalid double-port URL on our ephemeral loopback authority.
const QUICKCONNECT_REDIRECT_HEAD: &str = r#"key:"redirect",value:function(t){var e=t.protocol,n=void 0===e?window.location.protocol:e,r=t.ip,o=void 0===r?window.location.host:r,u=t.port,f=void 0===u?window.location.port:u"#;
const QUICKCONNECT_REDIRECT_DEFAULTS: &str = r#"key:"redirect",value:function(t){var __sorng_qc_origin=new URL(__SORNG_QUICKCONNECT_SOURCE_ORIGIN__),e=t.protocol,n=void 0===e?__sorng_qc_origin.protocol:e,r=t.ip,o=void 0===r?__sorng_qc_origin.hostname:r,u=t.port,f=void 0===u?__sorng_qc_origin.port:u"#;
const QUICKCONNECT_SOURCE_URL: &str = "i=new URL(window.location.href),u=function()";
const QUICKCONNECT_SOURCE_PROJECTION: &str = r#"i=(function(){var u=new URL(__SORNG_QUICKCONNECT_SOURCE_ORIGIN__);u.pathname=window.location.pathname;u.search=window.location.search.slice(1).split('&').filter(function(v){return v.split('=')[0]!=='__sorng_navigation_v1';}).join('&');u.hash=window.location.hash;return u;})(),u=function()"#;
const QUICKCONNECT_ASSIGN: &str = "window.location.assign(P),this.refreshLoadingImage()";
const QUICKCONNECT_RETRY_ASSIGN: &str = "window.location.href=n}}]),t}();e.default=u}";
const QUICKCONNECT_ERROR_ID: &str =
    r#"key:"getQuickConnectID",value:function(){return s.default.getHost().split(".")[0]}"#;

pub(super) fn repair_quickconnect_redirect(
    text: &str,
    request_url: &str,
    content_type: Option<&str>,
) -> String {
    let javascript = content_type
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "application/javascript" | "text/javascript"
            )
        });
    let Ok(url) = reqwest::Url::parse(request_url) else {
        return text.to_string();
    };
    let known_host = url.host_str().is_some_and(|host| {
        ["quickconnect.to", "quickconnect.cn"]
            .iter()
            .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
    });
    if !javascript
        || !known_host
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || text.matches(QUICKCONNECT_SOURCE_URL).count() != 1
        || text.matches(QUICKCONNECT_RETRY_ASSIGN).count() != 1
    {
        return text.to_string();
    }
    let connecting_page = match url.path() {
        "/connect_lib.da3fae9c5d057ef58d3a.bundle.js"
            if text.matches(QUICKCONNECT_REDIRECT_HEAD).count() == 1
                && text.matches(QUICKCONNECT_ASSIGN).count() == 1 =>
        {
            true
        }
        "/error.5f00273a9cb73fd1c411.bundle.js"
            if text.matches(QUICKCONNECT_ERROR_ID).count() == 1 =>
        {
            false
        }
        _ => return text.to_string(),
    };
    let source_origin = serde_json::to_string(&url.origin().ascii_serialization()).unwrap();
    // QuickConnect reads this cached URL to discover the NAS alias/service.
    // Keep the real window Location unchanged, and preserve the page's path,
    // query and hash rather than substituting the script asset's URL.
    let projection = QUICKCONNECT_SOURCE_PROJECTION
        .replace("__SORNG_QUICKCONNECT_SOURCE_ORIGIN__", &source_origin);
    let defaults = QUICKCONNECT_REDIRECT_DEFAULTS
        .replace("__SORNG_QUICKCONNECT_SOURCE_ORIGIN__", &source_origin);
    let navigation = include_str!("quickconnect_navigation_client.js")
        .replace("__SORNG_QUICKCONNECT_SOURCE_ORIGIN__", &source_origin);
    let projected = text.replacen(QUICKCONNECT_SOURCE_URL, &projection, 1);
    let projected = if connecting_page {
        projected.replacen(QUICKCONNECT_REDIRECT_HEAD, &defaults, 1).replacen(
            QUICKCONNECT_ASSIGN,
            &format!("window.location.assign((function(){{{navigation};return sorngQuickConnectNavigation(P);}})()),this.refreshLoadingImage()"),
            1,
        )
    } else {
        projected
    };
    projected.replacen(
            QUICKCONNECT_RETRY_ASSIGN,
            &format!("window.location.href=(function(){{{navigation};return sorngQuickConnectNavigation(n);}})()}}}}]),t}}();e.default=u}}"),
            1,
        )
}

/// Content-Type alone does not distinguish a page from jQuery HTML fragments or
/// pipe-delimited dashboard stats. Explicit non-navigation metadata always wins.
pub(super) fn is_document_request(headers: &HeaderMap, navigation_token: Option<&str>) -> bool {
    if headers.contains_key("x-requested-with") {
        return false;
    }
    let value = |name| headers.get(name).and_then(|value| value.to_str().ok());
    if let Some(destination) = value("sec-fetch-dest") {
        if !matches!(destination, "document" | "iframe" | "frame") {
            return false;
        }
        return value("sec-fetch-mode").is_none_or(|mode| mode == "navigate");
    }
    if headers.contains_key("sec-fetch-dest") {
        return false;
    }
    if let Some(mode) = value("sec-fetch-mode") {
        return mode == "navigate";
    }
    if headers.contains_key("sec-fetch-mode") {
        return false;
    }
    if navigation_token.is_some() {
        return true;
    }
    // Older WebViews can lack Fetch Metadata. Their normal navigation request
    // still explicitly upgrades and negotiates HTML. Accept alone is not enough.
    value("upgrade-insecure-requests") == Some("1")
        && value("accept").is_some_and(|accept| {
            accept.split(',').any(|part| {
                part.split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/html"))
            })
        })
}

pub(super) fn is_html(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|ct| ct.split(';').next())
        .is_some_and(|ct| ct.trim().eq_ignore_ascii_case("text/html"))
}

/// Remove only csrf-magic's independently published, standalone frame-breaker.
/// CSRF token generation, hidden inputs, and every other script remain intact.
/// Source: pfsense/pfsense src/usr/local/www/csrf/csrf-magic.php (csrf_ob_handler).
/// Raw-text elements, comments, and inert templates are never rewritten.
pub(super) fn remove_known_framebreaker(html: &str) -> String {
    const BODY: &str = "if (top != self) {top.location.href = self.location.href;}";
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0;
    let mut copied = 0;
    let mut templates = 0usize;
    let mut result = String::with_capacity(html.len());
    while let Some(offset) = lower[cursor..].find('<') {
        let start = cursor + offset;
        if lower[start..].starts_with("<!--") {
            let Some(end) = lower[start + 4..].find("-->") else {
                break;
            };
            cursor = start + 4 + end + 3;
            continue;
        }
        if lower[start..].starts_with("<![cdata[") {
            let Some(end) = lower[start + 9..].find("]]>") else {
                break;
            };
            cursor = start + 9 + end + 3;
            continue;
        }
        let Some((name, closing, end)) = html_tag(&lower, start) else {
            break;
        };
        cursor = end;
        if name == "template" {
            templates = if closing {
                templates.saturating_sub(1)
            } else {
                templates.saturating_add(1)
            };
            continue;
        }
        if closing {
            continue;
        }
        if name == "plaintext" {
            break;
        }
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
                | "noscript"
        ) {
            let closing_prefix = format!("</{name}");
            let mut search = end;
            let closing_tag = loop {
                let Some(offset) = lower[search..].find(&closing_prefix) else {
                    break None;
                };
                let close = search + offset;
                if let Some((closed_name, true, close_end)) = html_tag(&lower, close) {
                    if closed_name == name {
                        break Some((close, close_end));
                    }
                }
                search = close + closing_prefix.len();
            };
            let Some((close, close_end)) = closing_tag else {
                break;
            };
            // Match exact publisher opening/body forms; no JS substring surgery.
            let opening = &lower[start..end];
            let known_opening = matches!(
                opening,
                "<script>"
                    | "<script type=\"text/javascript\">"
                    | "<script type='text/javascript'>"
            );
            if templates == 0
                && name == "script"
                && known_opening
                && html[end..close].trim() == BODY
            {
                result.push_str(&html[copied..start]);
                copied = close_end;
            }
            cursor = close_end;
        }
    }
    result.push_str(&html[copied..]);
    result
}

fn html_tag(html: &str, start: usize) -> Option<(&str, bool, usize)> {
    let bytes = html.as_bytes();
    let mut cursor = start + 1;
    let closing = bytes.get(cursor) == Some(&b'/');
    if closing {
        cursor += 1;
    }
    let name_start = cursor;
    while bytes
        .get(cursor)
        .is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'-')
    {
        cursor += 1;
    }
    let name = &html[name_start..cursor];
    let mut quote = None;
    while let Some(&byte) = bytes.get(cursor) {
        if let Some(delimiter) = quote {
            if byte == delimiter {
                quote = None;
            }
        } else if byte == b'\'' || byte == b'"' {
            quote = Some(byte);
        } else if byte == b'>' {
            return Some((name, closing, cursor + 1));
        }
        cursor += 1;
    }
    None
}

/// Strip the loopback-only marker before routing, forwarding, or logging. A
/// duplicate/malformed marker cannot authenticate a readiness notification.
pub(super) fn navigation_request(path_and_query: &str) -> (String, Option<String>) {
    let Some((path, query)) = path_and_query.split_once('?') else {
        return (path_and_query.into(), None);
    };
    let mut kept = Vec::new();
    let mut markers = Vec::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == NAVIGATION_MARKER {
            markers.push(value);
        } else {
            kept.push(pair);
        }
    }
    let token = match markers.as_slice() {
        [value]
            if value.len() == 32
                && value
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) =>
        {
            Some((*value).to_string())
        }
        _ => None,
    };
    let path = if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    };
    (path, token)
}

pub(super) fn inject_readiness(
    html: &str,
    session_id: &str,
    token: Option<&str>,
    sequence: u64,
    source_origin: &str,
    proxy_origin: &str,
) -> String {
    if sequence == 0 || sequence > 9_007_199_254_740_991 {
        return html.to_string();
    }
    let payload = serde_json::json!({"version":1,
        "sessionId":session_id, "navigationToken":token,
        "documentToken":crate::themed_auth::fresh_nonce(), "documentSequence":sequence});
    let json = payload
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let script = format!(
        r#"<script>(function(){{'use strict';var p={json};
var u=new URL(location.href),q=u.search.slice(1).split('&').filter(function(v){{return v.split('=')[0]!=='{NAVIGATION_MARKER}';}}).join('&');
u.search=q?'?'+q:'';try{{history.replaceState(history.state,'',u.href);}}catch(_){{}}
function emit(type){{p.type=type;p.url=u.href;try{{window.parent.postMessage(p,'*');}}catch(_){{}}}}
{network_client}
window.addEventListener('beforeunload',function(){{emit('proxy_navigation_start');}});
{dark_mode_client}
{automation_client}
emit('proxy_document_start');
function ready(){{emit('proxy_dom_ready');}}
if(document.readyState==='loading'){{document.addEventListener('DOMContentLoaded',ready,{{once:true}});}}else{{ready();}}
}})();</script>"#,
        automation_client = include_str!("web_automation_client.js"),
        dark_mode_client = include_str!("web_dark_mode_client.js"),
        network_client =
            super::network::bootstrap(session_id, sequence, source_origin, proxy_origin),
    );
    let insertion = early_script_insertion(html);
    format!("{}{}{}", &html[..insertion], script, &html[insertion..])
}

fn early_script_insertion(html: &str) -> usize {
    let lower = html.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut cursor = 0;
    let mut fallback = 0;
    while let Some(offset) = lower[cursor..].find('<') {
        let start = cursor + offset;
        if lower[start..].starts_with("<!--") {
            let Some(end) = lower[start + 4..].find("-->") else {
                break;
            };
            cursor = start + 4 + end + 3;
            continue;
        }
        let mut end = start + 1;
        let mut quote = None;
        while end < bytes.len() {
            let c = bytes[end];
            if let Some(q) = quote {
                if c == q {
                    quote = None;
                }
            } else if c == b'\'' || c == b'"' {
                quote = Some(c);
            } else if c == b'>' {
                break;
            }
            end += 1;
        }
        if end == bytes.len() {
            break;
        }
        let name = lower[start + 1..end]
            .split(|c: char| c.is_ascii_whitespace() || c == '/')
            .next()
            .unwrap_or("");
        match name {
            "head" => return end + 1,
            "script" => return start,
            "body" => return end + 1,
            "!doctype" | "html" => fallback = end + 1,
            _ => {}
        }
        cursor = end + 1;
    }
    fallback
}

pub(super) fn is_editable(content_type: Option<&str>) -> bool {
    matches!(
        content_type.and_then(|s| s.split(';').next()).map(str::trim),
        Some(s) if s.eq_ignore_ascii_case("text/html")
            || s.eq_ignore_ascii_case("text/css")
            || s.eq_ignore_ascii_case("application/javascript")
            || s.eq_ignore_ascii_case("text/javascript")
    )
}

pub(super) async fn read_body(
    mut response: reqwest::Response,
    headers: &HeaderMap,
    editable: bool,
) -> Result<Vec<u8>, &'static str> {
    if !editable {
        return response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|_| "Unable to read the upstream response body");
    }
    if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        return Err("Partial HTML, CSS, or JavaScript responses cannot be safely rewritten");
    }
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Err("The upstream returned a cache-only document without a usable response body");
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_EDITABLE_BODY_BYTES as u64)
    {
        return Err("The upstream document exceeds the 32 MiB editable response limit");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Unable to read the upstream response body")?
    {
        if chunk.len() > MAX_EDITABLE_BODY_BYTES - bytes.len() {
            return Err("The upstream document exceeds the 32 MiB editable response limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    // HEAD/204/304 carry no representation to decode.
    if bytes.is_empty() {
        return Ok(bytes);
    }
    decode_body(bytes, headers, MAX_EDITABLE_BODY_BYTES)
}

fn decode_body(bytes: Vec<u8>, headers: &HeaderMap, limit: usize) -> Result<Vec<u8>, &'static str> {
    let mut encodings = Vec::new();
    for header in headers.get_all("content-encoding") {
        let value = header
            .to_str()
            .map_err(|_| "Invalid upstream Content-Encoding")?;
        for encoding in value.split(',') {
            if encodings.len() >= 4 {
                return Err("Too many upstream content encodings");
            }
            let encoding = encoding.trim().to_ascii_lowercase();
            if !matches!(
                encoding.as_str(),
                "identity" | "gzip" | "x-gzip" | "deflate"
            ) {
                return Err("Unsupported upstream document encoding; only identity, gzip, and deflate are supported");
            }
            encodings.push(encoding);
        }
    }
    let mut decoded = bytes;
    for encoding in encodings.iter().rev() {
        decoded = match encoding.as_str() {
            "gzip" | "x-gzip" => {
                bounded_read(flate2::read::MultiGzDecoder::new(decoded.as_slice()), limit)?
            }
            "deflate" => bounded_read(flate2::read::ZlibDecoder::new(decoded.as_slice()), limit)?,
            _ => decoded,
        };
    }
    Ok(decoded)
}

fn bounded_read(reader: impl Read, limit: usize) -> Result<Vec<u8>, &'static str> {
    let mut out = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| "Malformed or truncated upstream compressed document")?;
    if out.len() > limit {
        return Err("The decoded document exceeds the 32 MiB editable response limit");
    }
    Ok(out)
}

/// Representation metadata describes the original bytes, not our rewritten
/// document. Do not advertise upstream validators or ranges for different bytes.
pub(super) fn invalidated_header(name: &str) -> bool {
    matches!(
        name,
        "content-encoding"
            | "content-length"
            | "content-md5"
            | "digest"
            | "content-digest"
            | "repr-digest"
            | "etag"
            | "accept-ranges"
            | "content-range"
            | "last-modified"
            | "cache-control"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn absolute_origin_rewrites_preserve_urls_and_foreign_authorities() {
        let source = "https://nas.example";
        let proxy = "http://p0123456789abcdef0123456789abcdef.localhost:54362";
        let body = format!(
            "const base='{source}';const url=new URL('{source}/api?x=1#part');<a href=\"{source}/\">open</a>body{{background:url({source}/a.png)}}"
        );
        let rewritten = rewrite_target_origin(&body, source, proxy);
        assert_eq!(rewritten, body.replace(source, proxy));
        let endpoint = rewritten
            .split("new URL('")
            .nth(1)
            .unwrap()
            .split('\'')
            .next()
            .unwrap();
        let parsed = reqwest::Url::parse(endpoint).unwrap();
        assert_eq!(parsed.origin().ascii_serialization(), proxy);
        assert_eq!(parsed.path(), "/api");
        assert_eq!(parsed.query(), Some("x=1"));
        for foreign in [
            format!("{source}.attacker.example/api"),
            format!("{source}:8443/api"),
            format!("{source}@attacker.example/api"),
            format!("{source}%2eattacker.example/api"),
            format!("{source}suffix/api"),
        ] {
            assert_eq!(rewrite_target_origin(&foreign, source, proxy), foreign);
        }
        assert_eq!(rewrite_target_origin(&body, "", proxy), body);
    }

    #[test]
    fn quickconnect_double_port_repair_is_asset_host_and_source_bounded() {
        let asset = "/connect_lib.da3fae9c5d057ef58d3a.bundle.js";
        let text = format!("before({QUICKCONNECT_REDIRECT_HEAD},l=t.path;{QUICKCONNECT_ASSIGN};after);var {QUICKCONNECT_SOURCE_URL}{{}};{QUICKCONNECT_RETRY_ASSIGN}");
        for host in [
            "quickconnect.to",
            "nas.fr3.quickconnect.to",
            "nas.quickconnect.cn",
        ] {
            let result = repair_quickconnect_redirect(
                &text,
                &format!("https://{host}{asset}"),
                Some("application/javascript; charset=utf-8"),
            );
            assert!(result.contains("__sorng_qc_origin.hostname:r"));
            assert!(result.contains(&format!("new URL(\"https://{host}\")")));
            assert!(result.contains("/__sortofremoteng_quickconnect_redirect_v1"));
            assert!(!result.contains(QUICKCONNECT_ASSIGN));
            assert!(!result.contains(QUICKCONNECT_SOURCE_URL));
            assert!(!result.contains(QUICKCONNECT_RETRY_ASSIGN));
        }
        for (url, content_type) in [
            (
                format!("https://quickconnect.to.attacker.example{asset}"),
                "application/javascript",
            ),
            (
                format!("https://notquickconnect.to{asset}"),
                "application/javascript",
            ),
            (
                "https://quickconnect.to/different.bundle.js".into(),
                "application/javascript",
            ),
            (format!("https://quickconnect.to{asset}"), "text/html"),
        ] {
            assert_eq!(
                repair_quickconnect_redirect(&text, &url, Some(content_type)),
                text
            );
        }
        let url = format!("https://quickconnect.to{asset}");
        let duplicate = text.repeat(2);
        assert_eq!(
            repair_quickconnect_redirect(&duplicate, &url, Some("text/javascript")),
            duplicate
        );
        let changed = text.replace("u=t.port", "u=t.otherPort");
        assert_eq!(
            repair_quickconnect_redirect(&changed, &url, Some("text/javascript")),
            changed
        );
    }

    #[test]
    fn quickconnect_error_asset_preserves_vendor_errors_but_projects_alias_and_retry() {
        let text = format!(
            "{};{}",
            include_str!("../../../../tests/fixtures/quickconnect-url-module.fixture.js.txt"),
            include_str!("../../../../tests/fixtures/quickconnect-error-module.fixture.js.txt"),
        );
        let asset = "/error.5f00273a9cb73fd1c411.bundle.js";
        let url = format!("https://nas.quickconnect.to:5001{asset}");
        let result = repair_quickconnect_redirect(&text, &url, Some("text/javascript"));
        assert_ne!(result, text);
        assert!(result.contains("new URL(\"https://nas.quickconnect.to:5001\")"));
        assert!(result.contains("sorngQuickConnectNavigation(n)"));
        assert!(!result.contains(QUICKCONNECT_SOURCE_URL));
        assert!(!result.contains(QUICKCONNECT_RETRY_ASSIGN));
        // Error rendering remains the vendor's actual implementation. Do not
        // turn a genuine service/discovery failure into a successful login.
        assert!(result.contains(include_str!(
            "../../../../tests/fixtures/quickconnect-error-module.fixture.js.txt"
        )));
        for invalid_url in [
            format!("https://quickconnect.to.attacker.invalid{asset}"),
            format!("https://user:secret@nas.quickconnect.to{asset}"),
            "https://nas.quickconnect.to/error.changed.bundle.js".into(),
            format!("https://nas.quickconnect.to{asset}/extra"),
            "https://nas.quickconnect.to/connect_lib.da3fae9c5d057ef58d3a.bundle.js".into(),
        ] {
            assert_eq!(
                repair_quickconnect_redirect(&text, &invalid_url, Some("text/javascript")),
                text
            );
        }
        for altered in [
            text.repeat(2),
            text.replace(QUICKCONNECT_ERROR_ID, "key:\"changedErrorId\""),
            text.replace(QUICKCONNECT_SOURCE_URL, "changedCachedUrl"),
            text.replace(QUICKCONNECT_RETRY_ASSIGN, "changedRetryAssignment"),
        ] {
            assert_eq!(
                repair_quickconnect_redirect(&altered, &url, Some("text/javascript")),
                altered
            );
        }
        assert_eq!(
            repair_quickconnect_redirect(&text, &url, Some("text/html")),
            text
        );
    }

    #[test]
    fn only_navigation_requests_bootstrap_and_explicit_ajax_always_wins() {
        let mut headers = HeaderMap::new();
        assert!(!is_document_request(&headers, None));
        headers.insert("accept", "text/html,application/xhtml+xml".parse().unwrap());
        assert!(!is_document_request(&headers, None));
        assert!(is_document_request(&headers, Some("fixture")));
        headers.insert("upgrade-insecure-requests", "1".parse().unwrap());
        assert!(is_document_request(&headers, None));
        for destination in ["empty", "script", "style", "image", "", "unknown"] {
            headers.insert("sec-fetch-dest", destination.parse().unwrap());
            assert!(
                !is_document_request(&headers, Some("fixture")),
                "{destination}"
            );
        }
        for destination in ["document", "iframe", "frame"] {
            headers.insert("sec-fetch-dest", destination.parse().unwrap());
            assert!(is_document_request(&headers, None));
            headers.insert("sec-fetch-mode", "cors".parse().unwrap());
            assert!(!is_document_request(&headers, Some("fixture")));
            headers.insert("sec-fetch-mode", "navigate".parse().unwrap());
            assert!(is_document_request(&headers, None));
            headers.remove("sec-fetch-mode");
        }
        headers.insert("x-requested-with", "XMLHttpRequest".parse().unwrap());
        assert!(!is_document_request(&headers, Some("fixture")));
    }

    #[test]
    fn known_standalone_framebreaker_is_removed_without_changing_csrf_logic() {
        let blocker = "<script type=\"text/javascript\">if (top != self) {top.location.href = self.location.href;}</script>";
        let retained = "<script>var csrfMagicToken='fixture';CsrfMagic.end();</script><form method='post'><input type='hidden' name='__csrf_magic' value='fixture'></form>";
        let html = format!(
            "<!doctype html><html><head>{blocker}{blocker}</head><body>{retained}</body></html>"
        );
        let cleaned = remove_known_framebreaker(&html);
        assert_eq!(
            cleaned,
            format!("<!doctype html><html><head></head><body>{retained}</body></html>")
        );
    }

    #[test]
    fn quoted_commented_inert_and_unknown_framebreakers_are_preserved_verbatim() {
        let blocker = "<script type=\"text/javascript\">if (top != self) {top.location.href = self.location.href;}</script>";
        for html in [
            format!("<!-- {blocker} -->"),
            format!("<template><template>{blocker}</template>{blocker}</template>"),
            format!("<textarea>{blocker}</textarea><style>/*{blocker}*/</style>"),
            format!("<div title='{blocker}'>safe</div>"),
            format!("<script>const html = `{blocker}`;</script>"),
            format!("<script>const html = '{blocker}';</script>"),
            format!("<script>/*{blocker}*/</script>"),
            "<script>if (top !== self) { top.location = self.location; }</script>".to_string(),
            "<script>if (top != self) {top.location.href = self.location.href;}doMore();</script>".to_string(),
            "<script type='application/json'>if (top != self) {top.location.href = self.location.href;}</script>".to_string(),
            format!("<plaintext>{blocker}"),
        ] { assert_eq!(remove_known_framebreaker(&html), html); }
    }

    pub(crate) fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn decoding_is_bounded_and_rejects_malformed_or_unsupported_documents() {
        let mut headers = HeaderMap::new();
        headers.insert("content-encoding", "gzip".parse().unwrap());
        assert_eq!(decode_body(gzip(b"hello"), &headers, 5).unwrap(), b"hello");
        assert!(decode_body(gzip(b"hello!"), &headers, 5)
            .unwrap_err()
            .contains("limit"));
        let mut truncated = gzip(b"hello");
        truncated.truncate(truncated.len() - 4);
        assert!(decode_body(truncated, &headers, 32).is_err());
        assert!(decode_body(b"not gzip".to_vec(), &headers, 32).is_err());
        headers.insert("content-encoding", "br".parse().unwrap());
        assert!(decode_body(vec![1, 2, 3], &headers, 32)
            .unwrap_err()
            .contains("Unsupported"));
        headers.insert(
            "content-encoding",
            "gzip,gzip,gzip,gzip,gzip".parse().unwrap(),
        );
        assert!(decode_body(vec![], &headers, 32).is_err());
    }

    #[test]
    fn stacked_encodings_decode_in_reverse_order_and_check_checksums() {
        let mut encoder =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&gzip(b"stacked")).unwrap();
        let bytes = encoder.finish().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("content-encoding", "gzip, deflate".parse().unwrap());
        assert_eq!(
            decode_body(bytes.clone(), &headers, 100).unwrap(),
            b"stacked"
        );
        let mut corrupt = bytes;
        let last = corrupt.len() - 1;
        corrupt[last] ^= 1;
        assert!(decode_body(corrupt, &headers, 100).is_err());
    }

    #[test]
    fn early_reporter_preserves_doctype_and_ignores_comments_and_similar_tag_names() {
        for html in [
            "<!DOCTYPE html><!-- <head>fake</head> --><html><body>page</body></html>",
            "<!DOCTYPE html><!-- <script>fake</script> --><header>title</header>",
            "<!DOCTYPE html><html><head data-label='>'><script>app()</script></head></html>",
        ] {
            let result = inject_readiness(
                html,
                "fixture",
                Some("0123456789abcdef0123456789abcdef"),
                1,
                "https://device.test",
                "http://p0123456789abcdef0123456789abcdef.localhost:43123",
            );
            assert!(result.starts_with("<!DOCTYPE html>"));
            assert!(result.contains("proxy_dom_ready"));
            let injected = result.find("<script>(function()").unwrap();
            if let Some(comment) = result.find("<!--") {
                let comment_end = result.find("-->").unwrap();
                assert!(injected < comment || injected > comment_end);
            }
            if let Some(app) = result.find("<script>app()") {
                assert!(injected < app);
            }
            assert!(result
                .replace(
                    &result[injected..result[injected..].find("</script>").unwrap() + injected + 9],
                    ""
                )
                .eq(html));
        }
    }
}
