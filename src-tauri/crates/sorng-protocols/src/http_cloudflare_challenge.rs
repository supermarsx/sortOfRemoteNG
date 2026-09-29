//! Exact challenge-origin transport. Each alias and cookie jar belongs to one
//! dashboard document; no dashboard authentication state enters this handler.
use super::{AxumProxyState, ProxyNetworkState, ReviewedApplicationProfile};
use axum::{
    body::Body,
    http::{Response, StatusCode},
};
use reqwest::Url;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

pub(super) const SOURCE: &str = "https://dash.cloudflare.com";
pub(super) const UPSTREAM: &str = "https://challenges.cloudflare.com";

/// A challenge is executable upstream HTML, not an ordinary themed error page.
/// The owning response pipeline can use this before its HTTP-error replacement.
/// Do not infer clearance or trust from a title, query token, or body substring.
pub(super) fn is_managed_challenge_response(
    profile: Option<ReviewedApplicationProfile>,
    url: &Url,
    headers: &axum::http::HeaderMap,
) -> bool {
    profile == Some(ReviewedApplicationProfile::Cloudflare)
        && url.origin().ascii_serialization() == SOURCE
        && url.username().is_empty()
        && url.password().is_none()
        && headers.get_all("cf-mitigated").iter().count() == 1
        && headers
            .get("cf-mitigated")
            .is_some_and(|value| value == "challenge")
        && super::proxy_response::is_html(
            headers
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
        )
}

pub(super) fn rewrite(text: &str, alias: &str) -> String {
    let mut text = text.to_owned();
    for origin in [
        "https://challenges.cloudflare.com:443",
        UPSTREAM,
        "//challenges.cloudflare.com:443",
        "//challenges.cloudflare.com",
    ] {
        text = super::proxy_response::rewrite_target_origin(&text, origin, alias);
    }
    text
}
struct Alias {
    origin: String,
    _lease: crate::webview_origins::ProxyOriginLease,
    cookies: Mutex<cookie_store::CookieStore>,
}
pub struct CloudflareChallenge {
    source_proxy: String,
    port: u16,
    client: reqwest::Client,
    aliases: Mutex<BTreeMap<u64, Arc<Alias>>>,
}

impl CloudflareChallenge {
    /// Caller supplies the strict, stateless client built with the connection's
    /// explicit transport proxy. It must not inherit source pins or TLS bypass.
    pub fn new(
        profile: Option<ReviewedApplicationProfile>,
        source: &Url,
        proxy_origin: &str,
        client: reqwest::Client,
    ) -> Result<Option<Self>, String> {
        if profile != Some(ReviewedApplicationProfile::Cloudflare) {
            return Ok(None);
        }
        if source.origin().ascii_serialization() != SOURCE
            || !source.username().is_empty()
            || source.password().is_some()
        {
            return Err(
                "Cloudflare challenge routing requires exact HTTPS dashboard origin on port 443"
                    .into(),
            );
        }
        let local = Url::parse(proxy_origin).map_err(|_| "Invalid challenge proxy origin")?;
        let port = local.port().ok_or("Invalid challenge proxy port")?;
        let protected_host = local
            .host_str()
            .and_then(|host| host.strip_prefix('p'))
            .and_then(|host| host.strip_suffix(".localhost"))
            .is_some_and(|token| {
                token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
            });
        if local.origin().ascii_serialization() != proxy_origin
            || local.scheme() != "http"
            || !protected_host
            || port == 0
        {
            return Err("Invalid challenge proxy origin".into());
        }
        Ok(Some(Self {
            source_proxy: proxy_origin.into(),
            port,
            client,
            aliases: Mutex::new(BTreeMap::new()),
        }))
    }

    pub(super) fn prune(&self, root: Option<u64>) {
        if let Ok(mut aliases) = self.aliases.lock() {
            aliases.retain(|sequence, alias| {
                let keep = root.is_some_and(|root| *sequence >= root);
                if !keep {
                    alias._lease.revoke();
                }
                keep
            });
        }
    }

