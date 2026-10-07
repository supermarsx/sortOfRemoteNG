//! Actual-handshake admission for the patched CEF engine. No renderer verdict,
//! URL inspection request, or error-only callback can authorize a certificate.
use super::Attempt;
use sorng_browser_host::cef_tls_bridge::{
    self, NativeTlsCompletion, NativeTlsDecision, NativeTlsEvidence, NativeTlsHooks,
};
use sorng_commands_core::origin_browser_authority::{
    NativeCertificateAuthority, NativeCertificateDecision, NativeCertificateEvidence,
    NativeCertificatePermit, NativeCertificateReview,
};
use sorng_encryption::EncryptionState;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

const ALLOW_ONCE: &str = "Allow this connection";
const REMEMBER: &str = "Trust and remember";
const CANCEL: &str = "Cancel";
const REVIEW_TIMEOUT: Duration = Duration::from_secs(90);

pub(super) struct CertificateHooks {
    attempt: Weak<Attempt>,
    authority: Arc<NativeCertificateAuthority>,
    window: WebviewWindow,
}

impl CertificateHooks {
    pub(super) fn new(
        attempt: &Arc<Attempt>,
        authority: Arc<NativeCertificateAuthority>,
        window: WebviewWindow,
    ) -> Arc<Self> {
        Arc::new(Self {
            attempt: Arc::downgrade(attempt),
            authority,
            window,
        })
    }
}

impl NativeTlsHooks for CertificateHooks {
    fn is_current(&self) -> bool {
        self.attempt
            .upgrade()
            .is_some_and(|attempt| attempt.current())
    }

    fn on_failure(&self) {
        if let Some(attempt) = self.attempt.upgrade() {
            attempt.revoke();
        }
    }

    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion) {
        let Some(attempt) = self.attempt.upgrade().filter(|attempt| attempt.current()) else {
            return; // Dropping the single-use completion queues denial.
        };
        // Do not even create TOFU records for a native failure the engine cannot
        // override (revocation, fatal/HSTS, CT, weak keys, malformed evidence).
        let Some(decision) = admissible_native_result(
            evidence.native_error,
            evidence.fatal_error,
            evidence.allowed_exception_mask,
        ) else {
            return;
        };
        let authority = self.authority.clone();
        let window = self.window.clone();
        tauri::async_runtime::spawn(async move {
            let state = window.state::<EncryptionState>();
            if attempt.lease.recheck(&window, &state).await.is_err() {
                return;
            }
            let origin = evidence.origin;
            let chain = evidence.peer_chain;
            let verdict = authority
                .evaluate(NativeCertificateEvidence {
                    identity: attempt.identity.clone(),
                    origin: origin.clone(),
                    chain_der: chain.clone(),
                    system_ca_valid: evidence.native_error == 0 && evidence.issued_by_known_root,
                })
                .await;
            let permit = match verdict {
                Ok(NativeCertificateDecision::Allow(permit)) => Some(permit),
                Ok(NativeCertificateDecision::Review(review)) => {
                    review_certificate(&window, &state, &attempt, *review).await
                }
                _ => None,
            };
            let Some(permit) = permit else {
                return;
            };
            if attempt.lease.recheck(&window, &state).await.is_err() {
                return;
            }
            // Recheck the exact native chain/owner/expiry on CEF UI immediately
            // before draining the completion. A delayed UI cannot use an
            // expired permit merely because async work previously approved it.
            let _ = window.run_on_main_thread(move || {
                if attempt.current() && permit.permits(&attempt.identity, &origin, &chain) {
                    completion.complete(decision);
                } else {
                    completion.complete(NativeTlsDecision::Deny);
                }
                if cef_tls_bridge::pump_tls().is_err() {
                    attempt.revoke();
                }
            });
        });
    }
}

fn admissible_native_result(error: i32, fatal: bool, mask: u32) -> Option<NativeTlsDecision> {
    if fatal {
        return None;
    }
    match (error, mask) {
        (0, 0) => Some(NativeTlsDecision::AdmitNative),
        (error, mask) if error < 0 && mask != 0 && mask & !7 == 0 => {
            Some(NativeTlsDecision::AdmitException { mask })
        }
        _ => None,
    }
}

