//! Certificate and CA management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct CertificateManager;

impl CertificateManager {
    pub async fn list_certs(client: &PfsenseClient) -> PfsenseResult<Vec<PfsenseCertificate>> {
        let resp = client.api_get("/system/certificate").await?;
        let certs = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        certs.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_cert(client: &PfsenseClient, refid: &str) -> PfsenseResult<PfsenseCertificate> {
        let certs = Self::list_certs(client).await?;
        certs.into_iter()
            .find(|c| c.refid == refid)
            .ok_or_else(|| PfsenseError::cert_not_found(refid))
    }

    pub async fn create_cert(client: &PfsenseClient, req: &CreateCertRequest) -> PfsenseResult<PfsenseCertificate> {
        let body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let resp = client.api_post("/system/certificate", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn import_cert(client: &PfsenseClient, req: &ImportCertRequest) -> PfsenseResult<PfsenseCertificate> {
        let body = serde_json::json!({
            "method": "import",
            "descr": req.descr,
            "crt": req.crt,
            "prv": req.prv,
        });
        let resp = client.api_post("/system/certificate", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_cert(client: &PfsenseClient, refid: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/system/certificate/{refid}")).await
    }

    pub async fn list_cas(client: &PfsenseClient) -> PfsenseResult<Vec<CertificateAuthority>> {
        let resp = client.api_get("/system/ca").await?;
        let cas = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        cas.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn get_ca(client: &PfsenseClient, refid: &str) -> PfsenseResult<CertificateAuthority> {
        let cas = Self::list_cas(client).await?;
        cas.into_iter()
            .find(|c| c.refid == refid)
            .ok_or_else(|| PfsenseError::cert_not_found(refid))
    }

    pub async fn import_ca(client: &PfsenseClient, descr: &str, crt: &str, prv: &str) -> PfsenseResult<CertificateAuthority> {
        let body = serde_json::json!({
            "method": "import",
            "descr": descr,
            "crt": crt,
            "prv": prv,
        });
        let resp = client.api_post("/system/ca", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }

    pub async fn delete_ca(client: &PfsenseClient, refid: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/system/ca/{refid}")).await
    }

    pub async fn create_csr(client: &PfsenseClient, req: &CreateCertRequest) -> PfsenseResult<String> {
        let mut body = serde_json::to_value(req)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        body.as_object_mut()
            .map(|o| o.insert("method".to_string(), serde_json::json!("csr")));
        let resp = client.api_post("/system/certificate", &body).await?;
        let csr = resp.get("data")
            .and_then(|d| d.get("csr"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        Ok(csr)
    }

    pub async fn sign_csr(client: &PfsenseClient, ca_refid: &str, csr: &str, lifetime: u32) -> PfsenseResult<PfsenseCertificate> {
        let body = serde_json::json!({
            "method": "sign",
            "caref": ca_refid,
            "csr": csr,
            "lifetime": lifetime,
        });
        let resp = client.api_post("/system/certificate", &body).await?;
        serde_json::from_value(resp.get("data").cloned().unwrap_or(resp))
            .map_err(|e| PfsenseError::parse(e.to_string()))
    }
}
