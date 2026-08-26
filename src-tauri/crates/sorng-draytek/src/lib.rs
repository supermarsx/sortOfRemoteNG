// ── sorng-draytek – DrayTek Vigor (DrayOS) web-admin session management ──────
//!
//! Vendor-generic network-appliance integration (`vendor = "draytek"`) that
//! mirrors the pfSense integration skeleton: a cookie-session HTTP client,
//! a status parser, state-changing actions (reboot), pure CLI string
//! builders/parsers for the SSH/telnet path, and a connection-map service.
//!
//! Login flow (DrayOS):
//! 1. `GET /weblogin.htm` primes the cookie jar and, on ≥ 4.4 firmware,
//!    exposes an anti-CSRF token `sFormAuthStr` that is scraped from the page.
//! 2. `POST /cgi-bin/wlogin.cgi` with `aa = base64(user)`, `ab = base64(pass)`
//!    and, when scraped, `sFormAuthStr`.
//! 3. Success = `SESSION_ID_VIGOR` cookie issued and the login form gone.
//!
//! Firmware that RSA-encrypts the password client-side is detected and
//! reported as [`error::DraytekErrorKind::UnsupportedFirmwareLogin`] so the
//! UI can steer the admin to "Open Web UI" instead of failing silently.

pub mod actions;
pub mod cli;
pub mod client;
pub mod error;
pub mod service;
pub mod status;
pub mod types;
