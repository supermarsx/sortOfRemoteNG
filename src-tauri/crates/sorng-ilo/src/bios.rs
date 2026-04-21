//! BIOS/UEFI configuration — read/write BIOS attributes, boot order.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// BIOS management operations.
pub struct BiosManager<'a> {
    client: &'a IloClient,
}

impl<'a> BiosManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get all BIOS attributes.
    pub async fn get_bios_attributes(&self) -> IloResult<Vec<BiosAttribute>> {
        let rf = self.client.require_redfish()?;
        let bios: serde_json::Value = rf.get_bios().await?;

        let mut attrs = Vec::new();

        if let Some(attributes) = bios.get("Attributes").and_then(|v| v.as_object()) {
            for (key, value) in attributes {
                attrs.push(BiosAttribute {
                    name: key.clone(),
                    value: value.clone(),
                    read_only: false,
                });
            }
        }

        // Check for pending settings
        if let Some(pending_link) = bios
            .pointer("/Oem/Hpe/Links/Settings/@odata.id")
            .or_else(|| bios.pointer("/@Redfish.Settings/SettingsObject/@odata.id"))
            .and_then(|v| v.as_str())
        {
            if let Ok(pending) = rf.inner.get::<serde_json::Value>(pending_link).await {
                if let Some(pending_attrs) = pending.get("Attributes").and_then(|v| v.as_object()) {
                    for attr in &mut attrs {
                        if let Some(pending_val) = pending_attrs.get(&attr.name) {
                            if pending_val != &attr.value {
                                // Mark as having a pending change (stored in the value)
                                attr.read_only = false; // it's writeable and has a pending change
                            }
                        }
                    }
                }
            }
        }

        Ok(attrs)
    }

    /// Set BIOS attributes (applied on next reboot).
    pub async fn set_bios_attributes(&self, attributes: &serde_json::Value) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        rf.set_bios_attributes(attributes).await?;
        Ok(())
    }

    /// Get boot configuration.
    pub async fn get_boot_config(&self) -> IloResult<BootConfig> {
        if let Ok(rf) = self.client.require_redfish() {
            let sys: serde_json::Value = rf.get_system().await?;
            let boot = sys.get("Boot").unwrap_or(&serde_json::Value::Null);

            let mut sources = Vec::new();
            if let Some(order) = boot.get("BootOrder").and_then(|v| v.as_array()) {
                for (i, item) in order.iter().enumerate() {
                    sources.push(BootSource {
                        id: item.as_str().unwrap_or("").to_string(),
                        name: item.as_str().unwrap_or("Unknown").to_string(),
                        enabled: true,
                        position: i as u32,
                    });
                }
            }

            let override_target = boot
                .get("BootSourceOverrideTarget")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let override_enabled = boot
                .get("BootSourceOverrideEnabled")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            return Ok(BootConfig {
                boot_order: sources,
                boot_override_target: override_target,
                boot_override_enabled: override_enabled,
                uefi_boot_mode: boot
                    .get("BootSourceOverrideMode")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            });
        }

        Err(IloError::unsupported(
            "No protocol available for boot config",
        ))
    }

    /// Set one-time boot override.
    pub async fn set_boot_override(&self, target: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({
            "Boot": {
                "BootSourceOverrideEnabled": "Once",
                "BootSourceOverrideTarget": target,
            }
        });
        rf.inner.patch_json("/redfish/v1/Systems/1", &body).await?;
        Ok(())
    }
}
