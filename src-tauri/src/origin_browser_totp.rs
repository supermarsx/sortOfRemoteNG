//! Selected authenticator from the SAME unlocked owning database. No seed DTO,
//! renderer seed, fallback search, Debug, secret log, or automatic MFA bypass.
use super::*;
use crate::totp::{core::generate_totp_at, types::Algorithm};
use sorng_browser_host::native_totp::{NativeTotpCode, NativeTotpRequest};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static CATALOG: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("origin_browser_totp_catalog.json"))
        .expect("reviewed TOTP catalog")
});

pub(super) struct NativeTotpAuthority {
    identity: BrowserIdentity,
    lease: NativeOwnerLease,
    origin: String,
    challenge: String,
    paths: Vec<String>,
    seed: Zeroizing<String>,
    algorithm: Algorithm,
    digits: u8,
    period: u32,
    submit_delay: Duration,
    configuration: Value,
    used: AtomicBool,
    revoked: AtomicBool,
}

fn unavailable() -> NativeAuthorityError {
    NativeAuthorityError::CredentialUnavailable
}

fn selected<'a>(entries: &'a Value, id: &str) -> Result<&'a Value, NativeAuthorityError> {
    let entries = entries
        .as_array()
        .filter(|rows| rows.len() <= 256)
        .ok_or_else(unavailable)?;
    let mut found = entries
        .iter()
        .filter(|entry| entry.get("id").and_then(Value::as_str) == Some(id));
    let entry = found.next().ok_or_else(unavailable)?;
    if found.next().is_some() {
        return Err(unavailable());
    }
    Ok(entry)
}

