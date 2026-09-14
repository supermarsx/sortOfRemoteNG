//! One original, explicit Synology form intent. Never a navigation permission.
//! Secrets stay native and separate from HTTP authentication and provider jars.
use super::{
    BasicAuthProxyConfig, DeferredSynologyLoginStatus, SynologyQuickConnectDefaults,
    UpstreamAuthMode,
};
use reqwest::Url;
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

/// Capture to the first verified hop.
pub(super) const INTENT_LIFETIME: Duration = Duration::from_secs(120);
/// Redirect review is human-paced: each verified probe or handoff renews the
/// pending intent to this window, never past `INTENT_CAP` from capture.
pub(super) const INTENT_RENEWAL: Duration = Duration::from_secs(300);
pub(super) const INTENT_CAP: Duration = Duration::from_secs(900);
/// Idle page-readiness window from the latest document bind.
pub(super) const READINESS_LIFETIME: Duration =
    crate::themed_autologin::SYNOLOGY_FORM_READINESS_LIFETIME;
pub(super) const READINESS_CAP: Duration = crate::themed_autologin::SYNOLOGY_FORM_READINESS_CAP;
pub(super) const STAGE_LIFETIME: Duration =
    crate::themed_autologin::SYNOLOGY_FORM_PASSWORD_LIFETIME;
const MAX_VERIFIED_ORIGINS: usize = 16;
/// Candidate page documents retained while no credential is released.
pub(super) const MAX_CANDIDATE_DOCUMENTS: usize = 8;
const UNAVAILABLE: &str = "The saved Synology login attempt is unavailable or expired. Reopen the original connection to try again.";

enum Phase {
    Pending,
    Account {
        // No credential has been released. Readiness idles from the latest
        // bind and never outlives the absolute cap from the first bind.
        session: String,
        /// Latest bound document.
        document: u64,
        /// Page nonce per eligible document. Redemption requires selection.
        candidates: BTreeMap<u64, String>,
        issued: Instant,
        first_bound: Instant,
    },
    Password {
        session: String,
        document: u64,
        nonce: String,
        issued: Instant,
    },
    Spent(DeferredSynologyLoginStatus),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Bind {
    New,
    Existing,
    Refused,
}

/// Time left before a pending intent expires, from its ages.
fn intent_left(since_capture: Duration, since_renewal: Option<Duration>) -> Duration {
    since_renewal
        .map_or(INTENT_LIFETIME.saturating_sub(since_capture), |renewal| {
            INTENT_RENEWAL.saturating_sub(renewal)
        })
        .min(INTENT_CAP.saturating_sub(since_capture))
}

/// Time left before page readiness expires, from its bind ages.
fn readiness_left(since_latest_bind: Duration, since_first_bind: Duration) -> Duration {
    READINESS_LIFETIME
        .saturating_sub(since_latest_bind)
        .min(READINESS_CAP.saturating_sub(since_first_bind))
}

// No Debug/Serialize. Neither grants nor secrets belong in public diagnostics.
pub(super) struct DeferredSynologyLogin {
    username: Option<Zeroizing<String>>,
    password: Option<Zeroizing<String>>,
    created: Instant,
    renewed: Option<Instant>,
    phase: Phase,
    verified_origins: BTreeSet<String>,
}

impl DeferredSynologyLogin {
    #[cfg(test)]
    pub(super) fn age_for_test(&mut self) {
        self.created = Instant::now() - INTENT_LIFETIME;
        self.renewed = None;
    }

    #[cfg(test)]
    pub(super) fn renewed_for_test(&self) -> Option<Instant> {
        self.renewed
    }

