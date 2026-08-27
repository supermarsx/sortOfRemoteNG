//! Vendor driver abstraction. v1: Yealink only. Other vendors (Grandstream,
//! Snom, …) plug in here without touching the service, types or commands.

pub mod yealink;

use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;
use sorng_tls_trust::{skip_flag_to_override, TofuTlsContext};

use crate::error::{VoipPhoneError, VoipPhoneResult};
use crate::trust::trust_store_handle;
use crate::types::*;

/// Shared HTTP transport handed to every driver: a cookie-jar client that
/// never follows redirects (the drivers classify `Location` themselves),
/// the phone's base URL and the credentials.
pub struct PhoneHttp {
    pub client: Client,
    pub base_url: String,
    pub username: String,
    /// Never logged, never serialized — lives only as long as the session.
    pub password: String,
    pub action_uri_enabled: bool,
    pub auth_mode: VoipPhoneAuthMode,
}

impl PhoneHttp {
    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}

/// Build the transport for a config. HTTPS goes through the Trust Center
/// (TOFU by default; `verify_cert == false` becomes a visible AlwaysTrust
/// override) — there is no blind certificate skip anywhere in this crate.
pub fn build_http(config: &VoipPhoneConnectionConfig) -> VoipPhoneResult<PhoneHttp> {
    if config.host.trim().is_empty() {
        return Err(VoipPhoneError::connection("Phone host is empty"));
    }
    let builder = Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(config.timeout_secs.max(1)));

    let client = if config.use_ssl {
        let ctx = TofuTlsContext {
            store: trust_store_handle(),
            host: config.host.clone(),
            port: config.port,
            policy_override: skip_flag_to_override(!config.verify_cert),
        };
        sorng_tls_trust::build_tofu_client(builder, ctx)
            .map_err(|e| VoipPhoneError::connection(format!("Failed to create HTTP client: {e}")))?
    } else {
        builder
            .build()
            .map_err(|e| VoipPhoneError::connection(format!("Failed to create HTTP client: {e}")))?
    };

    Ok(PhoneHttp {
        client,
        base_url: config.base_url(),
        username: config.username.clone(),
        password: config.password.clone(),
        action_uri_enabled: config.action_uri_enabled,
        auth_mode: config.auth_mode,
    })
}

/// One vendor's web-admin behaviour. Drivers are stateless: the session
/// (generation + auth shape) is owned by the service and passed back in.
#[async_trait]
pub trait VendorDriver: Send + Sync {
    fn vendor(&self) -> VoipPhoneVendor;
    /// Classify the firmware generation without authenticating.
    async fn detect(&self, http: &PhoneHttp) -> VoipPhoneResult<VoipPhoneGeneration>;
    /// Authenticate; returns the shape that worked.
    async fn login(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<VoipPhoneAuthShape>;
    async fn status(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
        auth_shape: VoipPhoneAuthShape,
    ) -> VoipPhoneResult<VoipPhoneStatus>;
    async fn reboot(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<VoipRebootResult>;
    async fn logout(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<()>;
    /// Selectors/URL for the embedded-browser auto-login.
    fn web_login_hint(&self, http: &PhoneHttp, generation: VoipPhoneGeneration) -> WebLoginHint;
    /// The page to open in a browser for this generation.
    fn web_ui_url(&self, http: &PhoneHttp, generation: VoipPhoneGeneration) -> String;
    /// The login shape the driver tries first for a generation.
    fn expected_auth_shape(&self, generation: VoipPhoneGeneration) -> VoipPhoneAuthShape;
}

/// Resolve the driver for a vendor.
pub fn driver_for(vendor: VoipPhoneVendor) -> Box<dyn VendorDriver> {
    match vendor {
        VoipPhoneVendor::Yealink => Box::new(yealink::YealinkDriver),
    }
}
