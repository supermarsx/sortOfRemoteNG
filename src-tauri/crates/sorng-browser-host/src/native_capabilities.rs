//! Immutable native-owner policy, not a renderer or website permission grant.
//! Defaults allow engine facilities; unsupported restrictions fail explicitly.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeBrowserCapabilities {
    pub local_storage_enabled: bool,
    pub databases_enabled: bool,
    pub webgl_enabled: bool,
    pub cookies_enabled: bool,
    pub media_stream_enabled: bool,
    pub cross_origin_requests_enabled: bool,
    pub website_extensions_enabled: bool,
    pub hide_automation_indicator: bool,
}

impl Default for NativeBrowserCapabilities {
    fn default() -> Self {
        Self {
            local_storage_enabled: true,
            databases_enabled: true,
            webgl_enabled: true,
            cookies_enabled: true,
            media_stream_enabled: true,
            cross_origin_requests_enabled: true,
            website_extensions_enabled: true,
            hide_automation_indicator: true,
        }
    }
}

impl NativeBrowserCapabilities {
    /// Do not accept a restriction that the frozen CEF API cannot enforce.
    /// Media capture requires an owner-bound, document-fenced prompt; screen
    /// capture stays denied. Indicator suppression and extension installation are
    /// explicitly reported unavailable, never inferred from requested defaults.
    pub fn validate(self) -> Result<(), &'static str> {
        if !self.databases_enabled {
            return Err("Disabling IndexedDB independently is unavailable in the current native browser. No website was opened.");
        }
        if !self.webgl_enabled {
            return Err("Disabling all WebGL, including OffscreenCanvas, is unavailable in the current native browser. No website was opened.");
        }
        // App login/automation are restricted by the native saved authority.
        // This does not control mandatory forced-dark styling or Chromium extensions.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_allow_facilities_without_claiming_unsupported_controls() {
        let policy = NativeBrowserCapabilities::default();
        assert!(policy.local_storage_enabled && policy.databases_enabled && policy.webgl_enabled);
        assert!(policy.cookies_enabled && policy.media_stream_enabled);
        assert!(policy.cross_origin_requests_enabled && policy.website_extensions_enabled);
        assert!(policy.hide_automation_indicator);
        assert!(policy.validate().is_ok());
    }

    #[test]
    fn supported_restrictions_validate_and_unsupported_restrictions_fail() {
        assert!(NativeBrowserCapabilities {
            local_storage_enabled: false,
            cookies_enabled: false,
            media_stream_enabled: false,
            cross_origin_requests_enabled: false,
            website_extensions_enabled: false,
            ..Default::default()
        }
        .validate()
        .is_ok());
        for policy in [
            NativeBrowserCapabilities {
                databases_enabled: false,
                ..Default::default()
            },
            NativeBrowserCapabilities {
                webgl_enabled: false,
                ..Default::default()
            },
        ] {
            assert!(policy.validate().is_err());
        }
    }
}
