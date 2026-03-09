//! Certificate management — SSL certs, CSR generation.

use crate::client::IdracClient;
use crate::error::{IdracError, IdracResult};
use crate::types::*;

/// SSL certificate management for iDRAC.
pub struct CertificateManager<'a> {
    client: &'a IdracClient,
}

impl<'a> CertificateManager<'a> {
    pub fn new(client: &'a IdracClient) -> Self {
        Self { client }
    }

    /// List installed certificates.
    pub async fn list_certificates(&self) -> IdracResult<Vec<IdracCertificate>> {
        let rf = self.client.require_redfish()?;

        // Dell iDRAC certificate store
        let col: serde_json::Value = match rf
            .get("/redfish/v1/Managers/iDRAC.Embedded.1/NetworkProtocol/HTTPS/Certificates?$expand=*($levels=1)")
            .await
        {
            Ok(v) => v,
            Err(_) => rf
                .get("/redfish/v1/CertificateService/CertificateLocations")
                .await
                .unwrap_or_default(),
        };

        let members = col
            .get("Members")
            .and_then(|v| v.as_array())
            .cloned()
            .or_else(|| {
                col.get("Links")
                    .and_then(|l| l.get("Certificates"))
                    .and_then(|v| v.as_array())
                    .cloned()
            })
            .unwrap_or_default();

        let mut certs = Vec::new();
        for m in &members {
            // If we have full cert data (expanded)
            if m.get("CertificateString").is_some() {
                certs.push(self.parse_cert(m));
            } else if let Some(uri) = m.get("@odata.id").and_then(|v| v.as_str()) {
                if let Ok(cert_data) = rf.get::<serde_json::Value>(uri).await {
                    certs.push(self.parse_cert(&cert_data));
                }
            }
        }

        Ok(certs)
    }

    fn parse_cert(&self, c: &serde_json::Value) -> IdracCertificate {
        IdracCertificate {
            id: c
                .get("Id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            subject: c
                .get("Subject")
                .and_then(|v| v.as_object())
                .map(|o| {
                    o.iter()
                        .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or("")))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .or_else(|| {
                    c.get("Subject")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                }),
            issuer: c
                .get("Issuer")
                .and_then(|v| v.as_object())
                .map(|o| {
                    o.iter()
                        .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or("")))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .or_else(|| {
                    c.get("Issuer")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                }),
            valid_from: c
                .get("ValidNotBefore")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            valid_to: c
                .get("ValidNotAfter")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            serial_number: c
                .get("SerialNumber")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            thumbprint: None,
            fingerprint: c
                .get("Fingerprint")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            key_usage: c
                .get("KeyUsage")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            signature_algorithm: None,
            certificate_type: c
                .get("CertificateType")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            certificate_string: c
                .get("CertificateString")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        }
    }

    /// Generate a Certificate Signing Request (CSR).
    pub async fn generate_csr(&self, params: CsrParams) -> IdracResult<String> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "CertificateCollection": {
                "@odata.id": "/redfish/v1/Managers/iDRAC.Embedded.1/NetworkProtocol/HTTPS/Certificates"
            },
            "Country": params.country,
            "State": params.state,
            "City": params.city,
            "Organization": params.organization,
            "OrganizationalUnit": params.organizational_unit.as_deref().unwrap_or(""),
            "CommonName": params.common_name,
            "AlternativeNames": params.alternative_names.as_deref().unwrap_or(&[]),
            "KeyPairAlgorithm": params.key_algorithm.as_deref().unwrap_or("TPM_ALG_RSA"),
            "KeyBitLength": params.key_bit_length.unwrap_or(2048),
        });

        let result: serde_json::Value = rf
            .post_json(
                "/redfish/v1/CertificateService/Actions/CertificateService.GenerateCSR",
                &body,
            )
            .await?;

        result
            .get("CSRString")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                IdracError::certificate("CSR generation failed — no CSR string in response")
            })
    }

    /// Import a signed certificate (PEM format).
    pub async fn import_certificate(&self, cert_pem: &str, cert_type: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "CertificateString": cert_pem,
            "CertificateType": cert_type,
        });

        rf.post_json::<serde_json::Value, serde_json::Value>(
            "/redfish/v1/Managers/iDRAC.Embedded.1/NetworkProtocol/HTTPS/Certificates",
            &body,
        )
        .await?;

        Ok(())
    }

    /// Delete a certificate.
    pub async fn delete_certificate(&self, cert_id: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        rf.delete(&format!(
            "/redfish/v1/Managers/iDRAC.Embedded.1/NetworkProtocol/HTTPS/Certificates/{}",
            cert_id
        ))
        .await
    }

    /// Replace the SSL certificate (import + auto-restart iDRAC web server).
    pub async fn replace_ssl_certificate(&self, cert_pem: &str, key_pem: &str) -> IdracResult<()> {
        let rf = self.client.require_redfish()?;

        let body = serde_json::json!({
            "CertificateString": format!("{}\n{}", cert_pem, key_pem),
            "CertificateType": "PEM",
            "CertificateUri": {
                "@odata.id": "/redfish/v1/Managers/iDRAC.Embedded.1/NetworkProtocol/HTTPS/Certificates/1"
            }
        });

        rf.post_json::<serde_json::Value, serde_json::Value>(
            "/redfish/v1/CertificateService/Actions/CertificateService.ReplaceCertificate",
            &body,
        )
        .await?;

        Ok(())
    }

    /// Get SSL certificate expiry information.
    pub async fn get_ssl_cert_expiry(&self) -> IdracResult<Option<String>> {
        let certs = self.list_certificates().await?;
        Ok(certs.first().and_then(|c| c.valid_to.clone()))
    }
}