impl NativeTotpAuthority {
    pub(super) async fn resolve<R: Runtime>(
        connection: &Value,
        login: &NativeLoginAuthority,
        window: &WebviewWindow<R>,
        state: &EncryptionState,
    ) -> Result<Option<Self>, NativeAuthorityError> {
        let Some(config) = connection.get("httpAutoMfa").filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        if config.get("enabled") == Some(&Value::Bool(false)) {
            return Ok(None);
        }
        if !login.enabled
            || config.get("version").and_then(Value::as_u64) != Some(1)
            || config.get("enabled") != Some(&Value::Bool(true))
            || config.as_object().is_none_or(|o| {
                o.keys().any(|k| {
                    !matches!(
                        k.as_str(),
                        "version" | "enabled" | "totpConfigId" | "challengeId" | "origin"
                    )
                })
            })
        {
            return Err(unavailable());
        }
        if saved_source(connection)?.scheme() != "https" {
            return Err(unavailable());
        }
        let id = config
            .get("totpConfigId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
            .ok_or_else(unavailable)?;
        let challenges = CATALOG[&login.application_id]
            .as_array()
            .ok_or_else(unavailable)?;
        let challenge_id = config
            .get("challengeId")
            .and_then(Value::as_str)
            .ok_or_else(unavailable)?;
        let challenge = challenges
            .iter()
            .find(|c| c["id"].as_str() == Some(challenge_id))
            .ok_or_else(unavailable)?;
        let origin = config
            .get("origin")
            .and_then(Value::as_str)
            .ok_or_else(unavailable)?;
        if origin.len() > 512
            || canonical_website_permission_origin(origin).as_deref() != Ok(origin)
        {
            return Err(unavailable());
        }
        if !login.origins.iter().any(|o| o == origin)
            || challenge.get("origins").is_some_and(|v| {
                v.as_array()
                    .is_none_or(|v| !v.iter().any(|v| v.as_str() == Some(origin)))
            })
        {
            // Keep exact-origin consent closed; never repair a saved product
            // origin into an identity-provider grant without explicit review.
            return Err(NativeAuthorityError::MfaOriginMismatch);
        }
        let vault = if let Some(vault_id) = credentials::vault_id(connection)? {
            if connection
                .pointer("/credentialSource/totpId")
                .and_then(Value::as_str)
                != Some(id)
            {
                return Err(unavailable());
            }
            Some(
                login
                    .lease
                    .read_dependency(window, state, true, &vault_id)
                    .await
                    .map_err(|_| unavailable())?,
            )
        } else {
            None
        };
        let entry = if let Some(vault) = &vault {
            // No local fallback, even if the selected vault facet was deleted.
            selected(&vault["facets"]["totp"], id)?
        } else {
            selected(&connection["totpConfigs"], id)?
        };
        let seed = Zeroizing::new(
            entry["secret"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 4096)
                .ok_or_else(unavailable)?
                .to_owned(),
        );
        let algorithm = match entry
            .get("algorithm")
            .map_or(Some("sha1"), Value::as_str)
            .ok_or_else(unavailable)?
            .to_ascii_lowercase()
            .as_str()
        {
            "sha1" => Algorithm::Sha1,
            "sha256" => Algorithm::Sha256,
            "sha512" => Algorithm::Sha512,
            _ => return Err(unavailable()),
        };
        let digits = entry
            .get("digits")
            .map_or(Some(6), Value::as_u64)
            .filter(|v| (6..=8).contains(v))
            .ok_or_else(unavailable)? as u8;
        let period = entry
            .get("period")
            .map_or(Some(30), Value::as_u64)
            .filter(|v| (1..=3600).contains(v))
            .ok_or_else(unavailable)? as u32;
        // Validate the selected seed natively; no code is kept at preparation.
        let _ = Zeroizing::new(
            generate_totp_at(&seed, digits, period, algorithm, 0).map_err(|_| unavailable())?,
        );
        let timing: Value = login
            .form_options
            .as_ref()
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or(Value::Null);
        let setup: Value = login
            .form_configuration
            .as_ref()
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or(Value::Null);
        let fill_delay = setup
            .pointer("/timing/fillDelayMs")
            .or_else(|| timing.get("fillDelayMs"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let submit_delay = setup
            .pointer("/timing/submitDelayMs")
            .or_else(|| timing.get("submitDelayMs"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if fill_delay > 30000 || submit_delay > 30000 {
            return Err(unavailable());
        }
        let mut configuration = challenge.clone();
        configuration["origin"] = origin.into();
        configuration["digits"] = digits.into();
        configuration["fillDelayMs"] = fill_delay.into();
        configuration["submitDelayMs"] = submit_delay.into();
        Ok(Some(Self {
            identity: login.identity.clone(),
            lease: login.lease.clone(),
            origin: origin.into(),
            challenge: challenge["id"].as_str().ok_or_else(unavailable)?.into(),
            paths: challenge["paths"]
                .as_array()
                .ok_or_else(unavailable)?
                .iter()
                .map(|v| v.as_str().unwrap_or_default().to_owned())
                .collect(),
            seed,
            algorithm,
            digits,
            period,
            submit_delay: Duration::from_millis(submit_delay),
            configuration,
            used: AtomicBool::new(false),
            revoked: AtomicBool::new(false),
        }))
    }

    pub(super) fn configuration(&self) -> &Value {
        &self.configuration
    }
    pub(super) fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }

    pub(super) fn current(&self, request: &NativeTotpRequest<'_>) -> bool {
        request.identity == &self.identity
            && request.origin == self.origin
            && request.challenge == self.challenge
            && !self.revoked.load(Ordering::Acquire)
            && self.lease.is_current()
            && Url::parse(request.document_url).is_ok_and(|url| {
                url.scheme() == "https"
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.origin().ascii_serialization() == self.origin
                    && self.paths.iter().any(|p| p == url.path())
            })
    }

    // A near-expired period returns a bounded wait without consuming the grant.
    // All subsequent calls must recheck consent/owner; only one code per attempt.
    pub(super) fn with_code(
        &self,
        request: &NativeTotpRequest<'_>,
        valid_until: Instant,
        auto_submit: bool,
        deliver: &mut dyn FnMut(NativeTotpCode<'_>),
    ) -> Option<Duration> {
        self.with_code_at(
            request,
            valid_until,
            auto_submit,
            Instant::now(),
            SystemTime::now(),
            deliver,
        )
    }

    fn with_code_at(
        &self,
        request: &NativeTotpRequest<'_>,
        valid_until: Instant,
        auto_submit: bool,
        now: Instant,
        wall: SystemTime,
        deliver: &mut dyn FnMut(NativeTotpCode<'_>),
    ) -> Option<Duration> {
        if !self.current(request) || now >= valid_until || self.used.load(Ordering::Acquire) {
            return None;
        }
        let time = wall.duration_since(UNIX_EPOCH).ok()?;
        let period_ms = u64::from(self.period) * 1000;
        let remaining =
            Duration::from_millis(period_ms - (time.as_millis() % u128::from(period_ms)) as u64);
        let needed = Duration::from_millis(3000)
            + if auto_submit {
                self.submit_delay
            } else {
                Duration::ZERO
            };
        if remaining <= needed {
            return (needed < Duration::from_millis(period_ms)
                && remaining <= Duration::from_secs(33))
            .then_some(remaining + Duration::from_millis(20));
        }
        let expires = valid_until.min(now + remaining);
        if expires.saturating_duration_since(now) <= needed {
            return None;
        }
        let code = Zeroizing::new(
            generate_totp_at(
                &self.seed,
                self.digits,
                self.period,
                self.algorithm,
                time.as_secs(),
            )
            .ok()?,
        );
        if !self.current(request) || self.used.swap(true, Ordering::AcqRel) {
            return None;
        }
        deliver(NativeTotpCode {
            code: &code,
            valid_until: expires,
            auto_submit,
        });
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin_browser_authority::tests::{connection, Fixture};
    use serde_json::json;

    const SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const SELECTED: &str = "11234567-89ab-4cde-8fab-0123456789ab";
    fn row() -> Value {
        let mut row = connection();
        row["httpApplication"] = json!({"version":1,"id":"gitea","loginMode":"form"});
        row["httpAutoMfa"] = json!({"version":1,"enabled":true,"totpConfigId":SELECTED,"challengeId":"gitea-totp","origin":"https://source.example"});
        row["totpConfigs"] =
            json!([{"id":SELECTED,"secret":SECRET,"digits":8,"period":30,"algorithm":"sha1"}]);
        row
    }
    fn request(identity: &BrowserIdentity) -> NativeTotpRequest<'_> {
        NativeTotpRequest {
            identity,
            origin: "https://source.example",
            document_url: "https://source.example/user/two_factor",
            challenge: "gitea-totp",
        }
    }
    struct Consent(bool, bool);
    impl NativeLoginConsentVerifier for Consent {
        fn with_current_consent(
            &self,
            _: &BrowserIdentity,
            _: &str,
            _: Option<&str>,
            deliver: &mut dyn FnMut(Instant, bool),
        ) {
            if self.0 {
                deliver(Instant::now() + Duration::from_secs(60), self.1);
            }
        }
    }

    #[tokio::test]
    async fn google_local_totp_requires_explicit_accounts_origin_consent() {
        let mut row = row();
        row["hostname"] = "analytics.google.com".into();
        row["credentialSource"] = json!({"kind":"local"});
        row["httpApplication"] = json!({"version":1,"id":"google-analytics","loginMode":"form"});
        row["httpAutoMfa"]["challengeId"] = "google-account-totp".into();
        // The old editor saved the product origin. Refuse it, with an
        // actionable fixed diagnostic containing no saved secret or URL.
        row["httpAutoMfa"]["origin"] = "https://analytics.google.com".into();
        let mut f = Fixture::new(row.clone()).await;
        f.request.initial_url = "https://analytics.google.com/analytics/web/".into();
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::MfaOriginMismatch)
        ));
        let message = NativeAuthorityError::MfaOriginMismatch.to_string();
        assert!(message.contains("re-enable automatic codes"));
        assert!(message.contains("save the connection"));
        assert!(!message.contains(SECRET));
        assert!(!message.contains("analytics.google.com"));

        // Only the caller's explicit new saved consent changes the pin.
        row["httpAutoMfa"]["origin"] = "https://accounts.google.com".into();
        f.replace_connection(row);
        let auth = f.authorize().await.unwrap();
        let totp = auth.login.totp.as_ref().unwrap();
        assert_eq!(totp.origin, "https://accounts.google.com");
        let mut request = NativeTotpRequest {
            identity: auth.policy.identity(),
            origin: "https://accounts.google.com",
            document_url: "https://accounts.google.com/v3/signin/challenge/totp",
            challenge: "google-account-totp",
        };
        assert!(totp.current(&request));
        request.origin = "https://analytics.google.com";
        request.document_url = "https://analytics.google.com/v3/signin/challenge/totp";
        assert!(!totp.current(&request));
    }

    #[tokio::test]
    async fn selected_native_totp_is_reviewed_one_shot_and_expires_at_the_period() {
        let f = Fixture::new(row()).await;
        let auth = f.authorize().await.unwrap();
        assert!(auth.login.supports_default_adapter());
        let setup: Value = serde_json::from_str(auth.login.form_configuration().unwrap()).unwrap();
        assert_eq!(setup["mfa"]["id"], "gitea-totp");
        assert!(!setup.to_string().contains(SECRET));
        let totp = auth.login.totp.as_ref().unwrap();
        let now = Instant::now();
        let mut calls = 0;
        // RFC 6238 time 1111111109; last second must defer without claiming.
        assert!(totp
            .with_code_at(
                &request(auth.policy.identity()),
                now + Duration::from_secs(60),
                true,
                now,
                UNIX_EPOCH + Duration::from_secs(1111111109),
                &mut |_| panic!("near boundary")
            )
            .is_some());
        totp.with_code_at(
            &request(auth.policy.identity()),
            now + Duration::from_secs(60),
            false,
            now,
            UNIX_EPOCH + Duration::from_secs(1111111111),
            &mut |code| {
                assert_eq!(code.code, "14050471");
                assert_eq!(code.valid_until, now + Duration::from_secs(29));
                assert!(!code.auto_submit);
                calls += 1;
            },
        );
        assert_eq!(calls, 1);
        totp.with_code_at(
            &request(auth.policy.identity()),
            now + Duration::from_secs(60),
            true,
            now,
            UNIX_EPOCH + Duration::from_secs(1111111111),
            &mut |_| panic!("replayed"),
        );
    }

    #[tokio::test]
    async fn native_totp_rechecks_owner_origin_challenge_path_consent_and_manual_submit() {
        let mut f = Fixture::new(row()).await;
        let auth = f.authorize().await.unwrap();
        let mut request = request(auth.policy.identity());
        assert!(auth
            .login
            .totp_current(&request, &Consent(true, true), false));
        assert!(!auth
            .login
            .totp_current(&request, &Consent(false, true), false));
        assert!(!auth
            .login
            .totp_current(&request, &Consent(true, true), true)); // saved manual submit default
        request.document_url = "https://source.example/user/login";
        assert!(!auth
            .login
            .totp_current(&request, &Consent(true, true), false));
        request.document_url = "https://source.example/user/two_factor";
        request.challenge = "wordpress-two-factor-totp";
        assert!(!auth
            .login
            .totp_current(&request, &Consent(true, true), false));
        request.challenge = "gitea-totp";
        request.origin = "https://other.example";
        assert!(!auth
            .login
            .totp_current(&request, &Consent(true, true), false));
        let mut changed = row();
        changed["totpConfigs"][0]["secret"] = "JBSWY3DPEHPK3PXP".into();
        f.replace_connection(changed);
        assert!(auth.lease.recheck(&f.window, &f.state).await.is_err());
        assert!(!auth.login.totp_current(
            &self::request(auth.policy.identity()),
            &Consent(true, true),
            false
        ));
    }

    #[tokio::test]
    async fn native_totp_selected_vault_dependency_revokes_on_edit_without_local_fallback() {
        let id = "01234567-89ab-4cde-8fab-0123456789ab";
        let mut row = row();
        row["credentialSource"] = json!({"kind":"vault","credentialId":id,"totpId":SELECTED});
        row["browserSession"] = json!({"version":1,"manualFormSubmit":false});
        row["totpConfigs"][0]["secret"] = false.into(); // must be ignored
        let mut data = json!({"connections":[row.clone()],"settings":{"webBrowser":{"manualFormSubmit":false}},
        "credentialVault":{"version":1,"revision":1,"entries":[{"id":id,"facets":{
            "username":"vault-user","password":"vault-password","totp":[{"id":SELECTED,"secret":SECRET,"digits":6,"period":30,"algorithm":"sha256"}]
        }}]}});
        let mut f = Fixture::new(row).await;
        f.replace_totp_fixture_data(&data);
        let auth = f.authorize().await.unwrap();
        assert!(auth.login.totp_current(
            &request(auth.policy.identity()),
            &Consent(true, true),
            true
        ));
        data["credentialVault"]["entries"][0]["facets"]["totp"][0]["secret"] =
            "JBSWY3DPEHPK3PXP".into();
        f.replace_totp_fixture_data(&data);
        assert!(auth.lease.recheck(&f.window, &f.state).await.is_err());
        assert!(!auth.login.totp_current(
            &request(auth.policy.identity()),
            &Consent(true, true),
            false
        ));
        data["credentialVault"]["entries"][0]["facets"]["totp"] = json!([]);
        f.replace_totp_fixture_data(&data);
        assert!(matches!(
            f.authorize().await,
            Err(NativeAuthorityError::CredentialUnavailable)
        ));
    }

    #[tokio::test]
    async fn native_totp_rejects_ambiguous_unsupported_or_unselected_authenticators() {
        for mode in 0..6 {
            let mut row = row();
            match mode {
                0 => {
                    row["httpAutoMfa"]["challengeId"] = "email-code".into();
                }
                1 => {
                    row["httpAutoMfa"]["origin"] = "http://source.example".into();
                }
                2 => {
                    let duplicate = row["totpConfigs"][0].clone();
                    row["totpConfigs"].as_array_mut().unwrap().push(duplicate);
                }
                3 => {
                    row["httpAutoMfa"]["totpConfigId"] = "unselected".into();
                }
                4 => {
                    row["totpConfigs"][0]["digits"] = 9.into();
                }
                _ => {
                    row["totpConfigs"][0]["period"] = 0.into();
                }
            }
            let f = Fixture::new(row).await;
            assert!(matches!(
                f.authorize().await,
                Err(NativeAuthorityError::CredentialUnavailable)
            ));
        }
        let mut row = row();
        row["httpAutoMfa"]["enabled"] = false.into();
        row["totpConfigs"] = Value::Null;
        let f = Fixture::new(row).await;
        assert!(f.authorize().await.unwrap().login.totp.is_none());
    }
}
