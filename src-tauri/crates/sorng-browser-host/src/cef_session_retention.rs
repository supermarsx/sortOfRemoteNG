//! Native sign-in cookies only. No profile, DOM storage, JS, IPC, or global jar.
//! The application supplies an authenticated owner fence and keeps durable
//! snapshots in its native-private encrypted database section, outside the
//! renderer's ordinary data projection. None of the secret-bearing types are Debug.

use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

pub const MAX_COOKIES: usize = 256;
pub const MAX_COOKIE_BYTES: usize = 256 * 1024;
pub const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetentionMode {
    #[default]
    Ephemeral,
    Memory,
    #[serde(alias = "encrypted-local")]
    EncryptedDatabase,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetentionPolicy {
    pub version: u8,
    pub mode: RetentionMode,
    pub idle_timeout_minutes: u32,
    pub max_age_hours: u32,
    pub clear_on_database_lock: bool,
}
impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            version: 1,
            mode: RetentionMode::Ephemeral,
            idle_timeout_minutes: 30,
            max_age_hours: 24,
            clear_on_database_lock: false,
        }
    }
}
impl RetentionPolicy {
    pub fn validate(self) -> Result<Self, RetentionError> {
        if self.version != 1
            || self.idle_timeout_minutes > 10080
            || !(1..=8760).contains(&self.max_age_hours)
        {
            return Err(RetentionError::Invalid);
        }
        Ok(self)
    }
    pub fn enabled(self) -> bool {
        self.mode != RetentionMode::Ephemeral && self.idle_timeout_minutes != 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetentionError {
    Invalid,
    OwnerUnavailable,
    Limit,
    NativeFailure,
    Expired,
    Pending,
}

/// Implementations must hold their owner/attempt revocation fence throughout
/// `action`. The callback must run once or not at all, synchronously, without
/// allowing a renderer-selected identity to replace the captured native owner.
pub trait CookieOwner: Send + Sync {
    fn identity(&self) -> &sorng_protocols::origin_browser::BrowserIdentity;
    fn with_current(&self, action: &mut dyn FnMut()) -> bool;
}

/// Native storage codec only; never use this type in an IPC argument or result.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignInCookie {
    pub origin: String,
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub creation: i64,
    pub expires: Option<i64>,
    pub same_site: i32,
    pub priority: i32,
}
impl Drop for SignInCookie {
    fn drop(&mut self) {
        self.value.zeroize();
        self.name.zeroize();
        self.origin.zeroize();
        self.domain.zeroize();
        self.path.zeroize();
    }
}
impl SignInCookie {
    pub fn byte_len(&self) -> usize {
        self.origin.len()
            + self.name.len()
            + self.value.len()
            + self.domain.len()
            + self.path.len()
            + 128
    }
    pub fn validate(&self, origins: &[String], now_cef: i64) -> Result<(), RetentionError> {
        let url = url::Url::parse(&self.origin).map_err(|_| RetentionError::Invalid)?;
        let host = url.host_str().ok_or(RetentionError::Invalid)?;
        let domain = self.domain.strip_prefix('.').unwrap_or(&self.domain);
        let domain_matches = host == domain
            || (self.domain.starts_with('.')
                && host
                    .strip_suffix(domain)
                    .is_some_and(|prefix| prefix.ends_with('.')));
        if !origins.contains(&self.origin)
            || url.origin().ascii_serialization() != self.origin
            || !matches!(url.scheme(), "https" | "http")
            || !domain_matches
            || domain.is_empty()
            || (self.secure && url.scheme() != "https")
            || !self.path.starts_with('/')
            || self.path.len() > 4096
            || self.name.len() > 4096
            || self.value.len() > 16384
            || !(0..=3).contains(&self.same_site)
            || !(0..=2).contains(&self.priority)
            || self.byte_len() > MAX_COOKIE_BYTES
            || [&self.name, &self.value, &self.domain, &self.path]
                .iter()
                .any(|s| s.chars().any(|c| c == '\0' || c == '\r' || c == '\n'))
        {
            return Err(RetentionError::Invalid);
        }
        if self.expires.is_some_and(|time| time <= now_cef) {
            return Err(RetentionError::Expired);
        }
        Ok(())
    }
}

/// CEF base::Time is microseconds since 1601, not Unix time.
pub fn cef_time(unix_seconds: u64) -> Result<i64, RetentionError> {
    unix_seconds
        .checked_add(11_644_473_600)
        .and_then(|v| v.checked_mul(1_000_000))
        .and_then(|v| i64::try_from(v).ok())
        .ok_or(RetentionError::Invalid)
}

pub fn validate_cookies(
    cookies: &[SignInCookie],
    origins: &[String],
    now: u64,
) -> Result<(), RetentionError> {
    if cookies.len() > MAX_COOKIES
        || cookies.iter().map(SignInCookie::byte_len).sum::<usize>() > MAX_COOKIE_BYTES
    {
        return Err(RetentionError::Limit);
    }
    let now = cef_time(now)?;
    for cookie in cookies {
        cookie.validate(origins, now)?;
    }
    Ok(())
}

#[cfg(feature = "cef-host")]
pub(crate) mod native {
    use super::*;
    use cef::*;
    use std::collections::BTreeSet;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    struct CaptureState {
        cookies: Vec<SignInCookie>,
        bytes: usize,
        failed: bool,
        pending: usize,
        queries: BTreeSet<(String, String)>,
    }
    pub struct CookieCapture {
        state: Arc<Mutex<CaptureState>>,
        owner: Arc<dyn CookieOwner>,
        deadline: Instant,
        manager: CookieManager,
        origins: Arc<Vec<String>>,
        queried: bool,
        taken: bool,
    }
    impl CookieCapture {
        /// Poll on the native host path; cookie values never cross renderer IPC.
        pub fn take(&mut self) -> Result<Vec<SignInCookie>, RetentionError> {
            if currently_on(ThreadId::UI) == 0 || self.taken {
                return Err(RetentionError::Invalid);
            }
            let mut result = Err(RetentionError::OwnerUnavailable);
            let owner = self.owner.clone();
            if !owner.with_current(&mut || {
                result = (|| {
                    let mut state = self
                        .state
                        .lock()
                        .map_err(|_| RetentionError::NativeFailure)?;
                    if state.failed || Instant::now() >= self.deadline {
                        state.cookies.clear();
                        return Err(RetentionError::NativeFailure);
                    }
                    if state.pending != 0 {
                        return Err(RetentionError::Pending);
                    }
                    if !self.queried {
                        self.queried = true;
                        let queries = std::mem::take(&mut state.queries);
                        state.pending = queries.len();
                        state.bytes = 0;
                        drop(state);
                        // VisitUrlCookies uses an EMPTY CookiePartitionKeyCollection
                        // in pinned CEF. Only unpartitioned cookies are exported;
                        // SetCookie cannot preserve a partition key. All-cookie
                        // discovery contributes paths, never retained values.
                        for (origin, path) in queries {
                            let mut url =
                                url::Url::parse(&origin).map_err(|_| RetentionError::Invalid)?;
                            url.set_path(&path);
                            let mut visitor = CaptureVisitor::new(
                                self.state.clone(),
                                self.owner.clone(),
                                self.origins.clone(),
                                Arc::new(VisitLifetime(self.state.clone())),
                                false,
                                origin,
                            );
                            if self.manager.visit_url_cookies(
                                Some(&CefString::from(url.as_str())),
                                1,
                                Some(&mut visitor),
                            ) == 0
                            {
                                self.state
                                    .lock()
                                    .map_err(|_| RetentionError::NativeFailure)?
                                    .failed = true;
                                return Err(RetentionError::NativeFailure);
                            }
                        }
                        return Err(RetentionError::Pending);
                    }
                    self.taken = true;
                    Ok(std::mem::take(&mut state.cookies))
                })();
            }) {
                return Err(RetentionError::OwnerUnavailable);
            }
            result
        }
    }

