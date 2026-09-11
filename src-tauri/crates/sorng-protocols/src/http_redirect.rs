//! Native-issued, short-lived navigation receipts. Never follows a foreign URL.
use super::{AxumProxyState, HttpProxyPolicy, ProxySessionManager};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRedirectReview {
    pub receipt_id: String,
    pub session_id: String,
    pub source_origin: String,
    pub destination_url: String,
    pub navigation_token: Option<String>,
    pub document_sequence: u64,
    pub removed_query: bool,
}

pub(super) struct PendingRedirect {
    review: ProxyRedirectReview,
    defaults_context: Option<super::SynologyQuickConnectDefaults>,
    sequence: Arc<AtomicU64>,
    created: Instant,
    state: std::sync::Weak<AxumProxyState>,
}
impl PendingRedirect {
    fn current(&self) -> bool {
        self.created.elapsed() < Duration::from_secs(120)
            && self.sequence.load(Ordering::SeqCst) == self.review.document_sequence
    }
}

fn destination_allowed(
    policy: &HttpProxyPolicy,
    source_origin: &str,
    destination: &reqwest::Url,
) -> bool {
    let downgrade = source_origin.starts_with("https:") && destination.scheme() == "http";
    let defaults = policy.synology_quick_connect_defaults.as_ref();
    let valid_context = defaults.is_none_or(|scope| {
        reqwest::Url::parse(source_origin).is_ok_and(|source| scope.validate(&source).is_ok())
    });
    let explicit = policy.allow_cross_origin_redirects
        && (!downgrade || policy.allow_http_downgrade_redirects);
    let default_destination =
        defaults.is_some_and(|scope| scope.permits(source_origin, destination));
    valid_context
        && (explicit || default_destination)
        && matches!(destination.scheme(), "http" | "https")
        && (!policy.https_only || destination.scheme() == "https")
        && destination.origin().ascii_serialization() != source_origin
        && destination.username().is_empty()
        && destination.password().is_none()
        && destination.port() != Some(0)
        && destination.as_str().len() <= 4096
}

pub(super) fn record(
    state: &Arc<AxumProxyState>,
    destination: &reqwest::Url,
    document_sequence: u64,
    navigation_token: Option<String>,
) -> bool {
    if !destination_allowed(&state.proxy_policy, &state.target_origin, destination)
        || document_sequence == 0
        || state.document_sequence.load(Ordering::SeqCst) != document_sequence
    {
        return false;
    }
    let mut clean = destination.clone();
    let removed_query = clean.query().is_some() || clean.fragment().is_some();
    clean.set_query(None);
    clean.set_fragment(None);
    let Ok(mut manager) = state.global_sessions.lock() else {
        return false;
    };
    manager
        .redirect_reviews
        .retain(|_, pending| pending.current());
    if manager.redirect_reviews.len() >= 256 {
        return false;
    }
    manager.redirect_reviews.insert(
        state.session_id.clone(),
        PendingRedirect {
            review: ProxyRedirectReview {
                receipt_id: uuid::Uuid::new_v4().to_string(),
                session_id: state.session_id.clone(),
                source_origin: state.target_origin.clone(),
                destination_url: clean.into(),
                navigation_token,
                document_sequence,
                removed_query,
            },
            defaults_context: state.proxy_policy.synology_quick_connect_defaults.clone(),
            sequence: state.document_sequence.clone(),
            created: Instant::now(),
            state: Arc::downgrade(state),
        },
    );
    true
}

