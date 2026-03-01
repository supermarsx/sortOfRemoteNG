//! Azure Cost Management – Usage details, budgets.

use log::debug;

use crate::client::AzureClient;
use crate::types::{AzureResult, Budget, UsageDetail};

// ─── Usage Details ──────────────────────────────────────────────────

/// List usage details for the subscription.
///
/// `filter` – OData filter, e.g. `"properties/usageStart ge '2024-01-01' and properties/usageEnd le '2024-01-31'"`.
/// `top` – optional maximum rows.
pub async fn list_usage_details(
    client: &AzureClient,
    filter: Option<&str>,
    top: Option<u32>,
) -> AzureResult<Vec<UsageDetail>> {
    let api = &client.config().api_version_cost;
    // Use consumption API for raw usage rows
    let mut path_usage = format!(
        "/providers/Microsoft.Consumption/usageDetails?api-version={}",
        api
    );
    if let Some(f) = filter {
        path_usage.push_str(&format!("&$filter={}", f));
    }
    if let Some(n) = top {
        path_usage.push_str(&format!("&$top={}", n));
    }
    let url = client.subscription_url(&path_usage)?;
    debug!("list_usage_details → {}", url);
    client.get_all_pages(&url).await
}

/// List usage details within a specific resource group.
pub async fn list_usage_details_in_rg(
    client: &AzureClient,
    rg: &str,
    filter: Option<&str>,
    top: Option<u32>,
) -> AzureResult<Vec<UsageDetail>> {
    let api = &client.config().api_version_cost;
    let mut path = format!(
        "/providers/Microsoft.Consumption/usageDetails?api-version={}",
        api
    );
    if let Some(f) = filter {
        path.push_str(&format!("&$filter={}", f));
    }
    if let Some(n) = top {
        path.push_str(&format!("&$top={}", n));
    }
    let url = client.resource_group_url(rg, &path)?;
    debug!("list_usage_details_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

// ─── Budgets ────────────────────────────────────────────────────────

pub async fn list_budgets(client: &AzureClient) -> AzureResult<Vec<Budget>> {
    let api = &client.config().api_version_cost;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Consumption/budgets?api-version={}",
        api
    ))?;
    debug!("list_budgets → {}", url);
    client.get_all_pages(&url).await
}

pub async fn get_budget(
    client: &AzureClient,
    budget_name: &str,
) -> AzureResult<Budget> {
    let api = &client.config().api_version_cost;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Consumption/budgets/{}?api-version={}",
        budget_name, api
    ))?;
    debug!("get_budget({}) → {}", budget_name, url);
    client.get_json(&url).await
}

pub async fn delete_budget(
    client: &AzureClient,
    budget_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_cost;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Consumption/budgets/{}?api-version={}",
        budget_name, api
    ))?;
    debug!("delete_budget({}) → {}", budget_name, url);
    client.delete(&url).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_detail_deserialize() {
        let json = r#"{"id":"x","name":"ud1","properties":{"billingPeriodId":"bp1","usageStart":"2024-01-01","usageEnd":"2024-01-31","instanceName":"vm1","pretaxCost":42.5,"currency":"USD","meterId":"m1","meterName":"Standard_B2s"}}"#;
        let ud: UsageDetail = serde_json::from_str(json).unwrap();
        assert_eq!(ud.name, "ud1");
    }

    #[test]
    fn budget_deserialize() {
        let json = r#"{"id":"x","name":"monthly","properties":{"amount":1000.0,"timeGrain":"Monthly","timePeriod":{"startDate":"2024-01-01","endDate":"2024-12-31"},"currentSpend":{"amount":250.0,"unit":"USD"}}}"#;
        let b: Budget = serde_json::from_str(json).unwrap();
        assert_eq!(b.name, "monthly");
        let p = b.properties.unwrap();
        assert_eq!(p.amount, Some(1000.0));
        let cs = p.current_spend.unwrap();
        assert_eq!(cs.amount, Some(250.0));
    }
}
