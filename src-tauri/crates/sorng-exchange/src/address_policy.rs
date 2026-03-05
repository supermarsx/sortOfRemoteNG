// ─── Exchange Integration – address policies, domains, address lists ─────────
use crate::auth::*;
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Email Address Policies
// ═══════════════════════════════════════════════════════════════════════════════

/// List email address policies.
pub async fn ps_list_address_policies(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<EmailAddressPolicy>> {
    client
        .run_ps_json("Get-EmailAddressPolicy")
        .await
}

/// Get a specific email address policy.
pub async fn ps_get_address_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<EmailAddressPolicy> {
    let cmd = format!(
        "Get-EmailAddressPolicy -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Apply email address policy to recipients.
pub async fn ps_apply_address_policy(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Update-EmailAddressPolicy -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Accepted Domains
// ═══════════════════════════════════════════════════════════════════════════════

/// List accepted domains.
pub async fn ps_list_accepted_domains(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<AcceptedDomain>> {
    client
        .run_ps_json("Get-AcceptedDomain")
        .await
}

/// Get a specific accepted domain.
pub async fn ps_get_accepted_domain(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<AcceptedDomain> {
    let cmd = format!(
        "Get-AcceptedDomain -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Create an accepted domain (on-prem).
pub async fn ps_create_accepted_domain(
    client: &ExchangeClient,
    name: &str,
    domain_name: &str,
    domain_type: &str,
) -> ExchangeResult<AcceptedDomain> {
    let cmd = format!(
        "New-AcceptedDomain -Name '{}' -DomainName '{}' -DomainType {}",
        name.replace('\'', "''"),
        domain_name.replace('\'', "''"),
        domain_type,
    );
    client.run_ps_json(&cmd).await
}

/// Remove an accepted domain.
pub async fn ps_remove_accepted_domain(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Remove-AcceptedDomain -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Address Lists & Global Address List
// ═══════════════════════════════════════════════════════════════════════════════

/// List address lists.
pub async fn ps_list_address_lists(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<AddressList>> {
    client
        .run_ps_json("Get-AddressList")
        .await
}

/// Get a specific address list.
pub async fn ps_get_address_list(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<AddressList> {
    let cmd = format!(
        "Get-AddressList -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Update the Global Address List.
pub async fn ps_update_gal(client: &ExchangeClient) -> ExchangeResult<String> {
    client
        .run_ps("Get-GlobalAddressList | Update-GlobalAddressList")
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online – domains via Graph
// ═══════════════════════════════════════════════════════════════════════════════

/// List verified domains in the tenant.
pub async fn graph_list_domains(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<AcceptedDomain>> {
    let domains: Vec<serde_json::Value> = client
        .graph_list("/domains?$select=id,isVerified,isDefault,supportedServices")
        .await
        .unwrap_or_default();

    Ok(domains
        .into_iter()
        .filter(|d| {
            d["supportedServices"]
                .as_array()
                .map(|a| a.iter().any(|s| s.as_str() == Some("Email")))
                .unwrap_or(false)
        })
        .map(|d| AcceptedDomain {
            name: d["id"].as_str().unwrap_or_default().to_string(),
            domain_name: d["id"].as_str().unwrap_or_default().to_string(),
            domain_type: AcceptedDomainType::Authoritative,
            is_default: d["isDefault"].as_bool().unwrap_or(false),
        })
        .collect())
}
