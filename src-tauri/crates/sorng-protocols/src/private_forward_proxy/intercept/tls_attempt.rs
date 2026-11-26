//! Bounded handshake observations. Never retain packets, names or certificates.
use super::tls_policy::UpstreamTlsProfile;
use crate::private_forward_proxy::BoxedStream;
use std::{
    io,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct TlsAttempt {
    pub profile: UpstreamTlsProfile,
    pub weak_certificates: bool,
    pub sni: bool,
    pub h2: bool,
    pub client_hello_sent: bool,
    pub server_hello_seen: bool,
    pub certificate_seen: bool,
    pub client_auth_requested: bool,
    pub encrypted_handshake: bool,
    pub cipher_ids: [u16; 32],
    pub cipher_count: u8,
    pub signature_ids: [u16; 32],
    pub signature_count: u8,
    pub group_ids: [u16; 16],
    pub group_count: u8,
}
impl TlsAttempt {
    pub fn new(profile: UpstreamTlsProfile, weak_certificates: bool, sni: bool, h2: bool) -> Self {
        Self {
            profile,
            weak_certificates,
            sni,
            h2,
            client_hello_sent: false,
            server_hello_seen: false,
            certificate_seen: false,
            client_auth_requested: false,
            encrypted_handshake: false,
            cipher_ids: [0; 32],
            cipher_count: 0,
            signature_ids: [0; 32],
            signature_count: 0,
            group_ids: [0; 16],
            group_count: 0,
        }
    }
    pub fn lines(self) -> Vec<String> {
        let mut lines=vec![format!("Configured upstream profile: {:?}; TLS engine: {}.",self.profile,if self.profile.requires_helper(){"isolated legacy OpenSSL helper"}else{"Rustls"}),
            format!("SNI: {}; ALPN offer: {}; client certificate configured: no; weak certificate permission: {}.",if self.sni{"sent"}else{"not sent (IP address)"},if self.profile.requires_helper(){"none (HTTP/1.1)"}else if self.h2{"h2, http/1.1"}else{"http/1.1"},self.weak_certificates),
            format!("Handshake observations: ClientHello sent={}; ServerHello received={}; server certificate observed={}; client certificate requested={}; encrypted handshake records observed={}.",self.client_hello_sent,self.server_hello_seen,self.certificate_seen,self.client_auth_requested,self.encrypted_handshake)];
        if self.cipher_count > 0 {
            lines.push(format!(
                "Offered cipher suites: {}.",
                self.cipher_ids[..self.cipher_count as usize]
                    .iter()
                    .map(|id| format!("{:?}", rustls::CipherSuite::from(*id)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            lines.push(format!(
                "Offered signature schemes: {}.",
                self.signature_ids[..self.signature_count as usize]
                    .iter()
                    .map(|id| format!("{:?}", rustls::SignatureScheme::from(*id)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            lines.push(format!(
                "Offered key exchange groups: {}.",
                self.group_ids[..self.group_count as usize]
                    .iter()
                    .map(|id| format!("{:?}", rustls::NamedGroup::from(*id)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        } else {
            lines.push("Legacy cipher policy: ALL excluding anonymous and null encryption; the helper did not report an exact cipher list.".into());
        }
        if self.client_auth_requested {
            lines.push("The server requested a client certificate, but none is configured. This is direct evidence of a client-authentication requirement; alert 40 alone does not prove it was the only cause.".into());
        } else if self.profile == UpstreamTlsProfile::Ssl2 {
            lines.push("SSLv2 uses a different record format; handshake-stage observations are unavailable. Consult the peer alert and device logs.".into());
        } else if self.client_hello_sent && !self.server_hello_seen {
            lines.push("The peer rejected negotiation before a ServerHello was observed. No certificate trust decision was reached; inspect versions, cipher/signature/group overlap, SNI and the server's TLS logs. Alert 40 does not identify which parameter it rejected.".into());
        }
        if self.encrypted_handshake && !self.client_auth_requested {
            lines.push("Some handshake records were encrypted. Absence of a plaintext CertificateRequest observation does not establish that the server never requested client authentication.".into());
        }
        lines
    }
}

pub(crate) struct Trace {
    pub attempt: TlsAttempt,
    header: [u8; 5],
    header_len: usize,
    remaining: usize,
    kind: u8,
    hs: [u8; 4],
    hs_len: usize,
    hs_remaining: usize,
    encrypted: bool,
}
impl Trace {
    pub fn new(attempt: TlsAttempt) -> Self {
        Self {
            attempt,
            header: [0; 5],
            header_len: 0,
            remaining: 0,
            kind: 0,
            hs: [0; 4],
            hs_len: 0,
            hs_remaining: 0,
            encrypted: false,
        }
    }
    pub fn receive(&mut self, mut bytes: &[u8]) {
        if self.attempt.profile == UpstreamTlsProfile::Ssl2 {
            return;
        }
        while !bytes.is_empty() {
            if self.header_len < 5 {
                let n = (5 - self.header_len).min(bytes.len());
                self.header[self.header_len..self.header_len + n].copy_from_slice(&bytes[..n]);
                self.header_len += n;
                bytes = &bytes[n..];
                if self.header_len < 5 {
                    break;
                }
                self.kind = self.header[0];
                self.remaining = u16::from_be_bytes([self.header[3], self.header[4]]) as usize;
                if self.kind == 20 {
                    self.encrypted = true;
                }
                if self.kind == 23 || self.encrypted {
                    self.attempt.encrypted_handshake = true;
                }
            }
            let n = self.remaining.min(bytes.len());
            if self.kind == 22 && !self.encrypted {
                self.handshake(&bytes[..n]);
            }
            bytes = &bytes[n..];
            self.remaining -= n;
            if self.remaining == 0 {
                self.header_len = 0;
            }
        }
    }
    fn handshake(&mut self, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            if self.hs_remaining > 0 {
                let n = self.hs_remaining.min(bytes.len());
                self.hs_remaining -= n;
                bytes = &bytes[n..];
                continue;
            }
            let n = (4 - self.hs_len).min(bytes.len());
            self.hs[self.hs_len..self.hs_len + n].copy_from_slice(&bytes[..n]);
            self.hs_len += n;
            bytes = &bytes[n..];
            if self.hs_len < 4 {
                break;
            }
            self.hs_remaining =
                ((self.hs[1] as usize) << 16) | ((self.hs[2] as usize) << 8) | self.hs[3] as usize;
            match self.hs[0] {
                2 => self.attempt.server_hello_seen = true,
                11 => self.attempt.certificate_seen = true,
                13 => self.attempt.client_auth_requested = true,
                _ => {}
            }
            self.hs_len = 0;
        }
    }
}
pub(crate) type SharedTrace = Arc<Mutex<Trace>>;
pub(crate) fn snapshot(trace: &SharedTrace) -> TlsAttempt {
    trace.lock().unwrap_or_else(|e| e.into_inner()).attempt
}
pub(crate) struct TracedIo {
    pub inner: BoxedStream,
    pub trace: SharedTrace,
}
impl AsyncRead for TracedIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        if matches!(result, Poll::Ready(Ok(()))) {
            self.trace
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .receive(&buf.filled()[before..]);
        }
        result
    }
}
impl AsyncWrite for TracedIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        b: &[u8],
    ) -> Poll<io::Result<usize>> {
        let result = Pin::new(&mut self.inner).poll_write(cx, b);
        if matches!(result,Poll::Ready(Ok(n)) if n>0) {
            self.trace
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .attempt
                .client_hello_sent = true;
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_records_and_headers_preserve_stage_without_retaining_payload() {
        let mut trace = Trace::new(TlsAttempt::new(
            UpstreamTlsProfile::Modern,
            false,
            true,
            true,
        ));
        for byte in [22, 3, 3, 0, 9, 2, 0, 0, 1, 99, 13, 0, 0, 0] {
            trace.receive(&[byte]);
        }
        assert!(trace.attempt.server_hello_seen);
        assert!(trace.attempt.client_auth_requested);
        trace.receive(&[23, 3, 3, 0, 3, 11, 0, 0]);
        assert!(!trace.attempt.certificate_seen);
    }
}
