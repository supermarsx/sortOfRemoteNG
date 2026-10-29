//! The exchange pipeline shared by intercepted TLS tunnels and plain HTTP:
//! request hooks -> cache lookup -> upstream pool (trust-evaluated) -> cache
//! -> response hooks on what is served.
//!
//! Bodies stream in both directions; nothing here buffers a whole body.
//! Failures become synthetic, static, script-free and form-free responses
//! with `Cache-Control: no-store`. Nothing here logs hosts, URLs, headers or
//! certificates.

use super::cache::{CacheLookup, ProxyCache};
use super::hooks::{ExchangeCtx, ExchangeHook, HookVerdict, RequestHeadView, ResponseHeadView};
use super::pool::UpstreamPool;
use super::upstream::UpstreamFailure;
use super::{CacheUse, InterceptAuthority, ProxyBody};
use crate::private_forward_proxy::Authority;
use crate::themed_errors::{render_error_page, ProxyErrorKind};
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::{Bytes, Incoming};
use hyper::http::{
    header, request, HeaderMap, HeaderName, HeaderValue, Method, Request, Response, StatusCode,
    Uri, Version,
};
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Deadline for an upstream response head (includes a trust review prompt).
pub(crate) const RESPONSE_HEAD_TIMEOUT: Duration = Duration::from_secs(300);

/// `X-Sorng-Upstream` values of synthetic upstream failures.
pub(crate) const UPSTREAM_TAG: &str = "x-sorng-upstream";

/// Fixed counters only (K6 style): never hosts or URLs.
#[derive(Default)]
pub(crate) struct ExchangeCounters {
    pub hsts_marks: AtomicU64,
    pub hook_failures: AtomicU64,
    pub synthetic_failures: AtomicU64,
}

/// One per intercepting attempt.
pub(crate) struct Exchange {
    pub(crate) authority: Arc<InterceptAuthority>,
    pub(crate) pool: Arc<UpstreamPool>,
    cache: Arc<ProxyCache>,
    cache_use: CacheUse,
    hooks: Vec<Arc<dyn ExchangeHook>>,
    response_head_timeout: Duration,
    pub(crate) counters: ExchangeCounters,
}

pub(crate) fn empty_body() -> ProxyBody {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

pub(crate) fn full_body(bytes: impl Into<Bytes>) -> ProxyBody {
    Full::new(bytes.into())
        .map_err(|never| match never {})
        .boxed()
}

pub(crate) fn incoming_body(body: Incoming) -> ProxyBody {
    body.map_err(io::Error::other).boxed()
}

/// A bodiless response that is never cached.
pub(crate) fn status_response(status: StatusCode) -> Response<ProxyBody> {
    let mut response = Response::new(empty_body());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
    response
}

/// Static app error page: no script, no form, no request data.
pub(crate) fn synthetic(
    status: StatusCode,
    kind: ProxyErrorKind,
    tag: Option<&'static str>,
) -> Response<ProxyBody> {
    let page = render_error_page(
        kind,
        "",
        tag.unwrap_or(kind.code()),
        &crate::theme_tokens::ThemeTokens::dark_default(),
    );
    let mut response = Response::new(full_body(page));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'"),
    );
    if let Some(tag) = tag {
        headers.insert(
            HeaderName::from_static(UPSTREAM_TAG),
            HeaderValue::from_static(tag),
        );
    }
    response
}

pub(crate) fn upstream_failure(failure: UpstreamFailure) -> Response<ProxyBody> {
    let (tag, kind) = match failure {
        UpstreamFailure::Denied => ("certificate-denied", ProxyErrorKind::TlsFailure),
        UpstreamFailure::Timeout => ("review-timeout", ProxyErrorKind::TlsFailure),
        UpstreamFailure::Fatal(_) => ("fatal", ProxyErrorKind::TlsFailure),
        UpstreamFailure::RouteFailed => ("route-failed", ProxyErrorKind::GenericConnect),
    };
    synthetic(StatusCode::BAD_GATEWAY, kind, Some(tag))
}

fn connection_tokens(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect()
}

pub(crate) fn has_connection_token(headers: &HeaderMap, wanted: &str) -> bool {
    connection_tokens(headers).iter().any(|t| t == wanted)
}

/// Removes hop-by-hop and proxy fields. A `Connection` declaration can never
/// remove the framing or routing fields themselves.
pub(crate) fn strip_hop_by_hop(headers: &mut HeaderMap) {
    for token in connection_tokens(headers) {
        if !matches!(
            token.as_str(),
            "host" | "content-length" | "transfer-encoding"
        ) {
            if let Ok(name) = HeaderName::from_bytes(token.as_bytes()) {
                headers.remove(name);
            }
        }
    }
    let keep_te = headers
        .get(header::TE)
        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"trailers"));
    for name in [
        header::CONNECTION,
        HeaderName::from_static("proxy-connection"),
        HeaderName::from_static("keep-alive"),
        header::PROXY_AUTHORIZATION,
        header::PROXY_AUTHENTICATE,
        header::TRANSFER_ENCODING,
        header::UPGRADE,
        header::EXPECT,
    ] {
        headers.remove(name);
    }
    if !keep_te {
        headers.remove(header::TE);
    }
}

