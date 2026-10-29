//! HTTP/1.1 and h2 serving inside one intercepted tunnel (or one plain-HTTP
//! proxy connection with keep-alive).
//!
//! - h2 never advertises `SETTINGS_ENABLE_CONNECT_PROTOCOL`, so the engine
//!   opens HTTP/1.1 sockets for WebSockets.
//! - Every request passes a gate first (tunnel: grant + exact authority, 421
//!   on mismatch; plain HTTP: proxy auth + grant per request).
//! - Work spawned for a connection (h2 streams, WebSocket splices) is tied to
//!   it: dropping the connection future (revocation) cancels all of it, and a
//!   connection that ends normally waits for its spawned work first.

use super::forward::{has_connection_token, parse_host, status_response, Exchange};
use super::hooks::ExchangeCtx;
use super::{websocket, ProxyBody};
use crate::private_forward_proxy::{Authority, DestinationGrant};
use hyper::body::Incoming;
use hyper::http::{header, Method, Request, Response, StatusCode, Version};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, watch};

const MAX_HEAD_BYTES: usize = 64 * 1024;

/// Spawns work owned by one connection. Cancelled when the connection's
/// owner drops the matching `watch::Sender`.
#[derive(Clone)]
pub(crate) struct ConnectionTasks {
    cancel: watch::Receiver<()>,
    alive: mpsc::Sender<()>,
}

impl ConnectionTasks {
    pub(crate) fn spawn<F>(&self, work: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let mut cancel = self.cancel.clone();
        let alive = self.alive.clone();
        tokio::spawn(async move {
            let _alive = alive;
            tokio::select! {
                biased;
                _ = cancel.changed() => {},
                _ = work => {},
            }
        });
    }
}

impl<F> hyper::rt::Executor<F> for ConnectionTasks
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    fn execute(&self, work: F) {
        self.spawn(async move {
            work.await;
        });
    }
}

/// The response that refuses one request.
pub(crate) type Refusal = Box<Response<ProxyBody>>;

/// Per-request admission for one served connection.
pub(crate) trait RequestGate: Send + Sync + 'static {
    /// The exchange context, or the response that refuses this request.
    fn admit(&self, request: &Request<Incoming>) -> Result<ExchangeCtx, Refusal>;
}

/// Gate for an intercepted CONNECT tunnel: the request must name exactly the
/// tunnel authority (else 421), and the destination grant is re-checked for
/// every request (else 403).
pub(crate) struct TunnelGate {
    pub authority: Authority,
    pub grant: DestinationGrant,
}

impl TunnelGate {
    fn names_tunnel(&self, request: &Request<Incoming>) -> bool {
        let uri = request.uri();
        let matches = |value: &str| parse_host(value, 443).as_ref() == Some(&self.authority);
        let mut hosts = request.headers().get_all(header::HOST).iter();
        let host = hosts.next();
        if hosts.next().is_some() {
            return false;
        }
        let host_ok = host.is_none_or(|v| v.to_str().is_ok_and(matches));
        match uri.authority() {
            // h2 `:authority`, or an HTTP/1.1 absolute-form target.
            Some(authority) => {
                uri.scheme_str() == Some("https")
                    && authority.as_str().find('@').is_none()
                    && matches(authority.as_str())
                    && host_ok
            }
            // HTTP/1.1 origin-form: `Host` is mandatory.
            None => request.version() != Version::HTTP_2 && host.is_some() && host_ok,
        }
    }
}

impl RequestGate for TunnelGate {
    fn admit(&self, request: &Request<Incoming>) -> Result<ExchangeCtx, Refusal> {
        if !(self.grant)(&self.authority) {
            return Err(Box::new(status_response(StatusCode::FORBIDDEN)));
        }
        if !self.names_tunnel(request) {
            return Err(Box::new(status_response(StatusCode::MISDIRECTED_REQUEST)));
        }
        Ok(ExchangeCtx {
            authority: self.authority.clone(),
            secure: true,
        })
    }
}

pub(crate) fn is_websocket_upgrade(request: &Request<Incoming>) -> bool {
    request
        .headers()
        .get(header::UPGRADE)
        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"))
        && has_connection_token(request.headers(), "upgrade")
}

async fn handle<G: RequestGate>(
    exchange: &Exchange,
    gate: &G,
    tasks: &ConnectionTasks,
    request: Request<Incoming>,
) -> Response<ProxyBody> {
    if request.method() == Method::CONNECT {
        // Includes extended CONNECT, which is never advertised. Nothing about
        // the request is consulted, so this needs no admission.
        return status_response(StatusCode::METHOD_NOT_ALLOWED);
    }
    let ctx = match gate.admit(&request) {
        Ok(ctx) => ctx,
        Err(refused) => return *refused,
    };
    if request.headers().contains_key(header::UPGRADE) {
        if request.version() == Version::HTTP_11 && is_websocket_upgrade(&request) {
            return websocket::upgrade(exchange, ctx, request, tasks).await;
        }
        return status_response(StatusCode::BAD_REQUEST);
    }
    exchange.exchange(ctx, request).await
}

/// Serves one connection until the peer closes it, then waits for the work
/// it spawned (h2 streams, WebSocket splices). Dropping this future cancels
/// all of it.
pub(crate) async fn serve<I, G>(io: I, h2: bool, exchange: Arc<Exchange>, gate: G)
where
    I: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    G: RequestGate,
{
    let (cancel, cancelled) = watch::channel(());
    let (alive, mut finished) = mpsc::channel::<()>(1);
    let tasks = ConnectionTasks {
        cancel: cancelled,
        alive,
    };
    {
        let gate = Arc::new(gate);
        let service_tasks = tasks.clone();
        let service = hyper::service::service_fn(move |request: Request<Incoming>| {
            let exchange = exchange.clone();
            let gate = gate.clone();
            let tasks = service_tasks.clone();
            async move { Ok::<_, Infallible>(handle(&exchange, &*gate, &tasks, request).await) }
        });
        if h2 {
            let mut builder = hyper::server::conn::http2::Builder::new(tasks.clone());
            builder.max_header_list_size(MAX_HEAD_BYTES as u32);
            let _ = builder.serve_connection(TokioIo::new(io), service).await;
        } else {
            let mut builder = hyper::server::conn::http1::Builder::new();
            builder
                .keep_alive(true)
                .half_close(false)
                .preserve_header_case(true)
                .auto_date_header(false)
                .header_read_timeout(None)
                .max_buf_size(MAX_HEAD_BYTES);
            let _ = builder
                .serve_connection(TokioIo::new(io), service)
                .with_upgrades()
                .await;
        }
    }
    drop(tasks);
    // Every spawned task holds an `alive` sender; `None` once all are done.
    let _ = finished.recv().await;
    drop(cancel);
}
