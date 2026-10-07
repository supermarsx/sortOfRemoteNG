//! Native certificate admission. Invoke on the async handshake path for EVERY
//! certificate, including CA-valid certificates. Never invoke from renderer IPC.
//! CEF error callbacks alone are not sufficient to enforce pins.
use super::*;
use sorng_storage::trust_store::{
    CertIdentity, Identity, TrustPolicy, TrustStoreService, TrustVerifyResult,
};

/// Evidence observed by the native host on this exact handshake. Native CA
/// validity must include hostname, validity, signature and chain verification.
/// DER capture/parsing, renderer assertions and prior navigation are not proof.
pub struct NativeCertificateEvidence {
    pub identity: BrowserIdentity,
    pub origin: String,
    pub chain_der: Vec<Vec<u8>>,
    pub system_ca_valid: bool,
}

pub enum NativeCertificateDecision {
    Allow(NativeCertificatePermit),
    Deny,
    Review(Box<NativeCertificateReview>),
}

/// Native-only, single-review object; cannot be cloned or deserialized. Main
/// owns presentation and may call approve only after explicit OS-owned consent.
pub struct NativeCertificateReview {
    service: TrustStoreService,
    identity: Identity,
    host: String,
    origin: String,
    browser: BrowserIdentity,
    lease: NativeOwnerLease,
    expires: Instant,
    reason: &'static str,
}
impl NativeCertificateReview {
    pub fn origin(&self) -> &str {
        &self.origin
    }
    pub fn fingerprint(&self) -> &str {
        match &self.identity {
            Identity::Tls(cert) => &cert.fingerprint,
            _ => unreachable!(),
        }
    }
    pub fn reason(&self) -> &'static str {
        self.reason
    }

    /// Consumes the exact native review; rechecks saved owner/dependencies and
    /// the trust-store baseline. Remember writes only its bound owning DB.
    pub async fn approve<R: Runtime>(
        mut self,
        window: &WebviewWindow<R>,
        state: &EncryptionState,
        remember: bool,
    ) -> Result<NativeCertificatePermit, NativeAuthorityError> {
        self.lease
            .recheck(window, state)
            .await
            .map_err(|_| NativeAuthorityError::OwnerUnavailable)?;
        if Instant::now() >= self.expires {
            return Err(NativeAuthorityError::CertificatePolicyUnsupported);
        }
        // Scoped service rejects drift against the original review baseline.
        self.service
            .reload_from_disk()
            .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
        if remember {
            self.service
                .trust_identity(
                    self.host.clone(),
                    "https".into(),
                    self.identity.clone(),
                    true,
                )
                .await
                .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
        }
        if !self.lease.is_current() || Instant::now() >= self.expires {
            return Err(NativeAuthorityError::OwnerUnavailable);
        }
        Ok(permit(
            self.browser,
            self.origin,
            &self.identity,
            self.lease,
        ))
    }
}

/// Short-lived exact-handshake permit. Host must compare the actual certificate
/// against this fingerprint before releasing bytes; it is not an origin wildcard.
pub struct NativeCertificatePermit {
    browser: BrowserIdentity,
    origin: String,
    fingerprint: String,
    chain_fingerprints: Vec<String>,
    lease: NativeOwnerLease,
    expires: Instant,
}
impl NativeCertificatePermit {
    pub fn permits(&self, browser: &BrowserIdentity, origin: &str, chain_der: &[Vec<u8>]) -> bool {
        use sha2::Digest;
        self.browser == *browser
            && self.origin == origin
            && self.lease.is_current()
            && Instant::now() < self.expires
            && !chain_der.is_empty()
            && chain_der.len() <= 32
            && chain_der
                .iter()
                .all(|der| !der.is_empty() && der.len() <= 256 * 1024)
            && self.fingerprint == hex::encode(sha2::Sha256::digest(&chain_der[0]))
            && self.chain_fingerprints
                == chain_der
                    .iter()
                    .map(|der| hex::encode(sha2::Sha256::digest(der)))
                    .collect::<Vec<_>>()
    }
}

pub struct NativeCertificateAuthority {
    browser: BrowserIdentity,
    allowed_origins: Vec<String>,
    policy: TrustPolicy,
    system_ca: bool,
    lease: NativeOwnerLease,
}

