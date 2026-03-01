//! Google Drive comments and replies management.

use crate::client::GDriveClient;
use crate::types::{
    CommentList, DriveComment, DriveReply, GDriveResult, ReplyList,
};

// ──────────────────────────────────────────────────────────────────
//  Comments
// ──────────────────────────────────────────────────────────────────

/// List comments on a file.
pub async fn list_comments(
    client: &GDriveClient,
    file_id: &str,
    page_size: Option<u32>,
    page_token: Option<&str>,
    include_deleted: bool,
) -> GDriveResult<CommentList> {
    let url = GDriveClient::api_url(&format!("files/{}/comments", file_id));
    let mut query: Vec<(&str, String)> = vec![
        ("fields", "nextPageToken,comments(id,htmlContent,content,createdTime,modifiedTime,author,deleted,resolved,anchor,replies(id,content,htmlContent,createdTime,modifiedTime,author,deleted,action))".into()),
        ("includeDeleted", include_deleted.to_string()),
    ];
    if let Some(ps) = page_size {
        query.push(("pageSize", ps.to_string()));
    }
    if let Some(pt) = page_token {
        query.push(("pageToken", pt.to_string()));
    }
    client.get_json_with_query(&url, &query).await
}

/// List all comments on a file.
pub async fn list_all_comments(
    client: &GDriveClient,
    file_id: &str,
    include_deleted: bool,
) -> GDriveResult<Vec<DriveComment>> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let page = list_comments(
            client,
            file_id,
            Some(100),
            page_token.as_deref(),
            include_deleted,
        )
        .await?;
        all.extend(page.comments);
        match page.next_page_token {
            Some(token) => page_token = Some(token),
            None => break,
        }
    }

    Ok(all)
}

/// Get a specific comment.
pub async fn get_comment(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
) -> GDriveResult<DriveComment> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/comments/{}",
        file_id, comment_id
    ));
    let query = [("fields", "id,htmlContent,content,createdTime,modifiedTime,author,deleted,resolved,anchor,replies(id,content,htmlContent,createdTime,modifiedTime,author,deleted,action)")];
    client.get_json_with_query(&url, &query).await
}

/// Create a comment on a file.
pub async fn create_comment(
    client: &GDriveClient,
    file_id: &str,
    content: &str,
    anchor: Option<&str>,
) -> GDriveResult<DriveComment> {
    let url = format!(
        "{}?fields=id,htmlContent,content,createdTime,modifiedTime,author,deleted,resolved,anchor",
        GDriveClient::api_url(&format!("files/{}/comments", file_id))
    );

    let mut body = serde_json::Map::new();
    body.insert(
        "content".into(),
        serde_json::Value::String(content.into()),
    );
    if let Some(a) = anchor {
        body.insert("anchor".into(), serde_json::Value::String(a.into()));
    }

    client
        .post_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Update a comment's content.
pub async fn update_comment(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
    content: &str,
) -> GDriveResult<DriveComment> {
    let url = format!(
        "{}?fields=id,htmlContent,content,createdTime,modifiedTime,author,deleted,resolved,anchor",
        GDriveClient::api_url(&format!(
            "files/{}/comments/{}",
            file_id, comment_id
        ))
    );

    let mut body = serde_json::Map::new();
    body.insert(
        "content".into(),
        serde_json::Value::String(content.into()),
    );

    client
        .patch_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Delete a comment.
pub async fn delete_comment(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
) -> GDriveResult<()> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/comments/{}",
        file_id, comment_id
    ));
    client.delete(&url).await
}

