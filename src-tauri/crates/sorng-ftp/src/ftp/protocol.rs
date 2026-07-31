//! Low-level FTP command/response codec (RFC 959 §4).
//!
//! Handles:
//! - Sending FTP commands terminated with `\r\n`
//! - Reading single-line and multi-line replies
//! - Parsing the 3-digit reply code

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::types::FtpResponse;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_rustls::client::TlsStream;
use zeroize::Zeroizing;

const DEFAULT_IO_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_COMMAND_BYTES: usize = 8 * 1_024;
const MAX_CONTROL_LINE_BYTES: usize = 16 * 1_024;
const MAX_RESPONSE_LINES: usize = 256;
const MAX_RESPONSE_BYTES: usize = 256 * 1_024;
const MAX_LOG_COMMAND_CHARS: usize = 256;

/// Abstraction over plain TCP or TLS-wrapped read half.
pub enum ReadHalf {
    Plain(BufReader<OwnedReadHalf>),
    Tls(BufReader<tokio::io::ReadHalf<TlsStream<TcpStream>>>),
}

/// Abstraction over plain TCP or TLS-wrapped write half.
pub enum WriteHalf {
    Plain(OwnedWriteHalf),
    Tls(tokio::io::WriteHalf<TlsStream<TcpStream>>),
}

/// The FTP command/response codec operating on split halves.
pub struct FtpCodec {
    pub reader: ReadHalf,
    pub writer: WriteHalf,
    io_timeout: Duration,
    peer_addr: Option<SocketAddr>,
}

impl FtpCodec {
    /// Create a codec from a plain TCP stream.
    pub fn from_tcp(stream: TcpStream) -> Self {
        let peer_addr = stream.peer_addr().ok();
        let (rd, wr) = stream.into_split();
        Self {
            reader: ReadHalf::Plain(BufReader::new(rd)),
            writer: WriteHalf::Plain(wr),
            io_timeout: DEFAULT_IO_TIMEOUT,
            peer_addr,
        }
    }

    /// Create a codec from a TLS-wrapped TCP stream.
    pub fn from_tls(stream: TlsStream<TcpStream>) -> Self {
        let peer_addr = stream.get_ref().0.peer_addr().ok();
        let (rd, wr) = tokio::io::split(stream);
        Self {
            reader: ReadHalf::Tls(BufReader::new(rd)),
            writer: WriteHalf::Tls(wr),
            io_timeout: DEFAULT_IO_TIMEOUT,
            peer_addr,
        }
    }

    pub fn set_io_timeout(&mut self, value: Duration) {
        self.io_timeout = Duration::from_secs(value.as_secs().clamp(1, 120));
    }

    pub fn peer_addr(&self) -> Option<SocketAddr> {
        self.peer_addr
    }

    /// Send a raw FTP command (without trailing CRLF — we add it).
    pub async fn send_command(&mut self, cmd: &str) -> FtpResult<()> {
        validate_command(cmd)?;
        // Commands can contain credentials (PASS/ACCT). Scrub the wire-format
        // allocation after the async write regardless of success or failure.
        let line = Zeroizing::new(format!("{}\r\n", cmd));
        timeout(self.io_timeout, async {
            match &mut self.writer {
                WriteHalf::Plain(w) => w.write_all(line.as_bytes()).await,
                WriteHalf::Tls(w) => w.write_all(line.as_bytes()).await,
            }
        })
        .await
        .map_err(|_| FtpError::timeout("FTP control-channel write timed out"))??;
        log::trace!(">>> {}", command_for_log(cmd));
        Ok(())
    }

    /// Read a single line from the control channel (including CRLF).
    async fn read_line_raw(&mut self) -> FtpResult<String> {
        match &mut self.reader {
            ReadHalf::Plain(r) => read_bounded_line(r, self.io_timeout).await,
            ReadHalf::Tls(r) => read_bounded_line(r, self.io_timeout).await,
        }
    }

    /// Read a complete FTP response (possibly multi-line).
    ///
    /// Multi-line responses look like:
    /// ```text
    /// 220-Welcome to my FTP server
    /// 220-This is line 2
    /// 220 End of greeting
    /// ```
    pub async fn read_response(&mut self) -> FtpResult<FtpResponse> {
        let first = self.read_line_raw().await?;
        let first_trimmed = first.trim_end_matches(['\r', '\n']);

        if first_trimmed.len() < 3 {
            return Err(FtpError::protocol_error(format!(
                "Response too short: '{}'",
                first_trimmed
            )));
        }

        let code = parse_code(first_trimmed)?;
        let mut lines = vec![first_trimmed.to_string()];
        let mut response_bytes = first_trimmed.len();

        // Check for multi-line: "NNN-" means more lines follow until "NNN " is seen.
        let is_multi = first_trimmed.len() >= 4 && first_trimmed.as_bytes()[3] == b'-';
        if is_multi {
            let terminator = format!("{} ", code);
            let mut terminated = false;
            for _ in 1..MAX_RESPONSE_LINES {
                let next = self.read_line_raw().await?;
                let next_trimmed = next.trim_end_matches(['\r', '\n']);
                response_bytes = response_bytes.saturating_add(next_trimmed.len());
                if response_bytes > MAX_RESPONSE_BYTES {
                    return Err(FtpError::protocol_error(
                        "FTP multi-line response exceeded the byte limit",
                    ));
                }
                lines.push(next_trimmed.to_string());
                if next_trimmed.starts_with(&terminator) {
                    terminated = true;
                    break;
                }
            }
            if !terminated {
                return Err(FtpError::protocol_error(
                    "FTP multi-line response exceeded the line limit",
                ));
            }
        }

        let resp = FtpResponse { code, lines };
        log::trace!(
            "<<< {} {}",
            resp.code,
            resp.lines.last().map(String::as_str).unwrap_or("")
        );
        Ok(resp)
    }

