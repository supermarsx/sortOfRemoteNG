//! HTTPS browser trust bridge: joins native TLS evidence with native
//! database-scoped trust policy without coupling the protocol/storage crates.

use crate::trust_store::{Identity, TrustPolicy, TrustStoreServiceState};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum HttpsCaTrustMode {
    System,
    Review,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn verify_https_certificate_trust(
    state: tauri::State<'_, TrustStoreServiceState>,
    host: String,
    record_type: String,
    identity: Identity,
    expected_database_id: Option<String>,
    ca_proof_id: Option<String>,
    proxy_url: Option<String>,
    ca_trust_mode: HttpsCaTrustMode,
    policy: TrustPolicy,
) -> Result<serde_json::Value, String> {
    if record_type != "https" {
        return Err("CA admission is available only for HTTPS browser trust".into());
    }
    // No ownerless CA decision. The scoped backend rechecks the expected
    // database and its access lease inside the serialized fresh read.
    let database_id = expected_database_id
        .ok_or("Open or unlock the owning database before verifying HTTPS trust")?;
    let service = state.lock().await;
    let mut scoped = service.scoped_to_database(Some(database_id))?;
    let (result, ca_trusted) = scoped.verify_https_with_ca(
        &host,
        identity,
        policy,
        matches!(ca_trust_mode, HttpsCaTrustMode::System) && ca_proof_id.is_some(),
        |certificate_host, port, fingerprint| {
            crate::http::consume_ca_inspection_proof(
                ca_proof_id
                    .as_deref()
                    .ok_or("Native HTTPS CA inspection proof is missing")?,
                certificate_host,
                port,
                proxy_url.as_deref(),
                fingerprint,
            )
        },
    )?;
    if ca_trusted {
        Ok(serde_json::json!({"status": "ca-trusted"}))
    } else {
        serde_json::to_value(result).map_err(|_| "HTTPS trust result could not be encoded".into())
    }
}
