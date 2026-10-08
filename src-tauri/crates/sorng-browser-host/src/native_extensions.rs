//! Native app-extension restriction. Not a Chromium extension loader or a grant.
//! The production authority also enforces this at credential delivery and each
//! automation permission check. The wired receipt describes installed gates;
//! it never grants credential, script or network authority.

use crate::ipc::OriginBrowserIdentity;
use crate::native_automation::{
    NativeAutomationAction, NativeAutomationFailure, NativeAutomationPermissions,
};
use serde::{Deserialize, Serialize};
use sorng_protocols::origin_browser::BrowserIdentity;

pub const CHROMIUM_EXTENSION_UNAVAILABLE: &str =
    "Installing Chromium extensions is unavailable in this isolated native browser. The bundled engine has no per-connection extension installation API.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeBrowserExtensionRequest {
    pub identity: OriginBrowserIdentity,
}

impl NativeBrowserExtensionRequest {
    pub fn validate(&self) -> Result<(), crate::ipc::OriginBrowserIpcError> {
        self.identity.validate()
    }
}

/// Cannot be deserialized from an IPC payload. Identity and preference are
/// captured by native authorization from the saved owning database connection.
pub struct NativeExtensionGate {
    identity: BrowserIdentity,
    enabled: bool,
}

/// Returned only by the trusted native owner after installing this gate and
/// establishing the existing readiness/forced-dark gates. Not an IPC input.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBrowserExtensionReceipt {
    pub version: u8,
    pub identity: OriginBrowserIdentity,
    pub app_controls: bool,
    pub app_enabled: bool,
    pub forced_dark: bool,
    pub chromium: &'static str,
}

impl NativeExtensionGate {
    pub fn new(identity: BrowserIdentity, saved_enabled: bool) -> Self {
        Self {
            identity,
            enabled: saved_enabled,
        }
    }

    /// Apply before adapter selection and again before any credential delivery.
    /// Existing origin/document, consent and credential checks remain required.
    pub fn permits_login(&self, identity: &BrowserIdentity, already_authorized: bool) -> bool {
        identity == &self.identity && self.enabled && already_authorized
    }

    /// Check after native owner revalidation, before invoking the native browser.
    /// Cancellation remains possible after revocation, with the same identity.
    pub fn authorize_automation(
        &self,
        identity: &BrowserIdentity,
        action: &NativeAutomationAction,
        authorized: NativeAutomationPermissions,
    ) -> Result<NativeAutomationPermissions, NativeAutomationFailure> {
        if identity != &self.identity {
            return Err(NativeAutomationFailure::Denied);
        }
        let permissions = authorized.restrict_website_extensions(self.enabled);
        action.validate(permissions)?;
        Ok(permissions)
    }

    pub fn app_enabled(&self) -> bool {
        self.enabled
    }

    pub fn receipt(
        &self,
        identity: &BrowserIdentity,
    ) -> Result<NativeBrowserExtensionReceipt, NativeAutomationFailure> {
        if identity != &self.identity {
            return Err(NativeAutomationFailure::Denied);
        }
        Ok(NativeBrowserExtensionReceipt {
            version: 1,
            identity: OriginBrowserIdentity::from_native(&self.identity),
            app_controls: true,
            app_enabled: self.enabled,
            forced_dark: true,
            chromium: "unsupportedPrivateContext",
        })
    }
}

/// CEF 154 exposes no request-context LoadExtension API. Chromium's CDP
/// Extensions.loadUnpacked/GetExtensions/Uninstall use the DEFAULT context,
/// not this connection's private OTR context. Never substitute those paths.
pub fn require_chromium_extension_installation() -> Result<(), &'static str> {
    Err(CHROMIUM_EXTENSION_UNAVAILABLE)
}
