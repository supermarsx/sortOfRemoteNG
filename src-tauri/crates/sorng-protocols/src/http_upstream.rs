//! Request-scoped authentication and redirects. Every hop retains exact origin.
use super::{http_digest, AxumProxyState, UpstreamAuthMode};

pub(super) struct CrossOriginRedirect {
    pub(super) destination: reqwest::Url,
    pub(super) response_url: reqwest::Url,
    pub(super) status: u16,
    pub(super) method: reqwest::Method,
    pub(super) same_origin_redirects: u32,
    /// Native-only restriction from redirect responses, never response headers.
    pub(super) suppress_referrer: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RedirectReferrerPolicy {
    Suppress,
    SameOrigin,
    OriginAllowed,
}

fn redirect_referrer_policy(
    headers: &reqwest::header::HeaderMap,
) -> Option<RedirectReferrerPolicy> {
    let mut suppression = None;
    let mut bytes = 0usize;
    for value in headers.get_all("referrer-policy") {
        bytes = bytes.saturating_add(value.as_bytes().len());
        if bytes > 1024 {
            return Some(RedirectReferrerPolicy::Suppress);
        }
        let Ok(value) = value.to_str() else {
            return Some(RedirectReferrerPolicy::Suppress);
        };
        for token in value.split(',') {
            match token.trim().to_ascii_lowercase().as_str() {
                "no-referrer" => suppression = Some(RedirectReferrerPolicy::Suppress),
                "same-origin" => suppression = Some(RedirectReferrerPolicy::SameOrigin),
                "no-referrer-when-downgrade"
                | "origin"
                | "origin-when-cross-origin"
                | "strict-origin"
                | "strict-origin-when-cross-origin"
                | "unsafe-url" => {
                    suppression = Some(RedirectReferrerPolicy::OriginAllowed);
                }
                _ => {}
            }
        }
    }
    suppression
}

pub(super) enum UpstreamError {
    Transport(reqwest::Error),
    Policy(&'static str),
    CrossOriginRedirect(Box<CrossOriginRedirect>),
    RedirectLoop,
    Deadline,
}

/// Shared parsing only: consumers must independently bind origin, purpose and
/// lifetime. This never reads a website jar or projects cookies to a browser.
pub(super) fn validated_response_cookie(
    header: &reqwest::header::HeaderValue,
    issuer: &reqwest::Url,
) -> Result<Option<cookie_store::Cookie<'static>>, &'static str> {
    RedirectCookieOverlay::parsed_cookie(header, issuer)
        .map_err(|_| "Provider cookie updates exceed the supported limits.")
}

/// Only response-derived updates from this request's exact origin. Keeping
/// expired cookies as scoped tombstones prevents an incoming browser SID from
/// resurrecting a cookie deleted by an intermediate redirect response.
struct RedirectCookieOverlay {
    origin: String,
    updates: Vec<cookie_store::Cookie<'static>>,
    issued: Vec<reqwest::header::HeaderValue>,
    issued_bytes: usize,
}
impl RedirectCookieOverlay {
    fn parsed_cookie(
        header: &reqwest::header::HeaderValue,
        issuer: &reqwest::Url,
    ) -> Result<Option<cookie_store::Cookie<'static>>, UpstreamError> {
        if header.as_bytes().len() > 4096 {
            return Err(UpstreamError::Policy(
                "Upstream cookie updates exceed the safe size limit. No further request was sent.",
            ));
        }
        let Some(cookie) = header
            .to_str()
            .ok()
            .and_then(|value| cookie_store::Cookie::parse(value.to_owned(), issuer).ok())
        else {
            return Ok(None);
        };
        let secure_issuer = issuer.scheme() == "https"
            || match issuer.host() {
                Some(url::Host::Domain(domain)) => domain == "localhost",
                Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
                Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
                None => false,
            };
        if cookie.secure() == Some(true) && !secure_issuer {
            return Ok(None);
        }
        if cookie.domain().is_some() {
            let Some(domain) = cookie.domain.as_cow() else {
                return Ok(None);
            };
            // Do not launder a browser-rejected public/private suffix into an
            // accepted host-only proxy cookie. Exact-issuer suffix attributes
            // are host-only under the browser rule and remain exact here.
            if issuer.host_str() != Some(domain.as_ref()) && psl::domain_str(&domain).is_none() {
                return Ok(None);
            }
        }
        // cookie_store enforces domain/path matching but not browser prefix
        // rules. Never turn a rejected __Host- Domain cookie into an accepted
        // cookie by projecting its Domain onto a protected loopback host.
        let secure_prefix = cookie.name().starts_with("__Secure-")
            || cookie.name().starts_with("__Host-")
            || cookie.name().starts_with("__Http-");
        if secure_prefix && (issuer.scheme() != "https" || cookie.secure() != Some(true))
            || cookie.name().starts_with("__Host-")
                && (cookie.domain().is_some() || cookie.path() != Some("/"))
            || (cookie.name().starts_with("__Http-") || cookie.name().starts_with("__Host-Http-"))
                && cookie.http_only() != Some(true)
        {
            return Ok(None);
        }
        Ok(Some(cookie))
    }
    fn projected_cookie(
        cookie: &cookie_store::Cookie<'static>,
    ) -> Result<reqwest::header::HeaderValue, UpstreamError> {
        let mut projected = std::ops::Deref::deref(cookie).clone();
        // Validation above bound the server Domain to the actual issuer. The
        // loopback proxy owns a unique host for this exact upstream origin.
        projected.unset_domain();
        projected.set_path((*cookie.path).to_owned());
        reqwest::header::HeaderValue::from_str(&projected.to_string()).map_err(|_| {
            UpstreamError::Policy(
                "The upstream returned an invalid cookie update. No further request was sent.",
            )
        })
    }
    fn observe(&mut self, response: &reqwest::Response, digest: bool) -> Result<(), UpstreamError> {
        if !(matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308)
            || digest && response.status() == reqwest::StatusCode::UNAUTHORIZED)
        {
            return Ok(());
        }
        if response.url().origin().ascii_serialization() != self.origin {
            return Err(UpstreamError::Policy(
                "Cookie updates changed origin. No further request was sent.",
            ));
        }
        for header in response.headers().get_all(reqwest::header::SET_COOKIE) {
            let Some(cookie) = Self::parsed_cookie(header, response.url())? else {
                continue;
            };
            // The final browser response can have a different path from the
            // issuing redirect. Preserve the original default-path explicitly.
            let browser_value = Self::projected_cookie(&cookie)?;
            self.issued_bytes = self
                .issued_bytes
                .saturating_add(browser_value.as_bytes().len());
            if self.issued.len() >= 128 || self.issued_bytes > 64 * 1024 {
                return Err(UpstreamError::Policy("Intermediate cookie updates exceed the safe size limit. No further request was sent."));
            }
            self.issued.push(browser_value);
            let existing = self.updates.iter().position(|old| {
                old.name() == cookie.name()
                    && old.domain.as_cow() == cookie.domain.as_cow()
                    && *old.path == *cookie.path
            });
            if let Some(index) = existing {
                self.updates[index] = cookie;
            } else {
                self.updates.push(cookie);
            }
            if self.updates.len() > 128
                || self
                    .updates
                    .iter()
                    .map(|cookie| cookie.to_string().len())
                    .sum::<usize>()
                    > 64 * 1024
            {
                return Err(UpstreamError::Policy("Intermediate cookie updates exceed the safe size limit. No further request was sent."));
            }
        }
        Ok(())
    }
    fn browser_header(&self, url: &reqwest::Url, browser: &[&str]) -> Option<String> {
        // With no explicit incoming Cookie, reqwest's existing provider must
        // remain solely responsible for all cookies, including non-attempt
        // sessions. Never replace its complete jar with a partial overlay.
        if browser.is_empty() || url.origin().ascii_serialization() != self.origin {
            return None;
        }
        let mut matching: Vec<_> = self
            .updates
            .iter()
            .filter(|cookie| cookie.matches(url))
            .collect();
        if matching.is_empty() {
            return None;
        }
        matching.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
        let mut values: Vec<_> = matching
            .iter()
            .filter(|cookie| !cookie.is_expired())
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect();
        values.extend(
            browser
                .iter()
                .flat_map(|header| header.split(';'))
                .map(str::trim)
                .filter(|pair| {
                    !pair.is_empty()
                        && !matching.iter().any(|cookie| {
                            pair.split_once('=')
                                .is_some_and(|(name, _)| name == cookie.name())
                        })
                })
                .map(str::to_owned),
        );
        Some(values.join("; "))
    }
    fn has_ambiguous_scope(&self, url: &reqwest::Url, browser: &[&str]) -> bool {
        self.updates
            .iter()
            .filter(|cookie| cookie.matches(url))
            .any(|cookie| {
                browser
                    .iter()
                    .flat_map(|value| value.split(';'))
                    .filter(|pair| {
                        pair.trim()
                            .split_once('=')
                            .is_some_and(|(name, _)| name == cookie.name())
                    })
                    .take(2)
                    .count()
                    > 1
            })
    }
    fn synchronize_browser(&self, response: &mut reqwest::Response) -> Result<(), UpstreamError> {
        let mut final_cookies = Vec::new();
        let mut bytes = self.issued_bytes;
        for header in response
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
        {
            if let Some(cookie) = Self::parsed_cookie(header, response.url())? {
                let value = Self::projected_cookie(&cookie)?;
                bytes = bytes.saturating_add(value.as_bytes().len());
                if self.issued.len() + final_cookies.len() >= 128 || bytes > 64 * 1024 {
                    return Err(UpstreamError::Policy("Upstream cookie updates exceed the safe size limit. No further request was sent."));
                }
                final_cookies.push(value);
            }
        }
        response.headers_mut().remove(reqwest::header::SET_COOKIE);
        // Preserve issuance order: the final response's rotation/deletion
        // must win over an earlier intermediate update of the same cookie.
        for cookie in self.issued.iter().chain(final_cookies.iter()) {
            response
                .headers_mut()
                .append(reqwest::header::SET_COOKIE, cookie.clone());
        }
        Ok(())
    }
}
impl From<reqwest::Error> for UpstreamError {
    fn from(error: reqwest::Error) -> Self {
        Self::Transport(error)
    }
}

