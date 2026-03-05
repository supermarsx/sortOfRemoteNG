// ─── Exchange Integration – Certificates ─────────────────────────────────────
//!
//! Manage Exchange server TLS/SSL certificates.

use crate::client::ExchangeClient;
use crate::auth::{wrap_ps_json, ps_param_opt};
use crate::types::*;

/// List certificates on an Exchange server.
pub async fn ps_list_certificates(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<ExchangeCertificate>> {
    let mut cmd = String::from("Get-ExchangeCertificate");
    if let Some(s) = server {
        cmd += &format!(" -Server '{s}'");
    }
    cmd += " | Select-Object Thumbprint,Subject,Issuer,Services,CertificateDomains,\
             NotBefore,NotAfter,IsSelfSigned,Status,RootCAType";
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    Ok(serde_json::from_str(&out).unwrap_or_default())
}

/// Get a certificate by thumbprint.
pub async fn ps_get_certificate(
    client: &ExchangeClient,
    thumbprint: &str,
    server: Option<&str>,
) -> ExchangeResult<ExchangeCertificate> {
    let mut cmd = format!("Get-ExchangeCertificate -Thumbprint '{thumbprint}'");
    cmd += &ps_param_opt("-Server", server);
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Enable a certificate for specific services (IIS, SMTP, POP, IMAP).
pub async fn ps_enable_certificate(
    client: &ExchangeClient,
    thumbprint: &str,
    services: &str,
    server: Option<&str>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "Enable-ExchangeCertificate -Thumbprint '{thumbprint}' -Services {services} -Force"
    );
    cmd += &ps_param_opt("-Server", server);
    client.run_ps(&cmd).await
}

/// Import a certificate from a file (PFX).
pub async fn ps_import_certificate(
    client: &ExchangeClient,
    file_path: &str,
    password: &str,
    server: Option<&str>,
) -> ExchangeResult<ExchangeCertificate> {
    let mut cmd = format!(
        "Import-ExchangeCertificate -FileName '{file_path}' \
         -Password (ConvertTo-SecureString '{password}' -AsPlainText -Force) -PrivateKeyExportable $true"
    );
    cmd += &ps_param_opt("-Server", server);
    let script = wrap_ps_json(&cmd);
    let out = client.run_ps_json(&script).await?;
    serde_json::from_str(&out)
        .map_err(|e| ExchangeError::powershell(format!("parse error: {e}")))
}

/// Remove a certificate.
pub async fn ps_remove_certificate(
    client: &ExchangeClient,
    thumbprint: &str,
    server: Option<&str>,
) -> ExchangeResult<String> {
    let mut cmd = format!(
        "Remove-ExchangeCertificate -Thumbprint '{thumbprint}' -Confirm:$false"
    );
    cmd += &ps_param_opt("-Server", server);
    client.run_ps(&cmd).await
}

/// Create a new certificate signing request (CSR).
pub async fn ps_new_certificate_request(
    client: &ExchangeClient,
    subject_name: &str,
    domains: &[String],
    server: Option<&str>,
) -> ExchangeResult<String> {
    let domain_list = domains.join("','");
    let mut cmd = format!(
        "New-ExchangeCertificate -GenerateRequest -SubjectName '{subject_name}' \
         -DomainName '{domain_list}' -PrivateKeyExportable $true"
    );
    cmd += &ps_param_opt("-Server", server);
    client.run_ps(&cmd).await
}
