//! iLO Redfish extensions (iLO 4 FW 2.30+, iLO 5, 6, 7).
//!
//! Wraps `sorng_bmc_common::redfish::RedfishClient` and adds HP/HPE-specific
//! OEM Redfish paths (Oem.Hpe / Oem.Hp).
//!
//! ## HP OEM paths
//!
//! | Purpose                | Path                                                     | Gen  |
//! |------------------------|----------------------------------------------------------|------|
//! | iLO info               | `/redfish/v1/Managers/1`                                 | 4+   |
//! | System root            | `/redfish/v1/Systems/1`                                  | 4+   |
//! | Chassis                | `/redfish/v1/Chassis/1`                                  | 4+   |
//! | Smart Storage          | `/redfish/v1/Systems/1/SmartStorage`                     | 5+   |
//! | Security params        | `/redfish/v1/Managers/1/SecurityService`                  | 5+   |
//! | Federation groups      | `/redfish/v1/Managers/1/FederationGroups`                 | 5+   |
//! | License                | `/redfish/v1/Managers/1/LicenseService/1`                | 5+   |
//! | IML                    | `/redfish/v1/Systems/1/LogServices/IML/Entries`           | 4+   |
//! | iLO Event Log          | `/redfish/v1/Managers/1/LogServices/IEL/Entries`          | 4+   |
//! | Active Health System   | `/redfish/v1/Managers/1/LogServices/ActiveHealthSystem`   | 5+   |
//! | Virtual Media          | `/redfish/v1/Managers/1/VirtualMedia`                     | 4+   |
//! | Embedded Media         | `/redfish/v1/Managers/1/EmbeddedMedia`                    | 5+   |
//! | BIOS settings          | `/redfish/v1/Systems/1/Bios`                             | 4+   |
//! | Boot order             | `/redfish/v1/Systems/1/BootOptions`                      | 5+   |
//! | Directory (LDAP/AD)    | `/redfish/v1/AccountService/DirectoryService`            | 5+   |

use crate::error::IloResult;
use crate::types::IloGeneration;

use sorng_bmc_common::redfish::{RedfishClient, RedfishConfig};

/// iLO Redfish client with HP OEM extensions.
pub struct IloRedfishClient {
    pub inner: RedfishClient,
    pub generation: IloGeneration,
    pub firmware_version: Option<String>,
}