pub(super) async fn send(
    state: &AxumProxyState,
    method: &reqwest::Method,
    input_url: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<reqwest::Response, UpstreamError> {
    // Keep one overall budget for authentication + all redirect hops, rather
    // than multiplying the client's timeout for each reissued request.
    tokio::time::timeout(std::time::Duration::from_secs(120), async {
        if let Some(google) = &state.network.google {
            let url = reqwest::Url::parse(input_url)
                .map_err(|_| UpstreamError::Policy("Invalid Google request URL"))?;
            let include_credentials = headers
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("x-sorng-google-credentials"))
                .is_none_or(|(_, value)| value == "include");
            google
                .send(method, &url, headers, body, include_credentials)
                .await
        } else {
            send_inner(state, method, input_url, headers, body, false).await
        }
    })
    .await
    .map_err(|_| UpstreamError::Deadline)?
}

pub(super) async fn send_websocket(
    state: &AxumProxyState,
    input_url: &str,
    headers: &[(String, String)],
) -> Result<reqwest::Response, UpstreamError> {
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        send_inner(state, &reqwest::Method::GET, input_url, headers, &[], true),
    )
    .await
    .map_err(|_| UpstreamError::Deadline)?
}

fn scoped_request_url(
    policy: &super::HttpProxyPolicy,
    tactical_rmm_api: Option<&super::tactical_rmm::TacticalRmmApiRoute>,
    input_url: &str,
) -> Result<(reqwest::Url, bool), UpstreamError> {
    let parsed_input = reqwest::Url::parse(input_url)
        .map_err(|_| UpstreamError::Policy("The upstream request URL is invalid."))?;
    let tactical_api_request = tactical_rmm_api.is_some_and(|route| route.permits(&parsed_input));
    // Connection query parameters belong only to the configured dashboard.
    // Never project them onto the separately scoped Tactical API capability.
    let url = if tactical_api_request {
        parsed_input
    } else {
        policy.request_url(input_url).map_err(|_| {
            UpstreamError::Policy("The configured HTTP query parameters could not be applied.")
        })?
    };
    Ok((url, tactical_api_request))
}

