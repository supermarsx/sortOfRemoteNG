// ── sorng-portainer/src/endpoints.rs ─────────────────────────────────────────
//! Environments (`/api/endpoints`).

use crate::client::PortainerClient;
use crate::error::PortainerResult;
use crate::types::{PortainerEndpoint, PortainerEndpointSnapshot};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RawSnapshot {
    #[serde(rename = "Time")]
    time: Option<i64>,
    #[serde(rename = "DockerVersion")]
    docker_version: Option<String>,
    #[serde(rename = "Swarm")]
    swarm: Option<bool>,
    #[serde(rename = "TotalCPU")]
    total_cpu: Option<i64>,
    #[serde(rename = "TotalMemory")]
    total_memory: Option<i64>,
    #[serde(rename = "RunningContainerCount")]
    running: Option<u64>,
    #[serde(rename = "StoppedContainerCount")]
    stopped: Option<u64>,
    #[serde(rename = "HealthyContainerCount")]
    healthy: Option<u64>,
    #[serde(rename = "UnhealthyContainerCount")]
    unhealthy: Option<u64>,
    #[serde(rename = "ImageCount")]
    images: Option<u64>,
    #[serde(rename = "VolumeCount")]
    volumes: Option<u64>,
    #[serde(rename = "StackCount")]
    stacks: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct RawEndpoint {
    #[serde(rename = "Id")]
    id: u64,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Type", default)]
    endpoint_type: u32,
    #[serde(rename = "URL", default)]
    url: String,
    #[serde(rename = "Status", default)]
    status: u32,
    #[serde(rename = "GroupId")]
    group_id: Option<u64>,
    #[serde(rename = "Snapshots", default)]
    snapshots: Vec<RawSnapshot>,
}

pub(crate) fn parse_endpoints(body: &[u8]) -> serde_json::Result<Vec<PortainerEndpoint>> {
    let raw: Vec<RawEndpoint> = serde_json::from_slice(body)?;
    Ok(raw.into_iter().map(map_endpoint).collect())
}

fn map_snapshot(raw: RawSnapshot) -> PortainerEndpointSnapshot {
    PortainerEndpointSnapshot {
        time: raw.time,
        docker_version: raw.docker_version,
        swarm: raw.swarm,
        total_cpu: raw.total_cpu,
        total_memory: raw.total_memory,
        running_container_count: raw.running,
        stopped_container_count: raw.stopped,
        healthy_container_count: raw.healthy,
        unhealthy_container_count: raw.unhealthy,
        image_count: raw.images,
        volume_count: raw.volumes,
        stack_count: raw.stacks,
    }
}

fn map_endpoint(raw: RawEndpoint) -> PortainerEndpoint {
    PortainerEndpoint {
        id: raw.id,
        name: raw.name,
        endpoint_type: raw.endpoint_type,
        url: raw.url,
        status: raw.status,
        group_id: raw.group_id,
        snapshots: raw.snapshots.into_iter().map(map_snapshot).collect(),
    }
}

impl PortainerClient {
    /// `GET /api/endpoints`
    pub async fn list_endpoints(&self) -> PortainerResult<Vec<PortainerEndpoint>> {
        let (status, bytes) = self
            .send_raw(reqwest::Method::GET, "/endpoints", None)
            .await?;
        if !(200..300).contains(&status) {
            let text = String::from_utf8_lossy(&bytes);
            return Err(crate::error::PortainerError::from_status(
                status,
                &text,
                self.auth_mode() == crate::types::PortainerAuthMode::ApiKey,
            ));
        }
        parse_endpoints(&bytes)
            .map_err(|e| crate::error::PortainerError::parse(format!("/endpoints: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] = br#"[{"Id":1,"Name":"local","Type":1,"URL":"unix:///var/run/docker.sock","Status":1,"GroupId":1,
            "Snapshots":[{"Time":1700000000,"DockerVersion":"24.0.7","Swarm":false,"TotalCPU":8,"TotalMemory":16777216,
            "RunningContainerCount":3,"StoppedContainerCount":1,"HealthyContainerCount":0,"UnhealthyContainerCount":0,
            "ImageCount":12,"VolumeCount":4,"StackCount":2}]},
            {"Id":2,"Name":"edge","Type":4,"URL":"","Status":2}]"#;

    #[test]
    fn parses_endpoint_list_with_snapshot_counts() {
        let eps = parse_endpoints(SAMPLE).unwrap();
        assert_eq!(eps.len(), 2);
        assert_eq!(eps[0].name, "local");
        let snap = &eps[0].snapshots[0];
        assert_eq!(snap.running_container_count, Some(3));
        assert_eq!(snap.stopped_container_count, Some(1));
        assert_eq!(snap.docker_version.as_deref(), Some("24.0.7"));
        assert_eq!(snap.total_cpu, Some(8));
        assert_eq!(snap.image_count, Some(12));
        assert_eq!(snap.stack_count, Some(2));
        assert_eq!(eps[1].status, 2);
        assert!(eps[1].snapshots.is_empty(), "no Snapshots key → empty vec");
        assert_eq!(eps[1].group_id, None);
    }

    /// The panel (`PortainerEndpointsTab.tsx`) reads `ep.type` and
    /// `ep.snapshots[0].runningContainerCount` — lock those wire names down.
    #[test]
    fn serialises_to_the_wire_names_the_panel_reads() {
        let eps = parse_endpoints(SAMPLE).unwrap();
        let v = serde_json::to_value(&eps).unwrap();
        assert_eq!(v[0]["type"], 1, "endpoint type must serialise as `type`");
        assert!(
            v[0].get("endpointType").is_none(),
            "must not leak `endpointType`"
        );
        assert_eq!(v[0]["snapshots"][0]["runningContainerCount"], 3);
        assert_eq!(v[0]["snapshots"][0]["stoppedContainerCount"], 1);
        assert_eq!(v[0]["snapshots"][0]["dockerVersion"], "24.0.7");
        assert_eq!(v[0]["snapshots"][0]["totalCpu"], 8);
        assert_eq!(v[0]["groupId"], 1);
        assert!(v[1]["snapshots"].as_array().unwrap().is_empty());
    }
}
