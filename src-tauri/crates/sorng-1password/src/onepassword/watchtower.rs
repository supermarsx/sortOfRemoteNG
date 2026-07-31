use super::api_client::OnePasswordApiClient;
use super::types::*;

/// Authoritative Watchtower results are not exposed by 1Password Connect.
///
/// Locally guessed compromised-password, vulnerable-site, or two-factor
/// availability values would misrepresent the user's security posture. These
/// entry points therefore fail closed until an authoritative provider exists.
pub struct OnePasswordWatchtower;

impl OnePasswordWatchtower {
    pub async fn analyze_all(
        _client: &OnePasswordApiClient,
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        Err(Self::unavailable())
    }

    pub async fn analyze_vault(
        _client: &OnePasswordApiClient,
        _vault_id: &str,
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        Err(Self::unavailable())
    }

    fn unavailable() -> OnePasswordError {
        OnePasswordError::forbidden(
            "Authoritative 1Password Watchtower results are unavailable through Connect",
        )
    }
}