async fn send_inner(
    state: &AxumProxyState,
    method: &reqwest::Method,
    input_url: &str,
    headers: &[(String, String)],
    body: &[u8],
    websocket: bool,
) -> Result<reqwest::Response, UpstreamError> {
    let (mut url, tactical_api_request) = scoped_request_url(
        &state.proxy_policy,
        state.tactical_rmm_api.as_ref(),
        input_url,
    )?;
    let approved_origin = if url.origin().ascii_serialization() == state.target_origin {
        state.target_origin.clone()
    } else if state
        .tactical_rmm_api
        .as_ref()
        .is_some_and(|route| route.permits(&url))
    {
        url.origin().ascii_serialization()
    } else {
        return Err(UpstreamError::Policy(
            "The request is outside this connection's approved origin. Credentials were not sent.",
        ));
    };
    let client = if tactical_api_request {
        state
            .tactical_rmm_api
            .as_ref()
            .map(|route| route.client())
            .ok_or(UpstreamError::Policy(
                "The Tactical RMM API route is unavailable.",
            ))?
    } else {
        &state.client
    };
    let mut method = method.clone();
    let mut body = body.to_vec();
    let native_cookies_only = state
        .attempt
        .as_ref()
        .is_some_and(|attempt| attempt.native_cookies_only());
    let browser_cookies: Vec<_> = headers
        .iter()
        .filter(|(name, _)| !native_cookies_only && name.eq_ignore_ascii_case("cookie"))
        .map(|(_, value)| value.as_str())
        .collect();
    let mut cookie_overlay = RedirectCookieOverlay {
        origin: approved_origin.clone(),
        updates: Vec::new(),
        issued: Vec::new(),
        issued_bytes: 0,
    };
    let (user, password) = (
        state.username.read().map(|g| g.clone()).unwrap_or_default(),
        state.password.read().map(|g| g.clone()).unwrap_or_default(),
    );
    let redirect_limit = super::same_origin_redirect_limit(state.redirect_profile);
    let mut redirect_referrer = RedirectReferrerPolicy::OriginAllowed;
    for redirect in 0..=redirect_limit {
        if url.origin().ascii_serialization() != approved_origin
            || !url.username().is_empty()
            || url.password().is_some()
            || (state.proxy_policy.https_only && url.scheme() != "https")
        {
            return Err(UpstreamError::Policy("The upstream redirected outside this connection's approved origin. Credentials were not sent. Open the destination as a separate connection and review its trust."));
        }
        let request = |authorization: Option<String>, cookies: &RedirectCookieOverlay| {
            let mut request = client.request(method.clone(), url.clone());
            if websocket {
                request = request.version(reqwest::Version::HTTP_11);
            }
            let changed_cookie = cookies.browser_header(&url, &browser_cookies);
            let effective_cookies: Vec<_> = match changed_cookie.as_deref() {
                Some("") => Vec::new(),
                Some(value) => vec![value],
                None => browser_cookies.clone(),
            };
            let merged_cookies = state
                .attempt
                .as_ref()
                .and_then(|attempt| attempt.merged_request_cookies(&url, &effective_cookies));
            for (name, value) in headers {
                if name.eq_ignore_ascii_case("referer")
                    && match redirect_referrer {
                        RedirectReferrerPolicy::Suppress => true,
                        RedirectReferrerPolicy::SameOrigin => reqwest::Url::parse(value)
                            .map_or(true, |referer| referer.origin() != url.origin()),
                        RedirectReferrerPolicy::OriginAllowed => false,
                    }
                {
                    continue;
                }
                if name.eq_ignore_ascii_case("cookie")
                    && (native_cookies_only || merged_cookies.is_some() || changed_cookie.is_some())
                {
                    continue;
                }
                if body.is_empty()
                    && method == reqwest::Method::GET
                    && name.eq_ignore_ascii_case("content-type")
                {
                    continue;
                }
                request = request.header(name, value);
            }
            if let Some(cookies) = merged_cookies {
                request = request.header(reqwest::header::COOKIE, cookies);
            } else if let Some(cookies) = changed_cookie.filter(|value| !value.is_empty()) {
                request = request.header(reqwest::header::COOKIE, cookies);
            }
            if !tactical_api_request {
                request = state
                    .upstream_auth_mode
                    .apply_credentials(request, &user, &password);
            }
            if let Some(value) = authorization {
                request = request.header(reqwest::header::AUTHORIZATION, value);
            }
            if !body.is_empty() {
                request = request.body(body.clone());
            }
            request
        };
        let mut response = request(None, &cookie_overlay).send().await?;
        if !websocket && !tactical_api_request {
            cookie_overlay.observe(
                &response,
                state.upstream_auth_mode == UpstreamAuthMode::Digest,
            )?;
        }
        if !tactical_api_request
            && state.upstream_auth_mode == UpstreamAuthMode::Digest
            && response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            let mut challenge =
                http_digest::challenge(response.headers()).map_err(UpstreamError::Policy)?;
            if user.is_empty() && password.is_empty() {
                return Err(UpstreamError::Policy("HTTP Digest requires saved credentials. Edit this connection's username and password, then reconnect."));
            }
            for attempt in 0..2 {
                if cookie_overlay.has_ambiguous_scope(&url, &browser_cookies) {
                    return Err(UpstreamError::Policy("The server changed cookies with ambiguous browser path scopes. Clear session cookies and retry. No further request was sent."));
                }
                let uri = match url.query() {
                    Some(query) => format!("{}?{query}", url.path()),
                    None => url.path().to_string(),
                };
                let authorization = challenge
                    .authorization(
                        &user,
                        &password,
                        method.as_str(),
                        &uri,
                        &crate::themed_auth::fresh_nonce(),
                    )
                    .map_err(UpstreamError::Policy)?;
                response = request(Some(authorization), &cookie_overlay).send().await?;
                if !websocket {
                    cookie_overlay.observe(&response, true)?;
                }
                if response.status() != reqwest::StatusCode::UNAUTHORIZED {
                    break;
                }
                let next =
                    http_digest::challenge(response.headers()).map_err(UpstreamError::Policy)?;
                if attempt != 0 || !next.stale {
                    return Err(UpstreamError::Policy("The server rejected HTTP Digest authentication. Review the saved credentials and server policy, then reconnect; no automatic login loop was started."));
                }
                challenge = next;
            }
        }
        let status = response.status();
        if !matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
            if !websocket && !tactical_api_request {
                cookie_overlay.synchronize_browser(&mut response)?;
            }
            return Ok(response);
        }
        if websocket {
            return Err(UpstreamError::Policy("A WebSocket handshake cannot follow redirects. Review the endpoint before reconnecting."));
        }
        if let Some(policy) = redirect_referrer_policy(response.headers()) {
            // A later absent/unknown header does not discard a restriction
            // issued by an earlier same-origin redirect in this request.
            redirect_referrer = policy;
        }
        if redirect == redirect_limit {
            return Err(UpstreamError::RedirectLoop);
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(UpstreamError::Policy(
                "The upstream returned an invalid redirect.",
            ))?;
        let next = response
            .url()
            .join(location)
            .map_err(|_| UpstreamError::Policy("The upstream returned an invalid redirect."))?;
        // Check BEFORE another send, even when browsing restrictions are off.
        if !matches!(next.scheme(), "http" | "https")
            || !next.username().is_empty()
            || next.password().is_some()
        {
            return Err(UpstreamError::Policy(
                "The upstream returned an invalid redirect destination. No request was sent.",
            ));
        }
        if next.origin() != url.origin() {
            return Err(UpstreamError::CrossOriginRedirect(Box::new(
                CrossOriginRedirect {
                    destination: next,
                    response_url: response.url().clone(),
                    status: status.as_u16(),
                    method: method.clone(),
                    same_origin_redirects: redirect as u32,
                    suppress_referrer: redirect_referrer != RedirectReferrerPolicy::OriginAllowed,
                },
            )));
        }
        let next = if tactical_api_request {
            next
        } else {
            state.proxy_policy.request_url(next.as_str()).map_err(|_| {
                UpstreamError::Policy("The configured HTTP query parameters could not be applied.")
            })?
        };
        if cookie_overlay.has_ambiguous_scope(&next, &browser_cookies) {
            // The raw browser header cannot identify which path each value
            // belongs to. Do not silently discard one session identity, nor
            // bypass native redirect deadlines with a browser-follow loop.
            return Err(UpstreamError::Policy("The server changed cookies with ambiguous browser path scopes. Clear session cookies and retry. No further request was sent."));
        }
        if (status == reqwest::StatusCode::SEE_OTHER && method != reqwest::Method::HEAD)
            || (matches!(status.as_u16(), 301 | 302) && method == reqwest::Method::POST)
        {
            method = reqwest::Method::GET;
            body.clear();
        }
        url = next;
    }
    Err(UpstreamError::RedirectLoop)
}

