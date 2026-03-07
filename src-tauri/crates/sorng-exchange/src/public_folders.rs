// ─── Exchange Integration – public folders ───────────────────────────────────
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Public Folder operations (On-Prem + Online via PowerShell)
// ═══════════════════════════════════════════════════════════════════════════════

/// List public folders.
pub async fn ps_list_public_folders(
    client: &ExchangeClient,
    root: Option<&str>,
    recurse: bool,
) -> ExchangeResult<Vec<PublicFolder>> {
    let mut cmd = String::from("Get-PublicFolder");
    match root {
        Some(r) => cmd.push_str(&format!(" -Identity '{}' -GetChildren", r.replace('\'', "''"))),
        None => cmd.push_str(" -Identity '\\' -GetChildren"),
    }
    if recurse {
        cmd = cmd.replace("-GetChildren", "-Recurse");
    }
    cmd.push_str(" -ResultSize Unlimited");
    client.run_ps_json(&cmd).await
}

/// Get a specific public folder.
pub async fn ps_get_public_folder(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<PublicFolder> {
    let cmd = format!(
        "Get-PublicFolder -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Create a public folder.
pub async fn ps_create_public_folder(
    client: &ExchangeClient,
    name: &str,
    path: Option<&str>,
) -> ExchangeResult<PublicFolder> {
    let parent = path.unwrap_or("\\");
    let cmd = format!(
        "New-PublicFolder -Name '{}' -Path '{}'",
        name.replace('\'', "''"),
        parent.replace('\'', "''"),
    );
    client.run_ps_json(&cmd).await
}

/// Remove a public folder.
pub async fn ps_remove_public_folder(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-PublicFolder -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Mail-enable a public folder.
pub async fn ps_mail_enable_public_folder(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Enable-MailPublicFolder -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Mail-disable a public folder.
pub async fn ps_mail_disable_public_folder(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Disable-MailPublicFolder -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Get public folder statistics.
pub async fn ps_get_public_folder_statistics(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<PublicFolderStatistics> {
    let cmd = format!(
        "Get-PublicFolderStatistics -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// List public folder mailboxes.
pub async fn ps_list_public_folder_mailboxes(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<serde_json::Value>> {
    client
        .run_ps_json("Get-Mailbox -PublicFolder -ResultSize Unlimited")
        .await
}
