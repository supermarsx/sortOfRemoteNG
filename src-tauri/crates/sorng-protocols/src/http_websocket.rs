//! Origin-pinned WebSocket HTTP/1.1 upgrade over the very same reqwest client
//! used for HTTP: certificate pin, cookie jar, authentication and configured
//! upstream proxy are retained. No new TLS connector or direct fallback exists.
use super::{collect_upstream_headers, upstream, AxumProxyState, ProxyRequestLogEntry};
use axum::{
    body::Body,
    http::{HeaderMap, Method, Response, StatusCode, Version},
};
use base64::Engine;
use sha1::{Digest, Sha1};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const DOCUMENT_MARKER: &str = "__sorng_ws_document_v1";
const MAX_LIFETIME: Duration = Duration::from_secs(30 * 60);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

fn contains_token(headers: &HeaderMap, name: &str, token: &str) -> bool {
    headers
        .get_all(name)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|value| value.split(','))
        .any(|value| value.trim().eq_ignore_ascii_case(token))
}

fn count(headers: &HeaderMap, name: &str) -> usize {
    headers.get_all(name).iter().count()
}

pub(super) fn is_upgrade_candidate(headers: &HeaderMap) -> bool {
    headers.contains_key("upgrade") || headers.contains_key("sec-websocket-key")
}

fn refusal(status: StatusCode, text: &'static str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("Cache-Control", "no-store")
        .body(Body::from(text))
        .expect("static WebSocket refusal")
}

fn path_and_document(path: &str) -> Option<(String, u64)> {
    let (path, query) = path.split_once('?')?;
    let mut sequence = None;
    let mut kept = Vec::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            kept.push(pair);
            continue;
        }
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded = url::form_urlencoded::parse(pair.as_bytes()).next()?;
        if decoded.0 == DOCUMENT_MARKER {
            if name != DOCUMENT_MARKER
                || sequence.is_some()
                || value.is_empty()
                || !value.bytes().all(|c| c.is_ascii_digit())
            {
                return None;
            }
            let parsed = value.parse::<u64>().ok()?;
            if parsed == 0 || parsed > 9_007_199_254_740_991 {
                return None;
            }
            sequence = Some(parsed);
        } else {
            kept.push(pair);
        }
    }
    let output = if kept.is_empty() {
        path.into()
    } else {
        format!("{path}?{}", kept.join("&"))
    };
    Some((output, sequence?))
}

fn protocols(headers: &HeaderMap) -> Option<Vec<String>> {
    let mut values = Vec::new();
    let mut total = 0;
    for value in headers.get_all("sec-websocket-protocol") {
        let value = value.to_str().ok()?;
        total += value.len();
        if total > 1024 {
            return None;
        }
        for token in value.split(',').map(str::trim) {
            if token.is_empty()
                || token.len() > 128
                || !token
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&c))
                || values.iter().any(|v| v == token)
                || values.len() >= 16
            {
                return None;
            }
            values.push(token.to_string());
        }
    }
    Some(values)
}

pub(super) async fn handle(
    state: Arc<AxumProxyState>,
    request: axum::extract::Request,
) -> Response<Body> {
    // Handshakes are requests too, but socket URLs and subprotocols can contain
    // credentials. Record only a fixed category, never endpoints or frames.
    let started = std::time::Instant::now();
    let method = if request.method() == Method::GET {
        "GET"
    } else {
        "OTHER"
    };
    let response = handle_inner(state.clone(), request).await;
    let status = response.status().as_u16();
    let error = (status >= 400).then(|| format!("HTTP {status} [websocket_handshake]"));
    state.request_count.fetch_add(1, Ordering::Relaxed);
    if error.is_some() {
        state.error_count.fetch_add(1, Ordering::Relaxed);
    }
    if let Ok(mut last_error) = state.last_error.lock() {
        *last_error = error.clone();
    }
    if let Ok(mut manager) = state.global_sessions.lock() {
        manager.record_request(ProxyRequestLogEntry {
            id: String::new(),
            session_id: state.session_id.clone(),
            method: method.into(),
            url: "WebSocket handshake".into(),
            status,
            error,
            timestamp: chrono::Utc::now().to_rfc3339(),
            diagnostic: Some(super::session_diagnostic(
                &state,
                super::ProxyLogDiagnostic::new(
                    "websocket",
                    "complete",
                    "websocket_handshake",
                    if status == 101 { "succeeded" } else { "failed" },
                    started,
                ),
            )),
        });
    }
    response
}

