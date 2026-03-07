// ── cPanel account management (WHM API) ──────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct AccountManager;

impl AccountManager {
    /// List all cPanel accounts on the server (WHM listaccts).
    pub async fn list(client: &CpanelClient) -> CpanelResult<Vec<CpanelAccount>> {
        let raw: serde_json::Value = client.whm_api("listaccts", &[]).await?;
        let accts = raw
            .get("acct")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(accts).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get a single account by username.
    pub async fn get(client: &CpanelClient, user: &str) -> CpanelResult<CpanelAccount> {
        let raw: serde_json::Value =
            client.whm_api("accountsummary", &[("user", user)]).await?;
        let acct = raw
            .get("acct")
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .cloned()
            .ok_or_else(|| CpanelError::account_not_found(user))?;
        serde_json::from_value(acct).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create a new cPanel account.
    pub async fn create(client: &CpanelClient, req: &CreateAccountRequest) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![
            ("username", &req.username),
            ("domain", &req.domain),
            ("password", &req.password),
        ];
        let plan_str;
        if let Some(ref p) = req.plan {
            plan_str = p.clone();
            params.push(("plan", &plan_str));
        }
        let contact_str;
        if let Some(ref c) = req.contactemail {
            contact_str = c.clone();
            params.push(("contactemail", &contact_str));
        }
        let quota_str;
        if let Some(q) = req.quota {
            quota_str = q.to_string();
            params.push(("quota", &quota_str));
        }
        let bw_str;
        if let Some(bw) = req.bwlimit {
            bw_str = bw.to_string();
            params.push(("bwlimit", &bw_str));
        }

        let raw: serde_json::Value = client.whm_api("createacct", &params).await?;
        Self::check_whm_result(&raw)?;
        Ok(raw
            .get("result")
            .and_then(|r| r.as_array())
            .and_then(|a| a.first())
            .and_then(|r| r.get("options"))
            .and_then(|o| o.get("nameserverentry"))
            .and_then(|v| v.as_str())
            .unwrap_or("Account created")
            .to_string())
    }

    /// Suspend an account.
    pub async fn suspend(client: &CpanelClient, user: &str, reason: Option<&str>) -> CpanelResult<String> {
        let mut params = vec![("user", user)];
        if let Some(r) = reason {
            params.push(("reason", r));
        }
        let raw: serde_json::Value = client.whm_api("suspendacct", &params).await?;
        Self::check_whm_result(&raw)?;
        Ok("Account suspended".into())
    }

    /// Unsuspend an account.
    pub async fn unsuspend(client: &CpanelClient, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client.whm_api("unsuspendacct", &[("user", user)]).await?;
        Self::check_whm_result(&raw)?;
        Ok("Account unsuspended".into())
    }

    /// Terminate (remove) an account.
    pub async fn terminate(client: &CpanelClient, user: &str, keep_dns: bool) -> CpanelResult<String> {
        let dns = if keep_dns { "1" } else { "0" };
        let raw: serde_json::Value = client
            .whm_api("removeacct", &[("user", user), ("keepdns", dns)])
            .await?;
        Self::check_whm_result(&raw)?;
        Ok("Account terminated".into())
    }

    /// Modify account quotas, plan, etc.
    pub async fn modify(client: &CpanelClient, req: &ModifyAccountRequest) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![("user", &req.user)];
        let domain_str;
        if let Some(ref d) = req.domain {
            domain_str = d.clone();
            params.push(("domain", &domain_str));
        }
        let plan_str;
        if let Some(ref p) = req.plan {
            plan_str = p.clone();
            params.push(("pkg", &plan_str));
        }
        let quota_str;
        if let Some(q) = req.quota {
            quota_str = q.to_string();
            params.push(("QUOTA", &quota_str));
        }
        let bw_str;
        if let Some(bw) = req.bwlimit {
            bw_str = bw.to_string();
            params.push(("BWLIMIT", &bw_str));
        }

        let raw: serde_json::Value = client.whm_api("modifyacct", &params).await?;
        Self::check_whm_result(&raw)?;
        Ok("Account modified".into())
    }

    /// Change account password.
    pub async fn change_password(client: &CpanelClient, user: &str, password: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_api("passwd", &[("user", user), ("password", password)])
            .await?;
        Self::check_whm_result(&raw)?;
        Ok("Password changed".into())
    }

    /// List hosting packages.
    pub async fn list_packages(client: &CpanelClient) -> CpanelResult<Vec<HostingPackage>> {
        let raw: serde_json::Value = client.whm_api("listpkgs", &[]).await?;
        let pkgs = raw
            .get("package")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        serde_json::from_value(pkgs).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get account summary stats (disk, bandwidth, counts).
    pub async fn get_summary(client: &CpanelClient, user: &str) -> CpanelResult<AccountSummary> {
        let acct = Self::get(client, user).await?;
        Ok(AccountSummary {
            user: acct.user.clone(),
            domain: acct.domain.clone(),
            suspended: acct.suspended.unwrap_or(false),
            disk_used_mb: parse_size_mb(acct.diskused.as_deref()),
            disk_limit_mb: acct.disklimit.as_deref().map(|s| parse_size_mb(Some(s))),
            bandwidth_used_mb: 0.0,
            bandwidth_limit_mb: None,
            email_accounts: 0,
            databases: 0,
            addon_domains: 0,
            subdomains: 0,
            parked_domains: 0,
            ftp_accounts: 0,
        })
    }

    /// List suspended accounts.
    pub async fn list_suspended(client: &CpanelClient) -> CpanelResult<Vec<CpanelAccount>> {
        let all = Self::list(client).await?;
        Ok(all.into_iter().filter(|a| a.suspended.unwrap_or(false)).collect())
    }

    /// Get the server's load and general status.
    pub async fn get_server_info(client: &CpanelClient) -> CpanelResult<CpanelServerInfo> {
        let _raw: serde_json::Value = client.whm_api_raw("systemloadavg", &[("api.version", "1")]).await?;
        let ver: serde_json::Value = client.whm_api_raw("version", &[]).await.unwrap_or_default();

        let version = ver
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        Ok(CpanelServerInfo {
            hostname: client.config.host.clone(),
            version,
            build: None,
            theme: None,
            os: None,
            os_version: None,
            kernel: None,
            arch: None,
            apache_version: None,
            php_version: None,
            mysql_version: None,
            perl_version: None,
            license_id: None,
            license_package: None,
            max_accounts: None,
            current_accounts: None,
            uptime: None,
            load_average: None,
        })
    }

    fn check_whm_result(raw: &serde_json::Value) -> CpanelResult<()> {
        let result = raw
            .get("result")
            .or_else(|| raw.get("metadata"))
            .cloned()
            .unwrap_or_default();

        let status = result
            .get("status")
            .or_else(|| result.get("result"))
            .and_then(|s| s.as_u64())
            .unwrap_or(1);

        if status == 0 {
            let msg = result
                .get("statusmsg")
                .or_else(|| result.get("reason"))
                .and_then(|m| m.as_str())
                .unwrap_or("WHM API call failed");
            return Err(CpanelError::api(msg));
        }
        Ok(())
    }
}

fn parse_size_mb(s: Option<&str>) -> f64 {
    s.and_then(|v| v.replace('M', "").trim().parse::<f64>().ok())
        .unwrap_or(0.0)
}
