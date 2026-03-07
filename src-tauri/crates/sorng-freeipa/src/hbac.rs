// ── sorng-freeipa/src/hbac.rs ─────────────────────────────────────────────────
//! Host-Based Access Control management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct HbacManager;

impl HbacManager {
    // ── HBAC Rules ───────────────────────────────────────────────

    pub async fn list_hbac_rules(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaHbacRule>> {
        let result = client
            .rpc::<Vec<IpaHbacRule>>("hbacrule_find", vec![], serde_json::json!({"version": "2.251", "sizelimit": 0}))
            .await?;
        Ok(result.result)
    }

    pub async fn get_hbac_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<IpaHbacRule> {
        let result = client
            .rpc::<IpaHbacRule>(
                "hbacrule_show",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_hbac_rule(client: &FreeIpaClient, req: &CreateHbacRuleRequest) -> FreeIpaResult<IpaHbacRule> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.description { map.insert("description".into(), serde_json::json!(v)); }
        if let Some(ref v) = req.usercategory { map.insert("usercategory".into(), serde_json::json!(v)); }
        if let Some(ref v) = req.hostcategory { map.insert("hostcategory".into(), serde_json::json!(v)); }
        if let Some(ref v) = req.servicecategory { map.insert("servicecategory".into(), serde_json::json!(v)); }

        let result = client
            .rpc::<IpaHbacRule>("hbacrule_add", vec![serde_json::json!(req.cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn modify_hbac_rule(client: &FreeIpaClient, cn: &str, description: Option<&str>) -> FreeIpaResult<IpaHbacRule> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut().unwrap().insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaHbacRule>("hbacrule_mod", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_hbac_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("hbacrule_del", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }

    pub async fn enable_hbac_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("hbacrule_enable", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }

    pub async fn disable_hbac_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("hbacrule_disable", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }

    pub async fn add_hbac_user(client: &FreeIpaClient, cn: &str, user: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "hbacrule_add_user",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "user": [user]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_hbac_user(client: &FreeIpaClient, cn: &str, user: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "hbacrule_remove_user",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "user": [user]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_hbac_host(client: &FreeIpaClient, cn: &str, host: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "hbacrule_add_host",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_hbac_host(client: &FreeIpaClient, cn: &str, host: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "hbacrule_remove_host",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_hbac_service(client: &FreeIpaClient, cn: &str, service: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "hbacrule_add_service",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "hbacsvc": [service]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_hbac_service(client: &FreeIpaClient, cn: &str, service: &str) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "hbacrule_remove_service",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "hbacsvc": [service]}),
            )
            .await?;
        Ok(result.result)
    }

    // ── HBAC Services ────────────────────────────────────────────

    pub async fn list_hbac_services(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaHbacService>> {
        let result = client
            .rpc::<Vec<IpaHbacService>>("hbacsvc_find", vec![], serde_json::json!({"version": "2.251", "sizelimit": 0}))
            .await?;
        Ok(result.result)
    }

    pub async fn create_hbac_service(client: &FreeIpaClient, cn: &str, description: Option<&str>) -> FreeIpaResult<IpaHbacService> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut().unwrap().insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaHbacService>("hbacsvc_add", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_hbac_service(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("hbacsvc_del", vec![serde_json::json!(cn)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }
}
