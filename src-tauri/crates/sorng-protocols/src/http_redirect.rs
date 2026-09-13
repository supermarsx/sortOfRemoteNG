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
    /// Returned only on consumption, never placed in website HTML/logs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation_id: Option<String>,
}

pub(super) struct PendingRedirect {
    review: ProxyRedirectReview,
    defaults_context: Option<super::SynologyQuickConnectDefaults>,
    sequence: Arc<AtomicU64>,
    created: Instant,
    state: std::sync::Weak<AxumProxyState>,
    http_cycle_edge: Option<super::attempt::HttpRedirectEdge>,
    // Vendor navigation belongs to the selected successful primary root, not
    // the numerically previous request (which may be a nested frame).
    http_cycle_primary: Option<u64>,
    suppress_referrer: bool,
    source_document: Option<u64>,
}
impl PendingRedirect {
    fn current(&self) -> bool {
        self.created.elapsed() < Duration::from_secs(120)
            && self.sequence.load(Ordering::SeqCst) == self.review.document_sequence
            && self.source_document.is_none_or(|sequence| {
                self.state
                    .upgrade()
                    .is_some_and(|state| state.network.document_is_current(sequence))
            })
            && self.http_cycle_primary.is_none_or(|sequence| {
                self.state.upgrade().is_some_and(|state| {
                    state.network.document_is_current(sequence)
                        && state.attempt.as_ref().is_some_and(|attempt| {
                            attempt.root_document_sequence() == Some(sequence)
                        })
                })
            })
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

#[cfg(test)]
pub(super) fn record(
    state: &Arc<AxumProxyState>,
    destination: &reqwest::Url,
    document_sequence: u64,
    navigation_token: Option<String>,
) -> bool {
    record_with_edge(
        state,
        destination,
        document_sequence,
        navigation_token,
        None,
    )
}

pub(super) fn record_vendor(
    state: &Arc<AxumProxyState>,
    destination: &reqwest::Url,
    document_sequence: u64,
    navigation_token: Option<String>,
    headers: &axum::http::HeaderMap,
) -> bool {
    let Some(source_document) = state.network.selected_document_sequence() else {
        return false;
    };
    let suppress_referrer =
        !super::quickconnect_control::request_has_local_referrer(headers, &state.proxy_origin)
            .unwrap_or(false);
    // This entry point is the verified vendor navigation adapter, not an HTTP
    // response. It can upgrade/finish a previously observed HTTP circuit, never
    // arm it. The provider also performs the HTTP-to-HTTPS alias upgrade in JS.
    let primary = state
        .attempt
        .as_ref()
        .and_then(|attempt| attempt.root_document_sequence())
        .filter(|sequence| state.network.document_is_current(*sequence));
    let edge = state
        .attempt
        .as_ref()
        .filter(|_| cycle_context_is_anonymous(state))
        .filter(|_| primary.is_some())
        .filter(|_| !headers.contains_key("authorization"))
        .filter(|_| {
            let referers: Vec<_> = headers.get_all("referer").iter().collect();
            match referers.as_slice() {
                [] => true, // Native successful-root evidence is still mandatory.
                [value] => value
                    .to_str()
                    .ok()
                    .and_then(|value| reqwest::Url::parse(value).ok())
                    .is_some_and(|url| {
                        let path = match url.query() {
                            Some(query) => format!("{}?{query}", url.path()),
                            None => url.path().into(),
                        };
                        url.origin().ascii_serialization() == state.proxy_origin
                            && url.username().is_empty()
                            && url.password().is_none()
                            && url.fragment().is_none()
                            && super::proxy_response::navigation_request(&path).0 == "/"
                    }),
                _ => false,
            }
        })
        .and_then(|attempt| {
            reqwest::Url::parse(&format!("{}/", state.target_origin))
                .ok()
                .and_then(|source| attempt.http_redirect_edge(&source, destination))
        })
        .filter(|edge| {
            matches!(
                edge,
                super::attempt::HttpRedirectEdge::AliasUpgrade
                    | super::attempt::HttpRedirectEdge::RegionalReturn(_)
            )
        });
    let http_cycle_primary = edge.as_ref().and(primary);
    record_evidence(
        state,
        destination,
        document_sequence,
        navigation_token,
        edge,
        http_cycle_primary,
        ReferrerEvidence {
            suppress: suppress_referrer,
            source_document: Some(source_document),
        },
    )
}

pub(super) fn cycle_context_is_anonymous(state: &AxumProxyState) -> bool {
    matches!(
        state.upstream_auth_mode,
        super::UpstreamAuthMode::None | super::UpstreamAuthMode::Basic
    ) && !state.auto_login_armed.load(Ordering::SeqCst)
        && state.username.read().is_ok_and(|value| value.is_empty())
        && state.password.read().is_ok_and(|value| value.is_empty())
        && state.custom_headers.is_empty()
        && state.proxy_policy.query_parameters.is_empty()
}

#[cfg(test)]
pub(super) fn record_with_edge(
    state: &Arc<AxumProxyState>,
    destination: &reqwest::Url,
    document_sequence: u64,
    navigation_token: Option<String>,
    http_cycle_edge: Option<super::attempt::HttpRedirectEdge>,
) -> bool {
    record_with_edge_and_referrer(
        state,
        destination,
        document_sequence,
        navigation_token,
        http_cycle_edge,
        false,
    )
}

pub(super) fn record_with_edge_and_referrer(
    state: &Arc<AxumProxyState>,
    destination: &reqwest::Url,
    document_sequence: u64,
    navigation_token: Option<String>,
    http_cycle_edge: Option<super::attempt::HttpRedirectEdge>,
    suppress_referrer: bool,
) -> bool {
    // An initial 3xx has an issued navigation sequence but no successful
    // source document. It may still transfer, without creating a referrer.
    let source_document = state.network.selected_referrer_document_sequence();
    record_evidence(
        state,
        destination,
        document_sequence,
        navigation_token,
        http_cycle_edge,
        None,
        ReferrerEvidence {
            suppress: suppress_referrer || source_document.is_none(),
            source_document,
        },
    )
}

struct ReferrerEvidence {
    suppress: bool,
    source_document: Option<u64>,
}

fn record_evidence(
    state: &Arc<AxumProxyState>,
    destination: &reqwest::Url,
    document_sequence: u64,
    navigation_token: Option<String>,
    http_cycle_edge: Option<super::attempt::HttpRedirectEdge>,
    http_cycle_primary: Option<u64>,
    referrer: ReferrerEvidence,
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
                continuation_id: None,
            },
            defaults_context: state.proxy_policy.synology_quick_connect_defaults.clone(),
            sequence: state.document_sequence.clone(),
            created: Instant::now(),
            state: Arc::downgrade(state),
            http_cycle_edge,
            http_cycle_primary,
            suppress_referrer: referrer.suppress,
            source_document: referrer.source_document,
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
            if state.attempt.as_ref().is_some_and(|attempt| {
                attempt.http_redirect_cycle_blocked(pending.http_cycle_edge.as_ref())
            }) {
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
            let mut review = pending.review;
            if let Some(attempt) = &state.attempt {
                let destination = reqwest::Url::parse(&review.destination_url).ok()?;
                if pending
                    .defaults_context
                    .as_ref()
                    .is_some_and(|defaults| defaults.permits(&review.source_origin, &destination))
                {
                    review.continuation_id = Some(
                        self.attempts
                            .prepare_transfer_with_referrer_suppressed(
                                attempt,
                                &destination,
                                &review.receipt_id,
                                pending.suppress_referrer,
                                pending.source_document,
                            )
                            .ok()?,
                    );
                    attempt.consume_http_redirect(pending.http_cycle_edge.as_ref());
                }
            }
            return Some(review);
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
                continuation_id: None,
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
            http_cycle_edge: None,
            http_cycle_primary: None,
            suppress_referrer: false,
            source_document: None,
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
