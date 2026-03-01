//! Azure SQL – Servers, databases, firewall rules.

use log::debug;
use serde_json::json;

use crate::client::AzureClient;
use crate::types::{AzureResult, SqlDatabase, SqlFirewallRule, SqlServer};

// ─── SQL Servers ────────────────────────────────────────────────────

pub async fn list_sql_servers(client: &AzureClient) -> AzureResult<Vec<SqlServer>> {
    let api = &client.config().api_version_sql;
    let url = client.subscription_url(&format!(
        "/providers/Microsoft.Sql/servers?api-version={}",
        api
    ))?;
    debug!("list_sql_servers → {}", url);
    client.get_all_pages(&url).await
}

pub async fn list_sql_servers_in_rg(
    client: &AzureClient,
    rg: &str,
) -> AzureResult<Vec<SqlServer>> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers?api-version={}",
        api
    ))?;
    debug!("list_sql_servers_in_rg({}) → {}", rg, url);
    client.get_all_pages(&url).await
}

pub async fn get_sql_server(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
) -> AzureResult<SqlServer> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}?api-version={}",
        server_name, api
    ))?;
    debug!("get_sql_server({}/{}) → {}", rg, server_name, url);
    client.get_json(&url).await
}

pub async fn delete_sql_server(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}?api-version={}",
        server_name, api
    ))?;
    debug!("delete_sql_server({}/{}) → {}", rg, server_name, url);
    client.delete(&url).await
}

// ─── SQL Databases ──────────────────────────────────────────────────

pub async fn list_databases(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
) -> AzureResult<Vec<SqlDatabase>> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/databases?api-version={}",
        server_name, api
    ))?;
    debug!("list_databases({}/{}) → {}", rg, server_name, url);
    client.get_all_pages(&url).await
}

pub async fn get_database(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
    db_name: &str,
) -> AzureResult<SqlDatabase> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/databases/{}?api-version={}",
        server_name, db_name, api
    ))?;
    debug!("get_database({}/{}/{}) → {}", rg, server_name, db_name, url);
    client.get_json(&url).await
}

pub async fn create_database(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
    db_name: &str,
    location: &str,
    sku_name: Option<&str>,
    max_size_bytes: Option<i64>,
) -> AzureResult<SqlDatabase> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/databases/{}?api-version={}",
        server_name, db_name, api
    ))?;
    let mut body = json!({ "location": location, "properties": {} });
    if let Some(sku) = sku_name {
        body["sku"] = json!({ "name": sku });
    }
    if let Some(max) = max_size_bytes {
        body["properties"]["maxSizeBytes"] = json!(max);
    }
    debug!("create_database({}/{}/{}) → {}", rg, server_name, db_name, url);
    client.put_json(&url, &body).await
}

pub async fn delete_database(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
    db_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/databases/{}?api-version={}",
        server_name, db_name, api
    ))?;
    debug!("delete_database({}/{}/{}) → {}", rg, server_name, db_name, url);
    client.delete(&url).await
}

// ─── Firewall Rules ─────────────────────────────────────────────────

pub async fn list_firewall_rules(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
) -> AzureResult<Vec<SqlFirewallRule>> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/firewallRules?api-version={}",
        server_name, api
    ))?;
    debug!("list_firewall_rules({}/{}) → {}", rg, server_name, url);
    client.get_all_pages(&url).await
}

pub async fn create_firewall_rule(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
    rule_name: &str,
    start_ip: &str,
    end_ip: &str,
) -> AzureResult<SqlFirewallRule> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/firewallRules/{}?api-version={}",
        server_name, rule_name, api
    ))?;
    let body = json!({
        "properties": {
            "startIpAddress": start_ip,
            "endIpAddress": end_ip
        }
    });
    debug!("create_firewall_rule({}/{}/{}) → {}", rg, server_name, rule_name, url);
    client.put_json(&url, &body).await
}

pub async fn delete_firewall_rule(
    client: &AzureClient,
    rg: &str,
    server_name: &str,
    rule_name: &str,
) -> AzureResult<()> {
    let api = &client.config().api_version_sql;
    let url = client.resource_group_url(rg, &format!(
        "/providers/Microsoft.Sql/servers/{}/firewallRules/{}?api-version={}",
        server_name, rule_name, api
    ))?;
    debug!("delete_firewall_rule({}/{}/{}) → {}", rg, server_name, rule_name, url);
    client.delete(&url).await
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_server_deserialize() {
        let json = r#"{"id":"x","name":"srv1","location":"eastus","properties":{"fullyQualifiedDomainName":"srv1.database.windows.net","state":"Ready","administratorLogin":"admin1","version":"12.0"}}"#;
        let s: SqlServer = serde_json::from_str(json).unwrap();
        assert_eq!(s.name, "srv1");
        let p = s.properties.unwrap();
        assert_eq!(p.fully_qualified_domain_name, Some("srv1.database.windows.net".into()));
        assert_eq!(p.state, Some("Ready".into()));
    }

    #[test]
    fn sql_database_deserialize() {
        let json = r#"{"id":"x","name":"db1","location":"eastus","properties":{"status":"Online","collation":"SQL_Latin1_General_CP1_CI_AS","maxSizeBytes":2147483648,"currentServiceObjectiveName":"S0"}}"#;
        let d: SqlDatabase = serde_json::from_str(json).unwrap();
        assert_eq!(d.name, "db1");
        let p = d.properties.unwrap();
        assert_eq!(p.status, Some("Online".into()));
        assert_eq!(p.max_size_bytes, Some(2147483648));
    }

    #[test]
    fn firewall_rule_deserialize() {
        let json = r#"{"id":"x","name":"AllowMyIP","properties":{"startIpAddress":"1.2.3.4","endIpAddress":"1.2.3.4"}}"#;
        let r: SqlFirewallRule = serde_json::from_str(json).unwrap();
        assert_eq!(r.name, "AllowMyIP");
        let p = r.properties.unwrap();
        assert_eq!(p.start_ip_address, Some("1.2.3.4".into()));
    }

    #[test]
    fn create_database_body() {
        let mut body = serde_json::json!({"location": "eastus", "properties": {}});
        body["sku"] = serde_json::json!({"name": "S0"});
        body["properties"]["maxSizeBytes"] = serde_json::json!(2147483648_i64);
        assert_eq!(body["sku"]["name"], "S0");
    }
}
