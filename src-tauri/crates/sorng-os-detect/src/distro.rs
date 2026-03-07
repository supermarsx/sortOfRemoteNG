//! Linux distribution and OS family detection.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Determine OS family via `uname -s`.
pub async fn detect_os_family(host: &OsDetectHost) -> Result<OsFamily, OsDetectError> {
    let output = client::exec_soft(host, "uname", &["-s"]).await;
    let kernel = output.trim().to_lowercase();
    let family = match kernel.as_str() {
        "linux" => OsFamily::Linux,
        "darwin" => OsFamily::MacOS,
        "freebsd" => OsFamily::FreeBSD,
        "openbsd" => OsFamily::OpenBSD,
        "netbsd" => OsFamily::NetBSD,
        "sunos" => OsFamily::Solaris,
        "aix" => OsFamily::AIX,
        _ => {
            // Try Windows detection
            let win = client::exec_soft(host, "cmd.exe", &["/C", "ver"]).await;
            if win.to_lowercase().contains("windows") {
                OsFamily::Windows
            } else {
                OsFamily::Unknown
            }
        }
    };
    Ok(family)
}

/// Identify the Linux distribution from release files.
pub async fn detect_linux_distro(host: &OsDetectHost) -> Result<LinuxDistro, OsDetectError> {
    // Try /etc/os-release first (most reliable)
    let os_release = client::shell_exec(host, "cat /etc/os-release 2>/dev/null").await;
    if !os_release.is_empty() {
        if let Some(distro) = parse_os_release_distro(&os_release) {
            return Ok(distro);
        }
    }

    // Fallback: lsb_release
    let lsb = client::exec_soft(host, "lsb_release", &["-is"]).await;
    if !lsb.is_empty() {
        return Ok(distro_from_id(lsb.trim()));
    }

    // Fallback: specific release files
    let redhat = client::shell_exec(host, "cat /etc/redhat-release 2>/dev/null").await;
    if !redhat.is_empty() {
        return Ok(parse_redhat_release(&redhat));
    }

    let debian = client::shell_exec(host, "cat /etc/debian_version 2>/dev/null").await;
    if !debian.is_empty() {
        return Ok(LinuxDistro::Debian);
    }

    let alpine = client::shell_exec(host, "cat /etc/alpine-release 2>/dev/null").await;
    if !alpine.is_empty() {
        return Ok(LinuxDistro::Alpine);
    }

    let gentoo = client::shell_exec(host, "cat /etc/gentoo-release 2>/dev/null").await;
    if !gentoo.is_empty() {
        return Ok(LinuxDistro::Gentoo);
    }

    let arch = client::shell_exec(host, "cat /etc/arch-release 2>/dev/null").await;
    if !arch.is_empty() || client::has_command(host, "pacman").await {
        return Ok(LinuxDistro::Arch);
    }

    Ok(LinuxDistro::Unknown("unidentified".to_string()))
}

/// Full version information for the detected OS.
pub async fn detect_os_version(host: &OsDetectHost) -> Result<OsVersion, OsDetectError> {
    let os_release = client::shell_exec(host, "cat /etc/os-release 2>/dev/null").await;
    if !os_release.is_empty() {
        return Ok(parse_os_release_version(&os_release));
    }

    let lsb = client::exec_soft(host, "lsb_release", &["-rs"]).await;
    if !lsb.is_empty() {
        return Ok(parse_version_string(lsb.trim()));
    }

    Ok(OsVersion::default())
}

/// Detect macOS version via `sw_vers`.
pub async fn detect_macos_version(host: &OsDetectHost) -> Result<OsVersion, OsDetectError> {
    let product_version = client::exec_soft(host, "sw_vers", &["-productVersion"]).await;
    let build_version = client::exec_soft(host, "sw_vers", &["-buildVersion"]).await;
    let product_name = client::exec_soft(host, "sw_vers", &["-productName"]).await;

    let mut ver = parse_version_string(product_version.trim());
    ver.build = Some(build_version.trim().to_string());
    ver.codename = Some(product_name.trim().to_string());
    Ok(ver)
}

/// Detect FreeBSD version.
pub async fn detect_bsd_version(host: &OsDetectHost) -> Result<OsVersion, OsDetectError> {
    let ver_str = client::exec_soft(host, "freebsd-version", &[]).await;
    if !ver_str.is_empty() {
        return Ok(parse_version_string(ver_str.trim()));
    }
    let uname = client::exec_soft(host, "uname", &["-r"]).await;
    Ok(parse_version_string(uname.trim()))
}

/// Detect Windows version via `ver` and `systeminfo`.
pub async fn detect_windows_version(host: &OsDetectHost) -> Result<OsVersion, OsDetectError> {
    let ver = client::exec_soft(host, "cmd.exe", &["/C", "ver"]).await;
    let mut version = OsVersion {
        full_version_string: ver.trim().to_string(),
        ..Default::default()
    };

    // Try to extract version number from "Microsoft Windows [Version 10.0.19045.3803]"
    if let Some(start) = ver.find("Version ") {
        let rest = &ver[start + 8..];
        if let Some(end) = rest.find(']') {
            let ver_num = &rest[..end];
            version = parse_version_string(ver_num);
            version.full_version_string = ver.trim().to_string();
        }
    }

    // Try systeminfo for OS Name
    let sysinfo = client::exec_soft(host, "cmd.exe", &["/C", "systeminfo"]).await;
    for line in sysinfo.lines() {
        let line = line.trim();
        if let Some(name) = line.strip_prefix("OS Name:") {
            version.codename = Some(name.trim().to_string());
        }
    }

    Ok(version)
}

