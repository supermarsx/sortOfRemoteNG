//! Docker / Container Manager — containers, images, registries, networks, projects.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct DockerManager;

impl DockerManager {
    // ─── Containers ──────────────────────────────────────────────

    /// List all containers.
    pub async fn list_containers(client: &SynoClient) -> SynologyResult<Vec<DockerContainer>> {
        let v = client.best_version("SYNO.Docker.Container", 1).unwrap_or(1);
        client
            .api_call(
                "SYNO.Docker.Container",
                v,
                "list",
                &[("limit", "500"), ("offset", "0")],
            )
            .await
    }

    /// Get container details.
    pub async fn get_container(client: &SynoClient, name: &str) -> SynologyResult<DockerContainer> {
        let v = client.best_version("SYNO.Docker.Container", 1).unwrap_or(1);
        client
            .api_call("SYNO.Docker.Container", v, "get", &[("name", name)])
            .await
    }

    /// Start a container.
    pub async fn start_container(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Container", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Docker.Container", v, "start", &[("name", name)])
            .await
    }

    /// Stop a container.
    pub async fn stop_container(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Container", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Docker.Container", v, "stop", &[("name", name)])
            .await
    }

    /// Restart a container.
    pub async fn restart_container(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Container", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Docker.Container", v, "restart", &[("name", name)])
            .await
    }

    /// Delete a container.
    pub async fn delete_container(
        client: &SynoClient,
        name: &str,
        force: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Container", 1).unwrap_or(1);
        let f = if force { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.Docker.Container",
                v,
                "delete",
                &[("name", name), ("force", f)],
            )
            .await
    }

    /// Get container logs.
    pub async fn get_container_logs(
        client: &SynoClient,
        name: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Docker.Container.Log", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Docker.Container.Log", v, "get", &[("name", name)])
            .await
    }

    /// Get container resource usage (CPU / memory).
    pub async fn get_container_stats(
        client: &SynoClient,
        name: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Docker.Container.Resource", 1)
            .unwrap_or(1);
        client
            .api_call(
                "SYNO.Docker.Container.Resource",
                v,
                "get",
                &[("name", name)],
            )
            .await
    }

    // ─── Images ──────────────────────────────────────────────────

    /// List all images.
    pub async fn list_images(client: &SynoClient) -> SynologyResult<Vec<DockerImage>> {
        let v = client.best_version("SYNO.Docker.Image", 1).unwrap_or(1);
        client
            .api_call(
                "SYNO.Docker.Image",
                v,
                "list",
                &[("limit", "500"), ("offset", "0")],
            )
            .await
    }

    /// Pull an image from a registry.
    pub async fn pull_image(
        client: &SynoClient,
        repository: &str,
        tag: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Image", 1).unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Docker.Image",
                v,
                "pull",
                &[("repository", repository), ("tag", tag)],
            )
            .await
    }

    /// Delete an image.
    pub async fn delete_image(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Image", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Docker.Image", v, "delete", &[("name", name)])
            .await
    }

    // ─── Registries ──────────────────────────────────────────────

    /// List configured registries.
    pub async fn list_registries(client: &SynoClient) -> SynologyResult<Vec<DockerRegistry>> {
        let v = client.best_version("SYNO.Docker.Registry", 1).unwrap_or(1);
        client
            .api_call("SYNO.Docker.Registry", v, "list", &[])
            .await
    }

    // ─── Networks ────────────────────────────────────────────────

    /// List Docker networks.
    pub async fn list_networks(client: &SynoClient) -> SynologyResult<Vec<DockerNetwork>> {
        let v = client.best_version("SYNO.Docker.Network", 1).unwrap_or(1);
        client.api_call("SYNO.Docker.Network", v, "list", &[]).await
    }

    /// Create a Docker network.
    pub async fn create_network(
        client: &SynoClient,
        name: &str,
        driver: &str,
        subnet: &str,
        gateway: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Network", 1).unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Docker.Network",
                v,
                "create",
                &[
                    ("name", name),
                    ("driver", driver),
                    ("subnet", subnet),
                    ("gateway", gateway),
                ],
            )
            .await
    }

    /// Delete a Docker network.
    pub async fn delete_network(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Docker.Network", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Docker.Network", v, "delete", &[("name", name)])
            .await
    }

    // ─── Container Manager Projects (Compose) ───────────────────

    /// List Docker Compose projects (Container Manager / DSM 7.2+).
    pub async fn list_projects(client: &SynoClient) -> SynologyResult<Vec<DockerProject>> {
        // Try Container Manager API first (DSM 7.2+)
        if client.has_api("SYNO.ContainerManager.Project") {
            let v = client
                .best_version("SYNO.ContainerManager.Project", 1)
                .unwrap_or(1);
            return client
                .api_call("SYNO.ContainerManager.Project", v, "list", &[])
                .await;
        }
        // Fallback to older Docker project API
        let v = client.best_version("SYNO.Docker.Project", 1).unwrap_or(1);
        client.api_call("SYNO.Docker.Project", v, "list", &[]).await
    }

    /// Start a Compose project.
    pub async fn start_project(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let api = if client.has_api("SYNO.ContainerManager.Project") {
            "SYNO.ContainerManager.Project"
        } else {
            "SYNO.Docker.Project"
        };
        let v = client.best_version(api, 1).unwrap_or(1);
        client
            .api_post_void(api, v, "start", &[("name", name)])
            .await
    }

    /// Stop a Compose project.
    pub async fn stop_project(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let api = if client.has_api("SYNO.ContainerManager.Project") {
            "SYNO.ContainerManager.Project"
        } else {
            "SYNO.Docker.Project"
        };
        let v = client.best_version(api, 1).unwrap_or(1);
        client
            .api_post_void(api, v, "stop", &[("name", name)])
            .await
    }
}
