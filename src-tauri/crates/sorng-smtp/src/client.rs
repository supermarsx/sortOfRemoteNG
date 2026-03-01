//! Low-level SMTP protocol engine.
//!
//! Handles TCP connection, STARTTLS upgrade, EHLO/HELO negotiation,
//! command/response exchange and the DATA transfer.

use std::io::Cursor;
use std::sync::Arc;
use std::time::Duration;

use log::{debug, info, warn};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::TlsConnector;

use crate::types::*;

// ─── Stream Abstraction ─────────────────────────────────────────────

/// Wrapper over plain-text or TLS socket so the rest of the engine is generic.
enum SmtpStream {
    Plain(BufReader<TcpStream>),
    Tls(BufReader<TlsStream<TcpStream>>),
}

impl SmtpStream {
    async fn read_line(&mut self, buf: &mut String) -> SmtpResult<usize> {
        match self {
            Self::Plain(r) => r
                .read_line(buf)
                .await
                .map_err(|e| SmtpError::io(e.to_string())),
            Self::Tls(r) => r
                .read_line(buf)
                .await
                .map_err(|e| SmtpError::io(e.to_string())),
        }
    }

    async fn write_all(&mut self, data: &[u8]) -> SmtpResult<()> {
        match self {
            Self::Plain(r) => r
                .get_mut()
                .write_all(data)
                .await
                .map_err(|e| SmtpError::io(e.to_string())),
            Self::Tls(r) => r
                .get_mut()
                .write_all(data)
                .await
                .map_err(|e| SmtpError::io(e.to_string())),
        }
    }

    async fn flush(&mut self) -> SmtpResult<()> {
        match self {
            Self::Plain(r) => r
                .get_mut()
                .flush()
                .await
                .map_err(|e| SmtpError::io(e.to_string())),
            Self::Tls(r) => r
                .get_mut()
                .flush()
                .await
                .map_err(|e| SmtpError::io(e.to_string())),
        }
    }
}

// ─── SmtpClient ─────────────────────────────────────────────────────

/// The low-level SMTP client.
pub struct SmtpClient {
    stream: Option<SmtpStream>,
    config: SmtpConfig,
    capabilities: Option<EhloCapabilities>,
    tls_active: bool,
    authenticated: bool,
    messages_sent: u64,
}

impl SmtpClient {
    /// Create a new SMTP client with the given configuration.
    pub fn new(config: SmtpConfig) -> Self {
        Self {
            stream: None,
            config,
            capabilities: None,
            tls_active: false,
            authenticated: false,
            messages_sent: 0,
        }
    }

    pub fn config(&self) -> &SmtpConfig {
        &self.config
    }

    pub fn capabilities(&self) -> Option<&EhloCapabilities> {
        self.capabilities.as_ref()
    }

    pub fn is_connected(&self) -> bool {
        self.stream.is_some()
    }

    pub fn is_tls_active(&self) -> bool {
        self.tls_active
    }

    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    pub fn messages_sent(&self) -> u64 {
        self.messages_sent
    }

    // ── Connection ──────────────────────────────────────────────

    /// Connect to the SMTP server and read the greeting.
    pub async fn connect(&mut self) -> SmtpResult<SmtpReply> {
        let addr = format!("{}:{}", self.config.host, self.config.port);
        debug!("Connecting to SMTP server {}…", addr);

        let timeout = Duration::from_secs(self.config.connect_timeout_secs);
        let tcp = tokio::time::timeout(timeout, TcpStream::connect(&addr))
            .await
            .map_err(|_| SmtpError::connection(format!("Connection timed out: {}", addr)))?
            .map_err(|e| SmtpError::connection(format!("Connection failed: {}", e)))?;

        match self.config.security {
            SmtpSecurity::ImplicitTls => {
                // Immediately perform TLS handshake
                let tls_stream = self.upgrade_to_tls_raw(tcp).await?;
                self.stream = Some(SmtpStream::Tls(BufReader::new(tls_stream)));
                self.tls_active = true;
            }
            _ => {
                self.stream = Some(SmtpStream::Plain(BufReader::new(tcp)));
            }
        }

        // Read server greeting
        let greeting = self.read_reply().await?;
        if greeting.is_error() {
            return Err(SmtpError::server(
                greeting.code,
                format!("Server rejected connection: {}", greeting.text()),
            ));
        }
        info!("SMTP connected to {} – {}", addr, greeting.text());
        Ok(greeting)
    }

