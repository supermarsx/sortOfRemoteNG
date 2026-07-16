//! Stateful FTP client — owns the control connection and issues commands.
//!
//! Lifecycle: `connect()` → authenticate → optional TLS upgrade →
//! FEAT/SYST/PWD probing → set TYPE → optionally CWD.
//!
//! The client exposes low-level command helpers used by `directory.rs`
//! and `file_ops.rs` for higher-level operations.

use crate::ftp::connection;
use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::parser;
use crate::ftp::protocol::FtpCodec;
use crate::ftp::tls;
use crate::ftp::transfer::{self, DataStream};
use crate::ftp::types::*;
use chrono::Utc;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use uuid::Uuid;
use zeroize::Zeroizing;

/// A connected FTP client session.
pub struct FtpClient {
    pub id: String,
    pub codec: FtpCodec,
    pub config: FtpConnectionConfig,
    pub info: FtpSessionInfo,
    pub features: ServerFeatures,
    keepalive_tx: Option<tokio::sync::mpsc::Sender<()>>,
}

impl FtpClient {
    /// Establish a new FTP session.
    pub async fn connect(mut config: FtpConnectionConfig) -> FtpResult<Self> {
        // Move the password into a zeroizing guard before any fallible work.
        // The retained session config is non-secret from this point onward,
        // and every early-return path scrubs the authentication allocation.
        let password = Zeroizing::new(std::mem::take(&mut config.password));

        if config.host.is_empty() {
            return Err(FtpError::invalid_config("Host must not be empty"));
        }

        let session_id = Uuid::new_v4().to_string();
        let (mut codec, banner) = connection::connect(&config).await?;
        let banner_text = banner.text();

        // ── Explicit FTPS: AUTH TLS ──────────────────────────────
        if config.security == FtpSecurityMode::Explicit {
            let resp = codec.execute("AUTH TLS").await?;
            if !resp.is_success() {
                return Err(FtpError::tls_failed(format!(
                    "AUTH TLS rejected: {}",
                    resp.text()
                )));
            }
            codec = tls::upgrade_to_tls(codec, &config.host, config.accept_invalid_certs).await?;

            // Protection level
            codec.expect_ok("PBSZ 0").await?;
            codec.expect_ok("PROT P").await?;
        }

        // ── Authenticate ─────────────────────────────────────────
        let user_resp = codec.execute(&format!("USER {}", config.username)).await?;
        if user_resp.code == 331 {
            // Server wants a password
            let pass_command = Zeroizing::new(format!("PASS {}", password.as_str()));
            let pass_resp = codec.execute(pass_command.as_str()).await?;
            if !pass_resp.is_success() {
                // A hostile server can echo the submitted command in its
                // response. Preserve only the status code so credentials can
                // never cross the command/error boundary.
                return Err(FtpError::auth_failed("FTP password authentication failed")
                    .with_code(pass_resp.code));
            }
        } else if !user_resp.is_success() {
            return Err(FtpError::auth_failed(format!(
                "USER rejected: {}",
                user_resp.text()
            )));
        }
        // Authentication is complete. Do not retain the password while
        // probing features or preparing the long-lived client state.
        drop(password);

        // ── FEAT ─────────────────────────────────────────────────
        let features = Self::probe_features(&mut codec).await;

        // ── OPTS UTF8 ON ─────────────────────────────────────────
        if config.utf8 && features.utf8 {
            let _ = codec.execute("OPTS UTF8 ON").await;
        }

        // ── SYST ─────────────────────────────────────────────────
        let system_type = match codec.execute("SYST").await {
            Ok(r) if r.is_success() => Some(r.text().trim_start_matches("215 ").to_string()),
            _ => None,
        };

        // ── PWD ──────────────────────────────────────────────────
        let cwd = Self::get_pwd(&mut codec)
            .await
            .unwrap_or_else(|_| "/".into());

        // ── TYPE ─────────────────────────────────────────────────
        let type_cmd = match config.transfer_type {
            TransferType::Ascii => "TYPE A",
            TransferType::Binary => "TYPE I",
        };
        codec.expect_ok(type_cmd).await?;

        // ── Initial CWD ──────────────────────────────────────────
        let initial_dir = if let Some(ref dir) = config.initial_directory {
            let resp = codec.execute(&format!("CWD {}", dir)).await?;
            if resp.is_success() {
                Self::get_pwd(&mut codec)
                    .await
                    .unwrap_or_else(|_| dir.clone())
            } else {
                cwd
            }
        } else {
            cwd
        };

        let info = FtpSessionInfo {
            id: session_id.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            security: config.security.clone(),
            connected: true,
            current_directory: initial_dir,
            server_banner: Some(banner_text),
            system_type,
            features: features.raw_features.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            transfer_type: config.transfer_type,
            label: config.label.clone(),
            bytes_uploaded: 0,
            bytes_downloaded: 0,
        };

        Ok(Self {
            id: session_id,
            codec,
            config,
            info,
            features,
            keepalive_tx: None,
        })
    }

