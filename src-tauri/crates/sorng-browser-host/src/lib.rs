//! Real-origin host components under development. Not a renderer-selectable
//! capability and not yet wired to website tabs. The optional CEF integration
//! keeps native website surfaces separate from the privileged Tauri webview.
//!
//! Installing a proxy preference or constructing a request context does not
//! establish traffic containment. This crate must not emit a production Ready
//! report until the pinned runtime passes every platform acceptance gate.

pub mod control;
pub mod domain_permissions;
pub mod ipc;
pub mod message_pump;
pub mod native_automation;
pub mod native_capabilities;
pub mod cef_session_retention;
#[cfg(any(feature = "cef-host", test))]
pub mod native_features;
pub mod native_media;

#[cfg(feature = "cef-host")]
mod cef_renderer;

#[cfg(feature = "cef-host")]
pub mod platform;

#[cfg(any(feature = "cef-host", test))]
mod proxy_config;

#[cfg(feature = "cef-host")]
pub mod cef_context;

#[cfg(feature = "cef-host")]
pub mod cef_tls_bridge;

#[cfg(feature = "cef-host")]
pub mod cef_requests;

#[cfg(feature = "cef-host")]
pub mod bootstrap_platform;

#[cfg(feature = "cef-host")]
pub mod cef_runtime;

#[cfg(feature = "cef-host")]
pub mod cef_browser;
