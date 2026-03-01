//! Messaging — toast notifications, message boxes, open URL, broadcast.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// Send a toast notification to one or more devices.
    pub async fn send_toast(
        &self,
        toast: &McDeviceToast,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!(toast.device_ids));
        if let Some(ref title) = toast.title {
            payload.insert("title".to_string(), json!(title));
        }
        payload.insert("msg".to_string(), json!(toast.msg));

        let resp = self.send_action("toast", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| format!("Toast sent to {} device(s)", toast.device_ids.len()));
        Ok(result)
    }

    /// Send a message box dialog to a device.
    pub async fn send_message_box(
        &self,
        msg: &McDeviceMessage,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(msg.device_id));
        payload.insert("type".to_string(), json!("messagebox"));
        if let Some(ref title) = msg.title {
            payload.insert("title".to_string(), json!(title));
        }
        payload.insert("msg".to_string(), json!(msg.msg));
        if let Some(timeout) = msg.timeout {
            payload.insert("timeout".to_string(), json!(timeout));
        }

        let resp = self.send_action("msg", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Message box sent".to_string());
        Ok(result)
    }

    /// Open a URL on a device's default browser.
    pub async fn send_open_url(
        &self,
        open: &McDeviceOpenUrl,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(open.device_id));
        payload.insert("type".to_string(), json!("openUrl"));
        payload.insert("url".to_string(), json!(open.url));

        let resp = self.send_action("msg", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "URL open command sent".to_string());
        Ok(result)
    }

    /// Send a toast notification to all devices in a device group.
    pub async fn send_group_toast(
        &self,
        mesh_id: &str,
        title: &str,
        message: &str,
    ) -> MeshCentralResult<String> {
        let devices = self.list_devices(None).await?;
        let group_nodes: Vec<String> = devices
            .iter()
            .filter(|d| {
                d.meshid.as_deref() == Some(mesh_id)
            })
            .map(|d| d.id.clone())
            .collect();

        if group_nodes.is_empty() {
            return Ok("No devices in group".to_string());
        }

        let toast = McDeviceToast {
            device_ids: group_nodes,
            msg: message.to_string(),
            title: Some(title.to_string()),
        };
        self.send_toast(&toast).await
    }

    /// Send a message box to all devices in a device group.
    pub async fn send_group_message(
        &self,
        mesh_id: &str,
        title: &str,
        message: &str,
    ) -> MeshCentralResult<u32> {
        let devices = self.list_devices(None).await?;
        let group_nodes: Vec<String> = devices
            .iter()
            .filter(|d| d.meshid.as_deref() == Some(mesh_id))
            .map(|d| d.id.clone())
            .collect();

        let mut count = 0u32;
        for device_id in &group_nodes {
            let msg = McDeviceMessage {
                device_id: device_id.clone(),
                msg: message.to_string(),
                title: Some(title.to_string()),
                timeout: None,
            };
            if self.send_message_box(&msg).await.is_ok() {
                count += 1;
            }
        }

        Ok(count)
    }

    /// Broadcast a message to all connected users on the server.
    pub async fn broadcast_message(
        &self,
        broadcast: &McBroadcast,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("msg".to_string(), json!(broadcast.msg));

        if let Some(ref userid) = broadcast.user_id {
            payload.insert("userid".to_string(), json!(userid));
        }

        let resp = self.send_action("userbroadcast", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Broadcast sent".to_string());
        Ok(result)
    }

    /// Send a toast to a single device (convenience).
    pub async fn toast_device(
        &self,
        device_id: &str,
        title: &str,
        message: &str,
    ) -> MeshCentralResult<String> {
        let toast = McDeviceToast {
            device_ids: vec![device_id.to_string()],
            msg: message.to_string(),
            title: Some(title.to_string()),
        };
        self.send_toast(&toast).await
    }

    /// Send a notification to a specific user.
    pub async fn notify_user(
        &self,
        user_id: &str,
        message: &str,
    ) -> MeshCentralResult<String> {
        let broadcast = McBroadcast {
            msg: message.to_string(),
            user_id: Some(user_id.to_string()),
        };
        self.broadcast_message(&broadcast).await
    }
}
