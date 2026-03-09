//! NTP implementation detection — discover what time services are running.
use crate::client;
use crate::error::TimeNtpError;
use crate::types::{NtpImplementation, TimeHost};

/// Detect which NTP implementation is active on the host.
pub async fn detect_ntp_implementation(host: &TimeHost) -> Result<NtpImplementation, TimeNtpError> {
    // Check chrony first (most common modern choice)
    if is_service_active(host, "chronyd").await || is_service_active(host, "chrony").await {
        return Ok(NtpImplementation::Chrony);
    }
    // Check classic ntpd
    if is_service_active(host, "ntpd").await || is_service_active(host, "ntp").await {
        return Ok(NtpImplementation::NtpdClassic);
    }
    // Check systemd-timesyncd
    if is_service_active(host, "systemd-timesyncd").await {
        return Ok(NtpImplementation::Systemd);
    }
    // Check OpenNTPD
    if is_service_active(host, "openntpd").await || is_service_active(host, "ntpd").await {
        // Disambiguate: OpenNTPD's binary is typically /usr/sbin/ntpd but from the openntpd package
        if command_exists(host, "ntpctl").await {
            return Ok(NtpImplementation::OpenNTPD);
        }
    }
    // Check Windows (w32tm)
    if command_exists(host, "w32tm").await {
        return Ok(NtpImplementation::Windows);
    }

    Ok(NtpImplementation::Unknown)
}

/// Discover which time-related services are available and/or running.
pub async fn detect_time_services(host: &TimeHost) -> Result<Vec<String>, TimeNtpError> {
    let services_to_check = [
        "chronyd",
        "chrony",
        "ntpd",
        "ntp",
        "systemd-timesyncd",
        "openntpd",
        "ptp4l",
        "phc2sys",
    ];

    let mut found = Vec::new();
    for svc in &services_to_check {
        let (_, _, code) = client::exec(host, "systemctl", &["is-enabled", svc]).await?;
        if code == 0 {
            let active = is_service_active(host, svc).await;
            let status = if active { "active" } else { "inactive" };
            found.push(format!("{svc} ({status})"));
        }
    }

    // Also check for binaries that might exist but not be systemd services
    for bin in &[
        "chronyc",
        "ntpq",
        "ntpctl",
        "timedatectl",
        "hwclock",
        "pmc",
        "w32tm",
    ] {
        if command_exists(host, bin).await {
            let entry = format!("{bin} (available)");
            if !found.iter().any(|f| f.starts_with(bin)) {
                found.push(entry);
            }
        }
    }

    Ok(found)
}

/// Quick check: is NTP synchronised on this host?
pub async fn is_ntp_synced(host: &TimeHost) -> Result<bool, TimeNtpError> {
    // Try timedatectl first (works with any systemd-based NTP)
    let (stdout, _, code) = client::exec(host, "timedatectl", &["status"]).await?;
    if code == 0 {
        for line in stdout.lines() {
            let line = line.trim();
            if (line.starts_with("System clock synchronized")
                || line.starts_with("NTP synchronized"))
                && line.contains("yes")
            {
                return Ok(true);
            }
        }
        // If timedatectl worked but didn't say 'yes', check chronyc or ntpq
    }

    // Try chronyc tracking
    if let Ok((out, _, 0)) = client::exec(host, "chronyc", &["tracking"]).await {
        for line in out.lines() {
            if line.trim().starts_with("Leap status") && !line.contains("Not synchronised") {
                return Ok(true);
            }
        }
    }

    // Try ntpq
    if let Ok((out, _, 0)) = client::exec(host, "ntpq", &["-c", "rv"]).await {
        if out.contains("sync_ntp") || out.contains("sync_pps") {
            return Ok(true);
        }
    }

    Ok(false)
}

// ─── Internal helpers ───────────────────────────────────────────────

async fn is_service_active(host: &TimeHost, service: &str) -> bool {
    matches!(
        client::exec(host, "systemctl", &["is-active", service]).await,
        Ok((stdout, _, 0)) if stdout.trim() == "active"
    )
}

async fn command_exists(host: &TimeHost, cmd: &str) -> bool {
    matches!(client::exec(host, "which", &[cmd]).await, Ok((_, _, 0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Detection relies on executing remote commands, so we just verify
    // the module compiles and the enum variants are correct.
    #[test]
    fn test_ntp_implementation_variants() {
        let impls = vec![
            NtpImplementation::Chrony,
            NtpImplementation::NtpdClassic,
            NtpImplementation::Systemd,
            NtpImplementation::OpenNTPD,
            NtpImplementation::Windows,
            NtpImplementation::Unknown,
        ];
        assert_eq!(impls.len(), 6);
        assert_ne!(NtpImplementation::Chrony, NtpImplementation::NtpdClassic);
    }
}
