//! Revision-6 per-connection HTTP disk cache through the production patched
//! TLS factory. Runs only when the loaded engine reports `HTTP_DISK_CACHE`
//! (bit 10); every other engine records `skipped` without creating a context.
//!
//! Two successive attempts of one synthetic connection share one cache
//! directory under `<root_cache_path>/http-cache/`. The first load fetches a
//! `max-age` script and a `no-store` script; the second, fresh attempt must
//! get the cacheable script from disk (no new request) and refetch the
//! `no-store` one, i.e. Chromium's own cache rules. The engine must report the
//! directory released (state 7) after each attempt closes, and the directory
//! may hold nothing but Chromium's `net/Cache` (no cookie or other store).
use super::*;
use serde_json::{json, Value};
use sorng_browser_host::cef_http_cache::{HttpCacheReleaseSignal, HttpCacheUse, HttpDiskCacheSpec};
use sorng_browser_host::native_capabilities::NativeBrowserCapabilities;
use std::path::Path;
use tao::window::Window;

const NAME: &str = "http-cache";
const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>cache</title>
<script src="/cache-asset.js"></script><script src="/cache-nostore.js"></script>
<script>
fetch("/cache-proof", {method: "POST", body: JSON.stringify({
  asset: window.__sorngCacheAsset === 1,
  noStore: window.__sorngCacheNoStore === 1,
  origin: location.origin
})});
</script>"#;
const MAX_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Default)]
pub(super) struct Evidence {
    page_requests: usize,
    asset_requests: usize,
    no_store_requests: usize,
    proofs: Vec<Value>,
}

/// Full fixture responses for this probe only: `(content type, cache
/// control, body)`. Every other path keeps the suite's `no-store` default.
pub(super) fn response(
    state: &State,
    path: &str,
    body: &[u8],
) -> Option<(&'static str, &'static str, String)> {
    let evidence = state.http_cache.as_ref()?;
    let mut evidence = evidence.lock().unwrap();
    match path {
        "/cache-page" => {
            evidence.page_requests += 1;
            Some(("text/html; charset=utf-8", "no-store", PAGE.into()))
        }
        "/cache-asset.js" => {
            evidence.asset_requests += 1;
            Some((
                "text/javascript",
                "public, max-age=3600",
                "window.__sorngCacheAsset = 1;".into(),
            ))
        }
        "/cache-nostore.js" => {
            evidence.no_store_requests += 1;
            Some((
                "text/javascript",
                "no-store",
                "window.__sorngCacheNoStore = 1;".into(),
            ))
        }
        "/cache-proof" => {
            let proof: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
            let passed =
                proof["asset"] == true && proof["noStore"] == true && proof["origin"] == ORIGIN;
            let record = json!({"passed":passed,
                "assetRequests":evidence.asset_requests,"noStoreRequests":evidence.no_store_requests});
            evidence.proofs.push(record);
            Some(("application/json", "no-store", "{}".into()))
        }
        // Pulses, favicons etc. keep the suite's default no-store response.
        _ => None,
    }
}

struct Attempt {
    identity: BrowserIdentity,
    session: Arc<Mutex<OriginBrowserSession>>,
    state: Arc<Mutex<State>>,
    hooks: Arc<Hooks>,
    fixture: Option<fixture::Fixture>,
    context: Option<PrivateRequestContext>,
    browser: Option<CefBrowserHost<'static>>,
    cache_use: Option<HttpCacheUse>,
    release: Option<HttpCacheReleaseSignal>,
    ready: bool,
}