async fn handle_inner(
    state: Arc<AxumProxyState>,
    mut request: axum::extract::Request,
) -> Response<Body> {
    // Origin is mandatory here (unlike ordinary document GET). Validate even
    // when this handler is called directly in a fixture, before any network.
    if !super::proxy_request_headers_are_authorized(
        request.headers(),
        &state.proxy_authority,
        &state.proxy_origin,
    ) || count(request.headers(), "host") != 1
        || count(request.headers(), "origin") != 1
        || request
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok())
            != Some(state.proxy_origin.as_str())
    {
        return refusal(StatusCode::FORBIDDEN, "WebSocket origin is not authorized.");
    }
    let headers = request.headers();
    if request.method() != Method::GET
        || request.version() != Version::HTTP_11
        || !contains_token(headers, "connection", "upgrade")
        || !contains_token(headers, "upgrade", "websocket")
        || headers
            .get("sec-websocket-version")
            .and_then(|v| v.to_str().ok())
            != Some("13")
        || headers.contains_key("transfer-encoding")
        || count(headers, "sec-websocket-key") != 1
        || count(headers, "sec-websocket-version") != 1
        || count(headers, "sec-websocket-protocol") > 1
        || headers
            .get("content-length")
            .is_some_and(|v| v.as_bytes() != b"0")
    {
        return refusal(StatusCode::BAD_REQUEST, "Unsupported WebSocket upgrade.");
    }
    let Some(key) = headers
        .get("sec-websocket-key")
        .and_then(|v| v.to_str().ok())
        .filter(|v| {
            v.len() <= 32
                && base64::engine::general_purpose::STANDARD
                    .decode(v)
                    .is_ok_and(|bytes| bytes.len() == 16)
        })
        .map(str::to_string)
    else {
        return refusal(StatusCode::BAD_REQUEST, "Invalid WebSocket handshake key.");
    };
    let Some(offered) = protocols(headers) else {
        return refusal(StatusCode::BAD_REQUEST, "Invalid WebSocket subprotocols.");
    };
    let Some((path, sequence)) = request
        .uri()
        .path_and_query()
        .and_then(|v| path_and_document(v.as_str()))
    else {
        return refusal(
            StatusCode::BAD_REQUEST,
            "WebSocket document identity is missing or invalid.",
        );
    };
    let Ok(permit) = state.network.sockets.clone().try_acquire_owned() else {
        return refusal(
            StatusCode::TOO_MANY_REQUESTS,
            "This proxy's WebSocket limit has been reached.",
        );
    };
    if state.network.await_document(sequence).await.is_err() {
        return refusal(StatusCode::GONE, "This proxy document has ended.");
    }
    let mut forwarded = collect_upstream_headers(
        headers,
        state.upstream_auth_mode,
        &state.proxy_origin,
        &state.target_origin,
    );
    // Browser extension negotiation is not forwarded. The transparent tunnel
    // has fixed-size buffers and does not decompress untrusted frames.
    forwarded.retain(|(name, _)| !name.starts_with("sec-websocket-") && name != "upgrade");
    for (name, value) in &state.custom_headers {
        forwarded.retain(|(existing, _)| !existing.eq_ignore_ascii_case(name));
        forwarded.push((name.clone(), value.clone()));
    }
    forwarded.extend([
        ("connection".into(), "Upgrade".into()),
        ("upgrade".into(), "websocket".into()),
        ("sec-websocket-version".into(), "13".into()),
        ("sec-websocket-key".into(), key.clone()),
    ]);
    if !offered.is_empty() {
        forwarded.push(("sec-websocket-protocol".into(), offered.join(", ")));
    }
    let browser_upgrade = hyper::upgrade::on(&mut request);
    if !axum::body::to_bytes(request.into_body(), 0)
        .await
        .is_ok_and(|v| v.is_empty())
    {
        return refusal(
            StatusCode::BAD_REQUEST,
            "WebSocket upgrade bodies are not supported.",
        );
    }
    let target = format!("{}{}", state.target_origin, path);
    let response = match state
        .network
        .while_document(
            sequence,
            upstream::send_websocket(&state, &target, &forwarded),
        )
        .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => {
            return refusal(
                StatusCode::BAD_GATEWAY,
                "The WebSocket upstream handshake failed; no alternate route was attempted.",
            )
        }
        Err(_) => return refusal(StatusCode::GONE, "This proxy document has ended."),
    };
    if response.status().is_client_error() || response.status().is_server_error() {
        // Preserve actionable rejection status without exposing an upstream
        // login challenge, cookies, redirect, error body or response headers.
        return refusal(
            response.status(),
            "The upstream rejected the WebSocket handshake; no alternate route was attempted.",
        );
    }
    let expected_accept = base64::engine::general_purpose::STANDARD.encode(Sha1::digest(
        format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes(),
    ));
    let selected = match response.headers().get("sec-websocket-protocol") {
        Some(value) => match value.to_str() {
            Ok(value) => Some(value.to_string()),
            Err(_) => {
                return refusal(
                    StatusCode::BAD_GATEWAY,
                    "The upstream returned an invalid WebSocket handshake.",
                )
            }
        },
        None => None,
    };
    if response.status() != StatusCode::SWITCHING_PROTOCOLS
        || count(response.headers(), "sec-websocket-accept") != 1
        || count(response.headers(), "sec-websocket-protocol") > 1
        || count(response.headers(), "sec-websocket-version") > 1
        || !contains_token(response.headers(), "connection", "upgrade")
        || !contains_token(response.headers(), "upgrade", "websocket")
        || response
            .headers()
            .get("sec-websocket-accept")
            .and_then(|v| v.to_str().ok())
            != Some(expected_accept.as_str())
        || response.headers().contains_key("sec-websocket-extensions")
        || selected.as_ref().is_some_and(|v| !offered.contains(v))
    {
        return refusal(
            StatusCode::BAD_GATEWAY,
            "The upstream returned an invalid WebSocket handshake.",
        );
    }
    let upstream = match state
        .network
        .while_document(
            sequence,
            tokio::time::timeout(Duration::from_secs(15), response.upgrade()),
        )
        .await
    {
        Ok(Ok(Ok(stream))) => stream,
        _ => {
            return refusal(
                StatusCode::BAD_GATEWAY,
                "The upstream WebSocket upgrade did not complete.",
            )
        }
    };
    if !state.network.document_is_current(sequence) {
        return refusal(StatusCode::GONE, "This proxy document has ended.");
    }
    tokio::spawn(async move {
        let _permit = permit;
        let _ = state
            .network
            .while_document(sequence, async {
                let Ok(Ok(browser)) =
                    tokio::time::timeout(Duration::from_secs(15), browser_upgrade).await
                else {
                    return;
                };
                let browser = hyper_util::rt::TokioIo::new(browser);
                let _ = tokio::time::timeout(MAX_LIFETIME, relay(browser, upstream)).await;
            })
            .await;
    });
    let mut result = Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Accept", expected_accept);
    if let Some(protocol) = selected {
        result = result.header("Sec-WebSocket-Protocol", protocol);
    }
    result
        .body(Body::empty())
        .expect("validated WebSocket response")
}

