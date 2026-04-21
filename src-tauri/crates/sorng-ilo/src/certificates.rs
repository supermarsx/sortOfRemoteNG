//! Certificate management — view, generate CSR, import.

use crate::client::IloClient;
use crate::error::{IloError, IloResult};
use crate::types::*;

/// Certificate management operations.
pub struct CertificateManager<'a> {
    client: &'a IloClient,
}

impl<'a> CertificateManager<'a> {
    pub fn new(client: &'a IloClient) -> Self {
        Self { client }
    }

    /// Get current iLO SSL certificate info.
    pub async fn get_certificate(&self) -> IloResult<IloCertificate> {
        if let Ok(rf) = self.client.require_redfish() {
            let cert_data: serde_json::Value = rf.get_certificate().await?;

            return Ok(IloCertificate {
                issuer: cert_data
                    .get("Issuer")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                subject: cert_data
                    .get("Subject")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                valid_from: cert_data
                    .get("ValidNotBefore")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                valid_to: cert_data
                    .get("ValidNotAfter")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                serial_number: cert_data
                    .get("SerialNumber")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                fingerprint: None,
            });
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let cert_data = ribcl.get_certificate().await?;

            return Ok(IloCertificate {
                issuer: cert_data
                    .get("ISSUER")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                subject: cert_data
                    .get("SUBJECT")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                valid_from: cert_data
                    .get("VALID_FROM")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                valid_to: cert_data
                    .get("VALID_UNTIL")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                serial_number: cert_data
                    .get("SERIAL_NUMBER")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                fingerprint: None,
            });
        }

        Err(IloError::unsupported(
            "No protocol available for certificate info",
        ))
    }

    /// Generate a Certificate Signing Request (CSR).
    pub async fn generate_csr(&self, params: &CsrParams) -> IloResult<String> {
        if let Ok(rf) = self.client.require_redfish() {
            let body = serde_json::json!({
                "CommonName": params.common_name,
                "Country": params.country,
                "State": params.state,
                "City": params.city,
                "OrgName": params.organization,
                "OrgUnit": params.organizational_unit,
            });

            // HP iLO OEM CSR generation endpoint
            let gen = self.client.generation;
            let path = if matches!(
                gen,
                IloGeneration::Ilo5 | IloGeneration::Ilo6 | IloGeneration::Ilo7
            ) {
                "/redfish/v1/Managers/1/SecurityService/HttpsCert/Actions/HpeHttpsCert.GenerateCSR"
            } else {
                "/redfish/v1/Managers/1/SecurityService/HttpsCert"
            };

            let response = rf
                .inner
                .post_json::<_, serde_json::Value>(path, &body)
                .await?;

            // CSR is async on iLO — may need to poll
            if let Some(csr) = response.get("CSR").and_then(|v| v.as_str()) {
                return Ok(csr.to_string());
            }

            return Ok(
                "CSR generation started. Poll the certificate endpoint for results.".to_string(),
            );
        }

        if let Ok(ribcl) = self.client.require_ribcl() {
            let csr = ribcl
                .generate_csr(
                    &params.common_name,
                    &params.organization,
                    params.organizational_unit.as_deref().unwrap_or(""),
                    params.city.as_deref().unwrap_or(""),
                    params.state.as_deref().unwrap_or(""),
                    &params.country,
                )
                .await?;
            return Ok(csr);
        }

        Err(IloError::unsupported(
            "No protocol available for CSR generation",
        ))
    }

    /// Import a signed certificate.
    pub async fn import_certificate(&self, cert_pem: &str) -> IloResult<()> {
        let rf = self.client.require_redfish()?;
        let gen = self.client.generation;

        let path = if matches!(
            gen,
            IloGeneration::Ilo5 | IloGeneration::Ilo6 | IloGeneration::Ilo7
        ) {
            "/redfish/v1/Managers/1/SecurityService/HttpsCert/Actions/HpeHttpsCert.ImportCertificate"
        } else {
            "/redfish/v1/Managers/1/SecurityService/HttpsCert"
        };

        let body = serde_json::json!({ "Certificate": cert_pem });
        rf.inner.post_json::<_, ()>(path, &body).await?;

        Ok(())
    }
}