#[cfg(test)]
mod tactical_scope_tests {
    use super::scoped_request_url;
    use crate::http::proxy_policy::QueryParameter;
    use crate::http::{HttpProxyPolicy, ReviewedApplicationProfile};

    #[test]
    fn connection_query_parameters_are_never_projected_onto_tactical_api() {
        let mut policy = HttpProxyPolicy::default();
        policy.query_parameters.push(QueryParameter {
            name: "dashboard-secret".into(),
            value: "must-not-cross-origin".into(),
        });
        let route = crate::http::tactical_rmm::TacticalRmmApiRoute::new(
            Some(ReviewedApplicationProfile::TacticalRmm),
            &reqwest::Url::parse("https://rmm.example.test/").unwrap(),
            None,
            reqwest::Client::new(),
        )
        .unwrap();

        let Ok((dashboard, tactical)) = scoped_request_url(
            &policy,
            Some(&route),
            "https://rmm.example.test/login?next=agents",
        ) else {
            panic!("dashboard URL should be accepted");
        };
        assert!(!tactical);
        assert!(dashboard
            .query_pairs()
            .any(|(name, value)| name == "dashboard-secret" && value == "must-not-cross-origin"));

        let Ok((api, tactical)) = scoped_request_url(
            &policy,
            Some(&route),
            "https://api.rmm.example.test/v3/checkin?agent=42",
        ) else {
            panic!("Tactical API URL should be accepted");
        };
        assert!(tactical);
        assert_eq!(api.query(), Some("agent=42"));
    }
}

