//! Direct (non-QuickConnect) reviewed Synology form grants.
//!
//! Every armed HTML document response records its own page nonce as a bounded
//! candidate. Redeeming one requires that document to be the frontend-selected
//! page, so a nested child frame can neither replace, revoke nor redeem it. The
//! password continuation binds to the document selected at username release and
//! dies only on a selected-document change, expiry or attempt revocation. No
//! credential is held here: the session's secret slots stay authoritative.
use crate::themed_auth::fresh_nonce;
use crate::themed_autologin::{SYNOLOGY_FORM_PASSWORD_LIFETIME, SYNOLOGY_FORM_READINESS_LIFETIME};
use std::collections::BTreeMap;
use std::time::Instant;

/// Page grants retained at once. The selected page is never the one evicted.
pub(super) const MAX_CANDIDATE_DOCUMENTS: usize = 8;

struct PageGrant {
    nonce: String,
    issued: Instant,
}

impl PageGrant {
    fn expired(&self) -> bool {
        self.issued.elapsed() >= SYNOLOGY_FORM_READINESS_LIFETIME
    }
}

struct PasswordGrant {
    token: String,
    document: u64,
    issued: Instant,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PasswordRedemption {
    Released,
    /// A wrong token never consumes somebody else's still-valid continuation.
    Refused,
    /// Expiry or a selected-document change permanently ends this attempt.
    Revoked,
}

// No Debug/Serialize: nonces and continuations never belong in diagnostics.
#[derive(Default)]
pub(super) struct DirectSynologyLogin {
    pages: BTreeMap<u64, PageGrant>,
    password: Option<PasswordGrant>,
}

impl DirectSynologyLogin {
    /// Record the page nonce for one armed HTML document response. Repeated
    /// recording for the same document returns its nonce without renewal. A
    /// response for a document older than the selected one gets no grant.
    pub(super) fn record_page(&mut self, document: u64, selected: Option<u64>) -> Option<String> {
        if document == 0 || self.password.is_some() {
            return None;
        }
        self.prune(selected);
        if let Some(page) = self.pages.get(&document) {
            return Some(page.nonce.clone());
        }
        if selected.is_some_and(|selected| document < selected) {
            return None;
        }
        let nonce = fresh_nonce();
        self.pages.insert(
            document,
            PageGrant {
                nonce: nonce.clone(),
                issued: Instant::now(),
            },
        );
        while self.pages.len() > MAX_CANDIDATE_DOCUMENTS {
            let Some(oldest) = self
                .pages
                .keys()
                .copied()
                .find(|candidate| Some(*candidate) != selected)
            else {
                break;
            };
            self.pages.remove(&oldest);
        }
        self.pages.contains_key(&document).then_some(nonce)
    }

    /// Release the account stage for the selected document's own page nonce.
    /// Returns the password continuation token. All other page grants end.
    pub(super) fn release_account(&mut self, selected: u64, nonce: &str) -> Option<String> {
        if nonce.is_empty() || self.password.is_some() {
            return None;
        }
        // Only the selected page's own unexpired nonce redeems. Selection is
        // monotonic, so an older page's nonce can never redeem again.
        if self
            .pages
            .get(&selected)
            .is_none_or(|page| page.expired() || page.nonce != nonce)
        {
            return None;
        }
        self.pages.clear();
        let token = fresh_nonce();
        self.password = Some(PasswordGrant {
            token: token.clone(),
            document: selected,
            issued: Instant::now(),
        });
        Some(token)
    }

    /// `selected` is `None` when no document is selected or the session ended.
    pub(super) fn redeem_password(
        &mut self,
        selected: Option<u64>,
        token: &str,
    ) -> PasswordRedemption {
        let Some(grant) = self.password.as_ref() else {
            return PasswordRedemption::Refused;
        };
        if selected != Some(grant.document)
            || grant.issued.elapsed() >= SYNOLOGY_FORM_PASSWORD_LIFETIME
        {
            self.password = None;
            return PasswordRedemption::Revoked;
        }
        if token.is_empty() || grant.token != token {
            return PasswordRedemption::Refused;
        }
        self.password = None;
        PasswordRedemption::Released
    }

    /// Selection is monotonic: pages older than the selected document can never
    /// be selected again, so their nonces are dead.
    fn prune(&mut self, selected: Option<u64>) {
        self.pages.retain(|document, page| {
            !page.expired() && selected.is_none_or(|selected| *document >= selected)
        });
    }
}

#[cfg(test)]
#[path = "http_synology_direct_login_tests.rs"]
mod tests;
