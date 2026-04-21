//! Orchestrator — full, quick, and partial system scans aggregating all detection modules.

use chrono::Utc;

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;
use crate::{
    distro, hardware, init_system, kernel, locale, package_mgr, security, services, shell,
};

/// Run a full system scan — all detection modules — and aggregate into OsCapabilities.
pub async fn full_scan(host: &OsDetectHost) -> Result<OsCapabilities, OsDetectError> {
    let os_family = distro::detect_os_family(host)
        .await
        .unwrap_or(OsFamily::Unknown);

    let distro_result = if os_family == OsFamily::Linux {
        distro::detect_linux_distro(host).await.ok()
    } else {
        None
    };

    let version = match os_family {
        OsFamily::Linux => distro::detect_os_version(host).await.unwrap_or_default(),
        OsFamily::MacOS => distro::detect_macos_version(host).await.unwrap_or_default(),
        OsFamily::FreeBSD | OsFamily::OpenBSD | OsFamily::NetBSD => {
            distro::detect_bsd_version(host).await.unwrap_or_default()
        }
        OsFamily::Windows => distro::detect_windows_version(host)
            .await
            .unwrap_or_default(),
        _ => OsVersion::default(),
    };

    let init = init_system::detect_init_system(host)
        .await
        .unwrap_or(InitSystem::Unknown);
    let pkg_managers = package_mgr::detect_package_managers(host)
        .await
        .unwrap_or_default();
    let default_shell = shell::detect_default_shell(host).await.ok();
    let available_shells = shell::detect_available_shells(host)
        .await
        .unwrap_or_default();
    let kern = kernel::detect_kernel(host).await.ok();
    let arch = kernel::detect_architecture(host)
        .await
        .unwrap_or(Architecture::Unknown("unknown".to_string()));
    let hw = hardware::build_hardware_profile(host).await.ok();
    let loc = locale::detect_system_locale(host).await.ok();
    let sec = security::detect_security_info(host).await.ok();
    let svcs = services::detect_available_services(host)
        .await
        .unwrap_or_default();
    let caps = services::detect_service_capabilities(host)
        .await
        .unwrap_or_default();

    let (uptime, boot_time) = detect_uptime(host).await;
    let (hostname, domain, fqdn) = detect_hostname(host).await;

    Ok(OsCapabilities {
        os_family,
        distro: distro_result,
        version,
        init_system: init,
        package_managers: pkg_managers,
        default_shell,
        available_shells,
        kernel: kern,
        architecture: arch,
        hardware: hw,
        locale: loc,
        security: sec,
        services: svcs,
        capabilities: caps,
        uptime_secs: uptime,
        boot_time,
        hostname,
        domain,
        fqdn,
        detected_at: Utc::now(),
    })
}

/// Quick scan — OS family, distro, version, architecture, init system, and primary package manager only.
pub async fn quick_scan(host: &OsDetectHost) -> Result<OsCapabilities, OsDetectError> {
    let os_family = distro::detect_os_family(host)
        .await
        .unwrap_or(OsFamily::Unknown);

    let distro_result = if os_family == OsFamily::Linux {
        distro::detect_linux_distro(host).await.ok()
    } else {
        None
    };

    let version = match os_family {
        OsFamily::Linux => distro::detect_os_version(host).await.unwrap_or_default(),
        OsFamily::MacOS => distro::detect_macos_version(host).await.unwrap_or_default(),
        OsFamily::FreeBSD | OsFamily::OpenBSD | OsFamily::NetBSD => {
            distro::detect_bsd_version(host).await.unwrap_or_default()
        }
        OsFamily::Windows => distro::detect_windows_version(host)
            .await
            .unwrap_or_default(),
        _ => OsVersion::default(),
    };

    let init = init_system::detect_init_system(host)
        .await
        .unwrap_or(InitSystem::Unknown);
    let arch = kernel::detect_architecture(host)
        .await
        .unwrap_or(Architecture::Unknown("unknown".to_string()));
    let pkg_managers = package_mgr::detect_package_managers(host)
        .await
        .unwrap_or_default();
    let (hostname, domain, fqdn) = detect_hostname(host).await;

    Ok(OsCapabilities {
        os_family,
        distro: distro_result,
        version,
        init_system: init,
        package_managers: pkg_managers,
        default_shell: None,
        available_shells: Vec::new(),
        kernel: None,
        architecture: arch,
        hardware: None,
        locale: None,
        security: None,
        services: Vec::new(),
        capabilities: ServiceCapabilities::default(),
        uptime_secs: None,
        boot_time: None,
        hostname,
        domain,
        fqdn,
        detected_at: Utc::now(),
    })
}

