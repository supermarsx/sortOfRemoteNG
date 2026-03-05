// ─── Exchange Integration – health, DAG, databases, service status ───────────
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Servers (On-Premises)
// ═══════════════════════════════════════════════════════════════════════════════

/// List Exchange servers in the organisation.
pub async fn ps_list_servers(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<ExchangeServer>> {
    client
        .run_ps_json("Get-ExchangeServer | Select-Object Name,Fqdn,ServerRole,Edition,AdminDisplayVersion,DatabaseAvailabilityGroup,Site")
        .await
}

/// Get a specific Exchange server.
pub async fn ps_get_server(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<ExchangeServer> {
    let cmd = format!(
        "Get-ExchangeServer -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Get server component states (maintenance mode check).
pub async fn ps_get_server_component_state(
    client: &ExchangeClient,
    server: &str,
) -> ExchangeResult<Vec<ServerComponentState>> {
    let cmd = format!(
        "Get-ServerComponentState -Identity '{}'",
        server.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mailbox Databases (On-Premises)
// ═══════════════════════════════════════════════════════════════════════════════

/// List mailbox databases.
pub async fn ps_list_databases(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<MailboxDatabase>> {
    let cmd = match server {
        Some(s) => format!(
            "Get-MailboxDatabase -Server '{}' -Status",
            s.replace('\'', "''")
        ),
        None => "Get-MailboxDatabase -Status".to_string(),
    };
    client.run_ps_json(&cmd).await
}

/// Get a specific database with status.
pub async fn ps_get_database(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MailboxDatabase> {
    let cmd = format!(
        "Get-MailboxDatabase -Identity '{}' -Status",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Mount a database.
pub async fn ps_mount_database(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Mount-Database -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Dismount a database.
pub async fn ps_dismount_database(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Dismount-Database -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database Availability Groups (DAG)
// ═══════════════════════════════════════════════════════════════════════════════

/// List DAGs.
pub async fn ps_list_dags(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<DatabaseAvailabilityGroup>> {
    client
        .run_ps_json("Get-DatabaseAvailabilityGroup -Status")
        .await
}

/// Get a specific DAG.
pub async fn ps_get_dag(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<DatabaseAvailabilityGroup> {
    let cmd = format!(
        "Get-DatabaseAvailabilityGroup -Identity '{}' -Status",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Get database copy status (replication health).
pub async fn ps_get_dag_copy_status(
    client: &ExchangeClient,
    server: Option<&str>,
    database: Option<&str>,
) -> ExchangeResult<Vec<DagReplicationStatus>> {
    let mut cmd = String::from("Get-MailboxDatabaseCopyStatus");
    if let Some(db) = database {
        cmd.push_str(&format!(" -Identity '{}'", db.replace('\'', "''")));
    }
    if let Some(s) = server {
        cmd.push_str(&format!(" -Server '{}'", s.replace('\'', "''")));
    }
    client.run_ps_json(&cmd).await
}

/// Test replication health (Test-ReplicationHealth).
pub async fn ps_test_replication_health(
    client: &ExchangeClient,
    server: &str,
) -> ExchangeResult<Vec<serde_json::Value>> {
    let cmd = format!(
        "Test-ReplicationHealth -Server '{}'",
        server.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online – Service Health (Graph / M365 Admin API)
// ═══════════════════════════════════════════════════════════════════════════════

/// Get Exchange Online service health status via Graph.
pub async fn graph_service_health(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<ServiceHealthStatus>> {
    let items: Vec<serde_json::Value> = client
        .graph_list("/admin/serviceAnnouncement/healthOverviews?$filter=service eq 'Exchange Online'")
        .await
        .unwrap_or_default();

    Ok(items
        .into_iter()
        .map(|v| ServiceHealthStatus {
            service: v["service"].as_str().unwrap_or("Exchange Online").to_string(),
            status: v["status"].as_str().unwrap_or_default().to_string(),
            status_display_name: v["statusDisplayName"].as_str().map(String::from),
            feature_status: v["featureStatus"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .map(|f| FeatureStatus {
                            feature_name: f["featureName"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            feature_service_status: f["featureServiceStatus"]
                                .as_str()
                                .unwrap_or_default()
                                .to_string(),
                            feature_service_status_display_name: f
                                ["featureServiceStatusDisplayName"]
                                .as_str()
                                .map(String::from),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect())
}

/// List current service health issues for Exchange Online.
pub async fn graph_service_issues(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<serde_json::Value>> {
    client
        .graph_list("/admin/serviceAnnouncement/issues?$filter=service eq 'Exchange Online'")
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// General health checks
// ═══════════════════════════════════════════════════════════════════════════════

/// Test mail flow (Send + verify delivery).
pub async fn ps_test_mailflow(
    client: &ExchangeClient,
    target_email: Option<&str>,
) -> ExchangeResult<serde_json::Value> {
    let cmd = match target_email {
        Some(t) => format!(
            "Test-Mailflow -TargetEmailAddress '{}'",
            t.replace('\'', "''")
        ),
        None => "Test-Mailflow".to_string(),
    };
    client.run_ps_json(&cmd).await
}

/// Get Exchange server health (Test-ServiceHealth).
pub async fn ps_test_service_health(
    client: &ExchangeClient,
    server: &str,
) -> ExchangeResult<Vec<serde_json::Value>> {
    let cmd = format!(
        "Test-ServiceHealth -Server '{}'",
        server.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}
