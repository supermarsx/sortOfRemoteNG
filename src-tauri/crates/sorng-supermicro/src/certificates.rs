//! SSL/TLS certificate management for Supermicro BMCs.

use crate::client::SmcClient;
use crate::error::SmcResult;
use crate::types::*;

pub struct CertificateManager;

impl CertificateManager {
    /// Get the BMC SSL/TLS certificate (Redfish only).
    pub async fn get_certificate(client: &SmcClient) -> SmcResult<SmcCertificate> {
        let rf = client.require_redfish()?;
        rf.get_certificate().await
    }

    /// Generate a Certificate Signing Request (Redfish only).
    pub async fn generate_csr(client: &SmcClient, params: &CsrParams) -> SmcResult<String> {
        let rf = client.require_redfish()?;
        rf.generate_csr(params).await
    }

    /// Import a signed certificate (Redfish only).
    /// Note: import requires raw Redfish POST — not yet fully wired.
    pub async fn import_certificate(_client: &SmcClient, _cert_pem: &str) -> SmcResult<()> {
        Err(crate::error::SmcError::certificate(
            "Certificate import requires direct Redfish POST — use generate_csr + external signing",
        ))
    }
}
