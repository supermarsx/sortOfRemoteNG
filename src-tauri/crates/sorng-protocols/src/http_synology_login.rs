//! One original, explicit Synology form intent. Never a navigation permission.
//! Secrets stay native and separate from HTTP authentication and provider jars.
use super::{BasicAuthProxyConfig, SynologyQuickConnectDefaults, UpstreamAuthMode};
use reqwest::Url;
use std::collections::BTreeSet;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub(super) const INTENT_LIFETIME: Duration = Duration::from_secs(120);
pub(super) const READINESS_LIFETIME: Duration =
    crate::themed_autologin::SYNOLOGY_FORM_READINESS_LIFETIME;
pub(super) const STAGE_LIFETIME: Duration = Duration::from_secs(30);
const MAX_VERIFIED_ORIGINS: usize = 16;
const UNAVAILABLE: &str = "The saved Synology login attempt is unavailable or expired. Reopen the original connection to try again.";

enum Phase {
    Pending,
    Account {
        // No credential has been released. This is a fixed page/form-readiness
        // window, distinct from the password transition after account dispense.
        session: String,
        document: u64,
        nonce: String,
        issued: Instant,
    },
    Password {
        session: String,
        document: u64,
        nonce: String,
        issued: Instant,
    },
    Spent,
}

// No Debug/Serialize. Neither grants nor secrets belong in public diagnostics.
pub(super) struct DeferredSynologyLogin {
    username: Option<Zeroizing<String>>,
    password: Option<Zeroizing<String>>,
    created: Instant,
    phase: Phase,
    verified_origins: BTreeSet<String>,
}

impl DeferredSynologyLogin {
    #[cfg(test)]
    pub(super) fn age_for_test(&mut self) {
        self.created = Instant::now() - INTENT_LIFETIME;
    }

    #[cfg(test)]
    pub(super) fn spent_for_test(&self) -> bool {
        matches!(self.phase, Phase::Spent) && self.username.is_none() && self.password.is_none()
    }

    pub(super) fn capture(
        config: &BasicAuthProxyConfig,
        defaults: &SynologyQuickConnectDefaults,
        target: &Url,
    ) -> Result<Option<Self>, String> {
        if config.upstream_auth_mode != UpstreamAuthMode::SynologyForm || !config.http_auto_login {
            return Ok(None);
        }
        if config.continuation_id.is_some()
            || defaults.nas_alias().is_none()
            || target.origin().ascii_serialization() != defaults.original_origin
            || config.username.is_empty()
            || config.password.is_empty()
            || config.username.len() > 16 * 1024
            || config.password.len() > 16 * 1024
        {
            return Err("Saved QuickConnect form login requires the original selected NAS and bounded nonempty credentials.".into());
        }
        crate::themed_autologin::validate_reviewed_login_config(config)?;
        let mut verified_origins = BTreeSet::new();
        // An explicitly selected NAS endpoint is already the user's target.
        // Alias and provider portals are deliberately not NAS endpoints.
        if defaults.permits_nas_origin(target) {
            verified_origins.insert(target.origin().ascii_serialization());
        }
        Ok(Some(Self {
            username: Some(Zeroizing::new(config.username.clone())),
            password: Some(Zeroizing::new(config.password.clone())),
            created: Instant::now(),
            phase: Phase::Pending,
            verified_origins,
        }))
    }

    pub(super) fn expire(&mut self) {
        let expired = match &self.phase {
            Phase::Pending => self.created.elapsed() >= INTENT_LIFETIME,
            Phase::Account { issued, .. } => issued.elapsed() >= READINESS_LIFETIME,
            Phase::Password { issued, .. } => issued.elapsed() >= STAGE_LIFETIME,
            Phase::Spent => false,
        };
        if expired {
            self.spend();
        }
    }

    fn spend(&mut self) {
        self.username = None;
        self.password = None;
        self.verified_origins.clear();
        self.phase = Phase::Spent;
    }

    pub(super) fn cancel_issued(&mut self) {
        if !matches!(self.phase, Phase::Pending) {
            self.spend();
        }
    }

    pub(super) fn record_probe(&mut self, origin: String) {
        self.expire();
        if matches!(self.phase, Phase::Pending)
            && self.verified_origins.len() < MAX_VERIFIED_ORIGINS
        {
            self.verified_origins.insert(origin);
        }
    }

    pub(super) fn bind(&mut self, session: &str, document: u64, target: &Url) -> bool {
        self.expire();
        if document == 0
            || !matches!(target.path(), "/" | "/webman/index.cgi")
            || !self
                .verified_origins
                .contains(&target.origin().ascii_serialization())
        {
            return false;
        }
        match &self.phase {
            Phase::Pending => {
                self.phase = Phase::Account {
                    session: session.into(),
                    document,
                    nonce: crate::themed_auth::fresh_nonce(),
                    issued: Instant::now(),
                };
                true
            }
            Phase::Account {
                session: bound,
                document: sequence,
                ..
            } if bound == session && *sequence == document => true,
            Phase::Spent => false,
            _ => {
                self.spend();
                false
            }
        }
    }

    pub(super) fn nonce(&mut self, session: &str, document: u64) -> Option<String> {
        self.expire();
        match &self.phase {
            Phase::Account {
                session: bound,
                document: sequence,
                nonce,
                ..
            } if bound == session && *sequence == document => Some(nonce.clone()),
            _ => None,
        }
    }

    pub(super) fn document(&mut self, session: &str) -> Option<u64> {
        self.expire();
        match &self.phase {
            Phase::Account {
                session: bound,
                document,
                ..
            }
            | Phase::Password {
                session: bound,
                document,
                ..
            } if bound == session => Some(*document),
            _ => None,
        }
    }

    pub(super) fn dispense(
        &mut self,
        session: &str,
        document: u64,
        nonce: &str,
        phase: Option<&str>,
    ) -> Result<serde_json::Value, &'static str> {
        self.expire();
        if nonce.is_empty() {
            return Err(UNAVAILABLE);
        }
        match (&self.phase, phase) {
            (
                Phase::Account {
                    session: bound,
                    document: sequence,
                    nonce: expected,
                    ..
                },
                None,
            ) if bound == session && *sequence == document && expected == nonce => {
                let username = self.username.take().ok_or(UNAVAILABLE)?;
                let next = crate::themed_auth::fresh_nonce();
                self.phase = Phase::Password {
                    session: session.into(),
                    document,
                    nonce: next.clone(),
                    issued: Instant::now(),
                };
                Ok(
                    serde_json::json!({"loginFlow":"synology", "username":&**username, "continuation":next}),
                )
            }
            (
                Phase::Password {
                    session: bound,
                    document: sequence,
                    nonce: expected,
                    ..
                },
                Some("password"),
            ) if bound == session && *sequence == document && expected == nonce => {
                let password = self.password.take().ok_or(UNAVAILABLE)?;
                self.spend();
                Ok(serde_json::json!({"loginFlow":"synology", "password":&**password}))
            }
            _ => Err(UNAVAILABLE),
        }
    }
}

#[cfg(test)]
#[path = "http_synology_login_tests.rs"]
mod tests;
