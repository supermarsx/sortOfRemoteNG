//! Google Drive sharing and permissions management.

use crate::client::GDriveClient;
use crate::types::{
    BatchResult, CreatePermissionRequest, DrivePermission, GDriveResult,
    PermissionList, UpdatePermissionRequest,
};

/// Create a permission on a file.
pub async fn create_permission(
    client: &GDriveClient,
    file_id: &str,
    request: &CreatePermissionRequest,
) -> GDriveResult<DrivePermission> {
    let mut url = format!(
        "{}?supportsAllDrives=true",
        GDriveClient::api_url(&format!("files/{}/permissions", file_id)),
    );

    if let Some(send) = request.send_notification_email {
        url.push_str(&format!("&sendNotificationEmail={}", send));
    }
    if let Some(ref msg) = request.email_message {
        url.push_str(&format!(
            "&emailMessage={}",
            url::form_urlencoded::byte_serialize(msg.as_bytes()).collect::<String>()
        ));
    }
    if let Some(transfer) = request.transfer_ownership {
        url.push_str(&format!("&transferOwnership={}", transfer));
    }

    client.post_json(&url, request).await
}

/// List permissions on a file.
pub async fn list_permissions(
    client: &GDriveClient,
    file_id: &str,
    page_size: Option<u32>,
    page_token: Option<&str>,
) -> GDriveResult<PermissionList> {
    let url = GDriveClient::api_url(&format!("files/{}/permissions", file_id));
    let mut query: Vec<(&str, String)> = vec![
        ("supportsAllDrives", "true".into()),
        ("fields", "nextPageToken,permissions(id,type,role,emailAddress,domain,displayName,photoLink,expirationTime,deleted,pendingOwner)".into()),
    ];
    if let Some(ps) = page_size {
        query.push(("pageSize", ps.to_string()));
    }
    if let Some(pt) = page_token {
        query.push(("pageToken", pt.to_string()));
    }
    client.get_json_with_query(&url, &query).await
}

/// List all permissions on a file (consuming all pages).
pub async fn list_all_permissions(
    client: &GDriveClient,
    file_id: &str,
) -> GDriveResult<Vec<DrivePermission>> {
    let mut all = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let page = list_permissions(
            client,
            file_id,
            Some(100),
            page_token.as_deref(),
        )
        .await?;
        all.extend(page.permissions);
        match page.next_page_token {
            Some(token) => page_token = Some(token),
            None => break,
        }
    }

    Ok(all)
}

/// Get a specific permission on a file.
pub async fn get_permission(
    client: &GDriveClient,
    file_id: &str,
    permission_id: &str,
) -> GDriveResult<DrivePermission> {
    let url = GDriveClient::api_url(&format!(
        "files/{}/permissions/{}",
        file_id, permission_id
    ));
    let query = [
        ("supportsAllDrives", "true"),
        ("fields", "id,type,role,emailAddress,domain,displayName,photoLink,expirationTime,deleted,pendingOwner"),
    ];
    client.get_json_with_query(&url, &query).await
}

/// Update a permission on a file.
pub async fn update_permission(
    client: &GDriveClient,
    file_id: &str,
    permission_id: &str,
    request: &UpdatePermissionRequest,
) -> GDriveResult<DrivePermission> {
    let url = format!(
        "{}?supportsAllDrives=true",
        GDriveClient::api_url(&format!(
            "files/{}/permissions/{}",
            file_id, permission_id
        ))
    );
    client.patch_json(&url, request).await
}

/// Delete a permission from a file.
pub async fn delete_permission(
    client: &GDriveClient,
    file_id: &str,
    permission_id: &str,
) -> GDriveResult<()> {
    let url = format!(
        "{}?supportsAllDrives=true",
        GDriveClient::api_url(&format!(
            "files/{}/permissions/{}",
            file_id, permission_id
        ))
    );
    client.delete(&url).await
}

/// Share a file with a specific user by email.
pub async fn share_with_user(
    client: &GDriveClient,
    file_id: &str,
    email: &str,
    role: crate::types::PermissionRole,
    send_notification: bool,
) -> GDriveResult<DrivePermission> {
    let request = CreatePermissionRequest {
        permission_type: crate::types::PermissionType::User,
        role,
        email_address: Some(email.to_string()),
        domain: None,
        send_notification_email: Some(send_notification),
        email_message: None,
        transfer_ownership: None,
        expiration_time: None,
    };
    create_permission(client, file_id, &request).await
}