    pub(super) fn manifest(
        &self,
        root: u64,
        network: &ProxyNetworkState,
    ) -> Option<serde_json::Value> {
        if !network.cloudflare_manifest_eligible(root) {
            return None;
        }
        let mut aliases = self.aliases.lock().ok()?;
        if !network.is_active() {
            return None;
        }
        let current = network.selected_document_sequence();
        if current.is_some_and(|selected| root < selected) {
            return None;
        }
        let newest = aliases
            .keys()
            .next_back()
            .copied()
            .unwrap_or(root)
            .max(root);
        if root < newest && Some(root) != current {
            return None;
        }
        aliases.retain(|sequence, alias| {
            let keep = Some(*sequence) == current || *sequence == newest;
            if !keep {
                alias._lease.revoke();
            }
            keep
        });
        if let std::collections::btree_map::Entry::Vacant(entry) = aliases.entry(root) {
            let origin = format!(
                "http://p{}.localhost:{}",
                uuid::Uuid::new_v4().simple(),
                self.port
            );
            let lease = crate::webview_origins::acquire_proxy_origin(&origin).ok()?;
            entry.insert(Arc::new(Alias {
                origin,
                _lease: lease,
                cookies: Mutex::new(Default::default()),
            }));
        }
        Some(
            serde_json::json!({"version":1,"upstreamOrigin":UPSTREAM,"proxyOrigin":aliases.get(&root)?.origin}),
        )
    }

