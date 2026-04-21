// ── sorng-netbox/src/interfaces.rs ───────────────────────────────────────────
//! DCIM Interface management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct InterfaceManager;

impl InterfaceManager {
    pub async fn list(
        client: &NetboxClient,
        device_id: Option<i64>,
    ) -> NetboxResult<PaginatedResponse<Interface>> {
        match device_id {
            Some(did) => {
                let did_s = did.to_string();
                client
                    .api_get_paginated("dcim/interfaces", &[("device_id", &did_s)])
                    .await
            }
            None => client.api_get_paginated("dcim/interfaces", &[]).await,
        }
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Interface> {
        client.api_get(&format!("dcim/interfaces/{id}")).await
    }

    pub async fn create(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Interface> {
        client.api_post("dcim/interfaces", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Interface> {
        client.api_put(&format!("dcim/interfaces/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Interface> {
        client
            .api_patch(&format!("dcim/interfaces/{id}"), data)
            .await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("dcim/interfaces/{id}")).await
    }

    pub async fn list_by_device(
        client: &NetboxClient,
        device_id: i64,
    ) -> NetboxResult<PaginatedResponse<Interface>> {
        let did = device_id.to_string();
        client
            .api_get_paginated("dcim/interfaces", &[("device_id", &did)])
            .await
    }

    pub async fn list_connections(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<InterfaceConnection>> {
        client
            .api_get_paginated("dcim/interface-connections", &[])
            .await
    }
}
