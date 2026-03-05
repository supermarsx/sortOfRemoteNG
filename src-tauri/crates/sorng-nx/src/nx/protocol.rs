//! NX wire protocol messages and negotiation.
//!
//! The NX protocol uses a text-based SSH-tunnelled negotiation (NX/3.x),
//! followed by binary nxproxy traffic.

use serde::{Deserialize, Serialize};

// ── NX SSH negotiation messages ─────────────────────────────────────────────

/// NX server greeting (sent after SSH channel open).
pub const NX_GREETING: &str = "HELLO NXSERVER - Version";

/// Client hello response.
pub const NX_HELLO: &str = "hello NXCLIENT - Version";

/// NX status codes.
pub mod status {
    pub const NX_OK: u16 = 100;
    pub const NX_AUTH_PROMPT: u16 = 101;
    pub const NX_PASSWORD_PROMPT: u16 = 102;
    pub const NX_WELCOME: u16 = 103;
    pub const NX_SESSION_LIST: u16 = 104;
    pub const NX_SESSION_ID: u16 = 105;
    pub const NX_SESSION_DISPLAY: u16 = 110;
    pub const NX_SESSION_COOKIE: u16 = 111;
    pub const NX_SESSION_PROXY: u16 = 112;
    pub const NX_SESSION_PARAMS: u16 = 113;
    pub const NX_SESSION_STATUS: u16 = 114;
    pub const NX_BYE: u16 = 999;
    pub const NX_ERROR_AUTH: u16 = 404;
    pub const NX_ERROR_SESSION: u16 = 500;
    pub const NX_ERROR_GENERAL: u16 = 599;
}

/// Parsed NX server response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxResponse {
    pub code: u16,
    pub message: String,
    pub parameters: Vec<(String, String)>,
}

impl NxResponse {
    /// Parse a line like "NX> 105 session_id: 12345"
    pub fn parse(line: &str) -> Option<Self> {
        let line = line.trim();
        let rest = line.strip_prefix("NX> ")?;

        let (code_str, message) = rest.split_once(' ')?;
        let code: u16 = code_str.parse().ok()?;

        let mut parameters = Vec::new();
        // Parse key: value pairs after the first space
        if let Some((_, params)) = message.split_once(": ") {
            for pair in params.split(", ") {
                if let Some((k, v)) = pair.split_once('=') {
                    parameters.push((k.trim().to_string(), v.trim().to_string()));
                }
            }
        }

        Some(Self {
            code,
            message: message.to_string(),
            parameters,
        })
    }

    pub fn is_ok(&self) -> bool {
        self.code == status::NX_OK
    }

    pub fn is_error(&self) -> bool {
        self.code >= 400
    }