/// Resolve a comment by adding a reply with action "resolve".
pub async fn resolve_comment(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
) -> GDriveResult<DriveReply> {
    let url = format!(
        "{}?fields=id,content,htmlContent,createdTime,modifiedTime,author,deleted,action",
        GDriveClient::api_url(&format!(
            "files/{}/comments/{}/replies",
            file_id, comment_id
        ))
    );

    let mut body = serde_json::Map::new();
    body.insert(
        "content".into(),
        serde_json::Value::String("Resolved".into()),
    );
    body.insert(
        "action".into(),
        serde_json::Value::String("resolve".into()),
    );

    client
        .post_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Reopen a resolved comment by adding a reply with action "reopen".
pub async fn reopen_comment(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
) -> GDriveResult<DriveReply> {
    let url = format!(
        "{}?fields=id,content,htmlContent,createdTime,modifiedTime,author,deleted,action",
        GDriveClient::api_url(&format!(
            "files/{}/comments/{}/replies",
            file_id, comment_id
        ))
    );

    let mut body = serde_json::Map::new();
    body.insert(
        "content".into(),
        serde_json::Value::String("Reopened".into()),
    );
    body.insert(
        "action".into(),
        serde_json::Value::String("reopen".into()),
    );

    client
        .post_json(&url, &serde_json::Value::Object(body))
        .await
}

// ──────────────────────────────────────────────────────────────────
//  Replies
// ──────────────────────────────────────────────────────────────────

/// List replies to a comment.
pub async fn list_replies(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
    page_size: Option<u32>,
    page_token: Option<&str>,
) -> GDriveResult<ReplyList> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/comments/{}/replies",
        file_id, comment_id
    ));
    let mut query: Vec<(&str, String)> = vec![
        ("fields", "nextPageToken,replies(id,content,htmlContent,createdTime,modifiedTime,author,deleted,action)".into()),
    ];
    if let Some(ps) = page_size {
        query.push(("pageSize", ps.to_string()));
    }
    if let Some(pt) = page_token {
        query.push(("pageToken", pt.to_string()));
    }
    client.get_json_with_query(&url, &query).await
}

/// Create a reply to a comment.
pub async fn create_reply(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
    content: &str,
) -> GDriveResult<DriveReply> {
    let url = format!(
        "{}?fields=id,content,htmlContent,createdTime,modifiedTime,author,deleted,action",
        GDriveClient::api_url(&format!(
            "files/{}/comments/{}/replies",
            file_id, comment_id
        ))
    );

    let mut body = serde_json::Map::new();
    body.insert(
        "content".into(),
        serde_json::Value::String(content.into()),
    );

    client
        .post_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Update a reply.
pub async fn update_reply(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
    reply_id: &str,
    content: &str,
) -> GDriveResult<DriveReply> {
    let url = format!(
        "{}?fields=id,content,htmlContent,createdTime,modifiedTime,author,deleted,action",
        GDriveClient::api_url(&format!(
            "files/{}/comments/{}/replies/{}",
            file_id, comment_id, reply_id
        ))
    );

    let mut body = serde_json::Map::new();
    body.insert(
        "content".into(),
        serde_json::Value::String(content.into()),
    );

    client
        .patch_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Delete a reply.
pub async fn delete_reply(
    client: &GDriveClient,
    file_id: &str,
    comment_id: &str,
    reply_id: &str,
) -> GDriveResult<()> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/comments/{}/replies/{}",
        file_id, comment_id, reply_id
    ));
    client.delete(&url).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_list_url() {
        let url = GDriveClient::api_url("files/f1/comments");
        assert!(url.ends_with("/files/f1/comments"));
    }

    #[test]
    fn comment_item_url() {
        let url = GDriveClient::api_url("files/f1/comments/c1");
        assert!(url.ends_with("/files/f1/comments/c1"));
    }

    #[test]
    fn reply_list_url() {
        let url = GDriveClient::api_url("files/f1/comments/c1/replies");
        assert!(url.ends_with("/comments/c1/replies"));
    }

    #[test]
    fn reply_item_url() {
        let url = GDriveClient::api_url("files/f1/comments/c1/replies/r1");
        assert!(url.ends_with("/replies/r1"));
    }

    #[test]
    fn create_comment_body() {
        let mut body = serde_json::Map::new();
        body.insert("content".into(), serde_json::Value::String("Nice!".into()));
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("Nice!"));
    }

    #[test]
    fn resolve_body() {
        let mut body = serde_json::Map::new();
        body.insert(
            "content".into(),
            serde_json::Value::String("Resolved".into()),
        );
        body.insert(
            "action".into(),
            serde_json::Value::String("resolve".into()),
        );
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("resolve"));
    }
}
