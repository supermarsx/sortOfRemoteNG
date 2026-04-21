//! # Assuan Protocol Client
//!
//! Implements the Assuan IPC protocol used by gpg-agent. Provides both
//! direct socket communication and command-line fallback via
//! `tokio::process::Command`.

use log::{debug, error, info, warn};
use std::collections::HashMap;
use tokio::process::Command;

// ── Assuan Response ─────────────────────────────────────────────────

/// Parsed response from an Assuan protocol exchange.
#[derive(Debug, Clone)]
pub enum AssuanResponse {
    /// OK with optional message.
    Ok(String),
    /// ERR code message.
    Err(u32, String),
    /// Data line (D <hex-or-text>).
    Data(Vec<u8>),
    /// Status line (S <keyword> <args>).
    Status(String, String),
    /// Inquiry (INQUIRE <keyword> <args>).
    Inquire(String, String),
    /// Comment line (# ...).
    Comment(String),
}

/// Collected multi-line response.
#[derive(Debug, Clone, Default)]
pub struct AssuanResult {
    pub ok: bool,
    pub error_code: u32,
    pub error_message: String,
    pub data_lines: Vec<Vec<u8>>,
    pub status_lines: Vec<(String, String)>,
}

impl AssuanResult {
    /// Get all data concatenated as a string.
    pub fn data_as_string(&self) -> String {
        self.data_lines
            .iter()
            .map(|d| String::from_utf8_lossy(d).to_string())
            .collect::<Vec<_>>()
            .join("")
    }

    /// Get a specific status value.
    pub fn get_status(&self, keyword: &str) -> Option<&str> {
        self.status_lines
            .iter()
            .find(|(k, _)| k == keyword)
            .map(|(_, v)| v.as_str())
    }
}

// ── Assuan Protocol Encoding ────────────────────────────────────────

/// Percent-encode a string for the Assuan protocol.
pub fn assuan_percent_encode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    for b in input.bytes() {
        match b {
            b'%' => result.push_str("%25"),
            b'\n' => result.push_str("%0A"),
            b'\r' => result.push_str("%0D"),
            0x00 => result.push_str("%00"),
            _ => result.push(b as char),
        }
    }
    result
}

/// Percent-decode an Assuan protocol string.
pub fn assuan_percent_decode(input: &str) -> Vec<u8> {
    let mut result = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&String::from_utf8_lossy(&bytes[i + 1..i + 3]), 16)
            {
                result.push(val);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i]);
        i += 1;
    }
    result
}

/// Parse a single Assuan response line.
pub fn parse_assuan_line(line: &str) -> Option<AssuanResponse> {
    let line = line.trim_end_matches('\n').trim_end_matches('\r');
    if line.is_empty() {
        return None;
    }

    if line.starts_with("OK") {
        let msg = line.get(2..).unwrap_or("").trim().to_string();
        return Some(AssuanResponse::Ok(msg));
    }

    if let Some(rest) = line.strip_prefix("ERR ") {
        let mut parts = rest.splitn(2, ' ');
        let code = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
        let msg = parts.next().unwrap_or("").to_string();
        return Some(AssuanResponse::Err(code, msg));
    }

    if let Some(stripped) = line.strip_prefix("D ") {
        let data = assuan_percent_decode(stripped);
        return Some(AssuanResponse::Data(data));
    }

    if let Some(rest) = line.strip_prefix("S ") {
        let mut parts = rest.splitn(2, ' ');
        let keyword = parts.next().unwrap_or("").to_string();
        let args = parts.next().unwrap_or("").to_string();
        return Some(AssuanResponse::Status(keyword, args));
    }

    if let Some(rest) = line.strip_prefix("INQUIRE ") {
        let mut parts = rest.splitn(2, ' ');
        let keyword = parts.next().unwrap_or("").to_string();
        let args = parts.next().unwrap_or("").to_string();
        return Some(AssuanResponse::Inquire(keyword, args));
    }

    if let Some(stripped) = line.strip_prefix('#') {
        return Some(AssuanResponse::Comment(stripped.trim().to_string()));
    }

    None
}

