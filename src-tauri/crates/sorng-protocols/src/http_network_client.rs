//! Native network lifetime and mandatory resource policy. This policy is a
//! browser resource restriction, not a replacement for native navigation and
//! WebView egress enforcement. Unknown origins are blocked, never fetched here.
use super::{HttpProxyPolicy, PageScripts};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Mutex,
    time::Duration,
};
use tokio::sync::{watch, Semaphore};

#[cfg(test)]
#[path = "http_referrer_policy_tests.rs"]
mod referrer_policy_tests;

#[derive(Clone, Copy)]
enum DocumentReferrerPolicy {
    OriginAllowed,
    SameOriginOnly,
    Suppress,
}
impl DocumentReferrerPolicy {
    fn token(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "no-referrer" => Some(Self::Suppress),
            "same-origin" => Some(Self::SameOriginOnly),
            "no-referrer-when-downgrade"
            | "origin"
            | "origin-when-cross-origin"
            | "strict-origin"
            | "strict-origin-when-cross-origin"
            | "unsafe-url" => Some(Self::OriginAllowed),
            _ => None,
        }
    }
    fn restrict(self, other: Self) -> Self {
        match (self, other) {
            (Self::Suppress, _) | (_, Self::Suppress) => Self::Suppress,
            (Self::SameOriginOnly, _) | (_, Self::SameOriginOnly) => Self::SameOriginOnly,
            _ => Self::OriginAllowed,
        }
    }
    fn from_response(headers: &axum::http::HeaderMap, html: &str) -> Self {
        let mut policy = Self::OriginAllowed;
        for value in headers.get_all("referrer-policy") {
            let Ok(value) = value.to_str() else {
                return Self::Suppress;
            };
            if value.len() > 1024 {
                return Self::Suppress;
            }
            for token in value.split(',') {
                if let Some(recognized) = Self::token(token) {
                    policy = recognized;
                }
            }
        }
        // Conservative static-meta inspection: ambiguous/encoded policy names
        // suppress reconstruction. We never infer a permissive policy from JS,
        // nor override an explicit stricter header with a later meta element.
        static ATTR: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let attr = ATTR.get_or_init(|| {
            regex::Regex::new(
                r#"(?is)([a-z][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))"#,
            )
            .unwrap()
        });
        let lower = html.to_ascii_lowercase();
        let mut cursor = 0;
        let mut templates = 0usize;
        while let Some(offset) = lower[cursor..].find('<') {
            let start = cursor + offset;
            if lower[start..].starts_with("<!--") {
                let Some(end) = lower[start + 4..].find("-->") else {
                    break;
                };
                cursor = start + 4 + end + 3;
                continue;
            }
            let Some((tag_name, closing, end)) = super::proxy_response::html_tag(&lower, start)
            else {
                cursor = start + 1;
                continue;
            };
            cursor = end;
            if tag_name == "template" {
                templates = if closing {
                    templates.saturating_sub(1)
                } else {
                    templates + 1
                };
                continue;
            }
            if closing {
                continue;
            }
            if tag_name == "plaintext" {
                break;
            }
            if matches!(
                tag_name,
                "script"
                    | "style"
                    | "title"
                    | "textarea"
                    | "xmp"
                    | "iframe"
                    | "noembed"
                    | "noframes"
                    | "noscript"
            ) {
                let prefix = format!("</{tag_name}");
                let mut search = cursor;
                loop {
                    let Some(offset) = lower[search..].find(&prefix) else {
                        cursor = lower.len();
                        break;
                    };
                    let close = search + offset;
                    if let Some((name, true, close_end)) =
                        super::proxy_response::html_tag(&lower, close)
                    {
                        if name == tag_name {
                            cursor = close_end;
                            break;
                        }
                    }
                    search = close + prefix.len();
                }
                continue;
            }
            if tag_name != "meta" || templates > 0 {
                continue;
            }
            let tag = &html[start..end];
            let mut names = Vec::new();
            let mut contents = Vec::new();
            for value in attr.captures_iter(tag) {
                let text = value
                    .get(2)
                    .or_else(|| value.get(3))
                    .or_else(|| value.get(4))
                    .unwrap()
                    .as_str();
                match value[1].to_ascii_lowercase().as_str() {
                    "name" => names.push(text),
                    "content" => contents.push(text),
                    _ => {}
                }
            }
            if names.iter().any(|name| name.contains('&')) {
                return Self::Suppress;
            }
            if names
                .iter()
                .any(|name| name.eq_ignore_ascii_case("referrer"))
            {
                if names.len() != 1 || contents.len() != 1 {
                    return Self::Suppress;
                }
                if contents[0].contains('&') {
                    return Self::Suppress;
                }
                if let Some(meta) = Self::token(contents[0]) {
                    policy = policy.restrict(meta);
                }
            }
        }
        policy
    }
    fn origin(self, source: &str, destination: &reqwest::Url) -> Option<String> {
        let source_url = reqwest::Url::parse(source).ok()?;
        if source_url.origin().ascii_serialization() != source
            || !matches!(source_url.scheme(), "http" | "https")
            || !matches!(destination.scheme(), "http" | "https")
            || source_url.scheme() == "https" && destination.scheme() != "https"
            || matches!(self, Self::Suppress)
            || matches!(self, Self::SameOriginOnly) && source_url.origin() != destination.origin()
        {
            return None;
        }
        Some(format!("{source}/"))
    }
}

