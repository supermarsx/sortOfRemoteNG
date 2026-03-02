// ── sorng-docker/src/service.rs ───────────────────────────────────────────────
//! Aggregate Docker façade – single entry point that holds connections
//! and delegates to domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::DockerClient;
use crate::error::{DockerError, DockerResult};
use crate::types::*;

use crate::containers::ContainerManager;
use crate::images::ImageManager;
use crate::volumes::VolumeManager;
use crate::networks::NetworkManager;
use crate::compose::ComposeManager;
use crate::system::SystemManager;
use crate::registry::RegistryManager;

/// Shared Tauri state handle.
pub type DockerServiceState = Arc<Mutex<DockerService>>;

/// Main Docker service managing connections.
pub struct DockerService {
    connections: HashMap<String, DockerClient>,
}

impl DockerService {
    pub fn new() -> Self {
        Self { connections: HashMap::new() }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    pub async fn connect(&mut self, id: String, config: DockerConnectionConfig) -> DockerResult<DockerSystemInfo> {
        let client = DockerClient::from_config(&config).await?;
        let info = client.info().await?;
        self.connections.insert(id, client);
        Ok(info)
    }

    pub fn disconnect(&mut self, id: &str) -> DockerResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| DockerError::session(&format!("No connection '{}'", id)))
    }

    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    fn client(&self, id: &str) -> DockerResult<&DockerClient> {
        self.connections.get(id)
            .ok_or_else(|| DockerError::session(&format!("No connection '{}'", id)))
    }

    // ── System ────────────────────────────────────────────────────

    pub async fn system_info(&self, id: &str) -> DockerResult<DockerSystemInfo> {
        SystemManager::info(self.client(id)?).await
    }

    pub async fn system_version(&self, id: &str) -> DockerResult<DockerVersionInfo> {
        SystemManager::version(self.client(id)?).await
    }

    pub async fn ping(&self, id: &str) -> DockerResult<bool> {
        SystemManager::ping(self.client(id)?).await
    }

    pub async fn disk_usage(&self, id: &str) -> DockerResult<DockerDiskUsage> {
        SystemManager::disk_usage(self.client(id)?).await
    }

    pub async fn system_events(&self, id: &str, filter: &DockerEventFilter) -> DockerResult<Vec<DockerEvent>> {
        SystemManager::events(self.client(id)?, filter).await
    }

    pub async fn system_prune(&self, id: &str, all: bool, volumes: bool) -> DockerResult<PruneResult> {
        SystemManager::system_prune(self.client(id)?, all, volumes).await
    }

    // ── Containers ────────────────────────────────────────────────

    pub async fn list_containers(&self, id: &str, opts: &ListContainersOptions) -> DockerResult<Vec<ContainerSummary>> {
        ContainerManager::list(self.client(id)?, opts).await
    }

    pub async fn inspect_container(&self, id: &str, container_id: &str) -> DockerResult<ContainerInspect> {
        ContainerManager::inspect(self.client(id)?, container_id).await
    }

    pub async fn create_container(&self, id: &str, config: &CreateContainerConfig) -> DockerResult<CreateContainerResponse> {
        ContainerManager::create(self.client(id)?, config).await
    }

    pub async fn run_container(&self, id: &str, config: &CreateContainerConfig) -> DockerResult<CreateContainerResponse> {
        ContainerManager::run(self.client(id)?, config).await
    }

    pub async fn start_container(&self, id: &str, container_id: &str) -> DockerResult<()> {
        ContainerManager::start(self.client(id)?, container_id).await
    }

    pub async fn stop_container(&self, id: &str, container_id: &str, timeout: Option<i32>) -> DockerResult<()> {
        ContainerManager::stop(self.client(id)?, container_id, timeout).await
    }

    pub async fn restart_container(&self, id: &str, container_id: &str, timeout: Option<i32>) -> DockerResult<()> {
        ContainerManager::restart(self.client(id)?, container_id, timeout).await
    }

    pub async fn kill_container(&self, id: &str, container_id: &str, signal: Option<String>) -> DockerResult<()> {
        ContainerManager::kill(self.client(id)?, container_id, signal.as_deref()).await
    }

    pub async fn pause_container(&self, id: &str, container_id: &str) -> DockerResult<()> {
        ContainerManager::pause(self.client(id)?, container_id).await
    }

    pub async fn unpause_container(&self, id: &str, container_id: &str) -> DockerResult<()> {
        ContainerManager::unpause(self.client(id)?, container_id).await
    }

    pub async fn remove_container(&self, id: &str, container_id: &str, force: bool, volumes: bool) -> DockerResult<()> {
        ContainerManager::remove(self.client(id)?, container_id, force, volumes).await
    }

    pub async fn rename_container(&self, id: &str, container_id: &str, new_name: &str) -> DockerResult<()> {
        ContainerManager::rename(self.client(id)?, container_id, new_name).await
    }

    pub async fn container_logs(&self, id: &str, container_id: &str, opts: &ContainerLogOptions) -> DockerResult<String> {
        ContainerManager::logs(self.client(id)?, container_id, opts).await
    }

    pub async fn container_stats(&self, id: &str, container_id: &str) -> DockerResult<ContainerStats> {
        ContainerManager::stats(self.client(id)?, container_id).await
    }

    pub async fn container_top(&self, id: &str, container_id: &str, ps_args: Option<String>) -> DockerResult<ContainerTop> {
        ContainerManager::top(self.client(id)?, container_id, ps_args.as_deref()).await
    }

    pub async fn container_changes(&self, id: &str, container_id: &str) -> DockerResult<Vec<ContainerChange>> {
        ContainerManager::changes(self.client(id)?, container_id).await
    }

    pub async fn container_wait(&self, id: &str, container_id: &str) -> DockerResult<ContainerWaitResult> {
        ContainerManager::wait(self.client(id)?, container_id).await
    }

    pub async fn container_exec(&self, id: &str, container_id: &str, config: &ExecConfig) -> DockerResult<String> {
        let c = self.client(id)?;
        let exec = ContainerManager::exec_create(c, container_id, config).await?;
        ContainerManager::exec_start(c, &exec.id).await
    }

    pub async fn container_update(&self, id: &str, container_id: &str, update: &serde_json::Value) -> DockerResult<serde_json::Value> {
        ContainerManager::update(self.client(id)?, container_id, update).await
    }

    pub async fn prune_containers(&self, id: &str) -> DockerResult<PruneResult> {
        ContainerManager::prune(self.client(id)?, None).await
    }

    // ── Images ────────────────────────────────────────────────────

    pub async fn list_images(&self, id: &str, opts: &ListImagesOptions) -> DockerResult<Vec<ImageSummary>> {
        ImageManager::list(self.client(id)?, opts).await
    }

    pub async fn inspect_image(&self, id: &str, name: &str) -> DockerResult<ImageInspect> {
        ImageManager::inspect(self.client(id)?, name).await
    }

    pub async fn image_history(&self, id: &str, name: &str) -> DockerResult<Vec<ImageHistoryEntry>> {
        ImageManager::history(self.client(id)?, name).await
    }

    pub async fn pull_image(&self, id: &str, image: &str, tag: Option<String>) -> DockerResult<String> {
        ImageManager::pull(self.client(id)?, image, tag.as_deref()).await
    }

    pub async fn tag_image(&self, id: &str, source: &str, repo: &str, tag: &str) -> DockerResult<()> {
        ImageManager::tag(self.client(id)?, source, repo, tag).await
    }

    pub async fn push_image(&self, id: &str, name: &str, tag: Option<String>) -> DockerResult<String> {
        ImageManager::push(self.client(id)?, name, tag.as_deref()).await
    }

    pub async fn remove_image(&self, id: &str, name: &str, force: bool) -> DockerResult<()> {
        ImageManager::remove(self.client(id)?, name, force, false).await
    }

    pub async fn search_images(&self, id: &str, term: &str, limit: Option<i32>) -> DockerResult<Vec<RegistrySearchResult>> {
        ImageManager::search(self.client(id)?, term, limit).await
    }

    pub async fn prune_images(&self, id: &str, dangling_only: bool) -> DockerResult<PruneResult> {
        ImageManager::prune(self.client(id)?, dangling_only).await
    }

    pub async fn commit_container(&self, id: &str, container_id: &str, repo: &str, tag: &str) -> DockerResult<serde_json::Value> {
        ImageManager::commit(self.client(id)?, container_id, repo, tag, None, None).await
    }

    // ── Volumes ───────────────────────────────────────────────────

    pub async fn list_volumes(&self, id: &str, opts: &ListVolumesOptions) -> DockerResult<Vec<VolumeInfo>> {
        VolumeManager::list(self.client(id)?, opts).await
    }

    pub async fn inspect_volume(&self, id: &str, name: &str) -> DockerResult<VolumeInfo> {
        VolumeManager::inspect(self.client(id)?, name).await
    }

    pub async fn create_volume(&self, id: &str, config: &CreateVolumeConfig) -> DockerResult<VolumeInfo> {
        VolumeManager::create(self.client(id)?, config).await
    }

    pub async fn remove_volume(&self, id: &str, name: &str, force: bool) -> DockerResult<()> {
        VolumeManager::remove(self.client(id)?, name, force).await
    }

    pub async fn prune_volumes(&self, id: &str) -> DockerResult<PruneResult> {
        VolumeManager::prune(self.client(id)?, None).await
    }

    // ── Networks ──────────────────────────────────────────────────

    pub async fn list_networks(&self, id: &str, opts: &ListNetworksOptions) -> DockerResult<Vec<NetworkInfo>> {
        NetworkManager::list(self.client(id)?, opts).await
    }

    pub async fn inspect_network(&self, id: &str, network_id: &str) -> DockerResult<NetworkInfo> {
        NetworkManager::inspect(self.client(id)?, network_id).await
    }

    pub async fn create_network(&self, id: &str, config: &CreateNetworkConfig) -> DockerResult<CreateNetworkResponse> {
        NetworkManager::create(self.client(id)?, config).await
    }

    pub async fn remove_network(&self, id: &str, network_id: &str) -> DockerResult<()> {
        NetworkManager::remove(self.client(id)?, network_id).await
    }

    pub async fn connect_network(&self, id: &str, network_id: &str, config: &ConnectNetworkConfig) -> DockerResult<()> {
        NetworkManager::connect(self.client(id)?, network_id, config).await
    }

    pub async fn disconnect_network(&self, id: &str, network_id: &str, container_id: &str, force: bool) -> DockerResult<()> {
        NetworkManager::disconnect(self.client(id)?, network_id, container_id, force).await
    }

    pub async fn prune_networks(&self, id: &str) -> DockerResult<PruneResult> {
        NetworkManager::prune(self.client(id)?, None).await
    }

    // ── Compose ───────────────────────────────────────────────────

    pub fn compose_is_available(&self) -> bool {
        ComposeManager::is_available()
    }

    pub fn compose_version(&self) -> DockerResult<String> {
        ComposeManager::version()
    }

    pub fn compose_list_projects(&self) -> DockerResult<Vec<ComposeProject>> {
        ComposeManager::list_projects()
    }

    pub fn compose_up(&self, config: &ComposeUpConfig) -> DockerResult<String> {
        ComposeManager::up(config)
    }

    pub fn compose_down(&self, config: &ComposeDownConfig) -> DockerResult<String> {
        ComposeManager::down(config)
    }

    pub fn compose_ps(&self, files: &[String], project_name: Option<&str>) -> DockerResult<Vec<ComposePsItem>> {
        ComposeManager::ps(files, project_name)
    }

    pub fn compose_logs(&self, config: &ComposeLogsConfig) -> DockerResult<String> {
        ComposeManager::logs(config)
    }

    pub fn compose_build(&self, config: &ComposeBuildConfig) -> DockerResult<String> {
        ComposeManager::build(config)
    }

    pub fn compose_pull(&self, config: &ComposePullConfig) -> DockerResult<String> {
        ComposeManager::pull(config)
    }

    pub fn compose_restart(&self, files: &[String], project_name: Option<&str>, services: Option<&[String]>, timeout: Option<i32>) -> DockerResult<String> {
        ComposeManager::restart(files, project_name, services, timeout)
    }

    pub fn compose_stop(&self, files: &[String], project_name: Option<&str>, services: Option<&[String]>, timeout: Option<i32>) -> DockerResult<String> {
        ComposeManager::stop(files, project_name, services, timeout)
    }

    pub fn compose_start(&self, files: &[String], project_name: Option<&str>, services: Option<&[String]>) -> DockerResult<String> {
        ComposeManager::start(files, project_name, services)
    }

    pub fn compose_config(&self, files: &[String], project_name: Option<&str>) -> DockerResult<String> {
        ComposeManager::config(files, project_name)
    }

    // ── Registry ──────────────────────────────────────────────────

    pub async fn registry_login(&self, id: &str, creds: &RegistryCredentials) -> DockerResult<RegistryAuthResult> {
        RegistryManager::login(self.client(id)?, creds).await
    }

    pub async fn registry_search(&self, id: &str, term: &str, limit: Option<i32>) -> DockerResult<Vec<RegistrySearchResult>> {
        RegistryManager::search(self.client(id)?, term, limit).await
    }
}

impl Default for DockerService {
    fn default() -> Self {
        Self::new()
    }
}