/// Parse multiple response lines into a collected result.
pub fn parse_assuan_output(output: &str) -> AssuanResult {
    let mut result = AssuanResult::default();

    for line in output.lines() {
        match parse_assuan_line(line) {
            Some(AssuanResponse::Ok(_)) => {
                result.ok = true;
            }
            Some(AssuanResponse::Err(code, msg)) => {
                result.ok = false;
                result.error_code = code;
                result.error_message = msg;
            }
            Some(AssuanResponse::Data(data)) => {
                result.data_lines.push(data);
            }
            Some(AssuanResponse::Status(kw, args)) => {
                result.status_lines.push((kw, args));
            }
            _ => {}
        }
    }

    result
}

// ── Assuan Client ───────────────────────────────────────────────────

/// Client for communicating with gpg-agent via the Assuan protocol.
/// Uses command-line tools as the primary approach with protocol-aware
/// parsing of results.
pub struct AssuanClient {
    /// Path to the gpg-agent socket.
    socket_path: String,
    /// Path to the gpg-connect-agent binary.
    connect_agent_binary: String,
    /// Whether we are connected.
    connected: bool,
    /// Path to the gpg binary (for fallback operations).
    gpg_binary: String,
}

impl AssuanClient {
    /// Create a new Assuan client.
    pub fn new(gpg_binary: &str) -> Self {
        Self {
            socket_path: String::new(),
            connect_agent_binary: String::new(),
            connected: false,
            gpg_binary: gpg_binary.to_string(),
        }
    }

    /// Connect to the gpg-agent, discovering the socket path.
    pub async fn connect(&mut self) -> Result<(), String> {
        // Try to find gpg-agent socket via gpgconf
        let socket = self.get_agent_socket_path().await?;
        self.socket_path = socket;

        // Find gpg-connect-agent binary
        self.connect_agent_binary = self.find_connect_agent().await;

        // Verify agent is running
        let output = Command::new(&self.gpg_binary)
            .args(["--batch", "--no-tty", "--status-fd", "1", "--version"])
            .output()
            .await
            .map_err(|e| format!("Failed to execute gpg: {}", e))?;

        if output.status.success() {
            self.connected = true;
            info!("Connected to gpg-agent via socket: {}", self.socket_path);
            Ok(())
        } else {
            Err("Failed to verify gpg installation".to_string())
        }
    }

    /// Disconnect from gpg-agent.
    pub async fn disconnect(&mut self) {
        self.connected = false;
        info!("Disconnected from gpg-agent");
    }

    /// Send a command to gpg-agent via gpg-connect-agent.
    pub async fn send_command(&self, command: &str) -> Result<AssuanResult, String> {
        if !self.connected && !self.connect_agent_binary.is_empty() {
            debug!("Sending command to gpg-agent: {}", command);
        }

        let binary = if self.connect_agent_binary.is_empty() {
            "gpg-connect-agent".to_string()
        } else {
            self.connect_agent_binary.clone()
        };

        let output = Command::new(&binary)
            .args(["--no-autostart", "-S", &self.socket_path])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .arg(command)
            .output()
            .await
            .map_err(|e| format!("Failed to execute gpg-connect-agent: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let result = parse_assuan_output(&stdout);

        if !result.ok && result.error_code != 0 {
            warn!(
                "Assuan command '{}' returned error: {} {}",
                command, result.error_code, result.error_message
            );
        }

        Ok(result)
    }

    /// Read a response from a command.
    pub fn read_response(output: &str) -> AssuanResult {
        parse_assuan_output(output)
    }

    /// Query agent info (GETINFO).
    pub async fn get_info(&self, what: &str) -> Result<String, String> {
        let cmd = format!("GETINFO {}", what);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_as_string())
        } else {
            Err(format!("GETINFO {} failed: {}", what, result.error_message))
        }
    }