// Bound OS dialogs per owning window. The callback owns its slot until the
// actual dialog closes, including after timeout/cancellation of its waiter.
struct PromptSlot(String);
fn prompt_slots() -> &'static Mutex<HashSet<String>> {
    static SLOTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SLOTS.get_or_init(Mutex::default)
}
impl PromptSlot {
    fn reserve(window: &WebviewWindow) -> Option<Self> {
        prompt_slots()
            .lock()
            .ok()?
            .insert(window.label().to_owned())
            .then(|| Self(window.label().to_owned()))
    }
}
impl Drop for PromptSlot {
    fn drop(&mut self) {
        prompt_slots()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}

fn review_choice(result: MessageDialogResult) -> Option<bool> {
    match result {
        MessageDialogResult::Yes => Some(false),
        MessageDialogResult::No => Some(true),
        MessageDialogResult::Custom(label) if label == ALLOW_ONCE => Some(false),
        MessageDialogResult::Custom(label) if label == REMEMBER => Some(true),
        _ => None,
    }
}

async fn review_certificate(
    window: &WebviewWindow,
    state: &EncryptionState,
    attempt: &Arc<Attempt>,
    review: NativeCertificateReview,
) -> Option<NativeCertificatePermit> {
    if !attempt.current() {
        return None;
    }
    let slot = PromptSlot::reserve(window)?;
    let message = format!(
        "{}\n\nWebsite: {}\nCertificate SHA-256: {}\n\nOnly approve this certificate if you trust this destination. Allow this connection does not modify the trust store. Trust and remember saves this exact certificate only in the owning database. No browser-wide exception is created.",
        review.reason(), review.origin(), review.fingerprint(),
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let parent = window.clone();
    let pending = attempt.clone();
    window
        .run_on_main_thread(move || {
            if sender.is_closed() || !pending.current() {
                return;
            }
            parent
                .dialog()
                .message(message)
                .title("Review website certificate")
                .parent(&parent)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::YesNoCancelCustom(
                    ALLOW_ONCE.into(),
                    REMEMBER.into(),
                    CANCEL.into(),
                ))
                .show_with_result(move |result| {
                    let _slot = slot;
                    let _ = sender.send(review_choice(result));
                });
        })
        .ok()?;
    let remember = tokio::time::timeout(REVIEW_TIMEOUT, receiver)
        .await
        .ok()?
        .ok()??;
    if !attempt.current() {
        return None;
    }
    // The review consumes its exact native evidence and rechecks both the
    // owning database and the trust-store baseline before any persistence.
    review.approve(window, state, remember).await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_success_and_exact_scoped_exceptions_are_distinct() {
        assert_eq!(
            admissible_native_result(0, false, 0),
            Some(NativeTlsDecision::AdmitNative)
        );
        for mask in 1..=7 {
            assert_eq!(
                admissible_native_result(-202, false, mask),
                Some(NativeTlsDecision::AdmitException { mask })
            );
        }
        for (error, fatal, mask) in [
            (0, true, 0),
            (-202, true, 4),
            (-202, false, 0),
            (-202, false, 8),
            (0, false, 4),
            (1, false, 0),
        ] {
            assert_eq!(admissible_native_result(error, fatal, mask), None);
        }
    }

    #[test]
    fn only_explicit_native_review_buttons_allow_or_persist_trust() {
        assert_eq!(review_choice(MessageDialogResult::Yes), Some(false));
        assert_eq!(review_choice(MessageDialogResult::No), Some(true));
        assert_eq!(
            review_choice(MessageDialogResult::Custom(ALLOW_ONCE.into())),
            Some(false)
        );
        assert_eq!(
            review_choice(MessageDialogResult::Custom(REMEMBER.into())),
            Some(true)
        );
        for result in [
            MessageDialogResult::Cancel,
            MessageDialogResult::Ok,
            MessageDialogResult::Custom("yes".into()),
            MessageDialogResult::Custom(CANCEL.into()),
        ] {
            assert_eq!(review_choice(result), None);
        }
    }
}
