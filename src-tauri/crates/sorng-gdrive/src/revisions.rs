//! File revision management for Google Drive.

use crate::client::GDriveClient;
use crate::types::{DriveRevision, GDriveResult, RevisionList};

/// List revisions of a file.
pub async fn list_revisions(
    client: &GDriveClient,
    file_id: &str,
    page_size: Option<u32>,
    page_token: Option<&str>,
) -> GDriveResult<RevisionList> {
    let url = GDriveClient::api_url(&format!("files/{}/revisions", file_id));
    let mut query: Vec<(&str, String)> = vec![
        ("fields", "nextPageToken,revisions(id,mimeType,modifiedTime,size,keepForever,md5Checksum,originalFilename,lastModifyingUser,publishAuto,published,publishedOutsideDomain)".into()),
    ];
    if let Some(ps) = page_size {
        query.push(("pageSize", ps.to_string()));
    }
    if let Some(pt) = page_token {
        query.push(("pageToken", pt.to_string()));
    }
    client.get_json_with_query(&url, &query).await
}

/// List all revisions of a file.
pub async fn list_all_revisions(
    client: &GDriveClient,
    file_id: &str,
) -> GDriveResult<Vec<DriveRevision>> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let page =
            list_revisions(client, file_id, Some(200), page_token.as_deref()).await?;
        all.extend(page.revisions);
        match page.next_page_token {
            Some(token) => page_token = Some(token),
            None => break,
        }
    }

    Ok(all)
}

/// Get a specific revision.
pub async fn get_revision(
    client: &GDriveClient,
    file_id: &str,
    revision_id: &str,
) -> GDriveResult<DriveRevision> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/revisions/{}",
        file_id, revision_id
    ));
    let query = [("fields", "id,mimeType,modifiedTime,size,keepForever,md5Checksum,originalFilename,lastModifyingUser,publishAuto,published,publishedOutsideDomain")];
    client.get_json_with_query(&url, &query).await
}

/// Update revision metadata (e.g. keepForever, publish settings).
pub async fn update_revision(
    client: &GDriveClient,
    file_id: &str,
    revision_id: &str,
    keep_forever: Option<bool>,
    publish_auto: Option<bool>,
    published: Option<bool>,
) -> GDriveResult<DriveRevision> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/revisions/{}",
        file_id, revision_id
    ));

    let mut body = serde_json::Map::new();
    if let Some(kf) = keep_forever {
        body.insert("keepForever".into(), serde_json::Value::Bool(kf));
    }
    if let Some(pa) = publish_auto {
        body.insert("publishAuto".into(), serde_json::Value::Bool(pa));
    }
    if let Some(p) = published {
        body.insert("published".into(), serde_json::Value::Bool(p));
    }

    client
        .patch_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Delete a specific revision.
pub async fn delete_revision(
    client: &GDriveClient,
    file_id: &str,
    revision_id: &str,
) -> GDriveResult<()> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/revisions/{}",
        file_id, revision_id
    ));
    client.delete(&url).await
}

/// Download a specific revision's content.
pub async fn download_revision(
    client: &GDriveClient,
    file_id: &str,
    revision_id: &str,
) -> GDriveResult<Vec<u8>> {
    let url = format!(
        "{}?alt=media",
        GDriveClient::api_url(&format!(
            "files/{}/revisions/{}",
            file_id, revision_id
        ))
    );
    client.get_bytes(&url).await
}

/// Pin a revision (set keepForever=true).
pub async fn pin_revision(
    client: &GDriveClient,
    file_id: &str,
    revision_id: &str,
) -> GDriveResult<DriveRevision> {
    update_revision(client, file_id, revision_id, Some(true), None, None).await
}

/// Unpin a revision (set keepForever=false).
pub async fn unpin_revision(
    client: &GDriveClient,
    file_id: &str,
    revision_id: &str,
) -> GDriveResult<DriveRevision> {
    update_revision(client, file_id, revision_id, Some(false), None, None).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_list_url() {
        let url = GDriveClient::api_url("files/f1/revisions");
        assert!(url.ends_with("/files/f1/revisions"));
    }

    #[test]
    fn revision_item_url() {
        let url = GDriveClient::api_url("files/f1/revisions/r1");
        assert!(url.ends_with("/files/f1/revisions/r1"));
    }

    #[test]
    fn update_body_construction() {
        let mut body = serde_json::Map::new();
        body.insert("keepForever".into(), serde_json::Value::Bool(true));
        body.insert("published".into(), serde_json::Value::Bool(false));
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("keepForever"));
        assert!(json.contains("true"));
    }

    #[test]
    fn download_revision_url() {
        let url = format!(
            "{}?alt=media",
            GDriveClient::api_url("files/f1/revisions/r1")
        );
        assert!(url.contains("alt=media"));
        assert!(url.contains("revisions/r1"));
    }
}
