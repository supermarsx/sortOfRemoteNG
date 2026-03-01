//! Google Drive change tracking (polling model).

use serde::Deserialize;

use crate::client::GDriveClient;
use crate::types::{ChangeList, DriveChange, GDriveResult};

/// Get the start page token for future change polling.
pub async fn get_start_page_token(client: &GDriveClient) -> GDriveResult<String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StartPageToken {
        start_page_token: String,
    }

    let url = GDriveClient::api_url("changes/startPageToken");
    let query = [("supportsAllDrives", "true")];
    let resp: StartPageToken = client.get_json_with_query(&url, &query).await?;
    Ok(resp.start_page_token)
}

/// List changes since the given page token.
pub async fn list_changes(
    client: &GDriveClient,
    page_token: &str,
    page_size: Option<u32>,
    include_removed: bool,
    include_items_from_all_drives: bool,
) -> GDriveResult<ChangeList> {
    let url = GDriveClient::api_url("changes");
    let mut query: Vec<(&str, String)> = vec![
        ("pageToken", page_token.to_string()),
        ("fields", "nextPageToken,newStartPageToken,changes(changeType,time,removed,fileId,file(id,name,mimeType,size,parents,createdTime,modifiedTime,trashed),driveId,drive(id,name))".into()),
        ("includeRemoved", include_removed.to_string()),
    ];

    if let Some(ps) = page_size {
        query.push(("pageSize", ps.to_string()));
    }

    if include_items_from_all_drives {
        query.push(("includeItemsFromAllDrives", "true".to_string()));
        query.push(("supportsAllDrives", "true".to_string()));
    }

    client.get_json_with_query(&url, &query).await
}

/// List all changes since the page token (consuming all pages).
///
/// Returns `(changes, new_start_page_token)`.
pub async fn list_all_changes(
    client: &GDriveClient,
    start_page_token: &str,
    include_removed: bool,
    include_all_drives: bool,
) -> GDriveResult<(Vec<DriveChange>, String)> {
    let mut all_changes = Vec::new();
    let mut token = start_page_token.to_string();

    loop {
        let page = list_changes(
            client,
            &token,
            Some(1000),
            include_removed,
            include_all_drives,
        )
        .await?;
        all_changes.extend(page.changes);

        if let Some(next) = page.next_page_token {
            token = next;
        } else if let Some(new_start) = page.new_start_page_token {
            return Ok((all_changes, new_start));
        } else {
            break;
        }
    }

    Ok((all_changes, token))
}

/// Poll for changes since the last stored token.
///
/// Returns `(changes, new_token)` — store `new_token` for the next poll.
pub async fn poll_changes(
    client: &GDriveClient,
    stored_token: &str,
) -> GDriveResult<(Vec<DriveChange>, String)> {
    list_all_changes(client, stored_token, true, true).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_page_token_url() {
        let url = GDriveClient::api_url("changes/startPageToken");
        assert!(url.ends_with("/changes/startPageToken"));
    }

    #[test]
    fn changes_url() {
        let url = GDriveClient::api_url("changes");
        assert!(url.ends_with("/changes"));
    }

    #[test]
    fn start_page_token_deserialize() {
        let json = r#"{"startPageToken": "12345"}"#;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct T {
            start_page_token: String,
        }
        let t: T = serde_json::from_str(json).unwrap();
        assert_eq!(t.start_page_token, "12345");
    }

    #[test]
    fn change_list_deserialize() {
        let json = r#"{
            "changes": [],
            "nextPageToken": null,
            "newStartPageToken": "99"
        }"#;
        let cl: ChangeList = serde_json::from_str(json).unwrap();
        assert!(cl.changes.is_empty());
        assert_eq!(cl.new_start_page_token.as_deref(), Some("99"));
    }
}
