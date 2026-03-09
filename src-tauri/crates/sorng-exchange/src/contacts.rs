// ─── Exchange Integration – Mail Contacts & Mail Users ───────────────────────
//!
//! Manages external recipient objects: MailContact (no AD logon) and
//! MailUser (AD-enabled with external email).

use crate::auth::ps_param_opt;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// On-prem / EXO PowerShell – Mail Contacts
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_mail_contacts(
    client: &ExchangeClient,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<MailContact>> {
    let limit = result_size.unwrap_or(1000);
    let cmd = format!(
        "Get-MailContact -ResultSize {limit} | Select-Object Identity,DisplayName,Alias,\
         ExternalEmailAddress,PrimarySmtpAddress,EmailAddresses,OrganizationalUnit,\
         HiddenFromAddressListsEnabled,FirstName,LastName,WhenCreated"
    );
    client.run_ps_json(&cmd).await
}

pub async fn ps_get_mail_contact(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MailContact> {
    let cmd = format!(
        "Get-MailContact -Identity '{identity}' | Select-Object Identity,DisplayName,Alias,\
         ExternalEmailAddress,PrimarySmtpAddress,EmailAddresses,OrganizationalUnit,\
         HiddenFromAddressListsEnabled,FirstName,LastName,WhenCreated"
    );
    client.run_ps_json(&cmd).await
}

pub async fn ps_create_mail_contact(
    client: &ExchangeClient,
    req: &CreateMailContactRequest,
) -> ExchangeResult<MailContact> {
    let mut cmd = format!(
        "New-MailContact -Name '{}' -Alias '{}' -ExternalEmailAddress '{}'",
        req.display_name, req.alias, req.external_email_address
    );
    cmd += &ps_param_opt("FirstName", req.first_name.as_deref());
    cmd += &ps_param_opt("LastName", req.last_name.as_deref());
    cmd += &ps_param_opt("OrganizationalUnit", req.organizational_unit.as_deref());
    client.run_ps_json(&cmd).await
}

pub async fn ps_update_mail_contact(
    client: &ExchangeClient,
    identity: &str,
    params: &serde_json::Value,
) -> ExchangeResult<String> {
    let mut cmd = format!("Set-MailContact -Identity '{identity}'");
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

pub async fn ps_remove_mail_contact(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-MailContact -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// On-prem / EXO PowerShell – Mail Users
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn ps_list_mail_users(
    client: &ExchangeClient,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<MailUser>> {
    let limit = result_size.unwrap_or(1000);
    let cmd = format!(
        "Get-MailUser -ResultSize {limit} | Select-Object Identity,DisplayName,Alias,\
         ExternalEmailAddress,UserPrincipalName,PrimarySmtpAddress,EmailAddresses,\
         IsValid,WhenCreated"
    );
    client.run_ps_json(&cmd).await
}

pub async fn ps_get_mail_user(client: &ExchangeClient, identity: &str) -> ExchangeResult<MailUser> {
    let cmd = format!(
        "Get-MailUser -Identity '{identity}' | Select-Object Identity,DisplayName,Alias,\
         ExternalEmailAddress,UserPrincipalName,PrimarySmtpAddress,EmailAddresses,\
         IsValid,WhenCreated"
    );
    client.run_ps_json(&cmd).await
}

pub async fn ps_create_mail_user(
    client: &ExchangeClient,
    req: &CreateMailUserRequest,
) -> ExchangeResult<MailUser> {
    let mut cmd = format!(
        "New-MailUser -Name '{}' -Alias '{}' -ExternalEmailAddress '{}' \
         -UserPrincipalName '{}' -Password (ConvertTo-SecureString '{}' -AsPlainText -Force)",
        req.display_name,
        req.alias,
        req.external_email_address,
        req.user_principal_name,
        req.password
    );
    cmd += &ps_param_opt("FirstName", req.first_name.as_deref());
    cmd += &ps_param_opt("LastName", req.last_name.as_deref());
    client.run_ps_json(&cmd).await
}

pub async fn ps_remove_mail_user(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-MailUser -Identity '{identity}' -Confirm:$false"
        ))
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Graph API – external contacts
// ═══════════════════════════════════════════════════════════════════════════════

pub async fn graph_list_contacts(client: &ExchangeClient) -> ExchangeResult<Vec<MailContact>> {
    let items: Vec<serde_json::Value> = client
        .graph_list(&format!("{}/contacts?$top=999", api::GRAPH_BASE))
        .await?;
    Ok(items
        .into_iter()
        .map(|v| serde_json::from_value(v).unwrap_or_default())
        .collect())
}