    #[cfg(test)]
    pub(super) fn spent_for_test(&self) -> bool {
        matches!(self.phase, Phase::Spent(_)) && self.username.is_none() && self.password.is_none()
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
            renewed: None,
            phase: Phase::Pending,
            verified_origins,
        }))
    }

    /// Time until the current phase expires; `None` once spent. Native timers
    /// use it after every bind or renewal, so an idle grant is erased on time.
    pub(super) fn remaining(&self) -> Option<Duration> {
        match &self.phase {
            Phase::Pending => Some(intent_left(
                self.created.elapsed(),
                self.renewed.map(|renewed| renewed.elapsed()),
            )),
            Phase::Account {
                issued,
                first_bound,
                ..
            } => Some(readiness_left(issued.elapsed(), first_bound.elapsed())),
            Phase::Password { issued, .. } => Some(STAGE_LIFETIME.saturating_sub(issued.elapsed())),
            Phase::Spent(_) => None,
        }
    }

    pub(super) fn expire(&mut self) {
        if self.remaining() == Some(Duration::ZERO) {
            self.spend(DeferredSynologyLoginStatus::Expired);
        }
    }

    fn spend(&mut self, status: DeferredSynologyLoginStatus) {
        self.username = None;
        self.password = None;
        self.verified_origins.clear();
        self.phase = Phase::Spent(status);
    }

    pub(super) fn cancel_issued(&mut self) {
        if matches!(self.phase, Phase::Account { .. } | Phase::Password { .. }) {
            self.spend(DeferredSynologyLoginStatus::Cancelled);
        }
    }

    /// Reading status expires an elapsed grant but never mints or renews one.
    pub(super) fn status(&mut self) -> DeferredSynologyLoginStatus {
        self.expire();
        match self.phase {
            Phase::Pending => DeferredSynologyLoginStatus::AwaitingNas,
            Phase::Account { .. } => DeferredSynologyLoginStatus::WaitingForForm,
            Phase::Password { .. } => DeferredSynologyLoginStatus::WaitingForPassword,
            Phase::Spent(status) => status,
        }
    }

    /// Caller proved a verified login probe. Renews a pending intent; returns
    /// the new time left when renewed.
    pub(super) fn record_probe(&mut self, origin: String) -> Option<Duration> {
        self.expire();
        if !matches!(self.phase, Phase::Pending) {
            return None;
        }
        if !self.verified_origins.contains(&origin) {
            if self.verified_origins.len() >= MAX_VERIFIED_ORIGINS {
                return None;
            }
            self.verified_origins.insert(origin);
        }
        self.renew_intent()
    }

    /// A consumed same-attempt handoff or verified probe. Pending only; never
    /// past `INTENT_CAP` and never reviving an expired intent.
    pub(super) fn renew_intent(&mut self) -> Option<Duration> {
        self.expire();
        if !matches!(self.phase, Phase::Pending) {
            return None;
        }
        self.renewed = Some(Instant::now());
        self.remaining()
    }

    /// The app-marked primary document, selected at response time.
    pub(super) fn bind(&mut self, session: &str, document: u64, target: &Url) -> bool {
        self.bind_document(session, document, target, true, Some(document)) != Bind::Refused
    }

    /// Any other eligible DSM document response while no credential has been
    /// released. Returns the renewed time left when a new candidate was bound.
    pub(super) fn record_successor(
        &mut self,
        session: &str,
        document: u64,
        target: &Url,
        selected: Option<u64>,
    ) -> Option<Duration> {
        match self.bind_document(session, document, target, false, selected) {
            Bind::New => self.remaining(),
            Bind::Existing | Bind::Refused => None,
        }
    }

    fn bind_document(
        &mut self,
        session: &str,
        document: u64,
        target: &Url,
        selected_primary: bool,
        selected: Option<u64>,
    ) -> Bind {
        self.expire();
        if document == 0
            || !matches!(target.path(), "/" | "/webman/index.cgi")
            || !self
                .verified_origins
                .contains(&target.origin().ascii_serialization())
        {
            return Bind::Refused;
        }
        match &mut self.phase {
            Phase::Pending if selected_primary => {
                let now = Instant::now();
                self.phase = Phase::Account {
                    session: session.into(),
                    document,
                    candidates: BTreeMap::from([(document, crate::themed_auth::fresh_nonce())]),
                    issued: now,
                    first_bound: now,
                };
                Bind::New
            }
            Phase::Account {
                session: bound,
                document: latest,
                candidates,
                issued,
                ..
            } if bound == session => {
                // Repeated binding or readiness reads never extend the deadline.
                if candidates.contains_key(&document) {
                    return Bind::Existing;
                }
                if selected.is_some_and(|selected| document < selected) {
                    return Bind::Refused;
                }
                candidates.insert(document, crate::themed_auth::fresh_nonce());
                prune_candidates(candidates, selected);
                if !candidates.contains_key(&document) {
                    return Bind::Refused;
                }
                *latest = (*latest).max(document);
                *issued = Instant::now();
                Bind::New
            }
            Phase::Pending | Phase::Spent(_) => Bind::Refused,
            // A child or a not-yet-selected successor never changes a released
            // username; selection of another document cancels at redemption.
            _ if !selected_primary => Bind::Refused,
            _ => {
                self.spend(DeferredSynologyLoginStatus::Cancelled);
                Bind::Refused
            }
        }
    }

    pub(super) fn nonce(&mut self, session: &str, document: u64) -> Option<String> {
        self.expire();
        match &self.phase {
            Phase::Account {
                session: bound,
                candidates,
                ..
            } if bound == session => candidates.get(&document).cloned(),
            _ => None,
        }
    }

    #[cfg(test)]
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

    /// `selected` is the frontend-selected document, held by the caller's lease.
    pub(super) fn dispense(
        &mut self,
        session: &str,
        selected: u64,
        nonce: &str,
        phase: Option<&str>,
    ) -> Result<serde_json::Value, &'static str> {
        self.expire();
        if nonce.is_empty() {
            return Err(UNAVAILABLE);
        }
        match (&mut self.phase, phase) {
            (
                Phase::Account {
                    session: bound,
                    candidates,
                    ..
                },
                None,
            ) if bound == session => {
                // Only the selected page's own nonce redeems. Selection is
                // monotonic, so an older page's nonce can never redeem again,
                // and a stale or wrong request never cancels the successor.
                if candidates.get(&selected).map(String::as_str) != Some(nonce) {
                    return Err(UNAVAILABLE);
                }
                let username = self.username.take().ok_or(UNAVAILABLE)?;
                let next = crate::themed_auth::fresh_nonce();
                self.phase = Phase::Password {
                    session: session.into(),
                    document: selected,
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
                    document,
                    nonce: expected,
                    ..
                },
                Some("password"),
            ) if bound == session => {
                if *document != selected {
                    // After username release a document change always cancels.
                    self.spend(DeferredSynologyLoginStatus::Cancelled);
                    return Err(UNAVAILABLE);
                }
                if expected != nonce {
                    return Err(UNAVAILABLE);
                }
                let password = self.password.take().ok_or(UNAVAILABLE)?;
                self.spend(DeferredSynologyLoginStatus::CredentialsReleased);
                Ok(serde_json::json!({"loginFlow":"synology", "password":&**password}))
            }
            _ => Err(UNAVAILABLE),
        }
    }
}

/// Drop superseded pages, then the oldest unselected pages beyond the bound.
fn prune_candidates(candidates: &mut BTreeMap<u64, String>, selected: Option<u64>) {
    if let Some(selected) = selected {
        candidates.retain(|document, _| *document >= selected);
    }
    while candidates.len() > MAX_CANDIDATE_DOCUMENTS {
        let Some(oldest) = candidates
            .keys()
            .copied()
            .find(|document| Some(*document) != selected)
        else {
            break;
        };
        candidates.remove(&oldest);
    }
}

#[cfg(test)]
#[path = "http_synology_login_tests.rs"]
mod tests;