    pub(super) fn source_csp(&self, policy: String, origin: &str) -> String {
        if origin != self.source_proxy {
            return policy;
        }
        let Ok(aliases) = self.aliases.lock() else {
            return policy;
        };
        let origins = aliases
            .values()
            .map(|alias| alias.origin.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        policy
            .replace("script-src 'self'", &format!("script-src 'self' {origins}"))
            .replace("frame-src 'self'", &format!("frame-src 'self' {origins}"))
            .replace("child-src 'self'", &format!("child-src 'self' {origins}"))
            .replace(
                "connect-src 'self'",
                &format!("connect-src 'self' {origins}"),
            )
    }

    /// Dispatch before the ordinary credential/router middleware. None means
    /// this is the original dashboard; every other host is handled or refused.
    pub(super) async fn dispatch(
        &self,
        state: &Arc<AxumProxyState>,
        request: axum::extract::Request,
    ) -> Result<axum::response::Response, axum::extract::Request> {
        let headers = request.headers();
        let host = headers
            .get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let local = format!("http://{host}");
        if local == self.source_proxy {
            return Err(request);
        }
        let candidate = self.aliases.lock().ok().and_then(|aliases| {
            aliases
                .iter()
                .find(|(_, alias)| alias.origin == local)
                .map(|(root, alias)| (*root, alias.clone()))
        });
        let Some((root, alias)) = candidate else {
            return Ok(refused());
        };
        let origin = headers.get("origin").and_then(|value| value.to_str().ok());
        let bad_referer = headers.get("referer").is_some_and(|value| {
            value
                .to_str()
                .ok()
                .and_then(|value| Url::parse(value).ok())
                .is_none_or(|url| {
                    !url.username().is_empty()
                        || url.password().is_some()
                        || ![local.as_str(), self.source_proxy.as_str()]
                            .contains(&url.origin().ascii_serialization().as_str())
                })
        });
        if headers.get_all("host").iter().count() != 1
            || headers.get_all("origin").iter().count() > 1
            || headers.get_all("referer").iter().count() > 1
            || bad_referer
            || headers.contains_key("origin") && origin.is_none()
            || origin.is_some_and(|value| value != local && value != self.source_proxy)
            || request
                .uri()
                .authority()
                .is_some_and(|value| value.as_str() != host)
            || request
                .uri()
                .scheme_str()
                .is_some_and(|value| value != "http")
            || reserved_path(request.uri().path())
            || headers.contains_key("upgrade")
            || !matches!(
                request.method().as_str(),
                "GET" | "HEAD" | "POST" | "OPTIONS"
            )
            || state.proxy_policy.page_scripts != super::PageScripts::Allow
        {
            return Ok(refused());
        }
        // Parser-created script/frame loads can precede desktop readiness
        // selection. Wait only for this issued root; never send upstream while
        // pending, and fail on newer selection, stop, or the existing 5s bound.
        if state.network.await_document(root).await.is_err() {
            return Ok(refused());
        }
        let result = state
            .network
            .while_document(root, self.send(state, root, &alias, request))
            .await;
        Ok(result.unwrap_or_else(|_| refused()))
    }

    async fn send(
        &self,
        state: &AxumProxyState,
        root: u64,
        alias: &Alias,
        request: axum::extract::Request,
    ) -> axum::response::Response {
        let (parts, body) = request.into_parts();
        let path = parts
            .uri
            .path_and_query()
            .map_or("/", |value| value.as_str());
        let Ok(url) = Url::parse(&format!("{UPSTREAM}{path}")) else {
            return refused();
        };
        if url.origin().ascii_serialization() != UPSTREAM
            || url
                .query_pairs()
                .any(|(key, _)| key.starts_with("__sorng_"))
        {
            return refused();
        }
        let Ok(body) = axum::body::to_bytes(body, 2 * 1024 * 1024).await else {
            return failed();
        };
        let Ok(method) = reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) else {
            return refused();
        };
        let browser_origin = parts
            .headers
            .get("origin")
            .and_then(|value| value.to_str().ok());
        let upstream_origin = browser_origin.map(|origin| {
            if origin == self.source_proxy {
                SOURCE
            } else {
                UPSTREAM
            }
        });
        let mut outgoing = self.client.request(method, url.clone()).body(body);
        // Closed forwarding set: no Cookie, Authorization, dashboard custom
        // headers, proxy credentials, conditional cache, or connection headers.
        for (name, value) in &parts.headers {
            if matches!(
                name.as_str(),
                "accept"
                    | "accept-language"
                    | "content-type"
                    | "user-agent"
                    | "sec-ch-ua"
                    | "sec-ch-ua-mobile"
                    | "sec-ch-ua-platform"
                    | "access-control-request-method"
                    | "access-control-request-headers"
            ) {
                outgoing = outgoing.header(name, value);
            }
        }
        if let Some(origin) = upstream_origin {
            outgoing = outgoing.header("origin", origin);
        }
        if let Some(referer) = parts
            .headers
            .get("referer")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| Url::parse(value).ok())
        {
            let mapped = if referer.origin().ascii_serialization() == self.source_proxy {
                Some(format!("{SOURCE}/"))
            } else if referer.origin().ascii_serialization() == alias.origin {
                Some(format!("{UPSTREAM}{}", referer.path()))
            } else {
                None
            };
            if let Some(value) = mapped {
                outgoing = outgoing.header("referer", value);
            }
        }
        let cookies = state.network.with_current_document(root, || {
            alias.cookies.lock().ok().map(|jar| {
                jar.get_request_values(&url)
                    .map(|(name, value)| format!("{name}={value}"))
                    .collect::<Vec<_>>()
                    .join("; ")
            })
        });
        let Ok(Some(cookies)) = cookies else {
            return refused();
        };
        if !cookies.is_empty() {
            outgoing = outgoing.header("cookie", cookies);
        }
        let Ok(response) = outgoing.send().await else {
            return failed();
        };
        // The supplied client has redirects disabled; reject accidental drift.
        if response.url().origin().ascii_serialization() != UPSTREAM {
            return failed();
        }
        let status = response.status();
        let headers = response.headers().clone();
        let cookie_result = state
            .network
            .with_current_document(root, || -> Result<(), ()> {
                let mut jar = alias.cookies.lock().map_err(|_| ())?;
                if headers.get_all("set-cookie").iter().count() > 64 {
                    return Err(());
                }
                for value in headers.get_all("set-cookie") {
                    let Some(mut cookie) =
                        super::upstream::validated_response_cookie(value, &url).map_err(|_| ())?
                    else {
                        continue;
                    };
                    if !matches!(
                        cookie.domain.as_cow().as_deref(),
                        Some("challenges.cloudflare.com" | "cloudflare.com")
                    ) {
                        continue;
                    }
                    cookie.domain =
                        cookie_store::CookieDomain::HostOnly("challenges.cloudflare.com".into());
                    match jar.insert(cookie, &url) {
                        Ok(_) | Err(cookie_store::CookieError::Expired) => {}
                        Err(_) => return Err(()),
                    }
                }
                if jar.iter_unexpired().count() > 128
                    || jar
                        .iter_unexpired()
                        .map(|cookie| cookie.to_string().len())
                        .sum::<usize>()
                        > 64 * 1024
                {
                    *jar = Default::default();
                    return Err(());
                }
                Ok(())
            });
        if !matches!(cookie_result, Ok(Ok(()))) {
            return failed();
        }
        let location = if status.is_redirection() {
            let Some(next) = headers
                .get("location")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| url.join(v).ok())
            else {
                return failed();
            };
            if next.origin().ascii_serialization() != UPSTREAM
                || !next.username().is_empty()
                || next.password().is_some()
            {
                return refused();
            }
            Some(format!(
                "{}{}",
                alias.origin,
                &next[url::Position::BeforePath..]
            ))
        } else {
            None
        };
        let content_type = headers.get("content-type").and_then(|v| v.to_str().ok());
        let editable = super::proxy_response::is_editable(content_type);
        // Bound opaque bodies as well as scripts/HTML; nothing streams beyond
        // the parent-document cancellation lease.
        let Ok(mut bytes) = super::proxy_response::read_body(response, &headers, true).await else {
            return failed();
        };
        if editable && !bytes.is_empty() {
            let Ok(text) = std::str::from_utf8(&bytes) else {
                return failed();
            };
            let mut text = rewrite(text, &alias.origin);
            if super::proxy_response::is_html(content_type) {
                let bootstrap = super::network::bootstrap(
                    &state.session_id,
                    root,
                    None,
                    UPSTREAM,
                    &alias.origin,
                    &state.proxy_policy,
                    None,
                    None,
                    None,
                    None,
                    None,
                );
                let identity =
                    serde_json::json!({"sessionId":state.session_id,"documentSequence":root})
                        .to_string()
                        .replace('<', "\\u003c");
                let script = format!("<script>(function(){{var p={identity};var u=new URL(location.href);{bootstrap}}})();</script>");
                let index = super::proxy_response::early_script_insertion(&text);
                text.insert_str(index, &script);
            }
            bytes = text.into_bytes();
        }
        let authority = alias.origin.trim_start_matches("http://");
        let csp = super::network::content_security_policy(&state.proxy_policy, authority);
        let mut builder = Response::builder()
            .status(status.as_u16())
            .header("cache-control", "no-store")
            .header("x-dns-prefetch-control", "off")
            // Match the source proxy's native-gated embedding contract. A
            // source-only frame-ancestors list would reject the app ancestor.
            .header("content-security-policy", csp);
        if let Some(value) = content_type {
            builder = builder.header("content-type", value);
        }
        // Keep Cloudflare's documented interstitial signal visible to the
        // requesting page, including on non-success HTML responses. It is a
        // challenge indication, never evidence of clearance or login success.
        if headers
            .get("cf-mitigated")
            .is_some_and(|value| value == "challenge")
        {
            builder = builder.header("cf-mitigated", "challenge");
        }
        if let Some(value) = location {
            builder = builder.header("location", value);
        }
        // Translate CORS only if the challenge server approved that upstream
        // origin. No wildcard or credential permission is invented here.
        if let (Some(browser), Some(upstream)) = (browser_origin, upstream_origin) {
            if headers
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v == upstream || v == "*")
            {
                builder = builder
                    .header(
                        "access-control-allow-origin",
                        if headers["access-control-allow-origin"] == "*" {
                            "*"
                        } else {
                            browser
                        },
                    )
                    .header("vary", "Origin");
                for name in [
                    "access-control-allow-credentials",
                    "access-control-allow-methods",
                    "access-control-allow-headers",
                    "access-control-expose-headers",
                ] {
                    if name == "access-control-allow-credentials"
                        && headers["access-control-allow-origin"] == "*"
                    {
                        continue;
                    }
                    if let Some(value) = headers.get(name) {
                        builder = builder.header(name, value);
                    }
                }
            }
        }
        builder.body(Body::from(bytes)).unwrap_or_else(|_| failed())
    }
}

fn error(status: StatusCode) -> axum::response::Response {
    Response::builder()
        .status(status)
        .header("cache-control", "no-store")
        .header(
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'",
        )
        .body(Body::from("Cloudflare challenge route unavailable"))
        .unwrap()
}
fn refused() -> axum::response::Response {
    error(StatusCode::FORBIDDEN)
}

fn reserved_path(path: &str) -> bool {
    let mut decoded = Vec::with_capacity(path.len());
    let mut bytes = path.as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let Some(high) = bytes.next().and_then(|b| (b as char).to_digit(16)) else {
                return true;
            };
            let Some(low) = bytes.next().and_then(|b| (b as char).to_digit(16)) else {
                return true;
            };
            decoded.push((high * 16 + low) as u8);
        } else {
            decoded.push(byte);
        }
    }
    let Ok(path) = std::str::from_utf8(&decoded) else {
        return true;
    };
    path.split('/')
        .any(|segment| segment.starts_with("__sortofremoteng") || segment.starts_with("__sorng_"))
}
fn failed() -> axum::response::Response {
    error(StatusCode::BAD_GATEWAY)
}
