// ─── Exchange Integration – distribution & M365 groups ──────────────────────
use crate::auth::*;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// On-Premises (PowerShell)
// ═══════════════════════════════════════════════════════════════════════════════

/// List all distribution groups.
pub async fn ps_list_groups(
    client: &ExchangeClient,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<DistributionGroup>> {
    let limit = result_size.unwrap_or(1000);
    let cmd = format!("Get-DistributionGroup -ResultSize {limit}");
    client.run_ps_json(&cmd).await
}

/// Get a single distribution group by identity.
pub async fn ps_get_group(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<DistributionGroup> {
    let cmd = format!(
        "Get-DistributionGroup -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Create a distribution group.
pub async fn ps_create_group(
    client: &ExchangeClient,
    req: &CreateGroupRequest,
) -> ExchangeResult<DistributionGroup> {
    let type_flag = match req.group_type {
        GroupType::Security | GroupType::MailEnabledSecurity => " -Type Security",
        _ => " -Type Distribution",
    };
    let mut cmd = format!(
        "New-DistributionGroup -Name '{}' -Alias '{}' -PrimarySmtpAddress '{}'{}",
        req.display_name.replace('\'', "''"),
        req.alias.replace('\'', "''"),
        req.primary_smtp_address.replace('\'', "''"),
        type_flag,
    );
    cmd.push_str(&ps_param_list("ManagedBy", &req.managed_by));
    cmd.push_str(&ps_param_list("Members", &req.members));
    if let Some(ref d) = req.description {
        cmd.push_str(&format!(" -Notes '{}'", d.replace('\'', "''")));
    }
    client.run_ps_json(&cmd).await
}

/// Update a distribution group (Set-DistributionGroup).
pub async fn ps_update_group(
    client: &ExchangeClient,
    req: &UpdateGroupRequest,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "Set-DistributionGroup -Identity '{}'",
        req.identity.replace('\'', "''")
    );
    cmd.push_str(&ps_param_opt("DisplayName", req.display_name.as_deref()));
    cmd.push_str(&ps_param_opt("PrimarySmtpAddress", req.primary_smtp_address.as_deref()));
    cmd.push_str(&ps_param_list("ManagedBy", &req.managed_by));
    if let Some(ref d) = req.description {
        cmd.push_str(&format!(" -Notes '{}'", d.replace('\'', "''")));
    }
    if let Some(v) = req.require_sender_authentication_enabled {
        cmd.push_str(&ps_param_bool("RequireSenderAuthenticationEnabled", v));
    }
    if let Some(v) = req.hide_from_address_lists {
        cmd.push_str(&ps_param_bool("HiddenFromAddressListsEnabled", v));
    }
    client.run_ps(&cmd).await
}

/// Remove a distribution group.
pub async fn ps_remove_group(client: &ExchangeClient, identity: &str) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-DistributionGroup -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// List members of a group.
pub async fn ps_list_group_members(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Vec<GroupMember>> {
    let cmd = format!(
        "Get-DistributionGroupMember -Identity '{}' -ResultSize Unlimited",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Add a member to a group.
pub async fn ps_add_group_member(
    client: &ExchangeClient,
    group: &str,
    member: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Add-DistributionGroupMember -Identity '{}' -Member '{}' -Confirm:$false",
        group.replace('\'', "''"),
        member.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Remove a member from a group.
pub async fn ps_remove_group_member(
    client: &ExchangeClient,
    group: &str,
    member: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-DistributionGroupMember -Identity '{}' -Member '{}' -Confirm:$false",
        group.replace('\'', "''"),
        member.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// List dynamic distribution groups.
pub async fn ps_list_dynamic_groups(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<DistributionGroup>> {
    client
        .run_ps_json("Get-DynamicDistributionGroup -ResultSize 1000")
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online (Graph API – M365 groups)
// ═══════════════════════════════════════════════════════════════════════════════

/// List M365 / unified groups through Graph.
pub async fn graph_list_groups(client: &ExchangeClient) -> ExchangeResult<Vec<DistributionGroup>> {
    let groups: Vec<serde_json::Value> = client
        .graph_list("/groups?$filter=groupTypes/any(g:g eq 'Unified')&$select=id,displayName,mail,mailNickname,description,membershipRule,createdDateTime&$top=999")
        .await
        .unwrap_or_default();

    Ok(groups
        .into_iter()
        .map(|g| DistributionGroup {
            id: g["id"].as_str().unwrap_or_default().to_string(),
            display_name: g["displayName"].as_str().unwrap_or_default().to_string(),
            primary_smtp_address: g["mail"].as_str().unwrap_or_default().to_string(),
            alias: g["mailNickname"].as_str().unwrap_or_default().to_string(),
            group_type: GroupType::Microsoft365,
            description: g["description"].as_str().map(String::from),
            ..Default::default()
        })
        .collect())
}

/// List members of an M365 group via Graph.
pub async fn graph_list_group_members(
    client: &ExchangeClient,
    group_id: &str,
) -> ExchangeResult<Vec<GroupMember>> {
    let members: Vec<serde_json::Value> = client
        .graph_list(&format!(
            "/groups/{group_id}/members?$select=id,displayName,mail,userPrincipalName"
        ))
        .await
        .unwrap_or_default();

    Ok(members
        .into_iter()
        .map(|m| GroupMember {
            identity: m["id"].as_str().unwrap_or_default().to_string(),
            display_name: m["displayName"].as_str().unwrap_or_default().to_string(),
            primary_smtp_address: m["mail"].as_str().unwrap_or_default().to_string(),
            recipient_type: m["@odata.type"]
                .as_str()
                .unwrap_or("#microsoft.graph.user")
                .to_string(),
        })
        .collect())
}

/// Add member to M365 group via Graph.
pub async fn graph_add_group_member(
    client: &ExchangeClient,
    group_id: &str,
    user_id: &str,
) -> ExchangeResult<()> {
    let body = serde_json::json!({
        "@odata.id": format!("https://graph.microsoft.com/v1.0/directoryObjects/{user_id}")
    });
    let _: serde_json::Value = client
        .graph_post(&format!("/groups/{group_id}/members/$ref"), &body)
        .await?;
    Ok(())
}

/// Remove member from M365 group via Graph.
pub async fn graph_remove_group_member(
    client: &ExchangeClient,
    group_id: &str,
    user_id: &str,
) -> ExchangeResult<()> {
    client
        .graph_delete(&format!("/groups/{group_id}/members/{user_id}/$ref"))
        .await
}
