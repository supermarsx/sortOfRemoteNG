//! Low-level FTP command/response codec (RFC 959 §4).
//!
//! Handles:
//! - Sending FTP commands terminated with `\r\n`
//! - Reading single-line and multi-line replies
//! - Parsing the 3-digit reply code

use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::types::FtpResponse;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio_native_tls::TlsStream;
use tokio::net::TcpStream;

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
}

impl FtpCodec {
    /// Create a codec from a plain TCP stream.
    pub fn from_tcp(stream: TcpStream) -> Self {
        let (rd, wr) = stream.into_split();
        Self {
            reader: ReadHalf::Plain(BufReader::new(rd)),
            writer: WriteHalf::Plain(wr),
        }
    }

    /// Create a codec from a TLS-wrapped TCP stream.
    pub fn from_tls(stream: TlsStream<TcpStream>) -> Self {
        let (rd, wr) = tokio::io::split(stream);
        Self {
            reader: ReadHalf::Tls(BufReader::new(rd)),
            writer: WriteHalf::Tls(wr),
        }
    }

    /// Send a raw FTP command (without trailing CRLF — we add it).
    pub async fn send_command(&mut self, cmd: &str) -> FtpResult<()> {
        let line = format!("{}\r\n", cmd);
        match &mut self.writer {
            WriteHalf::Plain(w) => w.write_all(line.as_bytes()).await?,
            WriteHalf::Tls(w) => w.write_all(line.as_bytes()).await?,
        }
        log::trace!(">>> {}", cmd);
        Ok(())
    }

    /// Read a single line from the control channel (including CRLF).
    async fn read_line_raw(&mut self) -> FtpResult<String> {
        let mut buf = String::new();
        let n = match &mut self.reader {
            ReadHalf::Plain(r) => r.read_line(&mut buf).await?,
            ReadHalf::Tls(r) => r.read_line(&mut buf).await?,
        };
        if n == 0 {
            return Err(FtpError::disconnected("Server closed connection"));
        }
        Ok(buf)
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
        let first_trimmed = first.trim_end_matches(|c| c == '\r' || c == '\n');

        if first_trimmed.len() < 3 {
            return Err(FtpError::protocol_error(format!(
                "Response too short: '{}'",
                first_trimmed
            )));
        }

        let code = parse_code(first_trimmed)?;
        let mut lines = vec![first_trimmed.to_string()];

        // Check for multi-line: "NNN-" means more lines follow until "NNN " is seen.
        let is_multi = first_trimmed.len() >= 4 && first_trimmed.as_bytes()[3] == b'-';
        if is_multi {
            let terminator = format!("{} ", code);
            loop {
                let next = self.read_line_raw().await?;
                let next_trimmed = next.trim_end_matches(|c| c == '\r' || c == '\n');
                lines.push(next_trimmed.to_string());
                if next_trimmed.starts_with(&terminator) {
                    break;
                }
            }
        }

        let resp = FtpResponse { code, lines };
        log::trace!("<<< {} {}", resp.code, resp.lines.last().unwrap_or(&String::new()));
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

/// Parse the 3-digit reply code from the start of a line.
fn parse_code(line: &str) -> FtpResult<u16> {
    if line.len() < 3 {
        return Err(FtpError::protocol_error("Response too short to contain code"));
    }
    line[..3]
        .parse::<u16>()
        .map_err(|_| FtpError::protocol_error(format!("Invalid reply code in: '{}'", line)))
}
