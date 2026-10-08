//! Native certificate admission. Invoke on the async handshake path for EVERY
//! certificate, including CA-valid certificates. Never invoke from renderer IPC.
//! CEF error callbacks alone are not sufficient to enforce pins.
use super::*;
use sorng_storage::trust_store::{
    CertIdentity, Identity, TrustPolicy, TrustStoreService, TrustVerifyResult,
};
use std::sync::Mutex;

/// Each authority owns a fresh store. Only bounded hashes survive a handshake;
/// no database identity, persistent trust service, or eviction/TOFU reset exists.
#[derive(Default)]
struct TemporaryPins {
    origins: BTreeMap<String, TemporaryPin>,
    revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct TemporaryPin {
    fingerprint: String,
    chain_fingerprints: Vec<String>,
    revision: u64,
}

impl TemporaryPin {
    fn matches(&self, cert: &CertIdentity) -> bool {
        self.fingerprint == cert.fingerprint
            && self.chain_fingerprints == cert.chain_fingerprints
            && !self.chain_fingerprints.is_empty()
    }
}

impl TemporaryPins {
    fn remember(&mut self, origin: &str, cert: &CertIdentity) -> Result<(), NativeAuthorityError> {
        let error = NativeAuthorityError::CertificatePolicyUnsupported;
        if !valid_temporary_chain(cert)
            || canonical_website_permission_origin(origin).as_deref() != Ok(origin)
            || !origin.starts_with("https://")
            || (!self.origins.contains_key(origin)
                && self.origins.len() >= sorng_protocols::origin_browser::MAX_ALLOWED_ORIGINS)
        {
            return Err(error);
        }
        let revision = self.revision.checked_add(1).ok_or(error)?;
        self.origins.insert(
            origin.into(),
            TemporaryPin {
                fingerprint: cert.fingerprint.clone(),
                chain_fingerprints: cert.chain_fingerprints.clone(),
                revision,
            },
        );
        self.revision = revision;
        Ok(())
    }

