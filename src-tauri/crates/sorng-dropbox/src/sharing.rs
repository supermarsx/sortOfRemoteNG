//! Sharing operations — shared links, folder sharing, member management.

use crate::types::*;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shared Links
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build create_shared_link_with_settings request body.
pub fn build_create_shared_link(
    path: &str,
    settings: Option<&SharedLinkSettings>,
) -> serde_json::Value {
    let mut body = serde_json::json!({ "path": path });
    if let Some(s) = settings {
        body["settings"] = serde_json::to_value(s).unwrap_or_default();
    }
    body
}

/// Build list_shared_links request body.
pub fn build_list_shared_links(
    path: Option<&str>,
    cursor: Option<&str>,
    direct_only: Option<bool>,
) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    if let Some(p) = path {
        body.insert("path".into(), serde_json::json!(p));
    }
    if let Some(c) = cursor {
        body.insert("cursor".into(), serde_json::json!(c));
    }
    if let Some(d) = direct_only {
        body.insert("direct_only".into(), serde_json::json!(d));
    }
    serde_json::Value::Object(body)
}

/// Build revoke_shared_link request body.
pub fn build_revoke_shared_link(url: &str) -> serde_json::Value {
    serde_json::json!({ "url": url })
}

/// Build modify_shared_link_settings request body.
pub fn build_modify_shared_link(
    url: &str,
    settings: &SharedLinkSettings,
    remove_expiration: bool,
) -> serde_json::Value {
    serde_json::json!({
        "url": url,
        "settings": serde_json::to_value(settings).unwrap_or_default(),
        "remove_expiration": remove_expiration,
    })
}

/// Build get_shared_link_metadata request body.
pub fn build_get_shared_link_metadata(url: &str) -> serde_json::Value {
    serde_json::json!({ "url": url })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shared Folders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build share_folder request body.
pub fn build_share_folder(
    path: &str,
    member_policy: Option<&str>,
    acl_update_policy: Option<&str>,
    shared_link_policy: Option<&str>,
    force_async: bool,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "path": path,
        "force_async": force_async,
    });
    if let Some(p) = member_policy {
        body["member_policy"] = serde_json::json!(p);
    }
    if let Some(p) = acl_update_policy {
        body["acl_update_policy"] = serde_json::json!(p);
    }
    if let Some(p) = shared_link_policy {
        body["shared_link_policy"] = serde_json::json!(p);
    }
    body
}

/// Build unshare_folder request body.
pub fn build_unshare_folder(shared_folder_id: &str, leave_a_copy: bool) -> serde_json::Value {
    serde_json::json!({
        "shared_folder_id": shared_folder_id,
        "leave_a_copy": leave_a_copy,
    })
}

/// Build list_folder_members request body.
pub fn build_list_folder_members(shared_folder_id: &str, limit: Option<u32>) -> serde_json::Value {
    let mut body = serde_json::json!({ "shared_folder_id": shared_folder_id });
    if let Some(l) = limit {
        body["limit"] = serde_json::json!(l);
    }
    body
}

/// Build list_folder_members/continue request body.
pub fn build_list_folder_members_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build add_folder_member request body.
pub fn build_add_folder_member(arg: &AddFolderMemberArg) -> serde_json::Value {
    serde_json::to_value(arg).unwrap_or_default()
}

/// Build remove_folder_member request body.
pub fn build_remove_folder_member(
    shared_folder_id: &str,
    member: &MemberSelector,
    leave_a_copy: bool,
) -> serde_json::Value {
    serde_json::json!({
        "shared_folder_id": shared_folder_id,
        "member": serde_json::to_value(member).unwrap_or_default(),
        "leave_a_copy": leave_a_copy,
    })
}

/// Build update_folder_member request body.
pub fn build_update_folder_member(
    shared_folder_id: &str,
    member: &MemberSelector,
    access_level: &AccessLevel,
) -> serde_json::Value {
    serde_json::json!({
        "shared_folder_id": shared_folder_id,
        "member": serde_json::to_value(member).unwrap_or_default(),
        "access_level": serde_json::to_value(access_level).unwrap_or_default(),
    })
}

/// Build list_shared_folders request body.
pub fn build_list_shared_folders(limit: Option<u32>) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    if let Some(l) = limit {
        body.insert("limit".into(), serde_json::json!(l));
    }
    serde_json::Value::Object(body)
}

/// Build list_shared_folders/continue request body.
pub fn build_list_shared_folders_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build mount_folder request body.
pub fn build_mount_folder(shared_folder_id: &str) -> serde_json::Value {
    serde_json::json!({ "shared_folder_id": shared_folder_id })
}

/// Build unmount_folder request body.
pub fn build_unmount_folder(shared_folder_id: &str) -> serde_json::Value {
    serde_json::json!({ "shared_folder_id": shared_folder_id })
}