pub(super) fn saved_policy(
    connection: &Value,
    settings: &Value,
) -> Result<TrustPolicy, NativeAuthorityError> {
    let selected = [
        connection.get("httpsTrustPolicy"),
        settings.get("httpsTrustPolicy"),
        settings.get("trustPolicy"),
        connection
            .get("tlsTrustPolicy")
            .or_else(|| settings.get("tlsTrustPolicy")),
    ]
    .into_iter()
    .flatten()
    .find(|value| *value != "inherit");
    let policy: TrustPolicy = serde_json::from_value(
        selected
            .cloned()
            .unwrap_or(Value::String("always-ask".into())),
    )
    .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
    // Never implement "always-trust" by disabling the browser verifier.
    if !matches!(
        policy,
        TrustPolicy::Strict
            | TrustPolicy::Tofu
            | TrustPolicy::AlwaysAsk
            | TrustPolicy::CertificatePinning
            | TrustPolicy::CaTrustOnly
    ) {
        return Err(NativeAuthorityError::CertificatePolicyUnsupported);
    }
    Ok(policy)
}

impl NativeCertificateAuthority {
    pub(super) fn new(
        connection: &Value,
        settings: &Value,
        policy: &OriginBrowserPolicy,
        lease: &NativeOwnerLease,
    ) -> Result<Self, NativeAuthorityError> {
        Ok(Self {
            browser: policy.identity().clone(),
            allowed_origins: policy.allowed_origins().to_vec(),
            policy: saved_policy(connection, settings)?,
            system_ca: settings
                .get("httpsCaTrustMode")
                .and_then(Value::as_str)
                .unwrap_or("system")
                == "system",
            lease: lease.clone(),
        })
    }

    /// Async worker path only: may read/write encrypted trust storage. Native
    /// callers must pause the actual handshake while evaluating/reviewing.
    pub async fn evaluate(
        &self,
        evidence: NativeCertificateEvidence,
    ) -> Result<NativeCertificateDecision, NativeAuthorityError> {
        let error = NativeAuthorityError::CertificatePolicyUnsupported;
        if evidence.identity != self.browser
            || !self.lease.is_current()
            || !self.allowed_origins.contains(&evidence.origin)
            || canonical_website_permission_origin(&evidence.origin).as_deref()
                != Ok(evidence.origin.as_str())
        {
            return Ok(NativeCertificateDecision::Deny);
        }
        let captured = sorng_protocols::http::capture_peer_certificate_chain(&evidence.chain_der)
            .map_err(|_| error)?;
        if captured.chain.is_empty()
            || captured
                .chain
                .iter()
                .any(|cert| cert.details.parse_error.is_some())
        {
            return Err(error);
        }
        let mut value = serde_json::to_value(&captured).map_err(|_| error)?;
        let now = chrono::Utc::now().to_rfc3339();
        value["first_seen"] = now.clone().into();
        value["last_seen"] = now.into();
        value["chain_fingerprints"] = captured
            .chain
            .iter()
            .map(|entry| Value::String(entry.fingerprint.clone()))
            .collect::<Vec<_>>()
            .into();
        let identity = Identity::Tls(Box::new(
            serde_json::from_value::<CertIdentity>(value).map_err(|_| error)?,
        ));
        let origin = Url::parse(&evidence.origin).map_err(|_| error)?;
        let host = format!(
            "{}{}/{}/{}",
            sorng_storage::trust_store::CONNECTION_SCOPE_PREFIX,
            encode(self.browser.connection_id()),
            encode(origin.host_str().ok_or(error)?),
            origin.port_or_known_default().ok_or(error)?
        );
        let shared = TrustStoreService::shared();
        let mut service = shared
            .lock()
            .await
            .scoped_to_database(Some(self.browser.owner_database_id().into()))
            .map_err(|_| error)?;
        service.reload_from_disk().map_err(|_| error)?;
        let existing = service
            .get_effective_stored_identity(&host, "https")
            .map_err(|_| error)?;
        let effective = existing
            .as_ref()
            .and_then(|record| record.host_policy.clone())
            .unwrap_or(service.get_trust_policy().await);
        let system_ca_valid = evidence.system_ca_valid && self.system_ca;
        // Resolve policy, pins and fresh-approval gates and consume actual
        // handshake evidence under the trust store's single database lease.
        let (result, ca_first_use) = service
            .verify_https_with_ca(
                &host,
                identity.clone(),
                self.policy.clone(),
                system_ca_valid,
                |certificate_host, port, fingerprint| {
                    if Some(certificate_host) == origin.host_str()
                        && Some(port) == origin.port_or_known_default()
                        && fingerprint == captured.fingerprint
                    {
                        Ok(())
                    } else {
                        Err("Native certificate evidence does not match this handshake".into())
                    }
                },
            )
            .map_err(|_| error)?;
        // The atomic verifier updates the backend, not the service snapshot.
        // Refresh before any subsequent remember/review write; scoped baseline
        // checks still reject intervening external changes.
        service.reload_from_disk().map_err(|_| error)?;
        let mut decision = combined_action(
            &result,
            &effective,
            &self.policy,
            system_ca_valid,
            ca_first_use,
        );
        if effective == TrustPolicy::CertificatePinning
            || self.policy == TrustPolicy::CertificatePinning
        {
            if let Some(record) = &existing {
                match (&record.identity, &identity) {
                    (Identity::Tls(stored), Identity::Tls(presented))
                        if stored.chain_fingerprints == presented.chain_fingerprints
                            && !stored.chain_fingerprints.is_empty() => {}
                    _ => decision = Action::Deny,
                }
            }
        }
        let invalid_end = captured
            .valid_to
            .as_ref()
            .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
            .is_none_or(|date| date <= chrono::Utc::now());
        let invalid_start = captured
            .valid_from
            .as_ref()
            .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
            .is_none_or(|date| date > chrono::Utc::now());
        if matches!(decision, Action::Remember) && (invalid_start || invalid_end) {
            decision =
                Action::Review("The certificate is expired or has invalid validity metadata");
        }
        if !self.lease.is_current() {
            return Err(NativeAuthorityError::OwnerUnavailable);
        }
        match decision {
            Action::Deny => Ok(NativeCertificateDecision::Deny),
            Action::Allow => Ok(NativeCertificateDecision::Allow(permit(
                self.browser.clone(),
                evidence.origin,
                &identity,
                self.lease.clone(),
            ))),
            Action::Remember => {
                service
                    .trust_identity(host, "https".into(), identity.clone(), false)
                    .await
                    .map_err(|_| error)?;
                if !self.lease.is_current() {
                    return Err(NativeAuthorityError::OwnerUnavailable);
                }
                Ok(NativeCertificateDecision::Allow(permit(
                    self.browser.clone(),
                    evidence.origin,
                    &identity,
                    self.lease.clone(),
                )))
            }
            Action::Review(reason) => Ok(NativeCertificateDecision::Review(Box::new(
                NativeCertificateReview {
                    service,
                    identity,
                    host,
                    origin: evidence.origin,
                    browser: self.browser.clone(),
                    lease: self.lease.clone(),
                    expires: Instant::now() + Duration::from_secs(300),
                    reason,
                },
            ))),
        }
    }
}

