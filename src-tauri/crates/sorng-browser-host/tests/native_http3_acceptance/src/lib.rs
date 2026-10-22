//! Owned loopback HTTP/3 acceptance fixture. This initial crate proves the
//! synthetic origin and native QUIC client, not CEF or the app's proxy route.
pub mod server;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
