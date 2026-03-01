//! WhatsApp Flows management via the Cloud API.
//!
//! WhatsApp Flows allow businesses to build structured interactions
//! (forms, product catalogs, appointment scheduling, etc.) within the
//! WhatsApp chat.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::types::*;
use log::{debug, info};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Detailed flow information returned by list / get.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaFlowDetails {
    pub id: String,
    pub name: String,
    pub status: WaFlowStatus,
    pub categories: Vec<String>,
    pub validation_errors: Vec<WaFlowValidationError>,
    pub json_version: Option<String>,
    pub data_api_version: Option<String>,
    pub endpoint_uri: Option<String>,
    pub preview_url: Option<String>,
}

/// Validation error from flow JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaFlowValidationError {
    pub error: String,
    pub error_type: String,
    pub message: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub column_start: Option<u32>,
    pub column_end: Option<u32>,
}

/// WhatsApp Flows API operations.
pub struct WaFlows {
    client: CloudApiClient,
}

impl WaFlows {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Create a new flow.
    pub async fn create(
        &self,
        request: &WaCreateFlowRequest,
    ) -> WhatsAppResult<WaFlow> {
        let url = self.client.waba_url("flows");

        let mut body = json!({
            "name": request.name,
        });

        if !request.categories.is_empty() {
            body["categories"] = json!(request.categories);
        }

        if let Some(ref endpoint) = request.endpoint_uri {
            body["endpoint_uri"] = json!(endpoint);
        }

        let resp = self.client.post_json(&url, &body).await?;

        let id = resp["id"]
            .as_str()
            .ok_or_else(|| WhatsAppError::internal("No flow id in response"))?
            .to_string();

        info!("Created flow '{}' → {}", request.name, id);

        Ok(WaFlow {
            id,
            name: request.name.clone(),
            status: WaFlowStatus::Draft,
            categories: request.categories.clone(),
            validation_errors: None,
            json_version: None,
            data_api_version: None,
            endpoint_uri: request.endpoint_uri.clone(),
            preview: None,
        })
    }

    /// List all flows for the business account.
    pub async fn list(&self) -> WhatsAppResult<Vec<WaFlowDetails>> {
        let url = self.client.waba_url("flows");
        let resp = self.client.get(&url).await?;

        let flows: Vec<WaFlowDetails> = resp["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| parse_flow_details(f))
                    .collect()
            })
            .unwrap_or_default();

        debug!("Listed {} flows", flows.len());
        Ok(flows)
    }

    /// Get details of a specific flow.
    pub async fn get(&self, flow_id: &str) -> WhatsAppResult<WaFlowDetails> {
        let url = self.client.url(flow_id);
        let resp = self.client.get(&url).await?;

        parse_flow_details(&resp).ok_or_else(|| {
            WhatsAppError::internal(format!("Failed to parse flow {}", flow_id))
        })
    }

    /// Update a flow's name.
    pub async fn update_name(
        &self,
        flow_id: &str,
        name: &str,
    ) -> WhatsAppResult<()> {
        let url = self.client.url(flow_id);
        let body = json!({ "name": name });
        self.client.post_json(&url, &body).await?;
        info!("Updated flow {} name to '{}'", flow_id, name);
        Ok(())
    }

    /// Update a flow's JSON definition.
    pub async fn update_json(
        &self,
        flow_id: &str,
        flow_json: &serde_json::Value,
    ) -> WhatsAppResult<Vec<WaFlowValidationError>> {
        let url = format!("{}/assets", self.client.url(flow_id));

        let body = json!({
            "name": "flow.json",
            "asset_type": "FLOW_JSON",
            "file": flow_json.to_string(),
        });

        let resp = self.client.post_json(&url, &body).await?;

        let errors: Vec<WaFlowValidationError> = resp["validation_errors"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| parse_validation_error(e))
                    .collect()
            })
            .unwrap_or_default();

        if errors.is_empty() {
            info!("Updated flow {} JSON (no validation errors)", flow_id);
        } else {
            log::warn!(
                "Updated flow {} JSON with {} validation errors",
                flow_id,
                errors.len()
            );
        }

        Ok(errors)
    }

    /// Update a flow's endpoint URI (for data API).
    pub async fn update_endpoint(
        &self,
        flow_id: &str,
        endpoint_uri: &str,
    ) -> WhatsAppResult<()> {
        let url = self.client.url(flow_id);
        let body = json!({ "endpoint_uri": endpoint_uri });
        self.client.post_json(&url, &body).await?;
        info!("Updated flow {} endpoint to {}", flow_id, endpoint_uri);
        Ok(())
    }

    /// Publish a flow (moves from DRAFT → PUBLISHED).
    ///
    /// Published flows cannot be edited (only deprecated).
    pub async fn publish(&self, flow_id: &str) -> WhatsAppResult<()> {
        let url = format!("{}/publish", self.client.url(flow_id));
        self.client.post_json(&url, &json!({})).await?;
        info!("Published flow {}", flow_id);
        Ok(())
    }

    /// Deprecate a published flow.
    pub async fn deprecate(&self, flow_id: &str) -> WhatsAppResult<()> {
        let url = self.client.url(flow_id);
        let body = json!({ "status": "DEPRECATED" });
        self.client.post_json(&url, &body).await?;
        info!("Deprecated flow {}", flow_id);
        Ok(())
    }

    /// Delete a draft flow.
    ///
    /// Only flows in DRAFT status can be deleted.
    pub async fn delete(&self, flow_id: &str) -> WhatsAppResult<()> {
        let url = self.client.url(flow_id);
        self.client.delete(&url).await?;
        info!("Deleted flow {}", flow_id);
        Ok(())
    }

    /// Get the preview URL for a flow.
    pub async fn get_preview_url(
        &self,
        flow_id: &str,
    ) -> WhatsAppResult<Option<String>> {
        let details = self.get(flow_id).await?;
        Ok(details.preview_url)
    }

    /// Get flow assets (JSON definition) for a flow.
    pub async fn get_assets(
        &self,
        flow_id: &str,
    ) -> WhatsAppResult<serde_json::Value> {
        let url = format!("{}/assets", self.client.url(flow_id));
        self.client.get(&url).await
    }
}

