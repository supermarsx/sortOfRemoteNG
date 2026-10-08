//! Separate native OTP authority contract. Seeds never cross this interface.
use sorng_protocols::origin_browser::BrowserIdentity;
use std::time::Instant;

pub struct NativeTotpRequest<'a> {
    pub identity: &'a BrowserIdentity,
    pub origin: &'a str,
    pub document_url: &'a str,
    pub challenge: &'a str,
}

pub struct NativeTotpCode<'a> {
    pub code: &'a str,
    pub valid_until: Instant,
    pub auto_submit: bool,
}

#[cfg(feature = "cef-host")]
pub(crate) const REQUEST: &str = "sorng.native.totp.request.v1";
#[cfg(feature = "cef-host")]
pub(crate) const DELIVERY: &str = "sorng.native.totp.delivery.v1";

#[path = "native_auth_input.rs"]
pub mod input;
