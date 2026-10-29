//! RFC 9111 private-cache semantics (`http-cache-semantics`, `shared: false`)
//! plus the app's conservative storage rules (plan §4).
//!
//! What is persisted per entry is a minimal request head (method, origin-form
//! URI, and SHA-256 digests of the request headers the response's `Vary`
//! nominates), the response head with `Set-Cookie` and hop-by-hop fields
//! removed, and the response time. `CachePolicy` is rebuilt from those on
//! every load; the crate's serde feature is not used.

use std::time::SystemTime;

use http_cache_semantics::{CacheOptions, CachePolicy};
use hyper::body::Bytes;
use hyper::http::{self, header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use sha2::{Digest, Sha256};

use crate::private_forward_proxy::Authority;

/// Hard per-entry ceiling; the effective limit is `min(this, max_bytes / 8)`.
pub(crate) const PER_ENTRY_MAX: u64 = 32 * 1024 * 1024;

/// Statuses the app stores (no 206 in v1).
const STORABLE_STATUSES: &[u16] = &[200, 203, 204, 300, 301, 308, 404, 410];

/// Request fields that steer freshness/revalidation and pass into the policy.
const POLICY_REQUEST_FIELDS: &[&str] = &[
    "cache-control",
    "pragma",
    "if-none-match",
    "if-modified-since",
    "if-match",
    "if-unmodified-since",
];

/// Never stored, never served from a stored head.
const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub(crate) fn per_entry_cap(max_bytes: u64) -> u64 {
    PER_ENTRY_MAX.min(max_bytes / 8)
}

pub(crate) fn options() -> CacheOptions {
    CacheOptions {
        shared: false,
        ..CacheOptions::default()
    }
}

/// A stored response head plus what is needed to rebuild its policy.
#[derive(Clone, Debug)]
pub(crate) struct StoredHead {
    pub method: Method,
    /// Origin-form (path and query) URI.
    pub uri: Uri,
    pub status: StatusCode,
    /// Only digests of the `Vary`-nominated request fields.
    pub req_headers: HeaderMap,
    pub res_headers: HeaderMap,
    pub response_time: SystemTime,
}

/// One cached response.
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub head: StoredHead,
    pub body: Bytes,
}

impl Entry {
    /// Approximate memory/disk footprint used for LRU accounting.
    pub(crate) fn weight(&self) -> u64 {
        let heads: usize = self
            .head
            .req_headers
            .iter()
            .chain(self.head.res_headers.iter())
            .map(|(n, v)| n.as_str().len() + v.len() + 4)
            .sum();
        (self.body.len() + heads + self.head.uri.to_string().len() + 64) as u64
    }
}

fn request_parts(method: Method, uri: Uri, headers: HeaderMap) -> http::request::Parts {
    let (mut parts, ()) = http::Request::new(()).into_parts();
    parts.method = method;
    parts.uri = uri;
    parts.headers = headers;
    parts
}

fn response_parts(status: StatusCode, headers: HeaderMap) -> http::response::Parts {
    let (mut parts, ()) = http::Response::new(()).into_parts();
    parts.status = status;
    parts.headers = headers;
    parts
}

/// Origin-form URI (path and query only); authority and scheme live in the key.
pub(crate) fn origin_form(uri: &Uri) -> Uri {
    let pq = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .filter(|pq| !pq.is_empty())
        .unwrap_or("/");
    pq.parse().unwrap_or_else(|_| Uri::from_static("/"))
}

/// The request scheme: absolute-form/h2 URIs carry it; an origin-form
/// request can only come from a TLS tunnel (plain-HTTP proxy requests are
/// absolute-form), so it is `https`.
pub(crate) fn request_scheme(uri: &Uri) -> String {
    uri.scheme_str().unwrap_or("https").to_ascii_lowercase()
}

/// The cache key (scheme, authority, method, path and query). Only GET and
/// HEAD are ever keyed.
pub(crate) fn cache_key(authority: &Authority, method: &Method, uri: &Uri) -> String {
    format!(
        "{}\n{authority}\n{method}\n{}",
        request_scheme(uri),
        origin_form(uri)
    )
}

pub(crate) fn is_safe(method: &Method) -> bool {
    matches!(
        *method,
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    )
}

/// Whether a request may be answered from, or stored into, the cache.
pub(crate) fn request_cacheable(req: &http::request::Parts) -> bool {
    (req.method == Method::GET || req.method == Method::HEAD)
        && !req.headers.contains_key(header::RANGE)
        && !req.headers.contains_key(header::IF_RANGE)
        && !req.headers.contains_key(header::UPGRADE)
        && !req.headers.contains_key("sec-websocket-key")
}

