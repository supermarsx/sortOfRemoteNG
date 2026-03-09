// ── sorng-freeipa/src/groups.rs ───────────────────────────────────────────────
//! Group management operations via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct GroupManager;

impl GroupManager {
    pub async fn list_groups(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaGroup>> {
        let result = client
            .rpc::<Vec<IpaGroup>>(
                "group_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_group(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<IpaGroup> {
        let result = client
            .rpc::<IpaGroup>(
                "group_show",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_group(
        client: &FreeIpaClient,
        req: &CreateGroupRequest,
    ) -> FreeIpaResult<IpaGroup> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.description {
            map.insert("description".into(), serde_json::json!(v));
        }
        if let Some(v) = req.gidnumber {
            map.insert("gidnumber".into(), serde_json::json!(v));
        }
        if let Some(v) = req.posix {
            if !v {
                map.insert("nonposix".into(), serde_json::json!(true));
            }
        }
        if let Some(v) = req.external {
            if v {
                map.insert("external".into(), serde_json::json!(true));
            }
        }

        let result = client
            .rpc::<IpaGroup>("group_add", vec![serde_json::json!(req.cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn modify_group(
        client: &FreeIpaClient,
        cn: &str,
        description: Option<&str>,
    ) -> FreeIpaResult<IpaGroup> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut()
                .unwrap()
                .insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaGroup>("group_mod", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_group(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "group_del",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn add_member(
        client: &FreeIpaClient,
        cn: &str,
        user: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "group_add_member",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "user": [user]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_member(
        client: &FreeIpaClient,
        cn: &str,
        user: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "group_remove_member",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "user": [user]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_member_group(
        client: &FreeIpaClient,
        cn: &str,
        group: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "group_add_member",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "group": [group]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_member_group(
        client: &FreeIpaClient,
        cn: &str,
        group: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "group_remove_member",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "group": [group]}),
            )
            .await?;
        Ok(result.result)
    }
}
