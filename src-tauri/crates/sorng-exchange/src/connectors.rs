// ─── Exchange Integration – send / receive connectors ────────────────────────
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// On-Premises – Send Connectors
// ═══════════════════════════════════════════════════════════════════════════════

/// List send connectors.
pub async fn ps_list_send_connectors(client: &ExchangeClient) -> ExchangeResult<Vec<Connector>> {
    client.run_ps_json("Get-SendConnector").await
}

/// Get a single send connector.
pub async fn ps_get_send_connector(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Connector> {
    let cmd = format!(
        "Get-SendConnector -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Enable / disable a send connector.
pub async fn ps_set_send_connector_enabled(
    client: &ExchangeClient,
    identity: &str,
    enabled: bool,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Set-SendConnector -Identity '{}' -Enabled {}",
        identity.replace('\'', "''"),
        if enabled { "$true" } else { "$false" }
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// On-Premises – Receive Connectors
// ═══════════════════════════════════════════════════════════════════════════════

/// List receive connectors.
pub async fn ps_list_receive_connectors(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<Connector>> {
    let cmd = match server {
        Some(s) => format!("Get-ReceiveConnector -Server '{}'", s.replace('\'', "''")),
        None => "Get-ReceiveConnector".to_string(),
    };
    client.run_ps_json(&cmd).await
}

/// Get a single receive connector.
pub async fn ps_get_receive_connector(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Connector> {
    let cmd = format!(
        "Get-ReceiveConnector -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Enable / disable a receive connector.
pub async fn ps_set_receive_connector_enabled(
    client: &ExchangeClient,
    identity: &str,
    enabled: bool,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Set-ReceiveConnector -Identity '{}' -Enabled {}",
        identity.replace('\'', "''"),
        if enabled { "$true" } else { "$false" }
    );
    client.run_ps(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exchange Online – Inbound / Outbound Connectors
// ═══════════════════════════════════════════════════════════════════════════════

/// List inbound connectors (Exchange Online).
pub async fn ps_list_inbound_connectors(client: &ExchangeClient) -> ExchangeResult<Vec<Connector>> {
    client.run_ps_json("Get-InboundConnector").await
}

/// List outbound connectors (Exchange Online).
pub async fn ps_list_outbound_connectors(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<Connector>> {
    client.run_ps_json("Get-OutboundConnector").await
}

/// Get a specific inbound connector.
pub async fn ps_get_inbound_connector(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Connector> {
    let cmd = format!(
        "Get-InboundConnector -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Get a specific outbound connector.
pub async fn ps_get_outbound_connector(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<Connector> {
    let cmd = format!(
        "Get-OutboundConnector -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Enable / disable an inbound connector.
pub async fn ps_set_inbound_connector_enabled(
    client: &ExchangeClient,
    identity: &str,
    enabled: bool,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Set-InboundConnector -Identity '{}' -Enabled {}",
        identity.replace('\'', "''"),
        if enabled { "$true" } else { "$false" }
    );
    client.run_ps(&cmd).await
}

/// Enable / disable an outbound connector.
pub async fn ps_set_outbound_connector_enabled(
    client: &ExchangeClient,
    identity: &str,
    enabled: bool,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Set-OutboundConnector -Identity '{}' -Enabled {}",
        identity.replace('\'', "''"),
        if enabled { "$true" } else { "$false" }
    );
    client.run_ps(&cmd).await
}
