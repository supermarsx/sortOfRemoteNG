//! Plain HTTP forwarding without URL/body/cookie rewriting or redirect following.
//! Each browser TCP connection admits one request (Connection: close), preventing
//! pipelined requests from inheriting its authentication or destination grant.
//! Hyper owns message framing and backpressure; no raw upload becomes a tunnel.

use super::*;
use axum::body::Body;
use hyper::http::{HeaderMap, HeaderName, HeaderValue};
use hyper::{Request, Response, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::task::{Context, Poll};
use tokio::io::ReadBuf;
use tokio::sync::{oneshot, Mutex};

pub(super) struct ForwardRequest {
    pub authority: Authority,
    path: Uri,
    headers: HeaderMap,
    websocket: bool,
    has_body: bool,
}

fn token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

fn authority(value: &str) -> Result<Authority, u16> {
    let explicit_port = if value.starts_with('[') {
        value.contains("]:")
    } else {
        value.contains(':')
    };
    Authority::parse(&if explicit_port {
        value.into()
    } else {
        format!("{value}:80")
    })
    .map_err(|_| 400)
}

pub(super) fn validate(header: &[u8], credential_hash: &[u8; 32]) -> Result<ForwardRequest, u16> {
    let text = std::str::from_utf8(header).map_err(|_| 400u16)?;
    let mut lines = text.strip_suffix("\r\n\r\n").ok_or(400u16)?.split("\r\n");
    let mut request = lines.next().ok_or(400u16)?.split(' ');
    let method = request.next().ok_or(400u16)?;
    let target = request.next().ok_or(400u16)?;
    if !token(method)
        || method == "CONNECT"
        || request.next() != Some("HTTP/1.1")
        || request.next().is_some()
        || !target.starts_with("http://")
        || target
            .bytes()
            .any(|b| b <= 32 || b >= 127 || b == b'\\' || b == b'#')
    {
        return Err(400);
    }
    // http::Uri preserves escaped path/query bytes, unlike URL normalization.
    let uri: Uri = target.parse().map_err(|_| 400u16)?;
    let destination = authority(uri.authority().ok_or(400u16)?.as_str())?;
    let path: Uri = uri
        .path_and_query()
        .map_or("/", |p| p.as_str())
        .parse()
        .map_err(|_| 400u16)?;
    if !path.path().starts_with('/') {
        return Err(400);
    }
    let mut headers = HeaderMap::new();
    for (index, line) in lines.enumerate() {
        let (name, value) = line.split_once(':').ok_or(400u16)?;
        if index >= 64 || !token(name) || !value.bytes().all(|b| (32..=126).contains(&b)) {
            return Err(400);
        }
        let name: HeaderName = name.parse().map_err(|_| 400u16)?;
        // Browsers have no need for repeated routing/framing/authentication
        // fields. Reject instead of normalizing a request-smuggling ambiguity.
        if headers.contains_key(&name)
            && matches!(
                name.as_str(),
                "host"
                    | "content-length"
                    | "transfer-encoding"
                    | "proxy-authorization"
                    | "connection"
                    | "upgrade"
                    | "expect"
            )
        {
            return Err(400);
        }
        headers.append(
            name,
            HeaderValue::from_str(value.trim()).map_err(|_| 400u16)?,
        );
    }
    let value = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    if authority(value("host").ok_or(400u16)?)? != destination {
        return Err(400);
    }
    let length = value("content-length");
    let transfer = value("transfer-encoding");
    if length.is_some_and(|v| {
        v.is_empty() || !v.bytes().all(|b| b.is_ascii_digit()) || v.parse::<u64>().is_err()
    }) || transfer.is_some_and(|v| !v.eq_ignore_ascii_case("chunked") || length.is_some())
        || value("expect").is_some_and(|v| !v.eq_ignore_ascii_case("100-continue"))
    {
        return Err(400);
    }
    let has_body = transfer.is_some() || length.is_some_and(|v| v.parse::<u64>().unwrap() > 0);
    let chunked = transfer.is_some();
    let websocket = value("upgrade").is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
    let connection = connection_tokens(&headers)?;
    if headers.contains_key("upgrade")
        && (!websocket || method != "GET" || has_body || !connection.iter().any(|v| v == "upgrade"))
        || connection.iter().any(|v| v == "upgrade") != websocket
    {
        return Err(400);
    }
    // A hop-by-hop declaration must not change the framing or authority we
    // validated. Request trailers are discarded, never forwarded as headers.
    if connection.iter().any(|v| {
        matches!(
            v.as_str(),
            "host" | "content-length" | "transfer-encoding" | "proxy-authorization"
        )
    }) {
        return Err(400);
    }
    authenticate(value("proxy-authorization"), credential_hash)?;
    strip_hop_headers(&mut headers)?;
    if chunked {
        // Keep an explicit framing instruction: Hyper intentionally does not
        // infer chunked bodies for GET/HEAD from an unknown size hint.
        headers.insert("transfer-encoding", HeaderValue::from_static("chunked"));
    }
    headers.insert(
        "connection",
        HeaderValue::from_static(if websocket { "upgrade" } else { "close" }),
    );
    if websocket {
        headers.insert("upgrade", HeaderValue::from_static("websocket"));
    }
    Ok(ForwardRequest {
        authority: destination,
        path,
        headers,
        websocket,
        has_body,
    })
}

fn connection_tokens(headers: &HeaderMap) -> Result<Vec<String>, u16> {
    let mut result = Vec::new();
    for header in headers.get_all("connection") {
        for value in header.to_str().map_err(|_| 400u16)?.split(',') {
            let value = value.trim();
            if !token(value) {
                return Err(400);
            }
            result.push(value.to_ascii_lowercase());
        }
    }
    Ok(result)
}

fn strip_hop_headers(headers: &mut HeaderMap) -> Result<(), u16> {
    for name in connection_tokens(headers)? {
        headers.remove(name);
    }
    for name in [
        "connection",
        "proxy-connection",
        "proxy-authorization",
        "proxy-authenticate",
        "keep-alive",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "expect",
    ] {
        headers.remove(name);
    }
    Ok(())
}

fn failure(status: StatusCode) -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert("connection", HeaderValue::from_static("close"));
    response
}

