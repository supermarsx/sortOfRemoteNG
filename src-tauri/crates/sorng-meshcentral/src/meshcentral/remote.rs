//! Remote command execution — run shell commands on devices.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// Execute a command on a device.
    ///
    /// Supports both Windows (cmd) and Linux/macOS (bash) commands.
    /// The `run_as_user` option runs the command as the logged-in user on Windows.
    /// The `powershell` option runs the command in PowerShell instead of cmd on Windows.
    pub async fn run_commands(&self, cmd: &McRunCommand) -> MeshCentralResult<McCommandResult> {
        let _ = cmd;
        Err(MeshCentralError::ServerError(
            "Remote command execution is unavailable until the MeshCentral control WebSocket can verify command completion"
                .to_string(),
        ))
    }

    /// Run a shell command on a single device (convenience wrapper).
    pub async fn run_command_on_device(
        &self,
        device_id: &str,
        command: &str,
        powershell: bool,
        run_as_user: bool,
    ) -> MeshCentralResult<McCommandResult> {
        let cmd = McRunCommand {
            device_id: device_id.to_string(),
            command: command.to_string(),
            powershell,
            run_as_user,
            run_as_user_only: false,
            reply: true,
        };
        self.run_commands(&cmd).await
    }

    /// Open a terminal relay session for interactive shell access.
    ///
    /// Returns the relay URL and session info needed to connect
    /// via WebSocket for real-time terminal interaction.
    pub async fn open_terminal_relay(
        &self,
        device_id: &str,
        protocol: u32,
    ) -> MeshCentralResult<McWebRelayResult> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        // protocol: 1=terminal, 2=desktop, 5=files
        payload.insert("protocol".to_string(), json!(protocol));

        let resp = self.send_action("msg", payload).await?;

        let url = resp
            .get("url")
            .or_else(|| resp.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if url.is_empty() || url.len() > 8192 {
            return Err(MeshCentralError::ServerError(
                "MeshCentral did not return a valid relay URL".to_string(),
            ));
        }

        let public_id = resp
            .get("sessionid")
            .or_else(|| resp.get("publicid"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(McWebRelayResult { url, public_id })
    }

    /// Get the last known network information for a device.
    pub async fn get_device_network_info(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        self.send_action("getnetworkinfo", payload).await
    }

    /// Get detailed system information for a device.
    pub async fn get_device_system_info(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        self.send_action("getsysinfo", payload).await
    }

    /// Get last connection details for a device.
    pub async fn get_device_last_connect(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<McLastConnect> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        let resp = self.send_action("lastconnect", payload).await?;
        let lc = serde_json::from_value::<McLastConnect>(resp)?;
        Ok(lc)
    }

    /// Request the server to send a wake-on-LAN packet to wake a device.
    pub async fn wake_device(&self, device_id: &str) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!([device_id]));
        let resp = self.send_action("wakedevices", payload).await?;
        if !McApiClient::is_success(&resp) {
            return Err(MeshCentralError::ServerError(
                "MeshCentral did not acknowledge the wake request".to_string(),
            ));
        }
        Ok(McApiClient::extract_result(&resp).unwrap_or_else(|| "success".to_string()))
    }

    /// Get the auth cookie for setting up a relay tunnel.
    pub async fn get_relay_cookie(&self) -> MeshCentralResult<String> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("authcookie", payload).await?;
        let cookie = resp
            .get("cookie")
            .or_else(|| resp.get("rcookie"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if cookie.is_empty() || cookie.len() > 8192 {
            return Err(MeshCentralError::ServerError(
                "MeshCentral did not return a valid relay cookie".to_string(),
            ));
        }
        Ok(cookie)
    }
}
