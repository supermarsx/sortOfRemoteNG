//! One explicitly configured MeshCentral origin, isolated from the dashboard.
//! Browser aliases belong to a fixed root document, never to whichever root is
//! selected later. HttpOnly cookies are retained only inside that alias's root;
//! no website cookie jar or dashboard credential state is shared.
use super::{AxumProxyState, ProxyNetworkState, ReviewedApplicationProfile};
use std::collections::BTreeMap;
use std::sync::{atomic::AtomicBool, Arc, Mutex, RwLock};

struct Alias {
    origin: String,
    _lease: crate::webview_origins::ProxyOriginLease,
    // Browser third-party cookie rules may withhold the embedded session.
    // Retain server-issued HttpOnly state and deletion tombstones, not tokens
    // in page JavaScript or weakened browser cookie attributes.
    cookies: Vec<cookie_store::Cookie<'static>>,
}

#[derive(Clone, Copy)]
pub(super) struct MeshRoot(pub u64);

pub struct TacticalMeshRoute {
    source_origin: String,
    dashboard_upstream_origin: String,
    upstream_origin: String,
    port: u16,
    client: reqwest::Client,
    aliases: Mutex<BTreeMap<u64, Alias>>,
}

impl TacticalMeshRoute {
    /// The caller supplies a strict, stateless client with only the connection's
    /// transport proxy and TLS floor. A saved dashboard pin/bypass is not valid here.
    pub fn new(
        profile: Option<ReviewedApplicationProfile>,
        source: &reqwest::Url,
        configured: Option<&str>,
        proxy_origin: &str,
        client: reqwest::Client,
    ) -> Result<Option<Self>, String> {
        let Some(configured) = configured else {
            return Ok(None);
        };
        if profile != Some(ReviewedApplicationProfile::TacticalRmm) {
            return Err("Mesh routing requires the Tactical RMM profile".into());
        }
        let upstream =
            reqwest::Url::parse(configured).map_err(|_| "Invalid configured Mesh HTTPS origin")?;
        let origin = upstream.origin().ascii_serialization();
        if upstream.scheme() != "https"
            || source.scheme() != "https"
            || !source.username().is_empty()
            || source.password().is_some()
            || upstream
                .port_or_known_default()
                .is_none_or(|port| port == 0)
            || !upstream.username().is_empty()
            || upstream.password().is_some()
            || upstream
                .host_str()
                .is_none_or(|host| host.ends_with('.') || host.contains('*'))
            || upstream.path() != "/"
            || upstream.query().is_some()
            || upstream.fragment().is_some()
            || !(configured == origin || configured == format!("{origin}/"))
            || source.origin() == upstream.origin()
        {
            return Err("Mesh routing requires one canonical separate HTTPS origin".into());
        }
        let local = reqwest::Url::parse(proxy_origin).map_err(|_| "Invalid Mesh proxy origin")?;
        let port = local
            .port()
            .filter(|port| *port != 0)
            .ok_or("Invalid Mesh proxy port")?;
        Ok(Some(Self {
            source_origin: proxy_origin.into(),
            dashboard_upstream_origin: source.origin().ascii_serialization(),
            upstream_origin: origin,
            port,
            client,
            aliases: Mutex::new(BTreeMap::new()),
        }))
    }

    pub(super) fn prune(&self, root: Option<u64>) {
        if let Ok(mut aliases) = self.aliases.lock() {
            aliases.retain(|sequence, _| root.is_some_and(|root| *sequence >= root));
        }
    }

