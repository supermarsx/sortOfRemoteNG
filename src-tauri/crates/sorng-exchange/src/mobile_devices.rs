// ─── Exchange Integration – Mobile Devices (ActiveSync) ──────────────────────
//!
//! Manage ActiveSync mobile device partnerships: list, statistics, wipe,
//! block, allow, and remove devices.

use crate::client::ExchangeClient;
use crate::auth::wrap_ps_json;
use crate::types::*;

/// List mobile devices for a mailbox.
pub async fn ps_list_mobile_devices(
    client: &ExchangeClient,
    mailbox: &str,
) -> ExchangeResult<Vec<MobileDevice>> {
    let script = wrap_ps_json(&format!(
        "Get-MobileDevice -Mailbox '{mailbox}' | Select-Object Identity,DeviceId,\
         FriendlyName,DeviceModel,DeviceType,DeviceOS,DeviceUserAgent,\
         DeviceAccessState,FirstSyncTime,LastSyncAttemptTime,LastSuccessSync,ClientType"
    ));
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

/// Get mobile device statistics.
pub async fn ps_get_mobile_device_statistics(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MobileDeviceStatistics> {
    let script = wrap_ps_json(&format!(
        "Get-MobileDeviceStatistics -Identity '{identity}' | Select-Object Identity,DeviceId,\
         Status,LastSyncAttemptTime,LastSuccessSync,NumberOfFoldersSynced"
    ));
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Initiate a remote wipe on a mobile device.
pub async fn ps_wipe_mobile_device(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Clear-MobileDevice -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

/// Block a mobile device (set access state to Blocked).
pub async fn ps_block_mobile_device(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-CASMailbox -Identity '{identity}' -ActiveSyncBlockedDeviceIDs @{{Add='{identity}'}}"
        ))
        .await
}

/// Allow a mobile device (remove from blocked list).
pub async fn ps_allow_mobile_device(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-CASMailbox -Identity '{identity}' -ActiveSyncAllowedDeviceIDs @{{Add='{identity}'}}"
        ))
        .await
}

/// Remove a mobile device partnership.
pub async fn ps_remove_mobile_device(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-MobileDevice -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

/// List all mobile devices across the org (admin view).
pub async fn ps_list_all_mobile_devices(
    client: &ExchangeClient,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<MobileDevice>> {
    let limit = result_size.unwrap_or(500);
    let script = wrap_ps_json(&format!(
        "Get-MobileDevice -ResultSize {limit} | Select-Object Identity,DeviceId,\
         FriendlyName,DeviceModel,DeviceType,DeviceOS,DeviceUserAgent,\
         DeviceAccessState,FirstSyncTime,LastSyncAttemptTime,LastSuccessSync,ClientType"
    ));
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}
