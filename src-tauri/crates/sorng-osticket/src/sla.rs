// ── sorng-osticket/src/sla.rs ──────────────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct SlaManager;

impl SlaManager {
    pub async fn list(client: &OsticketClient) -> OsticketResult<Vec<OsticketSla>> {
        client.get("/sla").await
    }

    pub async fn get(client: &OsticketClient, sla_id: i64) -> OsticketResult<OsticketSla> {
        client.get(&format!("/sla/{}", sla_id)).await
    }

    pub async fn create(
        client: &OsticketClient,
        req: &CreateSlaRequest,
    ) -> OsticketResult<OsticketSla> {
        client.post("/sla", req).await
    }

    pub async fn update(
        client: &OsticketClient,
        sla_id: i64,
        req: &UpdateSlaRequest,
    ) -> OsticketResult<OsticketSla> {
        client.patch(&format!("/sla/{}", sla_id), req).await
    }

    pub async fn delete(client: &OsticketClient, sla_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/sla/{}", sla_id)).await
    }
}
