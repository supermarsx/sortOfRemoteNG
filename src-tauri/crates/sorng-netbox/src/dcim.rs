// ── sorng-netbox – DCIM module ───────────────────────────────────────────────
//! Sites, racks, devices, interfaces, cables, locations, regions, and ports.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct DcimManager;

impl DcimManager {
    // ── Sites ────────────────────────────────────────────────────────

    pub async fn list_sites(client: &NetboxClient) -> NetboxResult<Vec<Site>> {
        client.api_get_list("/dcim/sites/").await
    }

    pub async fn get_site(client: &NetboxClient, id: i64) -> NetboxResult<Site> {
        let body = client.api_get(&format!("/dcim/sites/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_site: {e}")))
    }

    pub async fn create_site(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Site> {
        let body = client.api_post("/dcim/sites/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_site: {e}")))
    }

    pub async fn update_site(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Site> {
        let body = client.api_patch(&format!("/dcim/sites/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_site: {e}")))
    }

    pub async fn delete_site(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/sites/{id}/")).await?;
        Ok(())
    }

    // ── Racks ────────────────────────────────────────────────────────

    pub async fn list_racks(client: &NetboxClient) -> NetboxResult<Vec<Rack>> {
        client.api_get_list("/dcim/racks/").await
    }

    pub async fn get_rack(client: &NetboxClient, id: i64) -> NetboxResult<Rack> {
        let body = client.api_get(&format!("/dcim/racks/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_rack: {e}")))
    }

    pub async fn create_rack(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Rack> {
        let body = client.api_post("/dcim/racks/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_rack: {e}")))
    }

    pub async fn update_rack(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Rack> {
        let body = client.api_patch(&format!("/dcim/racks/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_rack: {e}")))
    }

    pub async fn delete_rack(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/racks/{id}/")).await?;
        Ok(())
    }

    // ── Devices ──────────────────────────────────────────────────────

    pub async fn list_devices(client: &NetboxClient) -> NetboxResult<Vec<Device>> {
        client.api_get_list("/dcim/devices/").await
    }

    pub async fn get_device(client: &NetboxClient, id: i64) -> NetboxResult<Device> {
        let body = client.api_get(&format!("/dcim/devices/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_device: {e}")))
    }

    pub async fn create_device(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Device> {
        let body = client.api_post("/dcim/devices/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_device: {e}")))
    }

    pub async fn update_device(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Device> {
        let body = client.api_patch(&format!("/dcim/devices/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_device: {e}")))
    }

    pub async fn delete_device(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/devices/{id}/")).await?;
        Ok(())
    }

    pub async fn list_device_types(client: &NetboxClient) -> NetboxResult<Vec<DeviceType>> {
        client.api_get_list("/dcim/device-types/").await
    }

    pub async fn get_device_type(client: &NetboxClient, id: i64) -> NetboxResult<DeviceType> {
        let body = client.api_get(&format!("/dcim/device-types/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_device_type: {e}")))
    }

    pub async fn list_manufacturers(client: &NetboxClient) -> NetboxResult<Vec<Manufacturer>> {
        client.api_get_list("/dcim/manufacturers/").await
    }

    pub async fn list_device_roles(client: &NetboxClient) -> NetboxResult<Vec<DeviceRole>> {
        client.api_get_list("/dcim/device-roles/").await
    }

    pub async fn list_platforms(client: &NetboxClient) -> NetboxResult<Vec<Platform>> {
        client.api_get_list("/dcim/platforms/").await
    }

    // ── Interfaces ───────────────────────────────────────────────────

    pub async fn list_interfaces(client: &NetboxClient) -> NetboxResult<Vec<DeviceInterface>> {
        client.api_get_list("/dcim/interfaces/").await
    }

    pub async fn get_interface(client: &NetboxClient, id: i64) -> NetboxResult<DeviceInterface> {
        let body = client.api_get(&format!("/dcim/interfaces/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_interface: {e}")))
    }

    pub async fn create_interface(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<DeviceInterface> {
        let body = client.api_post("/dcim/interfaces/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_interface: {e}")))
    }

    pub async fn update_interface(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<DeviceInterface> {
        let body = client.api_patch(&format!("/dcim/interfaces/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_interface: {e}")))
    }

    pub async fn delete_interface(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/interfaces/{id}/")).await?;
        Ok(())
    }

    // ── Cables ───────────────────────────────────────────────────────

    pub async fn list_cables(client: &NetboxClient) -> NetboxResult<Vec<Cable>> {
        client.api_get_list("/dcim/cables/").await
    }

    pub async fn create_cable(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Cable> {
        let body = client.api_post("/dcim/cables/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_cable: {e}")))
    }

    pub async fn delete_cable(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/dcim/cables/{id}/")).await?;
        Ok(())
    }

    // ── Locations ────────────────────────────────────────────────────

    pub async fn list_locations(client: &NetboxClient) -> NetboxResult<Vec<Location>> {
        client.api_get_list("/dcim/locations/").await
    }

    // ── Regions ──────────────────────────────────────────────────────

    pub async fn list_regions(client: &NetboxClient) -> NetboxResult<Vec<Region>> {
        client.api_get_list("/dcim/regions/").await
    }

    // ── Console ports ────────────────────────────────────────────────

    pub async fn list_console_ports(client: &NetboxClient) -> NetboxResult<Vec<ConsolePort>> {
        client.api_get_list("/dcim/console-ports/").await
    }

    // ── Power ports ──────────────────────────────────────────────────

    pub async fn list_power_ports(client: &NetboxClient) -> NetboxResult<Vec<PowerPort>> {
        client.api_get_list("/dcim/power-ports/").await
    }

    // ── Device inventory (all components) ────────────────────────────

    pub async fn get_device_inventory(client: &NetboxClient, device_id: i64) -> NetboxResult<serde_json::Value> {
        let body = client.api_get(&format!("/dcim/devices/{device_id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_device_inventory: {e}")))
    }
}
