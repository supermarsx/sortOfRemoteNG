//! Google Shared Drives management.

use serde::Serialize;

use crate::client::GDriveClient;
use crate::types::{GDriveResult, SharedDrive, SharedDriveList};

/// List shared drives the user has access to.
pub async fn list_drives(
    client: &GDriveClient,
    page_size: Option<u32>,
    page_token: Option<&str>,
) -> GDriveResult<SharedDriveList> {
    let url = GDriveClient::api_url("drives");
    let mut query: Vec<(&str, String)> = vec![
        ("fields", "nextPageToken,drives(id,name,colorRgb,createdTime,hidden,restrictions,capabilities)".into()),
    ];
    if let Some(ps) = page_size {
        query.push(("pageSize", ps.to_string()));
    }
    if let Some(pt) = page_token {
        query.push(("pageToken", pt.to_string()));
    }
    client.get_json_with_query(&url, &query).await
}

/// List all shared drives.
pub async fn list_all_drives(client: &GDriveClient) -> GDriveResult<Vec<SharedDrive>> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let page = list_drives(client, Some(100), page_token.as_deref()).await?;
        all.extend(page.drives);
        match page.next_page_token {
            Some(token) => page_token = Some(token),
            None => break,
        }
    }

    Ok(all)
}

/// Get a specific shared drive.
pub async fn get_drive(
    client: &GDriveClient,
    drive_id: &str,
) -> GDriveResult<SharedDrive> {
    let url = GDriveClient::api_url(&format!("drives/{}", drive_id));
    let query = [("fields", "id,name,colorRgb,createdTime,hidden,restrictions,capabilities")];
    client.get_json_with_query(&url, &query).await
}

/// Create a shared drive.
pub async fn create_drive(
    client: &GDriveClient,
    name: &str,
    request_id: &str,
) -> GDriveResult<SharedDrive> {
    let url = format!(
        "{}?requestId={}",
        GDriveClient::api_url("drives"),
        url::form_urlencoded::byte_serialize(request_id.as_bytes()).collect::<String>()
    );

    #[derive(Serialize)]
    struct Body {
        name: String,
    }
    client.post_json(&url, &Body { name: name.into() }).await
}

/// Update a shared drive (name, restrictions, etc.).
pub async fn update_drive(
    client: &GDriveClient,
    drive_id: &str,
    name: Option<&str>,
    restrictions: Option<&crate::types::SharedDriveRestrictions>,
) -> GDriveResult<SharedDrive> {
    let url = GDriveClient::api_url(&format!("drives/{}", drive_id));

    let mut body = serde_json::Map::new();
    if let Some(n) = name {
        body.insert("name".into(), serde_json::Value::String(n.into()));
    }
    if let Some(r) = restrictions {
        body.insert(
            "restrictions".into(),
            serde_json::to_value(r).unwrap_or(serde_json::Value::Null),
        );
    }

    client
        .patch_json(&url, &serde_json::Value::Object(body))
        .await
}

/// Delete a shared drive (must be empty).
pub async fn delete_drive(client: &GDriveClient, drive_id: &str) -> GDriveResult<()> {
    let url = GDriveClient::api_url(&format!("drives/{}", drive_id));
    client.delete(&url).await
}

/// Hide a shared drive.
pub async fn hide_drive(
    client: &GDriveClient,
    drive_id: &str,
) -> GDriveResult<SharedDrive> {
    let url = GDriveClient::api_url(&format!("drives/{}/hide", drive_id));
    client.post_json(&url, &serde_json::Value::Object(serde_json::Map::new())).await
}

/// Unhide a shared drive.
pub async fn unhide_drive(
    client: &GDriveClient,
    drive_id: &str,
) -> GDriveResult<SharedDrive> {
    let url = GDriveClient::api_url(&format!("drives/{}/unhide", drive_id));
    client.post_json(&url, &serde_json::Value::Object(serde_json::Map::new())).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drives_list_url() {
        let url = GDriveClient::api_url("drives");
        assert!(url.ends_with("/drives"));
    }

    #[test]
    fn drive_item_url() {
        let url = GDriveClient::api_url("drives/d1");
        assert!(url.ends_with("/drives/d1"));
    }

    #[test]
    fn hide_url() {
        let url = GDriveClient::api_url("drives/d1/hide");
        assert!(url.ends_with("/drives/d1/hide"));
    }

    #[test]
    fn unhide_url() {
        let url = GDriveClient::api_url("drives/d1/unhide");
        assert!(url.ends_with("/drives/d1/unhide"));
    }

    #[test]
    fn create_body() {
        let json = serde_json::json!({"name": "Team Drive"});
        assert_eq!(json["name"], "Team Drive");
    }

    #[test]
    fn update_body_name_only() {
        let mut body = serde_json::Map::new();
        body.insert("name".into(), serde_json::Value::String("New Name".into()));
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("New Name"));
    }

    #[test]
    fn update_body_with_restrictions() {
        let r = crate::types::SharedDriveRestrictions {
            domain_users_only: true,
            ..Default::default()
        };
        let mut body = serde_json::Map::new();
        body.insert(
            "restrictions".into(),
            serde_json::to_value(&r).unwrap(),
        );
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("domainUsersOnly"));
    }
}
