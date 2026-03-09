// ── sorng-osticket/src/departments.rs ──────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct DepartmentManager;

impl DepartmentManager {
    pub async fn list(client: &OsticketClient) -> OsticketResult<Vec<OsticketDepartment>> {
        client.get("/departments").await
    }

    pub async fn get(client: &OsticketClient, dept_id: i64) -> OsticketResult<OsticketDepartment> {
        client.get(&format!("/departments/{}", dept_id)).await
    }

    pub async fn create(
        client: &OsticketClient,
        req: &CreateDepartmentRequest,
    ) -> OsticketResult<OsticketDepartment> {
        client.post("/departments", req).await
    }

    pub async fn update(
        client: &OsticketClient,
        dept_id: i64,
        req: &UpdateDepartmentRequest,
    ) -> OsticketResult<OsticketDepartment> {
        client
            .patch(&format!("/departments/{}", dept_id), req)
            .await
    }

    pub async fn delete(client: &OsticketClient, dept_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/departments/{}", dept_id)).await
    }

    pub async fn get_agents(
        client: &OsticketClient,
        dept_id: i64,
    ) -> OsticketResult<Vec<OsticketAgent>> {
        client
            .get(&format!("/departments/{}/agents", dept_id))
            .await
    }
}
