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
        if request.uri().path().starts_with("/__sortofremoteng_")
            && request.uri().path() != super::web_automation::DARKREADER_PATH
            && !local_autologin
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
        let accounts_navigation = target == "https://accounts.google.com"
            && incoming
                .get("sec-fetch-mode")
                .and_then(|value| value.to_str().ok())
                == Some("navigate")
            && incoming
                .get("sec-fetch-dest")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| matches!(value, "document" | "iframe"));
        headers.retain(|(name, _)| {
            !matches!(name.as_str(), "cookie" | "origin" | "referer")
                && !(accounts_navigation
                    && matches!(
                        name.as_str(),
                        // These values describe the protected localhost alias
                        // and iframe, not the upstream Accounts navigation.
                        // Forwarding that contradictory topology makes Google
                        // reject ServiceLogin as malformed. Background request
                        // metadata remains intact for upstream CSRF policy.
                        "sec-fetch-dest" | "sec-fetch-mode" | "sec-fetch-site" | "sec-fetch-user"
                    ))
        });
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

    /// Merge browser-visible, non-HttpOnly cookie writes back into the native
    /// origin jar. Server HttpOnly values always win and are never exposed.
    pub(super) fn observe_browser_cookies(
        &self,
        incoming: &axum::http::HeaderMap,
        target: &Url,
    ) -> Result<(), &'static str> {
        let Some(header) = incoming.get("cookie") else {
            return Ok(());
        };
        if header.as_bytes().len() > 64 * 1024 {
            return Err("Google browser cookie header is too large");
        }
        let value = header
            .to_str()
            .map_err(|_| "Invalid Google browser cookie header")?;
        let mut jar = self
            .cookies
            .0
            .lock()
            .map_err(|_| "Google session cookies unavailable")?;
        let protected = jar
            .matches(target)
            .into_iter()
            .filter(|cookie| cookie.http_only() == Some(true))
            .map(|cookie| cookie.name().to_string())
            .collect::<std::collections::BTreeSet<_>>();
        let mut occurrences = std::collections::BTreeMap::<String, usize>::new();
        for pair in value.split(';').take(128) {
            let Some((name, value)) = pair.trim().split_once('=') else {
                continue;
            };
            if name.is_empty()
                || name.len() > 256
                || value.len() > 4096
                || protected.contains(name)
                || !name
                    .bytes()
                    .all(|byte| byte > 0x20 && byte < 0x7f && !matches!(byte, b'=' | b';' | b','))
                || !value
                    .bytes()
                    .all(|byte| (0x20..0x7f).contains(&byte) && !matches!(byte, b';' | b','))
            {
                continue;
            }
            let occurrence = occurrences.entry(name.to_owned()).or_default();
            // The localhost alias cannot express Google's upstream Domain
            // attribute. Match duplicate names in browser Cookie order (longest
            // path first), then update only that native cookie. This preserves
            // original domain/path/attribute scope through the roundtrip.
            let mut existing = jar
                .matches(target)
                .into_iter()
                .filter(|cookie| cookie.name() == name && cookie.http_only() != Some(true))
                .cloned()
                .collect::<Vec<_>>();
            existing.sort_by(|left, right| browser_cookie_order(left, right, target));
            // localhost cannot represent two upstream domains with the same
            // name and path. Reconcile only the deterministic projected winner.
            existing.dedup_by(|left, right| left.path.as_ref() == right.path.as_ref());
            let selected = existing.get(*occurrence).cloned();
            *occurrence += 1;
            let Some(cookie) = selected else {
                // A new browser-only name has no upstream scope to preserve.
                // Import only its first occurrence as a host-only root cookie;
                // later duplicates are ambiguous and therefore ignored.
                if *occurrence != 1 {
                    continue;
                }
                let raw = format!("{name}={value}; Path=/; Secure");
                let Ok(cookie) = cookie_store::Cookie::parse(raw, target) else {
                    continue;
                };
                match jar.insert(cookie.into_owned(), target) {
                    Ok(_) | Err(cookie_store::CookieError::Expired) => {}
                    Err(_) => return Err("Invalid Google browser cookie"),
                }
                continue;
            };
            if cookie.value() == value {
                continue;
            }
            let path = cookie.path.as_ref().to_owned();
            let secure = cookie.secure();
            let http_only = cookie.http_only();
            let same_site = cookie.same_site();
            let partitioned = cookie.partitioned();
            let mut raw: cookie_store::RawCookie<'static> = cookie.into();
            raw.set_value(value.to_owned());
            // cookie_store's Cookie -> RawCookie conversion intentionally omits
            // these fields. Restore them, and make an implicit effective path
            // explicit, before parsing the replacement into native scope.
            raw.set_path(path);
            raw.set_secure(secure);
            raw.set_http_only(http_only);
            raw.set_same_site(same_site);
            raw.set_partitioned(partitioned);
            let replacement = cookie_store::Cookie::try_from_raw_cookie(&raw, target)
                .map_err(|_| "Invalid Google browser cookie")?;
            match jar.insert(replacement.into_owned(), target) {
                Ok(_) | Err(cookie_store::CookieError::Expired) => {}
                Err(_) => return Err("Invalid Google browser cookie"),
            }
        }
        Ok(())
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
        let deletions = if include_credentials {
            projected_cookie_deletions(response.headers(), url)
        } else {
            Vec::new()
        };
        if include_credentials {
            self.observe_cookies(response.headers(), url)
                .map_err(Error::Policy)?;
        }
        let visible = if include_credentials {
            self.projected_cookies(url)
        } else {
            Vec::new()
        };
        response.headers_mut().remove("set-cookie");
        for value in deletions.into_iter().chain(visible) {
            response.headers_mut().append("set-cookie", value);
        }
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
            let name = cookie.name().to_owned();
            let expired = cookie.is_expired();
            match jar.insert(cookie, url) {
                Ok(_) | Err(cookie_store::CookieError::Expired) => {}
                Err(_) => return Err("Invalid Google session cookie"),
            }
            if expired {
                // Browser-visible writes are represented as host-only `/`
                // cookies because a localhost alias cannot retain Google's
                // Domain attribute. Apply the upstream deletion to that mirror
                // as well so a stale page value cannot be re-imported.
                if let Some(host) = url.host_str() {
                    jar.remove(host, "/", &name);
                }
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

    pub(super) fn projected_cookies(&self, url: &Url) -> Vec<HeaderValue> {
        let Ok(jar) = self.cookies.0.lock() else {
            return Vec::new();
        };
        let mut cookies = jar.matches(url);
        cookies.sort_by(|left, right| {
            left.name()
                .cmp(right.name())
                .then_with(|| left.path.as_ref().cmp(right.path.as_ref()))
                // Never expose a visible value when an HttpOnly cookie would
                // collapse onto the same localhost name/path.
                .then_with(|| right.http_only().cmp(&left.http_only()))
                .then_with(|| browser_cookie_order(left, right, url))
        });
        cookies.dedup_by(|left, right| {
            left.name() == right.name() && left.path.as_ref() == right.path.as_ref()
        });
        cookies
            .into_iter()
            .take(128)
            .filter_map(|cookie| {
                let mut value = format!(
                    "{}={}; Path={}",
                    cookie.name(),
                    cookie.value(),
                    cookie.path.as_ref(),
                );
                if cookie.secure() == Some(true) {
                    value.push_str("; Secure");
                }
                if cookie.http_only() == Some(true) {
                    value.push_str("; HttpOnly");
                }
                if let Some(same_site) = cookie.same_site() {
                    value.push_str("; SameSite=");
                    value.push_str(&same_site.to_string());
                }
                HeaderValue::from_str(&value).ok()
            })
            .collect()
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
        // `send` has already replaced upstream Set-Cookie values with safe
        // localhost projections. Preserve those projections on redirects so
        // browser-visible state advances in lockstep with the native jar.
        for value in response.headers().get_all(reqwest::header::SET_COOKIE) {
            builder = builder.header(axum::http::header::SET_COOKIE, value);
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

/// Carry upstream deletion semantics to the current local alias without ever
/// projecting an upstream Domain attribute onto localhost siblings.
fn projected_cookie_deletions(headers: &reqwest::header::HeaderMap, url: &Url) -> Vec<HeaderValue> {
    headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|header| header.to_str().ok())
        .filter(|value| {
            cookie_store::Cookie::parse((*value).to_owned(), url)
                .is_ok_and(|cookie| cookie.is_expired())
        })
        .filter_map(|value| {
            let projected = value
                .split(';')
                .filter(|part| {
                    !part
                        .trim_start()
                        .to_ascii_lowercase()
                        .starts_with("domain=")
                })
                .collect::<Vec<_>>()
                .join(";");
            HeaderValue::from_str(&projected).ok()
        })
        .take(128)
        .collect()
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