    /// Perform EHLO (falling back to HELO) and parse capabilities.
    pub async fn ehlo(&mut self) -> SmtpResult<EhloCapabilities> {
        let domain = self.config.ehlo_domain.clone();
        let reply = self.command(&format!("EHLO {}", domain)).await?;
        if reply.is_positive() {
            let caps = EhloCapabilities::parse(&reply);
            self.capabilities = Some(caps.clone());
            return Ok(caps);
        }
        // Fallback to HELO
        debug!("EHLO rejected, trying HELO");
        let reply = self.command(&format!("HELO {}", domain)).await?;
        if reply.is_positive() {
            let caps = EhloCapabilities {
                server_name: reply.lines.first().cloned().unwrap_or_default(),
                ..Default::default()
            };
            self.capabilities = Some(caps.clone());
            Ok(caps)
        } else {
            Err(SmtpError::server(
                reply.code,
                format!("HELO rejected: {}", reply.text()),
            ))
        }
    }

    /// Upgrade the current plain-text connection to TLS via STARTTLS.
    pub async fn starttls(&mut self) -> SmtpResult<()> {
        if self.tls_active {
            return Ok(());
        }
        let reply = self.command("STARTTLS").await?;
        if !reply.is_positive() {
            return Err(SmtpError::tls(format!(
                "STARTTLS rejected: {}",
                reply.text()
            )));
        }

        // Take the existing plain stream
        let stream = self.stream.take().ok_or_else(|| SmtpError::io("No stream"))?;
        let tcp = match stream {
            SmtpStream::Plain(r) => r.into_inner(),
            _ => return Err(SmtpError::tls("Already using TLS")),
        };

        let tls_stream = self.upgrade_to_tls_raw(tcp).await?;
        self.stream = Some(SmtpStream::Tls(BufReader::new(tls_stream)));
        self.tls_active = true;
        info!("STARTTLS upgrade successful");

        // Re-issue EHLO after STARTTLS (RFC 3207 §4.2)
        self.ehlo().await?;
        Ok(())
    }

    /// Close the connection gracefully via QUIT.
    pub async fn quit(&mut self) -> SmtpResult<()> {
        if self.stream.is_some() {
            let _ = self.command("QUIT").await;
            self.stream = None;
        }
        self.tls_active = false;
        self.authenticated = false;
        self.capabilities = None;
        info!("SMTP connection closed");
        Ok(())
    }

    // ── Mail Transaction ────────────────────────────────────────

    /// Issue MAIL FROM.
    pub async fn mail_from(&mut self, sender: &str) -> SmtpResult<SmtpReply> {
        let cmd = format!("MAIL FROM:<{}>", sender);
        let reply = self.command(&cmd).await?;
        if reply.is_error() {
            return Err(SmtpError::server(
                reply.code,
                format!("MAIL FROM rejected: {}", reply.text()),
            ));
        }
        Ok(reply)
    }

    /// Issue RCPT TO.
    pub async fn rcpt_to(&mut self, recipient: &str) -> SmtpResult<SmtpReply> {
        let cmd = format!("RCPT TO:<{}>", recipient);
        let reply = self.command(&cmd).await?;
        if reply.is_error() {
            return Err(SmtpError::server(
                reply.code,
                format!("RCPT TO rejected for {}: {}", recipient, reply.text()),
            ));
        }
        Ok(reply)
    }

