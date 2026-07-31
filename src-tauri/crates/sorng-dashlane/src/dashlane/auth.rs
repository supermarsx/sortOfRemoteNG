use crate::dashlane::api_client::DashlaneApiClient;
use crate::dashlane::types::{DashlaneConfig, DashlaneError, DashlaneSession};

/// Dashlane does not publish a stable third-party password authentication
/// protocol. Sending a master password, a derivative, or an OTP to guessed
/// private endpoints is unsafe, so interactive login fails closed.
pub async fn login(
    _client: &mut DashlaneApiClient,
    _config: &DashlaneConfig,
    _master_password: &str,
    _email_token: Option<&str>,
) -> Result<DashlaneSession, DashlaneError> {
    Err(DashlaneError::unsupported(
        "Direct Dashlane password login is unavailable; use an officially supported authorization flow",
    ))
}

pub async fn logout(client: &mut DashlaneApiClient) -> Result<(), DashlaneError> {
    client.clear_session();
    Ok(())
}

pub fn validate_session(
    session: &Option<DashlaneSession>,
) -> Result<&DashlaneSession, DashlaneError> {
    session
        .as_ref()
        .ok_or_else(|| DashlaneError::auth_failed("Not logged in to Dashlane"))
}
