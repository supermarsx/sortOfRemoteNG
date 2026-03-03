// ── sorng-osticket/src/canned_responses.rs ────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct CannedResponseManager;

impl CannedResponseManager {
    pub async fn list(client: &OsticketClient) -> OsticketResult<Vec<OsticketCannedResponse>> {
        client.get("/canned").await
    }

    pub async fn get(client: &OsticketClient, canned_id: i64) -> OsticketResult<OsticketCannedResponse> {
        client.get(&format!("/canned/{}", canned_id)).await
    }

    pub async fn create(client: &OsticketClient, req: &CreateCannedResponseRequest) -> OsticketResult<OsticketCannedResponse> {
        client.post("/canned", req).await
    }

    pub async fn update(client: &OsticketClient, canned_id: i64, req: &UpdateCannedResponseRequest) -> OsticketResult<OsticketCannedResponse> {
        client.patch(&format!("/canned/{}", canned_id), req).await
    }

    pub async fn delete(client: &OsticketClient, canned_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/canned/{}", canned_id)).await
    }

    pub async fn search(client: &OsticketClient, query: &str) -> OsticketResult<Vec<OsticketCannedResponse>> {
        let params = vec![("query".into(), query.to_string())];
        client.get_with_params("/canned", &params).await
    }
}
