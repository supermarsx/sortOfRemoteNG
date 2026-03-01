//! Event management — list, filter, and subscribe to server events.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// List events from the MeshCentral server.
    ///
    /// Supports filtering by user ID, device ID, and/or event limit.
    pub async fn list_events(
        &self,
        filter: Option<&McEventFilter>,
    ) -> MeshCentralResult<Vec<McEvent>> {
        let mut payload = serde_json::Map::new();

        if let Some(f) = filter {
            if let Some(ref uid) = f.user_id {
                payload.insert("userid".to_string(), json!(uid));
            }
            if let Some(ref nid) = f.device_id {
                payload.insert("nodeid".to_string(), json!(nid));
            }
            if let Some(limit) = f.limit {
                payload.insert("limit".to_string(), json!(limit));
            }
        }

        let resp = self.send_action("events", payload).await?;

        let mut events = Vec::new();
        if let Some(event_list) = resp.get("events") {
            if let Some(arr) = event_list.as_array() {
                for ev in arr {
                    if let Ok(event) = serde_json::from_value::<McEvent>(ev.clone()) {
                        events.push(event);
                    }
                }
            }
        }

        Ok(events)
    }

    /// List events for a specific device.
    pub async fn list_device_events(
        &self,
        device_id: &str,
        limit: Option<u32>,
    ) -> MeshCentralResult<Vec<McEvent>> {
        let filter = McEventFilter {
            user_id: None,
            device_id: Some(device_id.to_string()),
            limit,
        };
        self.list_events(Some(&filter)).await
    }

    /// List events for a specific user.
    pub async fn list_user_events(
        &self,
        user_id: &str,
        limit: Option<u32>,
    ) -> MeshCentralResult<Vec<McEvent>> {
        let filter = McEventFilter {
            user_id: Some(user_id.to_string()),
            device_id: None,
            limit,
        };
        self.list_events(Some(&filter)).await
    }

    /// List the most recent events (server-wide).
    pub async fn list_recent_events(
        &self,
        limit: u32,
    ) -> MeshCentralResult<Vec<McEvent>> {
        let filter = McEventFilter {
            user_id: None,
            device_id: None,
            limit: Some(limit),
        };
        self.list_events(Some(&filter)).await
    }

    /// Get timeline of events for a device over a time range.
    pub async fn get_device_event_timeline(
        &self,
        device_id: &str,
        start: Option<&str>,
        end: Option<&str>,
        limit: Option<u32>,
    ) -> MeshCentralResult<Vec<McEvent>> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));

        if let Some(s) = start {
            payload.insert("start".to_string(), json!(s));
        }
        if let Some(e) = end {
            payload.insert("end".to_string(), json!(e));
        }
        if let Some(l) = limit {
            payload.insert("limit".to_string(), json!(l));
        }

        let resp = self.send_action("events", payload).await?;

        let mut events = Vec::new();
        if let Some(event_list) = resp.get("events") {
            if let Some(arr) = event_list.as_array() {
                for ev in arr {
                    if let Ok(event) = serde_json::from_value::<McEvent>(ev.clone()) {
                        events.push(event);
                    }
                }
            }
        }

        Ok(events)
    }

    /// Get event dispatch configuration (what events the logged-in user subscribes to).
    pub async fn get_event_dispatch_config(
        &self,
    ) -> MeshCentralResult<serde_json::Value> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("getDeviceDetails", payload).await?;
        Ok(resp)
    }

    /// Filter events by event type (e.g., "user-login", "node-connect", "power", etc.).
    pub fn filter_events_by_type<'a>(
        events: &'a [McEvent],
        event_type: &str,
    ) -> Vec<&'a McEvent> {
        events
            .iter()
            .filter(|ev| {
                if let Some(ref etype) = ev.event_type {
                    etype == event_type
                } else {
                    false
                }
            })
            .collect()
    }

    /// Filter events by action.
    pub fn filter_events_by_action<'a>(
        events: &'a [McEvent],
        action: &str,
    ) -> Vec<&'a McEvent> {
        events
            .iter()
            .filter(|ev| {
                if let Some(ref a) = ev.action {
                    a == action
                } else {
                    false
                }
            })
            .collect()
    }
}
