//! Volatile QuickConnect handoff state. Only consumed native receipts transfer
//! ownership; a receipt learns no credential/TLS permission. Separately retained
//! original Synology form consent can authorize one admitted NAS login sequence.
use super::{BasicAuthProxyConfig, BrowserRedirectProfile, HttpProxyPolicy, UpstreamAuthMode};
use reqwest::{
    cookie::CookieStore,
    header::{HeaderMap, HeaderValue, COOKIE},
    Url,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const TTL: Duration = Duration::from_secs(120);
const MAX_TICKETS: usize = 128;
const MAX_HOPS: u32 = 20;
const COOKIE_NAMES: [&str; 4] = [
    "previous",
    "previous_verify_type",
    "tunnel",
    "client_ext_ip",
];
const UNAVAILABLE: &str = "The QuickConnect continuation expired or its origin, route, or access changed. Restart the original connection.";

// Deliberately no Debug/Serialize: routes may contain proxy credentials and
// both the HTTP jar and provider's advisory cache can contain private data.
struct OriginState {
    cookies: cookie_store::CookieStore,
    route_cookies: BTreeMap<&'static str, String>,
    tls_identity: (bool, Option<String>, bool),
}
struct AttemptState {
    active: Option<String>,
    generation: u64,
    ended: bool,
    hops: u32,
    origins: HashMap<String, OriginState>,
    connectors: HashMap<String, (u8, u32)>,
    http_cycle: Option<HttpRedirectCycle>,
    provider_cookies: super::quickconnect_control::ProviderControlCookies,
    deferred_login: Option<super::synology_login::DeferredSynologyLogin>,
}

/// Native-only classified receipt evidence, never a route/trust grant.
#[derive(Clone)]
pub(super) enum HttpRedirectEdge {
    RegionalExit(String, [u8; 32]),
    AliasUpgrade,
    RegionalReturn(String),
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum HttpCycleStage {
    Exited,
    Upgraded,
    Returned,
}
struct HttpRedirectCycle {
    regional_origin: String,
    cookie_state: [u8; 32],
    completed: u8,
    stage: HttpCycleStage,
}
struct Attempt {
    id: String,
    defaults: super::SynologyQuickConnectDefaults,
    upstream_proxy: Option<String>,
    min_tls: String,
    policy: HttpProxyPolicy,
    deferred_synology: bool,
    state: Mutex<AttemptState>,
}

#[derive(Clone)]
pub struct AttemptSession {
    attempt: Arc<Attempt>,
    session_id: String,
    origin: String,
    generation: u64,
    cache_seeded: Arc<AtomicBool>,
    root_document: Arc<AtomicU64>,
    referrer_document: Arc<Mutex<std::sync::Weak<super::network::ProxyNetworkState>>>,
    handoff_referrer: Arc<Mutex<Option<Option<String>>>>,
}

impl AttemptSession {
    /// Native command/fixture seam: after capture, portal HTTP state contains
    /// neither source credentials nor generic automatic-login authority.
    #[doc(hidden)]
    pub fn strip_deferred_login_config(&self, config: &mut BasicAuthProxyConfig) {
        if self.attempt.deferred_synology {
            use zeroize::Zeroize;
            config.username.zeroize();
            config.password.zeroize();
            config.upstream_auth_mode = UpstreamAuthMode::None;
            config.http_auto_login = false;
        }
    }

    pub(crate) fn uses_deferred_synology_login(&self) -> bool {
        self.attempt.deferred_synology
    }

    fn expire_login_after(&self, duration: Duration) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let weak = Arc::downgrade(&self.attempt);
        runtime.spawn(async move {
            tokio::time::sleep(duration).await;
            if let Some(attempt) = weak.upgrade() {
                if let Ok(mut state) = attempt.state.lock() {
                    if let Some(login) = state.deferred_login.as_mut() {
                        login.expire();
                    }
                }
            }
        });
    }

    // Caller holds the current native document lease after successful CORS,
    // identity and HTTP-status validation; this adds only login-purpose proof.
    pub(super) fn record_deferred_login_probe(&self, alias: &str, target: &Url) {
        if self.attempt.defaults.nas_alias().as_deref() != Some(alias)
            || !self.attempt.defaults.permits_nas_origin(target)
        {
            return;
        }
        if let Ok(mut state) = self.attempt.state.lock() {
            if self.current(&state) {
                if let Some(login) = state.deferred_login.as_mut() {
                    login.record_probe(target.origin().ascii_serialization());
                }
            }
        }
    }

    pub(super) fn bind_deferred_login_document(&self, target: &Url, sequence: u64) {
        let bound = self.attempt.state.lock().ok().is_some_and(|mut state| {
            let tls_admitted = state
                .origins
                .get(&self.origin)
                .is_some_and(|origin| origin.tls_identity.0 || origin.tls_identity.1.is_some());
            if !self.current(&state)
                || !tls_admitted
                || target.origin().ascii_serialization() != self.origin
                || !self.attempt.defaults.permits_nas_origin(target)
            {
                return false;
            }
            state
                .deferred_login
                .as_mut()
                .is_some_and(|login| login.bind(&self.session_id, sequence, target))
        });
        if bound {
            self.expire_login_after(super::synology_login::READINESS_LIFETIME);
        }
    }

    pub(crate) fn deferred_login_nonce(
        &self,
        network: &super::ProxyNetworkState,
        sequence: u64,
    ) -> Option<String> {
        network
            .with_current_document(sequence, || {
                let mut state = self.attempt.state.lock().ok()?;
                if !self.current(&state) {
                    return None;
                }
                state
                    .deferred_login
                    .as_mut()?
                    .nonce(&self.session_id, sequence)
            })
            .ok()
            .flatten()
    }

    pub(crate) fn deferred_login_document(&self) -> Option<u64> {
        let mut state = self.attempt.state.lock().ok()?;
        if !self.current(&state) {
            return None;
        }
        state.deferred_login.as_mut()?.document(&self.session_id)
    }

    pub(crate) fn dispense_deferred_login(
        &self,
        network: &super::ProxyNetworkState,
        nonce: &str,
        phase: Option<&str>,
    ) -> Result<serde_json::Value, &'static str> {
        let sequence = self.deferred_login_document().ok_or(UNAVAILABLE)?;
        let guarded = network.with_current_document(sequence, || {
            let mut state = self.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
            if !self.current(&state) {
                return Err(UNAVAILABLE);
            }
            state.deferred_login.as_mut().ok_or(UNAVAILABLE)?.dispense(
                &self.session_id,
                sequence,
                nonce,
                phase,
            )
        });
        let result = match guarded {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut state) = self.attempt.state.lock() {
                    if self.current(&state) {
                        if let Some(login) = state.deferred_login.as_mut() {
                            login.cancel_issued();
                        }
                    }
                }
                Err(UNAVAILABLE)
            }
        };
        if result.is_ok() && phase.is_none() {
            self.expire_login_after(super::synology_login::STAGE_LIFETIME);
        }
        result
    }

    pub(super) fn bind_referrer_document(&self, network: &Arc<super::network::ProxyNetworkState>) {
        if self.is_current() {
            if let Ok(mut source) = self.referrer_document.lock() {
                *source = Arc::downgrade(network);
            }
        }
    }
    /// Outer Some claims this handoff's first navigation even when source
    /// policy suppressed its origin. Never reuse the hint after dispatch.
    pub(super) fn take_handoff_referrer(&self) -> Option<Option<String>> {
        let state = self.attempt.state.lock().ok()?;
        if !self.current(&state) {
            return None;
        }
        self.handoff_referrer.lock().ok()?.take()
    }
    pub(super) fn document_landed(&self, url: &Url, sequence: u64) {
        if self.is_current() {
            let root = url.origin().ascii_serialization() == self.origin
                && url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none();
            self.root_document
                .store(if root { sequence } else { 0 }, Ordering::Release);
        }
    }
    pub(super) fn root_document_sequence(&self) -> Option<u64> {
        let sequence = self.root_document.load(Ordering::Acquire);
        (self.is_current() && sequence != 0).then_some(sequence)
    }
    pub fn is_current(&self) -> bool {
        self.attempt
            .state
            .lock()
            .is_ok_and(|state| self.current(&state))
    }
    fn current(&self, state: &AttemptState) -> bool {
        !state.ended
            && state.generation == self.generation
            && state.active.as_deref() == Some(&self.session_id)
    }
    pub fn cookie_store(&self) -> Arc<AttemptCookieStore> {
        Arc::new(AttemptCookieStore(self.clone()))
    }
    pub(super) fn provider_control_cookie_header(
        &self,
        alias: &str,
        url: &Url,
    ) -> Result<Option<HeaderValue>, &'static str> {
        let mut state = self.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
        if !self.current(&state) || self.attempt.defaults.nas_alias().as_deref() != Some(alias) {
            return Err(UNAVAILABLE);
        }
        state.provider_cookies.request_header(alias, url)
    }
    pub(super) fn store_provider_control_cookies(
        &self,
        alias: &str,
        url: &Url,
        headers: &HeaderMap,
    ) -> Result<usize, &'static str> {
        let mut state = self.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
        if !self.current(&state) || self.attempt.defaults.nas_alias().as_deref() != Some(alias) {
            return Err(UNAVAILABLE);
        }
        state.provider_cookies.store_response(alias, url, headers)
    }
    /// Opaque loop-progress evidence, not a cookie header or an authority grant.
    /// Jar maps and browser headers can enumerate unchanged cookies differently.
    /// Sort distinct names while retaining duplicate-name order and native scope;
    /// expiry renewal alone is not session progress. Never log this digest.
    pub(super) fn cookie_state_fingerprint(&self, url: &Url, browser: &[&str]) -> Option<[u8; 32]> {
        let state = self.attempt.state.lock().ok()?;
        if !self.current(&state) || url.origin().ascii_serialization() != self.origin {
            return None;
        }
        let mut bytes = 0usize;
        let mut pairs = Vec::new();
        for header in browser {
            bytes = bytes.checked_add(header.len())?;
            if bytes > 80 * 1024 {
                return None;
            }
            for pair in header.split(';').filter(|pair| !pair.trim().is_empty()) {
                let (name, value) = pair.trim().split_once('=')?;
                if name.is_empty()
                    || name.len() > 256
                    || !name.bytes().all(|byte| cookie_octet(byte) && byte != b'=')
                    || !value.bytes().all(cookie_octet)
                {
                    return None;
                }
                pairs.push((name, value));
                if pairs.len() > 256 {
                    return None;
                }
            }
        }
        // Stable sort: two same-name browser cookies may represent different
        // paths, and their order can affect which session the server chooses.
        pairs.sort_by(|left, right| left.0.cmp(right.0));
        let mut cookies = Vec::new();
        for cookie in state.origins.get(&self.origin)?.cookies.matches(url) {
            let (domain_kind, domain) = match &cookie.domain {
                cookie_store::CookieDomain::HostOnly(domain) => (0u8, domain.as_str()),
                cookie_store::CookieDomain::Suffix(domain) => (1, domain.as_str()),
                cookie_store::CookieDomain::NotPresent => (2, ""),
                cookie_store::CookieDomain::Empty => (3, ""),
            };
            let path: &str = &cookie.path;
            bytes = bytes.checked_add(
                domain.len() + path.len() + cookie.name().len() + cookie.value().len(),
            )?;
            if bytes > 80 * 1024 || cookies.len() + pairs.len() >= 256 {
                return None;
            }
            cookies.push((
                domain_kind,
                domain,
                path,
                cookie.name(),
                cookie.value(),
                cookie.secure().unwrap_or(false),
                cookie.http_only().unwrap_or(false),
            ));
        }
        cookies.sort_unstable();
        let mut digest = Sha256::new();
        let mut field = |value: &[u8]| {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value);
        };
        field(b"browser");
        field(&(pairs.len() as u64).to_be_bytes());
        for (name, value) in pairs {
            field(name.as_bytes());
            field(value.as_bytes());
        }
        field(b"native");
        field(&(cookies.len() as u64).to_be_bytes());
        for (kind, domain, path, name, value, secure, http_only) in cookies {
            field(&[kind, u8::from(secure), u8::from(http_only)]);
            field(domain.as_bytes());
            field(path.as_bytes());
            field(name.as_bytes());
            field(value.as_bytes());
        }
        field(b"provider-control");
        field(&state.provider_cookies.progress_fingerprint());
        Some(digest.finalize().into())
    }
    pub fn merged_request_cookies(&self, url: &Url, browser: &[&str]) -> Option<HeaderValue> {
        if url.origin().ascii_serialization() != self.origin || !self.is_current() {
            return None;
        }
        let jar = self.cookie_store().cookies(url);
        let mut values = Vec::new();
        let mut browser_values = Vec::new();
        let mut bytes = 0usize;
        for (index, header) in jar
            .as_ref()
            .and_then(|value| value.to_str().ok())
            .into_iter()
            .chain(browser.iter().copied())
            .enumerate()
        {
            bytes = bytes.saturating_add(header.len());
            if bytes > 80 * 1024 {
                return None;
            }
            for pair in header.split(';') {
                let (name, value) = pair.trim().split_once('=')?;
                if name.is_empty()
                    || name.len() > 256
                    || !name.bytes().all(|byte| cookie_octet(byte) && byte != b'=')
                    || !value.bytes().all(cookie_octet)
                {
                    return None;
                }
                if index > 0 || jar.is_none() {
                    browser_values.push((name, value));
                } else {
                    values.push((name, value));
                }
                if values.len() + browser_values.len() > 256 {
                    return None;
                }
            }
        }
        // Retain maintained-jar ordering and all matching paths. An explicit
        // browser name replaces its jar matches, but browser duplicates also
        // retain their original order rather than choosing an arbitrary SID.
        let browser_names: std::collections::HashSet<_> =
            browser_values.iter().map(|(name, _)| *name).collect();
        values.retain(|(name, _)| !browser_names.contains(name));
        values.extend(browser_values);
        if values.is_empty() {
            return None;
        }
        HeaderValue::from_str(
            &values
                .into_iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
        .ok()
    }
    pub fn revoke(&self) {
        if let Ok(mut state) = self.attempt.state.lock() {
            // A stale server finishing shutdown must not revoke its successor.
            if self.current(&state) {
                end(&mut state);
            }
        }
    }
    pub fn diagnostic(&self) -> Option<(String, u32)> {
        let state = self.attempt.state.lock().ok()?;
        self.current(&state)
            .then(|| (self.attempt.id.clone(), state.hops))
    }
    /// Classify only root, query-free connector handoffs for this original NAS.
    /// The caller separately proves a primary, bodyless anonymous navigation.
    pub(super) fn http_redirect_edge(
        &self,
        source: &Url,
        destination: &Url,
    ) -> Option<HttpRedirectEdge> {
        let root = |url: &Url| {
            url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none()
                && url.username().is_empty()
                && url.password().is_none()
        };
        if !self.is_current()
            || !root(source)
            || !root(destination)
            || source.origin().ascii_serialization() != self.origin
        {
            return None;
        }
        let alias = self.attempt.defaults.nas_alias()?;
        let plain = format!("http://{alias}.quickconnect.to");
        let secure = format!("https://{alias}.quickconnect.to");
        let target = destination.origin().ascii_serialization();
        if regional_origin(&self.attempt.defaults, &self.origin) && target == plain {
            Some(HttpRedirectEdge::RegionalExit(self.origin.clone(), [0; 32]))
        } else if self.origin == plain && target == secure {
            Some(HttpRedirectEdge::AliasUpgrade)
        } else if self.origin == secure && regional_origin(&self.attempt.defaults, &target) {
            Some(HttpRedirectEdge::RegionalReturn(target))
        } else {
            None
        }
    }
    pub(super) fn http_redirect_cycle_blocked(&self, edge: Option<&HttpRedirectEdge>) -> bool {
        let Ok(state) = self.attempt.state.lock() else {
            return false;
        };
        self.current(&state)
            && matches!((edge, &state.http_cycle),
                (Some(HttpRedirectEdge::RegionalExit(origin, cookies)), Some(cycle))
                if cycle.regional_origin == *origin && cycle.completed >= 2
                    && cycle.cookie_state == *cookies
                    && cycle.stage == HttpCycleStage::Returned)
    }
    /// Called only after one native receipt has been consumed and a continuation
    /// ticket created. Duplicate/stale responses never advance this pattern.
    pub(super) fn consume_http_redirect(&self, edge: Option<&HttpRedirectEdge>) {
        let Ok(mut state) = self.attempt.state.lock() else {
            return;
        };
        if !self.current(&state) {
            return;
        }
        match edge {
            Some(HttpRedirectEdge::RegionalExit(origin, cookies)) => {
                let completed = state
                    .http_cycle
                    .as_ref()
                    .filter(|cycle| {
                        cycle.regional_origin == *origin
                            && cycle.cookie_state == *cookies
                            && cycle.stage == HttpCycleStage::Returned
                    })
                    .map_or(0, |cycle| cycle.completed);
                state.http_cycle = Some(HttpRedirectCycle {
                    regional_origin: origin.clone(),
                    cookie_state: *cookies,
                    completed,
                    stage: HttpCycleStage::Exited,
                });
            }
            Some(HttpRedirectEdge::AliasUpgrade) => {
                if let Some(cycle) = state
                    .http_cycle
                    .as_mut()
                    .filter(|cycle| cycle.stage == HttpCycleStage::Exited)
                {
                    cycle.stage = HttpCycleStage::Upgraded;
                } else {
                    state.http_cycle = None;
                }
            }
            Some(HttpRedirectEdge::RegionalReturn(origin)) => {
                if let Some(cycle) = state.http_cycle.as_mut().filter(|cycle| {
                    cycle.stage == HttpCycleStage::Upgraded && cycle.regional_origin == *origin
                }) {
                    cycle.completed = cycle.completed.saturating_add(1);
                    cycle.stage = HttpCycleStage::Returned;
                } else {
                    state.http_cycle = None;
                }
            }
            None => state.http_cycle = None,
        }
    }
    /// The caller must have positively recognized the versioned connector HTML
    /// on the original alias's HTTPS regional origin. Ordinary login/URL revisits
    /// never invoke this method. Stop only the third unchanged connector restart.
    pub fn record_connector(&self, origin: &str) -> Result<u8, &'static str> {
        let mut state = self.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
        if !self.current(&state)
            || origin != self.origin
            || !regional_origin(&self.attempt.defaults, origin)
        {
            return Err(UNAVAILABLE);
        }
        let hop = state.hops;
        let visits = state
            .connectors
            .entry(origin.into())
            .or_insert((0, u32::MAX));
        if visits.1 != hop {
            visits.0 = visits.0.saturating_add(1);
            visits.1 = hop;
        }
        if visits.0 >= 3 {
            Err("QuickConnect repeatedly restarted the same regional connector. No further destination was opened.")
        } else {
            Ok(visits.0)
        }
    }
    /// A confirmed primary application landing ends the connector cycle. The
    /// caller must not classify generic portal/bootstrap HTML as a landing.
    pub fn connector_ready(&self, origin: &str) {
        if let Ok(mut state) = self.attempt.state.lock() {
            if self.current(&state) && self.origin == origin {
                state.connectors.clear();
                state.http_cycle = None;
            }
        }
    }
    /// Protected request headers only. These four host-only provider cache
    /// values remain untrusted hints, never native routing/trust authorities.
    pub fn capture_route_cookies(&self, headers: &HeaderMap) {
        let mut parsed = BTreeMap::new();
        let mut size = 0usize;
        for value in headers.get_all(COOKIE) {
            size = size.saturating_add(value.as_bytes().len());
            if size > 16 * 1024 {
                return;
            }
            let Ok(value) = value.to_str() else {
                return;
            };
            for part in value.split(';') {
                let Some((name, value)) = part.trim().split_once('=') else {
                    continue;
                };
                let Some(name) = COOKIE_NAMES
                    .iter()
                    .copied()
                    .find(|allowed| *allowed == name)
                else {
                    continue;
                };
                if value.len() > 2048
                    || !value.bytes().all(cookie_octet)
                    || parsed.insert(name, value.to_owned()).is_some()
                {
                    return;
                }
            }
        }
        if parsed.is_empty() && !self.cache_seeded.load(Ordering::Acquire) {
            return;
        }
        let Ok(mut state) = self.attempt.state.lock() else {
            return;
        };
        if !self.current(&state) {
            return;
        }
        if let Some(origin) = state.origins.get_mut(&self.origin) {
            // An absent cookie means the page deleted its previous hint.
            origin.route_cookies = parsed;
        }
    }
    pub fn route_cookie_headers(&self) -> Vec<HeaderValue> {
        let Ok(state) = self.attempt.state.lock() else {
            return Vec::new();
        };
        if !self.current(&state) {
            return Vec::new();
        }
        if self.cache_seeded.swap(true, Ordering::AcqRel) {
            return Vec::new();
        }
        state
            .origins
            .get(&self.origin)
            .into_iter()
            .flat_map(|origin| {
                origin.route_cookies.iter().filter_map(|(name, value)| {
                    HeaderValue::from_str(&format!("{name}={value}; Path=/; SameSite=Lax")).ok()
                })
            })
            .collect()
    }
}

