// ── sorng-voip-phone – VoIP desk-phone web-admin integration ─────────────────
//! Vendor-pluggable driver for SIP desk phones' web-admin interfaces.
//!
//! v1 ships the Yealink T2x driver (`vendor::yealink`), written
//! *detection-first*: it probes the phone, classifies the firmware generation
//! (legacy `ConfigManApp.com` + HTTP Basic vs. `servlet` form login), tries the
//! most likely login shape and reports a structured
//! [`types::VoipPhoneAuthShape`] in errors so odd firmware can be diagnosed
//! from a log without a redesign. Every request shape lives in ONE table
//! ([`endpoints`]).
//!
//! Tauri command wrappers are owned and compiled by `sorng-commands-remote`;
//! this domain crate owns the shared service and managed-state types.

pub mod endpoints;
pub mod error;
pub mod service;
pub mod trust;
pub mod types;
pub mod vendor;

pub use error::{VoipPhoneError, VoipPhoneErrorKind, VoipPhoneResult};
pub use service::{VoipPhoneService, VoipPhoneServiceState};
pub use types::*;
