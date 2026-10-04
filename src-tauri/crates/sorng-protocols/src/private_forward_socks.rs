//! Bounded RFC 1928 CONNECT / RFC 1929 authentication for native byte routes.
//! The shared browser transport opens only the validated proxy endpoint. Target
//! names are encoded in CONNECT; they are never passed to a local resolver.

use crate::private_forward_proxy::{Authority, BoxedStream};
use std::future::Future;
use std::io;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use zeroize::Zeroizing;

struct Credentials {
    username: Zeroizing<String>,
    password: Zeroizing<String>,
}

/// Native-only authentication policy: no Default, Debug or serialization.
/// Clones share the same zeroizing allocation until the last route/dial drops.
#[derive(Clone)]
pub struct Socks5Auth(Option<Arc<Credentials>>);

impl Socks5Auth {
    pub fn no_auth() -> Self {
        Self(None)
    }

    /// RFC 1929 lengths are UTF-8 byte lengths, each in 1..=255. Credentials
    /// are raw strings, not URL-encoded userinfo; even invalid inputs are wiped.
    pub fn username_password(username: String, password: String) -> io::Result<Self> {
        let credentials = Credentials {
            username: Zeroizing::new(username),
            password: Zeroizing::new(password),
        };
        if !(1..=255).contains(&credentials.username.len())
            || !(1..=255).contains(&credentials.password.len())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid SOCKS5 credentials",
            ));
        }
        Ok(Self(Some(Arc::new(credentials))))
    }
}

#[derive(Clone)]
pub(super) struct Socks5Route {
    endpoint: Authority,
    auth: Socks5Auth,
    timeout: Duration,
}

fn protocol_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid SOCKS5 proxy response")
}

fn transport_error(_: io::Error) -> io::Error {
    io::Error::other("SOCKS5 proxy transport failed")
}

impl Socks5Route {
    pub(super) fn new(endpoint: &str, auth: Socks5Auth, timeout: Duration) -> io::Result<Self> {
        // Parse and validate synchronously, before creating any network future.
        let endpoint = Authority::parse(endpoint).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "Invalid SOCKS5 proxy endpoint")
        })?;
        if timeout.is_zero() || timeout > Duration::from_secs(120) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Invalid SOCKS5 route timeout",
            ));
        }
        Ok(Self {
            endpoint,
            auth,
            timeout,
        })
    }

    pub(super) async fn connect(&self, target: Authority) -> io::Result<BoxedStream> {
        self.connect_with(target, async {
            // None opens only the validated proxy endpoint, using bounded DNS
            // and opaque TCP. The destination is never given to this opener.
            let stream = crate::http::connect_browser_transport(
                self.endpoint.host(),
                self.endpoint.port(),
                None,
            )
            .await
            .map_err(|_| io::Error::other("SOCKS5 proxy transport failed"))?;
            Ok(Box::new(stream) as BoxedStream)
        })
        .await
    }

    // Injection seam for synthetic tests of pending resolution/connect work.
    // Timeout/cancellation drops the open future or owned socket, including a
    // partial handshake. Any OS DNS job retains its bounded shared worker slot.
    async fn connect_with(
        &self,
        target: Authority,
        open_proxy: impl Future<Output = io::Result<BoxedStream>>,
    ) -> io::Result<BoxedStream> {
        tokio::time::timeout(self.timeout, async {
            let mut stream = open_proxy.await.map_err(transport_error)?;
            self.negotiate(&mut stream, &target).await?;
            Ok(stream)
        })
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "SOCKS5 route deadline exceeded"))?
    }

    async fn negotiate(&self, stream: &mut BoxedStream, target: &Authority) -> io::Result<()> {
        let method = if self.auth.0.is_some() { 2 } else { 0 };
        // Exactly one offered method; auth-configured routes cannot downgrade.
        stream
            .write_all(&[5, 1, method])
            .await
            .map_err(transport_error)?;
        let mut selection = [0u8; 2];
        stream
            .read_exact(&mut selection)
            .await
            .map_err(transport_error)?;
        if selection[0] != 5 {
            return Err(protocol_error());
        }
        if selection[1] == 0xff {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "SOCKS5 proxy authentication rejected",
            ));
        }
        if selection[1] != method {
            return Err(protocol_error());
        }

        if let Some(credentials) = &self.auth.0 {
            // Fixed capacity avoids reallocations retaining copies of secrets.
            // This buffer is wiped on success, errors, timeout and cancellation.
            let mut request = Zeroizing::new([0u8; 513]);
            let username = credentials.username.as_bytes();
            let password = credentials.password.as_bytes();
            request[0] = 1;
            request[1] = username.len() as u8;
            request[2..2 + username.len()].copy_from_slice(username);
            request[2 + username.len()] = password.len() as u8;
            request[3 + username.len()..3 + username.len() + password.len()]
                .copy_from_slice(password);
            stream
                .write_all(&request[..3 + username.len() + password.len()])
                .await
                .map_err(transport_error)?;
            // Drop secret packet before waiting for any peer data.
            drop(request);
            let mut response = [0u8; 2];
            stream
                .read_exact(&mut response)
                .await
                .map_err(transport_error)?;
            if response[0] != 1 {
                return Err(protocol_error());
            }
            if response[1] != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "SOCKS5 proxy authentication rejected",
                ));
            }
        }

        let mut request = [0u8; 262];
        request[..3].copy_from_slice(&[5, 1, 0]); // CONNECT, reserved = 0
        let end = match target.host().parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => {
                request[3] = 1;
                request[4..8].copy_from_slice(&ip.octets());
                8
            }
            Ok(IpAddr::V6(ip)) => {
                request[3] = 4;
                request[4..20].copy_from_slice(&ip.octets());
                20
            }
            Err(_) => {
                let host = target.host().as_bytes();
                // Authority already validates ASCII DNS syntax and length.
                request[3] = 3;
                request[4] = host.len() as u8;
                request[5..5 + host.len()].copy_from_slice(host);
                5 + host.len()
            }
        };
        request[end..end + 2].copy_from_slice(&target.port().to_be_bytes());
        stream
            .write_all(&request[..end + 2])
            .await
            .map_err(transport_error)?;

        let mut header = [0u8; 4];
        stream
            .read_exact(&mut header)
            .await
            .map_err(transport_error)?;
        if header[0] != 5 || header[2] != 0 || !matches!(header[3], 1 | 3 | 4) {
            return Err(protocol_error());
        }
        match header[1] {
            0 => {}
            2 => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "SOCKS5 proxy routing rejected",
                ));
            }
            1 | 3..=8 => {
                return Err(io::Error::new(
                    io::ErrorKind::ConnectionRefused,
                    "SOCKS5 proxy routing rejected",
                ));
            }
            _ => return Err(protocol_error()),
        }
        // Consume only the bound-address frame, never any early tunnel bytes.
        // BND.ADDR is informational: do not resolve it or connect to it.
        let address_len = match header[3] {
            1 => 4,
            4 => 16,
            3 => {
                let len = stream.read_u8().await.map_err(transport_error)?;
                if len == 0 {
                    return Err(protocol_error());
                }
                usize::from(len)
            }
            _ => return Err(protocol_error()),
        };
        let mut bound_address = [0u8; 257];
        stream
            .read_exact(&mut bound_address[..address_len + 2])
            .await
            .map_err(transport_error)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "private_forward_route_tests.rs"]
mod tests;