/// Build transfer_folder request body.
pub fn build_transfer_folder(
    shared_folder_id: &str,
    to_dropbox_id: &str,
) -> serde_json::Value {
    serde_json::json!({
        "shared_folder_id": shared_folder_id,
        "to_dropbox_id": to_dropbox_id,
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Extract the access key from a shared link URL.
///
/// Dropbox shared links end with `?dl=0` or `?dl=1`.
/// This normalises to a raw download URL (`dl=1`).
pub fn shared_link_to_direct(url: &str) -> String {
    let clean = url.trim_end_matches("?dl=0").trim_end_matches("?dl=1");
    format!("{clean}?dl=1")
}

/// Parse a shared folder ID from its string representation.
pub fn parse_shared_folder_id(id: &str) -> Option<&str> {
    if id.starts_with("dbsfid:") || id.chars().all(|c| c.is_ascii_digit()) {
        Some(id)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_shared_link_no_settings() {
        let v = build_create_shared_link("/test.txt", None);
        assert_eq!(v["path"], "/test.txt");
        assert!(v.get("settings").is_none());
    }

    #[test]
    fn create_shared_link_with_settings() {
        let settings = SharedLinkSettings {
            requested_visibility: Some(RequestedVisibility::Public),
            link_password: None,
            expires: None,
            audience: None,
            access: None,
            allow_download: None,
        };
        let v = build_create_shared_link("/test.txt", Some(&settings));
        assert_eq!(v["path"], "/test.txt");
        assert!(v.get("settings").is_some());
    }

    #[test]
    fn list_shared_links_body() {
        let v = build_list_shared_links(Some("/dir"), None, Some(true));
        assert_eq!(v["path"], "/dir");
        assert!(v["direct_only"].as_bool().unwrap());
    }

    #[test]
    fn list_shared_links_cursor() {
        let v = build_list_shared_links(None, Some("cursor123"), None);
        assert_eq!(v["cursor"], "cursor123");
        assert!(v.get("path").is_none());
    }

    #[test]
    fn revoke_shared_link_body() {
        let v = build_revoke_shared_link("https://www.dropbox.com/s/abc123/file.txt?dl=0");
        assert!(v["url"].as_str().unwrap().contains("dropbox.com"));
    }

    #[test]
    fn modify_shared_link_body() {
        let settings = SharedLinkSettings {
            requested_visibility: Some(RequestedVisibility::TeamOnly),
            link_password: None,
            expires: None,
            audience: None,
            access: None,
            allow_download: None,
        };
        let v = build_modify_shared_link("https://example.com/link", &settings, true);
        assert!(v["remove_expiration"].as_bool().unwrap());
    }

    #[test]
    fn share_folder_body() {
        let v = build_share_folder("/shared", Some("anyone"), None, Some("anyone"), false);
        assert_eq!(v["path"], "/shared");
        assert_eq!(v["member_policy"], "anyone");
    }

    #[test]
    fn unshare_folder_body() {
        let v = build_unshare_folder("sf123", true);
        assert_eq!(v["shared_folder_id"], "sf123");
        assert!(v["leave_a_copy"].as_bool().unwrap());
    }

    #[test]
    fn list_folder_members_body() {
        let v = build_list_folder_members("sf123", Some(50));
        assert_eq!(v["shared_folder_id"], "sf123");
        assert_eq!(v["limit"], 50);
    }

    #[test]
    fn remove_folder_member_body() {
        let member = MemberSelector::Email("user@example.com".into());
        let v = build_remove_folder_member("sf123", &member, false);
        assert_eq!(v["shared_folder_id"], "sf123");
    }

    #[test]
    fn shared_link_to_direct_test() {
        let url = "https://www.dropbox.com/s/abc/file.txt?dl=0";
        let direct = shared_link_to_direct(url);
        assert!(direct.ends_with("?dl=1"));
        assert!(!direct.contains("dl=0"));
    }

    #[test]
    fn parse_shared_folder_id_valid() {
        assert_eq!(parse_shared_folder_id("12345"), Some("12345"));
        assert_eq!(parse_shared_folder_id("dbsfid:abc"), Some("dbsfid:abc"));
    }

    #[test]
    fn parse_shared_folder_id_invalid() {
        assert_eq!(parse_shared_folder_id("not-valid-id"), None);
    }

    #[test]
    fn list_shared_folders_body() {
        let v = build_list_shared_folders(Some(25));
        assert_eq!(v["limit"], 25);
    }

    #[test]
    fn mount_unmount_body() {
        let v = build_mount_folder("sf_abc");
        assert_eq!(v["shared_folder_id"], "sf_abc");
        let v2 = build_unmount_folder("sf_abc");
        assert_eq!(v2["shared_folder_id"], "sf_abc");
    }

    #[test]
    fn transfer_folder_body() {
        let v = build_transfer_folder("sf_abc", "dbid:AAH_newowner");
        assert_eq!(v["to_dropbox_id"], "dbid:AAH_newowner");
    }
}
