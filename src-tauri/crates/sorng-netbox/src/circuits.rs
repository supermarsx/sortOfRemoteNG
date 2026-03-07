// ── sorng-netbox – Circuits module ───────────────────────────────────────────
//! Circuits, providers, circuit types, terminations.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct CircuitManager;

impl CircuitManager {
    // ── Circuits ─────────────────────────────────────────────────────

    pub async fn list_circuits(client: &NetboxClient) -> NetboxResult<Vec<Circuit>> {
        client.api_get_list("/circuits/circuits/").await
    }

    pub async fn get_circuit(client: &NetboxClient, id: i64) -> NetboxResult<Circuit> {
        let body = client.api_get(&format!("/circuits/circuits/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_circuit: {e}")))
    }

    pub async fn create_circuit(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Circuit> {
        let body = client.api_post("/circuits/circuits/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_circuit: {e}")))
    }

    pub async fn update_circuit(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Circuit> {
        let body = client.api_patch(&format!("/circuits/circuits/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_circuit: {e}")))
    }

    pub async fn delete_circuit(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/circuits/circuits/{id}/")).await?;
        Ok(())
    }

    // ── Providers ────────────────────────────────────────────────────

    pub async fn list_providers(client: &NetboxClient) -> NetboxResult<Vec<Provider>> {
        client.api_get_list("/circuits/providers/").await
    }

    pub async fn get_provider(client: &NetboxClient, id: i64) -> NetboxResult<Provider> {
        let body = client.api_get(&format!("/circuits/providers/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_provider: {e}")))
    }

    pub async fn create_provider(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Provider> {
        let body = client.api_post("/circuits/providers/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_provider: {e}")))
    }

    pub async fn update_provider(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Provider> {
        let body = client.api_patch(&format!("/circuits/providers/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_provider: {e}")))
    }

    pub async fn delete_provider(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/circuits/providers/{id}/")).await?;
        Ok(())
    }

    // ── Circuit types ────────────────────────────────────────────────

    pub async fn list_circuit_types(client: &NetboxClient) -> NetboxResult<Vec<CircuitType>> {
        client.api_get_list("/circuits/circuit-types/").await
    }

    // ── Circuit terminations ─────────────────────────────────────────

    pub async fn list_circuit_terminations(client: &NetboxClient) -> NetboxResult<Vec<CircuitTermination>> {
        client.api_get_list("/circuits/circuit-terminations/").await
    }
}