#[cfg(test)]
mod cookie_projection_tests {
    use super::RedirectCookieOverlay;

    #[test]
    fn redirect_referrer_policy_uses_last_recognized_token_without_exposing_headers() {
        use super::RedirectReferrerPolicy::{OriginAllowed, SameOrigin, Suppress};
        for (value, expected) in [
            ("unknown", None),
            ("no-referrer", Some(Suppress)),
            ("same-origin", Some(SameOrigin)),
            ("origin, no-referrer, unknown", Some(Suppress)),
            ("no-referrer, origin", Some(OriginAllowed)),
            (
                "SAME-ORIGIN, strict-origin-when-cross-origin",
                Some(OriginAllowed),
            ),
        ] {
            let mut headers = reqwest::header::HeaderMap::new();
            headers.append("referrer-policy", value.parse().unwrap());
            assert_eq!(super::redirect_referrer_policy(&headers), expected);
        }
        let mut headers = reqwest::header::HeaderMap::new();
        assert_eq!(super::redirect_referrer_policy(&headers), None);
        headers.append("referrer-policy", "origin".parse().unwrap());
        headers.append("referrer-policy", "same-origin, unknown".parse().unwrap());
        assert_eq!(super::redirect_referrer_policy(&headers), Some(SameOrigin));
        headers.append("referrer-policy", "x".repeat(1025).parse().unwrap());
        assert_eq!(super::redirect_referrer_policy(&headers), Some(Suppress));
    }