    fn approve(
        &mut self,
        origin: &str,
        cert: &CertIdentity,
        baseline: Option<&TemporaryPin>,
        remember: bool,
    ) -> Result<(), NativeAuthorityError> {
        // Reject concurrent first-use/review changes, including A -> B -> A.
        // Allow-once also checks the baseline, but never changes the pin.
        if self.origins.get(origin) != baseline {
            return Err(NativeAuthorityError::CertificatePolicyUnsupported);
        }
        if remember {
            self.remember(origin, cert)?;
        }
        Ok(())
    }
}

fn valid_temporary_chain(cert: &CertIdentity) -> bool {
    !cert.chain_fingerprints.is_empty()
        && cert.chain_fingerprints.len() <= 32
        && cert.chain_fingerprints.first() == Some(&cert.fingerprint)
        && cert
            .chain_fingerprints
            .iter()
            .all(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn temporary_action(
    pin: Option<&TemporaryPin>,
    cert: &CertIdentity,
    policy: &TrustPolicy,
    system_ca: bool,
    system_ca_valid: bool,
    validity_valid: bool,
) -> Action {
    use TrustPolicy::*;
    if !valid_temporary_chain(cert)
        || !matches!(
            policy,
            Tofu | AlwaysAsk | Strict | CertificatePinning | CaTrustOnly
        )
        || (*policy == CaTrustOnly && !(system_ca && system_ca_valid))
    {
        return Action::Deny;
    }
    if matches!(policy, Strict | CertificatePinning | CaTrustOnly) {
        if !validity_valid || pin.is_some_and(|pin| !pin.matches(cert)) {
            return Action::Deny;
        }
        if pin.is_none() && *policy != CaTrustOnly {
            // Temporary attempts cannot borrow preapproval from saved storage.
            return Action::Deny;
        }
    }
    if !validity_valid {
        return Action::Review(
            "Temporary connection: the certificate is expired or has invalid validity metadata",
        );
    }
    if pin.is_some_and(|pin| !pin.matches(cert)) {
        return Action::Review("Temporary connection: the certificate or its exact chain changed");
    }
    if *policy == AlwaysAsk {
        return Action::Review(
            "Temporary connection: this policy requires certificate approval on every handshake",
        );
    }
    if pin.is_some() {
        return Action::Allow;
    }
    if *policy == Tofu && !system_ca {
        return Action::Review("Temporary connection: review new certificates is enabled");
    }
    // TOFU and CA-only both bind their first accepted chain to this attempt.
    // Native CA success can never overwrite a subsequently changed pin.
    Action::Remember
}

enum ReviewTrust {
    Saved(Box<TrustStoreService>),
    Temporary {
        pins: Arc<Mutex<TemporaryPins>>,
        baseline: Option<TemporaryPin>,
    },
}

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
    trust: ReviewTrust,
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

    /// Lets the native prompt describe attempt-only remembering accurately.
    pub fn is_temporary(&self) -> bool {
        matches!(&self.trust, ReviewTrust::Temporary { .. })
    }

    /// Consumes the exact review and rechecks its owner and trust baseline.
    /// Temporary remembering affects only this attempt's in-memory pins.
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
        match &mut self.trust {
            ReviewTrust::Saved(service) => {
                // Scoped service rejects drift against the original baseline.
                service
                    .reload_from_disk()
                    .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
                if remember {
                    service
                        .trust_identity(
                            self.host.clone(),
                            "https".into(),
                            self.identity.clone(),
                            true,
                        )
                        .await
                        .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
                }
            }
            ReviewTrust::Temporary { pins, baseline } => {
                let mut pins = pins
                    .lock()
                    .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
                if !self.lease.is_current() || Instant::now() >= self.expires {
                    return Err(NativeAuthorityError::OwnerUnavailable);
                }
                let Identity::Tls(cert) = &self.identity else {
                    return Err(NativeAuthorityError::CertificatePolicyUnsupported);
                };
                pins.approve(&self.origin, cert, baseline.as_ref(), remember)?;
            }
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
    temporary_pins: Option<Arc<Mutex<TemporaryPins>>>,
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
    // The frontend merges missing saved globals with trustPolicy: "tofu".
    // Native reads the sparse saved document, so apply that same default only
    // after all explicit modern/legacy policies have been considered. Invalid
    // selected values still fail deserialization instead of acquiring a default.
    let policy: TrustPolicy =
        serde_json::from_value(selected.cloned().unwrap_or(Value::String("tofu".into())))
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
        // Missing mode inherits the frontend default. Malformed temporary
        // preferences must not accidentally enable native CA acceptance.
        if lease.is_temporary()
            && settings
                .get("httpsCaTrustMode")
                .is_some_and(|mode| !matches!(mode.as_str(), Some("system" | "review")))
        {
            return Err(NativeAuthorityError::CertificatePolicyUnsupported);
        }
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
            temporary_pins: lease
                .is_temporary()
                .then(|| Arc::new(Mutex::new(TemporaryPins::default()))),
        })
    }

    /// Async worker path only: saved owners may access encrypted trust storage;
    /// temporary owners use only attempt memory. Pause the actual handshake.
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
        if let Some(pins) = &self.temporary_pins {
            let now = chrono::Utc::now();
            let validity_valid = captured.chain.iter().all(|entry| {
                chrono::DateTime::parse_from_rfc3339(&entry.valid_from)
                    .is_ok_and(|start| start <= now)
                    && chrono::DateTime::parse_from_rfc3339(&entry.valid_to)
                        .is_ok_and(|end| end > now)
            });
            return self.evaluate_temporary(evidence, identity, pins, validity_valid);
        }
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
                    trust: ReviewTrust::Saved(Box::new(service)),
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

