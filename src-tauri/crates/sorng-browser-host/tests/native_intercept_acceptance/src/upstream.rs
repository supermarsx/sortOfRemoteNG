//! Loopback upstream origins behind the intercepting proxy.
//!
//! `Public` plays a publicly trusted site: its leaf is signed by a disposable
//! "public" root that only this fixture's upstream trust policy knows. It
//! speaks h2 and HTTP/1.1 (hyper auto), serves the cache matrix and echoes one
//! WebSocket text frame. `SelfSigned` presents a self-signed leaf and only
//! counts handshakes and application bytes: the proxy must deny it before any
//! request byte.
use crate::Result;
use base64::Engine;
use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{body::Incoming, header, Request, Response, StatusCode};
use hyper_util::rt::{TokioExecutor, TokioIo};
use serde_json::{json, Value};
use sha1::Digest;
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
    task::JoinSet,
};

pub const PUBLIC_HOST: &str = "intercept.sorng.test";
pub const SELF_SIGNED_HOST: &str = "selfsigned.sorng.test";
pub const VARY_HEADER: &str = "x-sorng-variant";
const ETAG: &str = "\"sorng-v1\"";
const WS_TEXT: &[u8] = b"sorng-intercept-echo";

/// Fixture certificates. The public root never enters the CEF context: it is
/// known only to the fixture's `UpstreamTrust` policy.
pub struct Pki {
    pub public_root: Vec<u8>,
    pub public_leaf: Vec<u8>,
    public_leaf_key: Vec<u8>,
    pub self_signed: Vec<u8>,
    self_signed_key: Vec<u8>,
}

impl Pki {
    pub fn generate() -> Result<Self> {
        let mut root = rcgen::CertificateParams::new(vec![]);
        root.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let mut name = rcgen::DistinguishedName::new();
        name.push(rcgen::DnType::CommonName, "sorng disposable public root");
        root.distinguished_name = name;
        let root = rcgen::Certificate::from_params(root)?;
        let leaf = rcgen::Certificate::from_params(rcgen::CertificateParams::new(vec![
            PUBLIC_HOST.into(),
        ]))?;
        let self_signed = rcgen::generate_simple_self_signed(vec![SELF_SIGNED_HOST.into()])?;
        Ok(Self {
            public_root: root.serialize_der()?,
            public_leaf: leaf.serialize_der_with_signer(&root)?,
            public_leaf_key: leaf.serialize_private_key_der(),
            self_signed: self_signed.serialize_der()?,
            self_signed_key: self_signed.serialize_private_key_der(),
        })
    }

    fn acceptor(
        chain: Vec<Vec<u8>>,
        key: &[u8],
        alpn: &[&[u8]],
    ) -> Result<tokio_rustls::TlsAcceptor> {
        let mut config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                chain.into_iter().map(Into::into).collect(),
                rustls::pki_types::PrivatePkcs8KeyDer::from(key.to_vec()).into(),
            )?;
        config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
        Ok(tokio_rustls::TlsAcceptor::from(Arc::new(config)))
    }
}

/// Server-side observations. Counts only; no request bytes are retained
/// except the page's own JSON proof.
#[derive(Default)]
pub struct Ledger {
    pub connections: usize,
    pub alpn_h2: usize,
    pub alpn_http11: usize,
    pub tls_failures: usize,
    pub page: usize,
    pub max_age: usize,
    pub no_store: usize,
    pub revalidate_full: usize,
    pub revalidate_conditional: usize,
    pub revalidate_not_modified: usize,
    pub vary_a: usize,
    pub vary_b: usize,
    pub vary_other: usize,
    pub ws_upgrades: usize,
    pub ws_echoes: usize,
    pub other_paths: usize,
    pub proxy_authorization_leaked: bool,
    pub proofs: Vec<Value>,
    pub self_signed_connections: usize,
    pub self_signed_handshakes: usize,
    pub self_signed_bytes: usize,
}

impl Ledger {
    pub fn report(&self) -> Value {
        json!({"connections":self.connections,"alpnH2":self.alpn_h2,"alpnHttp11":self.alpn_http11,
            "tlsFailures":self.tls_failures,"page":self.page,"maxAge":self.max_age,"noStore":self.no_store,
            "revalidateFull":self.revalidate_full,"revalidateConditional":self.revalidate_conditional,
            "revalidateNotModified":self.revalidate_not_modified,"varyA":self.vary_a,"varyB":self.vary_b,
            "varyOther":self.vary_other,"wsUpgrades":self.ws_upgrades,"wsEchoes":self.ws_echoes,
            "otherPaths":self.other_paths,"proxyAuthorizationLeaked":self.proxy_authorization_leaked,
            "proofs":self.proofs,"selfSignedConnections":self.self_signed_connections,
            "selfSignedHandshakes":self.self_signed_handshakes,"selfSignedApplicationBytes":self.self_signed_bytes})
    }
}

pub type SharedLedger = Arc<Mutex<Ledger>>;

