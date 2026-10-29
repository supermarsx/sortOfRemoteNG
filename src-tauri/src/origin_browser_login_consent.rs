//! In-memory authorization derived from the saved automatic-login choice and
//! scoped to one immutable browser attempt. There is deliberately no dialog,
//! serialized grant, renderer command, or wall-clock ordering.
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{sync::Mutex, time::Instant};

/// Why a live attempt's grant did not deliver. Fixed codes only: never the
/// origin that was asked about or any page text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConsentRefusal {
    /// The page asked from an origin outside the saved login destinations.
    AddressMismatch,
    /// The grant outlived its bound before this request.
    Expired,
}

struct Grant {
    active: bool,
    expires: Instant,
}

pub(crate) struct AttemptConsent {
    identity: BrowserIdentity,
    origins: Vec<String>,
    auto_submit: bool,
    grant: Mutex<Grant>,
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
            auto_submit,
            grant: Mutex::new(Grant {
                active: true,
                expires,
            }),
        }
    }

    pub(crate) fn revoke(&self) {
        self.grant.lock().unwrap_or_else(|e| e.into_inner()).active = false;
    }

    /// An explicit user retry approves this same attempt again, over the same
    /// saved destinations and submission right. Waits for any delivery in
    /// progress; a grant poisoned by a panicking delivery is never re-armed.
    pub(crate) fn rearm(&self, expires: Instant) -> bool {
        let Ok(mut grant) = self.grant.lock() else {
            return false;
        };
        grant.active = true;
        grant.expires = expires;
        true
    }

    /// The grant stays locked throughout the synchronous borrowed delivery.
    /// Revocation cannot race a new delivery; no IO or awaiting is permitted.
    /// Returns the reason a live, exact-attempt request was refused.
    pub(crate) fn with_current(
        &self,
        identity: &BrowserIdentity,
        origin: &str,
        now: Instant,
        deliver: &mut dyn FnMut(Instant, bool),
    ) -> Option<ConsentRefusal> {
        let Ok(grant) = self.grant.lock() else {
            // A panic during a previous delivery invalidates the grant. Never
            // recover an approving boolean from a poisoned delivery boundary.
            return None;
        };
        if !grant.active || identity != &self.identity {
            return None;
        }
        if !self.origins.iter().any(|candidate| candidate == origin) {
            return Some(ConsentRefusal::AddressMismatch);
        }
        if now >= grant.expires {
            return Some(ConsentRefusal::Expired);
        }
        deliver(grant.expires, self.auto_submit);
        None
    }
}
