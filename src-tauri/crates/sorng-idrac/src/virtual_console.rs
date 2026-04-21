//! Virtual console — KVM/HTML5 remote console access.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// Virtual console (KVM/HTML5) management.
pub struct VirtualConsoleManager<'a> {
    client: &'a IdracClient,
}

impl<'a> VirtualConsoleManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// Get virtual console information and access URLs.
    pub async fn get_console_info(&self) -> IdracResult<ConsoleInfo> {
        let rf = self.client.require_redfish()?;

        let mgr: serde_json::Value = rf.get("/redfish/v1/Managers/iDRAC.Embedded.1").await?;

        let config = self.client.get_config_safe();
        let base_url = format!("https://{}:{}", config.host, config.port);

        // Determine console type from iDRAC attributes
        let console_type = mgr
            .pointer("/Oem/Dell/DellAttributes/VirtualConsole.1#PluginType")
            .and_then(|v| v.as_str())
            .unwrap_or("HTML5");

        let enabled = mgr
            .pointer("/GraphicalConsole/ServiceEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let max_sessions = mgr
            .pointer("/GraphicalConsole/MaxConcurrentSessions")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32)
            .unwrap_or(6);

        let connect_types = mgr
            .pointer("/GraphicalConsole/ConnectTypesSupported")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(ConsoleInfo {
            console_type: console_type.to_string(),
            enabled,
            max_concurrent_sessions: max_sessions,
            html5_url: Some(format!("{}/console", base_url)),
            java_url: Some(format!(
                "{}/viewer.jnlp({}@0@{}@{})",
                base_url,
                config.host,
                config.port,
                chrono::Utc::now().timestamp()
            )),
            vnc_port: Some(5901),
            connect_types_supported: connect_types,
            encryption_enabled: true,
            local_server_video_enabled: true,
        })
    }

    /// Enable or disable the virtual console.
    pub async fn set_console_enabled(&self, enabled: bool) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "GraphicalConsole": {
                "ServiceEnabled": enabled
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1", &body)
            .await
    }

    /// Set the virtual console plugin type (HTML5, eHTML5, ActiveX, Java).
    pub async fn set_console_type(&self, plugin_type: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Attributes": {
                "VirtualConsole.1#PluginType": plugin_type
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body)
            .await
    }

    /// Get virtual console preview/thumbnail (screenshot).
    pub async fn get_preview_image(&self) -> IdracResult<Vec<u8>> {
        let rf = self.client.require_redfish()?;
        let config = self.client.get_config_safe();

        // Dell iDRAC provides a screenshot capture endpoint
        let _url = format!(
            "https://{}:{}/capconsole/scapture0.png",
            config.host, config.port
        );

        // Use raw GET with bytes response — simplified here
        let response: serde_json::Value = rf
            .get("/redfish/v1/Dell/Managers/iDRAC.Embedded.1/DellLCService/Actions/DellLCService.SystemLockdown")
            .await
            .unwrap_or_default();

        // Return empty if screenshot not available via Redfish
        let _ = response;
        Err(IdracError::unsupported(
            "Screenshot capture requires direct HTTPS access, not available via Redfish API",
        ))
    }

    /// Set VNC password for virtual console VNC access.
    pub async fn set_vnc_password(&self, password: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Attributes": {
                "VNCServer.1#Password": password
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body)
            .await
    }

    /// Enable or disable VNC access.
    pub async fn set_vnc_enabled(&self, enabled: bool) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Attributes": {
                "VNCServer.1#Enable": if enabled { "Enabled" } else { "Disabled" }
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body)
            .await
    }

    /// Set VNC port.
    pub async fn set_vnc_port(&self, port: u16) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "Attributes": {
                "VNCServer.1#Port": port
            }
        });

        rf.patch_json("/redfish/v1/Managers/iDRAC.Embedded.1/Attributes", &body)
            .await
    }
}