impl Attempt {
    fn new(
        evidence: Arc<Mutex<Evidence>>,
        certificates: Arc<fixture::Certificates>,
        asynchronous: &tokio::runtime::Runtime,
    ) -> Result<Self> {
        let mut state = State::new(NAME);
        state.http_cache = Some(evidence);
        let state = Arc::new(Mutex::new(state));
        let fixture =
            asynchronous.block_on(fixture::Fixture::start(certificates, state.clone()))?;
        let address = fixture.address;
        let observed = state.clone();
        let dialer: Arc<dyn RouteDialer> = Arc::new(move |authority: Authority| -> DialFuture {
            let observed = observed.clone();
            Box::pin(async move {
                {
                    let mut state = observed.lock().unwrap();
                    state.route_dials += 1;
                    if authority.host() != "accounts.google.com" || authority.port() != 443 {
                        state.unexpected_route = true;
                        return Err(std::io::Error::other("fixture-only route"));
                    }
                }
                Ok(Box::new(tokio::net::TcpStream::connect(address).await?) as BoxedStream)
            })
        });
        // Same database/connection for both attempts; each policy is a fresh attempt.
        let policy =
            OriginBrowserPolicy::new("http-cache-fixture", "connection", "connection", ORIGIN)?;
        let identity = policy.identity().clone();
        let session = Arc::new(Mutex::new(asynchronous.block_on(
            OriginBrowserSession::start(policy, dialer, ProxyLimits::default()),
        )?));
        let hooks = Arc::new(Hooks {
            state: state.clone(),
            identity: identity.clone(),
            current: AtomicBool::new(true),
        });
        Ok(Self {
            identity,
            session,
            state,
            hooks,
            fixture: Some(fixture),
            context: None,
            browser: None,
            cache_use: None,
            release: None,
            ready: false,
        })
    }

    fn advance(
        &mut self,
        runtime: &CefRuntime<'_>,
        bridge: &NativeTlsBridge,
        certificates: &fixture::Certificates,
        parent: &Arc<Window>,
        spec: &HttpDiskCacheSpec,
    ) -> Result<bool> {
        if self.cache_use.is_none() {
            if !runtime.network_policy_configured()? {
                return Ok(false);
            }
            let defaults = ["navigation", "script", "fetch-xhr"]
                .into_iter()
                .filter_map(|name| {
                    WebsiteRequestClass::parse(name)
                        .map(|class| (class, WebsitePermissionDecision::Allow))
                })
                .collect();
            let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
            let context = unsafe {
                PrivateRequestContext::create_with_tls_capabilities_and_cache(
                    self.session.clone(),
                    self.identity.clone(),
                    permissions,
                    bridge,
                    &NativeTlsConfig {
                        ca_mode: NativeTlsCaMode::CustomOnly,
                        trust_anchors: vec![certificates.root.clone()],
                        require_scoped_exceptions: false,
                    },
                    self.hooks.clone(),
                    NativeBrowserCapabilities::default(),
                    Some(spec.clone()),
                )?
            };
            self.cache_use = Some(context.http_cache_state());
            self.release = context.http_cache_release_signal();
            if context.http_cache_state() != HttpCacheUse::Disk || self.release.is_none() {
                self.context = Some(context);
                return Err("revision-6 engine did not use the requested disk cache".into());
            }
            self.context = Some(context);
        }
        if let Some(context) = &self.context {
            match context.status() {
                PreparationStatus::Failed(_) | PreparationStatus::Revoked => {
                    return Err("http-cache TLS context preparation failed".into())
                }
                PreparationStatus::ProxyConfigured => {
                    if !context.tls_hooks_installed() {
                        return Err("http-cache TLS factory installation unacknowledged".into());
                    }
                    self.browser = Some(unsafe {
                        CefBrowserHost::create_owned_engineering_probe(
                            parent.clone(),
                            self.context.take().unwrap(),
                            self.session.clone(),
                            self.identity.clone(),
                            ViewportBounds::new(0., 0., 800., 600.)?,
                            parent.scale_factor(),
                            self.hooks.clone(),
                            Some(self.hooks.clone()),
                        )?
                    });
                }
                _ => {}
            }
        }
        if let Some(browser) = &self.browser {
            if !self.ready && browser.features_ready(&self.identity)? {
                let mut session = self.session.lock().unwrap();
                let ready = NativeHostReadiness::Ready {
                    profile_key: session.policy().profile_key().into(),
                    proxy_endpoint: session.proxy_endpoint(),
                };
                session.report_host(&self.identity, ready)?;
                self.ready = true;
            }
        }
        decide(&self.state, certificates, &self.session, &self.identity)?;
        Ok(self.ready
            && self
                .browser
                .as_ref()
                .is_some_and(|b| matches!(b.lifecycle(), Lifecycle::Attached | Lifecycle::Hidden)))
    }
}