    // ─── Keepalive ───────────────────────────────────────────────

    /// Start a background keepalive task that sends NOOP every N seconds.
    pub fn start_keepalive(&mut self) {
        if self.config.keepalive_interval_sec == 0 {
            return;
        }
        // We just store the sender; actual NOOP sending happens
        // in the service layer which owns the mutex.
        let (tx, _rx) = tokio::sync::mpsc::channel::<()>(1);
        self.keepalive_tx = Some(tx);
    }

    /// Send a NOOP to keep the control connection alive.
    pub async fn noop(&mut self) -> FtpResult<()> {
        self.codec.expect_ok("NOOP").await?;
        self.touch();
        Ok(())
    }

    // ─── PWD / CWD / CDUP ───────────────────────────────────────

    /// Parse the current working directory from a PWD reply.
    pub async fn get_pwd(codec: &mut FtpCodec) -> FtpResult<String> {
        let resp = codec.expect_ok("PWD").await?;
        parse_pwd(&resp.text())
    }

    /// Change into `path` and update `current_directory`.
    pub async fn cwd(&mut self, path: &str) -> FtpResult<String> {
        self.codec.expect_ok(&format!("CWD {}", path)).await?;
        let new_pwd = Self::get_pwd(&mut self.codec).await?;
        self.info.current_directory = new_pwd.clone();
        self.touch();
        Ok(new_pwd)
    }

    /// Move to the parent directory.
    pub async fn cdup(&mut self) -> FtpResult<String> {
        self.codec.expect_ok("CDUP").await?;
        let new_pwd = Self::get_pwd(&mut self.codec).await?;
        self.info.current_directory = new_pwd.clone();
        self.touch();
        Ok(new_pwd)
    }

    // ─── FEAT probe ──────────────────────────────────────────────

    async fn probe_features(codec: &mut FtpCodec) -> ServerFeatures {
        let resp = match codec.execute("FEAT").await {
            Ok(r) => r,
            Err(_) => return ServerFeatures::default(),
        };

        if !resp.is_success() {
            return ServerFeatures::default();
        }

        let raw: Vec<String> = resp
            .lines
            .iter()
            .skip(1) // skip "211-Features:"
            .filter(|l| !l.starts_with("211"))
            .map(|l| l.trim().to_uppercase())
            .collect();

        let has = |feat: &str| raw.iter().any(|l| l.starts_with(feat));

        ServerFeatures {
            mlsd: has("MLSD"),
            mlst: has("MLST"),
            size: has("SIZE"),
            mdtm: has("MDTM"),
            rest_stream: has("REST STREAM"),
            utf8: has("UTF8"),
            epsv: has("EPSV"),
            eprt: has("EPRT"),
            auth_tls: has("AUTH TLS"),
            pbsz: has("PBSZ"),
            prot: has("PROT"),
            tvfs: has("TVFS"),
            clnt: has("CLNT"),
            mfmt: has("MFMT"),
            raw_features: raw,
        }
    }

    // ─── TYPE command ────────────────────────────────────────────

    /// Switch transfer type.
    pub async fn set_type(&mut self, tt: TransferType) -> FtpResult<()> {
        let cmd = match tt {
            TransferType::Ascii => "TYPE A",
            TransferType::Binary => "TYPE I",
        };
        self.codec.expect_ok(cmd).await?;
        self.info.transfer_type = tt;
        Ok(())
    }

    // ─── Data channel helper ─────────────────────────────────────

    /// Open a data channel with the current configuration.
    pub async fn open_data_channel(&mut self) -> FtpResult<DataStream> {
        transfer::open_data_channel(
            &mut self.codec,
            self.config.data_channel_mode,
            &self.config.security,
            &self.config.host,
            self.config.accept_invalid_certs,
            Duration::from_secs(self.config.data_timeout_sec),
            self.config.active_bind_address.as_deref(),
        )
        .await
    }

