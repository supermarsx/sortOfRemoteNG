//! An origin-generation swap behind one protected listener. No saved settings.
use super::*;
use axum::{
    extract::{Request, State},
    Extension,
};
use std::sync::RwLock;

const UNAVAILABLE: &str = "The reviewed Synology continuation is no longer available.";

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SynologyProxyTls {
    pub verify_ssl: bool,
    pub accepted_cert_fingerprint: Option<String>,
    pub require_ca_verification: bool,
}

#[derive(Serialize)]
pub struct SynologyProxyContinuation {
    pub session_id: String,
    pub local_port: u16,
    pub proxy_url: String,
    /// Clean native-ticket-bound upstream entry, never a renderer URL.
    pub target_url: String,
    /// Navigate this exact URL in the existing iframe. The private marker is
    /// consumed locally and removed before forwarding the request upstream.
    pub navigation_url: String,
    pub navigation_token: String,
    pub deferred_login_status: Option<DeferredSynologyLoginStatus>,
}

struct Snapshot {
    state: Arc<AxumProxyState>,
    entry: Option<String>,
    generation: Option<String>,
}

/// Owned by the listener/router. Manager references are weak to avoid cycles.
pub struct ProxySessionRuntime(RwLock<Snapshot>);

impl Drop for ProxySessionRuntime {
    fn drop(&mut self) {
        if let Ok(snapshot) = self.0.read() {
            snapshot.state.network.revoke();
        }
    }
}

impl ProxySessionRuntime {
    pub fn new(state: Arc<AxumProxyState>) -> Arc<Self> {
        Arc::new(Self(RwLock::new(Snapshot {
            state,
            entry: None,
            generation: None,
        })))
    }

    pub fn router(self: &Arc<Self>) -> axum::Router {
        axum::Router::new()
            .route(
                "/__sortofremoteng_auth",
                axum::routing::post(
                    |Extension(state): Extension<Arc<AxumProxyState>>, form| async move {
                        themed_auth_post_handler(State(state), form).await
                    },
                ),
            )
            .route(
                AUTOLOGIN_PATH,
                axum::routing::get(
                    |Extension(state): Extension<Arc<AxumProxyState>>, query| async move {
                        autologin_cred_handler(State(state), query).await
                    },
                ),
            )
            .fallback(
                |Extension(state): Extension<Arc<AxumProxyState>>, req: Request| async move {
                    axum_proxy_handler(State(state), req).await
                },
            )
            .layer(axum::middleware::from_fn_with_state(self.clone(), dispatch))
    }
}

fn gone() -> axum::response::Response {
    axum::http::Response::builder()
        .status(axum::http::StatusCode::GONE)
        .header("cache-control", "no-store")
        .body(axum::body::Body::from(
            "The proxy document is no longer active.",
        ))
        .expect("static response")
}

fn navigation_url(destination: &reqwest::Url, proxy_origin: &str, token: &str) -> (String, String) {
    // Preserve the exact encoded query bytes. Fragments are client-only and
    // must not enter the entry fence (HTTP requests never contain fragments).
    let query = destination.query().map_or_else(
        || format!("__sorng_navigation_v1={token}"),
        |query| format!("{query}&__sorng_navigation_v1={token}"),
    );
    let path = format!("{}?{query}", destination.path());
    let mut navigation = format!("{proxy_origin}{path}");
    if let Some(fragment) = destination.fragment() {
        navigation.push('#');
        navigation.push_str(fragment);
    }
    (navigation, path)
}

const GENERATION_MARKER: &str = "__sorng_generation_v1";

/// A generation is a per-document capability, never a shared cookie: cookies
/// and the loopback Origin are also available to a retired document. Reject
/// duplicate/encoded marker names rather than accepting an ambiguous proof.
fn generation_query(query: Option<&str>) -> Result<Option<&str>, ()> {
    let mut generation = None;
    for pair in query.unwrap_or_default().split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if url::form_urlencoded::parse(key.as_bytes())
            .next()
            .is_some_and(|(key, _)| key == GENERATION_MARKER)
        {
            if key != GENERATION_MARKER
                || generation.is_some()
                || value.len() != 32
                || !value
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            {
                return Err(());
            }
            generation = Some(value);
        }
    }
    Ok(generation)
}

