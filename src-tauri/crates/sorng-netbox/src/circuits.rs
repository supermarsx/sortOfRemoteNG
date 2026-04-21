// ── sorng-netbox/src/circuits.rs ─────────────────────────────────────────────
//! Circuit management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct CircuitManager;

impl CircuitManager {
    // ── Circuits ──────────────────────────────────────────────────────

    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Circuit>> {
        client.api_get_paginated("circuits/circuits", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Circuit> {
        client.api_get(&format!("circuits/circuits/{id}")).await
    }

    pub async fn create(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Circuit> {
        client.api_post("circuits/circuits", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Circuit> {
        client
            .api_put(&format!("circuits/circuits/{id}"), data)
            .await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("circuits/circuits/{id}")).await
    }

    // ── Providers ────────────────────────────────────────────────────

    pub async fn list_providers(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<CircuitProvider>> {
        client.api_get_paginated("circuits/providers", &[]).await
    }

    pub async fn get_provider(client: &NetboxClient, id: i64) -> NetboxResult<CircuitProvider> {
        client.api_get(&format!("circuits/providers/{id}")).await
    }

    pub async fn create_provider(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<CircuitProvider> {
        client.api_post("circuits/providers", data).await
    }

    pub async fn update_provider(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<CircuitProvider> {
        client
            .api_put(&format!("circuits/providers/{id}"), data)
            .await
    }

    pub async fn delete_provider(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("circuits/providers/{id}")).await
    }

    // ── Circuit Types ────────────────────────────────────────────────

    pub async fn list_circuit_types(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<CircuitType>> {
        client
            .api_get_paginated("circuits/circuit-types", &[])
            .await
    }

    pub async fn get_circuit_type(client: &NetboxClient, id: i64) -> NetboxResult<CircuitType> {
        client
            .api_get(&format!("circuits/circuit-types/{id}"))
            .await
    }

    // ── Terminations ─────────────────────────────────────────────────

    pub async fn list_terminations(
        client: &NetboxClient,
        circuit_id: i64,
    ) -> NetboxResult<PaginatedResponse<CircuitTermination>> {
        let cid = circuit_id.to_string();
        client
            .api_get_paginated("circuits/circuit-terminations", &[("circuit_id", &cid)])
            .await
    }
}
