// ── cPanel SSL/TLS management ────────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct SslManager;

impl SslManager {
    /// List installed SSL certificates for a user.
    pub async fn list_certs(client: &CpanelClient, user: &str) -> CpanelResult<Vec<SslCertificate>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "list_certs", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get SSL status for all domains of a user.
    pub async fn get_ssl_status(client: &CpanelClient, user: &str) -> CpanelResult<Vec<SslStatus>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "installed_hosts", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Install an SSL certificate on a domain (WHM installssl).
    pub async fn install_cert(client: &CpanelClient, req: &InstallSslRequest) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![
            ("domain", &req.domain),
            ("crt", &req.cert),
            ("key", &req.key),
        ];
        let cab;
        if let Some(ref c) = req.cabundle {
            cab = c.clone();
            params.push(("cab", &cab));
        }
        let raw: serde_json::Value = client.whm_api_raw("installssl", &params).await?;
        check_whm(&raw)?;
        Ok(format!("SSL certificate installed on {}", req.domain))
    }

    /// Remove SSL from a domain (WHM delete_ssl_host).
    pub async fn remove_cert(client: &CpanelClient, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_api_raw("delete_ssl_host", &[("domain", domain)])
            .await?;
        check_whm(&raw)?;
        Ok(format!("SSL removed from {domain}"))
    }

    /// Generate a CSR (Certificate Signing Request).
    pub async fn generate_csr(client: &CpanelClient, user: &str, req: &GenerateCsrRequest) -> CpanelResult<CsrResult> {
        let mut params: Vec<(&str, &str)> = vec![("domain", &req.domain)];
        let country_str;
        if let Some(ref c) = req.country {
            country_str = c.clone();
            params.push(("country", &country_str));
        }
        let state_str;
        if let Some(ref s) = req.state {
            state_str = s.clone();
            params.push(("state", &state_str));
        }
        let city_str;
        if let Some(ref c) = req.city {
            city_str = c.clone();
            params.push(("city", &city_str));
        }
        let company_str;
        if let Some(ref c) = req.company {
            company_str = c.clone();
            params.push(("company", &company_str));
        }
        let email_str;
        if let Some(ref e) = req.email {
            email_str = e.clone();
            params.push(("email", &email_str));
        }
        let key_size_str;
        if let Some(ks) = req.key_size {
            key_size_str = ks.to_string();
            params.push(("keysize", &key_size_str));
        }

        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "generate_csr", &params)
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Generate a self-signed certificate.
    pub async fn generate_self_signed(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "SSL",
                "generate_cert",
                &[("domain", domain), ("self_signed", "1")],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Self-signed certificate generated for {domain}"))
    }

    /// List private keys.
    pub async fn list_keys(client: &CpanelClient, user: &str) -> CpanelResult<serde_json::Value> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SSL", "list_keys", &[])
            .await?;
        extract_data(&raw)
    }

    /// Check AutoSSL status.
    pub async fn autossl_check(client: &CpanelClient, user: &str) -> CpanelResult<serde_json::Value> {
        client
            .whm_api_raw("start_autossl_check_for_one_user", &[("username", user)])
            .await
    }

    /// Get AutoSSL log.
    pub async fn autossl_log(client: &CpanelClient, user: &str) -> CpanelResult<serde_json::Value> {
        client
            .whm_api_raw("get_autossl_log_for_user", &[("username", user)])
            .await
    }

    /// Fetch SSL certificate details by domain (WHM fetchsslinfo).
    pub async fn fetch_cert_info(client: &CpanelClient, domain: &str) -> CpanelResult<SslCertificate> {
        let raw: serde_json::Value = client
            .whm_api_raw("fetchsslinfo", &[("domain", domain)])
            .await?;
        let cert_data = raw
            .get("data")
            .cloned()
            .ok_or_else(|| CpanelError::cert_not_found(domain))?;
        serde_json::from_value(cert_data).map_err(|e| CpanelError::parse(e.to_string()))
    }
}

fn extract_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
    check_uapi(raw)?;
    Ok(raw
        .get("result")
        .and_then(|r| r.get("data"))
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![])))
}

fn check_uapi(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .and_then(|r| r.get("status"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let errors = raw
            .get("result")
            .and_then(|r| r.get("errors"))
            .and_then(|e| e.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "))
            .unwrap_or_else(|| "UAPI call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}

fn check_whm(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("metadata")
        .and_then(|m| m.get("result"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let msg = raw
            .get("metadata")
            .and_then(|m| m.get("reason"))
            .and_then(|r| r.as_str())
            .unwrap_or("WHM API call failed");
        return Err(CpanelError::api(msg));
    }
    Ok(())
}
