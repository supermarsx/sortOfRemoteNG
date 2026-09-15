//! Docker / Container Manager — containers, images, registries, networks, projects.
//!
//! Container Manager wraps its lists (`{"containers":[…],"total":n}`,
//! `{"images":[…]}`, `{"network":[…]}`) and answers project `list` with a map
//! keyed by project id (synology-go `projects/response.go`, N4S4/synology-api
//! `docker_api.py`, vcf-content-factory `synology-docker.md` [observed DSM
//! 7.3.2]). Private wire structs keep DSM's names and map into the IPC DTOs.
//! String parameters are JSON-quoted where discovery declares
//! `requestFormat: "JSON"` (`wire::string_param`).

use std::collections::BTreeMap;

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::types::*;
use crate::wire::string_param;
use serde::{de::Error as _, Deserialize, Deserializer};

const CONTAINER: &str = "SYNO.Docker.Container";
const IMAGE: &str = "SYNO.Docker.Image";
const NETWORK: &str = "SYNO.Docker.Network";
const PROJECT: &str = "SYNO.Docker.Project";
const MANAGER_PROJECT: &str = "SYNO.ContainerManager.Project";

pub struct DockerManager;

/// absent | `null` -> None; a Unix time in seconds (number or numeric string)
/// -> RFC 3339. A time outside chrono's range fails the decode.
fn opt_unix_rfc3339<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    crate::wire::opt_i64_lenient(deserializer)?
        .map(|seconds| {
            chrono::DateTime::from_timestamp(seconds, 0)
                .map(|time| time.to_rfc3339())
                .ok_or_else(|| D::Error::custom("expected a Unix time"))
        })
        .transpose()
}

/// One `SYNO.Docker.Container` `list` row. DSM 7.3.2 sends `up_time` and
/// `finish_time` as `null`; DSM 7.2 (dsm_helper) sends `up_time` as a number.
/// The Docker engine state is the capitalised `State` object.
#[derive(Deserialize)]
struct ContainerWire {
    id: String,
    name: String,
    image: String,
    status: String,
    #[serde(default, deserialize_with = "opt_unix_rfc3339")]
    created: Option<String>,
    #[serde(default, deserialize_with = "crate::wire::opt_u64_lenient")]
    up_time: Option<u64>,
    #[serde(default, rename = "State")]
    state: Option<ContainerStateWire>,
}

#[derive(Deserialize)]
struct ContainerStateWire {
    #[serde(default, rename = "Status")]
    status: Option<String>,
    #[serde(default, rename = "FinishedAt")]
    finished_at: Option<String>,
}

impl From<ContainerWire> for DockerContainer {
    fn from(wire: ContainerWire) -> Self {
        let (state, finished_at) = match wire.state {
            Some(state) => (state.status, state.finished_at),
            None => (None, None),
        };
        DockerContainer {
            state: state.unwrap_or_else(|| wire.status.clone()),
            id: wire.id,
            name: wire.name,
            image: wire.image,
            status: wire.status,
            created: wire.created,
            finished_at,
            up_time: wire.up_time,
            // CPU and memory come from `SYNO.Docker.Container.Resource`; ports
            // and mounts only from the per-container `get` details.
            cpu_percent: None,
            memory_usage: None,
            memory_limit: None,
            ports: None,
            volumes: None,
        }
    }
}

/// One `SYNO.Docker.Image` `list` row.
#[derive(Deserialize)]
struct ImageWire {
    id: String,
    repository: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, deserialize_with = "opt_unix_rfc3339")]
    created: Option<String>,
    #[serde(deserialize_with = "crate::wire::u64_lenient")]
    size: u64,
    #[serde(default, deserialize_with = "crate::wire::opt_u64_lenient")]
    virtual_size: Option<u64>,
}

impl From<ImageWire> for DockerImage {
    fn from(wire: ImageWire) -> Self {
        DockerImage {
            id: wire.id,
            repository: wire.repository,
            tag: wire.tags.join(", "),
            created: wire.created,
            size: wire.size,
            virtual_size: wire.virtual_size,
        }
    }
}

/// One `SYNO.Docker.Network` `list` row; `containers` lists container names.
#[derive(Deserialize)]
struct NetworkWire {
    id: String,
    name: String,
    driver: String,
    #[serde(default)]
    subnet: Option<String>,
    #[serde(default)]
    gateway: Option<String>,
    #[serde(default)]
    containers: Option<Vec<String>>,
}

impl From<NetworkWire> for DockerNetwork {
    fn from(wire: NetworkWire) -> Self {
        DockerNetwork {
            id: wire.id,
            name: wire.name,
            driver: wire.driver,
            scope: None,
            subnet: wire.subnet.filter(|subnet| !subnet.is_empty()),
            gateway: wire.gateway.filter(|gateway| !gateway.is_empty()),
            containers: wire
                .containers
                .map(|names| u32::try_from(names.len()).unwrap_or(u32::MAX)),
        }
    }
}