    /// Issue DATA and send the message body.
    /// Returns the final reply (should be 250).
    pub async fn data(&mut self, body: &str) -> SmtpResult<SmtpReply> {
        let reply = self.command("DATA").await?;
        if !reply.is_intermediate() {
            return Err(SmtpError::server(
                reply.code,
                format!("DATA rejected: {}", reply.text()),
            ));
        }

        // Send the body (with byte-stuffing for leading dots)
        let body = Self::dot_stuff(body);
        self.write_raw(body.as_bytes()).await?;

        // End with CRLF.CRLF
        if !body.ends_with("\r\n") {
            self.write_raw(b"\r\n").await?;
        }
        self.write_raw(b".\r\n").await?;
        self.flush().await?;

        let reply = self.read_reply().await?;
        if reply.is_error() {
            return Err(SmtpError::server(
                reply.code,
                format!("DATA body rejected: {}", reply.text()),
            ));
        }
        Ok(reply)
    }

    /// Reset the current mail transaction (RSET).
    pub async fn reset(&mut self) -> SmtpResult<SmtpReply> {
        self.command("RSET").await
    }

    /// NOOP command (keep-alive).
    pub async fn noop(&mut self) -> SmtpResult<SmtpReply> {
        self.command("NOOP").await
    }

    /// VRFY command (verify address).
    pub async fn verify(&mut self, address: &str) -> SmtpResult<SmtpReply> {
        self.command(&format!("VRFY {}", address)).await
    }

    /// EXPN command (expand mailing list).
    pub async fn expand(&mut self, list: &str) -> SmtpResult<SmtpReply> {
        self.command(&format!("EXPN {}", list)).await
    }

    /// Send a complete message through the envelope (MAIL FROM + RCPT TO + DATA).
    pub async fn send_envelope(
        &mut self,
        from: &str,
        recipients: &[&str],
        body: &str,
    ) -> SmtpResult<SmtpReply> {
        self.mail_from(from).await?;
        for rcpt in recipients {
            self.rcpt_to(rcpt).await?;
        }
        let reply = self.data(body).await?;
        self.messages_sent += 1;
        Ok(reply)
    }

    /// Mark as authenticated (called by auth module after successful auth).
    pub fn set_authenticated(&mut self, auth: bool) {
        self.authenticated = auth;
    }

    // ── Low-level I/O ───────────────────────────────────────────

    /// Send a command and read the reply.
    pub async fn command(&mut self, cmd: &str) -> SmtpResult<SmtpReply> {
        debug!("C: {}", cmd);
        self.write_raw(format!("{}\r\n", cmd).as_bytes()).await?;
        self.flush().await?;
        self.read_reply().await
    }