fn without_generation(path: &str) -> String {
    let Some((path, query)) = path.split_once('?') else {
        return path.into();
    };
    let kept: Vec<_> = query
        .split('&')
        .filter(|pair| pair.split('=').next() != Some(GENERATION_MARKER))
        .collect();
    if kept.is_empty() {
        path.into()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

/// An explicit stale proof cannot be rescued by another, current proof. Only
/// exact same-origin referrers may stand in for parser-issued resource URLs.
fn admits_generation(request: &Request, state: &AxumProxyState, token: &str) -> bool {
    let Ok(query) = generation_query(request.uri().query()) else {
        return false;
    };
    if query.is_some_and(|value| value != token) {
        return false;
    }
    let mut proved = query == Some(token);
    let mut referrers = request.headers().get_all("referer").iter();
    if let Some(value) = referrers.next() {
        if referrers.next().is_some() {
            return false;
        }
        let Some(url) = value
            .to_str()
            .ok()
            .and_then(|value| reqwest::Url::parse(value).ok())
        else {
            return false;
        };
        if url.origin().ascii_serialization() != state.proxy_origin
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return false;
        }
        let Ok(generation) = generation_query(url.query()) else {
            return false;
        };
        if generation.is_some_and(|value| value != token) {
            return false;
        }
        // The marked entry is a valid referrer for speculative parser loads
        // before the bootstrap replaces its URL with the generation marker.
        let (_, navigation) = proxy_response::navigation_request(&format!(
            "{}?{}",
            url.path(),
            url.query().unwrap_or_default()
        ));
        if navigation.as_deref().is_some_and(|value| value != token) {
            return false;
        }
        proved |= generation == Some(token) || navigation.as_deref() == Some(token);
    }
    proved
}

fn resource_navigation(
    request: &Request,
    proxy_origin: &str,
    token: &str,
) -> axum::response::Response {
    let path = request
        .uri()
        .path_and_query()
        .map_or("/", |value| value.as_str());
    let separator = if request.uri().query().is_some() {
        '&'
    } else {
        '?'
    };
    axum::http::Response::builder()
        .status(axum::http::StatusCode::TEMPORARY_REDIRECT)
        .header(
            "location",
            // An absolute protected origin also keeps a //path from becoming
            // a scheme-relative foreign redirect that exposes the capability.
            format!("{proxy_origin}{path}{separator}{GENERATION_MARKER}={token}"),
        )
        .header("cache-control", "no-store")
        .header("referrer-policy", "same-origin")
        .body(axum::body::Body::empty())
        .expect("local resource URL is header-safe")
}

async fn fence_response(
    response: axum::response::Response,
    token: &str,
) -> axum::response::Response {
    let (mut parts, body) = response.into_parts();
    parts.headers.insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    // Never expose the local capability in a cross-origin Referer. Native
    // upstream referrer reconstruction still observes the publisher policy.
    parts.headers.insert(
        "referrer-policy",
        axum::http::HeaderValue::from_static("same-origin"),
    );
    if !proxy_response::is_html(
        parts
            .headers
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
    ) {
        return axum::http::Response::from_parts(parts, body);
    }
    let Ok(bytes) = axum::body::to_bytes(body, proxy_response::MAX_EDITABLE_BODY_BYTES).await
    else {
        return gone();
    };
    let Ok(html) = std::str::from_utf8(&bytes) else {
        return gone();
    };
    // Runs before readiness/vendor code. Keep the capability on the actual
    // document URL across SPA history changes; the readiness bridge reports a
    // clean URL. Removing this helper can only deny requests, never admit them.
    let script = format!(
        r#"<script>(function(){{'use strict';
var key='__sorng_navigation_v1',token='{token}',NativeURL=URL,origin=location.origin;
function stamp(value){{var u=new NativeURL(value,location.href);if(u.origin===origin){{var q=u.search.slice(1).split('&').filter(function(v){{return v&&v.split('=')[0]!==key&&v.split('=')[0]!=='{GENERATION_MARKER}';}});q.push(key+'='+token);u.search=q.join('&');}}return u.href;}}
['replaceState','pushState'].forEach(function(name){{var original=history[name];history[name]=function(){{var args=Array.prototype.slice.call(arguments);if(args.length>2&&args[2]!=null)args[2]=stamp(args[2]);return original.apply(this,args);}};}});
history.replaceState(history.state,'',stamp(location.href));
}})();</script>"#
    );
    let index = proxy_response::early_script_insertion(html);
    let stamped = format!("{}{}{}", &html[..index], script, &html[index..]);
    let invalidated: Vec<_> = parts
        .headers
        .keys()
        .filter(|name| {
            proxy_response::invalidated_header(name.as_str()) && name.as_str() != "cache-control"
        })
        .cloned()
        .collect();
    for name in invalidated {
        parts.headers.remove(name);
    }
    axum::http::Response::from_parts(parts, axum::body::Body::from(stamped))
}