/// Project `list` data: DSM sends `{"<id>": project, …}` (`{}` when there are
/// none). A bare array of projects is accepted too.
#[derive(Deserialize)]
#[serde(untagged)]
enum ProjectsWire {
    ById(BTreeMap<String, ProjectWire>),
    List(Vec<ProjectWire>),
}

#[derive(Deserialize)]
struct ProjectWire {
    #[serde(default)]
    id: Option<String>,
    name: String,
    status: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    services: Option<Vec<ProjectServiceWire>>,
}

/// DSM lists a project's portal services as objects; plain names are accepted.
#[derive(Deserialize)]
#[serde(untagged)]
enum ProjectServiceWire {
    Name(String),
    Entry {
        #[serde(default)]
        display_name: Option<String>,
        #[serde(default)]
        id: Option<String>,
    },
}

impl From<ProjectWire> for DockerProject {
    fn from(wire: ProjectWire) -> Self {
        DockerProject {
            id: wire.id,
            name: wire.name,
            status: wire.status,
            services: wire
                .services
                .unwrap_or_default()
                .into_iter()
                .filter_map(|service| match service {
                    ProjectServiceWire::Name(name) => Some(name),
                    ProjectServiceWire::Entry { display_name, id } => display_name.or(id),
                })
                .collect(),
            path: wire.path,
        }
    }
}

impl From<ProjectsWire> for Vec<DockerProject> {
    fn from(wire: ProjectsWire) -> Self {
        match wire {
            ProjectsWire::ById(projects) => projects
                .into_iter()
                .map(|(key, project)| {
                    let mut project = DockerProject::from(project);
                    project.id = project.id.or(Some(key));
                    project
                })
                .collect(),
            ProjectsWire::List(projects) => projects.into_iter().map(DockerProject::from).collect(),
        }
    }
}

impl DockerManager {
    // ─── Containers ──────────────────────────────────────────────

    /// List all containers, running or not (`type=all`, as every client sends).
    pub async fn list_containers(client: &SynoClient) -> SynologyResult<Vec<DockerContainer>> {
        let v = client.best_version(CONTAINER, 1).unwrap_or(1);
        let kind = string_param(client, CONTAINER, "all");
        let rows: Vec<ContainerWire> = client
            .api_list(
                CONTAINER,
                v,
                "list",
                &[("limit", "500"), ("offset", "0"), ("type", &kind)],
                &["containers"],
            )
            .await?;
        Ok(rows.into_iter().map(DockerContainer::from).collect())
    }

    /// Get container details.
    pub async fn get_container(client: &SynoClient, name: &str) -> SynologyResult<DockerContainer> {
        let v = client.best_version(CONTAINER, 1).unwrap_or(1);
        let name = string_param(client, CONTAINER, name);
        client
            .api_call(CONTAINER, v, "get", &[("name", &name)])
            .await
    }

    /// Start a container.
    pub async fn start_container(client: &SynoClient, name: &str) -> SynologyResult<()> {
        Self::container_action(client, "start", name).await
    }

    /// Stop a container.
    pub async fn stop_container(client: &SynoClient, name: &str) -> SynologyResult<()> {
        Self::container_action(client, "stop", name).await
    }

    /// Restart a container.
    pub async fn restart_container(client: &SynoClient, name: &str) -> SynologyResult<()> {
        Self::container_action(client, "restart", name).await
    }

    async fn container_action(client: &SynoClient, method: &str, name: &str) -> SynologyResult<()> {
        let v = client.best_version(CONTAINER, 1).unwrap_or(1);
        let name = string_param(client, CONTAINER, name);
        client
            .api_post_void(CONTAINER, v, method, &[("name", &name)])
            .await
    }

    /// Delete a container.
    pub async fn delete_container(
        client: &SynoClient,
        name: &str,
        force: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version(CONTAINER, 1).unwrap_or(1);
        let f = if force { "true" } else { "false" };
        let name = string_param(client, CONTAINER, name);
        client
            .api_post_void(CONTAINER, v, "delete", &[("name", &name), ("force", f)])
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
        let name = string_param(client, "SYNO.Docker.Container.Log", name);
        client
            .api_call("SYNO.Docker.Container.Log", v, "get", &[("name", &name)])
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
        let name = string_param(client, "SYNO.Docker.Container.Resource", name);
        client
            .api_call(
                "SYNO.Docker.Container.Resource",
                v,
                "get",
                &[("name", &name)],
            )
            .await
    }

    // ─── Images ──────────────────────────────────────────────────

