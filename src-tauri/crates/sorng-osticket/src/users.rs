// ── sorng-osticket/src/users.rs ────────────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct OsticketUserManager;

impl OsticketUserManager {
    pub async fn list(
        client: &OsticketClient,
        page: Option<u32>,
        limit: Option<u32>,
    ) -> OsticketResult<Vec<OsticketUser>> {
        let mut params = Vec::new();
        if let Some(p) = page {
            params.push(("page".into(), p.to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit".into(), l.to_string()));
        }
        client.get_with_params("/users", &params).await
    }

    pub async fn get(client: &OsticketClient, user_id: i64) -> OsticketResult<OsticketUser> {
        client.get(&format!("/users/{}", user_id)).await
    }

    pub async fn search(
        client: &OsticketClient,
        email: Option<&str>,
        name: Option<&str>,
    ) -> OsticketResult<Vec<OsticketUser>> {
        let mut params = Vec::new();
        if let Some(e) = email {
            params.push(("email".into(), e.to_string()));
        }
        if let Some(n) = name {
            params.push(("name".into(), n.to_string()));
        }
        client.get_with_params("/users", &params).await
    }

    pub async fn create(
        client: &OsticketClient,
        req: &CreateUserRequest,
    ) -> OsticketResult<OsticketUser> {
        client.post("/users", req).await
    }

    pub async fn update(
        client: &OsticketClient,
        user_id: i64,
        req: &UpdateUserRequest,
    ) -> OsticketResult<OsticketUser> {
        client.patch(&format!("/users/{}", user_id), req).await
    }

    pub async fn delete(client: &OsticketClient, user_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/users/{}", user_id)).await
    }

    pub async fn get_tickets(
        client: &OsticketClient,
        user_id: i64,
    ) -> OsticketResult<Vec<OsticketTicket>> {
        client.get(&format!("/users/{}/tickets", user_id)).await
    }
}
