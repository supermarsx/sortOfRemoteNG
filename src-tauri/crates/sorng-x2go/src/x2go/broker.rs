//! X2Go session broker support.
//!
//! X2Go brokers provide centralized session management. Clients can query the
//! broker via HTTP(S) to obtain session profiles and pre-selected servers,
//! enabling load-balanced or policy-driven connections.

use serde::{Deserialize, Serialize};

use crate::x2go::types::*;

// ── Broker types ────────────────────────────────────────────────────────────

/// Broker authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BrokerAuth {
    /// No authentication
    None,
    /// HTTP Basic authentication
    Basic { username: String, password: String },
    /// Cookie-based authentication (e.g., SSO)
    Cookie { name: String, value: String },
    /// Kerberos negotiate
    Kerberos,
}

/// Broker session profile (returned by the broker).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerProfile {
    /// Profile ID
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Target host
    pub host: String,
    /// SSH port
    pub ssh_port: u16,
    /// Username
    pub username: Option<String>,
    /// Session type
    pub session_type: String,
    /// Command to run
    pub command: Option<String>,
    /// Desktop geometry
    pub geometry: Option<String>,
    /// Color depth
    pub color_depth: Option<u8>,
    /// Link quality / compression
    pub link: Option<String>,
    /// Sound enabled
    pub sound: Option<bool>,
    /// Printing enabled
    pub printing: Option<bool>,
    /// Root-less mode
    pub rootless: Option<bool>,
    /// Additional key-value parameters
    pub extra: std::collections::HashMap<String, String>,
}

/// Broker response listing all available profiles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerListResponse {
    pub profiles: Vec<BrokerProfile>,
    pub server_version: Option<String>,
    pub message: Option<String>,
}

/// A selected session assignment from the broker (after choosing a profile).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerSessionAssignment {
    pub profile_id: String,
    pub host: String,
    pub ssh_port: u16,
    pub session_id: Option<String>,
    pub auth_token: Option<String>,
}

// ── Broker client ───────────────────────────────────────────────────────────

/// X2Go broker client.
pub struct X2goBrokerClient {
    pub url: String,
    pub auth: BrokerAuth,
    pub verify_tls: bool,
}

impl X2goBrokerClient {
    pub fn new(url: String, auth: BrokerAuth) -> Self {
        Self {
            url,
            auth,
            verify_tls: true,
        }
    }

    /// Build the URL for listing profiles.
    pub fn list_profiles_url(&self) -> String {
        format!("{}/profiles/list", self.url.trim_end_matches('/'))
    }

    /// Build the URL for selecting a profile.
    pub fn select_profile_url(&self, profile_id: &str) -> String {
        format!(
            "{}/profiles/select/{}",
            self.url.trim_end_matches('/'),
            profile_id
        )
    }

    /// Parse broker list response (INI-style format used by X2Go broker).
    pub fn parse_profile_list(response_body: &str) -> Result<Vec<BrokerProfile>, X2goError> {
        let mut profiles = Vec::new();
        let mut current_id = String::new();
        let mut current: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        for line in response_body.lines() {
            let line = line.trim();

            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if line.starts_with('[') && line.ends_with(']') {
                // Save previous profile
                if !current_id.is_empty() {
                    profiles.push(Self::build_profile(&current_id, &current));
                }
                current_id = line[1..line.len() - 1].to_string();
                current.clear();
                continue;
            }

            if let Some((key, value)) = line.split_once('=') {
                current.insert(key.trim().to_string(), value.trim().to_string());
            }
        }

        // Flush last
        if !current_id.is_empty() {
            profiles.push(Self::build_profile(&current_id, &current));
        }

        Ok(profiles)
    }

    fn build_profile(
        id: &str,
        params: &std::collections::HashMap<String, String>,
    ) -> BrokerProfile {
        let get = |key: &str| params.get(key).cloned();
        let get_bool = |key: &str| params.get(key).map(|v| v == "true" || v == "1");
        let get_u8 = |key: &str| params.get(key).and_then(|v| v.parse().ok());
        let get_u16 = |key: &str| params.get(key).and_then(|v| v.parse::<u16>().ok());

        let mut extra = params.clone();
        for known in &[
            "name",
            "host",
            "sshport",
            "user",
            "session_type",
            "command",
            "geometry",
            "colordepth",
            "link",
            "sound",
            "printing",
            "rootless",
        ] {
            extra.remove(*known);
        }

        BrokerProfile {
            id: id.to_string(),
            name: get("name").unwrap_or_else(|| id.to_string()),
            host: get("host").unwrap_or_default(),
            ssh_port: get_u16("sshport").unwrap_or(22),
            username: get("user"),
            session_type: get("session_type").unwrap_or_else(|| "K".into()),
            command: get("command"),
            geometry: get("geometry"),
            color_depth: get_u8("colordepth"),
            link: get("link"),
            sound: get_bool("sound"),
            printing: get_bool("printing"),
            rootless: get_bool("rootless"),
            extra,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broker_urls() {
        let client =
            X2goBrokerClient::new("https://broker.example.com/x2go".into(), BrokerAuth::None);
        assert_eq!(
            client.list_profiles_url(),
            "https://broker.example.com/x2go/profiles/list"
        );
        assert_eq!(
            client.select_profile_url("office"),
            "https://broker.example.com/x2go/profiles/select/office"
        );
    }

    #[test]
    fn parse_ini_profiles() {
        let body = r#"
[office]
name = Office Desktop
host = server1.example.com
sshport = 22
session_type = X
colordepth = 24
sound = true

[dev]
name = Dev Server
host = dev.example.com
sshport = 2222
session_type = K
rootless = true
command = /usr/bin/xterm
"#;

        let profiles = X2goBrokerClient::parse_profile_list(body).unwrap();
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].id, "office");
        assert_eq!(profiles[0].host, "server1.example.com");
        assert_eq!(profiles[0].color_depth, Some(24));
        assert_eq!(profiles[0].sound, Some(true));

        assert_eq!(profiles[1].id, "dev");
        assert_eq!(profiles[1].ssh_port, 2222);
        assert_eq!(profiles[1].rootless, Some(true));
    }

    #[test]
    fn empty_broker_response() {
        let profiles = X2goBrokerClient::parse_profile_list("").unwrap();
        assert!(profiles.is_empty());
    }

    #[test]
    fn broker_auth_variants() {
        let _ = BrokerAuth::None;
        let _ = BrokerAuth::Basic {
            username: "admin".into(),
            password: "secret".into(),
        };
        let _ = BrokerAuth::Cookie {
            name: "session".into(),
            value: "abc123".into(),
        };
        let _ = BrokerAuth::Kerberos;
    }
}
