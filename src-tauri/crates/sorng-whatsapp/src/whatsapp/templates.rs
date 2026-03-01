//! WhatsApp message template management via the Cloud API.
//!
//! Create, list, get, and delete message templates for the WhatsApp
//! Business Account (WABA).

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::types::*;
use log::{debug, info};
use serde_json::json;

/// Template management operations.
pub struct WaTemplates {
    client: CloudApiClient,
}

impl WaTemplates {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Create a new message template.
    ///
    /// Templates must be approved by Meta before they can be sent.
    pub async fn create(
        &self,
        request: &WaCreateTemplateRequest,
    ) -> WhatsAppResult<WaTemplateInfo> {
        let url = self.client.waba_url("message_templates");

        let mut body = json!({
            "name": request.name,
            "language": request.language,
            "category": format!("{:?}", request.category).to_uppercase(),
        });

        if !request.components.is_empty() {
            body["components"] = serde_json::to_value(&request.components)
                .map_err(|e| WhatsAppError::internal(format!("Serialize components: {}", e)))?;
        }

        let resp = self.client.post_json(&url, &body).await?;

        let id = resp["id"].as_str().unwrap_or_default().to_string();
        let status_str = resp["status"].as_str().unwrap_or("PENDING");

        info!("Created template '{}' → {}", request.name, id);

        Ok(WaTemplateInfo {
            id,
            name: request.name.clone(),
            language: request.language.clone(),
            status: parse_template_status(status_str),
            category: request.category.clone(),
            components: request.components.clone(),
            rejected_reason: None,
            quality_score: None,
        })
    }

    /// List all templates for the business account.
    ///
    /// Supports pagination via `limit` and `after` cursor.
    pub async fn list(
        &self,
        limit: Option<u32>,
        after: Option<&str>,
    ) -> WhatsAppResult<WaPaginatedResponse<WaTemplateInfo>> {
        let url = self.client.waba_url("message_templates");

        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(l) = limit {
            params.push(("limit", l.to_string()));
        }
        let after_owned;
        if let Some(a) = after {
            after_owned = a.to_string();
            params.push(("after", after_owned));
        }

        let param_refs: Vec<(&str, &str)> = params
            .iter()
            .map(|(k, v)| (*k, v.as_str()))
            .collect();

        let resp = if param_refs.is_empty() {
            self.client.get(&url).await?
        } else {
            self.client.get_with_params(&url, &param_refs).await?
        };

        let data: Vec<WaTemplateInfo> = resp["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| parse_template_from_json(v))
                    .collect()
            })
            .unwrap_or_default();

        let next_cursor = resp["paging"]["cursors"]["after"]
            .as_str()
            .map(String::from);
        let next_url = resp["paging"]["next"]
            .as_str()
            .map(String::from);
        let prev_url = resp["paging"]["previous"]
            .as_str()
            .map(String::from);

        debug!("Listed {} templates", data.len());

