//! Native network lifetime and mandatory resource policy. This policy is a
//! browser resource restriction, not a replacement for native navigation and
//! WebView egress enforcement. Unknown origins are blocked, never fetched here.
use super::{HttpProxyPolicy, PageScripts};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::{collections::BTreeSet, sync::Mutex, time::Duration};
use tokio::sync::{watch, Semaphore};

pub struct ProxyNetworkState {
    active: AtomicBool,
    document: watch::Sender<u64>,
    issued: Mutex<BTreeSet<u64>>,
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
            origin_lease: None,
            proxy_origin: None,
            sockets: Arc::new(Semaphore::new(16)),
            font_assets: None,
            quickconnect_control: None,
        }
    }
}

impl ProxyNetworkState {
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
        "{}\ninstallWebNetworkClient({},function(detail){{try{{window.parent.postMessage(Object.assign({{}},detail,{{type:'sorng_web_network_blocked',version:1,sessionId:p.sessionId,documentSequence:p.documentSequence,navigationToken:p.navigationToken,documentToken:p.documentToken,url:u.href}}),'*');}}catch(_){{}}}});",
        include_str!("web_network_client.js"), json
    )
}