/// Hyper decodes chunking only. Any other transfer coding would be served
/// mislabelled as identity content, so such a response is refused.
fn supported_response_framing(headers: &HeaderMap) -> bool {
    let codings: Vec<_> = headers.get_all(header::TRANSFER_ENCODING).iter().collect();
    codings.is_empty()
        || (codings.len() == 1 && codings[0].as_bytes().eq_ignore_ascii_case(b"chunked"))
}

/// `host[:port]` without the scheme's default port.
pub(crate) fn host_text(authority: &Authority, secure: bool) -> String {
    let default = if secure { 443 } else { 80 };
    let host = if authority.host().contains(':') {
        format!("[{}]", authority.host())
    } else {
        authority.host().to_string()
    };
    if authority.port() == default {
        host
    } else {
        format!("{host}:{}", authority.port())
    }
}

/// Parses a `Host`/`:authority` value, applying the scheme's default port.
pub(crate) fn parse_host(value: &str, default_port: u16) -> Option<Authority> {
    let explicit_port = if value.starts_with('[') {
        value.contains("]:")
    } else {
        value.contains(':')
    };
    let text = if explicit_port {
        value.to_string()
    } else {
        format!("{value}:{default_port}")
    };
    Authority::parse(&text).ok()
}

/// Absolute upstream URI for the exchange authority (never the one the
/// request names: callers have already checked they are equal).
pub(crate) fn upstream_uri(ctx: &ExchangeCtx, uri: &Uri) -> Option<Uri> {
    let path = uri.path_and_query().map_or("/", |p| p.as_str());
    if !path.starts_with('/') {
        return None;
    }
    let scheme = if ctx.secure { "https" } else { "http" };
    format!("{scheme}://{}{path}", host_text(&ctx.authority, ctx.secure))
        .parse()
        .ok()
}

/// A top-level navigation request (`Sec-Fetch-Dest: document`).
pub(crate) fn is_main_frame(headers: &HeaderMap) -> bool {
    headers
        .get("sec-fetch-dest")
        .is_some_and(|value| value.as_bytes().eq_ignore_ascii_case(b"document"))
}

impl Exchange {
    pub(crate) fn new(
        authority: Arc<InterceptAuthority>,
        pool: Arc<UpstreamPool>,
        cache: Arc<ProxyCache>,
        cache_use: CacheUse,
        hooks: Vec<Arc<dyn ExchangeHook>>,
    ) -> Self {
        Self {
            authority,
            pool,
            cache,
            cache_use,
            hooks,
            response_head_timeout: RESPONSE_HEAD_TIMEOUT,
            counters: ExchangeCounters::default(),
        }
    }

    pub(crate) fn cache_use(&self) -> CacheUse {
        self.cache_use
    }

    /// K6 cache counters of this attempt.
    pub(crate) fn cache_counters(&self) -> super::CacheCounters {
        self.cache.counters()
    }

    pub(crate) fn response_head_timeout(&self) -> Duration {
        self.response_head_timeout
    }

    fn fail(&self, response: Response<ProxyBody>) -> Response<ProxyBody> {
        self.counters
            .synthetic_failures
            .fetch_add(1, Ordering::Relaxed);
        response
    }

    pub(crate) fn upstream_failure(&self, failure: UpstreamFailure) -> Response<ProxyBody> {
        self.fail(upstream_failure(failure))
    }

    pub(crate) fn head_timeout(&self) -> Response<ProxyBody> {
        self.fail(synthetic(
            StatusCode::GATEWAY_TIMEOUT,
            ProxyErrorKind::Timeout,
            None,
        ))
    }

    fn hook_failed(&self) -> Response<ProxyBody> {
        self.counters.hook_failures.fetch_add(1, Ordering::Relaxed);
        synthetic(
            StatusCode::INTERNAL_SERVER_ERROR,
            ProxyErrorKind::Other,
            None,
        )
    }

    /// Runs request hooks in registration order. `Err` is the response to
    /// serve instead of contacting upstream.
    pub(crate) fn request_hooks(
        &self,
        ctx: &ExchangeCtx,
        parts: &mut request::Parts,
    ) -> Result<(), Box<Response<ProxyBody>>> {
        if self.hooks.is_empty() {
            return Ok(());
        }
        let mut view = RequestHeadView::new(
            parts.method.clone(),
            parts.uri.clone(),
            std::mem::take(&mut parts.headers),
        );
        for hook in &self.hooks {
            let verdict = catch_unwind(AssertUnwindSafe(|| hook.on_request(ctx, &mut view)));
            match verdict {
                Ok(HookVerdict::Continue) => {}
                Ok(HookVerdict::Respond(fixed)) => {
                    let mut response = Response::new(full_body(Bytes::from_static(fixed.body)));
                    *response.status_mut() = fixed.status;
                    let headers = response.headers_mut();
                    if let Ok(value) = HeaderValue::from_str(fixed.content_type) {
                        headers.insert(header::CONTENT_TYPE, value);
                    }
                    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                    return Err(Box::new(response));
                }
                Ok(HookVerdict::Block) => {
                    return Err(Box::new(status_response(StatusCode::FORBIDDEN)))
                }
                Err(_) => return Err(Box::new(self.hook_failed())),
            }
        }
        let (_, _, headers) = view.into_parts();
        parts.headers = headers;
        Ok(())
    }

