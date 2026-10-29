//! t-mitmproxy: per-attempt TLS-terminating, trust-owning, caching proxy.
//!
//! Contracts skeleton (batch M0). Every entry point here is a fail-closed stub:
//! authority generation and server configs return an `Unsupported` io error,
//! and nothing in the relay switches to interception yet. The passthrough
//! relay in `private_forward_proxy.rs` is unchanged.
//!
//! Module ownership for batch M1 (add the `mod` lines below in this file):
//! - x1: `accept`, `server`, `forward`, `websocket` (+ `tests_core`), and the
//!   bodies of `ca` and `hooks`;
//! - x2: `upstream`, `upstream_verify`, `pool`, and the body of `trust`;
//! - x3: everything under `cache/` (`store`, `policy`, `crypto`, `memory`,
//!   declared in `cache/mod.rs`).
//!
//! Diagnostics are fixed enums and counters only: never hosts, URLs,
//! headers or certificates.

use std::io;
use std::sync::Arc;

pub mod ca;
pub mod cache;
pub mod hooks;
pub mod trust;
pub(crate) type ProxyBody =
    http_body_util::combinators::BoxBody<hyper::body::Bytes, std::io::Error>;
// x1: mod accept; mod server; mod forward; mod websocket;
// x2: mod upstream; mod upstream_verify; mod pool;

pub use ca::InterceptAuthority;
pub use cache::{CacheMode, DiskCacheConfig};
pub use hooks::{
    ExchangeCtx, ExchangeHook, HeadEditRefused, HookVerdict, RequestHeadView, ResponseHeadView,
    StaticResponse,
};
pub use trust::{
    DenyAllUpstreamTrust, UpstreamEvidence, UpstreamFatal, UpstreamTrust, UpstreamTrustFuture,
    UpstreamVerdict,
};

/// Everything one intercepting attempt needs. One per `OriginBrowserSession`;
/// never shared between attempts.
pub struct InterceptConfig {
    pub authority: Arc<InterceptAuthority>,
    pub trust: Arc<dyn UpstreamTrust>,
    pub cache: CacheMode,
    pub hooks: Vec<Arc<dyn ExchangeHook>>,
}

/// The error every unimplemented interception path returns. Callers treat it
/// as "interception unavailable" and fail closed (or fall back to passthrough
/// only before the browser context exists).
pub(crate) fn unavailable() -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, "TLS interception unavailable")
}

/// K6: whether this attempt intercepts.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum InterceptState {
    Active,
    Unavailable,
    Passthrough,
}

impl InterceptState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Unavailable => "unavailable",
            Self::Passthrough => "passthrough",
        }
    }
}

/// K6: how one upstream connection attempt ended.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum UpstreamOutcome {
    Admitted,
    Denied,
    Fatal(UpstreamFatal),
    Timeout,
    RouteFailed,
}

impl UpstreamOutcome {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Admitted => "admitted",
            Self::Denied => "denied",
            Self::Fatal(_) => "fatal",
            Self::Timeout => "timeout",
            Self::RouteFailed => "route-failed",
        }
    }
}

/// K6: why an attempt uses the in-memory cache instead of disk.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum MemoryCacheReason {
    /// The disk cache is disabled in settings.
    Disabled,
    /// The cache root is not eligible (roaming/synced/unavailable).
    Ineligible,
    /// Another attempt of this connection holds a different binding.
    BindingMismatch,
    /// The disk store failed to open; memory keeps the attempt working.
    StoreUnavailable,
}

impl MemoryCacheReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Ineligible => "ineligible",
            Self::BindingMismatch => "binding-mismatch",
            Self::StoreUnavailable => "store-unavailable",
        }
    }
}

/// K6: which cache an attempt uses.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum CacheUse {
    Disk,
    Memory(MemoryCacheReason),
    Off,
}

impl CacheUse {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disk => "disk",
            Self::Memory(_) => "memory",
            Self::Off => "off",
        }
    }
}

/// K6: cache counters for one attempt.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct CacheCounters {
    pub hits: u64,
    pub misses: u64,
    pub revalidations: u64,
    pub stores: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::private_forward_proxy::Authority;

    #[test]
    fn skeleton_fails_closed() {
        let err = match InterceptAuthority::generate() {
            Ok(_) => panic!("skeleton must not mint a CA"),
            Err(err) => err,
        };
        assert_eq!(err.kind(), io::ErrorKind::Unsupported);
    }

    #[tokio::test]
    async fn deny_all_trust_denies() {
        let evidence = UpstreamEvidence {
            authority: Authority::parse("example.test:443").expect("authority"),
            chain_der: vec![vec![0x30]],
            system_ca_valid: true,
            temporary_ok: false,
        };
        assert_eq!(
            DenyAllUpstreamTrust.evaluate(evidence).await,
            UpstreamVerdict::Deny
        );
    }

    #[test]
    fn diagnostics_are_fixed_strings() {
        assert_eq!(InterceptState::Unavailable.as_str(), "unavailable");
        assert_eq!(
            UpstreamOutcome::Fatal(UpstreamFatal::Revoked).as_str(),
            "fatal"
        );
        assert_eq!(
            CacheUse::Memory(MemoryCacheReason::Ineligible).as_str(),
            "memory"
        );
        assert_eq!(CacheCounters::default().hits, 0);
    }
}
