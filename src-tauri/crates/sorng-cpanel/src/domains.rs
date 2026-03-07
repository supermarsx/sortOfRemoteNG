// ── cPanel domain management ─────────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct DomainManager;

impl DomainManager {
    /// List all domains for a given user (via WHM domainuserdata or UAPI).
    pub async fn list(client: &CpanelClient, user: &str) -> CpanelResult<Vec<DomainInfo>> {
        let raw: serde_json::Value = client
            .whm_api_raw("get_domain_info", &[("user", user)])
            .await?;
        let domains = raw
            .get("data")
            .and_then(|d| d.get("domains"))
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(domains).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// List all domains on the server (WHM).
    pub async fn list_all(client: &CpanelClient) -> CpanelResult<Vec<DomainInfo>> {
        let raw: serde_json::Value = client.whm_api_raw("listdomains", &[]).await?;
        let domains = raw
            .get("data")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(domains).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create an addon domain (UAPI AddonDomain::addaddondomain).
    pub async fn create_addon(client: &CpanelClient, user: &str, req: &CreateAddonDomainRequest) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "AddonDomain",
                "addaddondomain",
                &[
                    ("newdomain", &req.domain),
                    ("subdomain", &req.subdomain),
                    ("dir", &req.document_root),
                ],
            )
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Addon domain {} created", req.domain))
    }

    /// Remove an addon domain.
    pub async fn remove_addon(client: &CpanelClient, user: &str, domain: &str, subdomain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "AddonDomain",
                "deladdondomain",
                &[("domain", domain), ("subdomain", subdomain)],
            )
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Addon domain {domain} removed"))
    }

    /// Create a subdomain.
    pub async fn create_subdomain(client: &CpanelClient, user: &str, req: &CreateSubdomainRequest) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![
            ("domain", &req.subdomain),
            ("rootdomain", &req.root_domain),
        ];
        let docroot;
        if let Some(ref d) = req.document_root {
            docroot = d.clone();
            params.push(("dir", &docroot));
        }
        let raw: serde_json::Value = client
            .whm_uapi(user, "SubDomain", "addsubdomain", &params)
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Subdomain {}.{} created", req.subdomain, req.root_domain))
    }

    /// Remove a subdomain.
    pub async fn remove_subdomain(client: &CpanelClient, user: &str, subdomain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "SubDomain", "delsubdomain", &[("domain", subdomain)])
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Subdomain {subdomain} removed"))
    }

    /// Park (alias) a domain.
    pub async fn park(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Park", "park", &[("domain", domain)])
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Domain {domain} parked"))
    }

    /// Un-park (remove alias) a domain.
    pub async fn unpark(client: &CpanelClient, user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Park", "unpark", &[("domain", domain)])
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Domain {domain} unparked"))
    }

    /// Set a redirect for a domain.
    pub async fn set_redirect(client: &CpanelClient, user: &str, redirect: &DomainRedirect) -> CpanelResult<String> {
        let redirect_type = redirect.redirect_type.as_deref().unwrap_or("301");
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Mime",
                "add_redirect",
                &[
                    ("domain", &redirect.domain),
                    ("redirect", &redirect.redirect_url),
                    ("redirect_type", redirect_type),
                ],
            )
            .await?;
        check_uapi_result(&raw)?;
        Ok(format!("Redirect set for {}", redirect.domain))
    }

    /// Get document root for a domain.
    pub async fn get_docroot(client: &CpanelClient, _user: &str, domain: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_api_raw("domainuserdata", &[("domain", domain)])
            .await?;
        raw.get("userdata")
            .and_then(|u| u.get("documentroot"))
            .and_then(|d| d.as_str())
            .map(String::from)
            .ok_or_else(|| CpanelError::domain_not_found(domain))
    }
}

fn check_uapi_result(raw: &serde_json::Value) -> CpanelResult<()> {
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
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_else(|| "UAPI call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}
