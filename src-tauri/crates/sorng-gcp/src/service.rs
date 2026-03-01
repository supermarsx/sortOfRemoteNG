//! Top-level GCP service that manages sessions and delegates to sub-clients.
//!
//! `GcpService` is the single entry point stored in Tauri's managed state.
//! Each session gets its own `GcpClient` (and thus its own OAuth2 token cache).
//! Sub-client modules use static methods that accept `&mut GcpClient`.

use crate::client::GcpClient;
use crate::compute::{self, ComputeClient};
use crate::config::{GcpConnectionConfig, GcpServiceInfo, GcpSession, ServiceAccountKey};
use crate::dns::DnsClient;
use crate::error::GcpError;
use crate::functions::FunctionsClient;
use crate::gke::GkeClient;
use crate::iam::IamClient;
use crate::logging::LoggingClient;
use crate::monitoring::MonitoringClient;
use crate::pubsub::PubSubClient;
use crate::run::CloudRunClient;
use crate::secrets::SecretManagerClient;
use crate::sql::CloudSqlClient;
use crate::storage::StorageClient;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Thread-safe state type for Tauri's managed state system.
pub type GcpServiceState = Arc<Mutex<GcpService>>;

/// Default OAuth2 scopes for GCP.
const DEFAULT_SCOPES: &[&str] = &["https://www.googleapis.com/auth/cloud-platform"];

/// Top-level GCP service.
pub struct GcpService {
    sessions: HashMap<String, GcpSession>,
    clients: HashMap<String, GcpClient>,
}

impl GcpService {
    /// Create a new `GcpService` wrapped as managed state.
    pub fn new() -> GcpServiceState {
        Arc::new(Mutex::new(Self {
            sessions: HashMap::new(),
            clients: HashMap::new(),
        }))
    }

    // ── Session management ──────────────────────────────────────────

    /// Connect to GCP and create a new session.
    pub async fn connect_gcp(
        &mut self,
        config: GcpConnectionConfig,
    ) -> Result<String, String> {
        config.validate().map_err(|e| e.to_string())?;

        let key = ServiceAccountKey::from_json(&config.service_account_key)
            .map_err(|e| e.to_string())?;

        let project_id = key.project_id.clone();
        let scopes: Vec<String> = DEFAULT_SCOPES.iter().map(|s| s.to_string()).collect();
        let client = GcpClient::new(key, scopes, None);

        let session_id = Uuid::new_v4().to_string();

        let services = vec![
            GcpServiceInfo {
                service_name: "Compute Engine".to_string(),
                endpoint: "https://compute.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud Storage".to_string(),
                endpoint: "https://storage.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "IAM".to_string(),
                endpoint: "https://iam.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Secret Manager".to_string(),
                endpoint: "https://secretmanager.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud SQL".to_string(),
                endpoint: "https://sqladmin.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud Functions".to_string(),
                endpoint: "https://cloudfunctions.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "GKE".to_string(),
                endpoint: "https://container.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud DNS".to_string(),
                endpoint: "https://dns.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Pub/Sub".to_string(),
                endpoint: "https://pubsub.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud Run".to_string(),
                endpoint: "https://run.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud Logging".to_string(),
                endpoint: "https://logging.googleapis.com".to_string(),
                status: "available".to_string(),
            },
            GcpServiceInfo {
                service_name: "Cloud Monitoring".to_string(),
                endpoint: "https://monitoring.googleapis.com".to_string(),
                status: "available".to_string(),
            },
        ];

        let session = GcpSession {
            id: session_id.clone(),
            config: config.clone(),
            project_id: project_id.clone(),
            region: config.region.clone().unwrap_or_default(),
            zone: config.zone.clone().unwrap_or_default(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            services,
        };

        self.sessions.insert(session_id.clone(), session);
        self.clients.insert(session_id.clone(), client);

        Ok(session_id)
    }

    /// Disconnect a session.
    pub async fn disconnect_gcp(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            self.clients.remove(session_id);
            Ok(())
        } else {
            Err(GcpError::session_not_found(session_id).to_string())
        }
    }

    /// List all sessions.
    pub fn list_gcp_sessions(&self) -> Vec<GcpSession> {
        self.sessions.values().cloned().collect()
    }

    /// Get a single session by ID.
    pub fn get_gcp_session(&self, session_id: &str) -> Option<GcpSession> {
        self.sessions.get(session_id).cloned()
    }