    // ─── Listing ─────────────────────────────────────────────────

    /// Retrieve a directory listing (prefers MLSD, falls back to LIST).
    pub async fn list(
        &mut self,
        path: Option<&str>,
        prefer_mlsd: bool,
    ) -> FtpResult<Vec<FtpEntry>> {
        if prefer_mlsd && self.features.mlsd {
            self.mlsd(path).await
        } else {
            self.list_raw(path).await
        }
    }

    /// Issue MLSD and parse the MLSD fact response.
    async fn mlsd(&mut self, path: Option<&str>) -> FtpResult<Vec<FtpEntry>> {
        let cmd = match path {
            Some(p) => format!("MLSD {}", p),
            None => "MLSD".to_string(),
        };
        let data = self.retrieve_data_as_string(&cmd).await?;
        self.touch();
        Ok(parser::parse_listing(&data))
    }

    /// Issue LIST and parse the Unix/Windows output.
    async fn list_raw(&mut self, path: Option<&str>) -> FtpResult<Vec<FtpEntry>> {
        let cmd = match path {
            Some(p) => format!("LIST {}", p),
            None => "LIST".to_string(),
        };
        let data = self.retrieve_data_as_string(&cmd).await?;
        self.touch();
        Ok(parser::parse_listing(&data))
    }

    /// Generic helper: open data channel, send command, collect body as String.
    pub async fn retrieve_data_as_string(&mut self, cmd: &str) -> FtpResult<String> {
        let ds = self.open_data_channel().await?;
        let resp = self.codec.execute(cmd).await?;
        if !resp.is_preliminary() && !resp.is_success() {
            return Err(FtpError::from_reply(resp.code, &resp.text()));
        }

        let data = read_data_stream_to_string(ds).await?;

        // Read the 226 completion reply.
        let done = self.codec.read_response().await?;
        if !done.is_success() {
            return Err(FtpError::from_reply(done.code, &done.text()));
        }

        Ok(data)
    }

    // ─── SIZE / MDTM ────────────────────────────────────────────

    /// Get the size of a remote file (RFC 3659 SIZE).
    pub async fn size(&mut self, path: &str) -> FtpResult<u64> {
        let resp = self.codec.expect_ok(&format!("SIZE {}", path)).await?;
        let text = resp.text();
        // "213 12345"
        let num_str = text.split_whitespace().nth(1).unwrap_or("").trim();
        num_str
            .parse::<u64>()
            .map_err(|_| FtpError::protocol_error(format!("Cannot parse SIZE: {}", text)))
    }

    /// Get the modification time of a remote file (RFC 3659 MDTM).
    pub async fn mdtm(&mut self, path: &str) -> FtpResult<String> {
        let resp = self.codec.expect_ok(&format!("MDTM {}", path)).await?;
        let text = resp.text();
        // "213 20260101120000"
        Ok(text
            .split_whitespace()
            .nth(1)
            .unwrap_or("")
            .trim()
            .to_string())
    }

    // ─── SITE ────────────────────────────────────────────────────

    pub async fn site(&mut self, args: &str) -> FtpResult<FtpResponse> {
        self.codec.execute(&format!("SITE {}", args)).await
    }

    // ─── QUIT ────────────────────────────────────────────────────

    /// Gracefully close the session.
    pub async fn quit(&mut self) -> FtpResult<()> {
        let _ = self.codec.execute("QUIT").await;
        self.info.connected = false;
        if let Some(tx) = self.keepalive_tx.take() {
            let _ = tx.send(()).await;
        }
        Ok(())
    }

    // ─── ABORT ───────────────────────────────────────────────────

    /// Send ABOR to cancel an in-progress transfer.
    pub async fn abort(&mut self) -> FtpResult<()> {
        let _ = self.codec.execute("ABOR").await;
        self.touch();
        Ok(())
    }

    // ─── Utility ─────────────────────────────────────────────────

    pub(crate) fn touch(&mut self) {
        self.info.last_activity = Utc::now();
    }

    pub fn is_connected(&self) -> bool {
        self.info.connected
    }

