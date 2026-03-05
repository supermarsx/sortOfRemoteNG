//! Shared folders management — list, create, edit, permissions.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct SharesManager;

impl SharesManager {
    /// List all shared folders.
    pub async fn list(client: &SynoClient) -> SynologyResult<Vec<SharedFolder>> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client.api_call(
            "SYNO.Core.Share",
            v,
            "list",
            &[
                ("additional", "[\"volume_status\",\"encryption\",\"hidden\",\"recyclebin\"]"),
                ("offset", "0"),
                ("limit", "1000"),
            ],
        )
        .await
    }

    /// Get details of a specific shared folder.
    pub async fn get(client: &SynoClient, name: &str) -> SynologyResult<SharedFolder> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Share", v, "get", &[("name", name)]).await
    }

    /// Create a new shared folder.
    pub async fn create(
        client: &SynoClient,
        name: &str,
        vol_path: &str,
        desc: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client.api_post_void(
            "SYNO.Core.Share",
            v,
            "create",
            &[
                ("name", name),
                ("vol_path", vol_path),
                ("desc", desc),
            ],
        )
        .await
    }

    /// Delete a shared folder.
    pub async fn delete(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.Share", v, "delete", &[("name", name)]).await
    }

    /// Get permissions for a shared folder.
    pub async fn get_permissions(
        client: &SynoClient,
        name: &str,
    ) -> SynologyResult<Vec<SharePermission>> {
        let v = client.best_version("SYNO.Core.Share.Permission", 1).unwrap_or(1);
        client.api_call(
            "SYNO.Core.Share.Permission",
            v,
            "list",
            &[("name", name)],
        )
        .await
    }

    /// Set permission on a shared folder for a user.
    pub async fn set_permission(
        client: &SynoClient,
        share_name: &str,
        user_or_group: &str,
        is_group: bool,
        permission: &str,  // "RW", "RO", "NA"
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Share.Permission", 1).unwrap_or(1);
        let group_flag = if is_group { "true" } else { "false" };
        client.api_post_void(
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
        client.api_post_void(
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
        client.api_post_void("SYNO.Core.Share", v, "unmount", &[("name", name)]).await
    }
}
