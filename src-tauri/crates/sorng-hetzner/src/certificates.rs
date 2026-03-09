use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct CertificateManager;

impl CertificateManager {
    pub async fn list_certificates(
        client: &HetznerClient,
    ) -> HetznerResult<Vec<HetznerCertificate>> {
        let resp: CertificatesResponse = client.get("/certificates").await?;
        Ok(resp.certificates)
    }

    pub async fn get_certificate(
        client: &HetznerClient,
        id: u64,
    ) -> HetznerResult<HetznerCertificate> {
        let resp: CertificateResponse = client.get(&format!("/certificates/{id}")).await?;
        Ok(resp.certificate)
    }

    pub async fn create_certificate(
        client: &HetznerClient,
        request: CreateCertificateRequest,
    ) -> HetznerResult<HetznerCertificate> {
        let body = serde_json::to_value(&request)
            .map_err(|e| crate::error::HetznerError::parse(e.to_string()))?;
        let resp: CertificateResponse = client.post("/certificates", &body).await?;
        Ok(resp.certificate)
    }

    pub async fn update_certificate(
        client: &HetznerClient,
        id: u64,
        name: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerCertificate> {
        let mut body = serde_json::json!({});
        if let Some(n) = name {
            body["name"] = serde_json::Value::String(n);
        }
        if let Some(l) = labels {
            body["labels"] = l;
        }
        let resp: CertificateResponse = client.put(&format!("/certificates/{id}"), &body).await?;
        Ok(resp.certificate)
    }

    pub async fn delete_certificate(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/certificates/{id}")).await
    }
}