    pub fn get_param(&self, key: &str) -> Option<&str> {
        self.parameters
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

// ── NX Client Commands ──────────────────────────────────────────────────────

/// NX client command builder.
#[derive(Debug)]
pub struct NxCommand {
    parts: Vec<String>,
}

impl NxCommand {
    pub fn new(verb: &str) -> Self {
        Self { parts: vec![verb.to_string()] }
    }

    pub fn param(mut self, key: &str, value: &str) -> Self {
        self.parts.push(format!("--{}={}", key, value));
        self
    }

    pub fn flag(mut self, key: &str) -> Self {
        self.parts.push(format!("--{}", key));
        self
    }

    /// Build the command line to send.
    pub fn build(&self) -> String {
        self.parts.join(" ")
    }

    // ── Pre-built commands ──────────────────────────────────────────────

    pub fn hello(version: &str) -> String {
        format!("{} {}", NX_HELLO, version)
    }

    pub fn login(username: &str) -> String {
        format!("login\n{}", username)
    }

    pub fn password_cmd(password: &str) -> String {
        password.to_string()
    }

    /// List available sessions for resume.
    pub fn list_sessions() -> String {
        "listsession --type=unix-desktop --status=suspended".to_string()
    }

    /// Start a new session.
    pub fn start_session(
        session_type: &str,
        geometry: &str,
        link: &str,
        cache_size: &str,
    ) -> String {
        NxCommand::new("startsession")
            .param("type", session_type)
            .param("geometry", geometry)
            .param("link", link)
            .param("cache", cache_size)
            .build()
    }

    /// Resume a suspended session.
    pub fn resume_session(session_id: &str) -> String {
        NxCommand::new("restoresession")
            .param("id", session_id)
            .build()
    }

    /// Terminate a session.
    pub fn terminate_session(session_id: &str) -> String {
        NxCommand::new("terminate")
            .param("sessionid", session_id)
            .build()
    }

    /// Disconnect (suspend) the current session.
    pub fn disconnect() -> String {
        "disconnect".to_string()
    }

    /// Goodbye.
    pub fn bye() -> String {
        "bye".to_string()
    }
}

// ── NX proxy parameters ─────────────────────────────────────────────────────

/// Parameters used to launch nxproxy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxProxyParams {
    pub session_id: String,
    pub cookie: String,
    pub proxy_host: String,
    pub proxy_port: u16,
    pub display: u32,
    pub link: String,
    pub cache_size: String,
    pub geometry: String,
    pub compression: String,
    pub keyboard_layout: String,
}

impl NxProxyParams {
    /// Build the nxproxy command-line arguments.
    pub fn to_args(&self) -> Vec<String> {
        vec![
            "-S".to_string(),
            format!(
                "nx/nx,session={},cookie={},link={},cache={},geometry={},keyboard={}:{}",
                self.session_id,
                self.cookie,
                self.link,
                self.cache_size,
                self.geometry,
                self.keyboard_layout,
                self.display,
            ),
        ]
    }
}

// ── Session list parsing ────────────────────────────────────────────────────

use crate::nx::types::ResumableSession;

/// Parse the NX session list output.
///
/// Typical format (pipe-separated):
/// ```text
/// Display Type             Session ID                       Options  Depth Screen         Status      Session Name
/// ------- ---------------- -------------------------------- -------- ----- -------------- ----------- --------
/// 1001    unix-kde         A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4                24    1024x768       Suspended
/// ```
pub fn parse_session_list(text: &str) -> Vec<ResumableSession> {
    let mut sessions = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Display") || line.starts_with("---") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 6 { continue; }

        let display: u32 = match parts[0].parse() {
            Ok(d) => d,
            Err(_) => continue,
        };

        sessions.push(ResumableSession {
            display,
            session_type: parts[1].to_string(),
            session_id: parts[2].to_string(),
            state: parts.last().unwrap_or(&"unknown").to_string(),
            created_at: String::new(),
            user: String::new(),
            geometry: if parts.len() > 5 { parts[5].to_string() } else { String::new() },
        });
    }

    sessions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_nx_response() {
        let resp = NxResponse::parse("NX> 105 session_id: id=abc123, display=1001");
        assert!(resp.is_some());
        let resp = resp.unwrap();
        assert_eq!(resp.code, 105);
    }

    #[test]
    fn nx_response_error() {
        let resp = NxResponse::parse("NX> 404 authentication failed").unwrap();
        assert!(resp.is_error());
        assert!(!resp.is_ok());
    }

    #[test]
    fn command_builder() {
        let cmd = NxCommand::new("startsession")
            .param("type", "unix-gnome")
            .param("geometry", "1920x1080")
            .build();
        assert!(cmd.contains("--type=unix-gnome"));
        assert!(cmd.contains("--geometry=1920x1080"));
    }

    #[test]
    fn hello_command() {
        let hello = NxCommand::hello("3.5.0");
        assert!(hello.starts_with("hello NXCLIENT"));
    }

    #[test]
    fn proxy_params_args() {
        let params = NxProxyParams {
            session_id: "ABCD1234".into(),
            cookie: "deadbeef".into(),
            proxy_host: "localhost".into(),
            proxy_port: 4000,
            display: 1001,
            link: "adsl".into(),
            cache_size: "8M".into(),
            geometry: "1024x768".into(),
            compression: "adaptive".into(),
            keyboard_layout: "us".into(),
        };
        let args = params.to_args();
        assert_eq!(args.len(), 2);
        assert!(args[1].contains("session=ABCD1234"));
        assert!(args[1].contains(":1001"));
    }

    #[test]
    fn parse_session_list_basic() {
        let text = "\
Display Type             Session ID                       Options  Depth Screen         Status
------- ---------------- -------------------------------- -------- ----- -------------- -----------
1001    unix-kde         A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4        24    1024x768       Suspended
1002    unix-gnome       B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4A1        24    1920x1080      Running
";
        let sessions = parse_session_list(text);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].display, 1001);
        assert_eq!(sessions[1].session_type, "unix-gnome");
    }

    #[test]
    fn start_session_cmd() {
        let cmd = NxCommand::start_session("unix-gnome", "1920x1080", "adsl", "8M");
        assert!(cmd.starts_with("startsession"));
        assert!(cmd.contains("--type=unix-gnome"));
    }
}