/// Close like the storage probe, then wait for the engine's state 7 before
/// the directory may be reused by the next attempt.
fn close(
    attempt: &mut Attempt,
    events: &mut EventLoop<()>,
    runtime: &CefRuntime<'_>,
    certificates: &fixture::Certificates,
    asynchronous: &tokio::runtime::Runtime,
) -> Result<Value> {
    {
        let mut state = attempt.state.lock().unwrap();
        state.revoked = true;
        attempt.session.lock().unwrap().revoke(&attempt.identity)?;
    }
    attempt.hooks.current.store(false, Ordering::Release);
    let mut close_sent = false;
    storage::pump(events, runtime, Duration::from_secs(6), || {
        decide(
            &attempt.state,
            certificates,
            &attempt.session,
            &attempt.identity,
        )?;
        if let Some(browser) = &attempt.browser {
            if !close_sent {
                if browser.lifecycle() != Lifecycle::Closed {
                    browser.close(&attempt.identity)?;
                }
                close_sent = true;
            }
            Ok(browser.lifecycle() == Lifecycle::Closed)
        } else {
            Ok(true)
        }
    })?;
    let closed = attempt
        .browser
        .as_ref()
        .is_some_and(|b| b.lifecycle() == Lifecycle::Closed);
    drop(attempt.browser.take());
    drop(attempt.context.take());
    let released_wait = Instant::now();
    let release = attempt.release.clone();
    let released = storage::pump(events, runtime, Duration::from_secs(15), || {
        Ok(release
            .as_ref()
            .is_none_or(HttpCacheReleaseSignal::is_released))
    })
    .is_ok()
        && release.is_some();
    asynchronous.block_on(attempt.session.lock().unwrap().stop())?;
    if let Some(fixture) = attempt.fixture.take() {
        asynchronous.block_on(fixture.stop())?;
    }
    Ok(
        json!({"closed":closed,"cacheUse":format!("{:?}", attempt.cache_use),
        "released":released,"releaseWaitMs":released_wait.elapsed().as_millis() as u64,
        "relayStopped":true}),
    )
}