fn cookie_octet(byte: u8) -> bool {
    matches!(byte, 0x21 | 0x23..=0x2b | 0x2d..=0x3a | 0x3c..=0x5b | 0x5d..=0x7e)
}
fn regional_origin(defaults: &super::SynologyQuickConnectDefaults, origin: &str) -> bool {
    let Some(alias) = defaults.nas_alias() else {
        return false;
    };
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    let Some(rest) = url
        .host_str()
        .and_then(|host| host.strip_prefix(&format!("{alias}.")))
    else {
        return false;
    };
    let Some(region) = rest.strip_suffix(".quickconnect.to") else {
        return false;
    };
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && origin == url.origin().ascii_serialization()
        && (3..=63).contains(&region.len())
        && region.as_bytes()[..2].iter().all(u8::is_ascii_lowercase)
        && region.as_bytes()[2..].iter().all(u8::is_ascii_digit)
}

/// Same maintained parser used by reqwest::Jar, with explicit memory and
/// exact-origin limits. Holding the attempt lock fences late old responses.
pub struct AttemptCookieStore(AttemptSession);
impl CookieStore for AttemptCookieStore {
    fn set_cookies(&self, headers: &mut dyn Iterator<Item = &HeaderValue>, url: &Url) {
        let Ok(mut state) = self.0.attempt.state.lock() else {
            return;
        };
        if !self.0.current(&state) || url.origin().ascii_serialization() != self.0.origin {
            return;
        }
        let Some(origin) = state.origins.get_mut(&self.0.origin) else {
            return;
        };
        for header in headers.take(128) {
            if header.as_bytes().len() > 4096 {
                continue;
            }
            let Ok(value) = header.to_str() else {
                continue;
            };
            let mut next = cookie_store::CookieStore::from_cookies(
                origin
                    .cookies
                    .iter_unexpired()
                    .cloned()
                    .map(Ok::<_, std::convert::Infallible>),
                false,
            )
            .unwrap_or_default();
            if next.parse(value, url).is_err() {
                continue;
            }
            let mut bytes = 0usize;
            let mut count = 0usize;
            for cookie in next.iter_unexpired() {
                count += 1;
                bytes = bytes.saturating_add(cookie.to_string().len());
            }
            if count <= 128 && bytes <= 64 * 1024 {
                origin.cookies = next;
            }
        }
    }
    fn cookies(&self, url: &Url) -> Option<HeaderValue> {
        let state = self.0.attempt.state.lock().ok()?;
        if !self.0.current(&state) || url.origin().ascii_serialization() != self.0.origin {
            return None;
        }
        let mut cookies = state.origins.get(&self.0.origin)?.cookies.matches(url);
        // RFC cookie path precedence matters when a site has multiple SIDs.
        // Preserve every match; this does not invent a domain/creation-time
        // ordering for equal paths (the maintained jar exposes no such order).
        cookies.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
        let value = cookies
            .iter()
            .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
            .collect::<Vec<_>>()
            .join("; ");
        if value.is_empty() {
            None
        } else {
            HeaderValue::from_str(&value).ok()
        }
    }
}

