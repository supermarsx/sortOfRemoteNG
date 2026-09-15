//! Security — auto-block, certificates, security advisor.
//!
//! DSM answers are decoded through private `*Wire` structs that carry DSM's own
//! field names and are mapped into the camelCase IPC DTOs in `types`.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire::string_param;
use serde::Deserialize;
use std::collections::BTreeMap;

const SCAN_STATUS: &str = "SYNO.Core.SecurityScan.Status";
const AUTO_BLOCK: &str = "SYNO.Core.Security.AutoBlock";
const AUTO_BLOCK_RULES: &str = "SYNO.Core.Security.AutoBlock.Rules";
const CERTIFICATE: &str = "SYNO.Core.Certificate.CRT";

/// Minutes in one of DSM's `expire_day` days.
const MINUTES_PER_DAY: u32 = 24 * 60;

/// Security Advisor status (`SYNO.Core.SecurityScan.Status` `system_get`):
/// `{"items":{"malware":{"failSeverity":"safe","fail":{...}},...},
/// "lastScanTime":"1588298442","sysProgress":100,"sysStatus":"safe"}`.
#[derive(Deserialize)]
struct ScanWire {
    #[serde(rename = "sysStatus")]
    sys_status: Option<String>,
    #[serde(rename = "sysProgress")]
    sys_progress: Option<u32>,
    #[serde(
        rename = "lastScanTime",
        default,
        deserialize_with = "crate::wire::opt_i64_lenient"
    )]
    last_scan_time: Option<i64>,
    items: Option<BTreeMap<String, ScanItemWire>>,
}

#[derive(Deserialize)]
struct ScanItemWire {
    #[serde(rename = "failSeverity")]
    fail_severity: Option<String>,
    fail: Option<ScanFailWire>,
}

#[derive(Deserialize)]
struct ScanFailWire {
    danger: Option<u32>,
    risk: Option<u32>,
    warning: Option<u32>,
    info: Option<u32>,
    #[serde(rename = "outOfDate")]
    out_of_date: Option<u32>,
}

/// The decoded overview. The mapping runs inside serde, so a body that is not
/// a Security Advisor status keeps the closed `json_schema` diagnostic.
#[derive(Deserialize)]
#[serde(try_from = "ScanWire")]
struct ScanOverview(SecurityOverview);

impl TryFrom<ScanWire> for ScanOverview {
    type Error = &'static str;

    fn try_from(scan: ScanWire) -> Result<Self, Self::Error> {
        if scan.sys_status.is_none()
            && scan.sys_progress.is_none()
            && scan.last_scan_time.is_none()
            && scan.items.is_none()
        {
            return Err("expected a Security Advisor status");
        }
        let categories = scan.items.map(|items| {
            items
                .into_iter()
                .map(|(category, item)| {
                    let fail = item.fail;
                    SecurityScanCategory {
                        category,
                        severity: item.fail_severity,
                        danger: fail.as_ref().and_then(|fail| fail.danger),
                        risk: fail.as_ref().and_then(|fail| fail.risk),
                        warning: fail.as_ref().and_then(|fail| fail.warning),
                        info: fail.as_ref().and_then(|fail| fail.info),
                        out_of_date: fail.as_ref().and_then(|fail| fail.out_of_date),
                    }
                })
                .collect()
        });
        // Auto block, firewall and HTTPS state live in other APIs; this answer
        // does not report them, so they stay unknown instead of `false`.
        Ok(Self(SecurityOverview {
            auto_block_enabled: None,
            firewall_enabled: None,
            https_enabled: None,
            advisor_score: None,
            blocked_ips: None,
            certificate_info: None,
            scan_status: scan.sys_status,
            scan_progress: scan.sys_progress,
            last_scan_time: scan.last_scan_time,
            categories,
        }))
    }
}

/// Auto block settings (`SYNO.Core.Security.AutoBlock` `get`):
/// `{"attempts":10,"enable":true,"expire_day":0,"within_mins":5}`.
#[derive(Deserialize)]
struct AutoBlockWire {
    enable: bool,
    attempts: u32,
    within_mins: u32,
    expire_day: u32,
}

impl From<AutoBlockWire> for AutoBlockConfig {
    fn from(config: AutoBlockWire) -> Self {
        Self {
            enabled: config.enable,
            attempts: config.attempts,
            within_minutes: config.within_mins,
            // `expire_day: 0` is DSM's "never expire": a live NAS owner's
            // automation (KastnerRG krg-infra synology_security role, MIT)
            // manages permanent blocks through it.
            block_forever: config.expire_day == 0,
            expire_minutes: config
                .expire_day
                .checked_mul(MINUTES_PER_DAY)
                .filter(|minutes| *minutes > 0),
            expire_days: Some(config.expire_day),
        }
    }
}

/// One blocked address from `SYNO.Core.Security.AutoBlock.Rules` `list`. No
/// public success capture exists (audit S§7 #1), so the time and reason keys
/// accept each spelling DSM clients use.
#[derive(Deserialize)]
struct BlockedIpWire {
    ip: String,
    #[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]
    recordtime: Option<String>,
    #[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]
    blocked_at: Option<String>,
    #[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]
    time: Option<String>,
    reason: Option<String>,
    meta: Option<String>,
}