async fn dispatch(
    State(runtime): State<Arc<ProxySessionRuntime>>,
    mut request: Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let (state, generation) = {
        let Ok(mut snapshot) = runtime.0.write() else {
            return gone();
        };
        if let Some(entry) = &snapshot.entry {
            // Until the desktop opens the new primary document, the old page
            // cannot send relative requests to the destination using its origin.
            if request.method() != axum::http::Method::GET
                || request.uri().path_and_query().map(|value| value.as_str()) != Some(entry)
                || !proxy_request_headers_are_authorized(
                    request.headers(),
                    &snapshot.state.proxy_authority,
                    &snapshot.state.proxy_origin,
                )
            {
                return gone();
            }
            // A navigation does not transfer the source page's cached HTTP
            // Authorization. An entry with a body is not a primary navigation.
            use axum::body::HttpBody;
            if request.body().size_hint().upper() != Some(0) {
                return gone();
            }
            request.headers_mut().remove("authorization");
            snapshot.entry = None;
        } else if let Some(token) = &snapshot.generation {
            if !proxy_request_headers_are_authorized(
                request.headers(),
                &snapshot.state.proxy_authority,
                &snapshot.state.proxy_origin,
            ) || !admits_generation(&request, &snapshot.state, token)
            {
                return gone();
            }
            if generation_query(request.uri().query()) == Ok(None)
                && matches!(
                    *request.method(),
                    axum::http::Method::GET | axum::http::Method::HEAD
                )
            {
                // Give CSS/module descendants a generation-bearing referrer.
                // This local redirect performs no upstream I/O and cannot
                // authorize an unmarked delayed request from the source page.
                return resource_navigation(&request, &snapshot.state.proxy_origin, token);
            }
        }
        (snapshot.state.clone(), snapshot.generation.clone())
    };
    if generation.is_some() {
        let path = request
            .uri()
            .path_and_query()
            .map_or("/", |value| value.as_str());
        let Ok(uri) = without_generation(path).parse() else {
            return gone();
        };
        *request.uri_mut() = uri;
    }
    request.extensions_mut().insert(state.clone());
    // Cancels old in-flight work as soon as its generation's network retires;
    // late responses cannot install cookies, documents, nonces or review UI.
    state
        .network
        .while_active(async {
            let response = enforce_proxy_access(State(state.clone()), request, next).await;
            match generation {
                Some(token) => fence_response(response, &token).await,
                None => response,
            }
        })
        .await
        .unwrap_or_else(|_| gone())
}