fn valid_response_framing(headers: &HeaderMap) -> bool {
    let transfer = headers
        .get_all("transfer-encoding")
        .iter()
        .collect::<Vec<_>>();
    headers.get_all("content-length").iter().count() <= 1
        && headers.get("content-length").is_none_or(|value| {
            value.to_str().is_ok_and(|length| {
                !length.is_empty()
                    && length.bytes().all(|b| b.is_ascii_digit())
                    && length.parse::<u64>().is_ok()
            })
        })
        && (transfer.is_empty()
            || (transfer.len() == 1
                && !headers.contains_key("content-length")
                && transfer[0].as_bytes().eq_ignore_ascii_case(b"chunked")))
}

// Track actual bytes moved in either direction, not wakeups or repeated polls.
// One idle deadline covers response bodies AND a peer that stops accepting writes.
struct ActiveIo<T> {
    inner: T,
    progress: watch::Sender<tokio::time::Instant>,
}
impl<T: AsyncRead + Unpin> AsyncRead for ActiveIo<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buffer.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buffer);
        if buffer.filled().len() > before {
            self.progress.send_replace(tokio::time::Instant::now());
        }
        result
    }
}
impl<T: AsyncWrite + Unpin> AsyncWrite for ActiveIo<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        let result = Pin::new(&mut self.inner).poll_write(cx, bytes);
        if matches!(result, Poll::Ready(Ok(n)) if n > 0) {
            self.progress.send_replace(tokio::time::Instant::now());
        }
        result
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
async fn idle(mut progress: watch::Receiver<tokio::time::Instant>, duration: Duration) {
    loop {
        let deadline = *progress.borrow_and_update() + duration;
        tokio::select! {
            biased;
            result = progress.changed() => if result.is_err() { return; },
            _ = tokio::time::sleep_until(deadline) => return,
        }
    }
}

// Replay the bounded admission buffer into Hyper, then stream from the socket.
// Includes bytes coalesced with the header (upload, pipeline, or early WS data).
struct Prefixed {
    prefix: Zeroizing<Vec<u8>>,
    offset: usize,
    socket: TcpStream,
}
impl AsyncRead for Prefixed {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.offset < self.prefix.len() {
            let count = buffer.remaining().min(self.prefix.len() - self.offset);
            buffer.put_slice(&self.prefix[self.offset..self.offset + count]);
            self.offset += count;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.socket).poll_read(cx, buffer)
    }
}
impl AsyncWrite for Prefixed {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.socket).poll_write(cx, data)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.socket).poll_shutdown(cx)
    }
}

