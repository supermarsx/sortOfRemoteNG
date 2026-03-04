//! Protocol-aware orchestrator with auto-detection for Supermicro BMCs.
//!
//! Tries Redfish first (X11+), then legacy CGI web API, then IPMI.

use crate::error::{SmcError, SmcResult};
use crate::legacy_web::LegacyWebClient;
use crate::redfish::SmcRedfishClient;
use crate::types::*;
use sorng_bmc_common::ipmi::IpmiClient;

/// Multi-protocol Supermicro BMC client.
pub struct SmcClient {
    config: SmcConfig,
    pub(crate) redfish: Option<SmcRedfishClient>,
    pub(crate) legacy_web: Option<LegacyWebClient>,
    pub(crate) ipmi: Option<IpmiClient>,
}

impl SmcClient {
    pub fn new(config: SmcConfig) -> Self {
        Self {
            config,
            redfish: None,
            legacy_web: None,
            ipmi: None,
        }
    }

    /// Connect to the BMC, auto-detecting the best available protocol.
    pub async fn connect(&mut self) -> SmcResult<()> {
        // Try Redfish first (X11+)
        if self.config.platform.supports_redfish() || self.config.platform == SmcPlatform::Unknown {
            match SmcRedfishClient::new(
                &self.config.host,
                self.config.port,
                self.config.use_ssl,
                self.config.verify_cert,
            ) {
                Ok(mut rf) => {
                    match rf.login(&self.config.username, &self.config.password).await {
                        Ok(()) => {
                            // Update platform from auto-detection
                            if self.config.platform == SmcPlatform::Unknown {
                                self.config.platform = rf.platform().clone();
                            }
                            log::info!(
                                "Connected to Supermicro {} via Redfish",
                                self.config.platform.display_name()
                            );
                            self.redfish = Some(rf);
                            return Ok(());
                        }
                        Err(e) => {
                            log::debug!("Redfish login failed, trying legacy web: {e}");
                        }
                    }
                }
                Err(e) => {
                    log::debug!("Redfish client creation failed: {e}");
                }
            }
        }

        // Try legacy CGI web API (X9–X12)
        if self.config.platform.supports_legacy_web() || self.config.platform == SmcPlatform::Unknown {
            match LegacyWebClient::new(&self.config.host, self.config.port, self.config.use_ssl) {
                Ok(mut web) => {
                    match web.login(&self.config.username, &self.config.password).await {
                        Ok(()) => {
                            log::info!("Connected to Supermicro BMC via legacy CGI web API");
                            self.legacy_web = Some(web);
                            return Ok(());
                        }
                        Err(e) => {
                            log::debug!("Legacy web login failed, trying IPMI: {e}");
                        }
                    }
                }
                Err(e) => {
                    log::debug!("Legacy web client creation failed: {e}");
                }
            }
        }

        // Fallback to IPMI
        if self.config.platform.supports_ipmi() || self.config.platform == SmcPlatform::Unknown {
            match IpmiClient::new(
                &self.config.host,
                &self.config.username,
                &self.config.password,
            ) {
                Ok(ipmi) => {
                    log::info!("Connected to Supermicro BMC via IPMI");
                    self.ipmi = Some(ipmi);
                    return Ok(());
                }
                Err(e) => {
                    log::debug!("IPMI connection failed: {e}");
                }
            }
        }

        Err(SmcError::new(
            crate::error::SmcErrorKind::Bmc(sorng_bmc_common::error::BmcErrorKind::ConnectionFailed),
            format!(
                "Failed to connect to Supermicro BMC at {}:{} via any protocol",
                self.config.host, self.config.port
            ),
        ))
    }

    /// Disconnect all protocols.
    pub async fn disconnect(&mut self) -> SmcResult<()> {
        if let Some(mut rf) = self.redfish.take() {
            let _ = rf.logout().await;
        }
        if let Some(mut web) = self.legacy_web.take() {
            let _ = web.logout().await;
        }
        self.ipmi = None;
        Ok(())
    }

    /// Whether we have an active connection.
    pub fn is_connected(&self) -> bool {
        self.redfish.as_ref().map_or(false, |r| r.is_connected())
            || self.legacy_web.as_ref().map_or(false, |w| w.is_connected())
            || self.ipmi.is_some()
    }

    /// Check / refresh the session.
    pub async fn check_session(&self) -> SmcResult<bool> {
        if let Some(ref rf) = self.redfish {
            return rf.check_session().await;
        }
        if let Some(ref web) = self.legacy_web {
            return Ok(web.is_connected());
        }
        if self.ipmi.is_some() {
            return Ok(true);
        }
        Ok(false)
    }

    /// Require Redfish client or return error.
    pub(crate) fn require_redfish(&self) -> SmcResult<&SmcRedfishClient> {
        self.redfish.as_ref().ok_or_else(|| {
            SmcError::new(
                crate::error::SmcErrorKind::Bmc(sorng_bmc_common::error::BmcErrorKind::ProtocolNotSupported),
                "Redfish not available — platform may not support it or not connected",
            )
        })
    }

    /// Require legacy web client or return error.
    pub(crate) fn require_legacy_web(&self) -> SmcResult<&LegacyWebClient> {
        self.legacy_web.as_ref().ok_or_else(|| {
            SmcError::new(
                crate::error::SmcErrorKind::Bmc(sorng_bmc_common::error::BmcErrorKind::ProtocolNotSupported),
                "Legacy web API not available — platform may not support it or not connected",
            )
        })
    }

    /// Require IPMI client or return error.
    #[allow(dead_code)]
    pub(crate) fn require_ipmi(&self) -> SmcResult<&IpmiClient> {
        self.ipmi.as_ref().ok_or_else(|| {
            SmcError::new(
                crate::error::SmcErrorKind::Bmc(sorng_bmc_common::error::BmcErrorKind::ProtocolNotSupported),
                "IPMI not available — not connected via IPMI",
            )
        })
    }

    /// Get safe configuration (no password).
    pub fn get_config_safe(&self) -> SmcConfigSafe {
        SmcConfigSafe::from(&self.config)
    }

    /// Get detected platform.
    pub fn platform(&self) -> &SmcPlatform {
        &self.config.platform
    }
}