/// Partial scan — only run the selected sections.
pub async fn partial_scan(
    host: &OsDetectHost,
    sections: &[ScanSection],
) -> Result<OsCapabilities, OsDetectError> {
    let mut result = OsCapabilities {
        os_family: OsFamily::Unknown,
        distro: None,
        version: OsVersion::default(),
        init_system: InitSystem::Unknown,
        package_managers: Vec::new(),
        default_shell: None,
        available_shells: Vec::new(),
        kernel: None,
        architecture: Architecture::Unknown("unknown".to_string()),
        hardware: None,
        locale: None,
        security: None,
        services: Vec::new(),
        capabilities: ServiceCapabilities::default(),
        uptime_secs: None,
        boot_time: None,
        hostname: None,
        domain: None,
        fqdn: None,
        detected_at: Utc::now(),
    };

    for section in sections {
        match section {
            ScanSection::OsFamily => {
                result.os_family = distro::detect_os_family(host)
                    .await
                    .unwrap_or(OsFamily::Unknown);
            }
            ScanSection::Distro => {
                if result.os_family == OsFamily::Unknown {
                    result.os_family = distro::detect_os_family(host)
                        .await
                        .unwrap_or(OsFamily::Unknown);
                }
                if result.os_family == OsFamily::Linux {
                    result.distro = distro::detect_linux_distro(host).await.ok();
                }
            }
            ScanSection::Version => {
                if result.os_family == OsFamily::Unknown {
                    result.os_family = distro::detect_os_family(host)
                        .await
                        .unwrap_or(OsFamily::Unknown);
                }
                result.version = match result.os_family {
                    OsFamily::Linux => distro::detect_os_version(host).await.unwrap_or_default(),
                    OsFamily::MacOS => distro::detect_macos_version(host).await.unwrap_or_default(),
                    OsFamily::FreeBSD | OsFamily::OpenBSD | OsFamily::NetBSD => {
                        distro::detect_bsd_version(host).await.unwrap_or_default()
                    }
                    OsFamily::Windows => distro::detect_windows_version(host)
                        .await
                        .unwrap_or_default(),
                    _ => OsVersion::default(),
                };
            }
            ScanSection::InitSystem => {
                result.init_system = init_system::detect_init_system(host)
                    .await
                    .unwrap_or(InitSystem::Unknown);
            }
            ScanSection::PackageManagers => {
                result.package_managers = package_mgr::detect_package_managers(host)
                    .await
                    .unwrap_or_default();
            }
            ScanSection::Shell => {
                result.default_shell = shell::detect_default_shell(host).await.ok();
                result.available_shells = shell::detect_available_shells(host)
                    .await
                    .unwrap_or_default();
            }
            ScanSection::Kernel => {
                result.kernel = kernel::detect_kernel(host).await.ok();
                result.architecture = kernel::detect_architecture(host)
                    .await
                    .unwrap_or(Architecture::Unknown("unknown".to_string()));
            }
            ScanSection::Hardware => {
                result.hardware = hardware::build_hardware_profile(host).await.ok();
            }
            ScanSection::Locale => {
                result.locale = locale::detect_system_locale(host).await.ok();
            }
            ScanSection::Security => {
                result.security = security::detect_security_info(host).await.ok();
            }
            ScanSection::Services => {
                result.services = services::detect_available_services(host)
                    .await
                    .unwrap_or_default();
            }
            ScanSection::Capabilities => {
                result.capabilities = services::detect_service_capabilities(host)
                    .await
                    .unwrap_or_default();
            }
        }
    }

    Ok(result)
}

// ─── Helpers ────────────────────────────────────────────────────────

async fn detect_uptime(host: &OsDetectHost) -> (Option<u64>, Option<chrono::DateTime<Utc>>) {
    // Linux: /proc/uptime
    let uptime_file = client::shell_exec(host, "cat /proc/uptime 2>/dev/null").await;
    if !uptime_file.is_empty() {
        if let Some(secs_str) = uptime_file.split_whitespace().next() {
            if let Ok(secs) = secs_str.parse::<f64>() {
                let uptime = secs as u64;
                let boot = Utc::now() - chrono::Duration::seconds(uptime as i64);
                return (Some(uptime), Some(boot));
            }
        }
    }

    // macOS: sysctl kern.boottime
    let boottime = client::shell_exec(host, "sysctl -n kern.boottime 2>/dev/null").await;
    if boottime.contains("sec =") {
        // "{ sec = 1709827200, usec = 0 }"
        if let Some(sec_str) = boottime.split("sec =").nth(1) {
            let sec_str = sec_str.trim().split(',').next().unwrap_or("");
            if let Ok(ts) = sec_str.trim().parse::<i64>() {
                let boot = chrono::DateTime::from_timestamp(ts, 0).unwrap_or_else(Utc::now);
                let uptime = (Utc::now() - boot).num_seconds().unsigned_abs();
                return (Some(uptime), Some(boot));
            }
        }
    }

    // uptime command fallback
    let uptime_cmd = client::exec_soft(host, "uptime", &["-s"]).await;
    if !uptime_cmd.is_empty() {
        // "2024-03-07 12:00:00" format
        // Just return None for boot_time since parsing is complex
        return (None, None);
    }

    (None, None)
}

async fn detect_hostname(host: &OsDetectHost) -> (Option<String>, Option<String>, Option<String>) {
    let hostname = client::exec_soft(host, "hostname", &["-s"]).await;
    let hostname = if hostname.trim().is_empty() {
        client::exec_soft(host, "hostname", &[]).await
    } else {
        hostname
    };

    let domain = client::exec_soft(host, "hostname", &["-d"]).await;
    let fqdn = client::exec_soft(host, "hostname", &["-f"]).await;

    let h = if hostname.trim().is_empty() {
        None
    } else {
        Some(hostname.trim().to_string())
    };
    let d = if domain.trim().is_empty() {
        None
    } else {
        Some(domain.trim().to_string())
    };
    let f = if fqdn.trim().is_empty() {
        None
    } else {
        Some(fqdn.trim().to_string())
    };

    (h, d, f)
}