async fn copy_active<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    mut input: R,
    mut output: W,
    activity: tokio::sync::watch::Sender<()>,
) -> std::io::Result<()> {
    let mut buffer = [0u8; 8192];
    loop {
        let count = input.read(&mut buffer).await?;
        if count == 0 {
            return Ok(());
        }
        activity.send_modify(|_| {});
        output.write_all(&buffer[..count]).await?;
        output.flush().await?;
        activity.send_modify(|_| {});
    }
}

async fn relay<A, B>(browser: A, upstream: B) -> std::io::Result<()>
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    relay_with_idle(browser, upstream, IDLE_TIMEOUT).await
}

async fn relay_with_idle<A, B>(browser: A, upstream: B, idle: Duration) -> std::io::Result<()>
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    let (browser_read, browser_write) = tokio::io::split(browser);
    let (upstream_read, upstream_write) = tokio::io::split(upstream);
    let (activity, mut changes) = tokio::sync::watch::channel(());
    tokio::select! {
        result = copy_active(browser_read, upstream_write, activity.clone()) => result,
        result = copy_active(upstream_read, browser_write, activity.clone()) => result,
        _ = async {
            while matches!(tokio::time::timeout(idle, changes.changed()).await, Ok(Ok(()))) {}
        } => Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "WebSocket idle timeout")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_marker_preserves_raw_signed_query_and_rejects_ambiguous_identity() {
        assert_eq!(
            path_and_document("/ws?a=%2f+&&signed=a%26b%3D&__sorng_ws_document_v1=2&"),
            Some(("/ws?a=%2f+&&signed=a%26b%3D&".into(), 2))
        );
        for path in [
            "/ws",
            "/ws?__sorng_ws_document_v1=0",
            "/ws?__sorng_ws_document_v1=1&__sorng_ws_document_v1=1",
            "/ws?%5f%5fsorng_ws_document_v1=1",
            "/ws?__sorng_ws_document_v1=%31",
            "/ws?__sorng_ws_document_v1=9007199254740992",
        ] {
            assert!(path_and_document(path).is_none(), "{path}");
        }
    }

    #[tokio::test]
    async fn receive_only_activity_keeps_both_directions_open_and_true_idle_expires() {
        let (mut browser_peer, browser) = tokio::io::duplex(64);
        let (mut server_peer, upstream) = tokio::io::duplex(64);
        let task = tokio::spawn(relay_with_idle(
            browser,
            upstream,
            Duration::from_millis(250),
        ));
        // Total duration exceeds the idle window while only server-to-browser
        // traffic flows: an independent client-read timeout would close it.
        for _ in 0..7 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            server_peer.write_all(b"push").await.unwrap();
            let mut bytes = [0u8; 4];
            tokio::time::timeout(Duration::from_secs(1), browser_peer.read_exact(&mut bytes))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(&bytes, b"push");
        }
        assert!(!task.is_finished());
        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
    }
}