pub struct Server {
    pub address: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl Server {
    pub async fn stop(mut self) -> Result {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            tokio::time::timeout(Duration::from_secs(10), task).await??;
        }
        Ok(())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

async fn serve_loop<F, Fut>(listener: TcpListener, mut stop: oneshot::Receiver<()>, each: F)
where
    F: Fn(tokio::net::TcpStream) -> Fut,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let mut tasks = JoinSet::new();
    loop {
        tokio::select! {
            _ = &mut stop => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => { tasks.spawn(each(stream)); }
                Err(_) => break,
            },
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
}

/// The "public" origin: h2 + HTTP/1.1, leaf signed by the disposable root.
pub async fn start_public(pki: &Pki, ledger: SharedLedger) -> Result<Server> {
    let acceptor = Pki::acceptor(
        vec![pki.public_leaf.clone(), pki.public_root.clone()],
        &pki.public_leaf_key,
        &[b"h2", b"http/1.1"],
    )?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(serve_loop(listener, stopped, move |stream| {
        let acceptor = acceptor.clone();
        let ledger = ledger.clone();
        async move {
            ledger.lock().unwrap().connections += 1;
            let tls = match tokio::time::timeout(Duration::from_secs(10), acceptor.accept(stream))
                .await
            {
                Ok(Ok(tls)) => tls,
                _ => {
                    ledger.lock().unwrap().tls_failures += 1;
                    return;
                }
            };
            {
                let mut l = ledger.lock().unwrap();
                if tls.get_ref().1.alpn_protocol() == Some(b"h2") {
                    l.alpn_h2 += 1;
                } else {
                    l.alpn_http11 += 1;
                }
            }
            let service = hyper::service::service_fn(move |request| {
                let ledger = ledger.clone();
                async move { Ok::<_, std::convert::Infallible>(handle(request, ledger).await) }
            });
            let _ = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new())
                .serve_connection_with_upgrades(TokioIo::new(tls), service)
                .await;
        }
    }));
    Ok(Server {
        address,
        stop: Some(stop),
        task: Some(task),
    })
}

/// The self-signed origin: completes TLS, then only counts bytes.
pub async fn start_self_signed(pki: &Pki, ledger: SharedLedger) -> Result<Server> {
    let acceptor = Pki::acceptor(
        vec![pki.self_signed.clone()],
        &pki.self_signed_key,
        &[b"h2", b"http/1.1"],
    )?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let (stop, stopped) = oneshot::channel();
    let task = tokio::spawn(serve_loop(listener, stopped, move |stream| {
        let acceptor = acceptor.clone();
        let ledger = ledger.clone();
        async move {
            ledger.lock().unwrap().self_signed_connections += 1;
            let Ok(Ok(mut tls)) =
                tokio::time::timeout(Duration::from_secs(10), acceptor.accept(stream)).await
            else {
                return;
            };
            ledger.lock().unwrap().self_signed_handshakes += 1;
            let mut buffer = [0u8; 4096];
            // Count every decrypted byte until EOF; a denied upstream sends none.
            while let Ok(Ok(read)) =
                tokio::time::timeout(Duration::from_secs(30), tls.read(&mut buffer)).await
            {
                if read == 0 {
                    break;
                }
                ledger.lock().unwrap().self_signed_bytes += read;
            }
        }
    }));
    Ok(Server {
        address,
        stop: Some(stop),
        task: Some(task),
    })
}

fn response(
    status: StatusCode,
    headers: &[(&str, &str)],
    body: impl Into<Bytes>,
) -> Response<Full<Bytes>> {
    let mut response = Response::new(Full::new(body.into()));
    *response.status_mut() = status;
    for (name, value) in headers {
        if let (Ok(name), Ok(value)) = (
            header::HeaderName::from_bytes(name.as_bytes()),
            header::HeaderValue::from_str(value),
        ) {
            response.headers_mut().append(name, value);
        }
    }
    response
}

async fn handle(mut request: Request<Incoming>, ledger: SharedLedger) -> Response<Full<Bytes>> {
    if request.headers().contains_key(header::PROXY_AUTHORIZATION) {
        ledger.lock().unwrap().proxy_authorization_leaked = true;
    }
    let path = request.uri().path().to_owned();
    let no_store = [("cache-control", "no-store")];
    match (request.method().as_str(), path.as_str()) {
        ("GET", "/") => {
            ledger.lock().unwrap().page += 1;
            response(
                StatusCode::OK,
                &[
                    ("content-type", "text/html; charset=utf-8"),
                    ("cache-control", "no-store"),
                ],
                include_str!("page.html"),
            )
        }
        ("GET", "/max-age.txt") => {
            ledger.lock().unwrap().max_age += 1;
            response(
                StatusCode::OK,
                &[
                    ("content-type", "text/plain"),
                    ("cache-control", "max-age=3600"),
                ],
                "max-age-body",
            )
        }
        ("GET", "/no-store.txt") => {
            ledger.lock().unwrap().no_store += 1;
            response(
                StatusCode::OK,
                &[
                    ("content-type", "text/plain"),
                    ("cache-control", "no-store"),
                ],
                "no-store-body",
            )
        }
        ("GET", "/revalidate.txt") => {
            let conditional = request
                .headers()
                .get(header::IF_NONE_MATCH)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let mut l = ledger.lock().unwrap();
            let headers = [
                ("content-type", "text/plain"),
                ("cache-control", "no-cache"),
                ("etag", ETAG),
            ];
            match conditional {
                Some(tag) if tag.split(',').any(|t| t.trim() == ETAG) => {
                    l.revalidate_conditional += 1;
                    l.revalidate_not_modified += 1;
                    response(StatusCode::NOT_MODIFIED, &headers[1..], Bytes::new())
                }
                Some(_) => {
                    l.revalidate_conditional += 1;
                    l.revalidate_full += 1;
                    response(StatusCode::OK, &headers, "revalidate-body")
                }
                None => {
                    l.revalidate_full += 1;
                    response(StatusCode::OK, &headers, "revalidate-body")
                }
            }
        }
        ("GET", "/vary.txt") => {
            let variant = request
                .headers()
                .get(VARY_HEADER)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_owned();
            let mut l = ledger.lock().unwrap();
            match variant.as_str() {
                "a" => l.vary_a += 1,
                "b" => l.vary_b += 1,
                _ => l.vary_other += 1,
            }
            response(
                StatusCode::OK,
                &[
                    ("content-type", "text/plain"),
                    ("cache-control", "max-age=3600"),
                    ("vary", VARY_HEADER),
                ],
                format!("vary-{variant}"),
            )
        }
        ("GET", "/ws") => websocket(&mut request, ledger),
        ("POST", "/proof") => {
            let body = Limited::new(request.into_body(), 64 * 1024).collect().await;
            let proof = body
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b.to_bytes()).ok())
                .unwrap_or(Value::Null);
            ledger.lock().unwrap().proofs.push(proof);
            response(
                StatusCode::OK,
                &[
                    ("content-type", "application/json"),
                    ("cache-control", "no-store"),
                ],
                "{}",
            )
        }
        _ => {
            ledger.lock().unwrap().other_paths += 1;
            response(StatusCode::NOT_FOUND, &no_store, Bytes::new())
        }
    }
}

