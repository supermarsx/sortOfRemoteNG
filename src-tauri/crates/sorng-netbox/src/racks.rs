// ── sorng-netbox/src/racks.rs ────────────────────────────────────────────────
//! DCIM Rack management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct RackManager;

impl RackManager {
    pub async fn list(
        client: &NetboxClient,
        site_id: Option<i64>,
    ) -> NetboxResult<PaginatedResponse<Rack>> {
        match site_id {
            Some(sid) => {
                let sid_s = sid.to_string();
                client.api_get_paginated("dcim/racks", &[("site_id", &sid_s)]).await
            }
            None => client.api_get_paginated("dcim/racks", &[]).await,
        }
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Rack> {
        client.api_get(&format!("dcim/racks/{id}")).await
    }

    pub async fn create(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Rack> {
        client.api_post("dcim/racks", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Rack> {
        client.api_put(&format!("dcim/racks/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Rack> {
        client.api_patch(&format!("dcim/racks/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("dcim/racks/{id}")).await
    }

    pub async fn get_elevation(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<Vec<RackUnit>> {
        client.api_get(&format!("dcim/racks/{id}/elevation")).await
    }

    pub async fn list_reservations(
        client: &NetboxClient,
        rack_id: i64,
    ) -> NetboxResult<PaginatedResponse<RackReservation>> {
        let rid = rack_id.to_string();
        client.api_get_paginated("dcim/rack-reservations", &[("rack_id", &rid)]).await
    }
}
