// ── sorng-netbox/src/devices.rs ──────────────────────────────────────────────
//! DCIM Device management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct DeviceManager;

impl DeviceManager {
    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Device>> {
        client.api_get_paginated("dcim/devices", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Device> {
        client.api_get(&format!("dcim/devices/{id}")).await
    }

    pub async fn create(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Device> {
        client.api_post("dcim/devices", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Device> {
        client.api_put(&format!("dcim/devices/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Device> {
        client.api_patch(&format!("dcim/devices/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("dcim/devices/{id}")).await
    }

    pub async fn list_by_site(
        client: &NetboxClient,
        site_id: i64,
    ) -> NetboxResult<PaginatedResponse<Device>> {
        let sid = site_id.to_string();
        client.api_get_paginated("dcim/devices", &[("site_id", &sid)]).await
    }

    pub async fn list_by_rack(
        client: &NetboxClient,
        rack_id: i64,
    ) -> NetboxResult<PaginatedResponse<Device>> {
        let rid = rack_id.to_string();
        client.api_get_paginated("dcim/devices", &[("rack_id", &rid)]).await
    }

    pub async fn list_device_types(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<DeviceType>> {
        client.api_get_paginated("dcim/device-types", &[]).await
    }

    pub async fn get_device_type(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<DeviceType> {
        client.api_get(&format!("dcim/device-types/{id}")).await
    }

    pub async fn list_manufacturers(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<Manufacturer>> {
        client.api_get_paginated("dcim/manufacturers", &[]).await
    }

    pub async fn get_manufacturer(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<Manufacturer> {
        client.api_get(&format!("dcim/manufacturers/{id}")).await
    }

    pub async fn list_platforms(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<Platform>> {
        client.api_get_paginated("dcim/platforms", &[]).await
    }

    pub async fn get_platform(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<Platform> {
        client.api_get(&format!("dcim/platforms/{id}")).await
    }

    pub async fn list_device_roles(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<DeviceRole>> {
        client.api_get_paginated("dcim/device-roles", &[]).await
    }

    pub async fn get_device_role(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<DeviceRole> {
        client.api_get(&format!("dcim/device-roles/{id}")).await
    }

    pub async fn render_config(
        client: &NetboxClient,
        id: i64,
    ) -> NetboxResult<serde_json::Value> {
        client.api_post(&format!("dcim/devices/{id}/render-config"), &serde_json::json!({})).await
    }
}