struct Ticket {
    source: AttemptSession,
    destination: String,
    released: bool,
    created: Instant,
    referrer_origin: Option<String>,
}
#[derive(Default)]
pub struct AttemptRegistry {
    tickets: HashMap<String, Ticket>,
}

fn end(state: &mut AttemptState) {
    state.ended = true;
    state.active = None;
    state.origins.clear();
    state.connectors.clear();
    state.http_cycle = None;
    state.provider_cookies.clear();
    state.deferred_login = None;
}
impl AttemptRegistry {
    pub fn restart(
        &mut self,
        source: &AttemptSession,
        session_id: &str,
    ) -> Result<AttemptSession, String> {
        let mut state = source.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
        if !source.current(&state) {
            return Err(UNAVAILABLE.into());
        }
        self.tickets
            .retain(|_, ticket| !Arc::ptr_eq(&ticket.source.attempt, &source.attempt));
        state.deferred_login = None;
        state.generation += 1;
        state.active = Some(session_id.into());
        Ok(AttemptSession {
            attempt: source.attempt.clone(),
            session_id: session_id.into(),
            origin: source.origin.clone(),
            generation: state.generation,
            cache_seeded: Arc::new(AtomicBool::new(false)),
            root_document: Arc::new(AtomicU64::new(0)),
            referrer_document: Arc::new(Mutex::new(std::sync::Weak::new())),
            handoff_referrer: Arc::new(Mutex::new(None)),
        })
    }
    fn prune(&mut self) {
        let expired: Vec<_> = self
            .tickets
            .iter()
            .filter(|(_, ticket)| ticket.created.elapsed() >= TTL)
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            let _ = self.cancel(&id);
        }
    }
    pub fn cancel(&mut self, id: &str) -> Option<String> {
        if let Some(ticket) = self.tickets.remove(id) {
            if let Ok(mut state) = ticket.source.attempt.state.lock() {
                if ticket.source.current(&state)
                    || (ticket.released
                        && !state.ended
                        && state.active.is_none()
                        && state.generation == ticket.source.generation + 1)
                {
                    end(&mut state);
                    return Some(ticket.source.session_id.clone());
                }
            }
        }
        None
    }
    pub fn clear(&mut self) {
        for (_, ticket) in self.tickets.drain() {
            if let Ok(mut state) = ticket.source.attempt.state.lock() {
                end(&mut state);
            }
        }
    }
    pub fn prepare_transfer(
        &mut self,
        source: &AttemptSession,
        destination: &Url,
        receipt_id: &str,
    ) -> Result<String, String> {
        self.prepare_transfer_with_referrer_suppressed(source, destination, receipt_id, false, None)
    }
    pub(super) fn prepare_transfer_with_referrer_suppressed(
        &mut self,
        source: &AttemptSession,
        destination: &Url,
        _receipt_id: &str,
        suppress_referrer: bool,
        expected_document_sequence: Option<u64>,
    ) -> Result<String, String> {
        self.prune();
        if self.tickets.len() >= MAX_TICKETS {
            return Err(UNAVAILABLE.into());
        }
        if self
            .tickets
            .values()
            .any(|ticket| Arc::ptr_eq(&ticket.source.attempt, &source.attempt))
        {
            return Err(UNAVAILABLE.into());
        }
        let network = source
            .referrer_document
            .lock()
            .ok()
            .and_then(|source| source.upgrade());
        let mut create_ticket = |referrer_origin| {
            let state = source.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
            if !source.current(&state)
                || state.hops >= MAX_HOPS
                || !source.attempt.defaults.permits(&source.origin, destination)
                || destination.query().is_some()
                || destination.fragment().is_some()
            {
                return Err(UNAVAILABLE.into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            self.tickets.insert(
                id.clone(),
                Ticket {
                    source: source.clone(),
                    destination: destination.to_string(),
                    released: false,
                    created: Instant::now(),
                    referrer_origin: if suppress_referrer {
                        None
                    } else {
                        referrer_origin
                    },
                },
            );
            Ok(id)
        };
        match network {
            Some(network) => network
                .with_selected_document_referrer_origin(
                    destination,
                    &source.origin,
                    expected_document_sequence,
                    create_ticket,
                )
                .map_err(|_| UNAVAILABLE.to_string())?,
            None if expected_document_sequence.is_some() => Err(UNAVAILABLE.into()),
            None => create_ticket(None),
        }
    }
    pub fn stop(
        &mut self,
        source: &AttemptSession,
        continuation: Option<&str>,
    ) -> Result<(), String> {
        self.prune();
        if let Some(id) = continuation {
            let ticket = self.tickets.get_mut(id).ok_or(UNAVAILABLE)?;
            let mut state = source.attempt.state.lock().map_err(|_| UNAVAILABLE)?;
            if ticket.released
                || ticket.source.session_id != source.session_id
                || !Arc::ptr_eq(&ticket.source.attempt, &source.attempt)
                || !source.current(&state)
            {
                return Err(UNAVAILABLE.into());
            }
            state.active = None;
            if let Some(login) = state.deferred_login.as_mut() {
                login.cancel_issued();
            }
            state.generation += 1;
            ticket.released = true;
        } else {
            source.revoke();
            self.tickets
                .retain(|_, ticket| !Arc::ptr_eq(&ticket.source.attempt, &source.attempt));
        }
        Ok(())
    }
    pub fn start(
        &mut self,
        config: &BasicAuthProxyConfig,
        target: &Url,
        session_id: &str,
    ) -> Result<Option<AttemptSession>, String> {
        self.prune();
        let policy = config.proxy_policy.clone().unwrap_or_default();
        if let Some(id) = config.continuation_id.as_deref() {
            let ticket = self.tickets.remove(id).ok_or(UNAVAILABLE)?;
            let mut state = ticket
                .source
                .attempt
                .state
                .lock()
                .map_err(|_| UNAVAILABLE)?;
            let attempt = &ticket.source.attempt;
            let valid = ticket.released
                && !state.ended
                && state.active.is_none()
                && state.generation == ticket.source.generation + 1
                && state.hops < MAX_HOPS
                && ticket.destination == target.as_str()
                && config.redirect_profile == Some(BrowserRedirectProfile::Synology)
                && policy.synology_quick_connect_defaults.as_ref() == Some(&attempt.defaults)
                && config.upstream_proxy_url == attempt.upstream_proxy
                && config.min_tls_version == attempt.min_tls
                && policy.https_only == attempt.policy.https_only
                && policy.page_scripts == attempt.policy.page_scripts
                && policy.same_origin_only == attempt.policy.same_origin_only
                && policy.cache_mode == attempt.policy.cache_mode
                && policy.version == attempt.policy.version
                && policy.allow_cross_origin_redirects
                    == attempt.policy.allow_cross_origin_redirects
                && policy.allow_http_downgrade_redirects
                    == attempt.policy.allow_http_downgrade_redirects
                && policy.query_parameters.is_empty()
                && config.custom_headers.is_empty()
                && config.username.is_empty()
                && config.password.is_empty()
                && !config.http_auto_login
                && matches!(
                    config.upstream_auth_mode,
                    UpstreamAuthMode::None | UpstreamAuthMode::Basic
                );
            if !valid {
                end(&mut state);
                return Err(UNAVAILABLE.into());
            }
            state.hops += 1;
            let session = attach(attempt.clone(), &mut state, config, target, session_id);
            *session.handoff_referrer.lock().map_err(|_| UNAVAILABLE)? =
                Some(ticket.referrer_origin);
            return Ok(Some(session));
        }
        let Some(defaults) = policy
            .synology_quick_connect_defaults
            .clone()
            .filter(|scope| scope.nas_alias().is_some())
        else {
            return Ok(None);
        };
        if config.redirect_profile != Some(BrowserRedirectProfile::Synology) {
            return Ok(None);
        }
        defaults.validate(target)?;
        let deferred_login =
            super::synology_login::DeferredSynologyLogin::capture(config, &defaults, target)?;
        let attempt = Arc::new(Attempt {
            id: uuid::Uuid::new_v4().to_string(),
            defaults,
            upstream_proxy: config.upstream_proxy_url.clone(),
            min_tls: config.min_tls_version.clone(),
            deferred_synology: deferred_login.is_some(),
            policy,
            state: Mutex::new(AttemptState {
                active: None,
                generation: 0,
                ended: false,
                hops: 0,
                origins: HashMap::new(),
                connectors: HashMap::new(),
                http_cycle: None,
                provider_cookies: Default::default(),
                deferred_login,
            }),
        });
        let session = {
            let mut state = attempt.state.lock().map_err(|_| UNAVAILABLE)?;
            attach(attempt.clone(), &mut state, config, target, session_id)
        };
        if session.uses_deferred_synology_login() {
            session.expire_login_after(super::synology_login::INTENT_LIFETIME);
        }
        Ok(Some(session))
    }
}
fn attach(
    attempt: Arc<Attempt>,
    state: &mut AttemptState,
    config: &BasicAuthProxyConfig,
    target: &Url,
    session_id: &str,
) -> AttemptSession {
    let origin = target.origin().ascii_serialization();
    let identity = (
        config.verify_ssl,
        config.accepted_cert_fingerprint.clone(),
        config.require_ca_verification,
    );
    // A different currently approved TLS identity starts with an empty jar.
    if state
        .origins
        .get(&origin)
        .is_none_or(|saved| saved.tls_identity != identity)
    {
        state.origins.insert(
            origin.clone(),
            OriginState {
                cookies: Default::default(),
                route_cookies: BTreeMap::new(),
                tls_identity: identity,
            },
        );
    }
    state.active = Some(session_id.into());
    AttemptSession {
        attempt,
        session_id: session_id.into(),
        origin,
        generation: state.generation,
        cache_seeded: Arc::new(AtomicBool::new(false)),
        root_document: Arc::new(AtomicU64::new(0)),
        referrer_document: Arc::new(Mutex::new(std::sync::Weak::new())),
        handoff_referrer: Arc::new(Mutex::new(None)),
    }
}

#[cfg(test)]
#[path = "http_attempt_tests.rs"]
mod tests;
