//! Delta-query-based synchronisation engine for OneDrive.
//!
//! Tracks changes via the Graph `/delta` endpoint and maintains a local
//! sync cursor so subsequent calls only fetch incremental changes.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::{DeltaResponse, DeltaSyncState, DriveItem};
use chrono::Utc;
use log::{debug, info};

/// Callback invoked for each batch of changed items.
pub type DeltaCallback = Box<dyn FnMut(&[DriveItem]) + Send>;

/// Sync engine.
pub struct OneDriveSyncEngine<'a> {
    client: &'a GraphApiClient,
    drive_id: String,
}

impl<'a> OneDriveSyncEngine<'a> {
    pub fn new(client: &'a GraphApiClient, drive_id: &str) -> Self {
        Self {
            client,
            drive_id: drive_id.to_string(),
        }
    }

    /// Perform a full or incremental delta sync.
    ///
    /// If `state` has a `delta_link`, it will be used for incremental sync;
    /// otherwise a full enumeration is performed.  Returns the updated state
    /// (with a new `delta_link`).
    pub async fn sync(
        &self,
        state: &DeltaSyncState,
        mut on_batch: impl FnMut(&[DriveItem]),
    ) -> OneDriveResult<DeltaSyncState> {
        let initial_url = if let Some(ref dl) = state.delta_link {
            dl.clone()
        } else {
            format!("drives/{}/root/delta", self.drive_id)
        };

        let mut url = initial_url;
        let mut total_items: u64 = 0;
        let final_delta_link: Option<String>;

        loop {
            let resp = self.client.get(&url, &[]).await?;
            let delta: DeltaResponse = serde_json::from_value(resp)?;

            let batch_size = delta.value.len();
            if batch_size > 0 {
                on_batch(&delta.value);
                total_items += batch_size as u64;
                debug!("Delta batch: {} items (total {})", batch_size, total_items);
            }

            if let Some(next) = delta.next_link {
                url = next;
            } else {
                final_delta_link = delta.delta_link;
                break;
            }
        }

        info!(
            "Delta sync complete: {} items processed",
            total_items
        );

        Ok(DeltaSyncState {
            drive_id: self.drive_id.clone(),
            delta_link: final_delta_link,
            last_sync: Some(Utc::now()),
            synced_items: state.synced_items + total_items,
        })
    }

    /// Perform delta sync on a specific folder.
    pub async fn sync_folder(
        &self,
        folder_id: &str,
        state: &DeltaSyncState,
        mut on_batch: impl FnMut(&[DriveItem]),
    ) -> OneDriveResult<DeltaSyncState> {
        let initial_url = if let Some(ref dl) = state.delta_link {
            dl.clone()
        } else {
            format!(
                "drives/{}/items/{}/delta",
                self.drive_id, folder_id
            )
        };

        let mut url = initial_url;
        let mut total_items: u64 = 0;
        let final_delta_link: Option<String>;

        loop {
            let resp = self.client.get(&url, &[]).await?;
            let delta: DeltaResponse = serde_json::from_value(resp)?;

            let batch_size = delta.value.len();
            if batch_size > 0 {
                on_batch(&delta.value);
                total_items += batch_size as u64;
            }

            if let Some(next) = delta.next_link {
                url = next;
            } else {
                final_delta_link = delta.delta_link;
                break;
            }
        }

        Ok(DeltaSyncState {
            drive_id: self.drive_id.clone(),
            delta_link: final_delta_link,
            last_sync: Some(Utc::now()),
            synced_items: state.synced_items + total_items,
        })
    }

    /// Get the latest delta link without processing items (initialise cursor).
    pub async fn get_latest_delta_link(&self) -> OneDriveResult<String> {
        let path = format!(
            "drives/{}/root/delta?token=latest",
            self.drive_id
        );
        let resp = self.client.get(&path, &[]).await?;

        // The `token=latest` request returns a deltaLink immediately.
        let link = resp["@odata.deltaLink"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        Ok(link)
    }

    /// Create a fresh sync state for this drive.
    pub fn initial_state(&self) -> DeltaSyncState {
        DeltaSyncState {
            drive_id: self.drive_id.clone(),
            delta_link: None,
            last_sync: None,
            synced_items: 0,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state() {
        let config = crate::onedrive::types::OneDriveConfig::default();
        let client = GraphApiClient::new(&config, "tok").unwrap();
        let engine = OneDriveSyncEngine::new(&client, "drive123");
        let state = engine.initial_state();
        assert_eq!(state.drive_id, "drive123");
        assert!(state.delta_link.is_none());
        assert_eq!(state.synced_items, 0);
    }

    #[test]
    fn test_delta_response_serde() {
        let json_str = r#"{
            "value": [
                {"id": "item1", "name": "file.txt"}
            ],
            "@odata.deltaLink": "https://graph.microsoft.com/delta?token=aaa"
        }"#;
        let resp: DeltaResponse = serde_json::from_str(json_str).unwrap();
        assert_eq!(resp.value.len(), 1);
        assert!(resp.delta_link.is_some());
        assert!(resp.next_link.is_none());
    }

    #[test]
    fn test_delta_sync_state_serde() {
        let state = DeltaSyncState {
            drive_id: "d1".into(),
            delta_link: Some("https://example.com/delta?tok=x".into()),
            last_sync: Some(Utc::now()),
            synced_items: 42,
        };
        let json = serde_json::to_string(&state).unwrap();
        let parsed: DeltaSyncState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.drive_id, "d1");
        assert_eq!(parsed.synced_items, 42);
    }
}
