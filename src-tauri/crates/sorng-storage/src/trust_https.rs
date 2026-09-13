//! HTTPS-only CA admission. The native command supplies a proof validator,
//! never a renderer assertion about certificate issuers or validity.
use super::*;

#[cfg(test)]
#[path = "trust_https_tests.rs"]
mod tests;

impl TrustStoreService {
    /// Keep the same fresh database I/O lease across existing policy/pin checks
    /// and native proof consumption. CA first-use does not persist a new pin.
    pub fn verify_https_with_ca(
        &mut self,
        host: &str,
        identity: Identity,
        requested_policy: TrustPolicy,
        request_system_ca: bool,
        validate_native_proof: impl FnOnce(&str, u16, &str) -> Result<(), String>,
    ) -> Result<(TrustVerifyResult, bool), String> {
        validate_identity(&identity, "https")?;
        let (certificate_host, port) = scope::endpoint_authority(host)?;
        let fingerprint = Self::identity_fingerprint(&identity).to_owned();
        self.backend.with_data(|data| {
            let decision = (|| {
                // Resolve the exact same connection-scoped/fallback record as
                // ordinary verification; conflicting aliases fail closed.
                let key = scope::effective_key(data, host, "https")?;
                let effective_policy = data
                    .records
                    .get(&key)
                    .and_then(|record| record.host_policy.as_ref())
                    .unwrap_or(&data.policy)
                    .clone();
                let result = verify_identity_in_data(data, host, "https", identity);
                let clean_first_use = matches!(
                    &result,
                    TrustVerifyResult::FirstUse {
                        requires_approval: false,
                        ..
                    }
                );
                let ca_trusted = request_system_ca
                    && requested_policy == TrustPolicy::Tofu
                    && effective_policy == TrustPolicy::Tofu
                    && clean_first_use
                    && !data.records.contains_key(&key)
                    && !fresh_approval_keys(data).contains(&key);
                if ca_trusted {
                    validate_native_proof(&certificate_host, port, &fingerprint)?;
                }
                Ok((result, ca_trusted))
            })();
            let dirty = decision.is_ok()
                && data
                    .records
                    .contains_key(&scope::effective_key(data, host, "https").unwrap_or_default());
            (decision, dirty)
        })?
    }
}
