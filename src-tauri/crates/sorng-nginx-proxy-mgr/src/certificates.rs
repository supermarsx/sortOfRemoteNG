// ── NPM certificate management ───────────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct CertificateManager;

impl CertificateManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmCertificate>> {
        client.get("/nginx/certificates?expand=owner").await
    }

    pub async fn get(client: &NpmClient, id: u64) -> NpmResult<NpmCertificate> {
        client.get(&format!("/nginx/certificates/{}", id)).await
    }

    pub async fn create_letsencrypt(client: &NpmClient, req: &CreateLetsEncryptCertRequest) -> NpmResult<NpmCertificate> {
        client.post("/nginx/certificates", &serde_json::json!({
            "provider": "letsencrypt",
            "domain_names": req.domain_names,
            "meta": req.meta,
        })).await
    }

    pub async fn upload_custom(client: &NpmClient, req: &UploadCustomCertRequest) -> NpmResult<NpmCertificate> {
        client.post("/nginx/certificates", &serde_json::json!({
            "provider": "other",
            "nice_name": req.nice_name,
            "certificate": req.certificate,
            "certificate_key": req.certificate_key,
            "intermediate_certificate": req.intermediate_certificate,
        })).await
    }

    pub async fn delete(client: &NpmClient, id: u64) -> NpmResult<()> {
        client.delete(&format!("/nginx/certificates/{}", id)).await
    }

    pub async fn renew(client: &NpmClient, id: u64) -> NpmResult<NpmCertificate> {
        client.post(&format!("/nginx/certificates/{}/renew", id), &serde_json::json!({})).await
    }

    pub async fn validate(client: &NpmClient, id: u64) -> NpmResult<serde_json::Value> {
        client.get(&format!("/nginx/certificates/{}/validate", id)).await
    }
}