/// Share a file with anyone (make it public).
pub async fn share_with_anyone(
    client: &GDriveClient,
    file_id: &str,
    role: crate::types::PermissionRole,
) -> GDriveResult<DrivePermission> {
    let request = CreatePermissionRequest {
        permission_type: crate::types::PermissionType::Anyone,
        role,
        email_address: None,
        domain: None,
        send_notification_email: None,
        email_message: None,
        transfer_ownership: None,
        expiration_time: None,
    };
    create_permission(client, file_id, &request).await
}

/// Share a file with a domain.
pub async fn share_with_domain(
    client: &GDriveClient,
    file_id: &str,
    domain: &str,
    role: crate::types::PermissionRole,
) -> GDriveResult<DrivePermission> {
    let request = CreatePermissionRequest {
        permission_type: crate::types::PermissionType::Domain,
        role,
        email_address: None,
        domain: Some(domain.to_string()),
        send_notification_email: None,
        email_message: None,
        transfer_ownership: None,
        expiration_time: None,
    };
    create_permission(client, file_id, &request).await
}

/// Batch-create permissions on a file.
pub async fn batch_create_permissions(
    client: &GDriveClient,
    file_id: &str,
    requests: &[CreatePermissionRequest],
) -> GDriveResult<BatchResult> {
    let mut result = BatchResult::new();

    for req in requests {
        match create_permission(client, file_id, req).await {
            Ok(_) => result.record_success(),
            Err(e) => result.record_failure(e.to_string()),
        }
    }

    Ok(result)
}

/// Remove all permissions from a file except the owner's.
pub async fn unshare_all(
    client: &GDriveClient,
    file_id: &str,
) -> GDriveResult<BatchResult> {
    let permissions = list_all_permissions(client, file_id).await?;
    let mut result = BatchResult::new();

    for perm in permissions {
        if perm.role == crate::types::PermissionRole::Owner {
            continue; // Cannot remove owner permission
        }
        match delete_permission(client, file_id, &perm.id).await {
            Ok(()) => result.record_success(),
            Err(e) => result.record_failure(e.to_string()),
        }
    }

    Ok(result)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PermissionRole, PermissionType};

    #[test]
    fn permission_url_pattern() {
        let url = GDriveClient::api_url("files/f1/permissions");
        assert!(url.contains("files/f1/permissions"));
    }

    #[test]
    fn permission_item_url() {
        let url = GDriveClient::api_url("files/f1/permissions/p1");
        assert!(url.contains("files/f1/permissions/p1"));
    }

    #[test]
    fn create_permission_request_user() {
        let req = CreatePermissionRequest {
            permission_type: PermissionType::User,
            role: PermissionRole::Writer,
            email_address: Some("user@example.com".into()),
            domain: None,
            send_notification_email: Some(true),
            email_message: Some("Check this out!".into()),
            transfer_ownership: None,
            expiration_time: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("user@example.com"));
        assert!(json.contains("writer"));
    }

    #[test]
    fn create_permission_request_anyone() {
        let req = CreatePermissionRequest {
            permission_type: PermissionType::Anyone,
            role: PermissionRole::Reader,
            email_address: None,
            domain: None,
            send_notification_email: None,
            email_message: None,
            transfer_ownership: None,
            expiration_time: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("anyone"));
        assert!(json.contains("reader"));
    }

    #[test]
    fn update_permission_request_serde() {
        let req = UpdatePermissionRequest {
            role: Some(PermissionRole::Commenter),
            expiration_time: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("commenter"));
    }

    #[test]
    fn batch_result_initial() {
        let b = BatchResult::new();
        assert_eq!(b.succeeded, 0);
        assert_eq!(b.failed, 0);
        assert!(b.errors.is_empty());
    }

    #[test]
    fn batch_result_tracking() {
        let mut b = BatchResult::new();
        b.record_success();
        b.record_failure("err1".into());
        b.record_success();
        assert_eq!(b.succeeded, 2);
        assert_eq!(b.failed, 1);
        assert_eq!(b.errors.len(), 1);
    }
}
