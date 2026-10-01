//! Volatile, exact-origin Exchange cookies. Embedded third-party cookie policy
//! must not break OWA's synchronous cookie probe or the ECP login redirect.
//! The browser sees only non-HttpOnly values through a protected local bridge;
//! upstream Set-Cookie and Cookie never use a localhost browser mirror.
use cookie_store::CookieStore;
use reqwest::{header::HeaderValue, Url};
use std::sync::Mutex;

pub(super) const COOKIE_BRIDGE_PATH: &str = "/__sortofremoteng_exchange_cookie_v1";
pub(super) const CREDENTIALS_HEADER: &str = "x-sorng-exchange-credentials";
const COOKIE_PATH_HEADER: &str = "x-sorng-exchange-cookie-path";
const MAX_COOKIES: usize = 512;
const MAX_BYTES: usize = 256 * 1024;

pub(super) struct ExchangeCookies {
    origin: String,
    // None is permanently revoked. Late response completions cannot recreate
    // the session after its network owner has been retired.
    jar: Mutex<Option<CookieStore>>,
}

impl ExchangeCookies {
    pub(super) fn new(origin: &str) -> Result<Self, &'static str> {
        let url = Url::parse(origin).map_err(|_| "Invalid Exchange cookie origin")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || url.origin().ascii_serialization() != origin
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Exchange cookies require the saved HTTPS origin");
        }
        Ok(Self {
            origin: origin.into(),
            jar: Mutex::new(Some(CookieStore::default())),
        })
    }

    pub(super) fn revoke(&self) {
        if let Ok(mut jar) = self.jar.lock() {
            *jar = None;
        }
    }

    fn check_url(&self, url: &Url) -> Result<(), &'static str> {
        if url.origin().ascii_serialization() != self.origin
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Exchange cookie origin is not approved");
        }
        Ok(())
    }

    fn document_url(&self, headers: &axum::http::HeaderMap) -> Result<Url, &'static str> {
        let path = headers
            .get(COOKIE_PATH_HEADER)
            .and_then(|value| value.to_str().ok())
            .ok_or("Missing Exchange document cookie path")?;
        if path.is_empty()
            || path.len() > 4096
            || !path.starts_with('/')
            || path.starts_with("//")
            || path.contains(['?', '#', '\\'])
            || path.chars().any(|c| c.is_ascii_control())
        {
            return Err("Invalid Exchange document cookie path");
        }
        let url = Url::parse(&format!("{}{path}", self.origin))
            .map_err(|_| "Invalid Exchange document cookie path")?;
        self.check_url(&url)?;
        // location.pathname is canonical already. Refuse a caller-supplied
        // dot-segment/whitespace path instead of silently changing its scope.
        if url.path() != path {
            return Err("Invalid Exchange document cookie path");
        }
        Ok(url)
    }

    fn read(&self, url: &Url, script: bool) -> Result<String, &'static str> {
        self.check_url(url)?;
        let guard = self
            .jar
            .lock()
            .map_err(|_| "Exchange cookies unavailable")?;
        let jar = guard.as_ref().ok_or("Exchange cookie session ended")?;
        let mut cookies = jar.matches(url);
        cookies.retain(|cookie| !script || cookie.http_only() != Some(true));
        cookies.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
        Ok(cookies
            .iter()
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; "))
    }

    pub(super) fn cookie_header(&self, url: &Url) -> Result<HeaderValue, &'static str> {
        // An explicit empty header also prevents reqwest's separate automatic
        // cookie provider from resurrecting an expired/deleted cookie.
        HeaderValue::from_str(&self.read(url, false)?)
            .map_err(|_| "Invalid Exchange request cookies")
    }

    fn insert(
        jar: &mut CookieStore,
        cookie: cookie_store::Cookie<'static>,
        url: &Url,
    ) -> Result<(), &'static str> {
        match jar.insert(cookie, url) {
            Ok(_) | Err(cookie_store::CookieError::Expired) => Ok(()),
            Err(_) => Err("Invalid Exchange cookie"),
        }
    }

    fn update(&self, url: &Url, values: &[HeaderValue], script: bool) -> Result<(), &'static str> {
        self.check_url(url)?;
        let mut guard = self
            .jar
            .lock()
            .map_err(|_| "Exchange cookies unavailable")?;
        let jar = guard.as_ref().ok_or("Exchange cookie session ended")?;
        // Rebuild only live entries so repeated expiry/delete cycles are also
        // bounded. Commit atomically: an oversized write must not wipe a login.
        let mut candidate = CookieStore::default();
        for cookie in jar.iter_unexpired() {
            Self::insert(&mut candidate, cookie.clone().into_owned(), url)?;
        }
        for value in values {
            let Some(cookie) = super::upstream::validated_response_cookie(value, url)? else {
                continue;
            };
            if script
                && (cookie.http_only() == Some(true)
                    || candidate.iter_unexpired().any(|existing| {
                        existing.http_only() == Some(true)
                            && existing.name() == cookie.name()
                            // HostOnly and Domain=host share a cookie storage
                            // key. Neither form may overwrite an HttpOnly one.
                            && existing.domain.as_cow() == cookie.domain.as_cow()
                            && *existing.path == *cookie.path
                    }))
            {
                continue;
            }
            Self::insert(&mut candidate, cookie, url)?;
        }
        if candidate.iter_unexpired().count() > MAX_COOKIES
            || candidate
                .iter_unexpired()
                .map(|cookie| cookie.to_string().len())
                .sum::<usize>()
                > MAX_BYTES
        {
            return Err("Exchange cookie limit exceeded");
        }
        *guard = Some(candidate);
        Ok(())
    }

    pub(super) fn observe_response(
        &self,
        response: &mut reqwest::Response,
        include: bool,
    ) -> Result<(), &'static str> {
        self.check_url(response.url())?;
        let values: Vec<_> = response
            .headers()
            .get_all("set-cookie")
            .iter()
            .cloned()
            .collect();
        // Never expose authentication cookies to localhost or a second jar in
        // the renderer, even for credentials:omit requests or invalid cookies.
        response.headers_mut().remove("set-cookie");
        if include && !values.is_empty() {
            if values.len() > 128 {
                return Err("Exchange response cookie limit exceeded");
            }
            self.update(response.url(), &values, false)?;
        }
        Ok(())
    }

    /// Must be called only after protected proxy Host/Origin/lifetime checks.
    pub(super) async fn document_cookie_response(
        &self,
        request: axum::extract::Request,
    ) -> axum::response::Response {
        use axum::{
            body::Body,
            http::{Method, StatusCode},
            response::Response,
        };
        let url = self.document_url(request.headers());
        let result = match (request.method().clone(), url) {
            (Method::GET, Ok(url)) => self.read(&url, true).map(|v| (StatusCode::OK, v)),
            (Method::POST, Ok(url)) => {
                match axum::body::to_bytes(request.into_body(), 4096).await {
                    Ok(value) if !value.is_empty() => HeaderValue::from_bytes(&value)
                        .map_err(|_| "Invalid Exchange document cookie")
                        .and_then(|value| self.update(&url, &[value], true))
                        .map(|()| (StatusCode::NO_CONTENT, String::new())),
                    _ => Err("Invalid Exchange document cookie"),
                }
            }
            (_, Err(detail)) => Err(detail),
            _ => {
                return Response::builder()
                    .status(StatusCode::METHOD_NOT_ALLOWED)
                    .header("allow", "GET, POST")
                    .header("cache-control", "no-store")
                    .body(Body::empty())
                    .expect("static Exchange cookie method refusal")
            }
        };
        let (status, body) = match result {
            Ok(value) => value,
            Err(detail) => (StatusCode::BAD_REQUEST, detail.into()),
        };
        Response::builder()
            .status(status)
            .header("cache-control", "no-store")
            .header("content-type", "text/plain; charset=utf-8")
            .header("x-content-type-options", "nosniff")
            .body(Body::from(body))
            .expect("static Exchange cookie bridge response")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exchange_ecp_cookie_scope_httponly_expiry_and_revocation() {
        let jar = ExchangeCookies::new("https://exchange.example.test").unwrap();
        let login = Url::parse("https://exchange.example.test/owa/auth/logon.aspx").unwrap();
        let ecp = Url::parse("https://exchange.example.test/ecp/").unwrap();
        let write = |value: &str, script| {
            jar.update(&login, &[HeaderValue::from_str(value).unwrap()], script)
                .unwrap()
        };
        write("session=private; Secure; HttpOnly; Path=/", false);
        write(
            "session=poison; Secure; Domain=exchange.example.test; Path=/",
            true,
        );
        write("session=; Max-Age=0; Path=/", true);
        write("implicit=private; Secure; HttpOnly", false);
        write("implicit=poison; Path=/owa/auth", true);
        write("implicit=; Max-Age=0; Path=/owa/auth", true);
        write("probe=works; Secure; Path=/owa", true);
        assert_eq!(jar.read(&login, true).unwrap(), "probe=works");
        assert!(jar
            .read(&login, false)
            .unwrap()
            .contains("implicit=private"));
        assert_eq!(jar.read(&ecp, false).unwrap(), "session=private");
        write("probe=; Max-Age=0; Path=/owa", true);
        assert_eq!(jar.read(&login, true).unwrap(), "");
        write(
            "__Host-bad=value; Secure; Domain=example.test; Path=/",
            true,
        );
        write("cross=bad; Domain=elsewhere.test; Path=/", true);
        assert_eq!(jar.read(&ecp, false).unwrap(), "session=private");
        assert!(jar
            .read(
                &Url::parse("https://other.example.test/ecp/").unwrap(),
                false
            )
            .is_err());
        jar.revoke();
        assert!(jar.read(&ecp, false).is_err());
        assert!(jar
            .update(&login, &[HeaderValue::from_static("late=value")], false)
            .is_err());
    }

    #[test]
    fn exchange_ecp_cookie_limits_preserve_existing_session() {
        let jar = ExchangeCookies::new("https://exchange.example.test").unwrap();
        let url = Url::parse("https://exchange.example.test/ecp/").unwrap();
        let values: Vec<_> = (0..MAX_COOKIES)
            .map(|i| HeaderValue::from_str(&format!("c{i}=value; Path=/")).unwrap())
            .collect();
        jar.update(&url, &values, false).unwrap();
        assert!(jar
            .update(
                &url,
                &[HeaderValue::from_static("excess=value; Path=/")],
                false
            )
            .is_err());
        assert_eq!(
            jar.read(&url, false).unwrap().split("; ").count(),
            MAX_COOKIES
        );
        assert!(!jar.read(&url, false).unwrap().contains("excess="));
        assert!(ExchangeCookies::new("http://exchange.example.test").is_err());
    }
}
