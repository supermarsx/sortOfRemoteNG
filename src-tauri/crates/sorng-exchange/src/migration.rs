// ─── Exchange Integration – migration batches & move requests ────────────────
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Migration Batches (Online + On-Prem via PowerShell)
// ═══════════════════════════════════════════════════════════════════════════════

/// List migration batches.
pub async fn ps_list_migration_batches(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<MigrationBatch>> {
    client.run_ps_json("Get-MigrationBatch").await
}

/// Get a specific migration batch.
pub async fn ps_get_migration_batch(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MigrationBatch> {
    let cmd = format!(
        "Get-MigrationBatch -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Start a migration batch.
pub async fn ps_start_migration_batch(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Start-MigrationBatch -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Stop a migration batch.
pub async fn ps_stop_migration_batch(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Stop-MigrationBatch -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Complete a migration batch.
pub async fn ps_complete_migration_batch(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Complete-MigrationBatch -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Remove a migration batch.
pub async fn ps_remove_migration_batch(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-MigrationBatch -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// List migration users for a batch.
pub async fn ps_list_migration_users(
    client: &ExchangeClient,
    batch_id: Option<&str>,
) -> ExchangeResult<Vec<MigrationUser>> {
    let cmd = match batch_id {
        Some(id) => format!("Get-MigrationUser -BatchId '{}'", id.replace('\'', "''")),
        None => "Get-MigrationUser".to_string(),
    };
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Move Requests (On-Premises)
// ═══════════════════════════════════════════════════════════════════════════════

/// List move requests.
pub async fn ps_list_move_requests(client: &ExchangeClient) -> ExchangeResult<Vec<MoveRequest>> {
    client
        .run_ps_json("Get-MoveRequest -ResultSize Unlimited")
        .await
}

/// Get move request statistics.
pub async fn ps_get_move_request_statistics(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MoveRequest> {
    let cmd = format!(
        "Get-MoveRequestStatistics -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Create a move request (local database move).
pub async fn ps_new_move_request(
    client: &ExchangeClient,
    identity: &str,
    target_database: &str,
    batch_name: Option<&str>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "New-MoveRequest -Identity '{}' -TargetDatabase '{}'",
        identity.replace('\'', "''"),
        target_database.replace('\'', "''"),
    );
    if let Some(bn) = batch_name {
        cmd.push_str(&format!(" -BatchName '{}'", bn.replace('\'', "''")));
    }
    client.run_ps(&cmd).await
}

/// Remove a completed / failed move request.
pub async fn ps_remove_move_request(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-MoveRequest -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Suspend a move request.
pub async fn ps_suspend_move_request(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Suspend-MoveRequest -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Resume a suspended move request.
pub async fn ps_resume_move_request(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Resume-MoveRequest -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}