    fn evaluate_temporary(
        &self,
        evidence: NativeCertificateEvidence,
        identity: Identity,
        pins: &Arc<Mutex<TemporaryPins>>,
        validity_valid: bool,
    ) -> Result<NativeCertificateDecision, NativeAuthorityError> {
        if !evidence.origin.starts_with("https://") {
            return Ok(NativeCertificateDecision::Deny);
        }
        let Identity::Tls(cert) = &identity else {
            return Err(NativeAuthorityError::CertificatePolicyUnsupported);
        };
        // Decide and install TOFU under one lock: competing first handshakes
        // cannot both silently acquire different pins for the same origin.
        let mut memory = pins
            .lock()
            .map_err(|_| NativeAuthorityError::CertificatePolicyUnsupported)?;
        if !self.lease.is_current() {
            return Err(NativeAuthorityError::OwnerUnavailable);
        }
        let baseline = memory.origins.get(&evidence.origin).cloned();
        match temporary_action(
            baseline.as_ref(),
            cert,
            &self.policy,
            self.system_ca,
            evidence.system_ca_valid,
            validity_valid,
        ) {
            Action::Deny => return Ok(NativeCertificateDecision::Deny),
            Action::Review(reason) => {
                return Ok(NativeCertificateDecision::Review(Box::new(
                    NativeCertificateReview {
                        trust: ReviewTrust::Temporary {
                            pins: pins.clone(),
                            baseline,
                        },
                        identity,
                        host: evidence.origin.clone(),
                        origin: evidence.origin,
                        browser: self.browser.clone(),
                        lease: self.lease.clone(),
                        expires: Instant::now() + Duration::from_secs(300),
                        reason,
                    },
                )));
            }
            Action::Remember => memory.remember(&evidence.origin, cert)?,
            Action::Allow => {}
        }
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

    fn temporary_certificate(leaf: char, issuer: char) -> CertIdentity {
        serde_json::from_value(serde_json::json!({
            "fingerprint": leaf.to_string().repeat(64),
            "chain_fingerprints": [leaf.to_string().repeat(64), issuer.to_string().repeat(64)],
            "first_seen": "2026-01-01T00:00:00Z",
            "last_seen": "2026-01-01T00:00:00Z"
        }))
        .unwrap()
    }

    #[test]
    fn temporary_first_use_enforces_policy_and_ca_review_preferences() {
        let cert = temporary_certificate('a', 'b');
        for system_ca in [false, true] {
            for ca_valid in [false, true] {
                for policy in [TrustPolicy::Strict, TrustPolicy::CertificatePinning] {
                    assert_eq!(
                        temporary_action(None, &cert, &policy, system_ca, ca_valid, true),
                        Action::Deny
                    );
                }
                assert!(matches!(
                    temporary_action(
                        None,
                        &cert,
                        &TrustPolicy::AlwaysAsk,
                        system_ca,
                        ca_valid,
                        true
                    ),
                    Action::Review(_)
                ));
                let tofu =
                    temporary_action(None, &cert, &TrustPolicy::Tofu, system_ca, ca_valid, true);
                if system_ca {
                    assert_eq!(tofu, Action::Remember);
                } else {
                    assert!(matches!(tofu, Action::Review(_)));
                }
                assert_eq!(
                    temporary_action(
                        None,
                        &cert,
                        &TrustPolicy::CaTrustOnly,
                        system_ca,
                        ca_valid,
                        true
                    ),
                    if system_ca && ca_valid {
                        Action::Remember
                    } else {
                        Action::Deny
                    }
                );
            }
        }
    }

    #[test]
    fn temporary_policy_uses_inherited_modern_legacy_and_connection_preferences() {
        let cert = temporary_certificate('a', 'b');
        for key in ["httpsTrustPolicy", "trustPolicy", "tlsTrustPolicy"] {
            for name in [
                "always-ask",
                "strict",
                "certificate-pinning",
                "ca-trust-only",
            ] {
                let mut settings = serde_json::json!({});
                settings[key] = name.into();
                let policy = saved_policy(
                    &serde_json::json!({"httpsTrustPolicy":"inherit"}),
                    &settings,
                )
                .unwrap();
                let decision = temporary_action(None, &cert, &policy, true, false, true);
                if name == "always-ask" {
                    assert!(matches!(decision, Action::Review(_)));
                } else {
                    assert_eq!(decision, Action::Deny);
                }
            }
        }
        let policy = saved_policy(
            &serde_json::json!({"httpsTrustPolicy":"always-ask"}),
            &serde_json::json!({"httpsTrustPolicy":"tofu"}),
        )
        .unwrap();
        assert!(matches!(
            temporary_action(None, &cert, &policy, true, true, true),
            Action::Review(_)
        ));
    }

    #[test]
    fn temporary_pins_are_attempt_and_exact_origin_local() {
        let cert = temporary_certificate('a', 'b');
        let mut attempt = TemporaryPins::default();
        let reconnect = TemporaryPins::default();
        let origin = "https://device.test";
        attempt.remember(origin, &cert).unwrap();
        assert!(!reconnect.origins.contains_key(origin));
        for other in ["https://device.test:8443", "https://other.test"] {
            assert!(!attempt.origins.contains_key(other));
            assert_eq!(
                temporary_action(
                    attempt.origins.get(other),
                    &cert,
                    &TrustPolicy::Strict,
                    true,
                    true,
                    true
                ),
                Action::Deny
            );
        }
        for policy in [
            TrustPolicy::Tofu,
            TrustPolicy::Strict,
            TrustPolicy::CertificatePinning,
        ] {
            assert_eq!(
                temporary_action(
                    attempt.origins.get(origin),
                    &cert,
                    &policy,
                    false,
                    false,
                    true
                ),
                Action::Allow
            );
        }
        assert_eq!(
            temporary_action(
                attempt.origins.get(origin),
                &cert,
                &TrustPolicy::CaTrustOnly,
                true,
                false,
                true
            ),
            Action::Deny
        );
        assert_eq!(
            temporary_action(
                attempt.origins.get(origin),
                &cert,
                &TrustPolicy::CaTrustOnly,
                false,
                true,
                true
            ),
            Action::Deny
        );
    }

    #[test]
    fn temporary_native_ca_success_never_overwrites_a_changed_leaf_or_chain() {
        let cert = temporary_certificate('a', 'b');
        let origin = "https://device.test";
        let mut pins = TemporaryPins::default();
        pins.remember(origin, &cert).unwrap();
        let mut longer = cert.clone();
        longer.chain_fingerprints.push("c".repeat(64));
        let mut shorter = cert.clone();
        shorter.chain_fingerprints.pop();
        let mut reordered = longer.clone();
        reordered.chain_fingerprints.swap(1, 2);
        for changed in [
            temporary_certificate('c', 'b'),
            temporary_certificate('a', 'c'),
            longer,
            shorter,
            reordered,
        ] {
            for policy in [
                TrustPolicy::Strict,
                TrustPolicy::CertificatePinning,
                TrustPolicy::CaTrustOnly,
            ] {
                assert_eq!(
                    temporary_action(
                        pins.origins.get(origin),
                        &changed,
                        &policy,
                        true,
                        true,
                        true
                    ),
                    Action::Deny
                );
            }
            for policy in [TrustPolicy::Tofu, TrustPolicy::AlwaysAsk] {
                assert!(matches!(
                    temporary_action(
                        pins.origins.get(origin),
                        &changed,
                        &policy,
                        true,
                        true,
                        true
                    ),
                    Action::Review(_)
                ));
            }
        }
        assert!(pins.origins.get(origin).unwrap().matches(&cert));
    }

    #[test]
    fn temporary_approval_remembers_only_when_requested_and_always_ask_still_reviews() {
        let mut pins = TemporaryPins::default();
        let origin = "https://device.test";
        let cert = temporary_certificate('a', 'b');
        pins.approve(origin, &cert, None, false).unwrap();
        assert!(pins.origins.is_empty());
        pins.approve(origin, &cert, None, true).unwrap();
        let baseline = pins.origins.get(origin).cloned().unwrap();
        assert!(matches!(
            temporary_action(
                Some(&baseline),
                &cert,
                &TrustPolicy::AlwaysAsk,
                true,
                true,
                true
            ),
            Action::Review(_)
        ));
        let changed = temporary_certificate('c', 'b');
        pins.approve(origin, &changed, Some(&baseline), false)
            .unwrap();
        assert_eq!(pins.origins.get(origin), Some(&baseline));
        pins.approve(origin, &changed, Some(&baseline), true)
            .unwrap();
        assert!(pins.origins.get(origin).unwrap().matches(&changed));
        assert_eq!(
            temporary_action(
                pins.origins.get(origin),
                &changed,
                &TrustPolicy::Tofu,
                false,
                false,
                true
            ),
            Action::Allow
        );
    }

    #[test]
    fn temporary_stale_reviews_reject_both_allow_once_and_remember_including_aba() {
        let mut pins = TemporaryPins::default();
        let origin = "https://device.test";
        let cert = temporary_certificate('a', 'b');
        let changed = temporary_certificate('c', 'b');
        pins.remember(origin, &cert).unwrap();
        let baseline = pins.origins.get(origin).cloned().unwrap();
        for remember in [false, true] {
            assert!(pins.approve(origin, &changed, None, remember).is_err());
        }
        pins.remember(origin, &changed).unwrap();
        pins.remember(origin, &cert).unwrap();
        for remember in [false, true] {
            assert!(pins
                .approve(origin, &changed, Some(&baseline), remember)
                .is_err());
        }
        // Another origin's first use does not invalidate this origin's review.
        let baseline = pins.origins.get(origin).cloned().unwrap();
        pins.remember("https://other.test", &changed).unwrap();
        pins.approve(origin, &changed, Some(&baseline), true)
            .unwrap();
    }

    #[test]
    fn temporary_invalid_validity_never_automatically_acquires_or_reuses_trust() {
        let cert = temporary_certificate('a', 'b');
        let mut pins = TemporaryPins::default();
        let origin = "https://device.test";
        pins.remember(origin, &cert).unwrap();
        for baseline in [None, pins.origins.get(origin)] {
            for policy in [TrustPolicy::Tofu, TrustPolicy::AlwaysAsk] {
                assert!(matches!(
                    temporary_action(baseline, &cert, &policy, true, true, false),
                    Action::Review(_)
                ));
            }
            for policy in [
                TrustPolicy::Strict,
                TrustPolicy::CertificatePinning,
                TrustPolicy::CaTrustOnly,
            ] {
                assert_eq!(
                    temporary_action(baseline, &cert, &policy, true, true, false),
                    Action::Deny
                );
            }
        }
    }

    #[test]
    fn temporary_unsupported_policies_and_malformed_chains_fail_closed() {
        let cert = temporary_certificate('a', 'b');
        for policy in [
            TrustPolicy::AlwaysTrust,
            TrustPolicy::ConditionalTrust,
            TrustPolicy::TofuWithExpiry,
            TrustPolicy::KeyRotationGrace,
            TrustPolicy::TrustOnVerify,
            TrustPolicy::ThresholdTrust,
        ] {
            assert_eq!(
                temporary_action(None, &cert, &policy, true, true, true),
                Action::Deny
            );
        }
        for chain in [
            vec![],
            vec!["c".repeat(64)],
            vec!["a".repeat(64); 33],
            vec!["a".repeat(64), "z".repeat(64)],
            vec!["a".repeat(64), "b".repeat(63)],
        ] {
            let mut invalid = cert.clone();
            invalid.chain_fingerprints = chain;
            let mut pins = TemporaryPins::default();
            assert!(pins.remember("https://device.test", &invalid).is_err());
            assert_eq!(
                temporary_action(None, &invalid, &TrustPolicy::Tofu, true, true, true),
                Action::Deny
            );
            assert!(pins.origins.is_empty());
        }
    }

    #[test]
    fn temporary_pins_are_bounded_without_evicting_trusted_origins() {
        let cert = temporary_certificate('a', 'b');
        let mut pins = TemporaryPins::default();
        for index in 0..sorng_protocols::origin_browser::MAX_ALLOWED_ORIGINS {
            pins.remember(&format!("https://device-{index}.test"), &cert)
                .unwrap();
        }
        assert!(pins.remember("https://extra.test", &cert).is_err());
        assert_eq!(
            pins.origins.len(),
            sorng_protocols::origin_browser::MAX_ALLOWED_ORIGINS
        );
        let changed = temporary_certificate('c', 'b');
        let baseline = pins.origins.get("https://device-0.test").cloned().unwrap();
        pins.approve("https://device-0.test", &changed, Some(&baseline), true)
            .unwrap();
        assert!(pins
            .origins
            .get("https://device-1.test")
            .unwrap()
            .matches(&cert));
        pins.revision = u64::MAX;
        assert!(pins.remember("https://device-0.test", &cert).is_err());
        assert!(pins
            .origins
            .get("https://device-0.test")
            .unwrap()
            .matches(&changed));
    }

    #[test]
    fn temporary_concurrent_first_use_installs_only_one_chain() {
        let pins = Arc::new(Mutex::new(TemporaryPins::default()));
        let barrier = Arc::new(std::sync::Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|index| {
                let pins = pins.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let cert = temporary_certificate(char::from(b'0' + index), 'f');
                    barrier.wait();
                    let mut pins = pins.lock().unwrap();
                    let origin = "https://device.test";
                    let decision = temporary_action(
                        pins.origins.get(origin),
                        &cert,
                        &TrustPolicy::Tofu,
                        true,
                        true,
                        true,
                    );
                    if decision == Action::Remember {
                        pins.remember(origin, &cert).unwrap();
                    }
                    decision
                })
            })
            .collect();
        let decisions: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(
            decisions
                .iter()
                .filter(|action| **action == Action::Remember)
                .count(),
            1
        );
        assert_eq!(
            decisions
                .iter()
                .filter(|action| matches!(action, Action::Review(_)))
                .count(),
            7
        );
        assert_eq!(pins.lock().unwrap().origins.len(), 1);
    }

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
        assert!(saved_policy(
            &serde_json::json!({"httpsTrustPolicy":"always-trust"}),
            &settings
        )
        .is_err());
    }

    #[test]
    fn missing_and_inherited_saved_policies_use_frontend_tofu_default() {
        for connection in [
            Value::Null,
            serde_json::json!({}),
            serde_json::json!({"httpsTrustPolicy":"inherit"}),
        ] {
            for settings in [
                Value::Null,
                serde_json::json!({}),
                serde_json::json!({"httpsTrustPolicy":"inherit"}),
                serde_json::json!({"httpsTrustPolicy":"inherit","trustPolicy":"inherit"}),
            ] {
                assert_eq!(
                    saved_policy(&connection, &settings).unwrap(),
                    TrustPolicy::Tofu,
                    "connection={connection}, settings={settings}"
                );
            }
        }
    }

    #[test]
    fn explicit_modern_and_legacy_policies_override_the_missing_global_default() {
        for (name, expected) in [
            ("always-ask", TrustPolicy::AlwaysAsk),
            ("strict", TrustPolicy::Strict),
            ("certificate-pinning", TrustPolicy::CertificatePinning),
            ("ca-trust-only", TrustPolicy::CaTrustOnly),
        ] {
            for (connection, settings) in [
                (
                    serde_json::json!({"httpsTrustPolicy":name}),
                    serde_json::json!({}),
                ),
                (
                    serde_json::json!({"httpsTrustPolicy":"inherit"}),
                    serde_json::json!({"httpsTrustPolicy":name}),
                ),
                (
                    serde_json::json!({}),
                    serde_json::json!({"httpsTrustPolicy":"inherit","trustPolicy":name}),
                ),
                (
                    serde_json::json!({"tlsTrustPolicy":name}),
                    serde_json::json!({}),
                ),
                (
                    serde_json::json!({"httpsTrustPolicy":"inherit"}),
                    serde_json::json!({"tlsTrustPolicy":name}),
                ),
            ] {
                let policy = saved_policy(&connection, &settings).unwrap();
                assert_eq!(
                    policy, expected,
                    "connection={connection}, settings={settings}"
                );
                if policy == TrustPolicy::AlwaysAsk {
                    let first = TrustVerifyResult::FirstUse {
                        identity: identity(),
                        requires_approval: false,
                    };
                    assert!(matches!(action(&first, &policy, true), Action::Review(_)));
                    assert!(matches!(
                        action(&TrustVerifyResult::Trusted, &policy, true),
                        Action::Review(_)
                    ));
                }
            }
        }
    }

    #[test]
    fn invalid_selected_policies_never_fall_back_to_tofu() {
        for invalid in [
            Value::Null,
            serde_json::json!(false),
            serde_json::json!(7),
            serde_json::json!({}),
            serde_json::json!("typo"),
            serde_json::json!("always-trust"),
        ] {
            for (connection, settings) in [
                (
                    serde_json::json!({"httpsTrustPolicy":invalid}),
                    serde_json::json!({"trustPolicy":"tofu"}),
                ),
                (
                    serde_json::json!({"httpsTrustPolicy":"inherit"}),
                    serde_json::json!({"httpsTrustPolicy":invalid,"trustPolicy":"tofu"}),
                ),
                (
                    serde_json::json!({}),
                    serde_json::json!({"trustPolicy":invalid,"tlsTrustPolicy":"tofu"}),
                ),
                (
                    serde_json::json!({"tlsTrustPolicy":invalid}),
                    serde_json::json!({"tlsTrustPolicy":"tofu"}),
                ),
                (
                    serde_json::json!({}),
                    serde_json::json!({"tlsTrustPolicy":invalid}),
                ),
            ] {
                assert!(
                    matches!(
                        saved_policy(&connection, &settings),
                        Err(NativeAuthorityError::CertificatePolicyUnsupported)
                    ),
                    "connection={connection}, settings={settings}"
                );
            }
        }
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
