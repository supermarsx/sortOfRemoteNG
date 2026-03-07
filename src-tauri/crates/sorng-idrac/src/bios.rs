//! BIOS management — attributes, boot order, pending changes.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;
use crate::wsman::dcim_classes;

/// BIOS configuration and boot order management.
pub struct BiosManager<'a> {
    client: &'a IdracClient,
}

impl<'a> BiosManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get all BIOS attributes (current values).
    pub async fn get_bios_attributes(&self) -> IdracResult<Vec<BiosAttribute>> {
        if let Ok(rf) = self.client.require_redfish() {
            let bios: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/Bios")
                .await?;

            let attrs = bios
                .get("Attributes")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();

            return Ok(attrs
                .iter()
                .map(|(k, v)| BiosAttribute {
                    name: k.clone(),
                    current_value: Some(match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    }),
                    pending_value: None,
                    attribute_type: None,
                    read_only: None,
                    possible_values: None,
                    display_name: None,
                    description: None,
                    value: Some(v.clone()),
                    allowed_values: None,
                    lower_bound: None,
                    upper_bound: None,
                })
                .collect());
        }

        if let Ok(ws) = self.client.require_wsman() {
            let enums = ws.enumerate(dcim_classes::BIOS_ENUMERATION).await?;
            let strings = ws.enumerate(dcim_classes::BIOS_STRING).await?;
            let integers = ws.enumerate(dcim_classes::BIOS_INTEGER).await?;

            let mut attrs = Vec::new();

            for v in enums.iter().chain(strings.iter()).chain(integers.iter()) {
                let get = |k: &str| v.properties.get(k).and_then(|val| val.as_str()).map(|s| s.to_string());
                attrs.push(BiosAttribute {
                    name: get("AttributeName").unwrap_or_default(),
                    current_value: get("CurrentValue"),
                    pending_value: get("PendingValue"),
                    attribute_type: get("AttributeType"),
                    read_only: v.properties.get("IsReadOnly").and_then(|val| val.as_str()).map(|s| s == "true"),
                    possible_values: v.properties.get("PossibleValues")
                        .and_then(|val| val.as_str())
                        .map(|s| s.split(',').map(|p| p.trim().to_string()).collect()),
                    display_name: get("AttributeDisplayName"),
                    description: get("Description"),
                    value: None,
                    allowed_values: None,
                    lower_bound: v.properties.get("LowerBound").and_then(|val| val.as_i64()),
                    upper_bound: v.properties.get("UpperBound").and_then(|val| val.as_i64()),
                });
            }

            return Ok(attrs);
        }

        Err(IdracError::unsupported("BIOS attribute listing requires Redfish or WSMAN"))
    }

    /// Get a specific BIOS attribute value.
    pub async fn get_bios_attribute(&self, name: &str) -> IdracResult<Option<String>> {
        if let Ok(rf) = self.client.require_redfish() {
            let bios: serde_json::Value = rf
                .get("/redfish/v1/Systems/System.Embedded.1/Bios")
                .await?;

            return Ok(bios
                .get("Attributes")
                .and_then(|a| a.get(name))
                .map(|v| match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                }));
        }

        let attrs = self.get_bios_attributes().await?;
        Ok(attrs.iter().find(|a| a.name == name).and_then(|a| a.current_value.clone()))
    }

    /// Set BIOS attributes (creates a pending job — requires reboot to apply).
    pub async fn set_bios_attributes(
        &self,
        attributes: &std::collections::HashMap<String, String>,
    ) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let attrs: serde_json::Map<String, serde_json::Value> = attributes
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();

        let body = serde_json::json!({
            "Attributes": attrs
        });

        rf.patch_json(
            "/redfish/v1/Systems/System.Embedded.1/Bios/Settings",
            &body,
        )
        .await?;

        // Create a scheduled job to apply on next reboot
        let job_body = serde_json::json!({
            "TargetSettingsURI": "/redfish/v1/Systems/System.Embedded.1/Bios/Settings"
        });

        let job_uri = rf
            .post_action(
                "/redfish/v1/Managers/iDRAC.Embedded.1/Jobs",
                &job_body,
            )
            .await?;

        Ok(job_uri.unwrap_or_else(|| "Pending - reboot required".to_string()))
    }

    /// Get pending BIOS attribute changes.
    pub async fn get_pending_bios_changes(&self) -> IdracResult<Vec<BiosAttribute>> {
        let rf = self.client.require_redfish()?;

        let settings: serde_json::Value = rf
            .get("/redfish/v1/Systems/System.Embedded.1/Bios/Settings")
            .await?;

        let attrs = settings
            .get("Attributes")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        Ok(attrs
            .iter()
            .map(|(k, v)| BiosAttribute {
                name: k.clone(),
                current_value: None,
                pending_value: Some(match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                }),
                attribute_type: None,
                read_only: None,
                possible_values: None,
                display_name: None,
                description: None,
                value: Some(v.clone()),
                allowed_values: None,
                lower_bound: None,
                upper_bound: None,
            })
            .collect())
    }

    /// Get boot sources (boot order).
    pub async fn get_boot_order(&self) -> IdracResult<BootConfig> {
        let rf = self.client.require_redfish()?;

        let sys: serde_json::Value = rf
            .get("/redfish/v1/Systems/System.Embedded.1")
            .await?;

        let boot = sys.get("Boot").unwrap_or(&serde_json::Value::Null);

        let boot_order = boot
            .get("BootOrder")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let boot_source_override_target = boot
            .get("BootSourceOverrideTarget")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let boot_source_override_enabled = boot
            .get("BootSourceOverrideEnabled")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let boot_mode = boot
            .get("BootSourceOverrideMode")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Get detailed boot sources
        let mut boot_sources = Vec::new();
        let bso_col_uri = "/redfish/v1/Systems/System.Embedded.1/BootSources";
        if let Ok(col) = rf.get::<serde_json::Value>(bso_col_uri).await {
            if let Some(members) = col.get("Members").and_then(|v| v.as_array()) {
                for m in members {
                    boot_sources.push(BootSource {
                        id: m.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        name: m.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        enabled: m.get("BootOptionEnabled").and_then(|v| v.as_bool()),
                        display_name: m.get("DisplayName").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        uefi_device_path: m.get("UefiDevicePath").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        boot_option_reference: m.get("BootOptionReference").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        index: None,
                    });
                }
            }
        }

        Ok(BootConfig {
            boot_order,
            boot_source_override_target,
            boot_source_override_enabled,
            boot_mode,
            boot_sources,
            boot_source_override_mode: None,
            uefi_target_boot_source_override: None,
        })
    }

    /// Set boot order.
    pub async fn set_boot_order(&self, boot_order: &[String]) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Boot": {
                "BootOrder": boot_order
            }
        });

        rf.patch_json("/redfish/v1/Systems/System.Embedded.1", &body).await
    }

    /// Set one-time boot device.
    pub async fn set_boot_once(&self, target: &str, mode: Option<&str>) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let mut boot_obj = serde_json::json!({
            "BootSourceOverrideTarget": target,
            "BootSourceOverrideEnabled": "Once"
        });

        if let Some(m) = mode {
            boot_obj["BootSourceOverrideMode"] = serde_json::json!(m);
        }

        let body = serde_json::json!({ "Boot": boot_obj });
        rf.patch_json("/redfish/v1/Systems/System.Embedded.1", &body).await
    }

    /// Set boot mode (UEFI or Legacy/BIOS).
    pub async fn set_boot_mode(&self, mode: &str) -> IdracResult<String> {
        let mut attrs = std::collections::HashMap::new();
        attrs.insert("BootMode".to_string(), mode.to_string());
        self.set_bios_attributes(&attrs).await
    }

    /// Clear pending BIOS changes.
    pub async fn clear_pending_bios_changes(&self) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        rf.delete("/redfish/v1/Systems/System.Embedded.1/Bios/Settings").await
    }
}