    /// Send a command and return the response.
    pub async fn execute(&mut self, cmd: &str) -> FtpResult<FtpResponse> {
        self.send_command(cmd).await?;
        self.read_response().await
    }

    /// Convenience: send a command, expect a specific response-code class.
    pub async fn expect(&mut self, cmd: &str, expected_first_digit: u16) -> FtpResult<FtpResponse> {
        let resp = self.execute(cmd).await?;
        let first = resp.code / 100;
        if first != expected_first_digit {
            return Err(FtpError::from_reply(resp.code, &resp.text()));
        }
        Ok(resp)
    }

    /// Expect a 2xx reply.
    pub async fn expect_ok(&mut self, cmd: &str) -> FtpResult<FtpResponse> {
        self.expect(cmd, 2).await
    }
}

fn validate_command(command: &str) -> FtpResult<()> {
    if command.is_empty() {
        return Err(FtpError::invalid_config("FTP command must not be empty"));
    }
    if command.len() > MAX_COMMAND_BYTES {
        return Err(FtpError::invalid_config(
            "FTP command exceeded the 8 KiB limit",
        ));
    }
    if command.chars().any(|ch| ch.is_control()) {
        return Err(FtpError::invalid_config(
            "FTP command contains a forbidden control character",
        ));
    }
    Ok(())
}

async fn read_bounded_line<R>(reader: &mut R, io_timeout: Duration) -> FtpResult<String>
where
    R: AsyncBufRead + Unpin,
{
    let mut bytes = Vec::with_capacity(256);
    loop {
        let available = timeout(io_timeout, reader.fill_buf())
            .await
            .map_err(|_| FtpError::timeout("FTP control-channel read timed out"))??;
        if available.is_empty() {
            return Err(FtpError::disconnected(
                "Server closed the FTP control connection mid-response",
            ));
        }
        let take = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(available.len());
        if bytes.len().saturating_add(take) > MAX_CONTROL_LINE_BYTES {
            return Err(FtpError::protocol_error(
                "FTP control response line exceeded the 16 KiB limit",
            ));
        }
        let found_newline = available[..take].contains(&b'\n');
        bytes.extend_from_slice(&available[..take]);
        reader.consume(take);
        if found_newline {
            break;
        }
    }
    String::from_utf8(bytes)
        .map_err(|_| FtpError::protocol_error("FTP control response was not valid UTF-8"))
}

/// Credentials must never enter trace logs. PASS and ACCT both carry
/// authentication material under RFC 959, including when issued through the
/// raw-command API.
fn command_for_log(command: &str) -> String {
    let verb = command.split_ascii_whitespace().next().unwrap_or("");
    if verb.eq_ignore_ascii_case("PASS") || verb.eq_ignore_ascii_case("ACCT") {
        format!("{} [redacted]", verb.to_ascii_uppercase())
    } else {
        command
            .chars()
            .map(|ch| if ch.is_control() { ' ' } else { ch })
            .take(MAX_LOG_COMMAND_CHARS)
            .collect()
    }
}

/// Parse the 3-digit reply code from the start of a line.
fn parse_code(line: &str) -> FtpResult<u16> {
    let code = line
        .as_bytes()
        .get(..3)
        .ok_or_else(|| FtpError::protocol_error("Response too short to contain code"))?;
    std::str::from_utf8(code)
        .map_err(|_| FtpError::protocol_error("FTP reply code was not ASCII"))?
        .parse::<u16>()
        .map_err(|_| FtpError::protocol_error(format!("Invalid reply code in: '{}'", line)))
}

#[cfg(test)]
mod tests {
    use super::command_for_log;

    #[test]
    fn redacts_password_and_account_commands_before_logging() {
        assert_eq!(command_for_log("PASS top-secret"), "PASS [redacted]");
        assert_eq!(command_for_log("pass top-secret"), "PASS [redacted]");
        assert_eq!(command_for_log("ACCT billing-secret"), "ACCT [redacted]");
        assert!(!command_for_log("PASS top-secret").contains("top-secret"));
    }

    #[test]
    fn preserves_non_secret_commands_for_diagnostics() {
        assert_eq!(command_for_log("LIST /incoming"), "LIST /incoming");
    }
}
