// ── sorng-k8s/src/service.rs ─────────────────────────────────────────────────
//! Aggregate K8s façade – single entry point that holds the connection
//! and delegates to the domain managers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::kubeconfig::KubeconfigManager;
use crate::types::*;

use crate::pods::PodManager;
use crate::deployments::DeploymentManager;
use crate::services::ServiceManager;
use crate::configmaps::ConfigMapManager;
use crate::secrets::SecretManager;
use crate::namespaces::NamespaceManager;
use crate::ingress::IngressManager;
use crate::jobs::JobManager;
use crate::nodes::NodeManager;
use crate::rbac::RbacManager;
use crate::helm::HelmManager;
use crate::events::EventManager;
use crate::metrics::MetricsManager;

/// Shared Tauri state handle.
pub type K8sServiceState = Arc<Mutex<K8sService>>;

/// Main K8s service that manages connections and delegates operations.
pub struct K8sService {
    /// Active Kubernetes connections keyed by a user-chosen id.
    connections: HashMap<String, K8sClient>,
    /// Helm manager (stateless CLI wrapper, shared across connections).
    helm: HelmManager,
}

impl K8sService {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            helm: HelmManager::new(),
        }
    }

    // ── Connection lifecycle ──────────────────────────────────────

    /// Connect to a cluster.  Returns the connection id.
    pub async fn connect(&mut self, id: String, config: K8sConnectionConfig) -> K8sResult<ClusterInfo> {
        let client = K8sClient::from_config(&config).await?;
        // Probe the cluster
        let version = client.server_version().await.ok();
        let healthy = client.health_check().await.unwrap_or(false);
        let api_resources: Vec<ApiResource> = client.api_resources().await.unwrap_or_default();

        let info = ClusterInfo {
            name: id.clone(),
            server: client.base_url.clone(),
            version,
            status: if healthy { ClusterStatus::Connected } else { ClusterStatus::Degraded },
            node_count: None,
            namespace_count: None,
            api_resources,
        };
        self.connections.insert(id, client);
        Ok(info)
    }

    /// Connect via a kubeconfig path + optional context name.
    pub async fn connect_kubeconfig(
        &mut self,
        id: String,
        kubeconfig_path: Option<String>,
        context: Option<String>,
    ) -> K8sResult<ClusterInfo> {
        let path = match kubeconfig_path {
            Some(p) => p,
            None => KubeconfigManager::default_path()?,
        };
        let raw = KubeconfigManager::load(&path)?;
        let kc = KubeconfigManager::parse(&raw)?;
        let ctx_name = context.unwrap_or_else(|| kc.current_context.clone().unwrap_or_default());
        let (endpoint, creds) = KubeconfigManager::resolve_context(&kc, &ctx_name)?;

        let config = K8sConnectionConfig {
            name: id.clone(),
            server: endpoint.server.clone(),
            auth_method: K8sAuthMethod::Kubeconfig {
                path: Some(path),
                context: Some(ctx_name),
            },
            tls: K8sTlsConfig {
                ca_cert: endpoint.certificate_authority_data.clone(),
                ca_cert_path: endpoint.certificate_authority.clone(),
                client_cert: creds.client_certificate_data.clone(),
                client_key: creds.client_key_data.clone(),
                insecure_skip_tls_verify: endpoint.insecure_skip_tls_verify.unwrap_or(false),
            },
            default_namespace: Some("default".to_string()),
            proxy_url: endpoint.proxy_url.clone(),
            timeout_seconds: Some(30),
        };

        self.connect(id, config).await
    }

    /// Disconnect a cluster.
    pub fn disconnect(&mut self, id: &str) -> K8sResult<()> {
        self.connections.remove(id)
            .map(|_| ())
            .ok_or_else(|| K8sError::session(&format!("No connection with id '{}'", id)))
    }

    /// List active connection ids.
    pub fn list_connections(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }

    /// Get a client reference.
    fn client(&self, id: &str) -> K8sResult<&K8sClient> {
        self.connections.get(id)
            .ok_or_else(|| K8sError::session(&format!("No connection with id '{}'", id)))
    }

    // ── Kubeconfig ────────────────────────────────────────────────

    pub fn kubeconfig_default_path(&self) -> K8sResult<String> {
        KubeconfigManager::default_path()
    }

    pub fn kubeconfig_load(&self, path: &str) -> K8sResult<String> {
        KubeconfigManager::load(path)
    }

    pub fn kubeconfig_parse(&self, yaml: &str) -> K8sResult<Kubeconfig> {
        KubeconfigManager::parse(yaml)
    }

    pub fn kubeconfig_list_contexts(&self, yaml: &str) -> K8sResult<Vec<String>> {
        let kc = KubeconfigManager::parse(yaml)?;
        Ok(KubeconfigManager::list_contexts(&kc))
    }

    pub fn kubeconfig_validate(&self, yaml: &str) -> K8sResult<Vec<String>> {
        let kc = KubeconfigManager::parse(yaml)?;
        Ok(KubeconfigManager::validate(&kc))
    }

    // ── Cluster info ──────────────────────────────────────────────

    pub async fn cluster_info(&self, id: &str) -> K8sResult<ClusterInfo> {
        let c = self.client(id)?;
        let version = c.server_version().await.ok();
        let healthy = c.health_check().await.unwrap_or(false);
        let apis = c.api_resources().await.unwrap_or_default();
        Ok(ClusterInfo {
            name: id.to_string(),
            server: c.base_url.clone(),
            version,
            status: if healthy { ClusterStatus::Connected } else { ClusterStatus::Degraded },
            node_count: None,
            namespace_count: None,
            api_resources: apis,
        })
    }

    pub async fn health_check(&self, id: &str) -> K8sResult<bool> {
        self.client(id)?.health_check().await
    }

    // ── Namespaces ────────────────────────────────────────────────

    pub async fn list_namespaces(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<NamespaceInfo>> {
        NamespaceManager::list(self.client(id)?, opts).await
    }

    pub async fn get_namespace(&self, id: &str, name: &str) -> K8sResult<NamespaceInfo> {
        NamespaceManager::get(self.client(id)?, name).await
    }

    pub async fn create_namespace(&self, id: &str, cfg: &CreateNamespaceConfig) -> K8sResult<NamespaceInfo> {
        NamespaceManager::create(self.client(id)?, cfg).await
    }

    pub async fn delete_namespace(&self, id: &str, name: &str) -> K8sResult<()> {
        NamespaceManager::delete(self.client(id)?, name).await
    }

    // ── Pods ──────────────────────────────────────────────────────

    pub async fn list_pods(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<PodInfo>> {
        PodManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn get_pod(&self, id: &str, ns: &str, name: &str) -> K8sResult<PodInfo> {
        PodManager::get(self.client(id)?, ns, name).await
    }

    pub async fn create_pod(&self, id: &str, ns: &str, spec: &serde_json::Value) -> K8sResult<PodInfo> {
        PodManager::create(self.client(id)?, ns, spec).await
    }

    pub async fn delete_pod(&self, id: &str, ns: &str, name: &str, opts: Option<&DeleteOptions>) -> K8sResult<()> {
        PodManager::delete(self.client(id)?, ns, name, opts).await
    }

    pub async fn pod_logs(&self, id: &str, ns: &str, name: &str, log_opts: &PodLogOptions) -> K8sResult<String> {
        PodManager::logs(self.client(id)?, ns, name, log_opts).await
    }

    pub async fn evict_pod(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        PodManager::evict(self.client(id)?, ns, name).await
    }

    pub async fn list_all_pods(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<PodInfo>> {
        PodManager::list_all_namespaces(self.client(id)?, opts).await
    }

    // ── Deployments ───────────────────────────────────────────────

    pub async fn list_deployments(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<DeploymentInfo>> {
        DeploymentManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn get_deployment(&self, id: &str, ns: &str, name: &str) -> K8sResult<DeploymentInfo> {
        DeploymentManager::get(self.client(id)?, ns, name).await
    }

    pub async fn create_deployment(&self, id: &str, ns: &str, cfg: &CreateDeploymentConfig) -> K8sResult<DeploymentInfo> {
        DeploymentManager::create(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_deployment(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        DeploymentManager::delete(self.client(id)?, ns, name).await
    }

    pub async fn scale_deployment(&self, id: &str, ns: &str, name: &str, replicas: i32) -> K8sResult<()> {
        DeploymentManager::scale(self.client(id)?, ns, name, replicas).await
    }

    pub async fn restart_deployment(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        DeploymentManager::restart(self.client(id)?, ns, name).await
    }

    pub async fn pause_deployment(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        DeploymentManager::pause(self.client(id)?, ns, name).await
    }

    pub async fn resume_deployment(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        DeploymentManager::resume(self.client(id)?, ns, name).await
    }

    pub async fn set_deployment_image(&self, id: &str, ns: &str, name: &str, container: &str, image: &str) -> K8sResult<()> {
        DeploymentManager::set_image(self.client(id)?, ns, name, container, image).await
    }

    pub async fn deployment_rollout_status(&self, id: &str, ns: &str, name: &str) -> K8sResult<RolloutInfo> {
        DeploymentManager::rollout_status(self.client(id)?, ns, name).await
    }

    pub async fn rollback_deployment(&self, id: &str, ns: &str, name: &str, revision: Option<i64>) -> K8sResult<()> {
        DeploymentManager::rollback(self.client(id)?, ns, name, revision).await
    }

    // ── StatefulSets / DaemonSets / ReplicaSets ───────────────────

    pub async fn list_statefulsets(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<StatefulSetInfo>> {
        DeploymentManager::list_statefulsets(self.client(id)?, ns, opts).await
    }

    pub async fn list_daemonsets(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<DaemonSetInfo>> {
        DeploymentManager::list_daemonsets(self.client(id)?, ns, opts).await
    }

    pub async fn list_replicasets(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<ReplicaSetInfo>> {
        DeploymentManager::list_replicasets(self.client(id)?, ns, opts).await
    }

    // ── Services ──────────────────────────────────────────────────

    pub async fn list_services(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<ServiceInfo>> {
        ServiceManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn get_service(&self, id: &str, ns: &str, name: &str) -> K8sResult<ServiceInfo> {
        ServiceManager::get(self.client(id)?, ns, name).await
    }

    pub async fn create_service(&self, id: &str, ns: &str, cfg: &CreateServiceConfig) -> K8sResult<ServiceInfo> {
        ServiceManager::create(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_service(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        ServiceManager::delete(self.client(id)?, ns, name).await
    }

    pub async fn get_endpoints(&self, id: &str, ns: &str, name: &str) -> K8sResult<EndpointInfo> {
        ServiceManager::get_endpoints(self.client(id)?, ns, name).await
    }

    // ── ConfigMaps ────────────────────────────────────────────────

    pub async fn list_configmaps(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<ConfigMapInfo>> {
        ConfigMapManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn get_configmap(&self, id: &str, ns: &str, name: &str) -> K8sResult<ConfigMapInfo> {
        ConfigMapManager::get(self.client(id)?, ns, name).await
    }

    pub async fn create_configmap(&self, id: &str, ns: &str, cfg: &CreateConfigMapConfig) -> K8sResult<ConfigMapInfo> {
        ConfigMapManager::create(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_configmap(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        ConfigMapManager::delete(self.client(id)?, ns, name).await
    }

    // ── Secrets ───────────────────────────────────────────────────

    pub async fn list_secrets(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<SecretInfo>> {
        SecretManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn get_secret(&self, id: &str, ns: &str, name: &str) -> K8sResult<SecretInfo> {
        SecretManager::get(self.client(id)?, ns, name).await
    }

    pub async fn create_secret(&self, id: &str, ns: &str, cfg: &CreateSecretConfig) -> K8sResult<SecretInfo> {
        SecretManager::create(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_secret(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        SecretManager::delete(self.client(id)?, ns, name).await
    }

    // ── Ingress ───────────────────────────────────────────────────

    pub async fn list_ingresses(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<IngressInfo>> {
        IngressManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn get_ingress(&self, id: &str, ns: &str, name: &str) -> K8sResult<IngressInfo> {
        IngressManager::get(self.client(id)?, ns, name).await
    }

    pub async fn create_ingress(&self, id: &str, ns: &str, cfg: &CreateIngressConfig) -> K8sResult<IngressInfo> {
        IngressManager::create(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_ingress(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        IngressManager::delete(self.client(id)?, ns, name).await
    }

    pub async fn list_ingress_classes(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<IngressClassInfo>> {
        IngressManager::list_ingress_classes(self.client(id)?, opts).await
    }

    // ── Network Policies ──────────────────────────────────────────

    pub async fn list_network_policies(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<NetworkPolicyInfo>> {
        IngressManager::list_network_policies(self.client(id)?, ns, opts).await
    }

    pub async fn create_network_policy(&self, id: &str, ns: &str, policy: &serde_json::Value) -> K8sResult<NetworkPolicyInfo> {
        IngressManager::create_network_policy(self.client(id)?, ns, policy).await
    }

    pub async fn delete_network_policy(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        IngressManager::delete_network_policy(self.client(id)?, ns, name).await
    }

    // ── Jobs ──────────────────────────────────────────────────────

    pub async fn list_jobs(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<JobInfo>> {
        JobManager::list_jobs(self.client(id)?, ns, opts).await
    }

    pub async fn get_job(&self, id: &str, ns: &str, name: &str) -> K8sResult<JobInfo> {
        JobManager::get_job(self.client(id)?, ns, name).await
    }

    pub async fn create_job(&self, id: &str, ns: &str, cfg: &CreateJobConfig) -> K8sResult<JobInfo> {
        JobManager::create_job(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_job(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        JobManager::delete_job(self.client(id)?, ns, name).await
    }

    pub async fn suspend_job(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        JobManager::suspend_job(self.client(id)?, ns, name).await
    }

    pub async fn resume_job(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        JobManager::resume_job(self.client(id)?, ns, name).await
    }

    // ── CronJobs ──────────────────────────────────────────────────

    pub async fn list_cronjobs(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<CronJobInfo>> {
        JobManager::list_cronjobs(self.client(id)?, ns, opts).await
    }

    pub async fn get_cronjob(&self, id: &str, ns: &str, name: &str) -> K8sResult<CronJobInfo> {
        JobManager::get_cronjob(self.client(id)?, ns, name).await
    }

    pub async fn create_cronjob(&self, id: &str, ns: &str, cfg: &CreateCronJobConfig) -> K8sResult<CronJobInfo> {
        JobManager::create_cronjob(self.client(id)?, ns, cfg).await
    }

    pub async fn delete_cronjob(&self, id: &str, ns: &str, name: &str) -> K8sResult<()> {
        JobManager::delete_cronjob(self.client(id)?, ns, name).await
    }

    pub async fn trigger_cronjob(&self, id: &str, ns: &str, name: &str) -> K8sResult<JobInfo> {
        JobManager::trigger_cronjob(self.client(id)?, ns, name).await
    }

    // ── Nodes ─────────────────────────────────────────────────────

    pub async fn list_nodes(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<NodeInfo>> {
        NodeManager::list(self.client(id)?, opts).await
    }

    pub async fn get_node(&self, id: &str, name: &str) -> K8sResult<NodeInfo> {
        NodeManager::get(self.client(id)?, name).await
    }

    pub async fn cordon_node(&self, id: &str, name: &str) -> K8sResult<()> {
        NodeManager::cordon(self.client(id)?, name).await
    }

    pub async fn uncordon_node(&self, id: &str, name: &str) -> K8sResult<()> {
        NodeManager::uncordon(self.client(id)?, name).await
    }

    pub async fn drain_node(&self, id: &str, name: &str) -> K8sResult<Vec<String>> {
        NodeManager::drain(self.client(id)?, name).await
    }

    pub async fn add_node_taint(&self, id: &str, name: &str, taint: &Taint) -> K8sResult<()> {
        NodeManager::add_taint(self.client(id)?, name, taint).await
    }

    pub async fn remove_node_taint(&self, id: &str, name: &str, taint_key: &str) -> K8sResult<()> {
        NodeManager::remove_taint(self.client(id)?, name, taint_key).await
    }

    // ── Storage ───────────────────────────────────────────────────

    pub async fn list_persistent_volumes(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<PersistentVolumeInfo>> {
        NodeManager::list_persistent_volumes(self.client(id)?, opts).await
    }

    pub async fn list_pvcs(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<PersistentVolumeClaimInfo>> {
        NodeManager::list_pvcs(self.client(id)?, ns, opts).await
    }

    pub async fn list_storage_classes(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<StorageClassInfo>> {
        NodeManager::list_storage_classes(self.client(id)?, opts).await
    }

    // ── RBAC ──────────────────────────────────────────────────────

    pub async fn list_roles(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<RoleInfo>> {
        RbacManager::list_roles(self.client(id)?, ns, opts).await
    }

    pub async fn list_cluster_roles(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<ClusterRoleInfo>> {
        RbacManager::list_cluster_roles(self.client(id)?, opts).await
    }

    pub async fn list_role_bindings(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<RoleBindingInfo>> {
        RbacManager::list_role_bindings(self.client(id)?, ns, opts).await
    }

    pub async fn list_cluster_role_bindings(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<ClusterRoleBindingInfo>> {
        RbacManager::list_cluster_role_bindings(self.client(id)?, opts).await
    }

    pub async fn list_service_accounts(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<ServiceAccountInfo>> {
        RbacManager::list_service_accounts(self.client(id)?, ns, opts).await
    }

    pub async fn create_service_account_token(
        &self,
        id: &str,
        ns: &str,
        sa_name: &str,
        audiences: Vec<String>,
        expiration_seconds: Option<i64>,
    ) -> K8sResult<String> {
        RbacManager::create_token(self.client(id)?, ns, sa_name, audiences, expiration_seconds).await
    }

    // ── Helm ──────────────────────────────────────────────────────

    pub fn helm_is_available(&self) -> bool {
        self.helm.is_available()
    }

    pub fn helm_version(&self) -> K8sResult<String> {
        self.helm.version()
    }

    pub fn helm_list_releases(&self, namespace: Option<&str>, all_namespaces: bool) -> K8sResult<Vec<HelmRelease>> {
        self.helm.list_releases(namespace, all_namespaces)
    }

    pub fn helm_get_release(&self, name: &str, namespace: &str) -> K8sResult<HelmRelease> {
        self.helm.get_release(name, namespace)
    }

    pub fn helm_install(&self, config: &HelmInstallConfig) -> K8sResult<HelmRelease> {
        self.helm.install(config)
    }

    pub fn helm_upgrade(&self, config: &HelmUpgradeConfig) -> K8sResult<HelmRelease> {
        self.helm.upgrade(config)
    }

    pub fn helm_rollback(&self, config: &HelmRollbackConfig) -> K8sResult<()> {
        self.helm.rollback(config)
    }

    pub fn helm_uninstall(&self, config: &HelmUninstallConfig) -> K8sResult<()> {
        self.helm.uninstall(config)
    }

    pub fn helm_get_values(&self, name: &str, namespace: &str) -> K8sResult<String> {
        self.helm.get_values(name, namespace)
    }

    pub fn helm_history(&self, name: &str, namespace: &str) -> K8sResult<Vec<HelmHistory>> {
        self.helm.history(name, namespace)
    }

    pub fn helm_list_repos(&self) -> K8sResult<Vec<HelmRepository>> {
        self.helm.list_repos()
    }

    pub fn helm_add_repo(&self, name: &str, url: &str) -> K8sResult<()> {
        self.helm.add_repo(name, url)
    }

    pub fn helm_remove_repo(&self, name: &str) -> K8sResult<()> {
        self.helm.remove_repo(name)
    }

    pub fn helm_update_repos(&self) -> K8sResult<()> {
        self.helm.update_repos()
    }

    pub fn helm_search_charts(&self, keyword: &str) -> K8sResult<Vec<HelmChart>> {
        self.helm.search_charts(keyword)
    }

    pub fn helm_template(&self, config: &HelmTemplateConfig) -> K8sResult<String> {
        self.helm.template(config)
    }

    // ── Events ────────────────────────────────────────────────────

    pub async fn list_events(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<K8sEvent>> {
        EventManager::list(self.client(id)?, ns, opts).await
    }

    pub async fn list_all_events(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<K8sEvent>> {
        EventManager::list_all(self.client(id)?, opts).await
    }

    pub async fn filter_events(&self, id: &str, filter: &EventFilter) -> K8sResult<Vec<K8sEvent>> {
        EventManager::filter(self.client(id)?, filter).await
    }

    pub async fn list_warning_events(&self, id: &str, namespace: Option<&str>) -> K8sResult<Vec<K8sEvent>> {
        EventManager::list_warnings(self.client(id)?, namespace).await
    }

    // ── CRDs / HPAs ───────────────────────────────────────────────

    pub async fn list_crds(&self, id: &str, opts: &ListOptions) -> K8sResult<Vec<CrdInfo>> {
        EventManager::list_crds(self.client(id)?, opts).await
    }

    pub async fn get_crd(&self, id: &str, name: &str) -> K8sResult<CrdInfo> {
        EventManager::get_crd(self.client(id)?, name).await
    }

    pub async fn list_hpas(&self, id: &str, ns: &str, opts: &ListOptions) -> K8sResult<Vec<HpaInfo>> {
        EventManager::list_hpas(self.client(id)?, ns, opts).await
    }

    pub async fn get_hpa(&self, id: &str, ns: &str, name: &str) -> K8sResult<HpaInfo> {
        EventManager::get_hpa(self.client(id)?, ns, name).await
    }

    // ── Metrics ───────────────────────────────────────────────────

    pub async fn metrics_available(&self, id: &str) -> K8sResult<bool> {
        Ok(MetricsManager::is_available(self.client(id)?).await)
    }

    pub async fn node_metrics(&self, id: &str) -> K8sResult<Vec<NodeMetrics>> {
        MetricsManager::list_node_metrics(self.client(id)?).await
    }

    pub async fn pod_metrics(&self, id: &str, ns: &str) -> K8sResult<Vec<PodMetrics>> {
        MetricsManager::list_pod_metrics(self.client(id)?, ns).await
    }

    pub async fn cluster_summary(&self, id: &str) -> K8sResult<ClusterResourceSummary> {
        MetricsManager::cluster_summary(self.client(id)?).await
    }
}

impl Default for K8sService {
    fn default() -> Self {
        Self::new()
    }
}