/// Lower-cased field names the response's `Vary` nominates; `None` for `*`
/// or an unparsable name (never stored).
fn vary_names(res: &HeaderMap) -> Option<Vec<HeaderName>> {
    let mut names = Vec::new();
    for value in res.get_all(header::VARY) {
        let value = value.to_str().ok()?;
        for name in value.split(',').map(str::trim).filter(|n| !n.is_empty()) {
            if name == "*" {
                return None;
            }
            names.push(HeaderName::from_bytes(name.to_ascii_lowercase().as_bytes()).ok()?);
        }
    }
    Some(names)
}

fn field_digest(req: &HeaderMap, name: &HeaderName) -> Option<HeaderValue> {
    let mut values = req.get_all(name).iter().peekable();
    values.peek()?;
    let mut hasher = Sha256::new();
    for value in values {
        hasher.update(value.as_bytes());
        hasher.update(b"\n");
    }
    HeaderValue::from_str(&hex::encode(hasher.finalize())).ok()
}

/// Request head stored with an entry: only `Vary` digests.
fn stored_request_headers(req: &HeaderMap, vary: &[HeaderName]) -> HeaderMap {
    let mut out = HeaderMap::new();
    for name in vary {
        if let Some(digest) = field_digest(req, name) {
            out.insert(name.clone(), digest);
        }
    }
    out
}

/// The live request as the policy sees it: freshness/conditional fields plus
/// digests of the fields the stored response varies on.
pub(crate) fn policy_request(
    live: &http::request::Parts,
    stored_res: &HeaderMap,
) -> http::request::Parts {
    let mut headers = HeaderMap::new();
    for name in POLICY_REQUEST_FIELDS {
        for value in live.headers.get_all(*name) {
            headers.append(*name, value.clone());
        }
    }
    // `Vary: *` entries are never stored, so `None` cannot occur here.
    for name in vary_names(stored_res).unwrap_or_default() {
        headers.remove(&name);
        if let Some(digest) = field_digest(&live.headers, &name) {
            headers.insert(name, digest);
        }
    }
    request_parts(live.method.clone(), origin_form(&live.uri), headers)
}

pub(crate) fn policy_for(head: &StoredHead) -> CachePolicy {
    let req = request_parts(
        head.method.clone(),
        head.uri.clone(),
        head.req_headers.clone(),
    );
    let res = response_parts(head.status, head.res_headers.clone());
    CachePolicy::new_options(&req, &res, head.response_time, options())
}

fn has_directive(res: &HeaderMap, directive: &str) -> bool {
    res.get_all(header::CACHE_CONTROL)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(|d| d.split('=').next().unwrap_or("").trim())
        .any(|d| d.eq_ignore_ascii_case(directive))
}

pub(crate) fn has_validator(res: &HeaderMap) -> bool {
    res.contains_key(header::ETAG) || res.contains_key(header::LAST_MODIFIED)
}

/// Removes everything that must never sit in a stored head.
pub(crate) fn strip_stored(headers: &mut HeaderMap) {
    let nominated: Vec<String> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(|n| n.trim().to_ascii_lowercase())
        .filter(|n| !n.is_empty())
        .collect();
    for name in nominated {
        headers.remove(name.as_str());
    }
    for name in HOP_BY_HOP {
        headers.remove(*name);
    }
    headers.remove(header::SET_COOKIE);
    headers.remove("set-cookie2");
}

