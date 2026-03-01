// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · sharing
// ──────────────────────────────────────────────────────────────────────────────
// OCS Share API v1 operations:
//  • Create share (user, group, public link, email, federated, Talk, Deck)
//  • List shares
//  • Get single share
//  • Update share
//  • Delete share
//  • Builder helpers for share parameters
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::types::*;

const SHARES_API: &str = "ocs/v2.php/apps/files_sharing/api/v1/shares";

// ── Create ───────────────────────────────────────────────────────────────────

/// Create a new share.
pub async fn create_share(
    client: &NextcloudClient,
    args: &CreateShareArgs,
) -> Result<ShareInfo, String> {
    let mut form: Vec<(String, String)> = vec![
        ("path".into(), args.path.clone()),
        ("shareType".into(), args.share_type.to_string()),
    ];

    if let Some(ref sw) = args.share_with {
        form.push(("shareWith".into(), sw.clone()));
    }
    if let Some(pu) = args.public_upload {
        form.push(("publicUpload".into(), pu.to_string()));
    }
    if let Some(ref pw) = args.password {
        form.push(("password".into(), pw.clone()));
    }
    if let Some(ref exp) = args.expire_date {
        form.push(("expireDate".into(), exp.clone()));
    }
    if let Some(perms) = args.permissions {
        form.push(("permissions".into(), perms.to_string()));
    }
    if let Some(ref label) = args.label {
        form.push(("label".into(), label.clone()));
    }
    if let Some(ref note) = args.note {
        form.push(("note".into(), note.clone()));
    }
    if let Some(spt) = args.send_password_by_talk {
        form.push(("sendPasswordByTalk".into(), spt.to_string()));
    }

    let url = format!("{}?format=json", SHARES_API);
    let resp: OcsResponse<ShareInfo> = client.ocs_post(&url, &form).await?;
    Ok(resp.ocs.data)
}

/// Convenience: create a public link share.
pub fn build_public_link_share(
    path: &str,
    password: Option<&str>,
    expire_date: Option<&str>,
    permissions: Option<u32>,
    label: Option<&str>,
) -> CreateShareArgs {
    CreateShareArgs {
        path: path.to_string(),
        share_type: ShareType::PublicLink.as_i32(),
        share_with: None,
        public_upload: None,
        password: password.map(str::to_string),
        expire_date: expire_date.map(str::to_string),
        permissions,
        label: label.map(str::to_string),
        note: None,
        send_password_by_talk: None,
    }
}

/// Convenience: create a user share.
pub fn build_user_share(
    path: &str,
    share_with: &str,
    permissions: Option<u32>,
) -> CreateShareArgs {
    CreateShareArgs {
        path: path.to_string(),
        share_type: ShareType::User.as_i32(),
        share_with: Some(share_with.to_string()),
        public_upload: None,
        password: None,
        expire_date: None,
        permissions,
        label: None,
        note: None,
        send_password_by_talk: None,
    }
}

/// Convenience: create a group share.
pub fn build_group_share(
    path: &str,
    group: &str,
    permissions: Option<u32>,
) -> CreateShareArgs {
    CreateShareArgs {
        path: path.to_string(),
        share_type: ShareType::Group.as_i32(),
        share_with: Some(group.to_string()),
        public_upload: None,
        password: None,
        expire_date: None,
        permissions,
        label: None,
        note: None,
        send_password_by_talk: None,
    }
}

/// Convenience: create an email share.
pub fn build_email_share(
    path: &str,
    email: &str,
    permissions: Option<u32>,
) -> CreateShareArgs {
    CreateShareArgs {
        path: path.to_string(),
        share_type: ShareType::Email.as_i32(),
        share_with: Some(email.to_string()),
        public_upload: None,
        password: None,
        expire_date: None,
        permissions,
        label: None,
        note: None,
        send_password_by_talk: None,
    }
}

