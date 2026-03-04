//! Protocol-aware orchestrator with auto-detection for HP iLO.
//!
//! `IloClient` owns one or more protocol backends (Redfish, RIBCL, IPMI)
//! and routes requests to the best available backend based on iLO generation.

use crate::error::{IloError, IloResult};
use crate::redfish::IloRedfishClient;
use crate::ribcl::RibclClient;
use crate::types::*;

use sorng_bmc_common::ipmi::IpmiClient;

/// Unified iLO client wrapping all protocol backends.
pub struct IloClient {
    pub redfish: Option<IloRedfishClient>,
    pub ribcl: Option<RibclClient>,
    pub ipmi: Option<IpmiClient>,
    pub detected_protocol: IloProtocol,
    pub generation: IloGeneration,
    pub config: IloConfig,
}

impl IloClient {
    /// Build a new client from config.
    pub fn new(config: &IloConfig) -> IloResult<Self> {
        Ok(Self {
            redfish: None,
            ribcl: None,
            ipmi: None,
            detected_protocol: config.protocol.clone().unwrap_or(IloProtocol::Redfish),
            generation: IloGeneration::Unknown,
            config: config.clone(),
        })
    }

    /// Connect and detect the best available protocol.
    ///
    /// Strategy:
    /// 1. If protocol is forced, use only that.
    /// 2. Try Redfish first (iLO 4+).
    /// 3. Try RIBCL (iLO 1-5).
    /// 4. Try IPMI (all generations, basic ops).
    pub async fn connect(&mut self) -> IloResult<String> {
        if let Some(ref forced) = self.config.protocol {
            return match forced {
                IloProtocol::Redfish => self.connect_redfish().await,
                IloProtocol::Ribcl => self.connect_ribcl().await,
                IloProtocol::Ipmi => self.connect_ipmi().await,
            };
        }

        // Auto-detect: Redfish → RIBCL → IPMI
        if let Ok(msg) = self.connect_redfish().await {
            self.detected_protocol = IloProtocol::Redfish;
            return Ok(msg);
        }

        log::info!("Redfish not available, trying RIBCL (legacy)...");
        if let Ok(msg) = self.connect_ribcl().await {
            self.detected_protocol = IloProtocol::Ribcl;
            return Ok(msg);
        }

        log::info!("RIBCL not available, trying IPMI...");
        if let Ok(msg) = self.connect_ipmi().await {
            self.detected_protocol = IloProtocol::Ipmi;
            return Ok(msg);
        }

        Err(IloError::connection(
            "Could not connect via Redfish, RIBCL, or IPMI. Check host/credentials.",
        ))
    }

    async fn connect_redfish(&mut self) -> IloResult<String> {
        let use_session = matches!(self.config.auth_method, IloAuthMethod::Session);
        let mut client = IloRedfishClient::new(
            &self.config.host,
            self.config.port,
            &self.config.username,
            &self.config.password,
            self.config.insecure,
            self.config.timeout_secs,
        )?;
        let user = client.login(use_session).await?;
        self.generation = client.generation;
        let msg = format!(
            "Connected to {} via Redfish ({}, FW {})",
            self.config.host,
            self.generation,
            client.firmware_version.as_deref().unwrap_or("?")
        );
        self.redfish = Some(client);
        Ok(msg)
    }

    async fn connect_ribcl(&mut self) -> IloResult<String> {
        let mut client = RibclClient::new(
            &self.config.host,
            self.config.port,
            &self.config.username,
            &self.config.password,
            self.config.insecure,
            self.config.timeout_secs,
        )?;
        let identify_result = client.identify().await?;
        self.generation = client.generation();
        let msg = format!(
            "Connected to {} via RIBCL ({})",
            self.config.host, identify_result
        );
        self.ribcl = Some(client);
        Ok(msg)
    }

    async fn connect_ipmi(&mut self) -> IloResult<String> {
        let client = IpmiClient::new(
            &self.config.host,
            Some(self.config.ipmi_port),
            &self.config.username,
            &self.config.password,
            self.config.timeout_secs,
        );
        if client.check_connection().await? {
            let msg = format!("Connected to {} via IPMI", self.config.host);
            self.ipmi = Some(client);
            Ok(msg)
        } else {
            Err(IloError::connection("IPMI connection check failed"))
        }
    }

    /// Disconnect all protocol clients.
    pub async fn disconnect(&mut self) -> IloResult<()> {
        if let Some(ref mut rf) = self.redfish {
            let _ = rf.logout().await;
        }
        self.redfish = None;
        self.ribcl = None;
        self.ipmi = None;
        Ok(())
    }

    /// Check if any protocol backend is connected.
    pub fn is_connected(&self) -> bool {
        self.redfish.as_ref().map(|c| c.is_connected()).unwrap_or(false)
            || self.ribcl.is_some()
            || self.ipmi.is_some()
    }

    /// Check session validity.
    pub async fn check_session(&self) -> IloResult<bool> {
        if let Some(ref rf) = self.redfish {
            return rf.check_session().await;
        }
        // RIBCL is stateless (per-request auth), always "valid" if we have credentials
        if self.ribcl.is_some() {
            return Ok(true);
        }
        if let Some(ref ipmi) = self.ipmi {
            return Ok(ipmi.check_connection().await?);
        }
        Ok(false)
    }

    /// Require Redfish backend or error.
    pub fn require_redfish(&self) -> IloResult<&IloRedfishClient> {
        self.redfish
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| IloError::unsupported(
                "This operation requires Redfish (iLO 4+). Not connected via Redfish."
            ))
    }

    /// Require RIBCL backend or error.
    pub fn require_ribcl(&self) -> IloResult<&RibclClient> {
        self.ribcl.as_ref().ok_or_else(|| IloError::unsupported(
            "This operation requires RIBCL. Not connected via RIBCL."
        ))
    }

    /// Require IPMI backend or error.
    pub fn require_ipmi(&self) -> IloResult<&IpmiClient> {
        self.ipmi.as_ref().ok_or_else(|| IloError::unsupported(
            "This operation requires IPMI. Not connected via IPMI."
        ))
    }

    /// Get the detected protocol.
    pub fn protocol(&self) -> &IloProtocol {
        &self.detected_protocol
    }

    /// Get safe config info (no secrets).
    pub fn get_config_safe(&self) -> IloConfigSafe {
        IloConfigSafe {
            host: self.config.host.clone(),
            port: self.config.port,
            username: self.config.username.clone(),
            insecure: self.config.insecure,
            protocol: self.detected_protocol.clone(),
            generation: self.generation,
            firmware_version: self.redfish.as_ref().and_then(|rf| rf.firmware_version.clone()),
            server_model: None,
        }
    }
}