pub struct ProxyNetworkState {
    active: AtomicBool,
    document: watch::Sender<u64>,
    issued: Mutex<BTreeSet<u64>>,
    document_referrers: Mutex<BTreeMap<u64, DocumentReferrerPolicy>>,
    origin_lease: Option<crate::webview_origins::ProxyOriginLease>,
    proxy_origin: Option<String>,
    pub(super) sockets: Arc<Semaphore>,
    pub(super) font_assets: Option<super::font_assets::ReviewedFontAssets>,
    pub(super) quickconnect_control:
        Option<super::quickconnect_control::ReviewedQuickConnectControl>,
}

pub struct ProxyNetworkServerGuard(Arc<ProxyNetworkState>);
impl Drop for ProxyNetworkServerGuard {
    fn drop(&mut self) {
        self.0.revoke();
    }
}

impl Default for ProxyNetworkState {
    fn default() -> Self {
        Self {
            active: AtomicBool::new(true),
            document: watch::channel(0).0,
            issued: Mutex::new(BTreeSet::new()),
            document_referrers: Mutex::new(BTreeMap::new()),
            origin_lease: None,
            proxy_origin: None,
            sockets: Arc::new(Semaphore::new(16)),
            font_assets: None,
            quickconnect_control: None,
        }
    }
}