    // CEF does not invoke Visit for an empty jar. Final visitor release, rather
    // than the last Visit callback alone, completes empty snapshots too.
    struct VisitLifetime(Arc<Mutex<CaptureState>>);
    impl Drop for VisitLifetime {
        fn drop(&mut self) {
            if let Ok(mut state) = self.0.lock() {
                state.pending = state.pending.saturating_sub(1);
            }
        }
    }
    wrap_cookie_visitor! {
        struct CaptureVisitor {
            state: Arc<Mutex<CaptureState>>, owner: Arc<dyn CookieOwner>,
            origins: Arc<Vec<String>>, lifetime: Arc<VisitLifetime>,
            discovery: bool, origin: String,
        }
        impl CookieVisitor {
            fn visit(&self, cookie: Option<&Cookie>, _count: i32, _total: i32,
                _delete_cookie: Option<&mut i32>) -> i32 {
                let mut keep_going = false;
                self.owner.with_current(&mut || {
                    let Ok(mut state) = self.state.lock() else { return; };
                    if state.failed { return; }
                    let Some(cookie) = cookie else { state.failed = true; return; };
                    // Reject before cloning unbounded native strings.
                    if cookie.name.as_slice().map_or(0, |v| v.len()) > 4096
                        || cookie.value.as_slice().map_or(0, |v| v.len()) > 16384
                        || cookie.domain.as_slice().map_or(0, |v| v.len()) > 4096
                        || cookie.path.as_slice().map_or(0, |v| v.len()) > 4096 {
                        state.failed = true; return;
                    }
                    let mut saved = SignInCookie {
                        origin: self.origin.clone(), name: cookie.name.to_string(),
                        value: if self.discovery { String::new() } else { cookie.value.to_string() },
                        domain: cookie.domain.to_string(), path: cookie.path.to_string(),
                        secure: cookie.secure != 0, http_only: cookie.httponly != 0,
                        creation: cookie.creation.val,
                        expires: (cookie.has_expires != 0).then_some(cookie.expires.val),
                        same_site: cookie.same_site.get_raw(),
                        priority: cookie.priority.get_raw(),
                    };
                    // CEF exposes domain/path, not the historical setter origin.
                    // Bind to one exact currently approved matching origin.
                    let stamp = cef_time(now()).unwrap_or(i64::MAX);
                    if self.discovery {
                        let origin = self.origins.iter().find(|origin| {
                            saved.origin = (*origin).clone();
                            saved.validate(&self.origins, stamp).is_ok()
                        });
                        if let Some(origin) = origin {
                            let query = (origin.clone(), saved.path.clone());
                            if !state.queries.contains(&query) {
                                let bytes = query.0.len() + query.1.len();
                                if state.queries.len() >= MAX_COOKIES || state.bytes + bytes > MAX_COOKIE_BYTES {
                                    state.failed = true; return;
                                }
                                state.bytes += bytes;
                                state.queries.insert(query);
                            }
                        }
                        keep_going = true; return;
                    }
                    if saved.validate(&self.origins, stamp).is_err() { keep_going = true; return; }
                    if state.cookies.iter().any(|existing| existing.name == saved.name
                        && existing.domain == saved.domain && existing.path == saved.path) {
                        keep_going = true; return;
                    }
                    if state.cookies.len() >= MAX_COOKIES || state.bytes + saved.byte_len() > MAX_COOKIE_BYTES {
                        state.cookies.clear(); state.failed = true; return;
                    }
                    state.bytes += saved.byte_len();
                    state.cookies.push(saved);
                    keep_going = true;
                });
                i32::from(keep_going)
            }
        }
    }

