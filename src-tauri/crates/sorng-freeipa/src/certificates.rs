// ── sorng-freeipa/src/certificates.rs ─────────────────────────────────────────
//! Certificate management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct CertManager;

impl CertManager {
    pub async fn list_certificates(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaCertificate>> {
        let result = client
            .rpc::<Vec<IpaCertificate>>(
                "cert_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_certificate(
        client: &FreeIpaClient,
        serial: u64,
    ) -> FreeIpaResult<IpaCertificate> {
        let result = client
            .rpc::<IpaCertificate>(
                "cert_show",
                vec![serde_json::json!(serial)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn request_certificate(
        client: &FreeIpaClient,
        req: &CertRequestParams,
    ) -> FreeIpaResult<IpaCertificate> {
        let mut map = serde_json::Map::new();
        map.insert("version".into(), serde_json::json!("2.251"));
        map.insert("principal".into(), serde_json::json!(req.principal));
        map.insert("csr".into(), serde_json::json!(req.csr));
        if let Some(ref v) = req.profile_id {
            map.insert("cacn".into(), serde_json::json!(v));
        }
        if let Some(v) = req.add_principal {
            map.insert("add".into(), serde_json::json!(v));
        }

        let result = client
            .rpc::<IpaCertificate>("cert_request", vec![], serde_json::Value::Object(map))
            .await?;
        Ok(result.result)
    }

    pub async fn revoke_certificate(
        client: &FreeIpaClient,
        serial: u64,
        reason: u32,
    ) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "cert_revoke",
                vec![serde_json::json!(serial)],
                serde_json::json!({"version": "2.251", "revocation_reason": reason}),
            )
            .await?;
        Ok(())
    }

    pub async fn remove_hold(client: &FreeIpaClient, serial: u64) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "cert_remove_hold",
                vec![serde_json::json!(serial)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }
}