    // ── Private helpers ─────────────────────────────────────────────

    fn require_client(&mut self, session_id: &str) -> Result<&mut GcpClient, String> {
        if let Some(sess) = self.sessions.get_mut(session_id) {
            sess.last_activity = Utc::now();
        }
        self.clients
            .get_mut(session_id)
            .ok_or_else(|| GcpError::session_not_found(session_id).to_string())
    }

    fn session_project(&self, session_id: &str) -> Result<String, String> {
        self.sessions
            .get(session_id)
            .map(|s| s.project_id.clone())
            .ok_or_else(|| GcpError::session_not_found(session_id).to_string())
    }

    fn session_zone(&self, session_id: &str) -> Result<String, String> {
        self.sessions
            .get(session_id)
            .and_then(|s| {
                if s.zone.is_empty() {
                    None
                } else {
                    Some(s.zone.clone())
                }
            })
            .ok_or_else(|| "No zone configured for session".to_string())
    }

    fn session_region(&self, session_id: &str) -> Result<String, String> {
        self.sessions
            .get(session_id)
            .and_then(|s| {
                if s.region.is_empty() {
                    None
                } else {
                    Some(s.region.clone())
                }
            })
            .ok_or_else(|| "No region configured for session".to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Compute Engine
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_instances(
        &mut self,
        session_id: &str,
        zone: Option<String>,
    ) -> Result<Vec<compute::Instance>, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::list_instances(client, &project, &zone, None, None)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_instance(
        &mut self,
        session_id: &str,
        zone: Option<String>,
        instance_name: &str,
    ) -> Result<compute::Instance, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::get_instance(client, &project, &zone, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn start_instance(
        &mut self,
        session_id: &str,
        zone: Option<String>,
        instance_name: &str,
    ) -> Result<compute::Operation, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::start_instance(client, &project, &zone, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn stop_instance(
        &mut self,
        session_id: &str,
        zone: Option<String>,
        instance_name: &str,
    ) -> Result<compute::Operation, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::stop_instance(client, &project, &zone, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn reset_instance(
        &mut self,
        session_id: &str,
        zone: Option<String>,
        instance_name: &str,
    ) -> Result<compute::Operation, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::reset_instance(client, &project, &zone, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_instance(
        &mut self,
        session_id: &str,
        zone: Option<String>,
        instance_name: &str,
    ) -> Result<compute::Operation, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::delete_instance(client, &project, &zone, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_disks(
        &mut self,
        session_id: &str,
        zone: Option<String>,
    ) -> Result<Vec<compute::Disk>, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::list_disks(client, &project, &zone)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_snapshots(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<compute::Snapshot>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        ComputeClient::list_snapshots(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_firewalls(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<compute::Firewall>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        ComputeClient::list_firewalls(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_networks(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<compute::Network>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        ComputeClient::list_networks(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_machine_types(
        &mut self,
        session_id: &str,
        zone: Option<String>,
    ) -> Result<Vec<compute::MachineType>, String> {
        let project = self.session_project(session_id)?;
        let zone = zone
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone required".to_string())?;
        let client = self.require_client(session_id)?;
        ComputeClient::list_machine_types(client, &project, &zone)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud Storage
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_buckets(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::storage::Bucket>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        StorageClient::list_buckets(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_bucket(
        &mut self,
        session_id: &str,
        bucket_name: &str,
    ) -> Result<crate::storage::Bucket, String> {
        let client = self.require_client(session_id)?;
        StorageClient::get_bucket(client, bucket_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn create_bucket(
        &mut self,
        session_id: &str,
        name: &str,
        location: &str,
        storage_class: Option<String>,
    ) -> Result<crate::storage::Bucket, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        StorageClient::create_bucket(client, &project, name, location, storage_class.as_deref())
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_bucket(
        &mut self,
        session_id: &str,
        bucket_name: &str,
    ) -> Result<(), String> {
        let client = self.require_client(session_id)?;
        StorageClient::delete_bucket(client, bucket_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_objects(
        &mut self,
        session_id: &str,
        bucket: &str,
        prefix: Option<String>,
    ) -> Result<Vec<crate::storage::Object>, String> {
        let client = self.require_client(session_id)?;
        let (objects, _prefixes) = StorageClient::list_objects(client, bucket, prefix.as_deref(), None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(objects)
    }

    pub async fn download_object(
        &mut self,
        session_id: &str,
        bucket: &str,
        object: &str,
    ) -> Result<String, String> {
        let client = self.require_client(session_id)?;
        StorageClient::download_object_text(client, bucket, object)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_object(
        &mut self,
        session_id: &str,
        bucket: &str,
        object: &str,
    ) -> Result<(), String> {
        let client = self.require_client(session_id)?;
        StorageClient::delete_object(client, bucket, object)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  IAM
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_service_accounts(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::iam::IamServiceAccount>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        IamClient::list_service_accounts(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_iam_policy(
        &mut self,
        session_id: &str,
    ) -> Result<crate::iam::IamPolicy, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        IamClient::get_project_iam_policy(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_roles(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::iam::IamRole>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        IamClient::list_project_roles(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Secret Manager
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_secrets(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::secrets::Secret>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        SecretManagerClient::list_secrets(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_secret(
        &mut self,
        session_id: &str,
        secret_name: &str,
    ) -> Result<crate::secrets::Secret, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        SecretManagerClient::get_secret(client, &project, secret_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn access_secret_version(
        &mut self,
        session_id: &str,
        secret_name: &str,
        version: &str,
    ) -> Result<String, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        SecretManagerClient::access_secret_version(client, &project, secret_name, version)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn create_secret(
        &mut self,
        session_id: &str,
        secret_id: &str,
    ) -> Result<crate::secrets::Secret, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        SecretManagerClient::create_secret(client, &project, secret_id, None)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_secret(
        &mut self,
        session_id: &str,
        secret_name: &str,
    ) -> Result<(), String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        SecretManagerClient::delete_secret(client, &project, secret_name)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud SQL
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_sql_instances(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::sql::SqlInstance>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        CloudSqlClient::list_instances(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_sql_instance(
        &mut self,
        session_id: &str,
        instance_name: &str,
    ) -> Result<crate::sql::SqlInstance, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        CloudSqlClient::get_instance(client, &project, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_sql_databases(
        &mut self,
        session_id: &str,
        instance_name: &str,
    ) -> Result<Vec<crate::sql::Database>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        CloudSqlClient::list_databases(client, &project, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_sql_users(
        &mut self,
        session_id: &str,
        instance_name: &str,
    ) -> Result<Vec<crate::sql::SqlUser>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        CloudSqlClient::list_users(client, &project, instance_name)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud Functions
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_functions(
        &mut self,
        session_id: &str,
        region: Option<String>,
    ) -> Result<Vec<crate::functions::Function>, String> {
        let project = self.session_project(session_id)?;
        let region = region
            .or_else(|| self.session_region(session_id).ok())
            .ok_or_else(|| "Region required".to_string())?;
        let client = self.require_client(session_id)?;
        FunctionsClient::list_functions(client, &project, &region)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_function(
        &mut self,
        session_id: &str,
        region: Option<String>,
        function_name: &str,
    ) -> Result<crate::functions::Function, String> {
        let project = self.session_project(session_id)?;
        let region = region
            .or_else(|| self.session_region(session_id).ok())
            .ok_or_else(|| "Region required".to_string())?;
        let client = self.require_client(session_id)?;
        FunctionsClient::get_function(client, &project, &region, function_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn call_function(
        &mut self,
        session_id: &str,
        region: Option<String>,
        function_name: &str,
        data: serde_json::Value,
    ) -> Result<crate::functions::CallResult, String> {
        let project = self.session_project(session_id)?;
        let region = region
            .or_else(|| self.session_region(session_id).ok())
            .ok_or_else(|| "Region required".to_string())?;
        let data_str = serde_json::to_string(&data).unwrap_or_default();
        let client = self.require_client(session_id)?;
        FunctionsClient::call_function(client, &project, &region, function_name, &data_str)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  GKE
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_clusters(
        &mut self,
        session_id: &str,
        zone_or_region: Option<String>,
    ) -> Result<Vec<crate::gke::Cluster>, String> {
        let project = self.session_project(session_id)?;
        let loc = zone_or_region
            .or_else(|| self.session_zone(session_id).ok())
            .or_else(|| self.session_region(session_id).ok())
            .unwrap_or_else(|| "-".to_string());
        let client = self.require_client(session_id)?;
        GkeClient::list_clusters(client, &project, &loc)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_cluster(
        &mut self,
        session_id: &str,
        zone_or_region: Option<String>,
        cluster_name: &str,
    ) -> Result<crate::gke::Cluster, String> {
        let project = self.session_project(session_id)?;
        let loc = zone_or_region
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone or region required".to_string())?;
        let client = self.require_client(session_id)?;
        GkeClient::get_cluster(client, &project, &loc, cluster_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_node_pools(
        &mut self,
        session_id: &str,
        zone_or_region: Option<String>,
        cluster_name: &str,
    ) -> Result<Vec<crate::gke::NodePool>, String> {
        let project = self.session_project(session_id)?;
        let loc = zone_or_region
            .or_else(|| self.session_zone(session_id).ok())
            .ok_or_else(|| "Zone or region required".to_string())?;
        let client = self.require_client(session_id)?;
        GkeClient::list_node_pools(client, &project, &loc, cluster_name)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud DNS
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_managed_zones(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::dns::ManagedZone>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        DnsClient::list_managed_zones(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_dns_record_sets(
        &mut self,
        session_id: &str,
        zone_name: &str,
    ) -> Result<Vec<crate::dns::ResourceRecordSet>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        DnsClient::list_record_sets(client, &project, zone_name, None)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Pub/Sub
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_topics(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::pubsub::Topic>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        PubSubClient::list_topics(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn create_topic(
        &mut self,
        session_id: &str,
        topic_name: &str,
    ) -> Result<crate::pubsub::Topic, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        PubSubClient::create_topic(client, &project, topic_name, None)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_topic(
        &mut self,
        session_id: &str,
        topic_name: &str,
    ) -> Result<(), String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        PubSubClient::delete_topic(client, &project, topic_name)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn publish_message(
        &mut self,
        session_id: &str,
        topic_name: &str,
        messages: Vec<crate::pubsub::PubsubMessage>,
    ) -> Result<Vec<String>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        PubSubClient::publish(client, &project, topic_name, messages)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_subscriptions(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::pubsub::Subscription>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        PubSubClient::list_subscriptions(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn pull_messages(
        &mut self,
        session_id: &str,
        subscription_name: &str,
        max_messages: u32,
    ) -> Result<Vec<crate::pubsub::ReceivedMessage>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        PubSubClient::pull(client, &project, subscription_name, max_messages)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud Run
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_run_services(
        &mut self,
        session_id: &str,
        region: Option<String>,
    ) -> Result<Vec<crate::run::RunService>, String> {
        let project = self.session_project(session_id)?;
        let region = region
            .or_else(|| self.session_region(session_id).ok())
            .ok_or_else(|| "Region required".to_string())?;
        let client = self.require_client(session_id)?;
        CloudRunClient::list_services(client, &project, &region)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_run_jobs(
        &mut self,
        session_id: &str,
        region: Option<String>,
    ) -> Result<Vec<crate::run::Job>, String> {
        let project = self.session_project(session_id)?;
        let region = region
            .or_else(|| self.session_region(session_id).ok())
            .ok_or_else(|| "Region required".to_string())?;
        let client = self.require_client(session_id)?;
        CloudRunClient::list_jobs(client, &project, &region)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud Logging
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_log_entries(
        &mut self,
        session_id: &str,
        filter: Option<String>,
        page_size: Option<u32>,
    ) -> Result<Vec<crate::logging::LogEntry>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        LoggingClient::list_entries(client, &project, filter.as_deref(), None, page_size)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_logs(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<String>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        LoggingClient::list_logs(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_log_sinks(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::logging::LogSink>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        LoggingClient::list_sinks(client, &project)
            .await
            .map_err(|e| e.to_string())
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Cloud Monitoring
    // ═══════════════════════════════════════════════════════════════════

    pub async fn list_metric_descriptors(
        &mut self,
        session_id: &str,
        filter: Option<String>,
    ) -> Result<Vec<crate::monitoring::MetricDescriptor>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        MonitoringClient::list_metric_descriptors(client, &project, filter.as_deref())
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_time_series(
        &mut self,
        session_id: &str,
        filter: &str,
        start_time: &str,
        end_time: &str,
    ) -> Result<Vec<crate::monitoring::TimeSeries>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        MonitoringClient::list_time_series(
            client, &project, filter, start_time, end_time, None, None,
        )
        .await
        .map_err(|e| e.to_string())
    }

    pub async fn list_alert_policies(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::monitoring::AlertPolicy>, String> {
        let project = self.session_project(session_id)?;
        let client = self.require_client(session_id)?;
        MonitoringClient::list_alert_policies(client, &project)
            .await
            .map_err(|e| e.to_string())
    }
}
