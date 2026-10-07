//! In-memory native consent, scoped to one immutable browser attempt. There is
//! deliberately no serialized grant, renderer command, or wall-clock ordering.
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{sync::Mutex, time::Instant};

pub(crate) struct AttemptConsent {
    identity: BrowserIdentity,
    origins: Vec<String>,
    expires: Instant,
    auto_submit: bool,
    active: Mutex<bool>,
}

impl AttemptConsent {
    pub(crate) fn approved(
        identity: BrowserIdentity,
        origins: Vec<String>,
        expires: Instant,
        auto_submit: bool,
    ) -> Self {
        Self {
            identity,
            origins,
            expires,
            auto_submit,
            active: Mutex::new(true),
        }
    }

    pub(crate) fn revoke(&self) {
        *self.active.lock().unwrap_or_else(|e| e.into_inner()) = false;
    }

    /// The grant stays locked throughout the synchronous borrowed delivery.
    /// Revocation cannot race a new delivery; no IO or awaiting is permitted.
    pub(crate) fn with_current(
        &self,
        identity: &BrowserIdentity,
        origin: &str,
        now: Instant,
        deliver: &mut dyn FnMut(Instant, bool),
    ) {
        let Ok(active) = self.active.lock() else {
            // A panic during a previous delivery invalidates the grant. Never
            // recover an approving boolean from a poisoned delivery boundary.
            return;
        };
        if *active
            && identity == &self.identity
            && now < self.expires
            && self.origins.iter().any(|candidate| candidate == origin)
        {
            deliver(self.expires, self.auto_submit);
        }
    }
}
