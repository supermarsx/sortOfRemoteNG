//! RRD metrics via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct MetricsManager<'a> {
    client: &'a PveClient,
}

impl<'a> MetricsManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// Get RRD data for a node.
    pub async fn node_rrd(
        &self,
        node: &str,
        timeframe: &str,
        cf: Option<&str>,
    ) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let path = format!("/api2/json/nodes/{node}/rrddata");
        let mut params: Vec<(&str, &str)> = vec![("timeframe", timeframe)];
        if let Some(cf_val) = cf { params.push(("cf", cf_val)); }
        self.client.get_with_params(&path, &params).await
    }

    /// Get RRD data for a QEMU VM.
    pub async fn qemu_rrd(
        &self,
        node: &str,
        vmid: u64,
        timeframe: &str,
        cf: Option<&str>,
    ) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let path = format!("/api2/json/nodes/{node}/qemu/{vmid}/rrddata");
        let mut params: Vec<(&str, &str)> = vec![("timeframe", timeframe)];
        if let Some(cf_val) = cf { params.push(("cf", cf_val)); }
        self.client.get_with_params(&path, &params).await
    }

    /// Get RRD data for an LXC container.
    pub async fn lxc_rrd(
        &self,
        node: &str,
        vmid: u64,
        timeframe: &str,
        cf: Option<&str>,
    ) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let path = format!("/api2/json/nodes/{node}/lxc/{vmid}/rrddata");
        let mut params: Vec<(&str, &str)> = vec![("timeframe", timeframe)];
        if let Some(cf_val) = cf { params.push(("cf", cf_val)); }
        self.client.get_with_params(&path, &params).await
    }

    /// Get RRD data for a storage.
    pub async fn storage_rrd(
        &self,
        node: &str,
        storage: &str,
        timeframe: &str,
        cf: Option<&str>,
    ) -> ProxmoxResult<Vec<RrdDataPoint>> {
        let path = format!("/api2/json/nodes/{node}/storage/{storage}/rrddata");
        let mut params: Vec<(&str, &str)> = vec![("timeframe", timeframe)];
        if let Some(cf_val) = cf { params.push(("cf", cf_val)); }
        self.client.get_with_params(&path, &params).await
    }
}
