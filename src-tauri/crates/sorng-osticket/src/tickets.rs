// ── sorng-osticket/src/tickets.rs ──────────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct TicketManager;

impl TicketManager {
    pub async fn list(
        client: &OsticketClient,
        page: Option<u32>,
        limit: Option<u32>,
    ) -> OsticketResult<TicketSearchResponse> {
        let mut params = Vec::new();
        if let Some(p) = page {
            params.push(("page".into(), p.to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit".into(), l.to_string()));
        }
        client.get_with_params("/tickets", &params).await
    }

    pub async fn search(
        client: &OsticketClient,
        req: &TicketSearchRequest,
    ) -> OsticketResult<TicketSearchResponse> {
        let mut params = Vec::new();
        if let Some(ref s) = req.status {
            params.push(("status".into(), s.clone()));
        }
        if let Some(d) = req.dept_id {
            params.push(("dept_id".into(), d.to_string()));
        }
        if let Some(t) = req.topic_id {
            params.push(("topic_id".into(), t.to_string()));
        }
        if let Some(s) = req.staff_id {
            params.push(("staff_id".into(), s.to_string()));
        }
        if let Some(t) = req.team_id {
            params.push(("team_id".into(), t.to_string()));
        }
        if let Some(u) = req.user_id {
            params.push(("user_id".into(), u.to_string()));
        }
        if let Some(ref q) = req.query {
            params.push(("query".into(), q.clone()));
        }
        if let Some(o) = req.is_overdue {
            params.push(("is_overdue".into(), o.to_string()));
        }
        if let Some(p) = req.page {
            params.push(("page".into(), p.to_string()));
        }
        if let Some(l) = req.limit {
            params.push(("limit".into(), l.to_string()));
        }
        if let Some(ref s) = req.sort_by {
            params.push(("sort_by".into(), s.clone()));
        }
        if let Some(ref s) = req.sort_order {
            params.push(("sort_order".into(), s.clone()));
        }
        client.get_with_params("/tickets", &params).await
    }

    pub async fn get(client: &OsticketClient, ticket_id: i64) -> OsticketResult<OsticketTicket> {
        client.get(&format!("/tickets/{}", ticket_id)).await
    }

    pub async fn create(
        client: &OsticketClient,
        req: &CreateTicketRequest,
    ) -> OsticketResult<OsticketTicket> {
        client.post("/tickets", req).await
    }

    pub async fn update(
        client: &OsticketClient,
        ticket_id: i64,
        req: &UpdateTicketRequest,
    ) -> OsticketResult<OsticketTicket> {
        client.patch(&format!("/tickets/{}", ticket_id), req).await
    }

    pub async fn delete(client: &OsticketClient, ticket_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/tickets/{}", ticket_id)).await
    }

    pub async fn close(client: &OsticketClient, ticket_id: i64) -> OsticketResult<OsticketTicket> {
        let body = serde_json::json!({ "status_id": 3 }); // 3 = closed in default osTicket
        client
            .patch(&format!("/tickets/{}", ticket_id), &body)
            .await
    }

    pub async fn reopen(client: &OsticketClient, ticket_id: i64) -> OsticketResult<OsticketTicket> {
        let body = serde_json::json!({ "status_id": 1 }); // 1 = open
        client
            .patch(&format!("/tickets/{}", ticket_id), &body)
            .await
    }

    pub async fn assign(
        client: &OsticketClient,
        ticket_id: i64,
        staff_id: Option<i64>,
        team_id: Option<i64>,
    ) -> OsticketResult<OsticketTicket> {
        let mut body = serde_json::Map::new();
        if let Some(s) = staff_id {
            body.insert("staff_id".into(), serde_json::json!(s));
        }
        if let Some(t) = team_id {
            body.insert("team_id".into(), serde_json::json!(t));
        }
        client
            .patch(
                &format!("/tickets/{}", ticket_id),
                &serde_json::Value::Object(body),
            )
            .await
    }

    pub async fn post_reply(
        client: &OsticketClient,
        ticket_id: i64,
        req: &PostThreadRequest,
    ) -> OsticketResult<TicketThread> {
        client
            .post(&format!("/tickets/{}/reply", ticket_id), req)
            .await
    }

    pub async fn post_note(
        client: &OsticketClient,
        ticket_id: i64,
        req: &PostThreadRequest,
    ) -> OsticketResult<TicketThread> {
        client
            .post(&format!("/tickets/{}/notes", ticket_id), req)
            .await
    }

    pub async fn get_threads(
        client: &OsticketClient,
        ticket_id: i64,
    ) -> OsticketResult<Vec<TicketThread>> {
        client.get(&format!("/tickets/{}/threads", ticket_id)).await
    }

    pub async fn add_collaborator(
        client: &OsticketClient,
        ticket_id: i64,
        user_id: i64,
        email: Option<&str>,
    ) -> OsticketResult<TicketCollaborator> {
        let mut body = serde_json::Map::new();
        body.insert("user_id".into(), serde_json::json!(user_id));
        if let Some(e) = email {
            body.insert("email".into(), serde_json::json!(e));
        }
        client
            .post(
                &format!("/tickets/{}/collaborators", ticket_id),
                &serde_json::Value::Object(body),
            )
            .await
    }

    pub async fn get_collaborators(
        client: &OsticketClient,
        ticket_id: i64,
    ) -> OsticketResult<Vec<TicketCollaborator>> {
        client
            .get(&format!("/tickets/{}/collaborators", ticket_id))
            .await
    }

    pub async fn remove_collaborator(
        client: &OsticketClient,
        ticket_id: i64,
        user_id: i64,
    ) -> OsticketResult<()> {
        client
            .delete(&format!("/tickets/{}/collaborators/{}", ticket_id, user_id))
            .await
    }

    pub async fn transfer(
        client: &OsticketClient,
        ticket_id: i64,
        dept_id: i64,
    ) -> OsticketResult<OsticketTicket> {
        let body = serde_json::json!({ "dept_id": dept_id });
        client
            .patch(&format!("/tickets/{}", ticket_id), &body)
            .await
    }

    pub async fn merge(
        client: &OsticketClient,
        ticket_id: i64,
        merge_ids: &[i64],
    ) -> OsticketResult<OsticketTicket> {
        let body = serde_json::json!({ "ids": merge_ids });
        client
            .post(&format!("/tickets/{}/merge", ticket_id), &body)
            .await
    }
}
