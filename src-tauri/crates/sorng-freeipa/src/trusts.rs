// ── sorng-freeipa/src/trusts.rs ───────────────────────────────────────────────
//! AD trust management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct TrustManager;

impl TrustManager {
    pub async fn list_trusts(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaTrust>> {
        let result = client
            .rpc::<Vec<IpaTrust>>("trust_find", vec![], serde_json::json!({"version": "2.251", "sizelimit": 0}))
            .await?;
        Ok(result.result)
    }

    pub async fn get_trust(client: &FreeIpaClient, realm: &str) -> FreeIpaResult<IpaTrust> {
        let result = client
            .rpc::<IpaTrust>(
                "trust_show",
                vec![serde_json::json!(realm)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_trust(client: &FreeIpaClient, req: &CreateTrustRequest) -> FreeIpaResult<IpaTrust> {
        let mut opts = serde_json::json!({
            "version": "2.251",
            "realm_admin": req.admin,
            "realm_passwd": req.password,
        });
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.trust_type { map.insert("trust_type".into(), serde_json::json!(v)); }
        if let Some(v) = req.base_id { map.insert("base_id".into(), serde_json::json!(v)); }
        if let Some(v) = req.range_size { map.insert("range_size".into(), serde_json::json!(v)); }

        let result = client
            .rpc::<IpaTrust>("trust_add", vec![serde_json::json!(req.realm)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_trust(client: &FreeIpaClient, realm: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>("trust_del", vec![serde_json::json!(realm)], serde_json::json!({"version": "2.251"}))
            .await?;
        Ok(())
    }

    pub async fn fetch_domains(client: &FreeIpaClient, realm: &str) -> FreeIpaResult<Vec<serde_json::Value>> {
        let result = client
            .rpc::<Vec<serde_json::Value>>(
                "trust_fetch_domains",
                vec![serde_json::json!(realm)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(result.result)
    }
}
