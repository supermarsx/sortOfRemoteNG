// ─── Exchange Integration – Shared Mailboxes & Conversion ────────────────────
//!
//! Operations specific to shared mailboxes: creation, conversion between types,
//! auto-mapping control, and send-as/send-on-behalf delegation.

use crate::client::ExchangeClient;
use crate::types::*;

/// Convert a mailbox between types (e.g. UserMailbox → SharedMailbox).
pub async fn ps_convert_mailbox(
    client: &ExchangeClient,
    req: &ConvertMailboxRequest,
) -> ExchangeResult<Mailbox> {
    let target = match req.target_type {
        MailboxType::SharedMailbox => "Shared",
        MailboxType::RoomMailbox => "Room",
        MailboxType::EquipmentMailbox => "Equipment",
        MailboxType::UserMailbox => "Regular",
        _ => "Regular",
    };
    let cmd = format!(
        "Set-Mailbox -Identity '{}' -Type {target} -Force; \
         Get-Mailbox -Identity '{}'",
        req.identity, req.identity
    );
    client.run_ps_json(&cmd).await
}

/// List all shared mailboxes.
pub async fn ps_list_shared_mailboxes(
    client: &ExchangeClient,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<Mailbox>> {
    let limit = result_size.unwrap_or(1000);
    let cmd = format!(
        "Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize {limit} | \
         Select-Object Identity,DisplayName,PrimarySmtpAddress,Alias,Database,\
         ServerName,WhenCreated"
    );
    client.run_ps_json(&cmd).await
}

/// Add auto-mapping for a user to a shared mailbox (Outlook auto-discover).
pub async fn ps_add_automapping(
    client: &ExchangeClient,
    mailbox: &str,
    user: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Add-MailboxPermission -Identity '{mailbox}' -User '{user}' \
             -AccessRights FullAccess -AutoMapping $true"
        ))
        .await
}

/// Remove auto-mapping for a user.
pub async fn ps_remove_automapping(
    client: &ExchangeClient,
    mailbox: &str,
    user: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-MailboxPermission -Identity '{mailbox}' -User '{user}' \
             -AccessRights FullAccess -Confirm:$false; \
             Add-MailboxPermission -Identity '{mailbox}' -User '{user}' \
             -AccessRights FullAccess -AutoMapping $false"
        ))
        .await
}

/// Grant Send-As permission on a mailbox.
pub async fn ps_add_send_as(
    client: &ExchangeClient,
    identity: &str,
    trustee: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Add-ADPermission -Identity '{identity}' -User '{trustee}' \
             -ExtendedRights 'Send As'"
        ))
        .await
}

/// Remove Send-As permission on a mailbox.
pub async fn ps_remove_send_as(
    client: &ExchangeClient,
    identity: &str,
    trustee: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Remove-ADPermission -Identity '{identity}' -User '{trustee}' \
             -ExtendedRights 'Send As' -Confirm:$false"
        ))
        .await
}

/// Grant Send-on-Behalf permission.
pub async fn ps_add_send_on_behalf(
    client: &ExchangeClient,
    identity: &str,
    trustee: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-Mailbox -Identity '{identity}' \
             -GrantSendOnBehalfTo @{{Add='{trustee}'}}"
        ))
        .await
}

/// Remove Send-on-Behalf permission.
pub async fn ps_remove_send_on_behalf(
    client: &ExchangeClient,
    identity: &str,
    trustee: &str,
) -> ExchangeResult<String> {
    client
        .run_ps(&format!(
            "Set-Mailbox -Identity '{identity}' \
             -GrantSendOnBehalfTo @{{Remove='{trustee}'}}"
        ))
        .await
}

/// List all Room mailboxes.
pub async fn ps_list_room_mailboxes(client: &ExchangeClient) -> ExchangeResult<Vec<Mailbox>> {
    let cmd = "Get-Mailbox -RecipientTypeDetails RoomMailbox -ResultSize Unlimited | \
         Select-Object Identity,DisplayName,PrimarySmtpAddress,Alias,Database,\
         ServerName,WhenCreated";
    client.run_ps_json(cmd).await
}

/// List all Equipment mailboxes.
pub async fn ps_list_equipment_mailboxes(client: &ExchangeClient) -> ExchangeResult<Vec<Mailbox>> {
    let cmd = "Get-Mailbox -RecipientTypeDetails EquipmentMailbox -ResultSize Unlimited | \
         Select-Object Identity,DisplayName,PrimarySmtpAddress,Alias,Database,\
         ServerName,WhenCreated";
    client.run_ps_json(cmd).await
}

/// List room lists (distribution groups containing room mailboxes).
pub async fn ps_list_room_lists(client: &ExchangeClient) -> ExchangeResult<Vec<DistributionGroup>> {
    let cmd = "Get-DistributionGroup -RecipientTypeDetails RoomList | \
         Select-Object Identity,DisplayName,PrimarySmtpAddress,Alias,MemberCount";
    client.run_ps_json(cmd).await
}
