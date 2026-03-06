//! Transport map management for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct TransportManager;

impl TransportManager {
    /// List all transport maps. GET /api/v1/get/transport/all
    pub async fn list(client: &MailcowClient) -> MailcowResult<Vec<MailcowTransportMap>> {
        client.get("/get/transport/all").await
    }

    /// Get a single transport map. GET /api/v1/get/transport/{id}
    pub async fn get(client: &MailcowClient, id: i64) -> MailcowResult<MailcowTransportMap> {
        client.get(&format!("/get/transport/{id}")).await
    }

    /// Create a transport map. POST /api/v1/add/transport
    pub async fn create(
        client: &MailcowClient,
        req: &CreateTransportMapRequest,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/add/transport", req).await
    }

    /// Update a transport map. POST /api/v1/edit/transport
    pub async fn update(
        client: &MailcowClient,
        id: i64,
        req: &CreateTransportMapRequest,
    ) -> MailcowResult<serde_json::Value> {
        #[derive(serde::Serialize)]
        struct Envelope<'a> {
            items: Vec<String>,
            attr: &'a CreateTransportMapRequest,
        }
        let payload = Envelope { items: vec![id.to_string()], attr: req };
        client.post("/edit/transport", &payload).await
    }

    /// Delete a transport map. POST /api/v1/delete/transport
    pub async fn delete(
        client: &MailcowClient,
        id: i64,
    ) -> MailcowResult<serde_json::Value> {
        client.post("/delete/transport", &serde_json::json!([id.to_string()])).await
    }
}