    pub(super) fn manifest(
        &self,
        root: u64,
        network: &ProxyNetworkState,
    ) -> Option<serde_json::Value> {
        // Issued primaries may bootstrap before desktop selection. Their alias
        // remains unusable until that exact document is selected. At most the
        // active and one pending primary are retained, including slow responses.
        if !network.mesh_manifest_eligible(root) {
            return None;
        }
        network.with_document_selection(|current| {
            let mut aliases = self.aliases.lock().ok()?;
            // Recheck under the alias lock so a concurrent stop cannot mint a new
            // origin lease after revocation has drained the cache. Do not take the
            // issued-document mutex here (selection takes issued, then aliases).
            if !network.is_active() {
                return None;
            }
            if current.is_some_and(|current| root < current) {
                return None;
            }
            let newest = aliases
                .keys()
                .next_back()
                .copied()
                .unwrap_or(root)
                .max(root);
            if root < newest && Some(root) != current {
                return None;
            }
            aliases.retain(|sequence, _| Some(*sequence) == current || *sequence == newest);
            if let std::collections::btree_map::Entry::Vacant(entry) = aliases.entry(root) {
                let origin = format!(
                    "http://p{}.localhost:{}",
                    uuid::Uuid::new_v4().simple(),
                    self.port
                );
                let lease = crate::webview_origins::acquire_proxy_origin(&origin).ok()?;
                entry.insert(Alias {
                    origin,
                    _lease: lease,
                    cookies: Vec::new(),
                });
            }
            Some(serde_json::json!({
                "version": 1,
                "upstreamOrigin": self.upstream_origin,
                "proxyOrigin": aliases.get(&root)?.origin,
            }))
        })?
    }

    pub(super) fn root_for_origin(&self, origin: &str) -> Option<u64> {
        self.aliases
            .lock()
            .ok()?
            .iter()
            .find_map(|(root, alias)| (alias.origin == origin).then_some(*root))
    }

    pub(super) fn is_dashboard(&self, origin: &str) -> bool {
        origin == self.source_origin
    }