/// Convenience: create a federated cloud share.
pub fn build_federated_share(
    path: &str,
    federated_id: &str,
    permissions: Option<u32>,
) -> CreateShareArgs {
    CreateShareArgs {
        path: path.to_string(),
        share_type: ShareType::FederatedCloudShare.as_i32(),
        share_with: Some(federated_id.to_string()),
        public_upload: None,
        password: None,
        expire_date: None,
        permissions,
        label: None,
        note: None,
        send_password_by_talk: None,
    }
}

// ── List ─────────────────────────────────────────────────────────────────────

/// List all shares.
pub async fn list_shares(client: &NextcloudClient) -> Result<Vec<ShareInfo>, String> {
    let url = format!("{}?format=json", SHARES_API);
    let resp: OcsResponse<Vec<ShareInfo>> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// List shares for a specific path.
pub async fn list_shares_for_path(
    client: &NextcloudClient,
    path: &str,
    reshares: bool,
    subfiles: bool,
) -> Result<Vec<ShareInfo>, String> {
    let mut url = format!(
        "{}?format=json&path={}",
        SHARES_API,
        url::form_urlencoded::byte_serialize(path.as_bytes()).collect::<String>()
    );
    if reshares {
        url.push_str("&reshares=true");
    }
    if subfiles {
        url.push_str("&subfiles=true");
    }
    let resp: OcsResponse<Vec<ShareInfo>> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// List shares shared with the current user.
pub async fn list_shared_with_me(client: &NextcloudClient) -> Result<Vec<ShareInfo>, String> {
    let url = format!("{}?format=json&shared_with_me=true", SHARES_API);
    let resp: OcsResponse<Vec<ShareInfo>> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// List all pending (remote) shares.
pub async fn list_pending_shares(client: &NextcloudClient) -> Result<Vec<ShareInfo>, String> {
    let url = "ocs/v2.php/apps/files_sharing/api/v1/remote_shares/pending?format=json";
    let resp: OcsResponse<Vec<ShareInfo>> = client.ocs_get(url).await?;
    Ok(resp.ocs.data)
}

// ── Get / Update / Delete ────────────────────────────────────────────────────

/// Get a single share by ID.
pub async fn get_share(
    client: &NextcloudClient,
    share_id: &str,
) -> Result<ShareInfo, String> {
    let url = format!("{}/{}?format=json", SHARES_API, share_id);
    // OCS wraps single shares in an array
    let resp: OcsResponse<Vec<ShareInfo>> = client.ocs_get(&url).await?;
    resp.ocs
        .data
        .into_iter()
        .next()
        .ok_or_else(|| format!("share {} not found", share_id))
}

/// Update an existing share.
pub async fn update_share(
    client: &NextcloudClient,
    args: &UpdateShareArgs,
) -> Result<ShareInfo, String> {
    let url = format!("{}/{}?format=json", SHARES_API, args.share_id);

    let mut form: Vec<(String, String)> = Vec::new();
    if let Some(p) = args.permissions {
        form.push(("permissions".into(), p.to_string()));
    }
    if let Some(ref pw) = args.password {
        form.push(("password".into(), pw.clone()));
    }
    if let Some(ref exp) = args.expire_date {
        form.push(("expireDate".into(), exp.clone()));
    }
    if let Some(ref note) = args.note {
        form.push(("note".into(), note.clone()));
    }
    if let Some(ref label) = args.label {
        form.push(("label".into(), label.clone()));
    }
    if let Some(pu) = args.public_upload {
        form.push(("publicUpload".into(), pu.to_string()));
    }
    if let Some(hd) = args.hide_download {
        form.push(("hideDownload".into(), hd.to_string()));
    }

    let resp: OcsResponse<ShareInfo> = client.ocs_put(&url, &form).await?;
    Ok(resp.ocs.data)
}

/// Delete a share.
pub async fn delete_share(
    client: &NextcloudClient,
    share_id: &str,
) -> Result<(), String> {
    let url = format!("{}/{}?format=json", SHARES_API, share_id);
    let _: OcsResponse<serde_json::Value> = client.ocs_delete(&url).await?;
    Ok(())
}

// ── Accept / Decline remote shares ──────────────────────────────────────────

/// Accept a pending remote share.
pub async fn accept_remote_share(
    client: &NextcloudClient,
    share_id: &str,
) -> Result<(), String> {
    let url = format!(
        "ocs/v2.php/apps/files_sharing/api/v1/remote_shares/pending/{}?format=json",
        share_id
    );
    let _: OcsResponse<serde_json::Value> = client.ocs_post(&url, &[]).await?;
    Ok(())
}

/// Decline a pending remote share.
pub async fn decline_remote_share(
    client: &NextcloudClient,
    share_id: &str,
) -> Result<(), String> {
    let url = format!(
        "ocs/v2.php/apps/files_sharing/api/v1/remote_shares/pending/{}?format=json",
        share_id
    );
    let _: OcsResponse<serde_json::Value> = client.ocs_delete(&url).await?;
    Ok(())
}

// ── Share URL helpers ────────────────────────────────────────────────────────

/// Build the public share URL from a token.
pub fn share_url(base_url: &str, token: &str) -> String {
    format!("{}/s/{}", base_url.trim_end_matches('/'), token)
}

/// Build the direct download URL for a public share.
pub fn share_download_url(base_url: &str, token: &str) -> String {
    format!("{}/s/{}/download", base_url.trim_end_matches('/'), token)
}

/// Build the share URL with a specific path within a shared folder.
pub fn share_path_url(base_url: &str, token: &str, path: &str) -> String {
    let encoded = url::form_urlencoded::byte_serialize(path.as_bytes()).collect::<String>();
    format!(
        "{}/s/{}?path={}",
        base_url.trim_end_matches('/'),
        token,
        encoded
    )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_public_link_share_basic() {
        let args = build_public_link_share("/Documents/report.pdf", Some("secret"), None, None, Some("Report"));
        assert_eq!(args.share_type, 3);
        assert_eq!(args.password.as_deref(), Some("secret"));
        assert_eq!(args.label.as_deref(), Some("Report"));
        assert!(args.share_with.is_none());
    }

    #[test]
    fn build_user_share_basic() {
        let args = build_user_share("/file.txt", "bob", Some(SharePermissions::ALL));
        assert_eq!(args.share_type, 0);
        assert_eq!(args.share_with.as_deref(), Some("bob"));
        assert_eq!(args.permissions, Some(31));
    }

    #[test]
    fn build_group_share_basic() {
        let args = build_group_share("/shared", "developers", None);
        assert_eq!(args.share_type, 1);
        assert_eq!(args.share_with.as_deref(), Some("developers"));
    }

    #[test]
    fn build_email_share_basic() {
        let args = build_email_share("/doc.pdf", "user@example.com", Some(1));
        assert_eq!(args.share_type, 4);
        assert_eq!(args.share_with.as_deref(), Some("user@example.com"));
    }

    #[test]
    fn build_federated_share_basic() {
        let args = build_federated_share("/file.txt", "user@remote.cloud", None);
        assert_eq!(args.share_type, 6);
    }

    #[test]
    fn share_url_format() {
        assert_eq!(
            share_url("https://nc.test", "abc123"),
            "https://nc.test/s/abc123"
        );
    }

    #[test]
    fn share_url_strips_trailing_slash() {
        assert_eq!(
            share_url("https://nc.test/", "tok"),
            "https://nc.test/s/tok"
        );
    }

    #[test]
    fn share_download_url_format() {
        assert_eq!(
            share_download_url("https://nc.test", "abc"),
            "https://nc.test/s/abc/download"
        );
    }

    #[test]
    fn share_path_url_format() {
        let url = share_path_url("https://nc.test", "tok", "/sub/file.txt");
        assert!(url.contains("/s/tok"));
        assert!(url.contains("path="));
    }
}
