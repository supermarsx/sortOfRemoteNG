// ── Session handle ────────────────────────────────────────────────────────────
//
// Per-connection state. Credentials are kept in memory for the duration
// of the session so subsequent command invocations can re-authenticate
// against smbclient / the Windows redirector as needed.

use super::types::*;
use chrono::Utc;

#[derive(Debug, Clone)]
pub struct SmbSession {
    pub id: String,
    pub config: SmbConnectionConfig,
    pub info: SmbSessionInfo,
}

impl SmbSession {
    pub fn new(id: String, config: SmbConnectionConfig, backend: &'static str) -> Self {
        let now = Utc::now();
        let info = SmbSessionInfo {
            id: id.clone(),
            host: config.host.clone(),
            port: config.port,
            domain: config.domain.clone(),
            username: config.username.clone(),
            share: config.share.clone(),
            connected: true,
            label: config.label.clone(),
            connected_at: now,
            last_activity: now,
            backend: backend.to_string(),
        };
        Self { id, config, info }
    }

    pub fn touch(&mut self) {
        self.info.last_activity = Utc::now();
    }
}
