use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct CertificateManager;

impl CertificateManager {
    pub async fn list_cas(client: &PfsenseClient) -> PfsenseResult<Vec<CaCertificate>> {
        let resp: ApiListResponse<CaCertificate> = client.api_get("system/ca").await?;
        Ok(resp.data)
    }

    pub async fn get_ca(client: &PfsenseClient, refid: &str) -> PfsenseResult<CaCertificate> {
        let resp: ApiResponse<CaCertificate> =
            client.api_get(&format!("system/ca/{refid}")).await?;
        Ok(resp.data)
    }

    pub async fn create_ca(
        client: &PfsenseClient,
        req: &CertificateRequest,
    ) -> PfsenseResult<CaCertificate> {
        let resp: ApiResponse<CaCertificate> = client.api_post("system/ca", req).await?;
        Ok(resp.data)
    }

    pub async fn delete_ca(client: &PfsenseClient, refid: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("system/ca/{refid}")).await
    }

    pub async fn list_certs(client: &PfsenseClient) -> PfsenseResult<Vec<ServerCertificate>> {
        let resp: ApiListResponse<ServerCertificate> = client.api_get("system/certificate").await?;
        Ok(resp.data)
    }

    pub async fn get_cert(client: &PfsenseClient, refid: &str) -> PfsenseResult<ServerCertificate> {
        let resp: ApiResponse<ServerCertificate> = client
            .api_get(&format!("system/certificate/{refid}"))
            .await?;
        Ok(resp.data)
    }

    pub async fn create_cert(
        client: &PfsenseClient,
        req: &CertificateRequest,
    ) -> PfsenseResult<ServerCertificate> {
        let resp: ApiResponse<ServerCertificate> =
            client.api_post("system/certificate", req).await?;
        Ok(resp.data)
    }

    pub async fn delete_cert(client: &PfsenseClient, refid: &str) -> PfsenseResult<()> {
        client
            .api_delete_void(&format!("system/certificate/{refid}"))
            .await
    }

    pub async fn generate_csr(
        client: &PfsenseClient,
        req: &CertificateRequest,
    ) -> PfsenseResult<serde_json::Value> {
        client.api_post("system/certificate/csr", req).await
    }

    pub async fn sign_csr(
        client: &PfsenseClient,
        refid: &str,
        ca_ref: &str,
    ) -> PfsenseResult<ServerCertificate> {
        let body = serde_json::json!({"ca_ref": ca_ref});
        let resp: ApiResponse<ServerCertificate> = client
            .api_post(&format!("system/certificate/sign/{refid}"), &body)
            .await?;
        Ok(resp.data)
    }

    pub async fn export_cert(client: &PfsenseClient, refid: &str) -> PfsenseResult<Vec<u8>> {
        client
            .api_get_bytes(&format!("system/certificate/export/{refid}"))
            .await
    }
}