        Ok(WaPaginatedResponse {
            data,
            paging: if next_cursor.is_some() || next_url.is_some() || prev_url.is_some() {
                Some(WaPaging {
                    cursors: next_cursor.as_ref().map(|after| WaCursors {
                        after: after.clone(),
                        before: resp["paging"]["cursors"]["before"]
                            .as_str()
                            .unwrap_or_default()
                            .to_string(),
                    }),
                    next: next_url,
                    previous: prev_url,
                })
            } else {
                None
            },
        })
    }

    /// Get all templates (auto-paginate).
    pub async fn list_all(&self) -> WhatsAppResult<Vec<WaTemplateInfo>> {
        let mut all = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let page = self
                .list(Some(100), cursor.as_deref())
                .await?;
            all.extend(page.data);

            match page.paging {
                Some(ref p) => match p.cursors {
                    Some(ref c) if !c.after.is_empty() => cursor = Some(c.after.clone()),
                    _ => break,
                },
                None => break,
            }
        }

        info!("Fetched {} total templates", all.len());
        Ok(all)
    }

    /// Get a single template by ID.
    pub async fn get(&self, template_id: &str) -> WhatsAppResult<WaTemplateInfo> {
        let url = self.client.url(template_id);
        let resp = self.client.get(&url).await?;

        parse_template_from_json(&resp).ok_or_else(|| {
            WhatsAppError::internal(format!("Failed to parse template {}", template_id))
        })
    }

    /// Delete a template by name.
    ///
    /// Note: The API deletes by name, not by ID. All templates with
    /// this name across all languages will be deleted.
    pub async fn delete(&self, template_name: &str) -> WhatsAppResult<()> {
        let url = self.client.waba_url("message_templates");
        let full = format!("{}?name={}", url, template_name);
        self.client.delete(&full).await?;
        info!("Deleted template '{}'", template_name);
        Ok(())
    }

    /// Delete a specific template by name and HSM ID.
    pub async fn delete_specific(
        &self,
        template_name: &str,
        hsm_id: &str,
    ) -> WhatsAppResult<()> {
        let url = self.client.waba_url("message_templates");
        let full = format!("{}?name={}&hsm_id={}", url, template_name, hsm_id);
        self.client.delete(&full).await?;
        info!("Deleted template '{}' (hsm_id={})", template_name, hsm_id);
        Ok(())
    }

    /// List templates filtered by status.
    pub async fn list_by_status(
        &self,
        status: WaTemplateStatus,
    ) -> WhatsAppResult<Vec<WaTemplateInfo>> {
        let all = self.list_all().await?;
        Ok(all
            .into_iter()
            .filter(|t| t.status == status)
            .collect())
    }

    /// List templates filtered by category.
    pub async fn list_by_category(
        &self,
        category: WaTemplateCategory,
    ) -> WhatsAppResult<Vec<WaTemplateInfo>> {
        let all = self.list_all().await?;
        Ok(all
            .into_iter()
            .filter(|t| t.category == category)
            .collect())
    }
}

/// Parse template status string into the enum.
fn parse_template_status(s: &str) -> WaTemplateStatus {
    match s.to_uppercase().as_str() {
        "APPROVED" => WaTemplateStatus::Approved,
        "PENDING" => WaTemplateStatus::Pending,
        "REJECTED" => WaTemplateStatus::Rejected,
        "DISABLED" => WaTemplateStatus::Disabled,
        "PAUSED" => WaTemplateStatus::Paused,
        _ => WaTemplateStatus::Pending,
    }
}

/// Parse a template JSON object.
fn parse_template_from_json(v: &serde_json::Value) -> Option<WaTemplateInfo> {
    let id = v["id"].as_str()?.to_string();
    let name = v["name"].as_str()?.to_string();
    let language = v["language"].as_str().unwrap_or("en_US").to_string();
    let status = parse_template_status(v["status"].as_str().unwrap_or("PENDING"));

    let category = match v["category"].as_str().unwrap_or("").to_uppercase().as_str() {
        "AUTHENTICATION" => WaTemplateCategory::Authentication,
        "MARKETING" => WaTemplateCategory::Marketing,
        "UTILITY" => WaTemplateCategory::Utility,
        _ => WaTemplateCategory::Utility,
    };

    let components = v["components"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| serde_json::from_value(c.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Some(WaTemplateInfo {
        id,
        name,
        language,
        status,
        category,
        components,
        rejected_reason: v["rejected_reason"].as_str().map(String::from),
        quality_score: v["quality_score"].as_object().map(|_| WaQualityScore {
            score: v["quality_score"]["score"].as_str().unwrap_or_default().to_string(),
            date: v["quality_score"]["date"].as_i64(),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_template_status() {
        assert_eq!(parse_template_status("APPROVED"), WaTemplateStatus::Approved);
        assert_eq!(parse_template_status("rejected"), WaTemplateStatus::Rejected);
        assert_eq!(parse_template_status("unknown"), WaTemplateStatus::Pending);
    }

    #[test]
    fn test_parse_template_from_json() {
        let json = serde_json::json!({
            "id": "tmpl_1",
            "name": "hello_world",
            "language": "en_US",
            "status": "APPROVED",
            "category": "UTILITY",
            "components": []
        });

        let t = parse_template_from_json(&json).unwrap();
        assert_eq!(t.id, "tmpl_1");
        assert_eq!(t.name, "hello_world");
        assert_eq!(t.status, WaTemplateStatus::Approved);
        assert_eq!(t.category, WaTemplateCategory::Utility);
    }

    #[test]
    fn test_parse_template_missing_fields() {
        let json = serde_json::json!({});
        assert!(parse_template_from_json(&json).is_none());
    }
}