fn parse_flow_details(v: &serde_json::Value) -> Option<WaFlowDetails> {
    let id = v["id"].as_str()?.to_string();
    let name = v["name"].as_str()?.to_string();

    let status = match v["status"].as_str().unwrap_or("DRAFT").to_uppercase().as_str() {
        "DRAFT" => WaFlowStatus::Draft,
        "PUBLISHED" => WaFlowStatus::Published,
        "DEPRECATED" => WaFlowStatus::Deprecated,
        "BLOCKED" => WaFlowStatus::Blocked,
        "THROTTLED" => WaFlowStatus::Throttled,
        _ => WaFlowStatus::Draft,
    };

    let categories = v["categories"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let validation_errors = v["validation_errors"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|e| parse_validation_error(e))
                .collect()
        })
        .unwrap_or_default();

    Some(WaFlowDetails {
        id,
        name,
        status,
        categories,
        validation_errors,
        json_version: v["json_version"].as_str().map(String::from),
        data_api_version: v["data_api_version"].as_str().map(String::from),
        endpoint_uri: v["endpoint_uri"].as_str().map(String::from),
        preview_url: v["preview"].as_str().map(String::from),
    })
}

fn parse_validation_error(v: &serde_json::Value) -> Option<WaFlowValidationError> {
    Some(WaFlowValidationError {
        error: v["error"].as_str().unwrap_or_default().to_string(),
        error_type: v["error_type"].as_str().unwrap_or_default().to_string(),
        message: v["message"].as_str().unwrap_or_default().to_string(),
        line_start: v["line_start"].as_u64().map(|n| n as u32),
        line_end: v["line_end"].as_u64().map(|n| n as u32),
        column_start: v["column_start"].as_u64().map(|n| n as u32),
        column_end: v["column_end"].as_u64().map(|n| n as u32),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_flow_details() {
        let json = serde_json::json!({
            "id": "flow_1",
            "name": "Test Flow",
            "status": "PUBLISHED",
            "categories": ["LEAD_GENERATION"],
            "json_version": "3.0",
            "validation_errors": []
        });

        let flow = parse_flow_details(&json).unwrap();
        assert_eq!(flow.id, "flow_1");
        assert_eq!(flow.name, "Test Flow");
        assert!(matches!(flow.status, WaFlowStatus::Published));
        assert_eq!(flow.categories, vec!["LEAD_GENERATION"]);
    }

    #[test]
    fn test_parse_flow_details_minimal() {
        let json = serde_json::json!({"id": "f1", "name": "Min"});
        let flow = parse_flow_details(&json).unwrap();
        assert_eq!(flow.id, "f1");
        assert!(matches!(flow.status, WaFlowStatus::Draft));
    }

    #[test]
    fn test_parse_validation_error() {
        let json = serde_json::json!({
            "error": "INVALID_PROPERTY",
            "error_type": "JSON_SCHEMA",
            "message": "Unknown property 'foo'",
            "line_start": 10,
            "line_end": 10,
            "column_start": 5,
            "column_end": 15
        });

        let err = parse_validation_error(&json).unwrap();
        assert_eq!(err.error, "INVALID_PROPERTY");
        assert_eq!(err.line_start, Some(10));
    }
}