impl From<BlockedIpWire> for BlockedIp {
    fn from(row: BlockedIpWire) -> Self {
        let non_empty = |text: &String| !text.is_empty();
        Self {
            ip: row.ip,
            blocked_at: [row.recordtime, row.blocked_at, row.time]
                .into_iter()
                .flatten()
                .find(non_empty),
            reason: [row.reason, row.meta].into_iter().flatten().find(non_empty),
        }
    }
}

pub struct SecurityManager;

impl SecurityManager {
    /// Get the Security Advisor status: scan state, progress, last scan time
    /// and the findings per category.
    pub async fn get_overview(client: &SynoClient) -> SynologyResult<SecurityOverview> {
        let v = client.best_version(SCAN_STATUS, 1).unwrap_or(1);
        client
            .api_call::<ScanOverview>(SCAN_STATUS, v, "system_get", &[])
            .await
            .map(|overview| overview.0)
    }

    /// Run security scan.
    pub async fn run_scan(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version(SCAN_STATUS, 1).unwrap_or(1);
        client
            .api_post_void(SCAN_STATUS, v, "system_scan", &[])
            .await
    }

    // ─── Auto-Block ──────────────────────────────────────────────

    /// Get auto-block configuration.
    pub async fn get_auto_block_config(client: &SynoClient) -> SynologyResult<AutoBlockConfig> {
        let v = client.best_version(AUTO_BLOCK, 1).unwrap_or(1);
        client
            .api_call::<AutoBlockWire>(AUTO_BLOCK, v, "get", &[])
            .await
            .map(AutoBlockConfig::from)
    }

    /// Set auto-block configuration.
    pub async fn set_auto_block_config(
        client: &SynoClient,
        enabled: bool,
        attempts: u32,
        within_minutes: u32,
        expire_days: u32,
    ) -> SynologyResult<()> {
        let v = client.best_version(AUTO_BLOCK, 1).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        let att = attempts.to_string();
        let within = within_minutes.to_string();
        let exp = expire_days.to_string();
        client
            .api_post_void(
                AUTO_BLOCK,
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
    ///
    /// DSM answers `list` without parameters with error 5100 (DSM 7.4 probe,
    /// pmilano1 `probed/core-security.md`; a live NAS, KastnerRG krg-infra).
    /// The page and deny-list parameters below are **unverified** (audit S§7
    /// #1): no public client documents them. Any DSM error, 5100 included,
    /// propagates with its code and diagnostic; it is never an empty list.
    pub async fn list_blocked_ips(client: &SynoClient) -> SynologyResult<Vec<BlockedIp>> {
        let v = client.best_version(AUTO_BLOCK_RULES, 1).unwrap_or(1);
        let deny = string_param(client, AUTO_BLOCK_RULES, "deny");
        let rows = client
            .api_list::<BlockedIpWire>(
                AUTO_BLOCK_RULES,
                v,
                "list",
                &[("offset", "0"), ("limit", "1000"), ("type", &deny)],
                &["ip_info", "items", "rules", "list"],
            )
            .await?;
        Ok(rows.into_iter().map(BlockedIp::from).collect())
    }

    /// Unblock an IP address.
    pub async fn unblock_ip(client: &SynoClient, ip: &str) -> SynologyResult<()> {
        let v = client.best_version(AUTO_BLOCK_RULES, 1).unwrap_or(1);
        client
            .api_post_void(AUTO_BLOCK_RULES, v, "delete", &[("ip", ip)])
            .await
    }

    /// Block an IP address manually.
    pub async fn block_ip(client: &SynoClient, ip: &str) -> SynologyResult<()> {
        let v = client.best_version(AUTO_BLOCK_RULES, 1).unwrap_or(1);
        client
            .api_post_void(AUTO_BLOCK_RULES, v, "add", &[("ip", ip)])
            .await
    }

    // ─── Certificates ────────────────────────────────────────────

    /// List SSL certificates (`{"certificates":[...]}`; tailscale
    /// `configure-synology-cert.go`, certimate `synologydsm/models.go`).
    pub async fn list_certificates(client: &SynoClient) -> SynologyResult<Vec<CertificateInfo>> {
        let v = client.best_version(CERTIFICATE, 1).unwrap_or(1);
        client
            .api_list(CERTIFICATE, v, "list", &[], &["certificates"])
            .await
    }

    /// Get certificate details.
    pub async fn get_certificate(client: &SynoClient, id: &str) -> SynologyResult<CertificateInfo> {
        let v = client.best_version(CERTIFICATE, 1).unwrap_or(1);
        client.api_call(CERTIFICATE, v, "get", &[("id", id)]).await
    }

    /// Delete a certificate.
    pub async fn delete_certificate(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client.best_version(CERTIFICATE, 1).unwrap_or(1);
        client
            .api_post_void(CERTIFICATE, v, "delete", &[("id", id)])
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
        let v = client.best_version(AUTO_BLOCK, 1).unwrap_or(1);
        client.api_call(AUTO_BLOCK, v, "get", &[]).await
    }
}
