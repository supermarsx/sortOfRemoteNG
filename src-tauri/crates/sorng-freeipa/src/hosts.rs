// ── sorng-freeipa/src/hosts.rs ────────────────────────────────────────────────
//! Host management operations via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct HostManager;

impl HostManager {
    pub async fn list_hosts(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaHost>> {
        let result = client
            .rpc::<Vec<IpaHost>>(
                "host_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_host(client: &FreeIpaClient, fqdn: &str) -> FreeIpaResult<IpaHost> {
        let result = client
            .rpc::<IpaHost>(
                "host_show",
                vec![serde_json::json!(fqdn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_host(
        client: &FreeIpaClient,
        req: &CreateHostRequest,
    ) -> FreeIpaResult<IpaHost> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.description {
            map.insert("description".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ip_address {
            map.insert("ip_address".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.userpassword {
            map.insert("userpassword".into(), serde_json::json!(v));
        }
        if let Some(v) = req.force {
            map.insert("force".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.locality {
            map.insert("locality".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ns_hardware_platform {
            map.insert("nshardwareplatform".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ns_os_version {
            map.insert("nsosversion".into(), serde_json::json!(v));
        }

        let result = client
            .rpc::<IpaHost>("host_add", vec![serde_json::json!(req.fqdn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn modify_host(
        client: &FreeIpaClient,
        fqdn: &str,
        description: Option<&str>,
        locality: Option<&str>,
    ) -> FreeIpaResult<IpaHost> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(d) = description {
            map.insert("description".into(), serde_json::json!(d));
        }
        if let Some(l) = locality {
            map.insert("locality".into(), serde_json::json!(l));
        }
        let result = client
            .rpc::<IpaHost>("host_mod", vec![serde_json::json!(fqdn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_host(client: &FreeIpaClient, fqdn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "host_del",
                vec![serde_json::json!(fqdn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn disable_host(client: &FreeIpaClient, fqdn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "host_disable",
                vec![serde_json::json!(fqdn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn add_managed_by(
        client: &FreeIpaClient,
        fqdn: &str,
        host: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "host_add_managedby",
                vec![serde_json::json!(fqdn)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_managed_by(
        client: &FreeIpaClient,
        fqdn: &str,
        host: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "host_remove_managedby",
                vec![serde_json::json!(fqdn)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }
}