impl ProxySessionManager {
    pub fn discard_redirect_review(&mut self, session_id: &str) {
        self.redirect_reviews.remove(session_id);
    }
    pub fn clear_redirect_reviews(&mut self) {
        self.redirect_reviews.clear();
    }
    /// Peek or atomically consume only the current receipt. A forged page message
    /// cannot choose a destination, and navigation/stop/expiry invalidates it.
    pub fn review_redirect(
        &mut self,
        session_id: &str,
        receipt_id: Option<&str>,
    ) -> Option<ProxyRedirectReview> {
        let live = self
            .sessions
            .get(session_id)
            .zip(self.redirect_reviews.get(session_id))
            .is_some_and(|(entry, pending)| {
                entry.target_origin == pending.review.source_origin
                    && entry.proxy_policy.synology_quick_connect_defaults
                        == pending.defaults_context
                    && reqwest::Url::parse(&pending.review.destination_url).is_ok_and(
                        |destination| {
                            destination_allowed(
                                &entry.proxy_policy,
                                &entry.target_origin,
                                &destination,
                            )
                        },
                    )
            });
        if !live
            || !self
                .redirect_reviews
                .get(session_id)
                .is_some_and(PendingRedirect::current)
        {
            self.redirect_reviews.remove(session_id);
            return None;
        }
        let pending = self.redirect_reviews.get(session_id)?;
        if let Some(receipt_id) = receipt_id {
            if pending.review.receipt_id != receipt_id {
                return None;
            }
            let pending = self.redirect_reviews.remove(session_id)?;
            let state = pending.state.upgrade()?;
            let mut continuation = state.bitwarden_continuation.lock().ok()?;
            // Serialize with any staged credential grant. No old document may
            // redeem a pending grant after the user accepts this handoff.
            if !pending.current() {
                return None;
            }
            state.document_sequence.fetch_add(1, Ordering::SeqCst);
            state.auto_login_armed.store(false, Ordering::SeqCst);
            if let Ok(mut nonce) = state.auto_login_nonce.write() {
                *nonce = None;
            }
            if let Ok(mut nonce) = state.pending_nonce.write() {
                *nonce = None;
            }
            *continuation = None;
            return Some(pending.review);
        }
        Some(pending.review.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redirect_receipt_ttl_and_sequence_are_both_required() {
        let sequence = Arc::new(AtomicU64::new(1));
        let mut pending = PendingRedirect {
            review: ProxyRedirectReview {
                receipt_id: "fixture".into(),
                session_id: "s".into(),
                source_origin: "https://source.invalid".into(),
                destination_url: "https://target.invalid/".into(),
                navigation_token: None,
                document_sequence: 1,
                removed_query: false,
            },
            defaults_context: None,
            sequence: sequence.clone(),
            created: Instant::now(),
            state: std::sync::Weak::new(),
        };
        assert!(pending.current());
        sequence.store(2, Ordering::SeqCst);
        assert!(!pending.current());
        sequence.store(1, Ordering::SeqCst);
        pending.created = Instant::now() - Duration::from_secs(121);
        assert!(!pending.current());
    }
    #[test]
    fn missing_redirect_opt_in_is_off_and_malformed_policy_is_rejected() {
        let mut legacy = serde_json::to_value(super::super::HttpProxyPolicy::default()).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("allowCrossOriginRedirects");
        let decoded: super::super::HttpProxyPolicy =
            serde_json::from_value(legacy.clone()).unwrap();
        assert!(!decoded.allow_cross_origin_redirects);
        assert!(!decoded.allow_http_downgrade_redirects);
        legacy["allowCrossOriginRedirects"] = serde_json::json!("true");
        assert!(serde_json::from_value::<super::super::HttpProxyPolicy>(legacy).is_err());
    }

    #[test]
    fn downgrade_opt_in_defaults_off_and_requires_a_strict_boolean() {
        let mut legacy = serde_json::to_value(HttpProxyPolicy::default()).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("allowHttpDowngradeRedirects");
        assert!(
            !serde_json::from_value::<HttpProxyPolicy>(legacy.clone())
                .unwrap()
                .allow_http_downgrade_redirects
        );
        for invalid in [
            serde_json::json!("true"),
            serde_json::json!(1),
            serde_json::Value::Null,
        ] {
            legacy["allowHttpDowngradeRedirects"] = invalid;
            assert!(serde_json::from_value::<HttpProxyPolicy>(legacy.clone()).is_err());
        }
        legacy["allowHttpDowngradeRedirects"] = serde_json::json!(true);
        assert!(
            serde_json::from_value::<HttpProxyPolicy>(legacy)
                .unwrap()
                .allow_http_downgrade_redirects
        );
    }
}
