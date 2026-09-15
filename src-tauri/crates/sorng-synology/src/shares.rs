//! Shared folders management — list, create, edit, permissions.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire::string_param;
use serde::Deserialize;

const SHARE: &str = "SYNO.Core.Share";
const SHARE_PERMISSION: &str = "SYNO.Core.Share.Permission";

/// One `SYNO.Core.Share list` row with DSM's field names. DSM flattens the
/// requested `additional` keys into the row (`recyclebin` arrives as
/// `enable_recycle_bin`) and never sends a `path`. The camelCase aliases keep
/// the rows the pre-t84 `SharedFolder` decoder accepted.
#[derive(Deserialize)]
struct ShareWire {
    name: String,
    #[serde(default, alias = "volPath")]
    vol_path: Option<String>,
    #[serde(default)]
    desc: Option<String>,
    #[serde(default, alias = "isAclmode")]
    is_aclmode: Option<bool>,
    #[serde(default, alias = "enableRecycleBin")]
    enable_recycle_bin: Option<bool>,
    #[serde(default)]
    encryption: Option<u32>,
    #[serde(default, alias = "isShareMoving")]
    is_share_moving: Option<bool>,
}

impl From<ShareWire> for SharedFolder {
    fn from(wire: ShareWire) -> Self {
        Self {
            // A share's File Station path is `/<name>`, the `path` that
            // `SYNO.FileStation.List list_share` reports; derived, not guessed.
            path: format!("/{}", wire.name),
            name: wire.name,
            vol_path: wire.vol_path,
            desc: wire.desc,
            is_aclmode: wire.is_aclmode,
            enable_recycle_bin: wire.enable_recycle_bin,
            encryption: wire.encryption,
            is_share_moving: wire.is_share_moving,
            additional: None,
        }
    }
}

pub struct SharesManager;

impl SharesManager {
    /// List all shared folders. DSM answers `{"shares":[...],"total":n}`.
    pub async fn list(client: &SynoClient) -> SynologyResult<Vec<SharedFolder>> {
        let v = client.best_version(SHARE, 1).unwrap_or(1);
        let rows: Vec<ShareWire> = client
            .api_list(
                SHARE,
                v,
                "list",
                &[
                    (
                        "additional",
                        "[\"volume_status\",\"encryption\",\"hidden\",\"recyclebin\"]",
                    ),
                    ("offset", "0"),
                    ("limit", "1000"),
                ],
                &["shares"],
            )
            .await?;
        Ok(rows.into_iter().map(SharedFolder::from).collect())
    }

    /// Get details of a specific shared folder.
    pub async fn get(client: &SynoClient, name: &str) -> SynologyResult<SharedFolder> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client
            .api_call("SYNO.Core.Share", v, "get", &[("name", name)])
            .await
    }

    /// Create a new shared folder.
    pub async fn create(
        client: &SynoClient,
        name: &str,
        vol_path: &str,
        desc: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Share",
                v,
                "create",
                &[("name", name), ("vol_path", vol_path), ("desc", desc)],
            )
            .await
    }

    /// Delete a shared folder.
    pub async fn delete(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Share", v, "delete", &[("name", name)])
            .await
    }

    /// Get permissions for a shared folder. DSM answers
    /// `{"items":[...],"total":n}` with rows that match the DTO.
    pub async fn get_permissions(
        client: &SynoClient,
        name: &str,
    ) -> SynologyResult<Vec<SharePermission>> {
        let v = client.best_version(SHARE_PERMISSION, 1).unwrap_or(1);
        // JSON-quoted under the JSON request format, as DSM's own UI sends
        // string parameters, so a share named e.g. `2024` stays a string.
        let name = string_param(client, SHARE_PERMISSION, name);
        client
            .api_list(
                SHARE_PERMISSION,
                v,
                "list",
                &[("name", name.as_str())],
                &["items"],
            )
            .await
    }

    /// Set permission on a shared folder for a user.
    pub async fn set_permission(
        client: &SynoClient,
        share_name: &str,
        user_or_group: &str,
        is_group: bool,
        permission: &str, // "RW", "RO", "NA"
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Share.Permission", 1)
            .unwrap_or(1);
        let group_flag = if is_group { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.Core.Share.Permission",
                v,
                "set",
                &[
                    ("name", share_name),
                    ("user_group", user_or_group),
                    ("is_group", group_flag),
                    ("permission", permission),
                ],
            )
            .await
    }

    /// Mount an encrypted shared folder.
    pub async fn mount_encrypted(
        client: &SynoClient,
        name: &str,
        password: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Share",
                v,
                "mount",
                &[("name", name), ("password", password)],
            )
            .await
    }

    /// Unmount an encrypted shared folder.
    pub async fn unmount_encrypted(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Share", v, "unmount", &[("name", name)])
            .await
    }
}
