// ── sorng-osticket/src/custom_fields.rs ────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct CustomFieldManager;

impl CustomFieldManager {
    pub async fn list_forms(client: &OsticketClient) -> OsticketResult<Vec<OsticketForm>> {
        client.get("/forms").await
    }

    pub async fn get_form(client: &OsticketClient, form_id: i64) -> OsticketResult<OsticketForm> {
        client.get(&format!("/forms/{}", form_id)).await
    }

    pub async fn list_fields(client: &OsticketClient, form_id: i64) -> OsticketResult<Vec<OsticketCustomField>> {
        client.get(&format!("/forms/{}/fields", form_id)).await
    }

    pub async fn get_field(client: &OsticketClient, field_id: i64) -> OsticketResult<OsticketCustomField> {
        client.get(&format!("/fields/{}", field_id)).await
    }

    pub async fn create_field(client: &OsticketClient, req: &CreateCustomFieldRequest) -> OsticketResult<OsticketCustomField> {
        client.post("/fields", req).await
    }

    pub async fn update_field(client: &OsticketClient, field_id: i64, req: &UpdateCustomFieldRequest) -> OsticketResult<OsticketCustomField> {
        client.patch(&format!("/fields/{}", field_id), req).await
    }

    pub async fn delete_field(client: &OsticketClient, field_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/fields/{}", field_id)).await
    }
}
