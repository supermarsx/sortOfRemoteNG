//! Available service/daemon detection and capability matrix building.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Scan for known services and return a list of available services.
pub async fn detect_available_services(host: &OsDetectHost) -> Result<Vec<AvailableService>, OsDetectError> {
    let mut services = Vec::new();

    // If systemd is available, use systemctl list-unit-files for comprehensive listing
    let unit_files = client::shell_exec(
        host,
        "systemctl list-unit-files --type=service --no-pager --no-legend 2>/dev/null",
    ).await;

    if !unit_files.is_empty() {
        for line in unit_files.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let name = parts[0].trim_end_matches(".service").to_string();
                let enabled_str = parts[1];
                let enabled = match enabled_str {
                    "enabled" | "enabled-runtime" => Some(true),
                    "disabled" | "masked" | "static" => Some(false),
                    _ => None,
                };
                let state = enabled_str.to_string();
                services.push(AvailableService {
                    name,
                    unit_type: Some("service".to_string()),
                    state,
                    enabled,
                });
            }
        }
        return Ok(services);
    }

    // Fallback: check well-known service binaries
    let known_services = [
        "sshd", "nginx", "apache2", "httpd", "haproxy", "traefik",
        "docker", "dockerd", "podman", "containerd", "crio",
        "postfix", "dovecot", "sendmail", "exim4",
        "named", "bind9", "dnsmasq", "dhcpd",
        "smbd", "nmbd", "nfsd",
        "mysqld", "mariadbd", "postgres", "redis-server", "mongod",
        "fail2ban-server", "openvpn", "wg", "squid",
        "rsyslogd", "syslog-ng", "crond", "cron", "atd", "anacron",
        "slapd", "ipa", "freeipa",
    ];

    for svc in &known_services {
        if client::has_command(host, svc).await {
            services.push(AvailableService {
                name: svc.to_string(),
                unit_type: None,
                state: "available".to_string(),
                enabled: None,
            });
        }
    }

    Ok(services)
}

/// Build the full ServiceCapabilities matrix.
pub async fn detect_service_capabilities(host: &OsDetectHost) -> Result<ServiceCapabilities, OsDetectError> {
    let mut caps = ServiceCapabilities::default();

    // Init system
    caps.has_systemd = client::has_command(host, "systemctl").await;

    // Container runtimes
    caps.has_docker = client::has_command(host, "docker").await;
    caps.has_podman = client::has_command(host, "podman").await;
    caps.has_lxc = client::has_command(host, "lxc-ls").await || client::has_command(host, "lxc").await;
    caps.has_kvm = client::has_command(host, "virsh").await
        || client::shell_exec(host, "test -e /dev/kvm && echo yes").await.trim() == "yes";

    // Firewall / security
    caps.has_firewalld = client::has_command(host, "firewall-cmd").await;
    caps.has_ufw = client::has_command(host, "ufw").await;
    caps.has_nftables = client::has_command(host, "nft").await;
    caps.has_iptables = client::has_command(host, "iptables").await;
    caps.has_selinux = client::has_command(host, "getenforce").await
        || client::shell_exec(host, "test -d /sys/fs/selinux && echo yes").await.trim() == "yes";
    caps.has_apparmor = client::shell_exec(host, "test -d /sys/kernel/security/apparmor && echo yes").await.trim() == "yes";

    // File sharing
    caps.has_samba = client::has_command(host, "smbd").await;
    caps.has_nfs = client::has_command(host, "nfsd").await
        || client::has_command(host, "exportfs").await;

    // Storage
    caps.has_lvm = client::has_command(host, "lvm").await || client::has_command(host, "lvs").await;
    caps.has_zfs = client::has_command(host, "zfs").await;
    caps.has_mdraid = client::has_command(host, "mdadm").await;
    caps.has_btrfs = client::has_command(host, "btrfs").await;

    // Scheduling
    caps.has_cron = client::has_command(host, "crontab").await;
    caps.has_at = client::has_command(host, "at").await;
    caps.has_anacron = client::has_command(host, "anacron").await;

    // Mail
    caps.has_postfix = client::has_command(host, "postfix").await || client::has_command(host, "postconf").await;
    caps.has_dovecot = client::has_command(host, "dovecot").await;

    // Web servers
    caps.has_nginx = client::has_command(host, "nginx").await;
    caps.has_apache = client::has_command(host, "apache2").await || client::has_command(host, "httpd").await;
    caps.has_haproxy = client::has_command(host, "haproxy").await;
    caps.has_traefik = client::has_command(host, "traefik").await;

    // VPN
    caps.has_openvpn = client::has_command(host, "openvpn").await;
    caps.has_wireguard = client::has_command(host, "wg").await;

    // Security / directory
    caps.has_fail2ban = client::has_command(host, "fail2ban-client").await;
    caps.has_openldap = client::has_command(host, "slapd").await || client::has_command(host, "ldapsearch").await;
    caps.has_freeipa = client::has_command(host, "ipa").await;

    // DNS / DHCP / proxy
    caps.has_bind = client::has_command(host, "named").await;
    caps.has_dhcpd = client::has_command(host, "dhcpd").await;
    caps.has_dnsmasq = client::has_command(host, "dnsmasq").await;
    caps.has_squid = client::has_command(host, "squid").await;

    // Logging
    caps.has_rsyslog = client::has_command(host, "rsyslogd").await;
    caps.has_syslog_ng = client::has_command(host, "syslog-ng").await;
    caps.has_journald = client::has_command(host, "journalctl").await;

    // Bootloader
    caps.has_grub = client::has_command(host, "grub-install").await
        || client::has_command(host, "grub2-install").await;

    // Languages / runtimes
    caps.has_python3 = client::has_command(host, "python3").await;
    caps.has_perl = client::has_command(host, "perl").await;
    caps.has_ruby = client::has_command(host, "ruby").await;
    caps.has_nodejs = client::has_command(host, "node").await;
    caps.has_java = client::has_command(host, "java").await;
    caps.has_php = client::has_command(host, "php").await;
    caps.has_go = client::has_command(host, "go").await;
    caps.has_rust = client::has_command(host, "rustc").await;
    caps.has_gcc = client::has_command(host, "gcc").await;
    caps.has_make = client::has_command(host, "make").await;
    caps.has_git = client::has_command(host, "git").await;

    Ok(caps)
}

