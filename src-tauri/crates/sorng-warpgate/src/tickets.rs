// ── sorng-warpgate/src/tickets.rs ───────────────────────────────────────────
//! Warpgate access ticket/token management.

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct TicketManager;

impl TicketManager {
    /// GET /tickets
    pub async fn list(client: &WarpgateClient) -> WarpgateResult<Vec<WarpgateTicket>> {
        let resp = client.get("/tickets").await?;
        let tickets: Vec<WarpgateTicket> = serde_json::from_value(resp)?;
        Ok(tickets)
    }

    /// POST /tickets
    pub async fn create(
        client: &WarpgateClient,
        req: &CreateTicketRequest,
    ) -> WarpgateResult<TicketAndSecret> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/tickets", &body).await?;
        let ticket: TicketAndSecret = serde_json::from_value(resp)?;
        Ok(ticket)
    }

    /// DELETE /tickets/:id
    pub async fn delete(client: &WarpgateClient, ticket_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/tickets/{}", ticket_id)).await?;
        Ok(())
    }
}
