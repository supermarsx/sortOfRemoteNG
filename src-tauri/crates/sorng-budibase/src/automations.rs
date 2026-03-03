// ── sorng-budibase/src/automations.rs ──────────────────────────────────────────
//! Budibase automation management & triggering.

use crate::client::BudibaseClient;
use crate::error::BudibaseResult;
use crate::types::*;

pub struct AutomationManager;

impl AutomationManager {
    pub async fn list(client: &BudibaseClient) -> BudibaseResult<Vec<BudibaseAutomation>> {
        let resp = client.get("/automations").await?;
        let automations: Vec<BudibaseAutomation> = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(serde_json::Value::Array(vec![]))
        )?;
        Ok(automations)
    }

    pub async fn get(client: &BudibaseClient, automation_id: &str) -> BudibaseResult<BudibaseAutomation> {
        let resp = client.get(&format!("/automations/{}", automation_id)).await?;
        let automation: BudibaseAutomation = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(automation)
    }

    pub async fn create(client: &BudibaseClient, req: &CreateAutomationRequest) -> BudibaseResult<BudibaseAutomation> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/automations", &body).await?;
        let automation: BudibaseAutomation = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(automation)
    }

    pub async fn update(client: &BudibaseClient, automation_id: &str, req: &BudibaseAutomation) -> BudibaseResult<BudibaseAutomation> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/automations/{}", automation_id), &body).await?;
        let automation: BudibaseAutomation = serde_json::from_value(
            resp.get("data").cloned().unwrap_or(resp.clone())
        )?;
        Ok(automation)
    }

    pub async fn delete(client: &BudibaseClient, automation_id: &str) -> BudibaseResult<()> {
        client.delete(&format!("/automations/{}", automation_id)).await?;
        Ok(())
    }

    pub async fn trigger(client: &BudibaseClient, automation_id: &str, req: &TriggerAutomationRequest) -> BudibaseResult<TriggerAutomationResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/automations/{}/trigger", automation_id), &body).await?;
        let result: TriggerAutomationResponse = serde_json::from_value(resp)?;
        Ok(result)
    }

    pub async fn get_logs(client: &BudibaseClient, req: &AutomationLogSearchRequest) -> BudibaseResult<AutomationLogSearchResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/automations/logs/search", &body).await?;
        let result: AutomationLogSearchResponse = serde_json::from_value(resp)?;
        Ok(result)
    }
}
