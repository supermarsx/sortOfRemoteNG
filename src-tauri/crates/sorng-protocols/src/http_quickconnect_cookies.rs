//! Provider-control-only volatile cookies. Never shared with a website jar,
//! browser, probe, different provider origin, or different original NAS.
use reqwest::{
    header::{HeaderMap, HeaderValue, SET_COOKIE},
    Url,
};
use std::collections::HashMap;

const MAX_ORIGINS: usize = 8;
const MAX_COOKIES: usize = 32;
const MAX_BYTES: usize = 16 * 1024;
const UNAVAILABLE: &str =
    "The provider cookie context is unavailable or exceeds its supported limits.";

// Deliberately not Debug/Serialize. All access is through an enclosing current
// native-document guard and attempt-generation lock or local-session mutex.
#[derive(Default)]
pub(crate) struct ProviderControlCookies {
    alias: Option<String>,
    origins: HashMap<String, cookie_store::CookieStore>,
    revoked: bool,
}

pub(super) fn capture(headers: &HeaderMap) -> Result<HeaderMap, &'static str> {
    let mut result = HeaderMap::new();
    let mut bytes = 0usize;
    for (count, value) in headers.get_all(SET_COOKIE).iter().enumerate() {
        bytes = bytes.saturating_add(value.as_bytes().len());
        if count >= MAX_COOKIES || value.as_bytes().len() > 4096 || bytes > MAX_BYTES {
            return Err(UNAVAILABLE);
        }
        result.append(SET_COOKIE, value.clone());
    }
    Ok(result)
}

