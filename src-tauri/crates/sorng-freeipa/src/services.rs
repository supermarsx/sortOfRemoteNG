// ── sorng-freeipa/src/services.rs ─────────────────────────────────────────────
//! Kerberos service principal management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct ServiceManager;

impl ServiceManager {
    pub async fn list_services(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaService>> {
        let result = client
            .rpc::<Vec<IpaService>>(
                "service_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_service(client: &FreeIpaClient, principal: &str) -> FreeIpaResult<IpaService> {
        let result = client
            .rpc::<IpaService>(
                "service_show",
                vec![serde_json::json!(principal)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_service(
        client: &FreeIpaClient,
        req: &CreateServiceRequest,
    ) -> FreeIpaResult<IpaService> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(v) = req.force {
            if let Some(obj) = opts.as_object_mut() {
                obj.insert("force".into(), serde_json::json!(v));
            }
        }
        let result = client
            .rpc::<IpaService>(
                "service_add",
                vec![serde_json::json!(req.krbprincipalname)],
                opts,
            )
            .await?;
        Ok(result.result)
    }

    pub async fn delete_service(client: &FreeIpaClient, principal: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "service_del",
                vec![serde_json::json!(principal)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn disable_service(client: &FreeIpaClient, principal: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "service_disable",
                vec![serde_json::json!(principal)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn add_host(
        client: &FreeIpaClient,
        principal: &str,
        host: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "service_add_host",
                vec![serde_json::json!(principal)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_host(
        client: &FreeIpaClient,
        principal: &str,
        host: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "service_remove_host",
                vec![serde_json::json!(principal)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }
}