impl ProxyNetworkState {
    /// Native response evidence only. Retain no URL, page content or headers.
    pub(super) fn record_document_referrer(
        &self,
        sequence: u64,
        headers: &axum::http::HeaderMap,
        html: &str,
    ) {
        if !self.is_active()
            || !self
                .issued
                .lock()
                .is_ok_and(|issued| issued.contains(&sequence))
        {
            return;
        }
        let policy = DocumentReferrerPolicy::from_response(headers, html);
        let active = *self.document.borrow();
        if let Ok(mut policies) = self.document_referrers.lock() {
            policies.insert(sequence, policy);
            while policies.len() > 64 {
                if let Some(oldest) = policies.keys().copied().find(|value| *value != active) {
                    policies.remove(&oldest);
                } else {
                    break;
                }
            }
        }
    }
    pub(super) fn document_referrer_origin(
        &self,
        sequence: u64,
        destination: &reqwest::Url,
        source_origin: &str,
    ) -> Option<String> {
        let current = self.document.borrow();
        if !self.is_active() || sequence == 0 || *current != sequence {
            return None;
        }
        let policy = *self.document_referrers.lock().ok()?.get(&sequence)?;
        policy.origin(source_origin, destination)
    }
    pub(super) fn with_selected_document_referrer_origin<T>(
        &self,
        destination: &reqwest::Url,
        source_origin: &str,
        expected_sequence: Option<u64>,
        operation: impl FnOnce(Option<String>) -> T,
    ) -> Result<T, &'static str> {
        // The callback may lock attempt/cookie state: retain the established
        // document -> attempt lock order and the selected-document lease.
        let current = self.document.borrow();
        if !self.is_active()
            || *current == 0
            || expected_sequence.is_some_and(|sequence| sequence != *current)
        {
            return Err("The proxy document is no longer active.");
        }
        let origin = self
            .document_referrers
            .lock()
            .ok()
            .and_then(|policies| policies.get(&*current).copied())
            .and_then(|policy| policy.origin(source_origin, destination));
        let result = operation(origin);
        drop(current);
        Ok(result)
    }
    pub(super) fn selected_document_sequence(&self) -> Option<u64> {
        let current = self.document.borrow();
        (self.is_active() && *current > 0).then_some(*current)
    }
    pub(super) fn selected_referrer_document_sequence(&self) -> Option<u64> {
        let current = self.document.borrow();
        if !self.is_active() || *current == 0 {
            return None;
        }
        self.document_referrers
            .lock()
            .ok()?
            .contains_key(&*current)
            .then_some(*current)
    }
    pub fn server_guard(self: &Arc<Self>) -> ProxyNetworkServerGuard {
        ProxyNetworkServerGuard(self.clone())
    }
    pub fn with_origin(origin: &str) -> Result<Self, String> {
        Ok(Self {
            origin_lease: Some(crate::webview_origins::acquire_proxy_origin(origin)?),
            proxy_origin: Some(origin.into()),
            ..Self::default()
        })
    }
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    pub fn with_reviewed_public_routes(
        mut self,
        proxy: Option<reqwest::Proxy>,
        min_tls: &str,
        policy: &HttpProxyPolicy,
    ) -> Self {
        // Public typography is optional: a root-store/client setup failure
        // leaves this route unavailable (503), never disables source browsing
        // and never substitutes the source's possibly pinned/unverified TLS.
        self.font_assets = super::font_assets::ReviewedFontAssets::new(proxy.clone(), min_tls).ok();
        if policy
            .synology_quick_connect_defaults
            .as_ref()
            .and_then(|defaults| defaults.nas_alias())
            .is_some()
        {
            self.quickconnect_control =
                super::quickconnect_control::ReviewedQuickConnectControl::new(proxy, min_tls).ok();
        }
        self
    }

    pub fn proxy_url(&self) -> Option<String> {
        self.is_active()
            .then(|| {
                self.proxy_origin
                    .as_ref()
                    .map(|origin| format!("{origin}/"))
            })
            .flatten()
    }

    pub fn revoke(&self) {
        self.active.store(false, Ordering::Release);
        if let Ok(mut policies) = self.document_referrers.lock() {
            policies.clear();
        }
        if let Some(lease) = &self.origin_lease {
            lease.revoke();
        }
        self.sockets.close();
        if let Some(fonts) = &self.font_assets {
            fonts.revoke();
        }
        if let Some(control) = &self.quickconnect_control {
            control.revoke();
        }
        self.document.send_modify(|_| {});
    }

    pub(super) fn document_issued(&self, sequence: u64, initial_primary: bool) {
        if let Ok(mut issued) = self.issued.lock() {
            issued.insert(sequence);
            while issued.len() > 64 {
                let active = *self.document.borrow();
                if let Some(oldest) = issued.iter().copied().find(|value| *value != active) {
                    issued.remove(&oldest);
                }
            }
        }
        // A parent navigation marker provides early activation for the first
        // load. Once selected, nested requests can never select another owner
        // merely by including a syntactically valid navigation marker.
        let current = *self.document.borrow();
        if initial_primary && current == 0 {
            let _ = self.activate_document(sequence);
        }
    }

    pub fn activate_document(&self, sequence: u64) -> Result<bool, String> {
        let issued = self
            .issued
            .lock()
            .map_err(|_| "Proxy document selection is unavailable")?;
        if !self.is_active()
            || sequence == 0
            || sequence > 9_007_199_254_740_991
            || !issued.contains(&sequence)
        {
            return Err("Proxy document selection is stale or unavailable".into());
        }
        let mut changed = false;
        let mut stale = false;
        self.document.send_if_modified(|current| {
            if sequence < *current {
                stale = true;
                return false;
            }
            if sequence == *current {
                return false;
            }
            *current = sequence;
            changed = true;
            true
        });
        if stale {
            Err("Proxy document selection is stale or unavailable".into())
        } else {
            Ok(changed)
        }
    }

    pub(super) async fn await_document(&self, sequence: u64) -> Result<(), &'static str> {
        let mut changes = self.document.subscribe();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let current = *changes.borrow();
                if !self.is_active()
                    || sequence < current
                    || !self
                        .issued
                        .lock()
                        .is_ok_and(|issued| issued.contains(&sequence))
                {
                    return Err("The proxy document is no longer eligible.");
                }
                if current == sequence {
                    return Ok(());
                }
                changes
                    .changed()
                    .await
                    .map_err(|_| "The proxy session has ended.")?;
            }
        })
        .await
        .map_err(|_| "The primary document was not approved in time.")?
    }

    pub(super) fn document_is_current(&self, sequence: u64) -> bool {
        self.is_active() && sequence > 0 && *self.document.borrow() == sequence
    }

    /// Serialize a short synchronous native-state operation against document
    /// selection. Never await while holding this guard or acquire it from an
    /// attempt/cookie-store lock: lock order is document, then attempt/store.
    pub(super) fn with_current_document<T>(
        &self,
        sequence: u64,
        operation: impl FnOnce() -> T,
    ) -> Result<T, &'static str> {
        let current = self.document.borrow();
        if !self.is_active() || sequence == 0 || *current != sequence {
            return Err("The proxy document is no longer active.");
        }
        Ok(operation())
    }

    pub(super) async fn while_document<T>(
        &self,
        sequence: u64,
        future: impl std::future::Future<Output = T>,
    ) -> Result<T, &'static str> {
        // Subscribe before checking, so revocation between the check and await
        // cannot be lost. Every navigation sends even if no receiver existed.
        let mut changes = self.document.subscribe();
        if !self.document_is_current(sequence) {
            return Err("The proxy document is no longer active.");
        }
        tokio::select! {
            biased;
            _ = changes.changed() => Err("The proxy document is no longer active."),
            output = future => {
                if self.document_is_current(sequence) { Ok(output) }
                else { Err("The proxy document is no longer active.") }
            }
        }
    }

    /// Fixed public resources carry no document credentials. Their lease lasts
    /// for this native session, including script-disabled/manual pages and CSS
    /// requests which cannot know the primary document's asynchronous identity.
    pub(super) async fn while_active<T>(
        &self,
        future: impl std::future::Future<Output = T>,
    ) -> Result<T, &'static str> {
        let mut changes = self.document.subscribe();
        if !self.is_active() {
            return Err("The proxy session has ended.");
        }
        tokio::select! {
            biased;
            _ = async {
                loop {
                    if !self.is_active() || changes.changed().await.is_err() { return; }
                }
            } => Err("The proxy session has ended."),
            output = future => {
                if self.is_active() { Ok(output) }
                else { Err("The proxy session has ended.") }
            }
        }
    }
}