    /// Everything served passes here: HSTS observation, response hooks, and
    /// the built-in `Alt-Svc` strip (after hooks, so none can re-add it).
    pub(crate) fn serve(
        &self,
        ctx: &ExchangeCtx,
        response: Response<ProxyBody>,
    ) -> Response<ProxyBody> {
        let (mut parts, body) = response.into_parts();
        if ctx.secure
            && parts
                .headers
                .contains_key(header::STRICT_TRANSPORT_SECURITY)
        {
            self.pool.mark_hsts(&ctx.authority);
            self.counters.hsts_marks.fetch_add(1, Ordering::Relaxed);
        }
        if !self.hooks.is_empty() {
            let mut view = ResponseHeadView::new(parts.status, std::mem::take(&mut parts.headers));
            for hook in &self.hooks {
                if catch_unwind(AssertUnwindSafe(|| hook.on_response(ctx, &mut view))).is_err() {
                    return self.hook_failed();
                }
            }
            let (_, headers) = view.into_parts();
            parts.headers = headers;
        }
        parts.headers.remove(header::ALT_SVC);
        Response::from_parts(parts, body)
    }

    /// Normalises an upstream response head for serving downstream.
    pub(crate) fn downstream(
        &self,
        response: Response<Incoming>,
    ) -> Result<Response<ProxyBody>, Box<Response<ProxyBody>>> {
        if !supported_response_framing(response.headers()) {
            return Err(Box::new(self.fail(synthetic(
                StatusCode::BAD_GATEWAY,
                ProxyErrorKind::Other,
                None,
            ))));
        }
        let (mut parts, body) = response.into_parts();
        strip_hop_by_hop(&mut parts.headers);
        parts.version = Version::HTTP_11;
        Ok(Response::from_parts(parts, incoming_body(body)))
    }

    /// One non-upgrade exchange whose authority the caller has admitted.
    pub(crate) async fn exchange(
        &self,
        ctx: ExchangeCtx,
        request: Request<Incoming>,
    ) -> Response<ProxyBody> {
        let (mut parts, body) = request.into_parts();
        let Some(uri) = upstream_uri(&ctx, &parts.uri) else {
            return status_response(StatusCode::BAD_REQUEST);
        };
        parts.uri = uri;
        parts.version = Version::HTTP_11;
        strip_hop_by_hop(&mut parts.headers);
        let Ok(host) = HeaderValue::from_str(&host_text(&ctx.authority, ctx.secure)) else {
            return status_response(StatusCode::BAD_REQUEST);
        };
        parts.headers.insert(header::HOST, host);
        if let Err(response) = self.request_hooks(&ctx, &mut parts) {
            return *response;
        }
        let (upstream, token) = match self.cache.lookup(&ctx.authority, &parts).await {
            CacheLookup::Fresh(response) => {
                // A main-frame hit skips upstream; admit the origin in
                // parallel so login delivery (which requires an admitted
                // upstream in this attempt) can proceed. No request bytes.
                if is_main_frame(&parts.headers) {
                    self.pool.spawn_warm(&ctx.authority, ctx.secure);
                }
                return self.serve(&ctx, response);
            }
            CacheLookup::Revalidate { conditional, token } => {
                drop(body);
                (Request::from_parts(conditional, empty_body()), Some(token))
            }
            CacheLookup::Miss => {
                let body = if parts.method == Method::HEAD {
                    drop(body);
                    empty_body()
                } else {
                    incoming_body(body)
                };
                (Request::from_parts(parts.clone(), body), None)
            }
        };
        let sent = tokio::time::timeout(
            self.response_head_timeout,
            self.pool.send(&ctx.authority, ctx.secure, upstream),
        )
        .await;
        let (response, admission) = match sent {
            Ok(Ok(sent)) => sent,
            Ok(Err(failure)) => return self.upstream_failure(failure),
            Err(_) => return self.head_timeout(),
        };
        let response = match self.downstream(response) {
            Ok(response) => response,
            Err(failure) => return *failure,
        };
        let response = self
            .cache
            .on_upstream(
                &ctx.authority,
                &parts,
                token,
                response,
                admission.persistent,
            )
            .await;
        self.serve(&ctx, response)
    }
}
