// ─── Exchange Integration – OWA, Mobile & Throttling Policies ────────────────
//!
//! Manage OWA mailbox policies, mobile device mailbox policies, and
//! throttling policies.

use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// OWA Mailbox Policies
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_owa_policies(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<OwaMailboxPolicy>> {
    let cmd = "Get-OwaMailboxPolicy | Select-Object Identity,Name,IsDefault,\
         DirectFileAccessOnPublicComputersEnabled,DirectFileAccessOnPrivateComputersEnabled,\
         WacViewingOnPublicComputersEnabled,WacViewingOnPrivateComputersEnabled,\
         InstantMessagingEnabled,TextMessagingEnabled,ActiveSyncIntegrationEnabled,\
         AllAddressListsEnabled,CalendarEnabled,ContactsEnabled,TasksEnabled,\
         JournalEnabled,NotesEnabled,RemindersAndNotificationsEnabled,\
         SearchFoldersEnabled,SignaturesEnabled,SpellCheckerEnabled,\
         ThemeSelectionEnabled,ChangePasswordEnabled,RulesEnabled,PublicFoldersEnabled";
    client.run_ps_json(cmd).await
}

pub async fn ps_get_owa_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<OwaMailboxPolicy> {
    let cmd = format!("Get-OwaMailboxPolicy -Identity '{identity}'");
    client.run_ps_json(&cmd).await
}

pub async fn ps_set_owa_policy(
    client: &ExchangeClient,
    identity: &str,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = format!("Set-OwaMailboxPolicy -Identity '{identity}'");
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                cmd += &format!(" -{k} '{s}'");
            } else if let Some(b) = v.as_bool() {
                cmd += &format!(" -{k} ${}", if b { "true" } else { "false" });
            }
        }
    }
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile Device Mailbox Policies
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_mobile_device_policies(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<MobileDeviceMailboxPolicy>> {
    let cmd = "Get-MobileDeviceMailboxPolicy | Select-Object Identity,Name,IsDefault,\
         AllowBluetooth,AllowBrowser,AllowCamera,AllowConsumerEmail,AllowHTMLEmail,\
         AllowInternetSharing,AllowIrDA,AllowSimplePassword,AllowTextMessaging,\
         AllowUnsignedApplications,AllowWiFi,AlphanumericPasswordRequired,\
         DeviceEncryptionEnabled,DevicePasswordEnabled,MaxInactivityTimeDeviceLock,\
         MaxPasswordFailedAttempts,MinPasswordLength,PasswordRecoveryEnabled,\
         RequireDeviceEncryption,RequireStorageCardEncryption,AttachmentsEnabled";
    client.run_ps_json(cmd).await
}

pub async fn ps_get_mobile_device_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MobileDeviceMailboxPolicy> {
    let cmd = format!("Get-MobileDeviceMailboxPolicy -Identity '{identity}'");
    client.run_ps_json(&cmd).await
}

pub async fn ps_set_mobile_device_policy(
    client: &ExchangeClient,
    identity: &str,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = format!("Set-MobileDeviceMailboxPolicy -Identity '{identity}'");
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                cmd += &format!(" -{k} '{s}'");
            } else if let Some(b) = v.as_bool() {
                cmd += &format!(" -{k} ${}", if b { "true" } else { "false" });
            }
        }
    }
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Throttling Policies
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_throttling_policies(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<ThrottlingPolicy>> {
    let cmd = "Get-ThrottlingPolicy | Select-Object Identity,Name,IsDefault,\
         EWSMaxConcurrency,EWSMaxSubscriptions,OASMaxConcurrency,\
         OWAMaxConcurrency,PowerShellMaxConcurrency,\
         RecipientRateLimit,MessageRateLimit,ForwardeeLimit";
    client.run_ps_json(cmd).await
}

pub async fn ps_get_throttling_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<ThrottlingPolicy> {
    let cmd = format!("Get-ThrottlingPolicy -Identity '{identity}'");
    client.run_ps_json(&cmd).await
}
