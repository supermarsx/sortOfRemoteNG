//! iLO license management — view, activate, deactivate.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// License management operations.
pub struct LicenseManager<'a> {
    client: &'a IloClient,
}

impl<'a> LicenseManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get current license info.
    pub async fn get_license(&self) -> IloResult<IloLicense> {
        if let Ok(rf) = self.client.require_redfish() {
            let data: serde_json::Value = rf.get_license().await?;

            let tier_str = data
                .get("LicenseType")
                .or_else(|| data.get("License"))
                .and_then(|v| v.as_str())
                .unwrap_or("Standard");

            let tier = match tier_str.to_lowercase().as_str() {
                s if s.contains("advanced premium") => IloLicenseTier::AdvancedPremium,
                s if s.contains("advanced") => IloLicenseTier::Advanced,
                s if s.contains("essentials") => IloLicenseTier::Essentials,
                s if s.contains("scale") => IloLicenseTier::ScaleOut,
                _ => IloLicenseTier::Standard,
            };

            return Ok(IloLicense {
                tier,
                key: data
                    .get("LicenseKey")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                license_string: data
                    .get("LicenseString")
                    .or_else(|| data.get("License"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                expiration: data
                    .get("LicenseExpire")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                install_date: data
                    .get("LicenseInstallDate")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let data = ribcl.get_license().await?;

            let tier_str = data
                .get("LICENSE_TYPE")
                .and_then(|v| v.as_str())
                .unwrap_or("Standard");

            let tier = match tier_str.to_lowercase().as_str() {
                s if s.contains("advanced") => IloLicenseTier::Advanced,
                s if s.contains("essentials") => IloLicenseTier::Essentials,
                _ => IloLicenseTier::Standard,
            };

            return Ok(IloLicense {
                tier,
                key: data
                    .get("LICENSE_KEY")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                license_string: data
                    .get("LICENSE_TYPE")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                expiration: None,
                install_date: data
                    .get("LICENSE_INSTALL_DATE")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            });
        }

        Err(IloError::unsupported(
            "No protocol available for license info",
        ))
    }

    /// Activate a license key.
    pub async fn activate_license(&self, key: &str) -> IloResult<()> {
        if let Ok(rf) = self.client.require_redfish() {
            let gen = self.client.generation;
            let path = if matches!(
                gen,
                IloGeneration::Ilo5 | IloGeneration::Ilo6 | IloGeneration::Ilo7
            ) {
                "/redfish/v1/Managers/1/LicenseService/1"
            } else {
                "/redfish/v1/Managers/1/LicenseService"
            };

            let body = serde_json::json!({ "LicenseKey": key });
            rf.inner.post_json::<_, ()>(path, &body).await?;
            return Ok(());
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            ribcl.activate_license(key).await?;
            return Ok(());
        }

        Err(IloError::unsupported(
            "No protocol available for license activation",
        ))
    }

    /// Delete/deactivate the current license.
    pub async fn deactivate_license(&self) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        rf.inner
            .delete("/redfish/v1/Managers/1/LicenseService/1")
            .await?;
        Ok(())
    }
}