    /// Get a value from the agent (GETVAL).
    pub async fn getval(&self, key: &str) -> Result<String, String> {
        let cmd = format!("GETVAL {}", assuan_percent_encode(key));
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_as_string())
        } else {
            Err(format!("GETVAL {} failed: {}", key, result.error_message))
        }
    }

    /// Smart card daemon: get attribute.
    pub async fn scd_getattr(&self, attr: &str) -> Result<String, String> {
        let cmd = format!("SCD GETATTR {}", attr);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            // Attributes are returned as status lines
            if let Some(val) = result.get_status(attr) {
                Ok(val.to_string())
            } else {
                Ok(result.data_as_string())
            }
        } else {
            Err(format!(
                "SCD GETATTR {} failed: {}",
                attr, result.error_message
            ))
        }
    }

    /// Smart card daemon: learn card info.
    pub async fn scd_learn(&self) -> Result<HashMap<String, String>, String> {
        let result = self.send_command("SCD LEARN --force").await?;
        let mut info = HashMap::new();
        for (key, val) in &result.status_lines {
            info.insert(key.clone(), val.clone());
        }
        Ok(info)
    }

    /// Smart card daemon: sign with card key.
    pub async fn scd_pksign(&self, keygrip: &str, hash: &[u8]) -> Result<Vec<u8>, String> {
        let hash_hex: String = hash.iter().map(|b| format!("{:02X}", b)).collect();
        let cmd = format!("SCD PKSIGN {}", keygrip);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_lines.into_iter().flatten().collect())
        } else {
            Err(format!(
                "SCD PKSIGN failed: {} (hash: {})",
                result.error_message, hash_hex
            ))
        }
    }

    /// Smart card daemon: decrypt with card key.
    pub async fn scd_pkdecrypt(&self, keygrip: &str, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let _ct_hex: String = ciphertext.iter().map(|b| format!("{:02X}", b)).collect();
        let cmd = format!("SCD PKDECRYPT {}", keygrip);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_lines.into_iter().flatten().collect())
        } else {
            Err(format!("SCD PKDECRYPT failed: {}", result.error_message))
        }
    }

    /// Smart card daemon: generate key on card.
    pub async fn scd_genkey(&self, key_number: u8, force: bool) -> Result<String, String> {
        let force_flag = if force { "--force " } else { "" };
        let cmd = format!("SCD GENKEY {}{}", force_flag, key_number);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(result.data_as_string())
        } else {
            Err(format!("SCD GENKEY failed: {}", result.error_message))
        }
    }

    /// Smart card daemon: change PIN.
    pub async fn scd_passwd(&self, chv_no: &str) -> Result<(), String> {
        let cmd = format!("SCD PASSWD {}", chv_no);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(())
        } else {
            Err(format!("SCD PASSWD failed: {}", result.error_message))
        }
    }

    /// Kill the running gpg-agent.
    pub async fn killagent(&self) -> Result<(), String> {
        let result = self.send_command("KILLAGENT").await?;
        if result.ok {
            info!("gpg-agent killed");
            Ok(())
        } else {
            // Agent may respond with ERR right before dying
            Ok(())
        }
    }

    /// Reload the gpg-agent configuration.
    pub async fn reloadagent(&self) -> Result<(), String> {
        let result = self.send_command("RELOADAGENT").await?;
        if result.ok {
            info!("gpg-agent reloaded");
            Ok(())
        } else {
            Err(format!("RELOADAGENT failed: {}", result.error_message))
        }
    }

    /// Query info about cached keys (KEYINFO).
    pub async fn keyinfo(&self, keygrip: &str) -> Result<Vec<(String, String)>, String> {
        let cmd = if keygrip.is_empty() {
            "KEYINFO --list".to_string()
        } else {
            format!("KEYINFO {}", keygrip)
        };
        let result = self.send_command(&cmd).await?;
        Ok(result.status_lines)
    }

    /// Preset a passphrase in the agent cache.
    pub async fn preset_passphrase(
        &self,
        keygrip: &str,
        timeout: i32,
        passphrase: &str,
    ) -> Result<(), String> {
        let hex_passphrase: String = passphrase.bytes().map(|b| format!("{:02X}", b)).collect();
        let timeout_str = if timeout < 0 {
            "-1".to_string()
        } else {
            timeout.to_string()
        };
        let cmd = format!(
            "PRESET_PASSPHRASE {} {} {}",
            keygrip, timeout_str, hex_passphrase
        );
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(())
        } else {
            Err(format!(
                "PRESET_PASSPHRASE failed: {}",
                result.error_message
            ))
        }
    }

    /// Clear a cached passphrase.
    pub async fn clear_passphrase(&self, keygrip: &str) -> Result<(), String> {
        let cmd = format!("CLEAR_PASSPHRASE {}", keygrip);
        let result = self.send_command(&cmd).await?;
        if result.ok {
            Ok(())
        } else {
            Err(format!("CLEAR_PASSPHRASE failed: {}", result.error_message))
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// Get the gpg-agent socket path via gpgconf.
    pub async fn get_agent_socket_path(&self) -> Result<String, String> {
        let output = Command::new("gpgconf")
            .args(["--list-dirs", "agent-socket"])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(path)
        } else {
            // Fallback: try standard locations
            let home = self.get_gpg_home().await.unwrap_or_default();
            if home.is_empty() {
                Err("Could not determine gpg-agent socket path".to_string())
            } else {
                Ok(format!("{}/S.gpg-agent", home))
            }
        }
    }

    /// Find the gpg-connect-agent binary.
    async fn find_connect_agent(&self) -> String {
        // Try gpg-connect-agent in PATH
        let output = Command::new("gpg-connect-agent")
            .arg("--version")
            .output()
            .await;
        if output.is_ok() {
            return "gpg-connect-agent".to_string();
        }

        // Try alongside the gpg binary
        if !self.gpg_binary.is_empty() {
            let dir = std::path::Path::new(&self.gpg_binary)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if !dir.is_empty() {
                let candidate = format!("{}/gpg-connect-agent", dir);
                if std::path::Path::new(&candidate).exists() {
                    return candidate;
                }
                let candidate_exe = format!("{}/gpg-connect-agent.exe", dir);
                if std::path::Path::new(&candidate_exe).exists() {
                    return candidate_exe;
                }
            }
        }

        "gpg-connect-agent".to_string()
    }

    /// Get GPG home directory.
    async fn get_gpg_home(&self) -> Result<String, String> {
        let output = Command::new("gpgconf")
            .args(["--list-dirs", "homedir"])
            .output()
            .await
            .map_err(|e| format!("Failed to run gpgconf: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err("Could not determine GPG home directory".to_string())
        }
    }
}

// ── Helper: run a gpg command and capture output ────────────────────

/// Execute a gpg command and return stdout as a string.
pub async fn run_gpg_command(gpg_binary: &str, args: &[&str]) -> Result<String, String> {
    debug!("Running gpg command: {} {:?}", gpg_binary, args);

    let output = Command::new(gpg_binary)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute {}: {}", gpg_binary, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        if !stderr.is_empty() {
            error!("gpg stderr: {}", stderr);
        }
        // Some GPG operations output to stderr even on success
        // Return stdout anyway if there is content
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        return Err(format!(
            "gpg command failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr
        ));
    }

    Ok(stdout)
}