    #[test]
    fn domain_projection_does_not_upgrade_invalid_secure_cookie_prefixes() {
        let issuer = reqwest::Url::parse("https://login.fixture.test/path").unwrap();
        for invalid in [
            "__Host-id=synthetic; Domain=fixture.test; Secure; Path=/",
            "__Host-id=synthetic; Secure",
            "__Host-id=synthetic; Path=/",
            "__Secure-id=synthetic; Path=/",
            "__Http-id=synthetic; Secure; Path=/",
            "__Host-Http-id=synthetic; Secure; Path=/",
        ] {
            assert!(
                RedirectCookieOverlay::parsed_cookie(&invalid.parse().unwrap(), &issuer)
                    .ok()
                    .flatten()
                    .is_none()
            );
        }
        let valid = "__Host-id=synthetic; Secure; HttpOnly; Path=/; SameSite=Lax";
        let cookie = RedirectCookieOverlay::parsed_cookie(&valid.parse().unwrap(), &issuer)
            .ok()
            .flatten()
            .unwrap();
        let projected = RedirectCookieOverlay::projected_cookie(&cookie)
            .ok()
            .unwrap();
        let value = projected.to_str().unwrap();
        assert!(
            value.contains("Secure")
                && value.contains("HttpOnly")
                && value.contains("SameSite=Lax")
        );
        assert!(value.contains("Path=/") && !value.contains("Domain="));
        let insecure = reqwest::Url::parse("http://login.fixture.test/").unwrap();
        assert!(
            RedirectCookieOverlay::parsed_cookie(&valid.parse().unwrap(), &insecure)
                .ok()
                .flatten()
                .is_none()
        );
    }

