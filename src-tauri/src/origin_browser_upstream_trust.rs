//! t-mitmproxy: the app's upstream trust decision for an intercepting attempt.
//!
//! Today's CEF `on_evidence` body moved behind `UpstreamTrust`: the proxy's
//! own upstream handshake supplies the chain exactly as sent (the same bytes
//! Chromium reported as `peer_chain`) and the OS CA validity; the decision is
//! the unchanged `NativeCertificateAuthority::evaluate` (policy, Trust Center
//! records scoped `connection-scope/<conn>/<host>/<port>`, temporary pins),
//! the unchanged `review_certificate` prompt and the exact-chain permit.
//! Existing TOFU/pin records made under CEF therefore keep matching.
//!
//! Fail closed: unbound or stale attempt, owner recheck failure, any
//! authority error, a denied or expired review, or a permit that does not
//! match the exact chain all deny. Nothing here logs hosts or certificates.
//!
//! The decision runs detached from the proxy request: when the request ends
//! first (the page or the engine gave up and a 502 or nothing was served), a
//! review the user approves afterwards reloads the attempt's main frame, so
//! the approval takes effect without the user retrying by hand.

use super::super::Attempt;
use super::diagnostics::{self, Navigation};
use super::owner_rechecks::Coalesced;
use super::review_certificate;
use crate::origin_browser_observability::UpstreamVerdictDiagnostic;
use sorng_commands_core::origin_browser_authority::{
    NativeCertificateAuthority, NativeCertificateDecision, NativeCertificateEvidence,
};
use sorng_encryption::EncryptionState;
use sorng_protocols::origin_browser::BrowserIdentity;
use sorng_protocols::private_forward_proxy::intercept::{
    UpstreamEvidence, UpstreamTrust, UpstreamTrustFuture, UpstreamVerdict,
};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewWindow};

/// Mirrors the certificate review prompt timeout
/// (`origin_browser_certificate_review.rs`): a review that ended without a
/// decision after this long is reported as a timeout, not a denial.
const REVIEW_TIMEOUT: Duration = Duration::from_secs(90);

pub(in super::super) struct AppUpstreamTrust {
    attempt: OnceLock<Weak<Attempt>>,
    authority: Arc<NativeCertificateAuthority>,
    window: WebviewWindow,
    owner_rechecks: Arc<Coalesced>,
}

impl AppUpstreamTrust {
    /// The session (and so the proxy) starts before its `Attempt` exists:
    /// create unbound, then `bind` once the attempt is built. Unbound denies.
    /// One adapter per attempt, so its coalesced owner rechecks are per
    /// attempt too (at most one in flight, shared only with earlier callers).
    pub(in super::super) fn new(
        authority: Arc<NativeCertificateAuthority>,
        window: WebviewWindow,
    ) -> Arc<Self> {
        Arc::new(Self {
            attempt: OnceLock::new(),
            authority,
            window,
            owner_rechecks: Arc::default(),
        })
    }

    /// Binds the owning attempt exactly once.
    pub(in super::super) fn bind(&self, attempt: &Arc<Attempt>) -> bool {
        self.attempt.set(Arc::downgrade(attempt)).is_ok()
    }
}

impl UpstreamTrust for AppUpstreamTrust {
    fn evaluate(&self, e: UpstreamEvidence) -> UpstreamTrustFuture {
        let Some(attempt) = self
            .attempt
            .get()
            .and_then(Weak::upgrade)
            .filter(|attempt| attempt.current())
        else {
            return Box::pin(async { UpstreamVerdict::Deny });
        };
        let authority = self.authority.clone();
        let window = self.window.clone();
        let rechecks = self.owner_rechecks.clone();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let owner = attempt.clone();
        let reload_window = window.clone();
        tauri::async_runtime::spawn(async move {
            let (verdict, reviewed) = decide(attempt, authority, window, rechecks, e).await;
            owner.engine_observations.observe_upstream(match verdict {
                UpstreamVerdict::Admit { .. } => UpstreamVerdictDiagnostic::Admitted,
                UpstreamVerdict::Deny => UpstreamVerdictDiagnostic::Denied,
                UpstreamVerdict::Timeout => UpstreamVerdictDiagnostic::Timeout,
            });
            let delivered = sender.send(verdict).is_ok();
            if late_approval(delivered, reviewed, verdict) && owner.current() {
                super::super::reload_after_late_approval(reload_window, owner);
            }
        });
        Box::pin(async move { receiver.await.unwrap_or(UpstreamVerdict::Deny) })
    }
}

