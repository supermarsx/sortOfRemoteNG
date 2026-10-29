//! TLS termination of one authenticated, granted CONNECT tunnel.
//!
//! The ClientHello is read first (`LazyConfigAcceptor`): SNI must equal the
//! CONNECT host (no SNI only for an IP-literal authority), otherwise the
//! tunnel is closed without a handshake. The leaf for exactly that authority
//! is minted by the attempt CA, ALPN is the client offer intersected with
//! `h2`/`http/1.1`, and the negotiated protocol selects the HTTP server.

use super::ca::ALPN_H2;
use super::forward::Exchange;
use super::server::{self, TunnelGate};
use crate::private_forward_proxy::{Authority, DestinationGrant, ProxyLimits};
use std::io;
use std::net::IpAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use zeroize::Zeroizing;

/// Replays bytes already read past a request head, then reads the socket.
pub(crate) struct Prefixed<T> {
    prefix: Zeroizing<Vec<u8>>,
    offset: usize,
    inner: T,
}

impl<T> Prefixed<T> {
    pub(crate) fn new(prefix: Zeroizing<Vec<u8>>, inner: T) -> Self {
        Self {
            prefix,
            offset: 0,
            inner,
        }
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for Prefixed<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.offset < self.prefix.len() {
            let count = buffer.remaining().min(self.prefix.len() - self.offset);
            let start = self.offset;
            buffer.put_slice(&self.prefix[start..start + count]);
            self.offset += count;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buffer)
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for Prefixed<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, data)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// SNI must name the CONNECT host exactly; only an IP-literal authority may
/// arrive without SNI (clients never send IP addresses as SNI).
pub(crate) fn sni_matches(server_name: Option<&str>, authority: &Authority) -> bool {
    let literal = authority.host().parse::<IpAddr>().is_ok();
    match server_name {
        Some(name) => !literal && name.eq_ignore_ascii_case(authority.host()),
        None => literal,
    }
}

pub(crate) async fn serve_tunnel(
    mut client: TcpStream,
    early: Zeroizing<Vec<u8>>,
    authority: Authority,
    exchange: Arc<Exchange>,
    grant: DestinationGrant,
    limits: ProxyLimits,
) {
    let established = tokio::time::timeout(
        limits.response_timeout,
        client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n"),
    )
    .await;
    if !matches!(established, Ok(Ok(()))) {
        return;
    }
    let acceptor = tokio_rustls::LazyConfigAcceptor::new(
        rustls::server::Acceptor::default(),
        Prefixed::new(early, client),
    );
    let Ok(Ok(start)) = tokio::time::timeout(limits.header_timeout, acceptor).await else {
        return;
    };
    let hello = start.client_hello();
    if !sni_matches(hello.server_name(), &authority) {
        return;
    }
    let offer: Vec<Vec<u8>> = hello
        .alpn()
        .map(|protocols| protocols.map(<[u8]>::to_vec).collect())
        .unwrap_or_default();
    let Ok(config) = exchange.authority.server_config(&authority, &offer) else {
        return;
    };
    let Ok(Ok(tls)) = tokio::time::timeout(limits.header_timeout, start.into_stream(config)).await
    else {
        return;
    };
    let h2 = tls.get_ref().1.alpn_protocol() == Some(ALPN_H2);
    server::serve(tls, h2, exchange, TunnelGate { authority, grant }).await;
}