    #[test]
    fn domain_projection_rejects_public_and_private_suffixes_without_guessing_tlds() {
        for (host, domain) in [
            ("device.com", "com"),
            ("device.co.uk", "co.uk"),
            ("device.github.io", "github.io"),
            ("device.direct.quickconnect.to", "direct.quickconnect.to"),
        ] {
            let issuer = reqwest::Url::parse(&format!("https://{host}/")).unwrap();
            let value = format!("sid=synthetic; Domain={domain}; Path=/");
            assert!(
                RedirectCookieOverlay::parsed_cookie(&value.parse().unwrap(), &issuer)
                    .ok()
                    .flatten()
                    .is_none()
            );
        }
        for (host, domain) in [
            ("login.example.com", "example.com"),
            ("example.fr3.quickconnect.to", "quickconnect.to"),
            ("login.device.github.io", "device.github.io"),
            ("github.io", "github.io"),
        ] {
            let issuer = reqwest::Url::parse(&format!("https://{host}/")).unwrap();
            let value = format!("sid=synthetic; Domain={domain}; Path=/");
            assert!(
                RedirectCookieOverlay::parsed_cookie(&value.parse().unwrap(), &issuer)
                    .ok()
                    .flatten()
                    .is_some()
            );
        }
    }

    #[test]
    fn ordinary_secure_cookie_projection_preserves_only_maintained_secure_contexts() {
        let value = "sid=synthetic; Secure; Path=/".parse().unwrap();
        for issuer in [
            "http://example.com/",
            "http://device.localhost/",
            "http://192.168.1.2/",
        ] {
            assert!(RedirectCookieOverlay::parsed_cookie(
                &value,
                &reqwest::Url::parse(issuer).unwrap()
            )
            .ok()
            .flatten()
            .is_none());
        }
        for issuer in [
            "https://example.com/",
            "http://localhost/",
            "http://127.0.0.2/",
            "http://[::1]/",
        ] {
            let cookie =
                RedirectCookieOverlay::parsed_cookie(&value, &reqwest::Url::parse(issuer).unwrap())
                    .ok()
                    .flatten()
                    .unwrap();
            assert_eq!(cookie.secure(), Some(true));
        }
    }
}
