// ── sorng-freeipa/src/rbac.rs ─────────────────────────────────────────────────
//! Role-Based Access Control management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct RbacManager;

impl RbacManager {
    // ── Roles ────────────────────────────────────────────────────

    pub async fn list_roles(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaRole>> {
        let result = client
            .rpc::<Vec<IpaRole>>("role_find", vec![], serde_json::json!({"version": "2.251", "sizelimit": 0}))
            .await?;
        Ok(result.result)
    }

    pub async fn get_role(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<IpaRole> {
        let result = client
            .rpc::<IpaRole>(
                "role_show",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_role(client: &FreeIpaClient, req: &CreateRoleRequest) -> FreeIpaResult<IpaRole> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(ref d) = req.description {
            opts.as_object_mut().unwrap().insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaRole>("role_add", vec![serde_json::json!(req.cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_role(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("role_del", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }

    pub async fn add_role_member(
        client: &FreeIpaClient,
        cn: &str,
        member_type: &str,
        member: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "role_add_member",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", member_type: [member]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_role_member(
        client: &FreeIpaClient,
        cn: &str,
        member_type: &str,
        member: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "role_remove_member",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", member_type: [member]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_role_privilege(client: &FreeIpaClient, cn: &str, privilege: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "role_add_privilege",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "privilege": [privilege]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_role_privilege(client: &FreeIpaClient, cn: &str, privilege: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "role_remove_privilege",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "privilege": [privilege]}),
            )
            .await?;
        Ok(result.result)
    }

    // ── Privileges ───────────────────────────────────────────────

    pub async fn list_privileges(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaPrivilege>> {
        let result = client
            .rpc::<Vec<IpaPrivilege>>("privilege_find", vec![], serde_json::json!({"version": "2.251", "sizelimit": 0}))
            .await?;
        Ok(result.result)
    }

    pub async fn get_privilege(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<IpaPrivilege> {
        let result = client
            .rpc::<IpaPrivilege>(
                "privilege_show",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_privilege(client: &FreeIpaClient, cn: &str, description: Option<&str>) -> FreeIpaResult<IpaPrivilege> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut().unwrap().insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaPrivilege>("privilege_add", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_privilege(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("privilege_del", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }

    pub async fn add_privilege_permission(client: &FreeIpaClient, cn: &str, permission: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "privilege_add_permission",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "permission": [permission]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_privilege_permission(client: &FreeIpaClient, cn: &str, permission: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "privilege_remove_permission",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "permission": [permission]}),
            )
            .await?;
        Ok(result.result)
    }

    // ── Permissions ──────────────────────────────────────────────

    pub async fn list_permissions(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaPermission>> {
        let result = client
            .rpc::<Vec<IpaPermission>>("permission_find", vec![], serde_json::json!({"version": "2.251", "sizelimit": 0}))
            .await?;
        Ok(result.result)
    }

    pub async fn get_permission(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<IpaPermission> {
        let result = client
            .rpc::<IpaPermission>(
                "permission_show",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_permission(client: &FreeIpaClient, cn: &str, description: Option<&str>) -> FreeIpaResult<IpaPermission> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut().unwrap().insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaPermission>("permission_add", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_permission(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("permission_del", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }
}