/// Relative paths of every file under `directory` outside `net/Cache`.
/// Never follows links; a link anywhere is itself reported.
fn non_cache_entries(directory: &Path) -> std::io::Result<Vec<String>> {
    let mut found = vec![];
    let mut pending = vec![directory.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(&next)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path
                .strip_prefix(directory)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                found.push(format!("{relative} (link)"));
            } else if kind.is_dir() {
                if relative != "net/Cache" && !relative.starts_with("net/Cache/") {
                    pending.push(path);
                }
            } else if !relative.starts_with("net/Cache/") {
                found.push(relative);
            }
        }
    }
    found.sort();
    Ok(found)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run(
    runtime: &CefRuntime<'_>,
    bridge: &NativeTlsBridge,
    certificates: Arc<fixture::Certificates>,
    asynchronous: &tokio::runtime::Runtime,
    events: &mut EventLoop<()>,
    parent: Arc<Window>,
    output: &Path,
    run_id: &str,
) -> Result<Value> {
    if !bridge.supports_http_disk_cache() {
        return Ok(
            json!({"status":"skipped","reason":"engine-lacks-http-disk-cache",
            "patchId":bridge.patch_id()}),
        );
    }
    // The runner's root_cache_path is `<output>/profile`.
    let directory = output
        .join("profile")
        .join("http-cache")
        .join("fixture-database")
        .join("fixture-connection");
    std::fs::create_dir_all(&directory)?;
    let spec = HttpDiskCacheSpec::new(directory.clone(), MAX_BYTES)
        .map_err(|error| format!("fixture cache spec: {error}"))?;
    let evidence = Arc::new(Mutex::new(Evidence::default()));
    let mut report = json!({"schema":1,"status":"running","runId":run_id,"origin":ORIGIN,
        "factory":"production-create-with-tls-capabilities-and-cache","productionReady":false,
        "maxBytes":MAX_BYTES,"loads":[],"contexts":[],"failures":[]});
    let mut attempts: Vec<Attempt> = vec![];
    let probes = (|| -> Result {
        for load in 0..2 {
            attempts.push(Attempt::new(
                evidence.clone(),
                certificates.clone(),
                asynchronous,
            )?);
            let attempt = attempts.last_mut().unwrap();
            storage::pump(events, runtime, Duration::from_secs(12), || {
                attempt.advance(runtime, bridge, &certificates, &parent, &spec)
            })?;
            attempt
                .browser
                .as_ref()
                .unwrap()
                .navigate(&attempt.identity, &format!("{ORIGIN}/cache-page"))?;
            storage::pump(events, runtime, Duration::from_secs(12), || {
                attempt.advance(runtime, bridge, &certificates, &parent, &spec)?;
                Ok(evidence.lock().unwrap().proofs.len() > load)
            })?;
            let closed = close(attempt, events, runtime, &certificates, asynchronous)?;
            let released = closed["released"] == true;
            report["contexts"].as_array_mut().unwrap().push(closed);
            let observed = evidence.lock().unwrap();
            report["loads"]
                .as_array_mut()
                .unwrap()
                .push(observed.proofs[load].clone());
            if observed.proofs[load]["passed"] != true {
                return Err("page did not run both scripts from the fixture origin".into());
            }
            if !released {
                return Err("engine did not report the HTTP disk cache released".into());
            }
        }
        let observed = evidence.lock().unwrap();
        let entries = non_cache_entries(&directory)?;
        let cache_written = directory.join("net").join("Cache").is_dir();
        report["pageRequests"] = json!(observed.page_requests);
        report["assetRequests"] = json!(observed.asset_requests);
        report["noStoreRequests"] = json!(observed.no_store_requests);
        report["cacheDirectoryWritten"] = json!(cache_written);
        report["nonCacheEntries"] = json!(entries);
        // Browser rules: max-age reused across attempts, no-store refetched.
        if observed.asset_requests != 1 {
            return Err("cacheable script was not served from the disk cache".into());
        }
        if observed.no_store_requests != 2 || observed.page_requests != 2 {
            return Err("no-store responses were reused".into());
        }
        if !cache_written || !entries.is_empty() {
            return Err("disk cache layout is not cache-only".into());
        }
        Ok(())
    })();
    if let Err(error) = probes {
        report["failures"]
            .as_array_mut()
            .unwrap()
            .push(json!(error.to_string()));
    }
    for attempt in attempts.iter_mut() {
        if attempt.fixture.is_none() {
            continue;
        }
        match close(attempt, events, runtime, &certificates, asynchronous) {
            Ok(closed) => report["contexts"].as_array_mut().unwrap().push(closed),
            Err(error) => {
                report["status"] = "failed".into();
                report["failures"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(format!("ordered cleanup failed: {error}")));
                let _ = std::fs::write(
                    output.join("http-cache-progress.json"),
                    serde_json::to_vec_pretty(&report)?,
                );
                // No shutdown or Rust unwinding with live native browser refs.
                std::process::exit(3);
            }
        }
    }
    report["status"] = if report["failures"].as_array().unwrap().is_empty() {
        "completed"
    } else {
        "failed"
    }
    .into();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_net_cache_contents_are_allowed_in_the_connection_directory() {
        let root = std::env::temp_dir().join(format!(
            "sorng-http-cache-layout-{}-{}",
            std::process::id(),
            NEXT_LAYOUT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("net").join("Cache").join("index-dir")).unwrap();
        std::fs::write(root.join("net").join("Cache").join("index"), b"").unwrap();
        std::fs::write(
            root.join("net")
                .join("Cache")
                .join("index-dir")
                .join("the-real-index"),
            b"",
        )
        .unwrap();
        assert!(non_cache_entries(&root).unwrap().is_empty());
        std::fs::write(root.join("net").join("Cookies"), b"").unwrap();
        std::fs::write(root.join("binding.v1"), b"").unwrap();
        assert_eq!(
            non_cache_entries(&root).unwrap(),
            vec!["binding.v1".to_owned(), "net/Cookies".to_owned()]
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
    static NEXT_LAYOUT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    #[test]
    fn probe_paths_are_scoped_to_its_own_state() {
        let state = State::new("other");
        assert!(response(&state, "/cache-asset.js", b"").is_none());
        let mut state = State::new(NAME);
        let evidence = Arc::new(Mutex::new(Evidence::default()));
        state.http_cache = Some(evidence.clone());
        assert_eq!(
            response(&state, "/cache-asset.js", b"").map(|r| r.1),
            Some("public, max-age=3600")
        );
        assert_eq!(
            response(&state, "/cache-nostore.js", b"").map(|r| r.1),
            Some("no-store")
        );
        let proof = json!({"asset":true,"noStore":true,"origin":ORIGIN}).to_string();
        assert!(response(&state, "/cache-proof", proof.as_bytes()).is_some());
        assert!(response(&state, "/elsewhere", b"").is_none());
        let evidence = evidence.lock().unwrap();
        assert_eq!(evidence.proofs[0]["passed"], true);
        assert_eq!(
            (evidence.asset_requests, evidence.no_store_requests),
            (1, 1)
        );
    }
}
