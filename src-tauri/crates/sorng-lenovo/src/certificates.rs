//! Certificate management for Lenovo XCC/IMM.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct CertificateManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> CertificateManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_certificate(&self) -> LenovoResult<XccCertificate> {
        let rf = self.client.require_redfish()?;
        rf.get_certificate().await
    }

    pub async fn generate_csr(&self, params: &CsrParams) -> LenovoResult<String> {
        let rf = self.client.require_redfish()?;
        rf.generate_csr(params).await
    }

    pub async fn import_certificate(&self, cert_pem: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        let body = serde_json::json!({
            "CertificateString": cert_pem,
            "CertificateType": "PEM",
        });
        rf.inner
            .post_json(
                "/redfish/v1/Managers/1/NetworkProtocol/HTTPS/Certificates",
                &body,
            )
            .await
            .map_err(crate::error::LenovoError::from)?;
        Ok(())
    }
}
