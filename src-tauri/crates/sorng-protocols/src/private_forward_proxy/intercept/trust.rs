//! K2: upstream trust decision (owner: x2).
//!
//! After the upstream TLS handshake and before any request byte, the proxy
//! hands the chain as sent to `UpstreamTrust::evaluate`. The app implements it
//! over the existing certificate authority, Trust Center records and review
//! prompt. Anything but `Admit` fails closed.

use crate::private_forward_proxy::Authority;
use std::future::Future;
use std::pin::Pin;

/// Non-overridable upstream failures: deny with no prompt.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum UpstreamFatal {
    Revoked,
    BadSignature,
    Malformed,
    WeakKey,
    Protocol,
    HstsViolation,
}

/// Evidence from one upstream handshake. No `Debug`: certificates are never
/// logged.
#[derive(Clone)]
pub struct UpstreamEvidence {
    pub authority: Authority,
    /// Chain exactly as the server sent it, leaf first.
    pub chain_der: Vec<Vec<u8>>,
    /// The platform verifier accepted the chain for this name (OS roots).
    pub system_ca_valid: bool,
    /// A temporary ("allow once") admission is acceptable for this exchange.
    pub temporary_ok: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum UpstreamVerdict {
    /// `persistent == false` for allow-once/temporary admissions; those
    /// responses are never disk-cached.
    Admit {
        persistent: bool,
    },
    Deny,
    Timeout,
}

pub type UpstreamTrustFuture = Pin<Box<dyn Future<Output = UpstreamVerdict> + Send>>;

pub trait UpstreamTrust: Send + Sync + 'static {
    fn evaluate(&self, e: UpstreamEvidence) -> UpstreamTrustFuture;
}

/// Fail-closed default: denies every upstream.
#[derive(Clone, Copy, Debug, Default)]
pub struct DenyAllUpstreamTrust;

impl UpstreamTrust for DenyAllUpstreamTrust {
    fn evaluate(&self, e: UpstreamEvidence) -> UpstreamTrustFuture {
        drop(e);
        Box::pin(async { UpstreamVerdict::Deny })
    }
}
