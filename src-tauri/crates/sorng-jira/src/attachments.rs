// ── sorng-jira/src/attachments.rs ──────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct AttachmentManager;

impl AttachmentManager {
    pub async fn list(
        client: &JiraClient,
        issue_id_or_key: &str,
    ) -> JiraResult<Vec<JiraAttachment>> {
        // Attachments come from the issue fields
        let issue: JiraIssue = client
            .get(&client.api_url(&format!("/issue/{}?fields=attachment", issue_id_or_key)))
            .await?;
        let attachments: Vec<JiraAttachment> = issue
            .fields
            .get("attachment")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        Ok(attachments)
    }

    pub async fn get(client: &JiraClient, attachment_id: &str) -> JiraResult<JiraAttachment> {
        client
            .get(&client.api_url(&format!("/attachment/{}", attachment_id)))
            .await
    }

    pub async fn delete(client: &JiraClient, attachment_id: &str) -> JiraResult<()> {
        client
            .delete(&client.api_url(&format!("/attachment/{}", attachment_id)))
            .await
    }

    /// Add attachment using multipart form. Takes base64-encoded file content.
    pub async fn add(
        client: &JiraClient,
        issue_id_or_key: &str,
        filename: &str,
        data_base64: &str,
    ) -> JiraResult<Vec<JiraAttachment>> {
        use reqwest::header;

        let decoded =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data_base64)
                .map_err(|e| {
                    crate::error::JiraError::validation(format!("Invalid base64: {}", e))
                })?;

        let part = reqwest::multipart::Part::bytes(decoded)
            .file_name(filename.to_string())
            .mime_str("application/octet-stream")
            .expect("valid constant MIME type");

        let form = reqwest::multipart::Form::new().part("file", part);

        let mut headers = header::HeaderMap::new();
        headers.insert(header::AUTHORIZATION, client.auth_header.clone());
        headers.insert(
            "X-Atlassian-Token",
            header::HeaderValue::from_static("no-check"),
        );
        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static("application/json"),
        );

        let resp = client
            .http
            .post(client.api_url(&format!("/issue/{}/attachments", issue_id_or_key)))
            .headers(headers)
            .multipart(form)
            .send()
            .await?;

        let status = resp.status();
        if status.is_success() {
            let text = resp.text().await?;
            Ok(serde_json::from_str(&text)?)
        } else {
            let body = resp.text().await.unwrap_or_default();
            Err(crate::error::JiraError::new(
                match status.as_u16() {
                    401 => crate::error::JiraErrorKind::AuthError,
                    403 => crate::error::JiraErrorKind::Forbidden,
                    404 => crate::error::JiraErrorKind::NotFound,
                    409 => crate::error::JiraErrorKind::Conflict,
                    429 => crate::error::JiraErrorKind::RateLimited,
                    code => crate::error::JiraErrorKind::ApiError(code),
                },
                format!("Failed to add attachment: {}", body),
            ))
        }
    }
}