impl IloRedfishClient {
    /// Build a new iLO Redfish client.
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        insecure: bool,
        timeout_secs: u64,
    ) -> IloResult<Self> {
        let config = RedfishConfig {
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.to_string(),
            insecure,
            timeout_secs,
        };
        let inner = RedfishClient::new(&config)?;
        Ok(Self {
            inner,
            generation: IloGeneration::Unknown,
            firmware_version: None,
        })
    }

    /// Login and detect iLO generation.
    pub async fn login(&mut self, use_session: bool) -> IloResult<String> {
        let user = self.inner.login(use_session).await?;

        // Detect generation from Manager endpoint
        if let Ok(mgr) = self
            .inner
            .get::<serde_json::Value>("/redfish/v1/Managers/1")
            .await
        {
            if let Some(fw) = mgr.get("FirmwareVersion").and_then(|v| v.as_str()) {
                self.firmware_version = Some(fw.to_string());
            }

            // Detect generation from OEM block
            let oem = mgr
                .get("Oem")
                .and_then(|o| o.get("Hpe").or_else(|| o.get("Hp")));

            if let Some(oem_data) = oem {
                if let Some(mgr_type) = oem_data
                    .pointer("/Manager/0/ManagerType")
                    .or_else(|| oem_data.get("Type"))
                    .and_then(|v| v.as_str())
                {
                    self.generation = Self::detect_generation(mgr_type);
                }
            }

            // Fallback: try from Model field
            if self.generation == IloGeneration::Unknown {
                if let Some(model) = mgr.get("Model").and_then(|v| v.as_str()) {
                    self.generation = Self::detect_generation(model);
                }
            }
        }

        Ok(user)
    }

    /// Detect iLO generation from a string (model name, type, etc.).
    fn detect_generation(s: &str) -> IloGeneration {
        let lower = s.to_lowercase();
        if lower.contains("ilo 7") || lower.contains("ilo7") {
            IloGeneration::Ilo7
        } else if lower.contains("ilo 6") || lower.contains("ilo6") {
            IloGeneration::Ilo6
        } else if lower.contains("ilo 5") || lower.contains("ilo5") {
            IloGeneration::Ilo5
        } else if lower.contains("ilo 4") || lower.contains("ilo4") {
            IloGeneration::Ilo4
        } else if lower.contains("ilo 3") || lower.contains("ilo3") {
            IloGeneration::Ilo3
        } else if lower.contains("ilo 2") || lower.contains("ilo2") {
            IloGeneration::Ilo2
        } else if lower.contains("ilo") {
            IloGeneration::Ilo4 // default to iLO 4 if Redfish is available but version unclear
        } else {
            IloGeneration::Unknown
        }
    }

    /// Logout (delete session).
    pub async fn logout(&mut self) -> IloResult<()> {
        self.inner.logout().await?;
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }

    pub async fn check_session(&self) -> IloResult<bool> {
        Ok(self.inner.check_session().await?)
    }

    // ── System ──────────────────────────────────────────────────────

    /// Get system info from `/redfish/v1/Systems/1`.
    pub async fn get_system(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Systems/1").await?)
    }

    /// Get manager (iLO) info from `/redfish/v1/Managers/1`.
    pub async fn get_manager(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Managers/1").await?)
    }

    /// Get chassis info from `/redfish/v1/Chassis/1`.
    pub async fn get_chassis(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Chassis/1").await?)
    }

    // ── Power ───────────────────────────────────────────────────────

    /// Send a Redfish reset (power) action.
    pub async fn power_action(&self, reset_type: &str) -> IloResult<Option<String>> {
        let body = serde_json::json!({ "ResetType": reset_type });
        Ok(self
            .inner
            .post_action("/redfish/v1/Systems/1/Actions/ComputerSystem.Reset", &body)
            .await?)
    }

    /// Get power data from chassis.
    pub async fn get_power(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Chassis/1/Power").await?)
    }

    // ── Thermal ─────────────────────────────────────────────────────

    /// Get thermal data from chassis.
    pub async fn get_thermal(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Chassis/1/Thermal").await?)
    }

    // ── Storage ─────────────────────────────────────────────────────

    /// Get Smart Storage data (iLO 5+ with HP OEM).
    pub async fn get_smart_storage(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Systems/1/SmartStorage").await?)
    }

    /// Get DMTF standard storage (iLO 5+).
    pub async fn get_storage_collection(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Systems/1/Storage")
            .await?)
    }

    // ── Network ─────────────────────────────────────────────────────

    /// Get network adapters.
    pub async fn get_network_adapters(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Systems/1/NetworkAdapters")
            .await
            .unwrap_or_default())
    }

    /// Get iLO ethernet interfaces (the BMC's own NICs).
    pub async fn get_ilo_ethernet(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Managers/1/EthernetInterfaces")
            .await?)
    }

    // ── Firmware ────────────────────────────────────────────────────

    /// Get firmware inventory.
    pub async fn get_firmware_inventory(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/UpdateService/FirmwareInventory")
            .await?)
    }

    // ── Virtual Media ───────────────────────────────────────────────

    /// Get virtual media devices.
    pub async fn get_virtual_media(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Managers/1/VirtualMedia")
            .await?)
    }

    /// Insert virtual media.
    pub async fn insert_virtual_media(&self, media_id: &str, image_url: &str) -> IloResult<()> {
        let body = serde_json::json!({
            "Image": image_url,
            "Inserted": true,
            "WriteProtected": true
        });
        self.inner
            .patch_json(
                &format!("/redfish/v1/Managers/1/VirtualMedia/{media_id}"),
                &body,
            )
            .await?;
        Ok(())
    }

    /// Eject virtual media.
    pub async fn eject_virtual_media(&self, media_id: &str) -> IloResult<()> {
        let body = serde_json::json!({
            "Image": null,
            "Inserted": false
        });
        self.inner
            .patch_json(
                &format!("/redfish/v1/Managers/1/VirtualMedia/{media_id}"),
                &body,
            )
            .await?;
        Ok(())
    }

    // ── Event Logs ──────────────────────────────────────────────────

    /// Get IML (Integrated Management Log) entries.
    pub async fn get_iml_entries(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Systems/1/LogServices/IML/Entries")
            .await?)
    }

    /// Get iLO Event Log entries.
    pub async fn get_ilo_event_log(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Managers/1/LogServices/IEL/Entries")
            .await?)
    }

    /// Clear IML.
    pub async fn clear_iml(&self) -> IloResult<()> {
        let body = serde_json::json!({});
        self.inner
            .post_action(
                "/redfish/v1/Systems/1/LogServices/IML/Actions/LogService.ClearLog",
                &body,
            )
            .await?;
        Ok(())
    }

    /// Clear iLO event log.
    pub async fn clear_ilo_event_log(&self) -> IloResult<()> {
        let body = serde_json::json!({});
        self.inner
            .post_action(
                "/redfish/v1/Managers/1/LogServices/IEL/Actions/LogService.ClearLog",
                &body,
            )
            .await?;
        Ok(())
    }

    // ── Users ───────────────────────────────────────────────────────

    /// Get all accounts.
    pub async fn get_accounts(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/AccountService/Accounts")
            .await?)
    }

    // ── BIOS ────────────────────────────────────────────────────────

    /// Get BIOS attributes.
    pub async fn get_bios(&self) -> IloResult<serde_json::Value> {
        Ok(self.inner.get("/redfish/v1/Systems/1/Bios").await?)
    }

    /// Set BIOS attributes (applied on next reboot).
    pub async fn set_bios_attributes(&self, attrs: &serde_json::Value) -> IloResult<()> {
        self.inner
            .patch_json("/redfish/v1/Systems/1/Bios/Settings", attrs)
            .await?;
        Ok(())
    }

    // ── Certificates ────────────────────────────────────────────────

    /// Get iLO HTTPS certificate.
    pub async fn get_certificate(&self) -> IloResult<serde_json::Value> {
        // iLO 5+: /redfish/v1/Managers/1/SecurityService/HttpsCert
        // iLO 4:  /redfish/v1/Managers/1/SecurityService/HttpsCert
        Ok(self
            .inner
            .get("/redfish/v1/Managers/1/SecurityService/HttpsCert")
            .await?)
    }

    // ── License ─────────────────────────────────────────────────────

    /// Get license info.
    pub async fn get_license(&self) -> IloResult<serde_json::Value> {
        Ok(self
            .inner
            .get("/redfish/v1/Managers/1/LicenseService/1")
            .await?)
    }

    // ── Security ────────────────────────────────────────────────────

    /// Get security parameters (iLO 5+).
    pub async fn get_security_params(&self) -> IloResult<serde_json::Value> {
        Ok(self
            .inner
            .get("/redfish/v1/Managers/1/SecurityService")
            .await?)
    }

    // ── Federation ──────────────────────────────────────────────────

    /// Get federation groups (iLO 5+).
    pub async fn get_federation_groups(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Managers/1/FederationGroups")
            .await
            .unwrap_or_default())
    }

    /// Get federation peers via multicast discovery.
    pub async fn get_federation_peers(&self) -> IloResult<Vec<serde_json::Value>> {
        Ok(self
            .inner
            .get_collection_expanded("/redfish/v1/Managers/1/FederationPeers")
            .await
            .unwrap_or_default())
    }

    // ── Console ─────────────────────────────────────────────────────

    /// Get remote console / KVM info.
    pub async fn get_console_info(&self) -> IloResult<serde_json::Value> {
        // OEM path for console info
        let mgr: serde_json::Value = self.inner.get("/redfish/v1/Managers/1").await?;
        let oem = mgr
            .get("Oem")
            .and_then(|o| o.get("Hpe").or_else(|| o.get("Hp")));

        let mut info = serde_json::Map::new();
        if let Some(oem_data) = oem {
            if let Some(links) = oem_data.get("Links") {
                if let Some(console) = links.get("RemoteConsole") {
                    info.insert("remoteConsole".to_string(), console.clone());
                }
            }
        }

        // Also check GraphicalConsole
        if let Some(gc) = mgr.get("GraphicalConsole") {
            info.insert("graphicalConsole".to_string(), gc.clone());
        }

        Ok(serde_json::Value::Object(info))
    }

    // ── iLO Reset ───────────────────────────────────────────────────

    /// Reset the iLO processor.
    pub async fn reset_ilo(&self) -> IloResult<()> {
        let body = serde_json::json!({ "ResetType": "GracefulRestart" });
        self.inner
            .post_action("/redfish/v1/Managers/1/Actions/Manager.Reset", &body)
            .await?;
        Ok(())
    }
}
