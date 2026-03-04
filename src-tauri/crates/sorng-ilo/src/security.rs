//! Security configuration — security state, risk assessment, settings.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Security management operations.
pub struct SecurityManager<'a> {
    client: &'a IloClient,
}

impl<'a> SecurityManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get overall security status and risk items.
    pub async fn get_security_status(&self) -> IloResult<IloSecurityStatus> {
        let rf = self.client.require_redfish()?;
        let data: serde_json::Value = rf.get_security_params().await?;

        let overall = data.get("OverallSecurityStatus")
            .or_else(|| data.get("SecurityState"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let mut risks = Vec::new();

        // Parse HP OEM security params
        if let Some(params) = data.get("SecurityParams").and_then(|v| v.as_array()) {
            for param in params {
                let name = param.get("Name").and_then(|v| v.as_str()).unwrap_or("Unknown");
                let status = param.get("Status").and_then(|v| v.as_str()).unwrap_or("Unknown");
                let recommended = param.get("RecommendedAction")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if status != "Ok" && status != "OK" {
                    risks.push(SecurityRiskItem {
                        name: name.to_string(),
                        severity: status.to_string(),
                        description: param.get("Description")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        recommended_action: recommended,
                    });
                }
            }
        }

        // Check for specific security flags
        if let Some(state) = data.get("SecurityState").and_then(|v| v.as_str()) {
            if state == "Risk" || state == "HighRisk" {
                // Add any missing risk items from the overall state
                if risks.is_empty() {
                    risks.push(SecurityRiskItem {
                        name: "Security State".to_string(),
                        severity: state.to_string(),
                        description: Some("Overall security state indicates risk".to_string()),
                        recommended_action: Some("Review security dashboard".to_string()),
                    });
                }
            }
        }

        Ok(IloSecurityStatus {
            overall_status: overall,
            risk_count: risks.len() as u32,
            risks,
            tls_version: data.get("TLSVersion")
                .and_then(|v| v.as_str()).map(|s| s.to_string()),
            ipmi_over_lan_enabled: data.get("IPMIOverLan")
                .and_then(|v| v.as_bool()),
            ssh_enabled: data.get("SSHStatus")
                .and_then(|v| v.as_str())
                .map(|s| s == "Enabled"),
            default_password: data.get("DefaultPasswordInUse")
                .and_then(|v| v.as_bool()),
        })
    }

    /// Set minimum TLS version.
    pub async fn set_min_tls_version(&self, version: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let gen = self.client.generation();

        let path = if matches!(gen, IloGeneration::Ilo5 | IloGeneration::Ilo6 | IloGeneration::Ilo7) {
            "/redfish/v1/Managers/1/SecurityService/HttpsCert"
        } else {
            "/redfish/v1/Managers/1/NetworkProtocol"
        };

        let body = serde_json::json!({
            "Oem": {
                "Hpe": {
                    "MinimumTLSVersion": version
                }
            }
        });

        rf.inner.patch_json(path, &body).await?;
        Ok(())
    }

    /// Enable or disable IPMI over LAN.
    pub async fn set_ipmi_over_lan(&self, enabled: bool) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({
            "Oem": {
                "Hpe": {
                    "IPMIOverLan": {
                        "Enabled": enabled
                    }
                }
            }
        });
        rf.inner.patch_json("/redfish/v1/Managers/1/NetworkProtocol", &body).await?;
        Ok(())
    }
}
