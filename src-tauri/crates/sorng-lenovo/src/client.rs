//! Protocol-aware orchestrator with auto-detection for Lenovo BMCs.
//!
//! `LenovoClient` owns one or more protocol backends (Redfish, Legacy REST, IPMI)
//! and routes requests to the appropriate backend based on controller generation.

use crate::error::{LenovoError, LenovoResult};
use crate::legacy_rest::LegacyRestClient;
use crate::redfish::LenovoRedfishClient;
use crate::types::*;
use sorng_bmc_common::ipmi::IpmiClient;

/// Unified Lenovo management client wrapping all protocol backends.
pub struct LenovoClient {
    pub redfish: Option<LenovoRedfishClient>,
    pub legacy_rest: Option<LegacyRestClient>,
    pub ipmi: Option<IpmiClient>,
    pub detected_protocol: LenovoProtocol,
    pub generation: XccGeneration,
    pub config: LenovoConfig,
}

impl LenovoClient {
    /// Create a new client (not yet connected).
    pub fn new(config: &LenovoConfig) -> LenovoResult<Self> {
        Ok(Self {
            redfish: None,
            legacy_rest: None,
            ipmi: None,
            detected_protocol: config.protocol.clone().unwrap_or(LenovoProtocol::Redfish),
            generation: config.generation.clone().unwrap_or(XccGeneration::Unknown),
            config: config.clone(),
        })
    }

    /// Connect and detect the best available protocol.
    pub async fn connect(&mut self) -> LenovoResult<String> {
        if let Some(ref forced) = self.config.protocol {
            match forced {
                LenovoProtocol::Redfish => return self.connect_redfish().await,
                LenovoProtocol::LegacyRest => return self.connect_legacy_rest().await,
                LenovoProtocol::Ipmi => return self.connect_ipmi().await,
            }
        }

        // Auto-detect: Redfish → Legacy REST → IPMI
        if let Ok(msg) = self.connect_redfish().await {
            self.detected_protocol = LenovoProtocol::Redfish;
            return Ok(msg);
        }

        log::info!("Redfish not available, trying IMM2 legacy REST...");
        if let Ok(msg) = self.connect_legacy_rest().await {
            self.detected_protocol = LenovoProtocol::LegacyRest;
            return Ok(msg);
        }

        log::info!("Legacy REST not available, trying IPMI...");
        if let Ok(msg) = self.connect_ipmi().await {
            self.detected_protocol = LenovoProtocol::Ipmi;
            return Ok(msg);
        }

        Err(LenovoError::connection(
            "Could not connect via Redfish, Legacy REST, or IPMI. Check host/credentials.",
        ))
    }

    async fn connect_redfish(&mut self) -> LenovoResult<String> {
        let mut client = LenovoRedfishClient::new(&self.config)?;
        let msg = client.login().await?;
        self.generation = client.generation().clone();
        self.redfish = Some(client);
        Ok(msg)
    }

    async fn connect_legacy_rest(&mut self) -> LenovoResult<String> {
        let mut client = LegacyRestClient::new(&self.config)?;
        let msg = client.login().await?;
        self.generation = XccGeneration::Imm2;
        self.legacy_rest = Some(client);
        Ok(msg)
    }

    async fn connect_ipmi(&mut self) -> LenovoResult<String> {
        let client = IpmiClient::new(
            &self.config.host,
            Some(self.config.ipmi_port),
            &self.config.username,
            &self.config.password,
            self.config.timeout_secs,
        );
        if client.check_connection().await.map_err(LenovoError::from)? {
            let msg = format!("Connected to {} via IPMI", self.config.host);
            if self.generation == XccGeneration::Unknown {
                self.generation = XccGeneration::Imm;
            }
            self.ipmi = Some(client);
            Ok(msg)
        } else {
            Err(LenovoError::connection("IPMI connection check failed"))
        }
    }

    /// Disconnect all protocol backends.
    pub async fn disconnect(&mut self) -> LenovoResult<()> {
        if let Some(ref mut rf) = self.redfish {
            let _ = rf.logout().await;
        }
        if let Some(ref mut lr) = self.legacy_rest {
            let _ = lr.logout().await;
        }
        self.redfish = None;
        self.legacy_rest = None;
        self.ipmi = None;
        Ok(())
    }

    /// Check if any protocol backend is connected.
    pub fn is_connected(&self) -> bool {
        self.redfish
            .as_ref()
            .map(|c| c.is_connected())
            .unwrap_or(false)
            || self
                .legacy_rest
                .as_ref()
                .map(|c| c.is_connected())
                .unwrap_or(false)
            || self.ipmi.is_some()
    }

    /// Check session validity.
    pub async fn check_session(&self) -> LenovoResult<bool> {
        if let Some(ref rf) = self.redfish {
            return rf.check_session().await;
        }
        if let Some(ref lr) = self.legacy_rest {
            return Ok(lr.is_connected());
        }
        if let Some(ref ipmi) = self.ipmi {
            return ipmi.check_connection().await.map_err(LenovoError::from);
        }
        Ok(false)
    }

    /// Require Redfish backend or error.
    pub fn require_redfish(&self) -> LenovoResult<&LenovoRedfishClient> {
        self.redfish
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| {
                LenovoError::unsupported(
                    "This operation requires Redfish (XCC/XCC2). Not connected via Redfish.",
                )
            })
    }

    /// Require legacy REST backend or error.
    pub fn require_legacy_rest(&self) -> LenovoResult<&LegacyRestClient> {
        self.legacy_rest
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| {
                LenovoError::unsupported(
                "This operation requires the IMM2 legacy REST API. Not connected via Legacy REST.",
            )
            })
    }

    /// Require IPMI backend or error.
    pub fn require_ipmi(&self) -> LenovoResult<&IpmiClient> {
        self.ipmi.as_ref().ok_or_else(|| {
            LenovoError::unsupported("This operation requires IPMI. Not connected via IPMI.")
        })
    }

    /// Get safe config info (no secrets).
    pub fn get_config_safe(&self) -> LenovoConfigSafe {
        LenovoConfigSafe {
            host: self.config.host.clone(),
            port: self.config.port,
            username: self.config.username.clone(),
            insecure: self.config.insecure,
            generation: self.generation.clone(),
            protocol: self.detected_protocol.clone(),
        }
    }
}