/// Check if a specific command is available on the host.
pub async fn check_command_available(host: &OsDetectHost, cmd: &str) -> Result<bool, OsDetectError> {
    Ok(client::has_command(host, cmd).await)
}

/// Detect installed language runtimes with version info.
pub async fn detect_installed_runtimes(
    host: &OsDetectHost,
) -> Result<Vec<(String, String)>, OsDetectError> {
    let runtimes = [
        ("python3", "--version"),
        ("python", "--version"),
        ("node", "--version"),
        ("java", "-version"),
        ("php", "--version"),
        ("ruby", "--version"),
        ("perl", "--version"),
        ("go", "version"),
        ("rustc", "--version"),
        ("dotnet", "--version"),
    ];

    let mut found = Vec::new();
    for (cmd, flag) in &runtimes {
        let output = client::exec_soft(host, cmd, &[flag]).await;
        if !output.is_empty() {
            let version = output.lines().next().unwrap_or("").trim().to_string();
            found.push((cmd.to_string(), version));
        }
    }
    Ok(found)
}

/// Detect installed web servers with version info.
pub async fn detect_web_servers(
    host: &OsDetectHost,
) -> Result<Vec<(String, String)>, OsDetectError> {
    let servers = [
        ("nginx", "-v"),
        ("apache2", "-v"),
        ("httpd", "-v"),
        ("haproxy", "-v"),
        ("traefik", "version"),
        ("caddy", "version"),
        ("lighttpd", "-v"),
    ];

    let mut found = Vec::new();
    for (cmd, flag) in &servers {
        // Some servers print version to stderr
        let (stdout, stderr, code) = client::exec(host, cmd, &[flag]).await.unwrap_or_default();
        if code == 0 || !stderr.is_empty() {
            let output = if stdout.is_empty() { &stderr } else { &stdout };
            let version = output.lines().next().unwrap_or("").trim().to_string();
            if !version.is_empty() {
                found.push((cmd.to_string(), version));
            }
        }
    }
    Ok(found)
}

/// Detect installed database servers.
pub async fn detect_databases(
    host: &OsDetectHost,
) -> Result<Vec<(String, String)>, OsDetectError> {
    let dbs = [
        ("mysql", "--version"),
        ("mariadb", "--version"),
        ("psql", "--version"),
        ("redis-server", "--version"),
        ("mongod", "--version"),
        ("sqlite3", "--version"),
        ("memcached", "-h"),
    ];

    let mut found = Vec::new();
    for (cmd, flag) in &dbs {
        let output = client::exec_soft(host, cmd, &[flag]).await;
        if !output.is_empty() {
            let version = output.lines().next().unwrap_or("").trim().to_string();
            found.push((cmd.to_string(), version));
        }
    }
    Ok(found)
}

/// Detect installed mail services.
pub async fn detect_mail_services(
    host: &OsDetectHost,
) -> Result<Vec<(String, String)>, OsDetectError> {
    let mail = [
        ("postconf", "mail_version"),
        ("dovecot", "--version"),
        ("sendmail", "-d0.1"),
        ("exim4", "-bV"),
    ];

    let mut found = Vec::new();
    for (cmd, flag) in &mail {
        let output = client::exec_soft(host, cmd, &[flag]).await;
        if !output.is_empty() {
            let version = output.lines().next().unwrap_or("").trim().to_string();
            found.push((cmd.to_string(), version));
        }
    }
    Ok(found)
}

/// Detect container runtimes.
pub async fn detect_container_runtimes(
    host: &OsDetectHost,
) -> Result<Vec<(String, String)>, OsDetectError> {
    let runtimes = [
        ("docker", "--version"),
        ("podman", "--version"),
        ("lxc-ls", "--version"),
        ("containerd", "--version"),
        ("crio", "--version"),
        ("nerdctl", "--version"),
    ];

    let mut found = Vec::new();
    for (cmd, flag) in &runtimes {
        let output = client::exec_soft(host, cmd, &[flag]).await;
        if !output.is_empty() {
            let version = output.lines().next().unwrap_or("").trim().to_string();
            found.push((cmd.to_string(), version));
        }
    }
    Ok(found)
}
