// ─── LXD – Certificate & Operation & Warning management ─────────────────────
use crate::client::LxdClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/certificates?recursion=1
pub async fn list_certificates(client: &LxdClient) -> LxdResult<Vec<LxdCertificate>> {
    client.list_recursion("/certificates").await
}

/// GET /1.0/certificates/<fingerprint>
pub async fn get_certificate(client: &LxdClient, fingerprint: &str) -> LxdResult<LxdCertificate> {
    client.get(&format!("/certificates/{fingerprint}")).await
}

/// POST /1.0/certificates — add a trusted certificate
pub async fn add_certificate(client: &LxdClient, req: &AddCertificateRequest) -> LxdResult<()> {
    client.put("/certificates", req).await
}

/// DELETE /1.0/certificates/<fingerprint>
pub async fn delete_certificate(client: &LxdClient, fingerprint: &str) -> LxdResult<()> {
    client.delete(&format!("/certificates/{fingerprint}")).await
}

/// PATCH /1.0/certificates/<fingerprint>
pub async fn update_certificate(
    client: &LxdClient,
    fingerprint: &str,
    patch: &serde_json::Value,
) -> LxdResult<()> {
    client
        .patch(&format!("/certificates/{fingerprint}"), patch)
        .await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Operations
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/operations?recursion=1 — list all operations
pub async fn list_operations(client: &LxdClient) -> LxdResult<Vec<LxdOperation>> {
    // Operations are grouped by status; recursion=1 returns all as map
    // Flatten the structure
    let raw: serde_json::Value = client.get("/operations").await?;
    let mut ops = Vec::new();
    if let Some(obj) = raw.as_object() {
        for (_status, list) in obj {
            if let Some(arr) = list.as_array() {
                for v in arr {
                    if let Ok(op) = serde_json::from_value::<LxdOperation>(v.clone()) {
                        ops.push(op);
                    }
                }
            }
        }
    }
    Ok(ops)
}

/// GET /1.0/operations/<id>
pub async fn get_operation(client: &LxdClient, id: &str) -> LxdResult<LxdOperation> {
    client.get(&format!("/operations/{id}")).await
}

/// DELETE /1.0/operations/<id> — cancel operation
pub async fn cancel_operation(client: &LxdClient, id: &str) -> LxdResult<()> {
    client.delete(&format!("/operations/{id}")).await
}

/// GET /1.0/operations/<id>/wait?timeout=<t> — wait for operation
pub async fn wait_operation(
    client: &LxdClient,
    id: &str,
    timeout: Option<u64>,
) -> LxdResult<LxdOperation> {
    client.wait_operation(id, timeout).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Warnings
// ═══════════════════════════════════════════════════════════════════════════════

/// GET /1.0/warnings?recursion=1
pub async fn list_warnings(client: &LxdClient) -> LxdResult<Vec<LxdWarning>> {
    client.list_recursion("/warnings").await
}

/// GET /1.0/warnings/<uuid>
pub async fn get_warning(client: &LxdClient, uuid: &str) -> LxdResult<LxdWarning> {
    client.get(&format!("/warnings/{uuid}")).await
}

/// PUT /1.0/warnings/<uuid> — acknowledge (set status to "acknowledged")
pub async fn acknowledge_warning(client: &LxdClient, uuid: &str) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body {
        status: &'static str,
    }
    client
        .put(
            &format!("/warnings/{uuid}"),
            &Body {
                status: "acknowledged",
            },
        )
        .await
}

/// DELETE /1.0/warnings/<uuid>
pub async fn delete_warning(client: &LxdClient, uuid: &str) -> LxdResult<()> {
    client.delete(&format!("/warnings/{uuid}")).await
}