    pub(crate) fn capture(
        context: &RequestContext,
        owner: Arc<dyn CookieOwner>,
        origins: Vec<String>,
    ) -> Result<CookieCapture, RetentionError> {
        if currently_on(ThreadId::UI) == 0
            || context.is_global() != 0
            || !CefString::from(&context.cache_path())
                .to_string()
                .is_empty()
            || origins.is_empty()
            || origins.len() > 128
        {
            return Err(RetentionError::Invalid);
        }
        let manager = context
            .cookie_manager(None)
            .ok_or(RetentionError::NativeFailure)?;
        let state = Arc::new(Mutex::new(CaptureState {
            cookies: Vec::new(),
            bytes: 0,
            failed: false,
            pending: 1,
            queries: BTreeSet::new(),
        }));
        let origins = Arc::new(origins);
        let mut visitor = CaptureVisitor::new(
            state.clone(),
            owner.clone(),
            origins.clone(),
            Arc::new(VisitLifetime(state.clone())),
            true,
            String::new(),
        );
        let mut accepted = false;
        if !owner.with_current(&mut || {
            accepted = manager.visit_all_cookies(Some(&mut visitor)) != 0;
        }) || !accepted
        {
            return Err(RetentionError::NativeFailure);
        }
        Ok(CookieCapture {
            state,
            owner,
            deadline: Instant::now() + Duration::from_secs(10),
            manager,
            origins,
            queried: false,
            taken: false,
        })
    }

