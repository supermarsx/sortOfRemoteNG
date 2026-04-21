//! Protocol-aware orchestrator with auto-detection.
//!
//! `IdracClient` owns one or more protocol backends (Redfish, WSMAN, IPMI)
//! and routes requests to the appropriate backend based on iDRAC generation.

use crate::error::{IdracError, IdracResult};
use crate::ipmi::IpmiClient;
use crate::redfish::RedfishClient;
use crate::types::*;
use crate::wsman::WsmanClient;

/// Unified iDRAC client that wraps all protocol backends.
pub struct IdracClient {
    pub redfish: Option<RedfishClient>,
    pub wsman: Option<WsmanClient>,
    pub ipmi: Option<IpmiClient>,
    pub detected_protocol: IdracProtocol,
    pub config: IdracConfig,
}

impl IdracClient {
    /// Build a new client from config, attempting protocol detection.
    pub fn new(config: &IdracConfig) -> IdracResult<Self> {
        Ok(Self {
            redfish: None,
            wsman: None,
            ipmi: None,
            detected_protocol: config
                .force_protocol
                .clone()
                .unwrap_or(IdracProtocol::Redfish),
            config: config.clone(),
        })
    }

    /// Connect and detect the best available protocol.
    pub async fn connect(&mut self) -> IdracResult<String> {
        let config = &self.config;

        if let Some(ref forced) = config.force_protocol {
            match forced {
                IdracProtocol::Redfish => return self.connect_redfish().await,
                IdracProtocol::Wsman => return self.connect_wsman().await,
                IdracProtocol::Ipmi => return self.connect_ipmi().await,
            }
        }

        // Auto-detect: try Redfish first (modern), then WSMAN (legacy), then IPMI
        if let Ok(msg) = self.connect_redfish().await {
            self.detected_protocol = IdracProtocol::Redfish;
            return Ok(msg);
        }

        log::info!("Redfish not available, trying WS-Management (legacy)...");
        if let Ok(msg) = self.connect_wsman().await {
            self.detected_protocol = IdracProtocol::Wsman;
            return Ok(msg);
        }

        log::info!("WSMAN not available, trying IPMI...");
        if let Ok(msg) = self.connect_ipmi().await {
            self.detected_protocol = IdracProtocol::Ipmi;
            return Ok(msg);
        }

        Err(IdracError::connection(
            "Could not connect via Redfish, WS-Management, or IPMI. Check host/credentials.",
        ))
    }

    async fn connect_redfish(&mut self) -> IdracResult<String> {
        let mut client = RedfishClient::new(&self.config)?;
        let _user = client.login().await?;
        let version = client.detect_version().await.unwrap_or(None);
        let msg = format!(
            "Connected to {} via Redfish{}",
            self.config.host,
            version
                .as_ref()
                .map(|v| format!(" (FW {v})"))
                .unwrap_or_default()
        );
        self.redfish = Some(client);
        Ok(msg)
    }

    async fn connect_wsman(&mut self) -> IdracResult<String> {
        let client = WsmanClient::new(&self.config)?;
        let version = client.identify().await?;
        let msg = format!(
            "Connected to {} via WS-Management ({})",
            self.config.host, version
        );
        self.wsman = Some(client);
        Ok(msg)
    }

    async fn connect_ipmi(&mut self) -> IdracResult<String> {
        let (username, password) = match &self.config.auth {
            IdracAuthMethod::Basic { username, password }
            | IdracAuthMethod::Session { username, password } => {
                (username.clone(), password.clone())
            }
        };
        let client = IpmiClient::new(
            &self.config.host,
            Some(623),
            &username,
            &password,
            self.config.timeout_secs,
        );
        if client.check_connection().await? {
            let msg = format!("Connected to {} via IPMI", self.config.host);
            self.ipmi = Some(client);
            Ok(msg)
        } else {
            Err(IdracError::connection("IPMI connection check failed"))
        }
    }

    /// Disconnect all protocol clients.
    pub async fn disconnect(&mut self) -> IdracResult<()> {
        if let Some(ref mut rf) = self.redfish {
            let _ = rf.logout().await;
        }
        self.redfish = None;
        self.wsman = None;
        self.ipmi = None;
        Ok(())
    }

    /// Check if any protocol backend is connected.
    pub fn is_connected(&self) -> bool {
        self.redfish
            .as_ref()
            .map(|c| c.is_connected())
            .unwrap_or(false)
            || self.wsman.is_some()
            || self.ipmi.is_some()
    }

    /// Check session validity.
    pub async fn check_session(&self) -> IdracResult<bool> {
        if let Some(ref rf) = self.redfish {
            return rf.check_session().await;
        }
        if let Some(ref ws) = self.wsman {
            return ws.check_connection().await;
        }
        if let Some(ref ipmi) = self.ipmi {
            return ipmi.check_connection().await;
        }
        Ok(false)
    }

    /// Require Redfish backend or error.
    pub fn require_redfish(&self) -> IdracResult<&RedfishClient> {
        self.redfish
            .as_ref()
            .filter(|c| c.is_connected())
            .ok_or_else(|| {
                IdracError::unsupported(
                    "This operation requires Redfish (iDRAC 7+). Not connected via Redfish.",
                )
            })
    }

    /// Require WSMAN backend or error.
    pub fn require_wsman(&self) -> IdracResult<&WsmanClient> {
        self.wsman.as_ref().ok_or_else(|| {
            IdracError::unsupported(
                "This operation requires WS-Management. Not connected via WSMAN.",
            )
        })
    }

    /// Require IPMI backend or error.
    pub fn require_ipmi(&self) -> IdracResult<&IpmiClient> {
        self.ipmi.as_ref().ok_or_else(|| {
            IdracError::unsupported("This operation requires IPMI. Not connected via IPMI.")
        })
    }

    /// Get the detection protocol.
    pub fn protocol(&self) -> &IdracProtocol {
        &self.detected_protocol
    }

    /// Get safe config info (no secrets).
    pub fn get_config_safe(&self) -> IdracConfigSafe {
        let username = match &self.config.auth {
            IdracAuthMethod::Basic { username, .. } | IdracAuthMethod::Session { username, .. } => {
                username.clone()
            }
        };
        let idrac_version = self
            .redfish
            .as_ref()
            .and_then(|rf| rf.session().map(|_| "Redfish".to_string()));

        IdracConfigSafe {
            host: self.config.host.clone(),
            port: self.config.port,
            username,
            insecure: self.config.insecure,
            protocol: self.detected_protocol.clone(),
            idrac_version,
        }
    }
}