    pub(super) fn request_cookies(
        &self,
        network: &ProxyNetworkState,
        origin: &str,
        url: &reqwest::Url,
        browser: &[&str],
    ) -> Result<String, &'static str> {
        if url.origin().ascii_serialization() != self.upstream_origin {
            return Err("Mesh cookies cannot leave their configured origin.");
        }
        let root = self
            .root_for_origin(origin)
            .ok_or("Unknown Mesh cookie scope.")?;
        network.with_current_document(root, || {
            let aliases = self
                .aliases
                .lock()
                .map_err(|_| "Mesh cookie scope unavailable.")?;
            let alias = aliases.get(&root).ok_or("Mesh cookie scope ended.")?;
            let mut matching: Vec<_> = alias
                .cookies
                .iter()
                .filter(|cookie| cookie.matches(url) && !cookie.is_expired())
                .collect();
            matching.sort_by_key(|cookie| std::cmp::Reverse(cookie.path.len()));
            let mut values: Vec<_> = matching
                .iter()
                .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                .collect();
            // Preserve page-managed cookies, but browser copies may not replace
            // or resurrect the server's protected session cookies.
            for header in browser {
                for pair in header.split(';') {
                    let pair = pair.trim();
                    if let Some((name, _)) = pair.split_once('=') {
                        if !alias.cookies.iter().any(|cookie| cookie.name() == name) {
                            values.push(pair.to_owned());
                        }
                    }
                }
            }
            if values.len() > 256 || values.iter().map(String::len).sum::<usize>() > 80 * 1024 {
                return Err("Mesh request cookies exceed the supported limits.");
            }
            Ok(values.join("; "))
        })?
    }

    /// Observe original upstream headers before browser-domain projection,
    /// including intermediate redirects and WebSocket handshakes.
    pub(super) fn observe_cookies(
        &self,
        network: &ProxyNetworkState,
        origin: &str,
        response: &reqwest::Response,
    ) -> Result<(), &'static str> {
        let url = response.url();
        if url.origin().ascii_serialization() != self.upstream_origin {
            return Err("Mesh cookie issuer is outside its configured origin.");
        }
        let root = self
            .root_for_origin(origin)
            .ok_or("Unknown Mesh cookie scope.")?;
        network.with_current_document(root, || {
            let mut aliases = self
                .aliases
                .lock()
                .map_err(|_| "Mesh cookie scope unavailable.")?;
            let alias = aliases.get_mut(&root).ok_or("Mesh cookie scope ended.")?;
            let mut next = alias.cookies.clone();
            let headers = response.headers().get_all("set-cookie");
            if headers.iter().count() > 128 {
                return Err("Mesh cookie updates exceed the supported limits.");
            }
            for header in headers {
                let Some(cookie) = super::upstream::validated_response_cookie(header, url)? else {
                    continue;
                };
                let previous = next.iter().position(|old| {
                    old.name() == cookie.name()
                        && old.domain.as_cow() == cookie.domain.as_cow()
                        && *old.path == *cookie.path
                });
                if cookie.http_only() != Some(true) && previous.is_none() {
                    continue;
                }
                // Deletions may omit HttpOnly. A non-HttpOnly replacement
                // returns to browser management rather than being promoted.
                if let Some(index) = previous {
                    if cookie.http_only() != Some(true) && !cookie.is_expired() {
                        next.remove(index);
                        continue;
                    }
                    next[index] = cookie;
                } else {
                    next.push(cookie);
                }
                if next.len() > 128
                    || next
                        .iter()
                        .map(|cookie| cookie.to_string().len())
                        .sum::<usize>()
                        > 64 * 1024
                {
                    return Err("Mesh cookie store exceeds the supported limits.");
                }
            }
            alias.cookies = next;
            Ok(())
        })?
    }

    /// One cross-origin exception: a dashboard socket to its own active Mesh
    /// alias, carrying that alias's exact root proof. This grants no HTTP,
    /// frame, unrelated alias or stale-document access.
    pub(super) fn dashboard_websocket_origin<'a>(
        &'a self,
        network: &ProxyNetworkState,
        request: &axum::extract::Request,
        alias: &str,
    ) -> Option<&'a str> {
        let root = self.root_for_origin(alias)?;
        let headers = request.headers();
        if request.method() != axum::http::Method::GET
            || request.version() != axum::http::Version::HTTP_11
            || !super::websocket::is_upgrade_candidate(headers)
            || headers.get_all("host").iter().count() != 1
            || headers.get("host").and_then(|value| value.to_str().ok())
                != alias.strip_prefix("http://")
            || headers.get_all("origin").iter().count() != 1
            || headers.get("origin").and_then(|value| value.to_str().ok())
                != Some(self.source_origin.as_str())
            || request
                .uri()
                .authority()
                .is_some_and(|authority| Some(authority.as_str()) != alias.strip_prefix("http://"))
            || request
                .uri()
                .scheme_str()
                .is_some_and(|scheme| scheme != "http")
            || !network.permits_tactical_popup_parent(root)
            || super::websocket::document_sequence(request.uri()) != Some(root)
        {
            return None;
        }
        Some(&self.dashboard_upstream_origin)
    }

    pub(super) fn content_security_policy(&self, policy: String, origin: &str) -> String {
        if !self.is_dashboard(origin) {
            return policy;
        }
        let Ok(aliases) = self.aliases.lock() else {
            return policy;
        };
        let origins = aliases
            .values()
            .map(|alias| alias.origin.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let sockets = aliases
            .values()
            .map(|alias| alias.origin.replacen("http://", "ws://", 1))
            .collect::<Vec<_>>()
            .join(" ");
        policy
            .replace(
                "connect-src 'self'",
                &format!("connect-src 'self' {sockets}"),
            )
            .replace("frame-src 'self'", &format!("frame-src 'self' {origins}"))
            .replace("child-src 'self'", &format!("child-src 'self' {origins}"))
    }

    /// Called by listener dispatch BEFORE auth/credential routes and access
    /// middleware. Unknown hosts cannot select the dashboard fallback.
    pub(super) fn request_state(
        &self,
        state: &Arc<AxumProxyState>,
        request: &axum::extract::Request,
    ) -> Result<Option<(Arc<AxumProxyState>, MeshRoot)>, &'static str> {
        let headers = request.headers();
        if headers.get_all("host").iter().count() != 1
            || headers.get_all("origin").iter().count() > 1
        {
            return Err("Ambiguous Mesh authority");
        }
        let host = headers
            .get("host")
            .and_then(|value| value.to_str().ok())
            .ok_or("Invalid Mesh host")?;
        let origin = format!("http://{host}");
        if self.is_dashboard(&origin) {
            return Ok(None);
        }
        let root = self.root_for_origin(&origin).ok_or("Unknown Mesh alias")?;
        let dashboard_socket = self
            .dashboard_websocket_origin(&state.network, request, &origin)
            .is_some();
        if !state.network.permits_tactical_popup_parent(root)
            || (!dashboard_socket
                && !super::proxy_request_headers_are_authorized(headers, host, &origin))
            || (!dashboard_socket
                && headers
                    .get("origin")
                    .is_some_and(|value| value.to_str().ok() != Some(origin.as_str())))
            || request
                .uri()
                .authority()
                .is_some_and(|authority| authority.as_str() != host)
            || request
                .uri()
                .scheme_str()
                .is_some_and(|scheme| scheme != "http")
            || (request.uri().path().starts_with("/__sortofremoteng")
                && request.uri().path() != super::web_automation::DARKREADER_PATH)
        {
            return Err("Mesh request is outside its active root scope");
        }
        let mut scoped = (**state).clone();
        scoped.target_origin = self.upstream_origin.clone();
        scoped.target_url = format!("{}/", self.upstream_origin);
        scoped.proxy_origin = origin;
        scoped.proxy_authority = host.into();
        scoped.client = self.client.clone();
        scoped.username = Arc::new(RwLock::new(String::new()));
        scoped.password = Arc::new(RwLock::new(String::new()));
        scoped.upstream_auth_mode = super::UpstreamAuthMode::None;
        scoped.custom_headers.clear();
        scoped.proxy_policy.query_parameters.clear();
        scoped.proxy_policy.allow_cross_origin_redirects = false;
        scoped.proxy_policy.allow_http_downgrade_redirects = false;
        scoped.proxy_policy.synology_quick_connect_defaults = None;
        scoped.redirect_profile = None;
        scoped.attempt = None;
        scoped.tactical_rmm_api = None;
        scoped.pending_nonce = Arc::new(RwLock::new(None));
        scoped.auto_login_armed = Arc::new(AtomicBool::new(false));
        scoped.auto_login_nonce = Arc::new(RwLock::new(None));
        scoped.bitwarden_continuation = Default::default();
        scoped.auto_login_selectors = None;
        scoped.http_form_automation = None;
        scoped.yealink_session = super::yealink_login::session_slot();
        scoped.credentials_applied = None;
        Ok(Some((Arc::new(scoped), MeshRoot(root))))
    }
}