/// Execute a gpg command and return raw stdout bytes.
pub async fn run_gpg_command_bytes(gpg_binary: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    debug!("Running gpg command (bytes): {} {:?}", gpg_binary, args);

    let output = Command::new(gpg_binary)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to execute {}: {}", gpg_binary, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.stdout.is_empty() {
            return Ok(output.stdout);
        }
        return Err(format!("gpg command failed: {}", stderr));
    }

    Ok(output.stdout)
}

/// Execute a gpg command with stdin input.
pub async fn run_gpg_command_with_input(
    gpg_binary: &str,
    args: &[&str],
    input: &[u8],
) -> Result<Vec<u8>, String> {
    use tokio::io::AsyncWriteExt;

    debug!(
        "Running gpg command with input: {} {:?} ({} bytes)",
        gpg_binary,
        args,
        input.len()
    );

    let mut child = Command::new(gpg_binary)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", gpg_binary, e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input)
            .await
            .map_err(|e| format!("Failed to write stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to wait for gpg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.stdout.is_empty() {
            return Ok(output.stdout);
        }
        return Err(format!("gpg command failed: {}", stderr));
    }

    Ok(output.stdout)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assuan_percent_encode() {
        assert_eq!(assuan_percent_encode("hello"), "hello");
        assert_eq!(assuan_percent_encode("hello%world"), "hello%25world");
        assert_eq!(assuan_percent_encode("line\none"), "line%0Aone");
    }

    #[test]
    fn test_assuan_percent_decode() {
        assert_eq!(assuan_percent_decode("hello"), b"hello");
        assert_eq!(assuan_percent_decode("hello%25world"), b"hello%world");
        assert_eq!(assuan_percent_decode("line%0Aone"), b"line\none");
    }

    #[test]
    fn test_parse_ok() {
        let resp = parse_assuan_line("OK Pleased to meet you");
        assert!(matches!(resp, Some(AssuanResponse::Ok(ref m)) if m == "Pleased to meet you"));
    }

    #[test]
    fn test_parse_err() {
        let resp = parse_assuan_line("ERR 67108881 Not supported <gpg-agent>");
        let Some(AssuanResponse::Err(code, msg)) = resp else {
            unreachable!("Expected Err response");
        };
        assert_eq!(code, 67108881);
        assert_eq!(msg, "Not supported <gpg-agent>");
    }

    #[test]
    fn test_parse_data() {
        let resp = parse_assuan_line("D Hello%20World");
        let Some(AssuanResponse::Data(d)) = resp else {
            unreachable!("Expected Data response");
        };
        assert_eq!(String::from_utf8_lossy(&d), "Hello World");
    }

    #[test]
    fn test_parse_status() {
        let resp = parse_assuan_line("S PROGRESS learncard k 0 0");
        let Some(AssuanResponse::Status(kw, args)) = resp else {
            unreachable!("Expected Status response");
        };
        assert_eq!(kw, "PROGRESS");
        assert_eq!(args, "learncard k 0 0");
    }

    #[test]
    fn test_parse_inquire() {
        let resp = parse_assuan_line("INQUIRE PINENTRY.PIN");
        let Some(AssuanResponse::Inquire(kw, _)) = resp else {
            unreachable!("Expected Inquire response");
        };
        assert_eq!(kw, "PINENTRY.PIN");
    }

    #[test]
    fn test_parse_comment() {
        let resp = parse_assuan_line("# this is a comment");
        assert!(matches!(resp, Some(AssuanResponse::Comment(_))));
    }

    #[test]
    fn test_parse_multi_line_output() {
        let output = "S SERIALNO D27600012401033000050000XXXX\n\
                       S DISP-NAME Smith<<John\n\
                       OK\n";
        let result = parse_assuan_output(output);
        assert!(result.ok);
        assert_eq!(result.status_lines.len(), 2);
        assert_eq!(
            result.get_status("SERIALNO"),
            Some("D27600012401033000050000XXXX")
        );
    }

    #[test]
    fn test_assuan_result_data() {
        let output = "D line one\nD line two\nOK\n";
        let result = parse_assuan_output(output);
        assert!(result.ok);
        assert_eq!(result.data_lines.len(), 2);
        assert_eq!(result.data_as_string(), "line oneline two");
    }

    #[test]
    fn test_parse_error_output() {
        let output = "ERR 100 some error\n";
        let result = parse_assuan_output(output);
        assert!(!result.ok);
        assert_eq!(result.error_code, 100);
        assert_eq!(result.error_message, "some error");
    }

    #[test]
    fn test_empty_line() {
        assert!(parse_assuan_line("").is_none());
    }

    #[test]
    fn test_assuan_client_new() {
        let client = AssuanClient::new("gpg");
        assert_eq!(client.gpg_binary, "gpg");
        assert!(!client.connected);
    }
}
