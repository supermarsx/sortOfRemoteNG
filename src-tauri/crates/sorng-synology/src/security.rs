//! Security — auto-block, certificates, security advisor.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct SecurityManager;

impl SecurityManager {
    /// Get security overview / advisor report.
    pub async fn get_overview(client: &SynoClient) -> SynologyResult<SecurityOverview> {
        let v = client
            .best_version("SYNO.Core.SecurityScan.Status", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.SecurityScan.Status", v, "system_get", &[])
            .await
    }

    /// Run security scan.
    pub async fn run_scan(client: &SynoClient) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.SecurityScan.Status", 1)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.Core.SecurityScan.Status", v, "system_scan", &[])
            .await
    }

    // ─── Auto-Block ──────────────────────────────────────────────

    /// Get auto-block configuration.
    pub async fn get_auto_block_config(client: &SynoClient) -> SynologyResult<AutoBlockConfig> {
        let v = client
            .best_version("SYNO.Core.Security.AutoBlock", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Security.AutoBlock", v, "get", &[])
            .await
    }

    /// Set auto-block configuration.
    pub async fn set_auto_block_config(
        client: &SynoClient,
        enabled: bool,
        attempts: u32,
        within_minutes: u32,
        expire_days: u32,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Security.AutoBlock", 1)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        let att = attempts.to_string();
        let within = within_minutes.to_string();
        let exp = expire_days.to_string();
        client
            .api_post_void(
                "SYNO.Core.Security.AutoBlock",
                v,
                "set",
                &[
                    ("enable", en),
                    ("login_attempts", &att),
                    ("within_min", &within),
                    ("expire_day", &exp),
                ],
            )
            .await
    }

    /// List blocked IPs.
    pub async fn list_blocked_ips(client: &SynoClient) -> SynologyResult<Vec<BlockedIp>> {
        let v = client
            .best_version("SYNO.Core.Security.AutoBlock.Rules", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Security.AutoBlock.Rules", v, "list", &[])
            .await
    }

    /// Unblock an IP address.
    pub async fn unblock_ip(client: &SynoClient, ip: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Security.AutoBlock.Rules", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Security.AutoBlock.Rules",
                v,
                "delete",
                &[("ip", ip)],
            )
            .await
    }

    /// Block an IP address manually.
    pub async fn block_ip(client: &SynoClient, ip: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Security.AutoBlock.Rules", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Security.AutoBlock.Rules",
                v,
                "add",
                &[("ip", ip)],
            )
            .await
    }

    // ─── Certificates ────────────────────────────────────────────

    /// List SSL certificates.
    pub async fn list_certificates(client: &SynoClient) -> SynologyResult<Vec<CertificateInfo>> {
        let v = client
            .best_version("SYNO.Core.Certificate.CRT", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Certificate.CRT", v, "list", &[])
            .await
    }

    /// Get certificate details.
    pub async fn get_certificate(client: &SynoClient, id: &str) -> SynologyResult<CertificateInfo> {
        let v = client
            .best_version("SYNO.Core.Certificate.CRT", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Certificate.CRT", v, "get", &[("id", id)])
            .await
    }

    /// Delete a certificate.
    pub async fn delete_certificate(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Certificate.CRT", 1)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Certificate.CRT", v, "delete", &[("id", id)])
            .await
    }

    /// Renew Let's Encrypt certificate.
    pub async fn renew_lets_encrypt(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Certificate.LetsEncrypt", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Certificate.LetsEncrypt",
                v,
                "renew",
                &[("id", id)],
            )
            .await
    }

    // ─── Account Protection ─────────────────────────────────────

    /// Get account protection status.
    pub async fn get_account_protection(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Core.Security.AutoBlock", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Security.AutoBlock", v, "get", &[])
            .await
    }
}
