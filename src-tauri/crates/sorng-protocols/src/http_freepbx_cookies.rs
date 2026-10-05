//! FreePBX's PHP login session belongs to its protected proxy, not to the
//! renderer's third-party cookie policy. A partial browser Cookie header must
//! not suppress the native session or undo a server-issued session rotation.
//! Other cookies (including UI preferences) remain browser-owned.
use cookie_store::CookieStore;
use reqwest::{header::HeaderValue, Url};
use std::sync::Mutex;

pub(super) const SESSION_COOKIE: &str = "PHPSESSID";
const MAX_COOKIES: usize = 64;
const MAX_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_COOKIES: usize = 128;

#[derive(Default)]
struct Session {
    jar: CookieStore,
}

pub(super) struct FreepbxCookies {
    origin: String,
    // None is permanently retired; in-flight responses cannot revive it.
    session: Mutex<Option<Session>>,
}

impl FreepbxCookies {
    pub(super) fn new(origin: &str) -> Result<Self, &'static str> {
        let url = Url::parse(origin).map_err(|_| "Invalid FreePBX cookie origin")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || url.origin().ascii_serialization() != origin
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("FreePBX cookies require the saved HTTP(S) origin");
        }
        Ok(Self {
            origin: origin.into(),
            session: Mutex::new(Some(Session::default())),
        })
    }

    pub(super) fn revoke(&self) {
        if let Ok(mut session) = self.session.lock() {
            *session = None;
        }
    }

    fn check_url(&self, url: &Url) -> Result<(), &'static str> {
        if url.origin().ascii_serialization() != self.origin
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("FreePBX cookie origin is not approved");
        }
        Ok(())
    }

    pub(super) fn cookie_header(
        &self,
        url: &Url,
        browser: &[&str],
    ) -> Result<HeaderValue, &'static str> {
        self.check_url(url)?;
        if browser.iter().map(|v| v.len()).sum::<usize>() > MAX_BYTES {
            return Err("FreePBX request cookie limit exceeded");
        }
        let guard = self
            .session
            .lock()
            .map_err(|_| "FreePBX cookies unavailable")?;
        let session = guard.as_ref().ok_or("FreePBX cookie session ended")?;
        let mut cookies = session.jar.matches(url);
        cookies.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
        let mut values: Vec<_> = cookies
            .iter()
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect();
        values.extend(
            browser
                .iter()
                .flat_map(|header| header.split(';'))
                .map(str::trim)
                .filter(|pair| {
                    !pair.is_empty()
                        && !pair
                            .split_once('=')
                            .is_some_and(|(name, _)| name == SESSION_COOKIE)
                })
                .map(str::to_owned),
        );
        let value = values.join("; ");
        if value.len() > MAX_BYTES {
            return Err("FreePBX request cookie limit exceeded");
        }
        // Always explicit, even empty: reqwest's separate automatic jar must
        // not reintroduce a deleted cookie or an unscoped browser value.
        HeaderValue::from_str(&value).map_err(|_| "Invalid FreePBX request cookies")
    }

    fn insert(
        jar: &mut CookieStore,
        cookie: cookie_store::Cookie<'static>,
        url: &Url,
    ) -> Result<(), &'static str> {
        match jar.insert(cookie, url) {
            Ok(_) | Err(cookie_store::CookieError::Expired) => Ok(()),
            Err(_) => Err("Invalid FreePBX session cookie"),
        }
    }

    fn update(&self, url: &Url, values: &[HeaderValue]) -> Result<(), &'static str> {
        self.check_url(url)?;
        if values.len() > MAX_RESPONSE_COOKIES
            || values.iter().map(|v| v.as_bytes().len()).sum::<usize>() > MAX_BYTES
        {
            return Err("FreePBX response cookie limit exceeded");
        }
        let mut guard = self
            .session
            .lock()
            .map_err(|_| "FreePBX cookies unavailable")?;
        let session = guard.as_ref().ok_or("FreePBX cookie session ended")?;
        // Prune expired entries and commit atomically. A malformed/oversized
        // response must not partially rotate the current login.
        let mut candidate = Session::default();
        for cookie in session.jar.iter_unexpired() {
            Self::insert(&mut candidate.jar, cookie.clone().into_owned(), url)?;
        }
        for value in values {
            let Some(cookie) = super::upstream::validated_response_cookie(value, url)? else {
                continue;
            };
            if cookie.name() != SESSION_COOKIE {
                continue;
            }
            Self::insert(&mut candidate.jar, cookie, url)?;
        }
        if candidate.jar.iter_unexpired().count() > MAX_COOKIES
            || candidate
                .jar
                .iter_unexpired()
                .map(|cookie| cookie.to_string().len())
                .sum::<usize>()
                > MAX_BYTES
        {
            return Err("FreePBX session cookie limit exceeded");
        }
        *guard = Some(candidate);
        Ok(())
    }

    pub(super) fn observe_response(
        &self,
        response: &reqwest::Response,
    ) -> Result<(), &'static str> {
        // Includes initial HTML, successful POSTs, redirects and logout/error
        // responses. Keep Set-Cookie intact for the existing browser projection.
        let values: Vec<_> = response
            .headers()
            .get_all("set-cookie")
            .iter()
            .cloned()
            .collect();
        self.update(response.url(), &values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGIN: &str = "https://pbx.example.test";

    fn write(jar: &FreepbxCookies, url: &Url, value: &str) {
        jar.update(url, &[HeaderValue::from_str(value).unwrap()])
            .unwrap();
    }

    #[test]
    fn freepbx_cookie_rotation_expiry_and_deletion_override_stale_browser() {
        let jar = FreepbxCookies::new(ORIGIN).unwrap();
        let url = Url::parse(&format!("{ORIGIN}/admin/")).unwrap();
        // A fresh proxy must obtain its own server-issued PHP session, never
        // adopt a browser value belonging to a previous/different session.
        assert_eq!(
            jar.cookie_header(&url, &["PHPSESSID=existing; theme=light"])
                .unwrap(),
            "theme=light"
        );
        write(&jar, &url, "PHPSESSID=prelogin; HttpOnly; Secure; Path=/");
        write(
            &jar,
            &url,
            "PHPSESSID=authenticated; HttpOnly; Secure; Path=/",
        );
        write(&jar, &url, "theme=server-old; Path=/");
        assert_eq!(
            jar.cookie_header(&url, &["theme=dark", "PHPSESSID=prelogin"])
                .unwrap(),
            "PHPSESSID=authenticated; theme=dark"
        );
        write(&jar, &url, "PHPSESSID=; Max-Age=0; Path=/");
        assert_eq!(
            jar.cookie_header(&url, &["PHPSESSID=authenticated; theme=dark"])
                .unwrap(),
            "theme=dark"
        );
        write(&jar, &url, "PHPSESSID=again; Path=/");
        write(
            &jar,
            &url,
            "PHPSESSID=expired; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
        );
        assert_eq!(jar.cookie_header(&url, &["PHPSESSID=again"]).unwrap(), "");
    }

    #[test]
    fn freepbx_cookie_paths_origins_and_revocation_remain_isolated() {
        let jar = FreepbxCookies::new(ORIGIN).unwrap();
        let url = Url::parse(&format!("{ORIGIN}/admin/login.php")).unwrap();
        write(&jar, &url, "PHPSESSID=root; Path=/");
        write(&jar, &url, "PHPSESSID=admin; HttpOnly");
        write(&jar, &url, "PHPSESSID=foreign; Domain=foreign.test; Path=/");
        assert_eq!(
            jar.cookie_header(
                &url,
                &["PHPSESSID=stale-admin; PHPSESSID=stale-root; theme=dark"]
            )
            .unwrap(),
            "PHPSESSID=admin; PHPSESSID=root; theme=dark"
        );
        let other_path = Url::parse(&format!("{ORIGIN}/administrator")).unwrap();
        assert_eq!(
            jar.cookie_header(&other_path, &["PHPSESSID=stale"])
                .unwrap(),
            "PHPSESSID=root"
        );
        for other in [
            "http://pbx.example.test/admin/",
            "https://pbx.example.test:8443/admin/",
            "https://other.example.test/admin/",
            "https://user@pbx.example.test/admin/",
        ] {
            let other = Url::parse(other).unwrap();
            assert!(jar.cookie_header(&other, &[]).is_err());
            assert!(jar.update(&other, &[]).is_err());
        }
        let independent = FreepbxCookies::new(ORIGIN).unwrap();
        assert_eq!(independent.cookie_header(&url, &[]).unwrap(), "");
        jar.revoke();
        assert!(jar.cookie_header(&url, &[]).is_err());
        assert!(jar
            .update(&url, &[HeaderValue::from_static("PHPSESSID=late; Path=/")])
            .is_err());
    }

    #[test]
    fn freepbx_cookie_limits_are_atomic_and_http_cannot_accept_secure_cookies() {
        let jar = FreepbxCookies::new("http://pbx.example.test").unwrap();
        let url = Url::parse("http://pbx.example.test/admin/").unwrap();
        write(&jar, &url, "PHPSESSID=invalid; Secure; Path=/");
        assert_eq!(jar.cookie_header(&url, &[]).unwrap(), "");
        let values: Vec<_> = (0..MAX_COOKIES)
            .map(|i| HeaderValue::from_str(&format!("PHPSESSID=value; Path=/p{i}")).unwrap())
            .collect();
        jar.update(&url, &values).unwrap();
        assert!(jar
            .update(
                &url,
                &[HeaderValue::from_static("PHPSESSID=excess; Path=/")]
            )
            .is_err());
        assert_eq!(
            jar.cookie_header(&Url::parse("http://pbx.example.test/p0").unwrap(), &[])
                .unwrap(),
            "PHPSESSID=value"
        );
        assert!(jar
            .update(
                &url,
                &vec![
                    HeaderValue::from_static("PHPSESSID=bad; Path=/p0");
                    MAX_RESPONSE_COOKIES + 1
                ]
            )
            .is_err());
        assert!(jar
            .cookie_header(&url, &[&"x".repeat(MAX_BYTES + 1)])
            .is_err());
        for invalid in [
            "https://pbx.example.test/admin",
            "https://pbx.example.test/",
            "https://user@pbx.example.test",
            "file:///admin",
            "https://pbx.example.test?x=1",
        ] {
            assert!(FreepbxCookies::new(invalid).is_err());
        }
    }
}