    struct ImportState {
        pending: usize,
        failed: bool,
    }
    pub(crate) struct CookieImport {
        state: Arc<Mutex<ImportState>>,
        owner: Arc<dyn CookieOwner>,
        deadline: Instant,
    }
    impl CookieImport {
        pub(crate) fn status(&self) -> Result<(), RetentionError> {
            let mut result = Err(RetentionError::OwnerUnavailable);
            if !self.owner.with_current(&mut || {
                result = self
                    .state
                    .lock()
                    .map_err(|_| RetentionError::NativeFailure)
                    .and_then(|s| {
                        if s.failed || (s.pending != 0 && Instant::now() >= self.deadline) {
                            Err(RetentionError::NativeFailure)
                        } else if s.pending != 0 {
                            Err(RetentionError::Pending)
                        } else {
                            Ok(())
                        }
                    });
            }) {
                return Err(RetentionError::OwnerUnavailable);
            }
            result
        }
    }
    wrap_set_cookie_callback! {
        struct ImportCallback { state: Arc<Mutex<ImportState>>, owner: Arc<dyn CookieOwner> }
        impl SetCookieCallback {
            fn on_complete(&self, success: i32) {
                let current = self.owner.with_current(&mut || {
                    if let Ok(mut state) = self.state.lock() {
                        state.failed |= success == 0;
                        state.pending = state.pending.saturating_sub(1);
                    }
                });
                if !current { if let Ok(mut state) = self.state.lock() { state.failed = true; } }
            }
        }
    }
    pub(crate) fn import(
        context: &RequestContext,
        owner: Arc<dyn CookieOwner>,
        origins: &[String],
        mut cookies: Vec<SignInCookie>,
    ) -> Result<CookieImport, RetentionError> {
        let stamp = cef_time(now())?;
        cookies.retain(|cookie| cookie.expires.is_none_or(|expires| expires > stamp));
        validate_cookies(&cookies, origins, now())?;
        if currently_on(ThreadId::UI) == 0
            || context.is_global() != 0
            || !CefString::from(&context.cache_path())
                .to_string()
                .is_empty()
        {
            return Err(RetentionError::Invalid);
        }
        let manager = context
            .cookie_manager(None)
            .ok_or(RetentionError::NativeFailure)?;
        let state = Arc::new(Mutex::new(ImportState {
            pending: cookies.len(),
            failed: false,
        }));
        for saved in cookies {
            let cookie = Cookie {
                name: CefString::from(saved.name.as_str()),
                value: CefString::from(saved.value.as_str()),
                domain: CefString::from(saved.domain.as_str()),
                path: CefString::from(saved.path.as_str()),
                secure: i32::from(saved.secure),
                httponly: i32::from(saved.http_only),
                creation: Basetime {
                    val: saved.creation,
                },
                last_access: Basetime {
                    val: cef_time(now())?,
                },
                has_expires: i32::from(saved.expires.is_some()),
                expires: Basetime {
                    val: saved.expires.unwrap_or(0),
                },
                same_site: match saved.same_site {
                    0 => CookieSameSite::UNSPECIFIED,
                    1 => CookieSameSite::NO_RESTRICTION,
                    2 => CookieSameSite::LAX_MODE,
                    _ => CookieSameSite::STRICT_MODE,
                },
                priority: match saved.priority {
                    0 => CookiePriority::LOW,
                    1 => CookiePriority::MEDIUM,
                    _ => CookiePriority::HIGH,
                },
                ..Cookie::default()
            };
            let mut callback = ImportCallback::new(state.clone(), owner.clone());
            let mut accepted = false;
            if !owner.with_current(&mut || {
                accepted = manager.set_cookie(
                    Some(&CefString::from(saved.origin.as_str())),
                    Some(&cookie),
                    Some(&mut callback),
                ) != 0;
            }) || !accepted
            {
                if let Ok(mut state) = state.lock() {
                    state.failed = true;
                }
                return Err(RetentionError::NativeFailure);
            }
        }
        Ok(CookieImport {
            state,
            owner,
            deadline: Instant::now() + Duration::from_secs(10),
        })
    }
}

#[cfg(feature = "cef-host")]
pub use native::CookieCapture;

#[cfg(test)]
mod tests {
    use super::*;
    fn cookie() -> SignInCookie {
        SignInCookie {
            origin: "https://same.example".into(),
            name: "sid".into(),
            value: "fixture".into(),
            domain: "same.example".into(),
            path: "/".into(),
            secure: true,
            http_only: true,
            creation: 0,
            expires: None,
            same_site: 0,
            priority: 1,
        }
    }
    #[test]
    fn default_is_ephemeral_and_timeout_zero_disables_retention() {
        assert!(!RetentionPolicy::default().enabled());
        assert!(!RetentionPolicy {
            mode: RetentionMode::EncryptedDatabase,
            idle_timeout_minutes: 0,
            ..Default::default()
        }
        .enabled());
    }
    #[test]
    fn legacy_mode_spelling_serializes_only_as_database_retention() {
        let legacy: RetentionMode = serde_json::from_str("\"encrypted-local\"").unwrap();
        assert_eq!(legacy, RetentionMode::EncryptedDatabase);
        assert_eq!(
            serde_json::to_string(&legacy).unwrap(),
            "\"encrypted-database\""
        );
        assert_eq!(
            serde_json::from_str::<RetentionMode>("\"encrypted-database\"").unwrap(),
            legacy
        );
    }
    #[test]
    fn exact_approved_origin_required_even_for_matching_domain_cookie() {
        let mut cookie = cookie();
        let origins = vec![cookie.origin.clone()];
        assert!(cookie.validate(&origins, 0).is_ok());
        cookie.origin = "https://same.example:8443".into();
        assert_eq!(cookie.validate(&origins, 0), Err(RetentionError::Invalid));
        cookie.origin = origins[0].clone();
        cookie.domain = "example".into();
        assert_eq!(cookie.validate(&origins, 0), Err(RetentionError::Invalid));
        cookie.domain = ".example".into();
        assert!(cookie.validate(&origins, 0).is_ok());
    }
    #[test]
    fn expired_and_oversized_snapshots_are_rejected() {
        let mut cookie = cookie();
        let origins = vec![cookie.origin.clone()];
        cookie.expires = Some(cef_time(100).unwrap());
        assert_eq!(
            validate_cookies(&[cookie], &origins, 100),
            Err(RetentionError::Expired)
        );
        let cookies: Vec<_> = (0..257).map(|_| self::cookie()).collect();
        assert_eq!(
            validate_cookies(&cookies, &origins, 0),
            Err(RetentionError::Limit)
        );
    }
}