#[cfg(test)]
mod concurrency_tests {
    use super::*;
    use reqwest::ResponseBuilderExt;
    use std::sync::Barrier;
    use std::time::{Duration, Instant};

    const CHILD_ENV: &str = "SORNG_MESH_COOKIE_SELECTION_TEST_CHILD";
    const SESSION: &str = "xid=synthetic-session; xid.sig=synthetic-signature";

    fn session_response(url: &reqwest::Url) -> reqwest::Response {
        axum::http::Response::builder()
            .status(200)
            .header(
                "set-cookie",
                "xid=synthetic-session; Path=/; Secure; HttpOnly; SameSite=Lax",
            )
            .header(
                "set-cookie",
                "xid.sig=synthetic-signature; Path=/; Secure; HttpOnly; SameSite=Lax",
            )
            .url(url.clone())
            .body("")
            .unwrap()
            .into()
    }

    fn contend_manifest_cookies_and_selection() {
        // No sockets or runtime: responses are synthetic and the client is never sent.
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let source = reqwest::Url::parse("https://dashboard.example.test/").unwrap();
        let upstream = reqwest::Url::parse("https://mesh.example.test/control.ashx").unwrap();
        for round in 0..96 {
            let route = TacticalMeshRoute::new(
                Some(ReviewedApplicationProfile::TacticalRmm),
                &source,
                Some("https://mesh.example.test"),
                "http://mesh-lock-test.localhost:49152",
                client.clone(),
            )
            .unwrap();
            let network = Arc::new(
                ProxyNetworkState::default()
                    .with_tactical_mesh(route)
                    .with_reviewed_application_profile(Some(
                        ReviewedApplicationProfile::TacticalRmm,
                    )),
            );
            let route = network.tactical_mesh.as_ref().unwrap().clone();
            network.document_issued(1, false);
            // Pending bootstrap must work even while the selected document is zero.
            let alias = route.manifest(1, &network).unwrap()["proxyOrigin"]
                .as_str()
                .unwrap()
                .to_owned();
            assert!(route
                .request_cookies(&network, &alias, &upstream, &[])
                .is_err());
            assert!(network.activate_document(1).unwrap());
            route
                .observe_cookies(&network, &alias, &session_response(&upstream))
                .unwrap();
            assert_eq!(
                route
                    .request_cookies(&network, &alias, &upstream, &[])
                    .unwrap(),
                SESSION,
            );
            network.document_issued(2, false);
            let start = Arc::new(Barrier::new(4));

            let manifest_worker = {
                let network = network.clone();
                let route = route.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..32 {
                        // The old root may become stale; the pending/new root remains valid.
                        let _ = route.manifest(1, &network);
                        assert!(route.manifest(2, &network).is_some());
                        std::thread::yield_now();
                    }
                })
            };
            let cookie_worker = {
                let network = network.clone();
                let route = route.clone();
                let alias = alias.clone();
                let upstream = upstream.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..32 {
                        // Selection can invalidate either operation, but a successful read
                        // must contain the complete signed pair, never a partial update.
                        if let Ok(cookies) = route.request_cookies(&network, &alias, &upstream, &[])
                        {
                            assert_eq!(cookies, SESSION);
                        }
                        let _ =
                            route.observe_cookies(&network, &alias, &session_response(&upstream));
                        std::thread::yield_now();
                    }
                })
            };
            let selection_worker = {
                let network = network.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    start.wait();
                    for _ in 0..round % 8 {
                        std::thread::yield_now();
                    }
                    assert!(network.activate_document(2).unwrap());
                })
            };

            // Hold the actual watch read guard across the common start, giving the
            // selection writer time to queue while manifest/cookie work competes.
            // Do not re-enter network state or take the alias lock in this closure.
            network
                .with_current_document(1, || {
                    start.wait();
                    std::thread::sleep(Duration::from_millis(1));
                })
                .unwrap();
            manifest_worker.join().unwrap();
            cookie_worker.join().unwrap();
            selection_worker.join().unwrap();

            assert!(route
                .request_cookies(&network, &alias, &upstream, &[])
                .is_err());
            assert!(route
                .observe_cookies(&network, &alias, &session_response(&upstream))
                .is_err());
            let next_alias = route.manifest(2, &network).unwrap()["proxyOrigin"]
                .as_str()
                .unwrap()
                .to_owned();
            assert_ne!(next_alias, alias);
            assert_eq!(
                route
                    .request_cookies(&network, &next_alias, &upstream, &[])
                    .unwrap(),
                "",
            );
            network.revoke();
            assert!(route.aliases.lock().unwrap().is_empty());
            assert!(route.manifest(2, &network).is_none());
        }
    }

    #[test]
    fn manifest_cookie_selection_contention_is_bounded() {
        if std::env::var_os(CHILD_ENV).as_deref() == Some(std::ffi::OsStr::new("1")) {
            contend_manifest_cookies_and_selection();
            return;
        }

        // A timeout inside Tokio or scoped threads would still hang on runtime/thread
        // teardown after a mutex deadlock. Only this child owns the blocking workers;
        // the parent kills and reaps it before reporting a bounded test failure.
        let current = std::thread::current();
        let test_name = current
            .name()
            .expect("libtest supplies the current test name");
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test_name, "--nocapture", "--test-threads=1"])
            .env(CHILD_ENV, "1")
            .stdin(std::process::Stdio::null())
            .spawn()
            .expect("spawn isolated Mesh lock regression");
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    assert!(
                        status.success(),
                        "Mesh lock regression child failed: {status}"
                    );
                    break;
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                outcome => {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!(
                        "Mesh manifest/cookie/selection workers did not finish in 20s: {outcome:?}"
                    );
                }
            }
        }
    }
}