pub(super) fn content_security_policy(policy: &HttpProxyPolicy, authority: &str) -> String {
    let scripts = match policy.page_scripts {
        PageScripts::Allow => "'self' 'unsafe-inline' 'unsafe-eval'",
        PageScripts::InlineOnly => "'unsafe-inline' 'unsafe-eval'",
        PageScripts::Block => "'none'",
    };
    format!(
        "default-src 'self' data: blob:; connect-src 'self' ws://{authority}; \
         script-src {scripts}; style-src 'self' 'unsafe-inline'; font-src 'self' data: blob:; \
         form-action 'self'; frame-src 'self'; child-src 'self'; \
         worker-src 'none'; object-src 'none'; base-uri 'self'"
    )
}

/// Only non-secret immutable routing identity enters page code. Foreign
/// mappings are intentionally absent until separately reviewed native grants
/// exist; the client cannot turn arbitrary URLs into native proxy requests.
pub(super) fn bootstrap(
    session_id: &str,
    sequence: u64,
    source_origin: &str,
    proxy_origin: &str,
    policy: &HttpProxyPolicy,
) -> String {
    let mut config = serde_json::json!({
        "version": 1, "sessionId": session_id, "documentSequence": sequence,
        "sourceOrigin": source_origin, "proxyOrigin": proxy_origin, "mappings": [],
        "fontAssets": super::font_assets::manifest(proxy_origin)
    });
    if let Some(capability) =
        super::quickconnect_control::manifest(policy, source_origin, proxy_origin)
    {
        config["synologyQuickConnect"] = capability;
    }
    let json = config
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    format!(
        "{}\np.networkRouting = installWebNetworkClient({},function(detail){{try{{window.parent.postMessage(Object.assign({{}},detail,{{type:'sorng_web_network_blocked',version:1,sessionId:p.sessionId,documentSequence:p.documentSequence,navigationToken:p.navigationToken,documentToken:p.documentToken,url:u.href}}),'*');}}catch(_){{}}}}).capabilities;",
        include_str!("web_network_client.js"), json
    )
}
