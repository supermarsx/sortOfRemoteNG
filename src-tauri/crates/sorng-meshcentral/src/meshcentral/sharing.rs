//! Device sharing — create, list, and manage share links.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// Create a sharing link for a device.
    pub async fn create_device_share(
        &self,
        share: &McCreateShare,
    ) -> MeshCentralResult<McDeviceShare> {
        let mut payload = serde_json::Map::new();

        payload.insert("nodeid".to_string(), json!(share.device_id));
        payload.insert("guestname".to_string(), json!(share.guest_name));

        // Build the share type bitmask
        let mut flags: u32 = 0;
        for st in &share.share_types {
            flags |= st.flag();
        }
        payload.insert("p".to_string(), json!(flags));

        if share.view_only {
            payload.insert("viewonly".to_string(), json!(true));
        }

        if let Some(ref consent) = share.consent {
            payload.insert("consent".to_string(), json!(consent));
        }

        if let Some(ref start) = share.start {
            payload.insert("startTime".to_string(), json!(start));
        }
        if let Some(ref end) = share.end {
            payload.insert("expireTime".to_string(), json!(end));
        }
        if let Some(duration) = share.duration {
            payload.insert("expire".to_string(), json!(duration));
        }
        if share.recurring != 0 {
            payload.insert("recurring".to_string(), json!(share.recurring));
        }
        if let Some(port) = share.port {
            payload.insert("port".to_string(), json!(port));
        }

        let resp = self
            .send_action("createDeviceShareLink", payload)
            .await?;

        let url = resp
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let public_id = resp
            .get("publicid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(McDeviceShare {
            public_id,
            guest_name: Some(share.guest_name.clone()),
            p: Some(flags),
            consent: None,
            view_only: if share.view_only { Some(true) } else { None },
            start_time: None,
            expire_time: None,
            duration: share.duration,
            recurring: if share.recurring != 0 { Some(share.recurring) } else { None },
            url,
            userid: None,
            extra: Default::default(),
        })
    }

    /// List all active shares for a device.
    pub async fn list_device_shares(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<Vec<McDeviceShare>> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));

        let resp = self.send_action("deviceShares", payload).await?;

        let mut shares = Vec::new();
        if let Some(list) = resp.get("deviceShares") {
            if let Some(arr) = list.as_array() {
                for item in arr {
                    if let Ok(share) =
                        serde_json::from_value::<McDeviceShare>(item.clone())
                    {
                        shares.push(share);
                    }
                }
            }
        }

        Ok(shares)
    }

    /// Remove a device sharing link.
    pub async fn remove_device_share(
        &self,
        device_id: &str,
        share_id: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        payload.insert("publicid".to_string(), json!(share_id));

        let resp = self.send_action("removeDeviceShare", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Share removed".to_string());
        Ok(result)
    }

    /// Remove all shares for a device.
    pub async fn remove_all_device_shares(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<u32> {
        let shares = self.list_device_shares(device_id).await?;
        let mut count = 0u32;

        for share in &shares {
            if let Some(ref pid) = share.public_id {
                if self.remove_device_share(device_id, pid).await.is_ok() {
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    /// Create a quick desktop share link (convenience).
    pub async fn share_desktop(
        &self,
        device_id: &str,
        guest_name: &str,
        duration_minutes: u64,
        view_only: bool,
    ) -> MeshCentralResult<McDeviceShare> {
        let share = McCreateShare {
            device_id: device_id.to_string(),
            guest_name: guest_name.to_string(),
            share_types: vec![McShareType::Desktop],
            view_only,
            consent: Some("prompt".to_string()),
            start: None,
            end: None,
            duration: Some(duration_minutes),
            recurring: 0,
            port: None,
        };
        self.create_device_share(&share).await
    }

    /// Create a quick terminal share link (convenience).
    pub async fn share_terminal(
        &self,
        device_id: &str,
        guest_name: &str,
        duration_minutes: u64,
    ) -> MeshCentralResult<McDeviceShare> {
        let share = McCreateShare {
            device_id: device_id.to_string(),
            guest_name: guest_name.to_string(),
            share_types: vec![McShareType::Terminal],
            view_only: false,
            consent: Some("prompt".to_string()),
            start: None,
            end: None,
            duration: Some(duration_minutes),
            recurring: 0,
            port: None,
        };
        self.create_device_share(&share).await
    }

    /// Create a quick file sharing link (convenience).
    pub async fn share_files(
        &self,
        device_id: &str,
        guest_name: &str,
        duration_minutes: u64,
    ) -> MeshCentralResult<McDeviceShare> {
        let share = McCreateShare {
            device_id: device_id.to_string(),
            guest_name: guest_name.to_string(),
            share_types: vec![McShareType::Files],
            view_only: false,
            consent: Some("prompt".to_string()),
            start: None,
            end: None,
            duration: Some(duration_minutes),
            recurring: 0,
            port: None,
        };
        self.create_device_share(&share).await
    }
}
