//! User and group management — CRUD, quotas.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct UsersManager;

impl UsersManager {
    /// List all local users.
    pub async fn list_users(client: &SynoClient) -> SynologyResult<Vec<SynoUser>> {
        let v = client.best_version("SYNO.Core.User", 1).unwrap_or(1);
        client.api_call(
            "SYNO.Core.User",
            v,
            "list",
            &[
                ("offset", "0"),
                ("limit", "500"),
                ("additional", "[\"email\",\"description\",\"expired\"]"),
            ],
        )
        .await
    }

    /// Get a specific user by name.
    pub async fn get_user(client: &SynoClient, name: &str) -> SynologyResult<SynoUser> {
        let v = client.best_version("SYNO.Core.User", 1).unwrap_or(1);
        client.api_call("SYNO.Core.User", v, "get", &[("name", name)]).await
    }

    /// Create a new user.
    pub async fn create_user(
        client: &SynoClient,
        params: &CreateUserParams,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.User", 1).unwrap_or(1);
        let mut p: Vec<(&str, String)> = vec![
            ("name", params.name.clone()),
            ("password", params.password.clone()),
        ];
        if let Some(ref desc) = params.description {
            p.push(("description", desc.clone()));
        }
        if let Some(ref email) = params.email {
            p.push(("email", email.clone()));
        }
        if let Some(ref expire) = params.expired {
            p.push(("expired", expire.clone()));
        }
        if params.cannot_change_password {
            p.push(("cannot_chg_passwd", "true".to_string()));
        }

        let refs: Vec<(&str, &str)> = p.iter().map(|(k, v)| (*k, v.as_str())).collect();
        client.api_post_void("SYNO.Core.User", v, "create", &refs).await
    }

    /// Delete a user.
    pub async fn delete_user(client: &SynoClient, name: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.User", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.User", v, "delete", &[("name", name)]).await
    }

    /// Enable or disable a user.
    pub async fn set_user_enabled(
        client: &SynoClient,
        name: &str,
        enabled: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.User", 1).unwrap_or(1);
        let en = if enabled { "false" } else { "true" }; // expired = !enabled
        client.api_post_void("SYNO.Core.User", v, "set", &[("name", name), ("expired", en)]).await
    }

    /// Change a user's password.
    pub async fn change_password(
        client: &SynoClient,
        name: &str,
        new_password: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.User", 1).unwrap_or(1);
        client.api_post_void(
            "SYNO.Core.User",
            v,
            "set",
            &[("name", name), ("password", new_password)],
        )
        .await
    }

    /// List all groups.
    pub async fn list_groups(client: &SynoClient) -> SynologyResult<Vec<SynoGroup>> {
        let v = client.best_version("SYNO.Core.Group", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Group", v, "list", &[("offset", "0"), ("limit", "500")]).await
    }

    /// Get members of a group.
    pub async fn get_group_members(
        client: &SynoClient,
        name: &str,
    ) -> SynologyResult<Vec<SynoUser>> {
        let v = client.best_version("SYNO.Core.Group.Member", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Group.Member", v, "list", &[("group", name)]).await
    }

    /// Get user quota information.
    pub async fn get_quota(client: &SynoClient, name: &str) -> SynologyResult<Vec<UserQuota>> {
        let v = client.best_version("SYNO.Core.Quota", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Quota", v, "get", &[("name", name)]).await
    }

    /// Set user quota on a volume.
    pub async fn set_quota(
        client: &SynoClient,
        name: &str,
        volume: &str,
        quota_mb: u64,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Quota", 1).unwrap_or(1);
        let q = quota_mb.to_string();
        client.api_post_void(
            "SYNO.Core.Quota",
            v,
            "set",
            &[("name", name), ("volume", volume), ("quota", &q)],
        )
        .await
    }
}
