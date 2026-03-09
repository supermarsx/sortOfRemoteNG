// ── sorng-jira/src/comments.rs ─────────────────────────────────────────────────
use crate::client::JiraClient;
use crate::error::JiraResult;
use crate::types::*;

pub struct CommentManager;

impl CommentManager {
    pub async fn list(
        client: &JiraClient,
        issue_id_or_key: &str,
        start_at: Option<u32>,
        max_results: Option<u32>,
    ) -> JiraResult<CommentsResponse> {
        let mut params = Vec::new();
        if let Some(s) = start_at {
            params.push(("startAt".into(), s.to_string()));
        }
        if let Some(m) = max_results {
            params.push(("maxResults".into(), m.to_string()));
        }
        client
            .get_with_params(
                &client.api_url(&format!("/issue/{}/comment", issue_id_or_key)),
                &params,
            )
            .await
    }

    pub async fn get(
        client: &JiraClient,
        issue_id_or_key: &str,
        comment_id: &str,
    ) -> JiraResult<JiraComment> {
        client
            .get(&client.api_url(&format!(
                "/issue/{}/comment/{}",
                issue_id_or_key, comment_id
            )))
            .await
    }

    pub async fn add(
        client: &JiraClient,
        issue_id_or_key: &str,
        req: &AddCommentRequest,
    ) -> JiraResult<JiraComment> {
        client
            .post(
                &client.api_url(&format!("/issue/{}/comment", issue_id_or_key)),
                req,
            )
            .await
    }

    pub async fn update(
        client: &JiraClient,
        issue_id_or_key: &str,
        comment_id: &str,
        req: &AddCommentRequest,
    ) -> JiraResult<JiraComment> {
        client
            .put(
                &client.api_url(&format!(
                    "/issue/{}/comment/{}",
                    issue_id_or_key, comment_id
                )),
                req,
            )
            .await
    }

    pub async fn delete(
        client: &JiraClient,
        issue_id_or_key: &str,
        comment_id: &str,
    ) -> JiraResult<()> {
        client
            .delete(&client.api_url(&format!(
                "/issue/{}/comment/{}",
                issue_id_or_key, comment_id
            )))
            .await
    }
}
