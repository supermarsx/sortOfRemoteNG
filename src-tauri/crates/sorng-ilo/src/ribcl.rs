//! RIBCL (Remote Insight Board Command Language) XML-over-HTTPS client.
//!
//! Used by iLO 1, 2, 3, 4 (and 5 in legacy mode).
//! Commands are XML documents sent via HTTPS POST to the iLO web port (443).
//!
//! ## Protocol Overview
//!
//! RIBCL is HP's proprietary XML protocol.  Each request is a complete
//! `<RIBCL VERSION="2.0">` document wrapping one or more `<LOGIN>` blocks,
//! each containing command elements like `<GET_HOST_DATA/>` or
//! `<SERVER_INFO MODE="read"/>`.
//!
//! Unlike Redfish, RIBCL is fire-and-forget per-request (no persistent session),
//! though credentials are sent in every `<LOGIN>` element.
//!
//! ## iLO Generation Differences
//!
//! | Generation | RIBCL Port | XML Version | Notes                           |
//! |------------|-----------|-------------|----------------------------------|
//! | iLO 1      | 443       | 2.0         | Subset of commands               |
//! | iLO 2      | 443       | 2.0         | Full command set                 |
//! | iLO 3      | 443       | 2.0         | Extended with SNMP, directory    |
//! | iLO 4      | 443       | 2.0         | Full set + AHS, firmware upload  |
//! | iLO 5      | 443       | 2.0         | Legacy mode (Redfish preferred)  |

use crate::error::{IloError, IloResult};
use crate::types::IloGeneration;

use reqwest::Client;
use std::time::Duration;

/// RIBCL XML client for legacy iLO management.
pub struct RibclClient {
    client: Client,
    base_url: String,
    username: String,
    password: String,
    generation: IloGeneration,
}

