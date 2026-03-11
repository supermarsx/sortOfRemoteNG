// ── sorng-k8s/src/commands.rs ─────────────────────────────────────────────────
// Tauri command handlers – every public function is a `#[tauri::command]`.

use tauri::State;

use super::service::K8sServiceState;
use super::types::*;
use std::collections::HashMap;

// ── Connection lifecycle ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_connect(
    state: State<'_, K8sServiceState>,
    id: String,
    config: K8sConnectionConfig,
) -> Result<ClusterInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(id, config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_connect_kubeconfig(
    state: State<'_, K8sServiceState>,
    id: String,
    kubeconfig_path: Option<String>,
    context: Option<String>,
) -> Result<ClusterInfo, String> {
    let mut svc = state.lock().await;
    svc.connect_kubeconfig(id, kubeconfig_path, context)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_disconnect(state: State<'_, K8sServiceState>, id: String) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_connections(
    state: State<'_, K8sServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.list_connections())
}

// ── Kubeconfig ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_kubeconfig_default_path(
    state: State<'_, K8sServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.kubeconfig_default_path().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_kubeconfig_load(
    state: State<'_, K8sServiceState>,
    path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.kubeconfig_load(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_kubeconfig_parse(
    state: State<'_, K8sServiceState>,
    yaml: String,
) -> Result<Kubeconfig, String> {
    let svc = state.lock().await;
    svc.kubeconfig_parse(&yaml).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_kubeconfig_list_contexts(
    state: State<'_, K8sServiceState>,
    yaml: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.kubeconfig_list_contexts(&yaml)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_kubeconfig_validate(
    state: State<'_, K8sServiceState>,
    yaml: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.kubeconfig_validate(&yaml).map_err(|e| e.to_string())
}

// ── Cluster info ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_cluster_info(
    state: State<'_, K8sServiceState>,
    id: String,
) -> Result<ClusterInfo, String> {
    let svc = state.lock().await;
    svc.cluster_info(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_health_check(
    state: State<'_, K8sServiceState>,
    id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.health_check(&id).await.map_err(|e| e.to_string())
}

// ── Namespaces ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_namespaces(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<NamespaceInfo>, String> {
    let svc = state.lock().await;
    svc.list_namespaces(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_namespace(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<NamespaceInfo, String> {
    let svc = state.lock().await;
    svc.get_namespace(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_namespace(
    state: State<'_, K8sServiceState>,
    id: String,
    config: CreateNamespaceConfig,
) -> Result<NamespaceInfo, String> {
    let svc = state.lock().await;
    svc.create_namespace(&id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_namespace(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_namespace(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_namespace_labels(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
    labels: HashMap<String, String>,
) -> Result<NamespaceInfo, String> {
    let svc = state.lock().await;
    svc.update_namespace_labels(&id, &name, &labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_resource_quotas(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
) -> Result<Vec<ResourceQuotaInfo>, String> {
    let svc = state.lock().await;
    svc.list_resource_quotas(&id, &namespace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_resource_quota(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<ResourceQuotaInfo, String> {
    let svc = state.lock().await;
    svc.get_resource_quota(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_resource_quota(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    hard: HashMap<String, String>,
) -> Result<ResourceQuotaInfo, String> {
    let svc = state.lock().await;
    svc.create_resource_quota(&id, &namespace, &name, &hard)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_resource_quota(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_resource_quota(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_limit_ranges(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
) -> Result<Vec<LimitRangeInfo>, String> {
    let svc = state.lock().await;
    svc.list_limit_ranges(&id, &namespace)
        .await
        .map_err(|e| e.to_string())
}

// ── Pods ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_pods(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<PodInfo>, String> {
    let svc = state.lock().await;
    svc.list_pods(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_all_pods(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<PodInfo>, String> {
    let svc = state.lock().await;
    svc.list_all_pods(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_pod(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<PodInfo, String> {
    let svc = state.lock().await;
    svc.get_pod(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_pod(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    spec: serde_json::Value,
) -> Result<PodInfo, String> {
    let svc = state.lock().await;
    svc.create_pod(&id, &namespace, &spec)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_pod(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    opts: Option<DeleteOptions>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_pod(&id, &namespace, &name, opts.as_ref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_pod_logs(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    log_opts: Option<PodLogOptions>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.pod_logs(&id, &namespace, &name, &log_opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_evict_pod(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.evict_pod(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_pod_labels(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    labels: HashMap<String, String>,
) -> Result<PodInfo, String> {
    let svc = state.lock().await;
    svc.update_pod_labels(&id, &namespace, &name, &labels)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_pod_annotations(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    annotations: HashMap<String, String>,
) -> Result<PodInfo, String> {
    let svc = state.lock().await;
    svc.update_pod_annotations(&id, &namespace, &name, &annotations)
        .await
        .map_err(|e| e.to_string())
}

// ── Deployments ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_deployments(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<DeploymentInfo>, String> {
    let svc = state.lock().await;
    svc.list_deployments(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<DeploymentInfo, String> {
    let svc = state.lock().await;
    svc.get_deployment(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateDeploymentConfig,
) -> Result<DeploymentInfo, String> {
    let svc = state.lock().await;
    svc.create_deployment(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_deployment(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_scale_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    replicas: i32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.scale_deployment(&id, &namespace, &name, replicas)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_restart_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restart_deployment(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_pause_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_deployment(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_resume_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_deployment(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_set_deployment_image(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    container: String,
    image: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_deployment_image(&id, &namespace, &name, &container, &image)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_deployment_rollout_status(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<RolloutInfo, String> {
    let svc = state.lock().await;
    svc.deployment_rollout_status(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_rollback_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    revision: Option<i64>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rollback_deployment(&id, &namespace, &name, revision)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_all_deployments(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<DeploymentInfo>, String> {
    let svc = state.lock().await;
    svc.list_all_deployments(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    manifest: serde_json::Value,
) -> Result<DeploymentInfo, String> {
    let svc = state.lock().await;
    svc.update_deployment(&id, &namespace, &name, &manifest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_patch_deployment(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    patch: serde_json::Value,
) -> Result<DeploymentInfo, String> {
    let svc = state.lock().await;
    svc.patch_deployment(&id, &namespace, &name, &patch)
        .await
        .map_err(|e| e.to_string())
}

// ── StatefulSets, DaemonSets, ReplicaSets ─────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_statefulsets(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<StatefulSetInfo>, String> {
    let svc = state.lock().await;
    svc.list_statefulsets(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_daemonsets(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<DaemonSetInfo>, String> {
    let svc = state.lock().await;
    svc.list_daemonsets(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_replicasets(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ReplicaSetInfo>, String> {
    let svc = state.lock().await;
    svc.list_replicasets(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

// ── Services ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_services(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ServiceInfo>, String> {
    let svc = state.lock().await;
    svc.list_services(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_service(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<ServiceInfo, String> {
    let svc = state.lock().await;
    svc.get_service(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_service(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateServiceConfig,
) -> Result<ServiceInfo, String> {
    let svc = state.lock().await;
    svc.create_service(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_service(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_service(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_endpoints(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<EndpointInfo, String> {
    let svc = state.lock().await;
    svc.get_endpoints(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_all_services(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ServiceInfo>, String> {
    let svc = state.lock().await;
    svc.list_all_services(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_service(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    manifest: serde_json::Value,
) -> Result<ServiceInfo, String> {
    let svc = state.lock().await;
    svc.update_service(&id, &namespace, &name, &manifest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_patch_service(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    patch: serde_json::Value,
) -> Result<ServiceInfo, String> {
    let svc = state.lock().await;
    svc.patch_service(&id, &namespace, &name, &patch)
        .await
        .map_err(|e| e.to_string())
}

// ── ConfigMaps ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_configmaps(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ConfigMapInfo>, String> {
    let svc = state.lock().await;
    svc.list_configmaps(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_configmap(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<ConfigMapInfo, String> {
    let svc = state.lock().await;
    svc.get_configmap(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_configmap(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateConfigMapConfig,
) -> Result<ConfigMapInfo, String> {
    let svc = state.lock().await;
    svc.create_configmap(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_configmap(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_configmap(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_configmap(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    manifest: serde_json::Value,
) -> Result<ConfigMapInfo, String> {
    let svc = state.lock().await;
    svc.update_configmap(&id, &namespace, &name, &manifest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_patch_configmap(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    patch: serde_json::Value,
) -> Result<ConfigMapInfo, String> {
    let svc = state.lock().await;
    svc.patch_configmap(&id, &namespace, &name, &patch)
        .await
        .map_err(|e| e.to_string())
}

// ── Secrets ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_secrets(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<SecretInfo>, String> {
    let svc = state.lock().await;
    svc.list_secrets(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_secret(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<SecretInfo, String> {
    let svc = state.lock().await;
    svc.get_secret(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_secret(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateSecretConfig,
) -> Result<SecretInfo, String> {
    let svc = state.lock().await;
    svc.create_secret(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_secret(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_secret(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_secret(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    manifest: serde_json::Value,
) -> Result<SecretInfo, String> {
    let svc = state.lock().await;
    svc.update_secret(&id, &namespace, &name, &manifest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_patch_secret(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    patch: serde_json::Value,
) -> Result<SecretInfo, String> {
    let svc = state.lock().await;
    svc.patch_secret(&id, &namespace, &name, &patch)
        .await
        .map_err(|e| e.to_string())
}

// ── Ingress ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_ingresses(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<IngressInfo>, String> {
    let svc = state.lock().await;
    svc.list_ingresses(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_ingress(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<IngressInfo, String> {
    let svc = state.lock().await;
    svc.get_ingress(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_ingress(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateIngressConfig,
) -> Result<IngressInfo, String> {
    let svc = state.lock().await;
    svc.create_ingress(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_ingress(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_ingress(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_ingress(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
    manifest: serde_json::Value,
) -> Result<IngressInfo, String> {
    let svc = state.lock().await;
    svc.update_ingress(&id, &namespace, &name, &manifest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_ingress_classes(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<IngressClassInfo>, String> {
    let svc = state.lock().await;
    svc.list_ingress_classes(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

// ── Network Policies ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_network_policies(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<NetworkPolicyInfo>, String> {
    let svc = state.lock().await;
    svc.list_network_policies(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_network_policy(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    policy: serde_json::Value,
) -> Result<NetworkPolicyInfo, String> {
    let svc = state.lock().await;
    svc.create_network_policy(&id, &namespace, &policy)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_network_policy(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_network_policy(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_network_policy(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<NetworkPolicyInfo, String> {
    let svc = state.lock().await;
    svc.get_network_policy(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_jobs(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<JobInfo>, String> {
    let svc = state.lock().await;
    svc.list_jobs(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_job(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<JobInfo, String> {
    let svc = state.lock().await;
    svc.get_job(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_job(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateJobConfig,
) -> Result<JobInfo, String> {
    let svc = state.lock().await;
    svc.create_job(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_job(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_job(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_suspend_job(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.suspend_job(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_resume_job(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_job(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

// ── CronJobs ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_cronjobs(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<CronJobInfo>, String> {
    let svc = state.lock().await;
    svc.list_cronjobs(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_cronjob(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<CronJobInfo, String> {
    let svc = state.lock().await;
    svc.get_cronjob(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_cronjob(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    config: CreateCronJobConfig,
) -> Result<CronJobInfo, String> {
    let svc = state.lock().await;
    svc.create_cronjob(&id, &namespace, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_delete_cronjob(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_cronjob(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_trigger_cronjob(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<JobInfo, String> {
    let svc = state.lock().await;
    svc.trigger_cronjob(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_suspend_cronjob(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.suspend_cronjob(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_resume_cronjob(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_cronjob(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_nodes(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<NodeInfo>, String> {
    let svc = state.lock().await;
    svc.list_nodes(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_node(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<NodeInfo, String> {
    let svc = state.lock().await;
    svc.get_node(&id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_cordon_node(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cordon_node(&id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_uncordon_node(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.uncordon_node(&id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_drain_node(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.drain_node(&id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_add_node_taint(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
    taint: Taint,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_node_taint(&id, &name, &taint)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_remove_node_taint(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
    taint_key: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_node_taint(&id, &name, &taint_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_update_node_labels(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
    labels: HashMap<String, String>,
) -> Result<NodeInfo, String> {
    let svc = state.lock().await;
    svc.update_node_labels(&id, &name, &labels)
        .await
        .map_err(|e| e.to_string())
}

// ── Storage ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_persistent_volumes(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<PersistentVolumeInfo>, String> {
    let svc = state.lock().await;
    svc.list_persistent_volumes(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_pvcs(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<PersistentVolumeClaimInfo>, String> {
    let svc = state.lock().await;
    svc.list_pvcs(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_storage_classes(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<StorageClassInfo>, String> {
    let svc = state.lock().await;
    svc.list_storage_classes(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_roles(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<RoleInfo>, String> {
    let svc = state.lock().await;
    svc.list_roles(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_cluster_roles(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ClusterRoleInfo>, String> {
    let svc = state.lock().await;
    svc.list_cluster_roles(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_role_bindings(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<RoleBindingInfo>, String> {
    let svc = state.lock().await;
    svc.list_role_bindings(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_cluster_role_bindings(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ClusterRoleBindingInfo>, String> {
    let svc = state.lock().await;
    svc.list_cluster_role_bindings(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_service_accounts(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<ServiceAccountInfo>, String> {
    let svc = state.lock().await;
    svc.list_service_accounts(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_create_service_account_token(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    sa_name: String,
    audiences: Vec<String>,
    expiration_seconds: Option<i64>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_service_account_token(&id, &namespace, &sa_name, audiences, expiration_seconds)
        .await
        .map_err(|e| e.to_string())
}

// ── Helm ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_helm_is_available(state: State<'_, K8sServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.helm_is_available())
}

#[tauri::command]
pub async fn k8s_helm_version(state: State<'_, K8sServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.helm_version().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_list_releases(
    state: State<'_, K8sServiceState>,
    namespace: Option<String>,
    all_namespaces: Option<bool>,
) -> Result<Vec<HelmRelease>, String> {
    let svc = state.lock().await;
    svc.helm_list_releases(namespace.as_deref(), all_namespaces.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_get_release(
    state: State<'_, K8sServiceState>,
    name: String,
    namespace: String,
) -> Result<HelmRelease, String> {
    let svc = state.lock().await;
    svc.helm_get_release(&name, &namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_install(
    state: State<'_, K8sServiceState>,
    config: HelmInstallConfig,
) -> Result<HelmRelease, String> {
    let svc = state.lock().await;
    svc.helm_install(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_upgrade(
    state: State<'_, K8sServiceState>,
    config: HelmUpgradeConfig,
) -> Result<HelmRelease, String> {
    let svc = state.lock().await;
    svc.helm_upgrade(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_rollback(
    state: State<'_, K8sServiceState>,
    config: HelmRollbackConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.helm_rollback(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_uninstall(
    state: State<'_, K8sServiceState>,
    config: HelmUninstallConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.helm_uninstall(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_get_values(
    state: State<'_, K8sServiceState>,
    name: String,
    namespace: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.helm_get_values(&name, &namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_history(
    state: State<'_, K8sServiceState>,
    name: String,
    namespace: String,
) -> Result<Vec<HelmHistory>, String> {
    let svc = state.lock().await;
    svc.helm_history(&name, &namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_release_history(
    state: State<'_, K8sServiceState>,
    name: String,
    namespace: String,
) -> Result<Vec<HelmHistory>, String> {
    let svc = state.lock().await;
    svc.helm_release_history(&name, &namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_get_manifest(
    state: State<'_, K8sServiceState>,
    name: String,
    namespace: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.helm_get_manifest(&name, &namespace)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_list_repos(
    state: State<'_, K8sServiceState>,
) -> Result<Vec<HelmRepository>, String> {
    let svc = state.lock().await;
    svc.helm_list_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_add_repo(
    state: State<'_, K8sServiceState>,
    name: String,
    url: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.helm_add_repo(&name, &url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_remove_repo(
    state: State<'_, K8sServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.helm_remove_repo(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_update_repos(state: State<'_, K8sServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.helm_update_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_search_charts(
    state: State<'_, K8sServiceState>,
    keyword: String,
) -> Result<Vec<HelmChart>, String> {
    let svc = state.lock().await;
    svc.helm_search_charts(&keyword).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_helm_template(
    state: State<'_, K8sServiceState>,
    config: HelmTemplateConfig,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.helm_template(&config).map_err(|e| e.to_string())
}

// ── Events ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_events(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<K8sEvent>, String> {
    let svc = state.lock().await;
    svc.list_events(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_all_events(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<K8sEvent>, String> {
    let svc = state.lock().await;
    svc.list_all_events(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_filter_events(
    state: State<'_, K8sServiceState>,
    id: String,
    filter: EventFilter,
) -> Result<Vec<K8sEvent>, String> {
    let svc = state.lock().await;
    svc.filter_events(&id, &filter)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_warning_events(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: Option<String>,
) -> Result<Vec<K8sEvent>, String> {
    let svc = state.lock().await;
    svc.list_warning_events(&id, namespace.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_events_for_resource(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    kind: String,
    name: String,
) -> Result<Vec<K8sEvent>, String> {
    let svc = state.lock().await;
    svc.list_events_for_resource(&id, &namespace, &kind, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_warnings(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: Option<String>,
) -> Result<Vec<K8sEvent>, String> {
    let svc = state.lock().await;
    svc.list_warning_events(&id, namespace.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ── CRDs / HPAs ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_list_crds(
    state: State<'_, K8sServiceState>,
    id: String,
    opts: Option<ListOptions>,
) -> Result<Vec<CrdInfo>, String> {
    let svc = state.lock().await;
    svc.list_crds(&id, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_crd(
    state: State<'_, K8sServiceState>,
    id: String,
    name: String,
) -> Result<CrdInfo, String> {
    let svc = state.lock().await;
    svc.get_crd(&id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_list_hpas(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    opts: Option<ListOptions>,
) -> Result<Vec<HpaInfo>, String> {
    let svc = state.lock().await;
    svc.list_hpas(&id, &namespace, &opts.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_get_hpa(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
    name: String,
) -> Result<HpaInfo, String> {
    let svc = state.lock().await;
    svc.get_hpa(&id, &namespace, &name)
        .await
        .map_err(|e| e.to_string())
}

// ── Metrics ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn k8s_metrics_available(
    state: State<'_, K8sServiceState>,
    id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.metrics_available(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_node_metrics(
    state: State<'_, K8sServiceState>,
    id: String,
) -> Result<Vec<NodeMetrics>, String> {
    let svc = state.lock().await;
    svc.node_metrics(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_pod_metrics(
    state: State<'_, K8sServiceState>,
    id: String,
    namespace: String,
) -> Result<Vec<PodMetrics>, String> {
    let svc = state.lock().await;
    svc.pod_metrics(&id, &namespace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_cluster_summary(
    state: State<'_, K8sServiceState>,
    id: String,
) -> Result<ClusterResourceSummary, String> {
    let svc = state.lock().await;
    svc.cluster_summary(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn k8s_cluster_resource_summary(
    state: State<'_, K8sServiceState>,
    id: String,
) -> Result<ClusterResourceSummary, String> {
    let svc = state.lock().await;
    svc.cluster_summary(&id).await.map_err(|e| e.to_string())
}
