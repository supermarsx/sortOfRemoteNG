// ─── Exchange Integration – Virtual Directories & Org Config ─────────────────
//!
//! Manage OWA, ECP, ActiveSync, EWS, PowerShell, Autodiscover, MAPI, and OAB
//! virtual directories.  Also retrieve and update organization-level configuration.

use crate::auth::ps_param_opt;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual Directories
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_owa_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-OwaVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_ecp_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-EcpVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_activesync_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-ActiveSyncVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_ews_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-WebServicesVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_mapi_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-MapiVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_autodiscover_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-AutodiscoverVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_powershell_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-PowerShellVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl,\
             InternalAuthenticationMethods,ExternalAuthenticationMethods";
    client.run_ps_json(&cmd).await
}

pub async fn ps_list_oab_virtual_directories(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-OabVirtualDirectory");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalUrl,ExternalUrl";
    client.run_ps_json(&cmd).await
}

/// Set virtual directory URLs (generic – caller must use the correct Set-* cmdlet name).
pub async fn ps_set_virtual_directory_urls(
    client: &ExchangeClient,
    vdir_type: &VirtualDirectoryType,
    identity: &str,
    internal_url: Option<&str>,
    external_url: Option<&str>,
) -> ExchangeResult<String> {
    let cmdlet = match vdir_type {
        VirtualDirectoryType::Owa => "Set-OwaVirtualDirectory",
        VirtualDirectoryType::Ecp => "Set-EcpVirtualDirectory",
        VirtualDirectoryType::ActiveSync => "Set-ActiveSyncVirtualDirectory",
        VirtualDirectoryType::Ews => "Set-WebServicesVirtualDirectory",
        VirtualDirectoryType::Mapi => "Set-MapiVirtualDirectory",
        VirtualDirectoryType::AutoDiscover => "Set-AutodiscoverVirtualDirectory",
        VirtualDirectoryType::PowerShell => "Set-PowerShellVirtualDirectory",
        VirtualDirectoryType::Oab => "Set-OabVirtualDirectory",
        VirtualDirectoryType::OutlookAnywhere => "Set-OutlookAnywhere",
    };
    let mut cmd = format!("{cmdlet} -Identity '{identity}'");
    cmd += &ps_param_opt("InternalUrl", internal_url);
    cmd += &ps_param_opt("ExternalUrl", external_url);
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Outlook Anywhere
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_outlook_anywhere(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<VirtualDirectory>> {
    let mut cmd = String::from("Get-OutlookAnywhere");
    cmd += &ps_param_opt("Server", server);
    cmd += " | Select-Object Identity,Server,Name,InternalHostname,ExternalHostname,\
             InternalClientAuthenticationMethod,ExternalClientAuthenticationMethod,\
             SSLOffloading";
    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Organization Configuration
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_get_organization_config(
    client: &ExchangeClient,
) -> ExchangeResult<OrganizationConfig> {
    let cmd = "Get-OrganizationConfig | Select-Object Name,Guid,IsDehydrated,\
         DefaultPublicFolderAgeLimit,DefaultPublicFolderDeletedItemRetention,\
         DefaultPublicFolderIssueWarningQuota,DefaultPublicFolderProhibitPostQuota,\
         DefaultPublicFolderMaxItemSize,MailTipsAllTipsEnabled,\
         MailTipsGroupMetricsEnabled,MailTipsLargeAudienceThreshold,\
         MailTipsExternalRecipientsTipsEnabled,ReadTrackingEnabled,\
         DistributionGroupDefaultOU,LeanPopoutEnabled,PublicFoldersEnabled,\
         MaxSendSize,MaxReceiveSize";
    client.run_ps_json(cmd).await
}

pub async fn ps_set_organization_config(
    client: &ExchangeClient,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = String::from("Set-OrganizationConfig");
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                cmd += &format!(" -{k} '{s}'");
            } else if let Some(b) = v.as_bool() {
                cmd += &format!(" -{k} ${}", if b { "true" } else { "false" });
            } else if let Some(n) = v.as_i64() {
                cmd += &format!(" -{k} {n}");
            }
        }
    }
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Configuration
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_get_transport_config(client: &ExchangeClient) -> ExchangeResult<TransportConfig> {
    let cmd = "Get-TransportConfig | Select-Object MaxSendSize,MaxReceiveSize,\
         ExternalPostmasterAddress,InternalSMTPServers,\
         TLSReceiveDomainSecureList,TLSSendDomainSecureList,\
         GenerateCopyOfDSRFor,JournalArchivingEnabled,\
         ShadowRedundancyEnabled,SafetyNetHoldTime";
    client.run_ps_json(cmd).await
}

pub async fn ps_set_transport_config(
    client: &ExchangeClient,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = String::from("Set-TransportConfig");
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
