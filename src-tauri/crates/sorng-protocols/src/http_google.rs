//! Exact first-party Google routes behind one protected session/listener.
//! Each upstream origin gets a separate unguessable browser origin. The shared
//! native cookie jar retains upstream host/domain/path scope, never localhost
//! scope. No saved headers, passwords, certificate bypass or wildcard grants.
use super::{AxumProxyState, ReviewedApplicationProfile};
use reqwest::{header::HeaderValue, Url};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
};

const CATALOG: &str = include_str!("../../../../src/utils/protocol/googleHostedRoutes.json");
pub(super) const REDIRECT_MARKER: &str = "__sorng_google_hop_v1";
pub(super) const COOKIE_BRIDGE_PATH: &str = "/__sortofremoteng_google_cookie_v1";
const COOKIE_PATH_HEADER: &str = "x-sorng-google-cookie-path";

fn cookie_domain_order(cookie: &cookie_store::Cookie<'_>, target: &Url) -> (u8, usize) {
    let host = target.host_str().unwrap_or_default();
    match &cookie.domain {
        cookie_store::CookieDomain::HostOnly(domain) if domain == host => (0, usize::MAX),
        cookie_store::CookieDomain::Suffix(domain) if domain == host => (1, usize::MAX),
        cookie_store::CookieDomain::Suffix(domain) => (2, usize::MAX - domain.len()),
        _ => (3, usize::MAX),
    }
}

