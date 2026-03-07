// ── sorng-mac/src/compliance.rs ───────────────────────────────────────────────
//! Security compliance checks — CIS benchmarks, hardening verification.

use crate::client::MacClient;
use crate::error::MacResult;
use crate::types::*;

/// Run a compliance check against a named framework (e.g. "cis", "stig", "custom").
pub async fn check(
    client: &MacClient,
    system_type: &MacSystemType,
    framework: &str,
) -> MacResult<ComplianceResult> {
    let checks = match system_type {
        MacSystemType::SELinux => build_selinux_checks(client).await?,
        MacSystemType::AppArmor => build_apparmor_checks(client).await?,
        _ => vec![ComplianceCheck {
            id: "MAC-001".to_string(),
            title: "MAC system enabled".to_string(),
            description: "A mandatory access control system should be active".to_string(),
            severity: Severity::Critical,
            status: CheckStatus::Fail,
            remediation: Some("Install and enable SELinux or AppArmor".to_string()),
        }],
    };

    let total = checks.len() as u32;
    let passed = checks.iter().filter(|c| c.status == CheckStatus::Pass).count() as u32;
    let failed = checks.iter().filter(|c| c.status == CheckStatus::Fail).count() as u32;
    let warnings = checks
        .iter()
        .filter(|c| c.status == CheckStatus::Warning)
        .count() as u32;
    let score = if total > 0 {
        (passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    Ok(ComplianceResult {
        framework: framework.to_string(),
        total_checks: total,
        passed,
        failed,
        warnings,
        score_percent: score,
        checks,
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

async fn build_selinux_checks(client: &MacClient) -> MacResult<Vec<ComplianceCheck>> {
    let mut checks = Vec::new();

    // Check 1: SELinux enabled
    let mode_out = client.run_command("getenforce").await?;
    let mode = crate::selinux::parse_getenforce(&mode_out);
    checks.push(ComplianceCheck {
        id: "SE-001".to_string(),
        title: "SELinux is enabled".to_string(),
        description: "SELinux must not be disabled".to_string(),
        severity: Severity::Critical,
        status: if mode != SelinuxMode::Disabled {
            CheckStatus::Pass
        } else {
            CheckStatus::Fail
        },
        remediation: Some("Edit /etc/selinux/config and set SELINUX=enforcing, then reboot".to_string()),
    });

    // Check 2: SELinux in enforcing mode
    checks.push(ComplianceCheck {
        id: "SE-002".to_string(),
        title: "SELinux in enforcing mode".to_string(),
        description: "SELinux should be in enforcing mode for production systems".to_string(),
        severity: Severity::High,
        status: if mode == SelinuxMode::Enforcing {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Run: setenforce 1".to_string()),
    });

    // Check 3: No unconfined processes
    let ps_out = client
        .run_command("ps -eZ | grep -c unconfined_t || echo 0")
        .await?;
    let unconfined: u32 = ps_out.trim().parse().unwrap_or(0);
    checks.push(ComplianceCheck {
        id: "SE-003".to_string(),
        title: "Minimize unconfined processes".to_string(),
        description: "Processes running in unconfined_t should be minimized".to_string(),
        severity: Severity::Medium,
        status: if unconfined <= 5 {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Confine services with appropriate SELinux policies".to_string()),
    });

    // Check 4: No recent AVC denials
    let avc_out = client
        .run_command("ausearch -m avc -ts recent 2>/dev/null | grep -c denied || echo 0")
        .await?;
    let denials: u32 = avc_out.trim().parse().unwrap_or(0);
    checks.push(ComplianceCheck {
        id: "SE-004".to_string(),
        title: "No recent AVC denials".to_string(),
        description: "There should be no unresolved AVC denials in recent logs".to_string(),
        severity: Severity::Medium,
        status: if denials == 0 {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Review denials with: ausearch -m avc -ts recent | audit2allow".to_string()),
    });

    // Check 5: SELinux policy is targeted (most common secure default)
    let sestatus_out = client.run_command("sestatus").await?;
    let is_targeted = sestatus_out.to_lowercase().contains("targeted");
    checks.push(ComplianceCheck {
        id: "SE-005".to_string(),
        title: "SELinux policy type is targeted or stricter".to_string(),
        description: "The loaded policy should be 'targeted', 'strict', or 'mls'".to_string(),
        severity: Severity::Low,
        status: if is_targeted {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Verify policy type in /etc/selinux/config".to_string()),
    });

    Ok(checks)
}

async fn build_apparmor_checks(client: &MacClient) -> MacResult<Vec<ComplianceCheck>> {
    let mut checks = Vec::new();

    // Check 1: AppArmor loaded
    let status_out = client.run_sudo_command("aa-status").await?;
    let loaded = status_out.contains("profiles are loaded");
    checks.push(ComplianceCheck {
        id: "AA-001".to_string(),
        title: "AppArmor is loaded".to_string(),
        description: "AppArmor kernel module must be loaded".to_string(),
        severity: Severity::Critical,
        status: if loaded { CheckStatus::Pass } else { CheckStatus::Fail },
        remediation: Some("Install apparmor and ensure it is enabled in the kernel".to_string()),
    });

    // Check 2: All profiles in enforce mode
    let status = crate::apparmor::parse_aa_status(&status_out)?;
    checks.push(ComplianceCheck {
        id: "AA-002".to_string(),
        title: "All profiles in enforce mode".to_string(),
        description: "Profiles in complain mode provide weaker security".to_string(),
        severity: Severity::High,
        status: if status.profiles_complain == 0 {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Move complain profiles to enforce: aa-enforce /etc/apparmor.d/<profile>".to_string()),
    });

    // Check 3: No unconfined processes
    checks.push(ComplianceCheck {
        id: "AA-003".to_string(),
        title: "Minimize unconfined processes".to_string(),
        description: "Unconfined processes are not protected by AppArmor".to_string(),
        severity: Severity::Medium,
        status: if status.processes_unconfined <= 5 {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Create AppArmor profiles for unconfined services".to_string()),
    });

    // Check 4: Profiles loaded
    checks.push(ComplianceCheck {
        id: "AA-004".to_string(),
        title: "Sufficient profiles loaded".to_string(),
        description: "A reasonable number of AppArmor profiles should be loaded".to_string(),
        severity: Severity::Low,
        status: if status.profiles_loaded >= 10 {
            CheckStatus::Pass
        } else {
            CheckStatus::Warning
        },
        remediation: Some("Install additional AppArmor profiles: apt install apparmor-profiles apparmor-profiles-extra".to_string()),
    });

    Ok(checks)
}
