//! Owned loopback HTTP/3 acceptance fixture. Default tests exercise the native
//! QUIC origin/client and shared route boundary without CEF. The opt-in `cef`
//! feature builds a separate production-factory CEF/owned-proxy fixture; only
//! its actual, independently assessed private runs can prove CEF HTTP/3.
pub mod server;

#[cfg(feature = "cef")]
pub mod cef_fixture;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub const HOST: &str = "http3.fixture.test";
pub(crate) const OTHER: &str = "alternate-http3.fixture.test";
#[cfg(feature = "cef")]
pub(crate) const ORIGIN: &str = "https://http3.fixture.test";
pub const CHECKS: &[&str] = &[
    "multiplex",
    "deny",
    "delay",
    "revoke",
    "isolation",
    "cross-authority",
    "h2-fallback",
    "h1-fallback",
];

/// Shared by the real CEF TCP/UDP dialers and native-only boundary tests.
pub fn valid_target(host: &str, port: u16) -> bool {
    [HOST, OTHER].contains(&host) && port == 443
}

pub fn known_check(value: &str) -> bool {
    CHECKS.contains(&value)
}
