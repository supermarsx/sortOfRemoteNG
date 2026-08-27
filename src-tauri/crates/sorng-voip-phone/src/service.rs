//! Session registry: one authenticated phone session per session id.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::error::{VoipPhoneError, VoipPhoneResult};
use crate::types::*;
use crate::vendor::{build_http, driver_for, PhoneHttp, VendorDriver};

/// Shared Tauri state handle.
pub type VoipPhoneServiceState = Arc<Mutex<VoipPhoneService>>;

pub struct PhoneSession {
    config: VoipPhoneConnectionConfig,
    http: PhoneHttp,
    driver: Box<dyn VendorDriver>,
    generation: VoipPhoneGeneration,
    auth_shape: VoipPhoneAuthShape,
}

impl PhoneSession {
    fn summary(&self, id: &str) -> VoipPhoneSessionSummary {
        VoipPhoneSessionSummary {
            id: id.to_string(),
            host: self.config.host.clone(),
            vendor: self.config.vendor,
            generation: self.generation,
            auth_shape: self.auth_shape,
            web_ui_url: self.driver.web_ui_url(&self.http, self.generation),
        }
    }
}

#[derive(Default)]
pub struct VoipPhoneService {
    sessions: HashMap<String, PhoneSession>,
}

impl VoipPhoneService {
    pub fn new() -> Self {
        Self::default()
    }

    fn session(&self, id: &str) -> VoipPhoneResult<&PhoneSession> {
        self.sessions
            .get(id)
            .ok_or_else(|| VoipPhoneError::not_connected(id))
    }

    /// Detect the generation only — no credentials are sent.
    pub async fn probe(
        &self,
        config: VoipPhoneConnectionConfig,
    ) -> VoipPhoneResult<VoipPhoneProbeResult> {
        let http = build_http(&config)?;
        let driver = driver_for(config.vendor);
        let generation = driver.detect(&http).await?;
        Ok(VoipPhoneProbeResult {
            vendor: config.vendor,
            generation,
            web_ui_url: driver.web_ui_url(&http, generation),
            expected_auth_shape: driver.expected_auth_shape(generation),
        })
    }

    /// Detect + login. Replaces any existing session with the same id
    /// (the old one, including its password, is dropped).
    pub async fn connect(
        &mut self,
        id: String,
        config: VoipPhoneConnectionConfig,
    ) -> VoipPhoneResult<VoipPhoneSessionSummary> {
        self.sessions.remove(&id);
        let http = build_http(&config)?;
        let driver = driver_for(config.vendor);
        let generation = driver.detect(&http).await?;
        log::debug!(
            "voip-phone {id}: detected generation {}",
            generation.as_str()
        );
        let auth_shape = driver.login(&http, generation).await?;
        log::debug!("voip-phone {id}: logged in via {}", auth_shape.as_str());
        let session = PhoneSession {
            config,
            http,
            driver,
            generation,
            auth_shape,
        };
        let summary = session.summary(&id);
        self.sessions.insert(id, session);
        Ok(summary)
    }

    /// Drop the whole session (client, cookies, credentials). Best-effort
    /// server-side logout for the servlet generation.
    pub async fn disconnect(&mut self, id: &str) -> VoipPhoneResult<()> {
        let session = self
            .sessions
            .remove(id)
            .ok_or_else(|| VoipPhoneError::not_connected(id))?;
        let _ = session
            .driver
            .logout(&session.http, session.generation)
            .await;
        Ok(())
    }

    pub fn list(&self) -> Vec<VoipPhoneSessionSummary> {
        let mut out: Vec<_> = self.sessions.iter().map(|(id, s)| s.summary(id)).collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    pub fn get_config_safe(&self, id: &str) -> VoipPhoneResult<VoipPhoneConfigSafe> {
        Ok(VoipPhoneConfigSafe::from(&self.session(id)?.config))
    }

    pub fn summary(&self, id: &str) -> VoipPhoneResult<VoipPhoneSessionSummary> {
        Ok(self.session(id)?.summary(id))
    }

    pub async fn status(&self, id: &str) -> VoipPhoneResult<VoipPhoneStatus> {
        let s = self.session(id)?;
        s.driver.status(&s.http, s.generation, s.auth_shape).await
    }

    pub async fn reboot(&self, id: &str) -> VoipPhoneResult<VoipRebootResult> {
        let s = self.session(id)?;
        s.driver.reboot(&s.http, s.generation).await
    }

    pub fn web_login_hint(&self, id: &str) -> VoipPhoneResult<WebLoginHint> {
        let s = self.session(id)?;
        Ok(s.driver.web_login_hint(&s.http, s.generation))
    }
}
