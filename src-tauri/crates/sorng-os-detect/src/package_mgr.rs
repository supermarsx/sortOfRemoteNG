//! Package manager detection and package listing.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Detect all available package managers on the host.
pub async fn detect_package_managers(
    host: &OsDetectHost,
) -> Result<Vec<PackageManager>, OsDetectError> {
    let checks: Vec<(&str, PackageManager)> = vec![
        ("apt-get", PackageManager::Apt),
        ("dnf", PackageManager::Dnf),
        ("yum", PackageManager::Yum),
        ("pacman", PackageManager::Pacman),
        ("zypper", PackageManager::Zypper),
        ("emerge", PackageManager::Emerge),
        ("apk", PackageManager::Apk),
        ("nix-env", PackageManager::Nix),
        ("xbps-install", PackageManager::Xbps),
        ("brew", PackageManager::Brew),
        ("pkg", PackageManager::Pkg),
        ("winget", PackageManager::Winget),
        ("choco", PackageManager::Chocolatey),
        ("scoop", PackageManager::Scoop),
        ("flatpak", PackageManager::Flatpak),
        ("snap", PackageManager::Snap),
    ];

    let mut found = Vec::new();
    for (cmd, pm) in checks {
        if client::has_command(host, cmd).await {
            found.push(pm);
        }
    }

    // FreeBSD ports
    let ports = client::shell_exec(host, "test -d /usr/ports && echo yes").await;
    if ports.trim() == "yes" {
        found.push(PackageManager::Ports);
    }

    if found.is_empty() {
        found.push(PackageManager::Unknown);
    }
    Ok(found)
}

/// Determine the primary / default package manager.
pub async fn detect_default_package_manager(
    host: &OsDetectHost,
) -> Result<PackageManager, OsDetectError> {
    let managers = detect_package_managers(host).await?;
    // Priority order: native first
    let priority = [
        PackageManager::Apt,
        PackageManager::Dnf,
        PackageManager::Yum,
        PackageManager::Pacman,
        PackageManager::Zypper,
        PackageManager::Emerge,
        PackageManager::Apk,
        PackageManager::Xbps,
        PackageManager::Nix,
        PackageManager::Pkg,
        PackageManager::Brew,
        PackageManager::Ports,
        PackageManager::Winget,
        PackageManager::Chocolatey,
        PackageManager::Scoop,
    ];
    for pm in &priority {
        if managers.contains(pm) {
            return Ok(pm.clone());
        }
    }
    Ok(managers
        .into_iter()
        .next()
        .unwrap_or(PackageManager::Unknown))
}

/// Count total installed packages.
pub async fn count_installed_packages(host: &OsDetectHost) -> Result<u64, OsDetectError> {
    // Try dpkg
    let dpkg = client::shell_exec(host, "dpkg -l 2>/dev/null | grep '^ii' | wc -l").await;
    if let Ok(n) = dpkg.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // Try rpm
    let rpm = client::shell_exec(host, "rpm -qa 2>/dev/null | wc -l").await;
    if let Ok(n) = rpm.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // Try pacman
    let pac = client::shell_exec(host, "pacman -Q 2>/dev/null | wc -l").await;
    if let Ok(n) = pac.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // Try apk
    let apk = client::shell_exec(host, "apk list --installed 2>/dev/null | wc -l").await;
    if let Ok(n) = apk.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // Try pkg (FreeBSD)
    let pkg = client::shell_exec(host, "pkg info -a 2>/dev/null | wc -l").await;
    if let Ok(n) = pkg.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // Brew
    let brew = client::shell_exec(host, "brew list --formula 2>/dev/null | wc -l").await;
    if let Ok(n) = brew.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    Ok(0)
}

/// List all installed packages.
pub async fn list_installed_packages(
    host: &OsDetectHost,
) -> Result<Vec<InstalledPackageInfo>, OsDetectError> {
    // dpkg (Debian/Ubuntu)
    let dpkg = client::shell_exec(
        host,
        "dpkg-query -W -f='${Package}\\t${Version}\\t${Source}\\n' 2>/dev/null",
    )
    .await;
    if !dpkg.is_empty() {
        return Ok(parse_dpkg_packages(&dpkg));
    }

    // rpm (RHEL/Fedora/SUSE)
    let rpm = client::shell_exec(
        host,
        "rpm -qa --queryformat '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{VENDOR}\\n' 2>/dev/null",
    )
    .await;
    if !rpm.is_empty() {
        return Ok(parse_tab_packages(&rpm));
    }

    // pacman (Arch)
    let pac = client::shell_exec(host, "pacman -Q 2>/dev/null").await;
    if !pac.is_empty() {
        return Ok(parse_pacman_packages(&pac));
    }

    // apk (Alpine)
    let apk = client::shell_exec(host, "apk list --installed 2>/dev/null").await;
    if !apk.is_empty() {
        return Ok(parse_apk_packages(&apk));
    }

    // pkg (FreeBSD)
    let pkg = client::shell_exec(host, "pkg info 2>/dev/null").await;
    if !pkg.is_empty() {
        return Ok(parse_pkg_packages(&pkg));
    }

    Ok(Vec::new())
}

