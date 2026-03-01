//! Google Cloud SQL client.
//!
//! Covers Cloud SQL instances, databases, users, and operations.
//!
//! API base: `https://sqladmin.googleapis.com/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "sqladmin";
const V1: &str = "/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// Cloud SQL instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlInstance {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "databaseVersion")]
    pub database_version: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub state: String,
    #[serde(default, rename = "gceZone")]
    pub gce_zone: Option<String>,
    #[serde(default, rename = "connectionName")]
    pub connection_name: Option<String>,
    #[serde(default, rename = "ipAddresses")]
    pub ip_addresses: Vec<IpMapping>,
    #[serde(default)]
    pub settings: Option<SqlSettings>,
    #[serde(default, rename = "serverCaCert")]
    pub server_ca_cert: Option<SslCert>,
    #[serde(default, rename = "instanceType")]
    pub instance_type: String,
    #[serde(default)]
    pub project: String,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "backendType")]
    pub backend_type: String,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "maintenanceVersion")]
    pub maintenance_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpMapping {
    #[serde(default, rename = "type")]
    pub ip_type: String,
    #[serde(default, rename = "ipAddress")]
    pub ip_address: String,
    #[serde(default, rename = "timeToRetire")]
    pub time_to_retire: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlSettings {
    #[serde(default)]
    pub tier: String,
    #[serde(default, rename = "availabilityType")]
    pub availability_type: Option<String>,
    #[serde(default, rename = "dataDiskSizeGb")]
    pub data_disk_size_gb: Option<String>,
    #[serde(default, rename = "dataDiskType")]
    pub data_disk_type: Option<String>,
    #[serde(default, rename = "storageAutoResize")]
    pub storage_auto_resize: Option<bool>,
    #[serde(default, rename = "pricingPlan")]
    pub pricing_plan: Option<String>,
    #[serde(default, rename = "activationPolicy")]
    pub activation_policy: Option<String>,
    #[serde(default, rename = "ipConfiguration")]
    pub ip_configuration: Option<IpConfiguration>,
    #[serde(default, rename = "backupConfiguration")]
    pub backup_configuration: Option<BackupConfiguration>,
    #[serde(default, rename = "locationPreference")]
    pub location_preference: Option<LocationPreference>,
    #[serde(default, rename = "maintenanceWindow")]
    pub maintenance_window: Option<MaintenanceWindow>,
    #[serde(default, rename = "databaseFlags")]
    pub database_flags: Vec<DatabaseFlag>,
    #[serde(default, rename = "userLabels")]
    pub user_labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpConfiguration {
    #[serde(default, rename = "ipv4Enabled")]
    pub ipv4_enabled: Option<bool>,
    #[serde(default, rename = "privateNetwork")]
    pub private_network: Option<String>,
    #[serde(default, rename = "requireSsl")]
    pub require_ssl: Option<bool>,
    #[serde(default, rename = "authorizedNetworks")]
    pub authorized_networks: Vec<AclEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclEntry {
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, rename = "expirationTime")]
    pub expiration_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfiguration {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(default, rename = "binaryLogEnabled")]
    pub binary_log_enabled: Option<bool>,
    #[serde(default, rename = "pointInTimeRecoveryEnabled")]
    pub point_in_time_recovery_enabled: Option<bool>,
    #[serde(default, rename = "transactionLogRetentionDays")]
    pub transaction_log_retention_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationPreference {
    #[serde(default)]
    pub zone: Option<String>,
    #[serde(default, rename = "secondaryZone")]
    pub secondary_zone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceWindow {
    #[serde(default)]
    pub day: Option<u32>,
    #[serde(default)]
    pub hour: Option<u32>,
    #[serde(default, rename = "updateTrack")]
    pub update_track: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseFlag {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SslCert {
    #[serde(default)]
    pub cert: Option<String>,
    #[serde(default, rename = "commonName")]
    pub common_name: Option<String>,
    #[serde(default, rename = "createTime")]
    pub create_time: Option<String>,
    #[serde(default, rename = "expirationTime")]
    pub expiration_time: Option<String>,
}

/// Cloud SQL database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub charset: Option<String>,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub instance: String,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default)]
    pub etag: Option<String>,
}

/// Cloud SQL user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlUser {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub instance: String,
    #[serde(default)]
    pub project: String,
    #[serde(default, rename = "type")]
    pub user_type: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
}

/// Cloud SQL operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlOperation {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "operationType")]
    pub operation_type: String,
    #[serde(default, rename = "targetProject")]
    pub target_project: String,
    #[serde(default, rename = "targetId")]
    pub target_id: Option<String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "insertTime")]
    pub insert_time: Option<String>,
    #[serde(default, rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(default, rename = "endTime")]
    pub end_time: Option<String>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct InstanceList {
    #[serde(default)]
    items: Vec<SqlInstance>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DatabaseList {
    #[serde(default)]
    items: Vec<Database>,
}

#[derive(Debug, Deserialize)]
struct UserList {
    #[serde(default)]
    items: Vec<SqlUser>,
}

// ── Cloud SQL Client ────────────────────────────────────────────────────

pub struct CloudSqlClient;

impl CloudSqlClient {
    // ── Instances ────────────────────────────────────────────────────

    /// List Cloud SQL instances.
    pub async fn list_instances(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<SqlInstance>> {
        let path = format!("{}/projects/{}/instances", V1, project);
        let resp: InstanceList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Get a Cloud SQL instance.
    pub async fn get_instance(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<SqlInstance> {
        let path = format!("{}/projects/{}/instances/{}", V1, project, instance_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Restart a Cloud SQL instance.
    pub async fn restart_instance(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/restart",
            V1, project, instance_name
        );
        client
            .post(SERVICE, &path, &serde_json::Value::Null)
            .await
    }

    /// Start a stopped instance.
    pub async fn start_replica(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/startReplica",
            V1, project, instance_name
        );
        client
            .post(SERVICE, &path, &serde_json::Value::Null)
            .await
    }

    /// Stop a running replica.
    pub async fn stop_replica(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/stopReplica",
            V1, project, instance_name
        );
        client
            .post(SERVICE, &path, &serde_json::Value::Null)
            .await
    }

    /// Delete a Cloud SQL instance.
    pub async fn delete_instance(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<SqlOperation> {
        let path = format!("{}/projects/{}/instances/{}", V1, project, instance_name);
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    /// Trigger a manual backup.
    pub async fn backup_instance(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
        description: Option<&str>,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/backupRuns",
            V1, project, instance_name
        );
        let mut body = serde_json::json!({});
        if let Some(desc) = description {
            body["description"] = serde_json::Value::String(desc.to_string());
        }
        client.post(SERVICE, &path, &body).await
    }

    // ── Databases ───────────────────────────────────────────────────

    /// List databases in an instance.
    pub async fn list_databases(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<Vec<Database>> {
        let path = format!(
            "{}/projects/{}/instances/{}/databases",
            V1, project, instance_name
        );
        let resp: DatabaseList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Create a database.
    pub async fn create_database(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
        db_name: &str,
        charset: Option<&str>,
        collation: Option<&str>,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/databases",
            V1, project, instance_name
        );
        let mut body = serde_json::json!({
            "name": db_name,
            "project": project,
            "instance": instance_name,
        });
        if let Some(cs) = charset {
            body["charset"] = serde_json::Value::String(cs.to_string());
        }
        if let Some(co) = collation {
            body["collation"] = serde_json::Value::String(co.to_string());
        }
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a database.
    pub async fn delete_database(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
        db_name: &str,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/databases/{}",
            V1, project, instance_name, db_name
        );
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }

    // ── Users ───────────────────────────────────────────────────────

    /// List users.
    pub async fn list_users(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
    ) -> GcpResult<Vec<SqlUser>> {
        let path = format!(
            "{}/projects/{}/instances/{}/users",
            V1, project, instance_name
        );
        let resp: UserList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.items)
    }

    /// Create a user.
    pub async fn create_user(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
        name: &str,
        password: &str,
        host: Option<&str>,
    ) -> GcpResult<SqlOperation> {
        let path = format!(
            "{}/projects/{}/instances/{}/users",
            V1, project, instance_name
        );
        let mut body = serde_json::json!({
            "name": name,
            "password": password,
            "instance": instance_name,
            "project": project,
        });
        if let Some(h) = host {
            body["host"] = serde_json::Value::String(h.to_string());
        }
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a user.
    pub async fn delete_user(
        client: &mut GcpClient,
        project: &str,
        instance_name: &str,
        name: &str,
        host: Option<&str>,
    ) -> GcpResult<SqlOperation> {
        let mut path = format!(
            "{}/projects/{}/instances/{}/users?name={}",
            V1, project, instance_name, name
        );
        if let Some(h) = host {
            path.push_str(&format!("&host={}", h));
        }
        let text = client.delete(SERVICE, &path).await?;
        serde_json::from_str(&text)
            .map_err(|e| crate::error::GcpError::from_str(SERVICE, &format!("Parse operation: {}", e)))
    }
}