fn content_type_is_event_stream(res: &HeaderMap) -> bool {
    res.get_all(header::CONTENT_TYPE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(|v| {
            v.split(';')
                .next()
                .is_some_and(|t| t.trim().eq_ignore_ascii_case("text/event-stream"))
        })
}

pub(crate) fn content_length(res: &HeaderMap) -> Option<u64> {
    res.get(header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Decides whether a response may be stored; returns the head to store.
///
/// `persistent == false` (temporary admission) is decided by the caller,
/// since memory-mode attempts may still keep such responses.
pub(crate) fn admit(
    req: &http::request::Parts,
    res: &http::response::Parts,
    now: SystemTime,
    entry_cap: u64,
) -> Option<StoredHead> {
    if !request_cacheable(req)
        || !STORABLE_STATUSES.contains(&res.status.as_u16())
        || res.headers.contains_key(header::UPGRADE)
        || res.headers.contains_key(header::CONTENT_RANGE)
        || content_type_is_event_stream(&res.headers)
        || content_length(&res.headers).is_some_and(|len| len > entry_cap)
    {
        return None;
    }
    let public = has_directive(&res.headers, "public");
    // Shared-cache rule applied deliberately to a private cache.
    if req.headers.contains_key(header::AUTHORIZATION)
        && !(public
            || has_directive(&res.headers, "s-maxage")
            || has_directive(&res.headers, "must-revalidate"))
    {
        return None;
    }
    if (res.headers.contains_key(header::SET_COOKIE) || res.headers.contains_key("set-cookie2"))
        && !public
    {
        return None;
    }
    let vary = vary_names(&res.headers)?;
    let policy = CachePolicy::new_options(&policy_request(req, &res.headers), res, now, options());
    if !policy.is_storable() {
        return None;
    }
    // Nothing to gain from an entry that is never fresh and cannot revalidate.
    if policy.time_to_live(now).is_zero() && !has_validator(&res.headers) {
        return None;
    }
    let mut res_headers = res.headers.clone();
    strip_stored(&mut res_headers);
    Some(StoredHead {
        method: req.method.clone(),
        uri: origin_form(&req.uri),
        status: res.status,
        req_headers: stored_request_headers(&req.headers, &vary),
        res_headers,
        response_time: now,
    })
}

/// Response head served from storage: stored fields (multi-values kept) with
/// `Age`/`Date`/`Warning` taken from the policy's computed head.
pub(crate) fn served_headers(stored: &HeaderMap, computed: &HeaderMap) -> HeaderMap {
    let mut out = stored.clone();
    strip_stored(&mut out);
    for name in [header::AGE, header::DATE, header::WARNING] {
        out.remove(&name);
        for value in computed.get_all(&name) {
            out.append(name.clone(), value.clone());
        }
    }
    out
}

/// RFC 9111 §4.3.4: fields of a matching 304 replace the stored ones, except
/// those describing the stored body.
pub(crate) fn merge_not_modified(stored: &HeaderMap, not_modified: &HeaderMap) -> HeaderMap {
    const KEEP: &[&str] = &[
        "content-length",
        "content-encoding",
        "transfer-encoding",
        "content-range",
    ];
    let mut out = stored.clone();
    for name in not_modified.keys() {
        if KEEP.contains(&name.as_str()) {
            continue;
        }
        out.remove(name);
        for value in not_modified.get_all(name) {
            out.append(name.clone(), value.clone());
        }
    }
    strip_stored(&mut out);
    out
}

/// Conditional request to send upstream: the live request with the policy's
/// validators (`If-None-Match` / `If-Modified-Since`), never `If-Range`.
pub(crate) fn conditional_request(
    live: &http::request::Parts,
    policy_req: &http::request::Parts,
) -> http::request::Parts {
    let mut out = live.clone();
    out.headers.remove(header::IF_RANGE);
    for name in [header::IF_NONE_MATCH, header::IF_MODIFIED_SINCE] {
        out.headers.remove(&name);
        for value in policy_req.headers.get_all(&name) {
            out.headers.append(name.clone(), value.clone());
        }
    }
    out
}

/// RFC 9111 §4.4: URIs an unsafe request invalidates (the target, plus a
/// same-authority `Location` / `Content-Location`). Each keeps its scheme
/// (a relative reference takes the request's) for `cache_key`.
pub(crate) fn invalidation_targets(
    authority: &Authority,
    req: &http::request::Parts,
    res: &HeaderMap,
) -> Vec<Uri> {
    let mut out = vec![req.uri.clone()];
    for name in [header::LOCATION, header::CONTENT_LOCATION] {
        let Some(uri) = res
            .get(&name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<Uri>().ok())
        else {
            continue;
        };
        let same_origin = match uri.authority() {
            None => uri.path().starts_with('/'),
            Some(target) => {
                let default_port = match uri.scheme_str() {
                    Some("http") => 80,
                    _ => 443,
                };
                let host = target.host().trim_start_matches('[').trim_end_matches(']');
                host.eq_ignore_ascii_case(authority.host())
                    && target.port_u16().unwrap_or(default_port) == authority.port()
            }
        };
        if !same_origin {
            continue;
        }
        if uri.scheme().is_some() {
            out.push(uri);
        } else if let Some(scheme) = req.uri.scheme_str() {
            let absolute = format!("{scheme}://{authority}{}", origin_form(&uri));
            if let Ok(absolute) = absolute.parse() {
                out.push(absolute);
            }
        } else {
            out.push(origin_form(&uri));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(method: Method, uri: &str, headers: &[(&str, &str)]) -> http::request::Parts {
        let mut map = HeaderMap::new();
        for (n, v) in headers {
            map.append(
                HeaderName::from_bytes(n.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        request_parts(method, uri.parse().unwrap(), map)
    }

    fn res(status: u16, headers: &[(&str, &str)]) -> http::response::Parts {
        let mut map = HeaderMap::new();
        for (n, v) in headers {
            map.append(
                HeaderName::from_bytes(n.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        response_parts(StatusCode::from_u16(status).unwrap(), map)
    }

    #[test]
    fn origin_form_and_key_drop_scheme_and_authority() {
        let a = Authority::parse("example.test:443").unwrap();
        let abs: Uri = "https://example.test/a?b=1".parse().unwrap();
        let rel: Uri = "/a?b=1".parse().unwrap();
        assert_eq!(
            cache_key(&a, &Method::GET, &abs),
            cache_key(&a, &Method::GET, &rel)
        );
        let plain: Uri = "http://example.test:443/a?b=1".parse().unwrap();
        assert_ne!(
            cache_key(&a, &Method::GET, &plain),
            cache_key(&a, &Method::GET, &rel),
            "http and https on one authority never collide"
        );
        assert_ne!(
            cache_key(&a, &Method::GET, &rel),
            cache_key(&a, &Method::HEAD, &rel)
        );
    }

    #[test]
    fn stored_request_keeps_only_vary_digests() {
        let r = req(
            Method::GET,
            "/x",
            &[
                ("cookie", "session=secret"),
                ("authorization", "Bearer t"),
                ("accept-language", "en"),
            ],
        );
        let s = res(
            200,
            &[
                ("cache-control", "max-age=60, public"),
                ("vary", "Accept-Language"),
                ("set-cookie", "a=b"),
                ("connection", "x-hop"),
                ("x-hop", "1"),
            ],
        );
        let head = admit(&r, &s, SystemTime::now(), 1 << 20).expect("stored");
        assert_eq!(head.req_headers.len(), 1);
        let digest = head.req_headers.get("accept-language").unwrap();
        assert_eq!(digest.len(), 64);
        assert!(!head.res_headers.contains_key("set-cookie"));
        assert!(!head.res_headers.contains_key("x-hop"));
        assert!(!head.res_headers.contains_key("connection"));
    }

    #[test]
    fn vary_star_and_unknown_status_are_not_stored() {
        let r = req(Method::GET, "/x", &[]);
        let now = SystemTime::now();
        assert!(admit(
            &r,
            &res(200, &[("cache-control", "max-age=60"), ("vary", "*")]),
            now,
            1 << 20
        )
        .is_none());
        assert!(admit(
            &r,
            &res(302, &[("cache-control", "max-age=60")]),
            now,
            1 << 20
        )
        .is_none());
        assert!(admit(
            &r,
            &res(200, &[("cache-control", "max-age=60")]),
            now,
            1 << 20
        )
        .is_some());
        assert!(admit(
            &req(Method::POST, "/x", &[]),
            &res(200, &[("cache-control", "max-age=60")]),
            now,
            1 << 20
        )
        .is_none());
    }

    #[test]
    fn invalidation_follows_same_origin_locations_only() {
        let a = Authority::parse("example.test:443").unwrap();
        let r = req(Method::POST, "/form", &[]);
        let s = res(
            303,
            &[
                ("location", "https://example.test/done"),
                ("content-location", "https://other.test/x"),
            ],
        );
        let keys: Vec<String> = invalidation_targets(&a, &r, &s.headers)
            .iter()
            .map(|uri| cache_key(&a, &Method::GET, uri))
            .collect();
        let expected: Vec<String> = ["/form", "/done"]
            .iter()
            .map(|p| cache_key(&a, &Method::GET, &p.parse().unwrap()))
            .collect();
        assert_eq!(keys, expected);
        // A plain-http request: a relative Location stays http, an https
        // Location on the same authority keeps https.
        let plain = Authority::parse("example.test:8080").unwrap();
        let r = req(Method::POST, "http://example.test:8080/form", &[]);
        let s = res(
            303,
            &[
                ("location", "/done"),
                ("content-location", "https://example.test:8080/c"),
            ],
        );
        let keys: Vec<String> = invalidation_targets(&plain, &r, &s.headers)
            .iter()
            .map(|uri| cache_key(&plain, &Method::GET, uri))
            .collect();
        let expected: Vec<String> = [
            "http://example.test:8080/form",
            "http://example.test:8080/done",
            "https://example.test:8080/c",
        ]
        .iter()
        .map(|u| cache_key(&plain, &Method::GET, &u.parse().unwrap()))
        .collect();
        assert_eq!(keys, expected);
    }

    #[test]
    fn per_entry_cap_is_min_of_32_mib_and_an_eighth() {
        assert_eq!(per_entry_cap(128 * 1024 * 1024), 16 * 1024 * 1024);
        assert_eq!(per_entry_cap(1024 * 1024 * 1024), PER_ENTRY_MAX);
    }
}