/// Detect configured package sources / repositories.
pub async fn detect_package_sources(host: &OsDetectHost) -> Result<Vec<String>, OsDetectError> {
    let mut sources = Vec::new();

    // APT sources
    let apt = client::shell_exec(
        host,
        "grep -rh '^deb ' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null",
    )
    .await;
    for line in apt.lines() {
        sources.push(line.trim().to_string());
    }

    // YUM/DNF repos
    let yum = client::shell_exec(
        host,
        "yum repolist -q 2>/dev/null || dnf repolist -q 2>/dev/null",
    )
    .await;
    for line in yum.lines().skip(1) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            sources.push(trimmed.to_string());
        }
    }

    // Pacman repos
    let pacman = client::shell_exec(
        host,
        "grep -E '^\\[' /etc/pacman.conf 2>/dev/null | grep -v options",
    )
    .await;
    for line in pacman.lines() {
        sources.push(line.trim().to_string());
    }

    // Zypper repos
    let zypper = client::shell_exec(host, "zypper repos -u 2>/dev/null").await;
    for line in zypper.lines().skip(2) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            sources.push(trimmed.to_string());
        }
    }

    Ok(sources)
}

/// Check if updates are available. Returns the count of upgradable packages.
pub async fn check_updates_available(host: &OsDetectHost) -> Result<u64, OsDetectError> {
    // APT
    let apt = client::shell_exec(
        host,
        "apt list --upgradable 2>/dev/null | grep -c upgradable || true",
    )
    .await;
    if let Ok(n) = apt.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // DNF / YUM
    let dnf = client::shell_exec(
        host,
        "dnf check-update -q 2>/dev/null | grep -c '^[a-zA-Z]' || yum check-update -q 2>/dev/null | grep -c '^[a-zA-Z]' || true",
    ).await;
    if let Ok(n) = dnf.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // Pacman
    let pac = client::shell_exec(host, "pacman -Qu 2>/dev/null | wc -l").await;
    if let Ok(n) = pac.trim().parse::<u64>() {
        if n > 0 {
            return Ok(n);
        }
    }

    // APK
    let apk = client::shell_exec(
        host,
        "apk upgrade --simulate 2>/dev/null | grep -c 'Upgrading' || true",
    )
    .await;
    if let Ok(n) = apk.trim().parse::<u64>() {
        return Ok(n);
    }

    Ok(0)
}

// ─── Parsers ────────────────────────────────────────────────────────

fn parse_dpkg_packages(stdout: &str) -> Vec<InstalledPackageInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.is_empty() {
                return None;
            }
            Some(InstalledPackageInfo {
                name: parts[0].to_string(),
                version: parts.get(1).unwrap_or(&"").to_string(),
                source: parts
                    .get(2)
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty()),
            })
        })
        .collect()
}

fn parse_tab_packages(stdout: &str) -> Vec<InstalledPackageInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.is_empty() {
                return None;
            }
            Some(InstalledPackageInfo {
                name: parts[0].to_string(),
                version: parts.get(1).unwrap_or(&"").to_string(),
                source: parts
                    .get(2)
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty()),
            })
        })
        .collect()
}

fn parse_pacman_packages(stdout: &str) -> Vec<InstalledPackageInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, ' ');
            let name = parts.next()?.to_string();
            let version = parts.next().unwrap_or("").to_string();
            Some(InstalledPackageInfo {
                name,
                version,
                source: None,
            })
        })
        .collect()
}

fn parse_apk_packages(stdout: &str) -> Vec<InstalledPackageInfo> {
    // Format: "package-name-1.2.3-r0 x86_64 {origin} ..."
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.is_empty() {
                return None;
            }
            let full = parts[0];
            // Split name-version at last hyphen before a digit
            let (name, version) = split_apk_name_version(full);
            let source = parts
                .iter()
                .find(|p| p.starts_with('{'))
                .map(|s| s.trim_matches('{').trim_matches('}').to_string());
            Some(InstalledPackageInfo {
                name,
                version,
                source,
            })
        })
        .collect()
}

fn split_apk_name_version(s: &str) -> (String, String) {
    // "curl-8.5.0-r0" -> ("curl", "8.5.0-r0")
    for (i, c) in s.char_indices().rev() {
        if c == '-' {
            let rest = &s[i + 1..];
            if rest.starts_with(|ch: char| ch.is_ascii_digit()) {
                return (s[..i].to_string(), rest.to_string());
            }
        }
    }
    (s.to_string(), String::new())
}

fn parse_pkg_packages(stdout: &str) -> Vec<InstalledPackageInfo> {
    // FreeBSD pkg info: "name-version  description"
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            if parts.is_empty() {
                return None;
            }
            let (name, version) = split_apk_name_version(parts[0]);
            Some(InstalledPackageInfo {
                name,
                version,
                source: None,
            })
        })
        .collect()
}
