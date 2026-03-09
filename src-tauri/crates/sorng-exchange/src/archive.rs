// ─── Exchange Integration – Archive Mailboxes ───────────────────────────────
//!
//! Enable, disable, and expand archive mailboxes.  Also retrieve archive statistics.

use crate::auth::ps_param_opt;
use crate::client::ExchangeClient;
use crate::types::*;

/// Get archive mailbox information for a given identity.
pub async fn ps_get_archive_info(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<ArchiveMailboxInfo> {
    let cmd = format!(
        "Get-Mailbox -Identity '{identity}' | Select-Object Identity,ArchiveState,ArchiveName,\
         ArchiveDatabase,ArchiveGuid,ArchiveQuota,ArchiveWarningQuota,\
         AutoExpandingArchiveEnabled"
    );
    client.run_ps_json(&cmd).await
}

/// Enable the archive mailbox.
pub async fn ps_enable_archive(
    client: &ExchangeClient,
    identity: &str,
    database: Option<&str>,
) -> ExchangeResult<String> {
    let mut cmd = format!("Enable-Mailbox -Identity '{identity}' -Archive");
    cmd += &ps_param_opt("ArchiveDatabase", database);
    client.run_ps(&cmd).await
}

/// Disable the archive mailbox.
pub async fn ps_disable_archive(client: &ExchangeClient, identity: &str) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Disable-Mailbox -Identity '{identity}' -Archive -Confirm:$false"
        ))
        .await
}

/// Enable auto-expanding archive (Exchange Online).
pub async fn ps_enable_auto_expanding_archive(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Enable-Mailbox -Identity '{identity}' -AutoExpandingArchive"
        ))
        .await
}

/// Set archive quota on a mailbox.
pub async fn ps_set_archive_quota(
    client: &ExchangeClient,
    identity: &str,
    quota: &str,
    warning_quota: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-Mailbox -Identity '{identity}' \
             -ArchiveQuota '{quota}' -ArchiveWarningQuota '{warning_quota}'"
        ))
        .await
}

/// Get archive mailbox statistics.
pub async fn ps_get_archive_statistics(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<ArchiveStatistics> {
    let cmd = format!(
        "Get-MailboxStatistics -Identity '{identity}' -Archive | \
         Select-Object DisplayName,TotalItemSize,ItemCount,TotalDeletedItemSize,DeletedItemCount"
    );
    client.run_ps_json(&cmd).await
}
