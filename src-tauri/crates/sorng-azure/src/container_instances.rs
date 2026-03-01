//! Azure Container Instances – container groups, logs.

use log::debug;

use crate::client::AzureClient;
use crate::types::{AzureResult, ContainerGroup, ContainerLogs};

// ─── Container Groups ───────────────────────────────────────────────

pub async fn list_container_groups(
    client: &AzureClient,
) -> AzureResult<Vec<ContainerGroup>> {
    let api = &client.config().api_version_container;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.ContainerInstance/containerGroups?api-version={}",
        api
    ))?;
    debug!("list_container_groups → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_container_groups_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<ContainerGroup>> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups?api-version={}",
        api
    ))?;
    debug!("list_container_groups_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_container_group(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<ContainerGroup> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}?api-version={}",
        name, api
    ))?;
    debug!("get_container_group({}/{}) → {}", rg, name, url);
    client.get_json(&url).await
}

pub async fn create_container_group(
    client: &AzureClient,
    rg: &str,
    name: &str,
    body: &serde_json::Value,
) -> AzureResult<ContainerGroup> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}?api-version={}",
        name, api
    ))?;
    debug!("create_container_group({}/{}) → {}", rg, name, url);
    client.put_json(&url, body).await
}

pub async fn delete_container_group(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}?api-version={}",
        name, api
    ))?;
    debug!("delete_container_group({}/{}) → {}", rg, name, url);
    client.delete(&url).await
}

pub async fn restart_container_group(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}/restart?api-version={}",
        name, api
    ))?;
    debug!("restart_container_group({}/{}) → {}", rg, name, url);
    client.post_action(&url).await
}

pub async fn stop_container_group(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}/stop?api-version={}",
        name, api
    ))?;
    debug!("stop_container_group({}/{}) → {}", rg, name, url);
    client.post_action(&url).await
}

pub async fn start_container_group(
    client: &AzureClient,
    rg: &str,
    name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_container;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}/start?api-version={}",
        name, api
    ))?;
    debug!("start_container_group({}/{}) → {}", rg, name, url);
    client.post_action(&url).await
}

// ─── Container Logs ─────────────────────────────────────────────────

pub async fn get_container_logs(
    client: &AzureClient,
    rg: &str,
    group_name: &str,
    container_name: &str,
    tail: Option<u32>,
) -> AzureResult<ContainerLogs> {
    let api = &client.config().api_version_container;
    let mut path = format!(
        "/providers/Microsoft.ContainerInstance/containerGroups/{}/containers/{}/logs?api-version={}",
        group_name, container_name, api
    );
    if let Some(n) = tail {
        path.push_str(&format!("&tail={}", n));
    }
    let url = client.resource_group_url(rg, &path)?;
    debug!("get_container_logs({}/{}/{}) → {}", rg, group_name, container_name, url);
    client.get_json(&url).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_group_deserialize() {
        let json = r#"{"id":"x","name":"cg1","location":"eastus","properties":{"provisioningState":"Succeeded","containers":[{"name":"c1","properties":{"image":"nginx:latest","resources":{"requests":{"cpu":1.0,"memoryInGB":1.5}}}}],"osType":"Linux","ipAddress":{"ip":"20.1.2.3","type":"Public","ports":[{"protocol":"TCP","port":80}]}}}"#;
        let cg: ContainerGroup = serde_json::from_str(json).unwrap();
        assert_eq!(cg.name, "cg1");
        let p = cg.properties.unwrap();
        assert_eq!(p.provisioning_state, Some("Succeeded".into()));
        assert_eq!(p.os_type, Some("Linux".into()));
        assert_eq!(p.containers.len(), 1);
        assert_eq!(p.containers[0].name, "c1");
    }

    #[test]
    fn container_logs_deserialize() {
        let json = r#"{"content":"hello world\nline2\n"}"#;
        let l: ContainerLogs = serde_json::from_str(json).unwrap();
        assert!(l.content.unwrap().contains("hello world"));
    }

    #[test]
    fn container_logs_tail_query_param() {
        let path = format!(
            "/providers/Microsoft.ContainerInstance/containerGroups/cg1/containers/c1/logs?api-version=2023-05-01&tail={}",
            50
        );
        assert!(path.contains("tail=50"));
    }
}