    /// Diagnostics snapshot.
    pub fn diagnostics(&self) -> FtpDiagnostics {
        FtpDiagnostics {
            session_id: self.id.clone(),
            host: self.info.host.clone(),
            security: self.info.security.clone(),
            features: self.features.clone(),
            current_directory: self.info.current_directory.clone(),
            system_type: self.info.system_type.clone(),
            latency_ms: None,
            last_response_code: None,
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/// Parse `257 "/some/path"` into the path string.
fn parse_pwd(text: &str) -> FtpResult<String> {
    if let Some(start) = text.find('"') {
        if let Some(end) = text[start + 1..].find('"') {
            return Ok(text[start + 1..start + 1 + end].to_string());
        }
    }
    Err(FtpError::protocol_error(format!(
        "Cannot parse PWD: {}",
        text
    )))
}

/// Read an entire data stream into a UTF-8 string.
async fn read_data_stream_to_string(ds: DataStream) -> FtpResult<String> {
    let mut buf = Vec::new();
    match ds {
        DataStream::Plain(mut tcp) => {
            tcp.read_to_end(&mut buf).await?;
        }
        DataStream::Tls(mut tls) => {
            tls.read_to_end(&mut buf).await?;
        }
    }
    String::from_utf8(buf).map_err(|e| FtpError::protocol_error(format!("Data not UTF-8: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{TcpListener, TcpStream};

    async fn expect_command(
        reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>,
        writer: &mut tokio::net::tcp::OwnedWriteHalf,
        expected: &str,
        reply: &str,
    ) {
        let mut command = String::new();
        reader.read_line(&mut command).await.unwrap();
        assert_eq!(command.trim_end_matches(['\r', '\n']), expected);
        writer.write_all(reply.as_bytes()).await.unwrap();
    }

    async fn accept_plain_client(listener: TcpListener) -> (TcpStream, std::net::SocketAddr) {
        listener.accept().await.unwrap()
    }

    fn local_config(port: u16, password: &str) -> FtpConnectionConfig {
        FtpConnectionConfig {
            host: "127.0.0.1".to_string(),
            port,
            username: "test-user".to_string(),
            password: password.to_string(),
            keepalive_interval_sec: 0,
            ..FtpConnectionConfig::default()
        }
    }

    #[test]
    fn connection_config_debug_redacts_password() {
        let config = local_config(21, "debug-secret");
        let debug = format!("{config:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("debug-secret"));
    }

    #[tokio::test]
    async fn successful_login_does_not_retain_the_password() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = accept_plain_client(listener).await;
            let (read_half, mut write_half) = stream.into_split();
            let mut reader = BufReader::new(read_half);
            write_half.write_all(b"220 test server\r\n").await.unwrap();
            expect_command(
                &mut reader,
                &mut write_half,
                "USER test-user",
                "331 password required\r\n",
            )
            .await;
            expect_command(
                &mut reader,
                &mut write_half,
                "PASS retained-secret",
                "230 logged in\r\n",
            )
            .await;
            expect_command(&mut reader, &mut write_half, "FEAT", "500 no features\r\n").await;
            expect_command(
                &mut reader,
                &mut write_half,
                "SYST",
                "215 UNIX Type: L8\r\n",
            )
            .await;
            expect_command(
                &mut reader,
                &mut write_half,
                "PWD",
                "257 \"/\" is current directory\r\n",
            )
            .await;
            expect_command(&mut reader, &mut write_half, "TYPE I", "200 type set\r\n").await;
        });

        let client = FtpClient::connect(local_config(port, "retained-secret"))
            .await
            .unwrap();
        server.await.unwrap();

        assert!(client.config.password.is_empty());
        let debug = format!("{:?}", client.config);
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains("retained-secret"));
    }

    #[tokio::test]
    async fn password_rejection_does_not_echo_server_controlled_secret_text() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = accept_plain_client(listener).await;
            let (read_half, mut write_half) = stream.into_split();
            let mut reader = BufReader::new(read_half);
            write_half.write_all(b"220 test server\r\n").await.unwrap();
            expect_command(
                &mut reader,
                &mut write_half,
                "USER test-user",
                "331 password required\r\n",
            )
            .await;
            expect_command(
                &mut reader,
                &mut write_half,
                "PASS rejected-secret",
                "530 PASS rejected-secret rejected\r\n",
            )
            .await;
        });

        let error = match FtpClient::connect(local_config(port, "rejected-secret")).await {
            Ok(_) => panic!("password rejection unexpectedly connected"),
            Err(error) => error,
        };
        server.await.unwrap();

        assert_eq!(error.kind, crate::ftp::error::FtpErrorKind::AuthFailed);
        assert_eq!(error.code, Some(530));
        assert!(!error.message.contains("rejected-secret"));
        assert!(!error.to_string().contains("rejected-secret"));
    }
}