    /// Read a complete SMTP reply (may be multi-line).
    pub async fn read_reply(&mut self) -> SmtpResult<SmtpReply> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| SmtpError::io("Not connected"))?;

        let timeout = Duration::from_secs(self.config.io_timeout_secs);
        let mut full_response = String::new();

        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(timeout, stream.read_line(&mut line))
                .await
                .map_err(|_| SmtpError::io("Read timeout"))?
                .map_err(|e| SmtpError::io(format!("Read error: {}", e)))?;

            if n == 0 {
                return Err(SmtpError::io("Connection closed by server"));
            }
            full_response.push_str(&line);
            debug!("S: {}", line.trim_end());

            // Check if this is the final line (code followed by space, not dash)
            if line.len() >= 4 && line.as_bytes()[3] == b' ' {
                break;
            }
        }

        SmtpReply::parse(&full_response)
    }

    /// Write raw bytes to the stream.
    pub async fn write_raw(&mut self, data: &[u8]) -> SmtpResult<()> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| SmtpError::io("Not connected"))?;
        stream.write_all(data).await
    }

    async fn flush(&mut self) -> SmtpResult<()> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| SmtpError::io("Not connected"))?;
        stream.flush().await
    }

    // ── TLS helper ──────────────────────────────────────────────

    async fn upgrade_to_tls_raw(
        &self,
        tcp: TcpStream,
    ) -> SmtpResult<TlsStream<TcpStream>> {
        let mut root_store = rustls::RootCertStore::empty();

        // Load system/webpki roots
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        // Load custom CA if configured
        if let Some(ref ca_path) = self.config.ca_cert_path {
            let pem_data = tokio::fs::read(ca_path)
                .await
                .map_err(|e| SmtpError::tls(format!("Failed to read CA cert: {}", e)))?;
            let mut cursor = Cursor::new(pem_data);
            let certs = rustls_pemfile::certs(&mut cursor)
                .filter_map(|r| r.ok())
                .collect::<Vec<_>>();
            for cert in certs {
                root_store
                    .add(cert)
                    .map_err(|e| SmtpError::tls(format!("Failed to add CA cert: {}", e)))?;
            }
        }

        let mut tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        if !self.config.verify_certificates {
            warn!("TLS certificate verification disabled – insecure!");
            tls_config
                .dangerous()
                .set_certificate_verifier(Arc::new(NoCertVerifier));
        }

        let connector = TlsConnector::from(Arc::new(tls_config));
        let server_name = rustls::pki_types::ServerName::try_from(self.config.host.clone())
            .map_err(|e| SmtpError::tls(format!("Invalid server name: {}", e)))?;

        connector
            .connect(server_name, tcp)
            .await
            .map_err(|e| SmtpError::tls(format!("TLS handshake failed: {}", e)))
    }

    // ── Dot-stuffing ────────────────────────────────────────────

    /// Perform SMTP dot-stuffing on the message body.
    /// Lines starting with '.' get an extra '.' prepended.
    fn dot_stuff(body: &str) -> String {
        let mut result = String::with_capacity(body.len() + 64);
        for line in body.split('\n') {
            let line = line.trim_end_matches('\r');
            if line.starts_with('.') {
                result.push('.');
            }
            result.push_str(line);
            result.push_str("\r\n");
        }
        result
    }
}

// ─── NoCertVerifier (for self-signed certs) ─────────────────────────

#[derive(Debug)]
struct NoCertVerifier;

impl rustls::client::danger::ServerCertVerifier for NoCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
        ]
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_client_default_state() {
        let client = SmtpClient::new(SmtpConfig::default());
        assert!(!client.is_connected());
        assert!(!client.is_tls_active());
        assert!(!client.is_authenticated());
        assert_eq!(client.messages_sent(), 0);
    }

    #[test]
    fn client_config_access() {
        let mut cfg = SmtpConfig::default();
        cfg.host = "smtp.example.com".into();
        cfg.port = 465;
        let client = SmtpClient::new(cfg);
        assert_eq!(client.config().host, "smtp.example.com");
        assert_eq!(client.config().port, 465);
    }

    #[test]
    fn dot_stuffing_no_dots() {
        let input = "Hello\r\nWorld\r\n";
        let result = SmtpClient::dot_stuff(input);
        assert_eq!(result, "Hello\r\nWorld\r\n\r\n");
    }

    #[test]
    fn dot_stuffing_with_dots() {
        let input = ".hidden\r\nnormal\r\n..double\r\n";
        let result = SmtpClient::dot_stuff(input);
        assert!(result.contains("..hidden\r\n"));
        assert!(result.contains("normal\r\n"));
        assert!(result.contains("...double\r\n"));
    }

    #[test]
    fn dot_stuffing_unix_line_endings() {
        let input = "line1\nline2\n.dot\n";
        let result = SmtpClient::dot_stuff(input);
        // Should normalize to CRLF and dot-stuff
        assert!(result.contains("line1\r\n"));
        assert!(result.contains("..dot\r\n"));
    }

    #[test]
    fn set_authenticated() {
        let mut client = SmtpClient::new(SmtpConfig::default());
        assert!(!client.is_authenticated());
        client.set_authenticated(true);
        assert!(client.is_authenticated());
    }

    #[test]
    fn capabilities_initially_none() {
        let client = SmtpClient::new(SmtpConfig::default());
        assert!(client.capabilities().is_none());
    }
}