#[derive(Debug, PartialEq)]
enum Action {
    Allow,
    Deny,
    Remember,
    Review(&'static str),
}
fn combined_action(
    result: &TrustVerifyResult,
    effective: &TrustPolicy,
    requested: &TrustPolicy,
    system_ca_valid: bool,
    ca_first_use: bool,
) -> Action {
    let decide = |policy: &TrustPolicy| {
        action(
            result,
            policy,
            if *policy == TrustPolicy::Tofu {
                system_ca_valid && ca_first_use
            } else {
                system_ca_valid
            },
        )
    };
    let effective = decide(effective);
    let requested = decide(requested);
    if !matches!(effective, Action::Deny) && matches!(requested, Action::Deny | Action::Review(_)) {
        requested
    } else {
        effective
    }
}

fn action(result: &TrustVerifyResult, policy: &TrustPolicy, ca: bool) -> Action {
    use TrustPolicy::*;
    use TrustVerifyResult::*;
    if matches!(policy, AlwaysTrust | ConditionalTrust) {
        return Action::Deny;
    }
    match result {
        Revoked { .. } | PendingThreshold { .. } | PendingVerification { .. } => Action::Deny,
        Mismatch { .. } | ChainMismatch { .. } | RotationGrace { .. } => {
            if matches!(policy, Strict | CertificatePinning | CaTrustOnly) {
                Action::Deny
            } else {
                Action::Review("The saved certificate changed")
            }
        }
        Expired { .. } if matches!(policy, Strict | CertificatePinning | CaTrustOnly) => {
            Action::Deny
        }
        Expired { .. } => Action::Review("The saved certificate approval expired"),
        Trusted if *policy == AlwaysAsk => {
            Action::Review("This connection requires certificate approval")
        }
        Trusted if *policy == CaTrustOnly && !ca => Action::Deny,
        Trusted => Action::Allow,
        FirstUse {
            requires_approval: true,
            ..
        } if matches!(policy, Strict | CertificatePinning | CaTrustOnly) => Action::Deny,
        FirstUse {
            requires_approval: true,
            ..
        } => Action::Review("This certificate requires a fresh explicit approval"),
        FirstUse { .. } => match policy {
            Tofu if ca => Action::Allow,
            Tofu => Action::Remember,
            CaTrustOnly if ca => Action::Allow,
            Strict | CertificatePinning | CaTrustOnly | AlwaysTrust => Action::Deny,
            _ => Action::Review("Review this website certificate before connecting"),
        },
    }
}
fn permit(
    browser: BrowserIdentity,
    origin: String,
    identity: &Identity,
    lease: NativeOwnerLease,
) -> NativeCertificatePermit {
    let (fingerprint, chain_fingerprints) = match identity {
        Identity::Tls(cert) => (cert.fingerprint.clone(), cert.chain_fingerprints.clone()),
        _ => unreachable!(),
    };
    NativeCertificatePermit {
        browser,
        origin,
        fingerprint,
        chain_fingerprints,
        lease,
        expires: Instant::now() + Duration::from_secs(30),
    }
}
fn encode(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            result.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(result, "%{byte:02X}").unwrap();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> Identity {
        Identity::Tls(Box::new(serde_json::from_value(serde_json::json!({
            "fingerprint":"a".repeat(64), "first_seen":"2026-01-01T00:00:00Z", "last_seen":"2026-01-01T00:00:00Z"
        })).unwrap()))
    }

    #[test]
    fn saved_policy_preserves_precedence_and_does_not_disable_verification() {
        let settings = serde_json::json!({"trustPolicy":"tofu"});
        assert_eq!(
            saved_policy(&serde_json::json!({"httpsTrustPolicy":"strict"}), &settings).unwrap(),
            TrustPolicy::Strict
        );
        assert_eq!(
            saved_policy(
                &serde_json::json!({"httpsTrustPolicy":"inherit"}),
                &settings
            )
            .unwrap(),
            TrustPolicy::Tofu
        );
        assert_eq!(
            saved_policy(&Value::Null, &Value::Null).unwrap(),
            TrustPolicy::AlwaysAsk
        );
        assert!(saved_policy(
            &serde_json::json!({"httpsTrustPolicy":"always-trust"}),
            &settings
        )
        .is_err());
    }

    #[test]
    fn strict_first_use_requires_preapproval_even_with_valid_ca() {
        for requires_approval in [false, true] {
            for ca in [false, true] {
                let first = TrustVerifyResult::FirstUse {
                    identity: identity(),
                    requires_approval,
                };
                assert_eq!(action(&first, &TrustPolicy::Strict, ca), Action::Deny);
            }
        }
    }

    #[tokio::test]
    async fn ca_shortcut_requires_both_requested_and_global_tofu_and_system_ca() {
        for (global, requested, system_ca, expected) in [
            (TrustPolicy::Tofu, TrustPolicy::Tofu, true, Action::Allow),
            (
                TrustPolicy::Tofu,
                TrustPolicy::Tofu,
                false,
                Action::Remember,
            ),
            (TrustPolicy::Strict, TrustPolicy::Tofu, true, Action::Deny),
            (TrustPolicy::Tofu, TrustPolicy::Strict, true, Action::Deny),
            (
                TrustPolicy::AlwaysAsk,
                TrustPolicy::Tofu,
                true,
                Action::Review("Review this website certificate before connecting"),
            ),
            (
                TrustPolicy::Tofu,
                TrustPolicy::AlwaysAsk,
                true,
                Action::Review("Review this website certificate before connecting"),
            ),
            (
                TrustPolicy::CertificatePinning,
                TrustPolicy::Tofu,
                true,
                Action::Deny,
            ),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let service = TrustStoreService::new(
                dir.path().join("trust.json").to_string_lossy().into_owned(),
            );
            let mut service = service.lock().await;
            service.set_trust_policy(global.clone()).await.unwrap();
            let host = "@sorng/connection/v1/c/device.test/443";
            assert!(service
                .get_effective_stored_identity(host, "https")
                .unwrap()
                .is_none());
            let effective = service.get_trust_policy().await;
            let mut proof_consumed = false;
            let (result, ca_first_use) = service
                .verify_https_with_ca(
                    host,
                    identity(),
                    requested.clone(),
                    system_ca,
                    |name, port, fingerprint| {
                        assert_eq!((name, port), ("device.test", 443));
                        assert_eq!(fingerprint, "a".repeat(64));
                        proof_consumed = true;
                        Ok(())
                    },
                )
                .unwrap();
            assert_eq!(
                ca_first_use,
                global == TrustPolicy::Tofu && requested == TrustPolicy::Tofu && system_ca
            );
            assert_eq!(proof_consumed, ca_first_use);
            assert_eq!(
                combined_action(&result, &effective, &requested, system_ca, ca_first_use),
                expected
            );
            service.reload_from_disk().unwrap();
            assert!(service
                .get_effective_stored_identity(host, "https")
                .unwrap()
                .is_none());
        }
    }

    #[tokio::test]
    async fn existing_records_and_fresh_approval_never_use_ca_first_use_shortcut() {
        for scenario in ["matching", "changed", "revoked", "forgotten", "host-strict"] {
            let dir = tempfile::tempdir().unwrap();
            let service = TrustStoreService::new(
                dir.path().join("trust.json").to_string_lossy().into_owned(),
            );
            let mut service = service.lock().await;
            service.set_trust_policy(TrustPolicy::Tofu).await.unwrap();
            let host = "@sorng/connection/v1/c/device.test/443";
            service
                .trust_identity(host.into(), "https".into(), identity(), true)
                .await
                .unwrap();
            let mut presented = identity();
            match scenario {
                "changed" => {
                    if let Identity::Tls(cert) = &mut presented {
                        cert.fingerprint = "b".repeat(64);
                    }
                }
                "revoked" => service.revoke_identity(host, "https").await.unwrap(),
                "forgotten" => service.remove_identity(host, "https").await.unwrap(),
                "host-strict" => service
                    .set_host_policy(host, "https", Some(TrustPolicy::Strict), None)
                    .await
                    .unwrap(),
                _ => {}
            }
            let effective = service
                .get_effective_stored_identity(host, "https")
                .unwrap()
                .and_then(|record| record.host_policy)
                .unwrap_or(service.get_trust_policy().await);
            let (result, ca_first_use) = service
                .verify_https_with_ca(host, presented, TrustPolicy::Tofu, true, |_, _, _| {
                    panic!("existing records/fresh approval must block CA shortcut")
                })
                .unwrap();
            assert!(!ca_first_use, "{scenario}");
            let decision =
                combined_action(&result, &effective, &TrustPolicy::Tofu, true, ca_first_use);
            match scenario {
                "matching" | "host-strict" => assert_eq!(decision, Action::Allow),
                "revoked" => assert_eq!(decision, Action::Deny),
                _ => assert!(matches!(decision, Action::Review(_)), "{scenario}"),
            }
        }
    }

    #[test]
    fn tofu_ca_first_use_pin_and_explicit_review_remain_distinct() {
        let first = TrustVerifyResult::FirstUse {
            identity: identity(),
            requires_approval: false,
        };
        assert_eq!(action(&first, &TrustPolicy::Tofu, true), Action::Allow);
        assert_eq!(action(&first, &TrustPolicy::Tofu, false), Action::Remember);
        assert_eq!(
            action(&first, &TrustPolicy::CertificatePinning, true),
            Action::Deny
        );
        assert!(matches!(
            action(&first, &TrustPolicy::AlwaysAsk, true),
            Action::Review(_)
        ));
        assert!(matches!(
            action(&TrustVerifyResult::Trusted, &TrustPolicy::AlwaysAsk, true),
            Action::Review(_)
        ));
        let forgotten = TrustVerifyResult::FirstUse {
            identity: identity(),
            requires_approval: true,
        };
        assert!(matches!(
            action(&forgotten, &TrustPolicy::Tofu, true),
            Action::Review(_)
        ));
        assert_eq!(action(&forgotten, &TrustPolicy::Strict, true), Action::Deny);
    }

    #[test]
    fn native_ca_success_never_overrides_revocation_or_changed_pin() {
        let revoked = TrustVerifyResult::Revoked { stored: identity() };
        let changed = TrustVerifyResult::Mismatch {
            stored: identity(),
            presented: identity(),
        };
        for policy in [
            TrustPolicy::Tofu,
            TrustPolicy::Strict,
            TrustPolicy::AlwaysAsk,
            TrustPolicy::CertificatePinning,
        ] {
            assert_eq!(action(&revoked, &policy, true), Action::Deny);
        }
        assert_eq!(
            action(&changed, &TrustPolicy::CertificatePinning, true),
            Action::Deny
        );
        assert_eq!(action(&changed, &TrustPolicy::Strict, true), Action::Deny);
        assert!(matches!(
            action(&changed, &TrustPolicy::Tofu, true),
            Action::Review(_)
        ));
    }
}