/// A review the user approved after the proxy request that asked for it had
/// already ended: reload the main frame so the page retries.
pub(super) fn late_approval(delivered: bool, reviewed: bool, verdict: UpstreamVerdict) -> bool {
    !delivered && reviewed && matches!(verdict, UpstreamVerdict::Admit { .. })
}

/// The decision itself; also reports whether a review prompt was shown.
async fn decide(
    attempt: Arc<Attempt>,
    authority: Arc<NativeCertificateAuthority>,
    window: WebviewWindow,
    rechecks: Arc<Coalesced>,
    e: UpstreamEvidence,
) -> (UpstreamVerdict, bool) {
    let state = window.state::<EncryptionState>();
    if !rechecks
        .recheck(|| async { attempt.lease.recheck(&window, &state).await.is_ok() })
        .await
    {
        return (UpstreamVerdict::Deny, false);
    }
    let Some(evidence) = upstream_certificate_evidence(attempt.identity.clone(), &e) else {
        return (UpstreamVerdict::Deny, false);
    };
    let origin = evidence.origin.clone();
    let chain = evidence.chain_der.clone();
    let started = Instant::now();
    let (permit, reviewed) = match authority.evaluate(evidence).await {
        Ok(NativeCertificateDecision::Allow(permit)) => {
            diagnostics::navigation(Navigation::TlsAllow);
            (Some(permit), false)
        }
        Ok(NativeCertificateDecision::Review(review)) => {
            diagnostics::navigation(Navigation::TlsReview);
            (
                review_certificate(&window, &state, &attempt, *review).await,
                true,
            )
        }
        _ => {
            diagnostics::navigation(Navigation::TlsDenied);
            (None, false)
        }
    };
    let Some(permit) = permit else {
        return (review_outcome(reviewed, started.elapsed()), reviewed);
    };
    if !rechecks
        .recheck(|| async { attempt.lease.recheck(&window, &state).await.is_ok() })
        .await
    {
        return (UpstreamVerdict::Deny, reviewed);
    }
    // Same exact-chain/owner/expiry check the CEF path runs on the UI
    // thread before completing the handshake.
    if !(attempt.current() && permit.permits(&attempt.identity, &origin, &chain)) {
        return (UpstreamVerdict::Deny, reviewed);
    }
    (
        admitted(attempt.lease.is_temporary(), reviewed, e.temporary_ok),
        reviewed,
    )
}

/// The authority's evidence for a proxy-verified handshake: same identity,
/// same canonical origin string as the bridge builds from the CONNECT host,
/// the chain exactly as sent, and the OS CA validity.
pub(super) fn upstream_certificate_evidence(
    identity: BrowserIdentity,
    evidence: &UpstreamEvidence,
) -> Option<NativeCertificateEvidence> {
    let origin = url::Url::parse(&format!("https://{}", evidence.authority))
        .ok()?
        .origin()
        .ascii_serialization();
    Some(NativeCertificateEvidence {
        identity,
        origin,
        chain_der: evidence.chain_der.clone(),
        system_ca_valid: evidence.system_ca_valid,
    })
}

/// A permitted connection. Persistent (disk-cacheable) only for a saved
/// connection admitted without a prompt: the review API does not say whether
/// the user chose "allow once" or "remember", so every reviewed admission is
/// treated as temporary for this connection. Later connections that match
/// the remembered record are admitted without review and are persistent.
fn admitted(temporary_lease: bool, reviewed: bool, temporary_ok: bool) -> UpstreamVerdict {
    let persistent = !temporary_lease && !reviewed;
    if !persistent && !temporary_ok {
        return UpstreamVerdict::Deny;
    }
    UpstreamVerdict::Admit { persistent }
}

fn review_outcome(reviewed: bool, elapsed: Duration) -> UpstreamVerdict {
    if reviewed && elapsed >= REVIEW_TIMEOUT {
        UpstreamVerdict::Timeout
    } else {
        UpstreamVerdict::Deny
    }
}

#[cfg(test)]
#[path = "origin_browser_upstream_trust_tests.rs"]
pub(super) mod tests;