fn websocket(request: &mut Request<Incoming>, ledger: SharedLedger) -> Response<Full<Bytes>> {
    let key = request
        .headers()
        .get("sec-websocket-key")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let upgrade = request
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
    let Some(key) = key.filter(|key| {
        upgrade
            && base64::engine::general_purpose::STANDARD
                .decode(key)
                .is_ok_and(|v| v.len() == 16)
    }) else {
        return response(
            StatusCode::BAD_REQUEST,
            &[("cache-control", "no-store")],
            Bytes::new(),
        );
    };
    ledger.lock().unwrap().ws_upgrades += 1;
    let accept = base64::engine::general_purpose::STANDARD.encode(sha1::Sha1::digest(
        format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes(),
    ));
    let pending = hyper::upgrade::on(request);
    tokio::spawn(async move {
        if let Ok(upgraded) = pending.await {
            let mut io = TokioIo::new(upgraded);
            if echo(&mut io).await.is_ok() {
                ledger.lock().unwrap().ws_echoes += 1;
            }
        }
    });
    response(
        StatusCode::SWITCHING_PROTOCOLS,
        &[
            ("upgrade", "websocket"),
            ("connection", "Upgrade"),
            ("sec-websocket-accept", &accept),
        ],
        Bytes::new(),
    )
}

/// One bounded masked text frame in, the same text out.
async fn echo<T: AsyncRead + AsyncWrite + Unpin>(stream: &mut T) -> std::io::Result<()> {
    let mut head = [0; 2];
    stream.read_exact(&mut head).await?;
    let length = usize::from(head[1] & 0x7f);
    if head[0] != 0x81 || head[1] & 0x80 == 0 || length > 125 {
        return Err(std::io::Error::other("bounded masked text frame required"));
    }
    let mut mask = [0; 4];
    stream.read_exact(&mut mask).await?;
    let mut body = vec![0; length];
    stream.read_exact(&mut body).await?;
    for (i, byte) in body.iter_mut().enumerate() {
        *byte ^= mask[i % 4];
    }
    if body != WS_TEXT {
        return Err(std::io::Error::other("unexpected WebSocket text"));
    }
    let mut frame = vec![0x81, WS_TEXT.len() as u8];
    frame.extend_from_slice(WS_TEXT);
    stream.write_all(&frame).await?;
    stream.flush().await?;
    // Let the client close; ignore whatever follows.
    let mut rest = [0u8; 64];
    let _ = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut rest)).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_uses_the_echo_text_and_the_vary_header() {
        let page = include_str!("page.html");
        assert!(page.contains(std::str::from_utf8(WS_TEXT).unwrap()));
        assert!(page.contains("X-Sorng-Variant"));
        assert!(page.contains("/proof"));
    }
}