impl ProviderControlCookies {
    pub(crate) fn progress_fingerprint(&self) -> [u8; 32] {
        use sha2::{Digest, Sha256};
        let mut rows = Vec::new();
        for (origin, jar) in &self.origins {
            for cookie in jar.iter_unexpired() {
                let (kind, domain) = match &cookie.domain {
                    cookie_store::CookieDomain::HostOnly(value) => (0, value.as_str()),
                    cookie_store::CookieDomain::Suffix(value) => (1, value.as_str()),
                    cookie_store::CookieDomain::NotPresent => (2, ""),
                    cookie_store::CookieDomain::Empty => (3, ""),
                };
                rows.push(vec![
                    origin.as_bytes().to_vec(),
                    vec![kind],
                    domain.as_bytes().to_vec(),
                    cookie.path.as_bytes().to_vec(),
                    cookie.name().as_bytes().to_vec(),
                    cookie.value().as_bytes().to_vec(),
                    vec![
                        cookie.secure().unwrap_or(false) as u8,
                        cookie.http_only().unwrap_or(false) as u8,
                        cookie.partitioned().unwrap_or(false) as u8,
                    ],
                    cookie
                        .same_site()
                        .map(|value| value.to_string())
                        .unwrap_or_default()
                        .into_bytes(),
                ]);
            }
        }
        rows.sort_unstable();
        let mut digest = Sha256::new();
        digest.update(b"provider-control-cookie-state-v1");
        for row in rows {
            for field in row {
                digest.update((field.len() as u64).to_be_bytes());
                digest.update(field);
            }
        }
        digest.finalize().into()
    }
    fn bind(&mut self, alias: &str, url: &Url) -> Result<String, &'static str> {
        if self.revoked
            || super::discovered::classify(url, alias) != Some(super::discovered::Route::Control)
            || self.alias.as_ref().is_some_and(|bound| bound != alias)
        {
            return Err(UNAVAILABLE);
        }
        if self.alias.is_none() {
            self.alias = Some(alias.into());
        }
        Ok(url.origin().ascii_serialization())
    }
    pub(crate) fn request_header(
        &mut self,
        alias: &str,
        url: &Url,
    ) -> Result<Option<HeaderValue>, &'static str> {
        let origin = self.bind(alias, url)?;
        let Some(jar) = self.origins.get(&origin) else {
            return Ok(None);
        };
        let mut cookies = jar.matches(url);
        cookies.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
        if cookies.is_empty() {
            return Ok(None);
        }
        let value = cookies
            .iter()
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; ");
        if value.len() > MAX_BYTES {
            return Err(UNAVAILABLE);
        }
        HeaderValue::from_str(&value)
            .map(Some)
            .map_err(|_| UNAVAILABLE)
    }
    pub(crate) fn store_response(
        &mut self,
        alias: &str,
        url: &Url,
        headers: &HeaderMap,
    ) -> Result<usize, &'static str> {
        let origin = self.bind(alias, url)?;
        let headers = capture(headers)?;
        if headers.is_empty() {
            return Ok(0);
        }
        if !self.origins.contains_key(&origin) && self.origins.len() >= MAX_ORIGINS {
            return Err(UNAVAILABLE);
        }
        let mut candidate = self.origins.get(&origin).cloned().unwrap_or_default();
        let mut accepted = 0usize;
        for value in headers.get_all(SET_COOKIE) {
            if let Some(cookie) = super::super::upstream::validated_response_cookie(value, url)? {
                // Low-level insertion does not log private cookie values.
                // An expired unknown cookie is a harmless deletion, not an
                // instruction to revive an old browser/source value.
                let _ = candidate.insert(cookie, url);
                accepted += 1;
            }
        }
        let mut retained = cookie_store::CookieStore::default();
        let mut bytes = 0usize;
        for (count, cookie) in candidate.iter_unexpired().enumerate() {
            bytes = bytes.saturating_add(cookie.to_string().len());
            if count >= MAX_COOKIES || bytes > MAX_BYTES {
                return Err(UNAVAILABLE);
            }
            let _ = retained.insert(cookie.clone(), url);
        }
        if accepted > 0 {
            self.origins.insert(origin, retained);
        }
        Ok(accepted)
    }
    pub(crate) fn clear(&mut self) {
        self.origins.clear();
        self.alias = None;
        self.revoked = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn url(host: &str) -> Url {
        Url::parse(&format!("https://{host}.quickconnect.to/Serv.php")).unwrap()
    }
    fn headers(values: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append(SET_COOKIE, value.parse().unwrap());
        }
        headers
    }
    #[test]
    fn exact_origin_alias_purpose_and_deletion_are_isolated() {
        let mut store = ProviderControlCookies::default();
        let global = url("global");
        store
            .store_response(
                "test-nas",
                &global,
                &headers(&[
                    "sid=root; Domain=quickconnect.to; Path=/; Secure; HttpOnly",
                    "sid=path; Path=/Serv.php; Secure",
                    "skip=other; Path=/elsewhere",
                    "invalid=foreign; Domain=other.invalid; Path=/",
                ]),
            )
            .unwrap();
        assert_eq!(
            store.request_header("test-nas", &global).unwrap().unwrap(),
            "sid=path; sid=root"
        );
        assert!(store
            .request_header("test-nas", &url("dec"))
            .unwrap()
            .is_none());
        assert!(store.request_header("other-nas", &global).is_err());
        assert!(store.request_header("test-nas", &Url::parse("https://test-nas.fr3.quickconnect.to/webman/pingpong.cgi?action=cors&quickconnect=true").unwrap()).is_err());
        store
            .store_response(
                "test-nas",
                &global,
                &headers(&["sid=; Domain=quickconnect.to; Path=/; Max-Age=0"]),
            )
            .unwrap();
        assert_eq!(
            store.request_header("test-nas", &global).unwrap().unwrap(),
            "sid=path"
        );
        store.clear();
        assert!(store.request_header("test-nas", &global).is_err());
    }
    #[test]
    fn response_limits_are_atomic_and_origin_count_is_bounded() {
        let mut store = ProviderControlCookies::default();
        let global = url("global");
        store
            .store_response("test-nas", &global, &headers(&["sid=kept; Path=/"]))
            .unwrap();
        let mut overflow = HeaderMap::new();
        for i in 0..32 {
            overflow.append(SET_COOKIE, format!("id{i}=new; Path=/").parse().unwrap());
        }
        assert!(store
            .store_response("test-nas", &global, &overflow)
            .is_err());
        assert_eq!(
            store.request_header("test-nas", &global).unwrap().unwrap(),
            "sid=kept"
        );
        for i in 0..7 {
            store
                .store_response(
                    "test-nas",
                    &url(&format!("region{i}")),
                    &headers(&["sid=one; Path=/"]),
                )
                .unwrap();
        }
        assert!(store
            .store_response("test-nas", &url("overflow"), &headers(&["sid=one; Path=/"]))
            .is_err());
        let large = format!("id={}; Path=/", "x".repeat(4096));
        assert!(store
            .store_response("test-nas", &global, &headers(&[&large]))
            .is_err());
        assert_eq!(
            store.request_header("test-nas", &global).unwrap().unwrap(),
            "sid=kept"
        );
    }
    #[test]
    fn invalid_prefix_public_suffix_and_ineligible_authorities_are_not_cookie_grants() {
        let mut store = ProviderControlCookies::default();
        let global = url("global");
        assert_eq!(
            store
                .store_response(
                    "test-nas",
                    &global,
                    &headers(&[
                        "sid=bad; Domain=to; Path=/",
                        "__Host-id=bad; Domain=quickconnect.to; Secure; Path=/",
                    ])
                )
                .unwrap(),
            0
        );
        assert!(store.request_header("test-nas", &global).unwrap().is_none());
        for invalid in [
            "http://global.quickconnect.to/Serv.php",
            "https://global.quickconnect.to:444/Serv.php",
            "https://global.quickconnect.to/other",
            "https://global.quickconnect.to/Serv.php?private=x",
        ] {
            assert!(store
                .request_header("test-nas", &Url::parse(invalid).unwrap())
                .is_err());
        }
    }
    #[test]
    fn document_guard_rejects_stale_and_revoked_operations_before_store_mutation() {
        let network = crate::http::ProxyNetworkState::default();
        network.document_issued(1, true);
        let mut calls = 0;
        network.with_current_document(1, || calls += 1).unwrap();
        network.document_issued(2, false);
        network.activate_document(2).unwrap();
        assert!(network.with_current_document(1, || calls += 1).is_err());
        network.revoke();
        assert!(network.with_current_document(2, || calls += 1).is_err());
        assert_eq!(calls, 1);
    }
    #[test]
    fn progress_digest_ignores_order_expiry_renewal_and_empty_reads_but_tracks_real_changes() {
        let global = url("global");
        let mut first = ProviderControlCookies::default();
        let empty = first.progress_fingerprint();
        assert!(first.request_header("test-nas", &global).unwrap().is_none());
        assert_eq!(first.progress_fingerprint(), empty);
        first
            .store_response(
                "test-nas",
                &global,
                &headers(&[
                    "a=one; Path=/; Max-Age=1000",
                    "b=two; Path=/; Secure; HttpOnly",
                ]),
            )
            .unwrap();
        let mut second = ProviderControlCookies::default();
        second
            .store_response(
                "test-nas",
                &global,
                &headers(&[
                    "b=two; HttpOnly; Secure; Path=/",
                    "a=one; Max-Age=2000; Path=/",
                ]),
            )
            .unwrap();
        assert_eq!(first.progress_fingerprint(), second.progress_fingerprint());
        second
            .store_response("test-nas", &global, &headers(&["a=changed; Path=/"]))
            .unwrap();
        assert_ne!(first.progress_fingerprint(), second.progress_fingerprint());
        first
            .store_response(
                "test-nas",
                &global,
                &headers(&["a=; Path=/; Max-Age=0", "b=; Path=/; Max-Age=0"]),
            )
            .unwrap();
        assert_eq!(first.progress_fingerprint(), empty);
    }
}