pub(super) async fn relay(
    mut client: TcpStream,
    prefix: Zeroizing<Vec<u8>>,
    upstream: BoxedStream,
    forward: ForwardRequest,
    limits: ProxyLimits,
) {
    let (progress, activity) = watch::channel(tokio::time::Instant::now());
    let upstream = ActiveIo {
        inner: upstream,
        progress: progress.clone(),
    };
    let handshake = tokio::time::timeout(
        limits.response_timeout,
        hyper::client::conn::http1::Builder::new()
            .preserve_header_case(true)
            .max_buf_size(32 * 1024)
            .handshake::<_, Body>(TokioIo::new(upstream)),
    )
    .await;
    let Ok(Ok((mut sender, connection))) = handshake else {
        refuse(&mut client, 502, limits.response_timeout).await;
        return;
    };
    let (upgrades, mut upgraded) = oneshot::channel();
    let once = Mutex::new(Some((forward, upgrades)));
    let sender = Mutex::new(&mut sender);
    let service = hyper::service::service_fn(|mut request: Request<hyper::body::Incoming>| {
        let once = &once;
        let sender = &sender;
        async move {
            let Some((forward, upgrades)) = once.lock().await.take() else {
                return Ok::<_, Infallible>(failure(StatusCode::BAD_REQUEST));
            };
            let client_upgrade = forward.websocket.then(|| hyper::upgrade::on(&mut request));
            *request.uri_mut() = forward.path;
            *request.headers_mut() = forward.headers;
            let request = request.map(|incoming| {
                if forward.has_body {
                    // Browsers do not use application trailers here. Discarding
                    // them also prevents hop/proxy credentials in trailer fields.
                    Body::from_stream(Body::new(incoming).into_data_stream())
                } else {
                    Body::empty()
                }
            });
            let mut sender = sender.lock().await;
            let result =
                tokio::time::timeout(limits.http_response_timeout, sender.send_request(request))
                    .await;
            let mut response = match result {
                Ok(Ok(response)) => response,
                Ok(Err(_)) => return Ok(failure(StatusCode::BAD_GATEWAY)),
                Err(_) => return Ok(failure(StatusCode::GATEWAY_TIMEOUT)),
            };
            let switch = response.status() == StatusCode::SWITCHING_PROTOCOLS;
            // Hyper decodes chunking but does not decode other transfer codings.
            // Never retain an ignored Content-Length or label compressed bytes
            // as identity content by removing unsupported Transfer-Encoding.
            if !valid_response_framing(response.headers()) {
                return Ok(failure(StatusCode::BAD_GATEWAY));
            }
            if switch
                && (!forward.websocket
                    || !response
                        .headers()
                        .get("upgrade")
                        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"))
                    || !connection_tokens(response.headers())
                        .is_ok_and(|v| v.iter().any(|v| v == "upgrade")))
            {
                return Ok(failure(StatusCode::BAD_GATEWAY));
            }
            // Never let a hop declaration strip framing and turn it into an
            // accidental close-delimited response.
            if connection_tokens(response.headers()).is_ok_and(|v| {
                v.iter()
                    .any(|v| matches!(v.as_str(), "content-length" | "transfer-encoding"))
            }) || strip_hop_headers(response.headers_mut()).is_err()
            {
                return Ok(failure(StatusCode::BAD_GATEWAY));
            }
            if switch {
                response
                    .headers_mut()
                    .insert("connection", HeaderValue::from_static("upgrade"));
                response
                    .headers_mut()
                    .insert("upgrade", HeaderValue::from_static("websocket"));
                let _ = upgrades.send((client_upgrade.unwrap(), hyper::upgrade::on(&mut response)));
            } else {
                response
                    .headers_mut()
                    .insert("connection", HeaderValue::from_static("close"));
            }
            Ok(response.map(|incoming| Body::from_stream(Body::new(incoming).into_data_stream())))
        }
    });
    let socket = Prefixed {
        prefix,
        offset: 0,
        socket: client,
    };
    let socket = ActiveIo {
        inner: socket,
        progress,
    };
    let mut builder = hyper::server::conn::http1::Builder::new();
    builder
        .keep_alive(false)
        .half_close(true)
        .preserve_header_case(true)
        .auto_date_header(false)
        .header_read_timeout(None)
        .max_buf_size(32 * 1024);
    let serve = async {
        let http = builder
            .serve_connection(TokioIo::new(socket), service)
            .with_upgrades();
        tokio::select! { _ = http => {}, _ = idle(activity, limits.http_idle_timeout) => return }
        if let Ok((client_upgrade, upstream_upgrade)) = upgraded.try_recv() {
            if let Ok((Ok(client), Ok(upstream))) =
                tokio::time::timeout(limits.response_timeout, async {
                    tokio::join!(client_upgrade, upstream_upgrade)
                })
                .await
            {
                let _ = tokio::io::copy_bidirectional_with_sizes(
                    &mut TokioIo::new(client),
                    &mut TokioIo::new(upstream),
                    RELAY_BUFFER,
                    RELAY_BUFFER,
                )
                .await;
            }
        }
    };
    // Both drivers belong to this client's future: revocation/cancellation
    // drops them together, including an active WS relay. No detached task.
    let drive = async {
        let _ = connection.with_upgrades().await;
        std::future::pending::<()>().await;
    };
    tokio::select! { _ = serve => {}, _ = drive => {} }
}

#[cfg(test)]
#[path = "http_tests.rs"]
mod tests;