impl ProxySessionManager {
    /// Client construction is injected by the shared native command module so
    /// admission uses exactly the existing pin/CA/proxy/TLS builder.
    pub fn continue_synology_session(
        &mut self,
        session_id: &str,
        continuation_id: &str,
        tls: SynologyProxyTls,
        build_client: impl FnOnce(
            &ProxySessionEntry,
            &reqwest::Url,
            &attempt::AttemptSession,
        ) -> Result<reqwest::Client, String>,
    ) -> Result<SynologyProxyContinuation, String> {
        let entry = self.sessions.get(session_id).ok_or(UNAVAILABLE)?;
        let runtime = entry.runtime.upgrade().ok_or(UNAVAILABLE)?;
        let mut slot = runtime.0.write().map_err(|_| UNAVAILABLE)?;
        let source = slot.state.clone();
        let attempt = source.attempt.as_ref().ok_or(UNAVAILABLE)?;
        let (destination, successor) =
            self.attempts.preview_in_session(attempt, continuation_id)?;
        if entry.redirect_profile != Some(BrowserRedirectProfile::Synology)
            || source.redirect_profile != Some(BrowserRedirectProfile::Synology)
            || !Arc::ptr_eq(&source.network, &entry.network)
            || !source.network.is_active()
            || slot.entry.is_some()
            || entry.target_origin != source.target_origin
            || !attempt.route_matches(&entry.upstream_proxy_url, &entry.min_tls_version)
            || serde_json::to_value(&entry.proxy_policy).ok()
                != serde_json::to_value(&source.proxy_policy).ok()
            || !entry
                .proxy_policy
                .synology_quick_connect_defaults
                .as_ref()
                .is_some_and(|defaults| defaults.permits(&entry.target_origin, &destination))
        {
            return Err(UNAVAILABLE.into());
        }
        entry.proxy_policy.validate(&destination)?;
        if destination.scheme() != "https"
            && (tls.require_ca_verification || tls.accepted_cert_fingerprint.is_some())
        {
            return Err("TLS identity settings require an HTTPS destination.".into());
        }
        // All fallible setup precedes retiring source activity. No target is
        // accepted from the renderer, nor is the configured upstream changed.
        let client = build_client(entry, &destination, &successor)?;
        let network = Arc::new(
            source.network.successor().with_reviewed_public_routes(
                entry
                    .upstream_proxy_url
                    .as_deref()
                    .map(reqwest::Proxy::all)
                    .transpose()
                    .map_err(|_| "The configured proxy route is invalid.")?,
                &entry.min_tls_version,
                &entry.proxy_policy,
            ),
        );
        let origin = destination.origin().ascii_serialization();
        let navigation_token = uuid::Uuid::new_v4().simple().to_string();
        let (navigation_url, path) =
            navigation_url(&destination, &source.proxy_origin, &navigation_token);
        let proxy_url = format!("{}/", source.proxy_origin);
        let mut next = (*source).clone();
        next.target_url = format!("{origin}/");
        next.target_origin = origin;
        next.client = client;
        next.network = network.clone();
        next.attempt = Some(successor.clone());
        next.username = Default::default();
        next.password = Default::default();
        next.custom_headers.clear();
        next.proxy_policy.query_parameters.clear();
        next.upstream_auth_mode = UpstreamAuthMode::None;
        next.auto_login_armed = Arc::new(AtomicBool::new(false));
        next.auto_login_nonce = Default::default();
        next.pending_nonce = Default::default();
        next.bitwarden_continuation = Default::default();
        // Historical counters/log ownership remain session-wide; a late
        // source failure must not replace the destination's current health.
        next.last_error = Default::default();

        // Network/document -> attempt is the established lock order. Nonces
        // are locked before retirement so no poison can produce a half-swap.
        let mut login_nonce = source.auto_login_nonce.write().map_err(|_| UNAVAILABLE)?;
        let mut auth_nonce = source.pending_nonce.write().map_err(|_| UNAVAILABLE)?;
        let mut grant = source
            .bitwarden_continuation
            .lock()
            .map_err(|_| UNAVAILABLE)?;
        source.network.retire_for_continuation();
        *login_nonce = None;
        *auth_nonce = None;
        *grant = None;
        source.auto_login_armed.store(false, Ordering::SeqCst);
        if let Err(error) = self.attempts.commit_in_session(
            attempt,
            continuation_id,
            &successor,
            (
                tls.verify_ssl,
                tls.accepted_cert_fingerprint.clone(),
                tls.require_ca_verification,
            ),
        ) {
            // A concurrent revocation/expiry at the final boundary is terminal,
            // never a partially usable retarget. The successor is unpublished.
            attempt.revoke();
            network.revoke();
            if let Some(mut entry) = self.sessions.remove(session_id) {
                if let Some(tx) = entry.shutdown_tx.take() {
                    let _ = tx.send(());
                }
            }
            self.discard_redirect_review(session_id);
            return Err(error);
        }
        next.document_sequence = Arc::new(AtomicU64::new(
            source.document_sequence.fetch_add(1, Ordering::SeqCst) + 1,
        ));
        let entry = self
            .sessions
            .get_mut(session_id)
            .expect("manager held throughout swap");
        entry.target_url = next.target_url.clone();
        entry.target_origin = next.target_origin.clone();
        entry.network = network;
        entry.last_error = next.last_error.clone();
        entry.attempt = Some(successor.clone());
        entry.username.clear();
        entry.password.clear();
        entry.custom_headers.clear();
        entry.proxy_policy = next.proxy_policy.clone();
        entry.upstream_auth_mode = next.upstream_auth_mode;
        entry.verify_ssl = tls.verify_ssl;
        entry.accepted_cert_fingerprint = tls.accepted_cert_fingerprint;
        entry.require_ca_verification = tls.require_ca_verification;
        let result = SynologyProxyContinuation {
            session_id: session_id.into(),
            local_port: entry.local_port,
            proxy_url,
            target_url: destination.into(),
            navigation_url,
            navigation_token: navigation_token.clone(),
            deferred_login_status: successor.deferred_login_status(),
        };
        *slot = Snapshot {
            state: Arc::new(next),
            entry: Some(path),
            generation: Some(navigation_token),
        };
        self.discard_redirect_review(session_id);
        Ok(result)
    }
}

#[cfg(test)]
#[path = "http_synology_continuation_tests.rs"]
mod tests;