// ─── Helpers ────────────────────────────────────────────────────────

fn parse_os_release_distro(content: &str) -> Option<LinuxDistro> {
    let mut id = None;
    let mut id_like = None;
    for line in content.lines() {
        if let Some(val) = line.strip_prefix("ID=") {
            id = Some(unquote(val));
        } else if let Some(val) = line.strip_prefix("ID_LIKE=") {
            id_like = Some(unquote(val));
        }
    }
    id.map(|i| distro_from_id_with_like(&i, id_like.as_deref()))
}

fn parse_os_release_version(content: &str) -> OsVersion {
    let mut version_id = String::new();
    let mut version_codename = None;
    let mut pretty_name = String::new();

    for line in content.lines() {
        if let Some(val) = line.strip_prefix("VERSION_ID=") {
            version_id = unquote(val);
        } else if let Some(val) = line.strip_prefix("VERSION_CODENAME=") {
            version_codename = Some(unquote(val));
        } else if let Some(val) = line.strip_prefix("PRETTY_NAME=") {
            pretty_name = unquote(val);
        }
    }

    let mut ver = parse_version_string(&version_id);
    ver.codename = version_codename;
    if !pretty_name.is_empty() {
        ver.full_version_string = pretty_name;
    }
    ver
}

fn parse_version_string(s: &str) -> OsVersion {
    let mut ver = OsVersion {
        full_version_string: s.to_string(),
        ..Default::default()
    };
    let parts: Vec<&str> = s.split('.').collect();
    if let Some(major) = parts.first().and_then(|p| p.parse().ok()) {
        ver.major = Some(major);
    }
    if let Some(minor) = parts.get(1).and_then(|p| p.parse().ok()) {
        ver.minor = Some(minor);
    }
    if let Some(patch_str) = parts.get(2) {
        // Patch may contain non-numeric build suffix like "19045"
        if let Ok(p) = patch_str.parse() {
            ver.patch = Some(p);
        } else {
            ver.build = Some(patch_str.to_string());
        }
    }
    if let Some(build) = parts.get(3) {
        ver.build = Some(build.to_string());
    }
    ver
}

fn parse_redhat_release(content: &str) -> LinuxDistro {
    let lower = content.to_lowercase();
    if lower.contains("centos") { LinuxDistro::CentOS }
    else if lower.contains("red hat") { LinuxDistro::RHEL }
    else if lower.contains("rocky") { LinuxDistro::Rocky }
    else if lower.contains("alma") { LinuxDistro::AlmaLinux }
    else if lower.contains("oracle") { LinuxDistro::Oracle }
    else if lower.contains("fedora") { LinuxDistro::Fedora }
    else if lower.contains("amazon") { LinuxDistro::Amazon }
    else { LinuxDistro::Unknown(content.trim().to_string()) }
}

fn distro_from_id(id: &str) -> LinuxDistro {
    distro_from_id_with_like(id, None)
}

fn distro_from_id_with_like(id: &str, id_like: Option<&str>) -> LinuxDistro {
    match id.to_lowercase().as_str() {
        "ubuntu" => LinuxDistro::Ubuntu,
        "debian" => LinuxDistro::Debian,
        "fedora" => LinuxDistro::Fedora,
        "centos" => LinuxDistro::CentOS,
        "rhel" => LinuxDistro::RHEL,
        "rocky" => LinuxDistro::Rocky,
        "almalinux" => LinuxDistro::AlmaLinux,
        "arch" | "archlinux" => LinuxDistro::Arch,
        "manjaro" => LinuxDistro::Manjaro,
        "opensuse" | "opensuse-leap" | "opensuse-tumbleweed" => LinuxDistro::OpenSUSE,
        "sles" | "sled" => LinuxDistro::SLES,
        "gentoo" => LinuxDistro::Gentoo,
        "void" => LinuxDistro::Void,
        "alpine" => LinuxDistro::Alpine,
        "nixos" => LinuxDistro::NixOS,
        "kali" => LinuxDistro::Kali,
        "parrot" => LinuxDistro::ParrotOS,
        "clear-linux-os" => LinuxDistro::Clear,
        "amzn" => LinuxDistro::Amazon,
        "ol" => LinuxDistro::Oracle,
        "photon" => LinuxDistro::PhotonOS,
        "flatcar" => LinuxDistro::Flatcar,
        "coreos" => LinuxDistro::CoreOS,
        "rancheros" => LinuxDistro::RancherOS,
        "mariner" | "cbl-mariner" => LinuxDistro::CBLMariner,
        "wolfi" => LinuxDistro::Wolfi,
        other => {
            // Try ID_LIKE for family mapping
            if let Some(like) = id_like {
                let lower = like.to_lowercase();
                if lower.contains("debian") || lower.contains("ubuntu") {
                    return LinuxDistro::Debian;
                }
                if lower.contains("rhel") || lower.contains("fedora") {
                    return LinuxDistro::RHEL;
                }
                if lower.contains("arch") {
                    return LinuxDistro::Arch;
                }
                if lower.contains("suse") {
                    return LinuxDistro::OpenSUSE;
                }
            }
            LinuxDistro::Unknown(other.to_string())
        }
    }
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').trim_matches('\'').to_string()
}