    /// List all images. `tag` joins an image's tags with ", ".
    pub async fn list_images(client: &SynoClient) -> SynologyResult<Vec<DockerImage>> {
        let v = client.best_version(IMAGE, 1).unwrap_or(1);
        let rows: Vec<ImageWire> = client
            .api_list(
                IMAGE,
                v,
                "list",
                &[("limit", "500"), ("offset", "0")],
                &["images"],
            )
            .await?;
        Ok(rows.into_iter().map(DockerImage::from).collect())
    }

    /// Pull an image from a registry.
    pub async fn pull_image(
        client: &SynoClient,
        repository: &str,
        tag: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version(IMAGE, 1).unwrap_or(1);
        let repository = string_param(client, IMAGE, repository);
        let tag = string_param(client, IMAGE, tag);
        client
            .api_post_void(
                IMAGE,
                v,
                "pull",
                &[("repository", &repository), ("tag", &tag)],
            )
            .await
    }

    /// Delete an image.
    pub async fn delete_image(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version(IMAGE, 1).unwrap_or(1);
        let name = string_param(client, IMAGE, name);
        client
            .api_post_void(IMAGE, v, "delete", &[("name", &name)])
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

    /// List Docker networks. `containers` counts the attached container names.
    pub async fn list_networks(client: &SynoClient) -> SynologyResult<Vec<DockerNetwork>> {
        let v = client.best_version(NETWORK, 1).unwrap_or(1);
        let rows: Vec<NetworkWire> = client
            .api_list(NETWORK, v, "list", &[], &["network"])
            .await?;
        Ok(rows.into_iter().map(DockerNetwork::from).collect())
    }

    /// Create a Docker network.
    pub async fn create_network(
        client: &SynoClient,
        name: &str,
        driver: &str,
        subnet: &str,
        gateway: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version(NETWORK, 1).unwrap_or(1);
        let [name, driver, subnet, gateway] =
            [name, driver, subnet, gateway].map(|value| string_param(client, NETWORK, value));
        client
            .api_post_void(
                NETWORK,
                v,
                "create",
                &[
                    ("name", &name),
                    ("driver", &driver),
                    ("subnet", &subnet),
                    ("gateway", &gateway),
                ],
            )
            .await
    }

    /// Delete a Docker network.
    pub async fn delete_network(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version(NETWORK, 1).unwrap_or(1);
        let name = string_param(client, NETWORK, name);
        client
            .api_post_void(NETWORK, v, "delete", &[("name", &name)])
            .await
    }

    // ─── Container Manager Projects (Compose) ───────────────────

    /// The project API: `SYNO.ContainerManager.Project` when discovery lists it,
    /// otherwise `SYNO.Docker.Project` (the name DSM 7.2 catalogs carry).
    fn project_api(client: &SynoClient) -> &'static str {
        if client.has_api(MANAGER_PROJECT) {
            MANAGER_PROJECT
        } else {
            PROJECT
        }
    }

    async fn projects_at(client: &SynoClient, api: &str) -> SynologyResult<Vec<DockerProject>> {
        let v = client.best_version(api, 1).unwrap_or(1);
        let projects: ProjectsWire = client.api_call(api, v, "list", &[]).await?;
        Ok(projects.into())
    }

    /// List Docker Compose projects (Container Manager / DSM 7.2+).
    pub async fn list_projects(client: &SynoClient) -> SynologyResult<Vec<DockerProject>> {
        Self::projects_at(client, Self::project_api(client)).await
    }

    /// DSM starts and stops a project by its id (N4S4 `start_project`,
    /// synology-go quotes `id`). The panel names a project, so the id is
    /// looked up first; exactly one project must match by id or by name.
    async fn resolve_project_id(
        client: &SynoClient,
        api: &str,
        name_or_id: &str,
    ) -> SynologyResult<String> {
        let mut matches = Self::projects_at(client, api)
            .await?
            .into_iter()
            .filter(|project| {
                project.name == name_or_id || project.id.as_deref() == Some(name_or_id)
            });
        match (matches.next(), matches.next()) {
            (Some(DockerProject { id: Some(id), .. }), None) => Ok(id),
            _ => Err(SynologyError::parse("Select one Container Manager project")),
        }
    }

    async fn project_action(
        client: &SynoClient,
        method: &str,
        name_or_id: &str,
    ) -> SynologyResult<()> {
        let api = Self::project_api(client);
        let id = Self::resolve_project_id(client, api, name_or_id).await?;
        let v = client.best_version(api, 1).unwrap_or(1);
        let id = string_param(client, api, &id);
        client.api_post_void(api, v, method, &[("id", &id)]).await
    }

    /// Start a Compose project, named by its name or id.
    pub async fn start_project(client: &SynoClient, name: &str) -> SynologyResult<()> {
        Self::project_action(client, "start", name).await
    }

    /// Stop a Compose project, named by its name or id.
    pub async fn stop_project(client: &SynoClient, name: &str) -> SynologyResult<()> {
        Self::project_action(client, "stop", name).await
    }
}