impl RibclClient {
    /// Create a new RIBCL client.
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        insecure: bool,
        timeout_secs: u64,
    ) -> IloResult<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(insecure)
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| IloError::ribcl(format!("Failed to build HTTP client: {e}")))?;

        let base_url = format!("https://{}:{}", host, port);

        Ok(Self {
            client,
            base_url,
            username: username.to_string(),
            password: password.to_string(),
            generation: IloGeneration::Unknown,
        })
    }

    pub fn generation(&self) -> IloGeneration {
        self.generation
    }

    pub fn set_generation(&mut self, gen: IloGeneration) {
        self.generation = gen;
    }

    // ── Core RIBCL transport ────────────────────────────────────────

    /// Send a RIBCL command and return the raw XML response.
    pub async fn send_command(&self, xml_body: &str) -> IloResult<String> {
        let url = format!("{}/ribcl", self.base_url);

        let full_xml = format!(
            r#"<?xml version="1.0"?>
<RIBCL VERSION="2.0">
  <LOGIN USER_LOGIN="{}" PASSWORD="{}">
    {}
  </LOGIN>
</RIBCL>"#,
            self.username, self.password, xml_body
        );

        let resp = self
            .client
            .post(&url)
            .header("Content-Type", "application/xml")
            .body(full_xml)
            .send()
            .await
            .map_err(|e| IloError::ribcl(format!("RIBCL request failed: {e}")))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() && status.as_u16() != 200 {
            // Some iLO versions return 200 even for errors (error in XML body)
            if !body.contains("<RIBCL") {
                return Err(IloError::ribcl(format!(
                    "RIBCL HTTP error {}: {}",
                    status.as_u16(),
                    &body[..body.len().min(500)]
                )));
            }
        }

        // Check for RIBCL-level errors in the XML response
        if body.contains("STATUS=\"0x0002\"") {
            return Err(IloError::auth("RIBCL authentication failed — bad credentials"));
        }
        if body.contains("STATUS=\"0x0003\"") {
            return Err(IloError::access_denied("RIBCL access denied — insufficient privileges"));
        }
        if body.contains("STATUS=\"0x0004\"") {
            return Err(IloError::ribcl("RIBCL resource not found"));
        }

        Ok(body)
    }

    // ── Connection / identification ─────────────────────────────────

    /// Check RIBCL connectivity and detect iLO generation.
    pub async fn identify(&mut self) -> IloResult<String> {
        let xml = r#"<SERVER_INFO MODE="read">
      <GET_HOST_DATA/>
    </SERVER_INFO>"#;

        let resp = self.send_command(xml).await?;

        // Parse generation from response
        let gen = if resp.contains("iLO 7") || resp.contains("ILO7") {
            IloGeneration::Ilo7
        } else if resp.contains("iLO 6") || resp.contains("ILO6") {
            IloGeneration::Ilo6
        } else if resp.contains("iLO 5") || resp.contains("ILO5") {
            IloGeneration::Ilo5
        } else if resp.contains("iLO 4") || resp.contains("ILO4") {
            IloGeneration::Ilo4
        } else if resp.contains("iLO 3") || resp.contains("ILO3") {
            IloGeneration::Ilo3
        } else if resp.contains("iLO 2") || resp.contains("ILO2") {
            IloGeneration::Ilo2
        } else if resp.contains("iLO") || resp.contains("RILOE") {
            IloGeneration::Ilo1
        } else {
            IloGeneration::Unknown
        };
        self.generation = gen;

        // Extract firmware version
        let fw = Self::extract_xml_value(&resp, "FIRMWARE_VERSION VALUE")
            .or_else(|| Self::extract_xml_value(&resp, "MANAGEMENT_PROCESSOR"))
            .unwrap_or_else(|| gen.display_name().to_string());

        Ok(format!("{} (FW {})", gen, fw))
    }

    // ── System Info ─────────────────────────────────────────────────

    /// Get host/server information via RIBCL.
    pub async fn get_host_data(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<SERVER_INFO MODE="read">
      <GET_HOST_DATA/>
    </SERVER_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get embedded health data (temperatures, fans, power).
    pub async fn get_embedded_health(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<SERVER_INFO MODE="read">
      <GET_EMBEDDED_HEALTH/>
    </SERVER_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get power readings via RIBCL.
    pub async fn get_power_readings(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<SERVER_INFO MODE="read">
      <GET_POWER_READINGS/>
    </SERVER_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    // ── Power Control ───────────────────────────────────────────────

    /// Hold power button.
    pub async fn press_power_button(&self) -> IloResult<()> {
        let xml = r#"<SERVER_INFO MODE="write">
      <PRESS_PWR_BTN/>
    </SERVER_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    /// Hard power off.
    pub async fn hold_power_button(&self) -> IloResult<()> {
        let xml = r#"<SERVER_INFO MODE="write">
      <HOLD_PWR_BTN/>
    </SERVER_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    /// Cold boot (power cycle).
    pub async fn cold_boot(&self) -> IloResult<()> {
        let xml = r#"<SERVER_INFO MODE="write">
      <COLD_BOOT_SERVER/>
    </SERVER_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    /// Warm boot (reset).
    pub async fn warm_boot(&self) -> IloResult<()> {
        let xml = r#"<SERVER_INFO MODE="write">
      <WARM_BOOT_SERVER/>
    </SERVER_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    /// Set server power on.
    pub async fn set_host_power_on(&self) -> IloResult<()> {
        let xml = r#"<SERVER_INFO MODE="write">
      <SET_HOST_POWER HOST_POWER="Yes"/>
    </SERVER_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    // ── iLO Configuration ───────────────────────────────────────────

    /// Get iLO network settings.
    pub async fn get_network_settings(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_NETWORK_SETTINGS/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get iLO global settings.
    pub async fn get_global_settings(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_GLOBAL_SETTINGS/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get firmware version.
    pub async fn get_fw_version(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_FW_VERSION/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    // ── Virtual Media ───────────────────────────────────────────────

    /// Get virtual media status.
    pub async fn get_vm_status(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_VM_STATUS DEVICE="CDROM"/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Insert virtual media.
    pub async fn insert_virtual_media(&self, image_url: &str) -> IloResult<()> {
        let xml = format!(
            r#"<RIB_INFO MODE="write">
      <INSERT_VIRTUAL_MEDIA DEVICE="CDROM" IMAGE_URL="{image_url}"/>
    </RIB_INFO>"#
        );
        self.send_command(&xml).await?;
        Ok(())
    }

    /// Eject virtual media.
    pub async fn eject_virtual_media(&self) -> IloResult<()> {
        let xml = r#"<RIB_INFO MODE="write">
      <EJECT_VIRTUAL_MEDIA DEVICE="CDROM"/>
    </RIB_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    /// Set one-time boot from virtual CD.
    pub async fn set_vm_boot_once(&self) -> IloResult<()> {
        let xml = r#"<RIB_INFO MODE="write">
      <SET_VM_STATUS DEVICE="CDROM">
        <VM_BOOT_OPTION VALUE="BOOT_ONCE"/>
      </SET_VM_STATUS>
    </RIB_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    // ── User Management ─────────────────────────────────────────────

    /// Get all iLO users.
    pub async fn get_all_users(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<USER_INFO MODE="read">
      <GET_ALL_USERS/>
    </USER_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get user info.
    pub async fn get_user(&self, login: &str) -> IloResult<serde_json::Value> {
        let xml = format!(
            r#"<USER_INFO MODE="read">
      <GET_USER USER_LOGIN="{login}"/>
    </USER_INFO>"#
        );
        let resp = self.send_command(&xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    // ── IML (Integrated Management Log) ─────────────────────────────

    /// Get IML entries.
    pub async fn get_iml(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<SERVER_INFO MODE="read">
      <GET_EVENT_LOG/>
    </SERVER_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get iLO event log entries.
    pub async fn get_ilo_event_log(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_EVENT_LOG/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Clear IML.
    pub async fn clear_iml(&self) -> IloResult<()> {
        let xml = r#"<SERVER_INFO MODE="write">
      <CLEAR_IML/>
    </SERVER_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    /// Clear iLO event log.
    pub async fn clear_ilo_event_log(&self) -> IloResult<()> {
        let xml = r#"<RIB_INFO MODE="write">
      <CLEAR_EVENTLOG/>
    </RIB_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    // ── License ─────────────────────────────────────────────────────

    /// Get license info.
    pub async fn get_license(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_ALL_LICENSES/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Activate a license key.
    pub async fn activate_license(&self, key: &str) -> IloResult<()> {
        let xml = format!(
            r#"<RIB_INFO MODE="write">
      <ACTIVATE iLO_KEY="{key}"/>
    </RIB_INFO>"#
        );
        self.send_command(&xml).await?;
        Ok(())
    }

    // ── Certificate ─────────────────────────────────────────────────

    /// Get current SSL certificate info.
    pub async fn get_certificate(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_CERT/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Generate a CSR.
    pub async fn generate_csr(
        &self,
        common_name: &str,
        org: &str,
        org_unit: &str,
        city: &str,
        state: &str,
        country: &str,
    ) -> IloResult<String> {
        let xml = format!(
            r#"<RIB_INFO MODE="write">
      <CSR_CERT_SETTINGS>
        <CSR_USE_CERT_FQDN VALUE="No"/>
        <CSR_USE_CERT_CUSTOM VALUE="Yes"/>
        <CSR_SUBJECT_COMMON_NAME VALUE="{common_name}"/>
        <CSR_SUBJECT_ORG_NAME VALUE="{org}"/>
        <CSR_SUBJECT_ORG_UNIT VALUE="{org_unit}"/>
        <CSR_SUBJECT_LOCATION VALUE="{city}"/>
        <CSR_SUBJECT_STATE VALUE="{state}"/>
        <CSR_SUBJECT_COUNTRY VALUE="{country}"/>
      </CSR_CERT_SETTINGS>
    </RIB_INFO>"#
        );
        self.send_command(&xml).await?;

        // Now get the CSR
        let csr_xml = r#"<RIB_INFO MODE="read">
      <GET_CSR/>
    </RIB_INFO>"#;
        let resp = self.send_command(csr_xml).await?;

        // Extract the CSR PEM from the response
        let csr = Self::extract_cdata(&resp)
            .unwrap_or_else(|| resp.clone());
        Ok(csr)
    }

    // ── iLO Reset ───────────────────────────────────────────────────

    /// Reset / reboot the iLO processor itself.
    pub async fn reset_ilo(&self) -> IloResult<()> {
        let xml = r#"<RIB_INFO MODE="write">
      <RESET_RIB/>
    </RIB_INFO>"#;
        self.send_command(xml).await?;
        Ok(())
    }

    // ── Directory (LDAP/AD) ─────────────────────────────────────────

    /// Get directory settings.
    pub async fn get_directory_settings(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<DIR_INFO MODE="read">
      <GET_DIR_CONFIG/>
    </DIR_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    // ── Federation ──────────────────────────────────────────────────

    /// Get federation multicast settings.
    pub async fn get_federation_multicast(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_FEDERATION_MULTICAST/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    /// Get federation groups.
    pub async fn get_federation_groups(&self) -> IloResult<serde_json::Value> {
        let xml = r#"<RIB_INFO MODE="read">
      <GET_FEDERATION_ALL_GROUPS/>
    </RIB_INFO>"#;
        let resp = self.send_command(xml).await?;
        Ok(Self::ribcl_to_json(&resp))
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// Simple XML value extractor (finds `KEY="value"` in raw XML).
    fn extract_xml_value(xml: &str, attr_prefix: &str) -> Option<String> {
        let search = format!("{attr_prefix}=\"");
        if let Some(start) = xml.find(&search) {
            let value_start = start + search.len();
            if let Some(end) = xml[value_start..].find('"') {
                return Some(xml[value_start..value_start + end].to_string());
            }
        }
        None
    }

    /// Extract CDATA content from RIBCL XML.
    fn extract_cdata(xml: &str) -> Option<String> {
        let start_tag = "<![CDATA[";
        let end_tag = "]]>";
        if let Some(start) = xml.find(start_tag) {
            let data_start = start + start_tag.len();
            if let Some(end) = xml[data_start..].find(end_tag) {
                return Some(xml[data_start..data_start + end].trim().to_string());
            }
        }
        None
    }

    /// Convert raw RIBCL XML response to a simplified JSON object.
    /// This is a best-effort conversion for the frontend.
    fn ribcl_to_json(xml: &str) -> serde_json::Value {
        // Extract key-value pairs from the XML attributes
        let mut map = serde_json::Map::new();
        let mut in_section = false;
        let mut section_name = String::new();
        let mut section_items: Vec<serde_json::Value> = Vec::new();

        for line in xml.lines() {
            let trimmed = line.trim();

            // Skip XML declaration and RIBCL/LOGIN wrappers
            if trimmed.starts_with("<?") || trimmed.starts_with("<RIBCL")
                || trimmed.starts_with("</RIBCL") || trimmed.starts_with("<LOGIN")
                || trimmed.starts_with("</LOGIN") || trimmed.starts_with("<RESPONSE")
                || trimmed.is_empty()
            {
                continue;
            }

            // Detect section start (e.g., <GET_HOST_DATA>, <DRIVES>)
            if trimmed.starts_with('<') && !trimmed.starts_with("</") && !trimmed.contains("VALUE=") {
                if let Some(tag_end) = trimmed.find(|c: char| c == ' ' || c == '>' || c == '/') {
                    let tag = &trimmed[1..tag_end];
                    if !trimmed.ends_with("/>") && !trimmed.contains("</") {
                        if in_section && !section_items.is_empty() {
                            map.insert(section_name.clone(), serde_json::Value::Array(section_items.clone()));
                            section_items.clear();
                        }
                        section_name = tag.to_string();
                        in_section = true;
                        continue;
                    }
                }
            }

            // Extract VALUE="..." attributes from self-closing tags
            if trimmed.contains("VALUE=\"") {
                if let Some(tag_start) = trimmed.find('<') {
                    if let Some(tag_end) = trimmed[tag_start + 1..].find(|c: char| c == ' ' || c == '/' || c == '>') {
                        let key = &trimmed[tag_start + 1..tag_start + 1 + tag_end];
                        if let Some(val) = Self::extract_xml_value(trimmed, "VALUE") {
                            if in_section {
                                let mut item = serde_json::Map::new();
                                item.insert("key".to_string(), serde_json::Value::String(key.to_string()));
                                item.insert("value".to_string(), serde_json::Value::String(val));
                                section_items.push(serde_json::Value::Object(item));
                            } else {
                                map.insert(key.to_string(), serde_json::Value::String(val));
                            }
                        }
                    }
                }
            }

            // Section end
            if trimmed.starts_with("</") {
                if in_section && !section_items.is_empty() {
                    map.insert(section_name.clone(), serde_json::Value::Array(section_items.clone()));
                    section_items.clear();
                }
                in_section = false;
            }
        }

        if in_section && !section_items.is_empty() {
            map.insert(section_name, serde_json::Value::Array(section_items));
        }

        serde_json::Value::Object(map)
    }
}