fn browser_cookie_order(
    left: &cookie_store::Cookie<'_>,
    right: &cookie_store::Cookie<'_>,
    target: &Url,
) -> Ordering {
    right
        .path
        .len()
        .cmp(&left.path.len())
        .then_with(|| cookie_domain_order(left, target).cmp(&cookie_domain_order(right, target)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    profiles: BTreeMap<String, String>,
    login_origins: Vec<String>,
    resource_origins: Vec<String>,
    profile_origins: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleProxyRoute {
    pub upstream_origin: String,
    pub proxy_origin: String,
    pub documents: bool,
}

pub struct GoogleSession {
    pub(super) routes: Vec<GoogleProxyRoute>,
    source_origin: String,
    source_client: reqwest::Client,
    client: reqwest::Client,
    cookies: GoogleCookieState,
    owns_cookie_state: AtomicBool,
    leases: Vec<crate::webview_origins::ProxyOriginLease>,
}

#[derive(Clone)]
#[doc(hidden)]
pub struct GoogleCookieState(Arc<Mutex<cookie_store::CookieStore>>);

impl GoogleSession {
    pub fn new(
        profile: Option<ReviewedApplicationProfile>,
        source: &Url,
        proxy_origin: &str,
        source_client: reqwest::Client,
        client: reqwest::Client,
    ) -> Result<Option<Self>, String> {
        if profile != Some(ReviewedApplicationProfile::GoogleHosted) {
            return Ok(None);
        }
        let catalog: Catalog = serde_json::from_str(CATALOG).expect("reviewed Google catalog");
        let origin = source.origin().ascii_serialization();
        let (profile_id, _) = catalog
            .profiles
            .iter()
            .find(|(_, value)| **value == origin)
            .filter(|_| valid_url(source))
            .ok_or("Google profile requires its exact HTTPS hosted origin")?;
        let local = Url::parse(proxy_origin).map_err(|_| "Invalid Google proxy origin")?;
        let port = local.port().ok_or("Invalid Google proxy port")?;
        let mut origins = BTreeMap::from([(origin.clone(), true)]);
        for login in catalog.login_origins {
            origins.insert(login, true);
        }
        for resource in catalog.resource_origins {
            origins.insert(resource, false);
        }
        if let Some(extras) = catalog.profile_origins.get(profile_id) {
            for extra in extras {
                origins.insert(extra.clone(), profile_id == "youtube");
            }
        }
        let mut routes = Vec::new();
        let mut leases = Vec::new();
        for (upstream_origin, documents) in origins {
            let proxy = if upstream_origin == origin {
                proxy_origin.to_string()
            } else {
                let origin = format!("http://p{}.localhost:{port}", uuid::Uuid::new_v4().simple());
                leases.push(crate::webview_origins::acquire_proxy_origin(&origin)?);
                origin
            };
            routes.push(GoogleProxyRoute {
                upstream_origin,
                proxy_origin: proxy,
                documents,
            });
        }
        Ok(Some(Self {
            routes,
            source_origin: origin,
            source_client,
            client,
            cookies: GoogleCookieState(Arc::new(Mutex::new(Default::default()))),
            owns_cookie_state: AtomicBool::new(true),
            leases,
        }))
    }

    pub(super) fn revoke(&self) {
        self.retire_for_replacement();
        if self.owns_cookie_state.swap(false, AtomicOrdering::AcqRel) {
            if let Ok(mut jar) = self.cookies.0.lock() {
                *jar = Default::default();
            }
        }
    }

    pub(super) fn retire_for_replacement(&self) {
        for lease in &self.leases {
            lease.revoke();
        }
    }

    #[doc(hidden)]
    pub fn take_cookie_state_for_replacement(&self) -> GoogleCookieState {
        self.owns_cookie_state.store(false, AtomicOrdering::Release);
        self.cookies.clone()
    }

    #[doc(hidden)]
    pub fn restore_cookie_state(&mut self, state: GoogleCookieState) {
        self.cookies = state;
    }

    pub(super) fn upstream_route(&self, url: &Url) -> Option<&GoogleProxyRoute> {
        valid_url(url)
            .then(|| {
                self.routes
                    .iter()
                    .find(|route| route.upstream_origin == url.origin().ascii_serialization())
            })
            .flatten()
    }

    pub(super) fn local_route(&self, origin: &str) -> Option<&GoogleProxyRoute> {
        self.routes
            .iter()
            .find(|route| route.proxy_origin == origin)
    }

    pub(super) fn map_url(&self, url: &Url) -> Option<String> {
        let route = self.upstream_route(url)?;
        Some(format!(
            "{}{}",
            route.proxy_origin,
            &url[url::Position::BeforePath..]
        ))
    }

    /// Called before selecting any handler, including credential endpoints.
    pub(super) fn request_state(
        &self,
        state: &Arc<AxumProxyState>,
        request: &axum::extract::Request,
    ) -> Result<Arc<AxumProxyState>, &'static str> {
        let host = request
            .headers()
            .get("host")
            .and_then(|v| v.to_str().ok())
            .ok_or("Invalid Google proxy host")?;
        let local = format!("http://{host}");
        let route = self
            .local_route(&local)
            .ok_or("Unknown Google proxy host")?;
        if let Some(origin) = request.headers().get("origin") {
            if !origin
                .to_str()
                .ok()
                .is_some_and(|origin| self.local_route(origin).is_some_and(|r| r.documents))
            {
                return Err("Foreign Google proxy request origin");
            }
        }
        let document = super::proxy_response::is_document_request(request.headers(), None);
        if !route.documents && document {
            return Err("Google resource route does not accept this request");
        }
        // Cross-origin aliases must never expose the connection's credential
        // endpoints. Automation must redeem its own origin/document-bound grant.
        let google_login = route.upstream_origin == "https://accounts.google.com"
            && state.upstream_auth_mode == super::UpstreamAuthMode::GoogleForm;
        let local_autologin = request.uri().path() == super::AUTOLOGIN_PATH && google_login;
        let local_cookie_bridge = request.uri().path() == COOKIE_BRIDGE_PATH && route.documents;
        if request.uri().path().starts_with("/__sortofremoteng_")
            && request.uri().path() != super::web_automation::DARKREADER_PATH
            && !local_autologin
            && !local_cookie_bridge
        {
            return Err("Google routing does not grant credential or control endpoints");
        }
        if request.headers().contains_key("upgrade") {
            return Err("Google WebSocket routing is unavailable");
        }
        let mut scoped = (**state).clone();
        scoped.target_origin = route.upstream_origin.clone();
        scoped.target_url = format!("{}/", route.upstream_origin);
        scoped.proxy_origin = route.proxy_origin.clone();
        scoped.proxy_authority = host.into();
        scoped.client = self.client.clone();
        scoped.upstream_auth_mode = if google_login {
            super::UpstreamAuthMode::GoogleForm
        } else {
            super::UpstreamAuthMode::None
        };
        scoped.custom_headers.clear();
        scoped.proxy_policy.query_parameters.clear();
        // Routing permission is never saved-login permission.
        Ok(Arc::new(scoped))
    }

    pub(super) fn request_headers(
        &self,
        incoming: &axum::http::HeaderMap,
        target: &str,
    ) -> Vec<(String, String)> {
        let mut headers =
            super::collect_upstream_headers(incoming, super::UpstreamAuthMode::None, "", target);
        // Keep the actual WebView User-Agent, client hints and Fetch Metadata,
        // including its iframe destination. Google decides whether this browser
        // context is supported; proxy routing must not disguise that context.
        headers.retain(|(name, _)| !matches!(name.as_str(), "cookie" | "origin" | "referer"));
        for (name, value) in &mut headers {
            if name == "access-control-request-headers" {
                *value = value
                    .split(',')
                    .map(str::trim)
                    .filter(|header| !header.eq_ignore_ascii_case("x-sorng-google-credentials"))
                    .collect::<Vec<_>>()
                    .join(", ");
            }
        }
        headers
            .retain(|(name, value)| name != "access-control-request-headers" || !value.is_empty());
        for name in ["origin", "referer"] {
            let Some(value) = incoming.get(name).and_then(|v| v.to_str().ok()) else {
                continue;
            };
            let Ok(url) = Url::parse(value) else {
                continue;
            };
            let Some(source) = self.local_route(&url.origin().ascii_serialization()) else {
                continue;
            };
            headers.push((
                name.into(),
                if name == "referer" {
                    format!(
                        "{}{}",
                        source.upstream_origin,
                        &url[url::Position::BeforePath..],
                    )
                } else {
                    source.upstream_origin.clone()
                },
            ));
        }
        headers
    }

    pub(super) fn includes_credentials(
        &self,
        incoming: &axum::http::HeaderMap,
    ) -> Result<bool, &'static str> {
        match incoming
            .get("x-sorng-google-credentials")
            .and_then(|value| value.to_str().ok())
        {
            Some("include") => Ok(true),
            Some("omit") => Ok(false),
            Some(_) => Err("Invalid Google credentials mode"),
            None => Ok(true),
        }
    }

    fn document_cookie_url(
        target_origin: &str,
        headers: &axum::http::HeaderMap,
    ) -> Result<Url, &'static str> {
        let path = headers
            .get(COOKIE_PATH_HEADER)
            .and_then(|value| value.to_str().ok())
            .ok_or("Missing Google document cookie path")?;
        if path.is_empty()
            || path.len() > 4096
            || !path.starts_with('/')
            || path.contains(['?', '#', '\\'])
        {
            return Err("Invalid Google document cookie path");
        }
        let target = Url::parse(&format!("{target_origin}{path}"))
            .map_err(|_| "Invalid Google document cookie path")?;
        if !valid_url(&target) || target.origin().ascii_serialization() != target_origin {
            return Err("Invalid Google document cookie origin");
        }
        Ok(target)
    }

    pub(super) fn document_cookie_string(
        &self,
        target_origin: &str,
        headers: &axum::http::HeaderMap,
    ) -> Result<String, &'static str> {
        let target = Self::document_cookie_url(target_origin, headers)?;
        let jar = self
            .cookies
            .0
            .lock()
            .map_err(|_| "Google session cookies unavailable")?;
        let mut cookies = jar
            .matches(&target)
            .into_iter()
            .filter(|cookie| cookie.http_only() != Some(true))
            .collect::<Vec<_>>();
        cookies.sort_by(|left, right| browser_cookie_order(left, right, &target));
        Ok(cookies
            .into_iter()
            .take(128)
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; "))
    }

    fn apply_document_cookie(
        &self,
        target_origin: &str,
        headers: &axum::http::HeaderMap,
        value: &[u8],
    ) -> Result<(), &'static str> {
        if value.is_empty() || value.len() > 4096 {
            return Err("Invalid Google document cookie");
        }
        let value = HeaderValue::from_bytes(value).map_err(|_| "Invalid Google document cookie")?;
        let target = Self::document_cookie_url(target_origin, headers)?;
        // Apply the same upstream-domain and secure-prefix rules as Set-Cookie.
        // cookie_store alone does not reject public suffixes or invalid __Host-
        // and __Secure- cookies. Rejected writes stay silent like document.cookie.
        let Some(cookie) = super::upstream::validated_response_cookie(&value, &target)? else {
            return Ok(());
        };
        // JavaScript cannot create or overwrite HttpOnly state. Keep the same
        // silent refusal semantics as a browser's document.cookie setter.
        if cookie.http_only() == Some(true) {
            return Ok(());
        }
        let mut jar = self
            .cookies
            .0
            .lock()
            .map_err(|_| "Google session cookies unavailable")?;
        if jar.iter_unexpired().any(|existing| {
            existing.http_only() == Some(true)
                && existing.name() == cookie.name()
                && existing.domain == cookie.domain
                && existing.path == cookie.path
        }) {
            // Match browser semantics: document.cookie cannot replace or
            // expire an existing HttpOnly cookie at the same storage key.
            return Ok(());
        }
        match jar.insert(cookie.into_owned(), &target) {
            Ok(_) | Err(cookie_store::CookieError::Expired) => Ok(()),
            Err(_) => Err("Invalid Google document cookie"),
        }
    }

    /// Synchronous page bridge for document.cookie. Google runs cookie probes
    /// before issuing its first request, so writes must reach the native jar
    /// before JavaScript can read them back or navigate.
    pub(super) async fn document_cookie_response(
        &self,
        target_origin: &str,
        request: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::{body::Body, http::StatusCode, response::Response};

        let method = request.method().clone();
        let headers = request.headers().clone();
        let result = match method {
            axum::http::Method::GET => self
                .document_cookie_string(target_origin, &headers)
                .map(|value| (StatusCode::OK, value)),
            axum::http::Method::POST => {
                match axum::body::to_bytes(request.into_body(), 4097).await {
                    Ok(value) => self
                        .apply_document_cookie(target_origin, &headers, &value)
                        .map(|()| (StatusCode::NO_CONTENT, String::new())),
                    Err(_) => Err("Invalid Google document cookie"),
                }
            }
            _ => {
                return Response::builder()
                    .status(StatusCode::METHOD_NOT_ALLOWED)
                    .header("allow", "GET, POST")
                    .header("cache-control", "no-store")
                    .body(Body::empty())
                    .expect("static Google cookie method refusal")
            }
        };
        match result {
            Ok((status, value)) => Response::builder()
                .status(status)
                .header("cache-control", "no-store")
                .header("content-type", "text/plain; charset=utf-8")
                .body(Body::from(value))
                .expect("static Google cookie bridge response"),
            Err(detail) => Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("cache-control", "no-store")
                .body(Body::from(detail))
                .expect("static Google cookie bridge refusal"),
        }
    }

    pub(super) async fn send(
        &self,
        method: &reqwest::Method,
        url: &Url,
        headers: &[(String, String)],
        body: &[u8],
        include_credentials: bool,
    ) -> Result<reqwest::Response, super::upstream::UpstreamError> {
        use super::upstream::UpstreamError as Error;
        if self.upstream_route(url).is_none() {
            return Err(Error::Policy("Google destination is not approved."));
        }
        let client = if url.origin().ascii_serialization() == self.source_origin {
            &self.source_client
        } else {
            &self.client
        };
        let mut request = client.request(method.clone(), url.clone());
        for (name, value) in headers {
            if !name.eq_ignore_ascii_case("cookie")
                && !name.eq_ignore_ascii_case("x-sorng-google-credentials")
            {
                request = request.header(name, value);
            }
        }
        if include_credentials {
            if let Some(value) = self.cookie_header(url) {
                request = request.header("cookie", value);
            }
        }
        if !body.is_empty() {
            request = request.body(body.to_vec());
        }
        let mut response = request.send().await?;
        if include_credentials {
            self.observe_cookies(response.headers(), url)
                .map_err(Error::Policy)?;
        }
        // The protected native jar is authoritative. Projecting HTTPS Google
        // cookies onto an HTTP localhost alias is rejected inconsistently by
        // engines and can resurrect stale browser mirrors. Page-visible state
        // is exposed only through the document-cookie bridge above.
        response.headers_mut().remove("set-cookie");
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            let next = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .and_then(|value| url.join(value).ok())
                .ok_or(Error::Policy("Invalid Google redirect."))?;
            if self.upstream_route(&next).is_none() {
                return Err(Error::Policy("Google redirected outside this session's exact destinations. No request was sent."));
            }
        }
        Ok(response)
    }

    pub(super) fn observe_cookies(
        &self,
        headers: &reqwest::header::HeaderMap,
        url: &Url,
    ) -> Result<(), &'static str> {
        let mut jar = self
            .cookies
            .0
            .lock()
            .map_err(|_| "Google session cookies unavailable")?;
        for header in headers.get_all("set-cookie").iter().take(128) {
            let Some(cookie) = super::upstream::validated_response_cookie(header, url)? else {
                continue;
            };
            match jar.insert(cookie, url) {
                Ok(_) | Err(cookie_store::CookieError::Expired) => {}
                Err(_) => return Err("Invalid Google session cookie"),
            }
        }
        if jar.iter_unexpired().count() > 512
            || jar
                .iter_unexpired()
                .map(|c| c.to_string().len())
                .sum::<usize>()
                > 256 * 1024
        {
            *jar = Default::default();
            return Err("Google session cookie limit exceeded");
        }
        Ok(())
    }

    pub(super) fn cookie_header(&self, url: &Url) -> Option<HeaderValue> {
        let jar = self.cookies.0.lock().ok()?;
        let mut cookies = jar.matches(url);
        cookies.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
        let value = cookies
            .iter()
            .map(|c| format!("{}={}", c.name(), c.value()))
            .collect::<Vec<_>>()
            .join("; ");
        (!value.is_empty())
            .then(|| HeaderValue::from_str(&value).ok())
            .flatten()
    }

    pub(super) fn manifest(&self) -> serde_json::Value {
        serde_json::json!({ "version": 1, "routes": self.routes, "nativeCookies": true })
    }

    /// Preserve the upstream server's CORS decision while translating its
    /// reviewed HTTPS origin back to the corresponding protected local alias.
    pub(super) fn translated_cors_origin(
        &self,
        incoming_origin: Option<&str>,
        headers: &reqwest::header::HeaderMap,
    ) -> Option<String> {
        let local = incoming_origin?;
        let source = self.local_route(local)?;
        let allowed = headers.get("access-control-allow-origin")?.to_str().ok()?;
        if allowed == "*" {
            Some("*".into())
        } else if allowed == source.upstream_origin {
            Some(local.into())
        } else {
            None
        }
    }

    pub(super) fn redirect_response(
        &self,
        response: &reqwest::Response,
        hop: u8,
        token: Option<&str>,
        document: bool,
        cors_origin: Option<&str>,
    ) -> axum::response::Response {
        use axum::{body::Body, http::Response};
        let destination = response
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| response.url().join(value).ok());
        let mapped = destination
            .as_ref()
            .filter(|url| {
                self.upstream_route(url)
                    .is_some_and(|route| !document || route.documents)
            })
            .and_then(|url| self.map_url(url));
        if hop >= 20 || mapped.is_none() {
            return Response::builder()
                .status(if hop >= 20 { 508 } else { 403 })
                .header("cache-control", "no-store")
                .body(Body::from(
                    "Google redirect is outside the supported route or redirect limit.",
                ))
                .unwrap();
        }
        let mapped = mapped.unwrap();
        let (without_fragment, fragment) = mapped
            .split_once('#')
            .map_or((mapped.as_str(), None), |(a, b)| (a, Some(b)));
        let mut location = format!(
            "{without_fragment}{}{REDIRECT_MARKER}={}",
            if without_fragment.contains('?') {
                '&'
            } else {
                '?'
            },
            hop + 1
        );
        if let Some(token) = token {
            location.push_str(&format!("&__sorng_navigation_v1={token}"));
        }
        if let Some(fragment) = fragment {
            location.push('#');
            location.push_str(fragment);
        }
        let mut builder = Response::builder()
            .status(response.status().as_u16())
            .header("location", location)
            .header("cache-control", "no-store");
        if let Some(origin) = self.translated_cors_origin(cors_origin, response.headers()) {
            builder = builder.header("access-control-allow-origin", origin);
            if response
                .headers()
                .get("access-control-allow-credentials")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.eq_ignore_ascii_case("true"))
            {
                builder = builder.header("access-control-allow-credentials", "true");
            }
        }
        builder.body(Body::empty()).unwrap()
    }

    pub(super) fn content_security_policy(&self, policy: &super::HttpProxyPolicy) -> String {
        let all = self
            .routes
            .iter()
            .map(|r| r.proxy_origin.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let documents = self
            .routes
            .iter()
            .filter(|r| r.documents)
            .map(|r| r.proxy_origin.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let scripts = match policy.page_scripts {
            super::PageScripts::Allow => format!("'self' 'unsafe-inline' 'unsafe-eval' {all}"),
            super::PageScripts::InlineOnly => "'unsafe-inline' 'unsafe-eval'".into(),
            super::PageScripts::Block => "'none'".into(),
        };
        format!("default-src 'self' data: blob: {all}; connect-src 'self' {all}; script-src {scripts}; style-src 'self' 'unsafe-inline' {all}; font-src 'self' data: {all}; form-action {documents}; frame-src {documents}; child-src {documents}; worker-src 'none'; object-src 'none'; base-uri 'self'")
    }

    /// Rewrite URL tokens, not nested continue/followup parameters, arbitrary
    /// substrings or lookalike hosts. Relative URLs retain their normal base.
    pub(super) fn rewrite(&self, text: &str) -> String {
        let mut result = text.to_string();
        for route in &self.routes {
            for (source, proxy) in [
                (route.upstream_origin.clone(), route.proxy_origin.clone()),
                (
                    route.upstream_origin.replace('/', "\\/"),
                    route.proxy_origin.replace('/', "\\/"),
                ),
                (
                    route
                        .upstream_origin
                        .trim_start_matches("https:")
                        .to_string(),
                    route.proxy_origin.clone(),
                ),
            ] {
                let mut next = String::with_capacity(result.len());
                let mut copied = 0;
                for (start, _) in result.match_indices(&source) {
                    let before = result[..start].chars().next_back();
                    let end = start + source.len();
                    let after = result[end..].chars().next();
                    if before.is_some_and(|c| {
                        !matches!(c, '\'' | '"' | '`' | '(') && !c.is_ascii_whitespace()
                    }) || after.is_some_and(|c| {
                        !matches!(
                            c,
                            '/' | '\\' | '?' | '#' | '\'' | '"' | '`' | ')' | '<' | '>'
                        ) && !c.is_ascii_whitespace()
                    }) {
                        continue;
                    }
                    next.push_str(&result[copied..start]);
                    next.push_str(&proxy);
                    copied = end;
                }
                next.push_str(&result[copied..]);
                result = next;
            }
        }
        result
    }
}

fn valid_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

pub(super) fn request_path(path: &str) -> Result<(String, u8), &'static str> {
    let Some((path, query)) = path.split_once('?') else {
        return Ok((path.into(), 0));
    };
    let mut hop = None;
    let mut kept = Vec::new();
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded = url::form_urlencoded::parse(name.as_bytes()).next();
        if decoded.is_some_and(|(key, _)| key == REDIRECT_MARKER) {
            if name != REDIRECT_MARKER
                || hop.is_some()
                || value.is_empty()
                || !value.bytes().all(|c| c.is_ascii_digit())
            {
                return Err("Invalid Google redirect counter");
            }
            let count = value
                .parse::<u8>()
                .ok()
                .filter(|v| *v <= 20)
                .ok_or("Google redirect limit exceeded")?;
            hop = Some(count);
        } else {
            kept.push(pair);
        }
    }
    Ok((
        if kept.is_empty() {
            path.into()
        } else {
            format!("{path}?{}", kept.join("&"))
        },
        hop.unwrap_or(0),
    ))
}
