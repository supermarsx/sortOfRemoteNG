// ── sorng-etcd/src/auth.rs ───────────────────────────────────────────────────
//! Authentication and authorization management via the etcd v3 gRPC-gateway.

use crate::client::EtcdClient;
use crate::error::EtcdResult;
use crate::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

// ── Wire types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct UserAddRequest {
    name: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct UserDeleteRequest {
    name: String,
}

#[derive(Debug, Serialize)]
struct UserGetRequest {
    name: String,
}

#[derive(Debug, Deserialize)]
struct UserGetResponseWire {
    #[serde(default)]
    roles: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct UserListResponseWire {
    #[serde(default)]
    users: Vec<String>,
}

#[derive(Debug, Serialize)]
struct UserChangePasswordRequest {
    name: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct UserGrantRoleRequest {
    user: String,
    role: String,
}

#[derive(Debug, Serialize)]
struct UserRevokeRoleRequest {
    name: String,
    role: String,
}

#[derive(Debug, Serialize)]
struct RoleAddRequest {
    name: String,
}

#[derive(Debug, Serialize)]
struct RoleDeleteRequest {
    role: String,
}

#[derive(Debug, Serialize)]
struct RoleGetRequest {
    role: String,
}

#[derive(Debug, Deserialize)]
struct RoleGetResponseWire {
    #[serde(default)]
    perm: Vec<PermWire>,
}

#[derive(Debug, Deserialize)]
struct PermWire {
    #[serde(rename = "permType", default)]
    perm_type: Option<String>,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    range_end: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RoleListResponseWire {
    #[serde(default)]
    roles: Vec<String>,
}

#[derive(Debug, Serialize)]
struct RoleGrantPermissionRequest {
    name: String,
    perm: PermGrantWire,
}

#[derive(Debug, Serialize)]
struct PermGrantWire {
    #[serde(rename = "permType")]
    perm_type: i32,
    key: String,
    range_end: String,
}

#[derive(Debug, Serialize)]
struct RoleRevokePermissionRequest {
    role: String,
    key: String,
    range_end: String,
}

#[derive(Debug, Deserialize)]
struct AuthStatusResponseWire {
    #[serde(rename = "authRevision", default)]
    auth_revision: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn decode_b64(s: &Option<String>) -> String {
    s.as_deref()
        .and_then(|v| B64.decode(v).ok())
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default()
}

fn encode_key(s: &str) -> String {
    B64.encode(s.as_bytes())
}

fn perm_type_to_i32(t: &str) -> i32 {
    match t.to_uppercase().as_str() {
        "READWRITE" | "READ_WRITE" => 2,
        "WRITE" => 1,
        _ => 0, // READ
    }
}

fn perm_type_from_wire(s: &Option<String>) -> String {
    match s.as_deref() {
        Some("READWRITE") | Some("2") => "READWRITE".to_string(),
        Some("WRITE") | Some("1") => "WRITE".to_string(),
        _ => "READ".to_string(),
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

pub struct AuthManager;

impl AuthManager {
    // ── Auth toggle ──────────────────────────────────────────────────

    pub async fn auth_enable(client: &EtcdClient) -> EtcdResult<()> {
        let _: serde_json::Value = client.post_empty("/v3/auth/enable").await?;
        Ok(())
    }

    pub async fn auth_disable(client: &EtcdClient) -> EtcdResult<()> {
        let _: serde_json::Value = client.post_empty("/v3/auth/disable").await?;
        Ok(())
    }

    pub async fn auth_status(client: &EtcdClient) -> EtcdResult<bool> {
        let resp: AuthStatusResponseWire =
            client.post_empty("/v3/auth/status").await?;
        Ok(resp.enabled.unwrap_or(false))
    }

    // ── Users ────────────────────────────────────────────────────────

    pub async fn user_add(
        client: &EtcdClient,
        name: &str,
        password: &str,
    ) -> EtcdResult<()> {
        let req = UserAddRequest {
            name: name.to_string(),
            password: password.to_string(),
        };
        let _: serde_json::Value = client.post_json("/v3/auth/user/add", &req).await?;
        Ok(())
    }

    pub async fn user_delete(client: &EtcdClient, name: &str) -> EtcdResult<()> {
        let req = UserDeleteRequest {
            name: name.to_string(),
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/user/delete", &req).await?;
        Ok(())
    }

    pub async fn user_list(client: &EtcdClient) -> EtcdResult<Vec<EtcdUser>> {
        let resp: UserListResponseWire =
            client.post_empty("/v3/auth/user/list").await?;
        let mut users = Vec::new();
        for name in &resp.users {
            match Self::user_get(client, name).await {
                Ok(u) => users.push(u),
                Err(_) => users.push(EtcdUser {
                    name: name.clone(),
                    roles: Vec::new(),
                }),
            }
        }
        Ok(users)
    }

    pub async fn user_get(client: &EtcdClient, name: &str) -> EtcdResult<EtcdUser> {
        let req = UserGetRequest {
            name: name.to_string(),
        };
        let resp: UserGetResponseWire =
            client.post_json("/v3/auth/user/get", &req).await?;
        Ok(EtcdUser {
            name: name.to_string(),
            roles: resp.roles,
        })
    }

    pub async fn user_change_password(
        client: &EtcdClient,
        name: &str,
        password: &str,
    ) -> EtcdResult<()> {
        let req = UserChangePasswordRequest {
            name: name.to_string(),
            password: password.to_string(),
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/user/changepw", &req).await?;
        Ok(())
    }

    pub async fn user_grant_role(
        client: &EtcdClient,
        user: &str,
        role: &str,
    ) -> EtcdResult<()> {
        let req = UserGrantRoleRequest {
            user: user.to_string(),
            role: role.to_string(),
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/user/grant", &req).await?;
        Ok(())
    }

    pub async fn user_revoke_role(
        client: &EtcdClient,
        user: &str,
        role: &str,
    ) -> EtcdResult<()> {
        let req = UserRevokeRoleRequest {
            name: user.to_string(),
            role: role.to_string(),
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/user/revoke", &req).await?;
        Ok(())
    }

    // ── Roles ────────────────────────────────────────────────────────

    pub async fn role_add(client: &EtcdClient, name: &str) -> EtcdResult<()> {
        let req = RoleAddRequest {
            name: name.to_string(),
        };
        let _: serde_json::Value = client.post_json("/v3/auth/role/add", &req).await?;
        Ok(())
    }

    pub async fn role_delete(client: &EtcdClient, name: &str) -> EtcdResult<()> {
        let req = RoleDeleteRequest {
            role: name.to_string(),
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/role/delete", &req).await?;
        Ok(())
    }

    pub async fn role_list(client: &EtcdClient) -> EtcdResult<Vec<EtcdRole>> {
        let resp: RoleListResponseWire =
            client.post_empty("/v3/auth/role/list").await?;
        let mut roles = Vec::new();
        for name in &resp.roles {
            match Self::role_get(client, name).await {
                Ok(r) => roles.push(r),
                Err(_) => roles.push(EtcdRole {
                    name: name.clone(),
                    permissions: Vec::new(),
                }),
            }
        }
        Ok(roles)
    }

    pub async fn role_get(client: &EtcdClient, name: &str) -> EtcdResult<EtcdRole> {
        let req = RoleGetRequest {
            role: name.to_string(),
        };
        let resp: RoleGetResponseWire =
            client.post_json("/v3/auth/role/get", &req).await?;
        Ok(EtcdRole {
            name: name.to_string(),
            permissions: resp
                .perm
                .iter()
                .map(|p| EtcdPermission {
                    permission_type: perm_type_from_wire(&p.perm_type),
                    key: decode_b64(&p.key),
                    range_end: decode_b64(&p.range_end),
                })
                .collect(),
        })
    }

    pub async fn role_grant_permission(
        client: &EtcdClient,
        name: &str,
        permission: &EtcdPermission,
    ) -> EtcdResult<()> {
        let req = RoleGrantPermissionRequest {
            name: name.to_string(),
            perm: PermGrantWire {
                perm_type: perm_type_to_i32(&permission.permission_type),
                key: encode_key(&permission.key),
                range_end: encode_key(&permission.range_end),
            },
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/role/grant", &req).await?;
        Ok(())
    }

    pub async fn role_revoke_permission(
        client: &EtcdClient,
        name: &str,
        key: &str,
        range_end: &str,
    ) -> EtcdResult<()> {
        let req = RoleRevokePermissionRequest {
            role: name.to_string(),
            key: encode_key(key),
            range_end: encode_key(range_end),
        };
        let _: serde_json::Value =
            client.post_json("/v3/auth/role/revoke", &req).await?;
        Ok(())
    }
}
