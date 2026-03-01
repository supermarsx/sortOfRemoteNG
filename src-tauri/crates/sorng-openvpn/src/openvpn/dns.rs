//! DNS leak prevention, resolver configuration, and platform-specific DNS
//! push/restore helpers for OpenVPN connections.

use crate::openvpn::types::*;
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// DNS configuration for a VPN connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsConfig {
    /// DNS servers pushed by the VPN server.
    pub servers: Vec<String>,
    /// Search domains pushed by the VPN server.
    pub search_domains: Vec<String>,
    /// Block DNS requests outside the tunnel (leak prevention).
    pub block_outside_dns: bool,
    /// DNS-over-HTTPS endpoint to use through the tunnel.
    pub doh_endpoint: Option<String>,
    /// Custom DNS suffix for the VPN connection.
    pub dns_suffix: Option<String>,
    /// Flush DNS cache after applying changes.
    pub flush_cache: bool,
}

impl Default for DnsConfig {
    fn default() -> Self {
        Self {
            servers: Vec::new(),
            search_domains: Vec::new(),
            block_outside_dns: false,
            doh_endpoint: None,
            dns_suffix: None,
            flush_cache: true,
        }
    }
}

impl DnsConfig {
    /// Create from DHCP options pushed by OpenVPN server.
    pub fn from_dhcp_options(options: &[DhcpOption]) -> Self {
        let mut cfg = Self::default();
        for opt in options {
            match opt {
                DhcpOption::Dns(server) => cfg.servers.push(server.clone()),
                DhcpOption::Domain(domain) => cfg.search_domains.push(domain.clone()),
                DhcpOption::NbnsServer(_) | DhcpOption::Other(_, _) => {} // not DNS-related
            }
        }
        cfg
    }

    /// Whether we have any DNS servers to apply.
    pub fn has_servers(&self) -> bool {
        !self.servers.is_empty()
    }

    /// Merge with another DNS config (server-pushed + user overrides).
    pub fn merge(&self, overrides: &DnsConfig) -> DnsConfig {
        DnsConfig {
            servers: if overrides.servers.is_empty() {
                self.servers.clone()
            } else {
                overrides.servers.clone()
            },
            search_domains: if overrides.search_domains.is_empty() {
                self.search_domains.clone()
            } else {
                overrides.search_domains.clone()
            },
            block_outside_dns: self.block_outside_dns || overrides.block_outside_dns,
            doh_endpoint: overrides.doh_endpoint.clone().or(self.doh_endpoint.clone()),
            dns_suffix: overrides.dns_suffix.clone().or(self.dns_suffix.clone()),
            flush_cache: self.flush_cache || overrides.flush_cache,
        }
    }
}

/// DHCP options that OpenVPN pushes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DhcpOption {
    Dns(String),
    Domain(String),
    NbnsServer(String),
    Other(String, String),
}

/// Parse a `dhcp-option` line from the OpenVPN log/management output.
pub fn parse_dhcp_option(line: &str) -> Option<DhcpOption> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    // Could be "dhcp-option DNS 8.8.8.8" or just "DNS 8.8.8.8"
    let (key, value) = if parts[0].eq_ignore_ascii_case("dhcp-option") && parts.len() >= 3 {
        (parts[1], parts[2])
    } else if parts.len() >= 2 {
        (parts[0], parts[1])
    } else {
        return None;
    };

    match key.to_uppercase().as_str() {
        "DNS" => Some(DhcpOption::Dns(value.to_string())),
        "DOMAIN" | "DOMAIN-SEARCH" => Some(DhcpOption::Domain(value.to_string())),
        "NBNS" | "WINS" => Some(DhcpOption::NbnsServer(value.to_string())),
        _ => Some(DhcpOption::Other(key.to_string(), value.to_string())),
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Saved DNS state (for restore)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Saved DNS state before VPN was connected, used to restore on disconnect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedDnsState {
    pub interface_name: String,
    pub original_servers: Vec<String>,
    pub original_domains: Vec<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Platform: Windows DNS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Get current DNS servers for an interface (Windows).
pub async fn get_interface_dns_windows(
    interface: &str,
) -> Result<Vec<String>, OpenVpnError> {
    let output = tokio::process::Command::new("netsh")
        .args([
            "interface",
            "ip",
            "show",
            "dns",
            &format!("name={}", interface),
        ])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!("Cannot query DNS for {}: {}", interface, e),
            detail: None,
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_netsh_dns_output(&stdout))
}

/// Parse DNS servers from `netsh interface ip show dns` output.
pub fn parse_netsh_dns_output(output: &str) -> Vec<String> {
    let mut servers = Vec::new();
    let ip_re = regex::Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").unwrap();

    for line in output.lines() {
        let trimmed = line.trim();
        // Lines with DNS servers contain IPs
        if trimmed.contains("DNS") || trimmed.starts_with(char::is_numeric) {
            for cap in ip_re.captures_iter(trimmed) {
                servers.push(cap[1].to_string());
            }
        }
    }

    servers
}

/// Set DNS servers for an interface (Windows).
pub async fn set_dns_windows(
    interface: &str,
    servers: &[String],
) -> Result<(), OpenVpnError> {
    if servers.is_empty() {
        return Ok(());
    }

    // Set primary DNS
    run_netsh(&[
        "interface",
        "ip",
        "set",
        "dns",
        &format!("name={}", interface),
        "static",
        &servers[0],
    ])
    .await?;

    // Add additional DNS servers
    for server in servers.iter().skip(1) {
        run_netsh(&[
            "interface",
            "ip",
            "add",
            "dns",
            &format!("name={}", interface),
            server,
            "index=2",
        ])
        .await?;
    }

    Ok(())
}

/// Restore DNS to DHCP (Windows).
pub async fn restore_dns_dhcp_windows(interface: &str) -> Result<(), OpenVpnError> {
    run_netsh(&[
        "interface",
        "ip",
        "set",
        "dns",
        &format!("name={}", interface),
        "dhcp",
    ])
    .await
}

/// Restore DNS to specific servers (Windows).
pub async fn restore_dns_windows(
    interface: &str,
    servers: &[String],
) -> Result<(), OpenVpnError> {
    if servers.is_empty() {
        return restore_dns_dhcp_windows(interface).await;
    }
    set_dns_windows(interface, servers).await
}

async fn run_netsh(args: &[&str]) -> Result<(), OpenVpnError> {
    let output = tokio::process::Command::new("netsh")
        .args(args)
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!("netsh error: {}", e),
            detail: None,
        })?;
    if !output.status.success() {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!("netsh failed: {}", String::from_utf8_lossy(&output.stderr)),
            detail: None,
        });
    }
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Platform: Linux DNS (resolvconf / systemd-resolved)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Set DNS servers on Linux using resolvconf.
pub async fn set_dns_linux(
    interface: &str,
    servers: &[String],
    search_domains: &[String],
) -> Result<(), OpenVpnError> {
    // Try systemd-resolved first, fall back to resolvconf
    if is_systemd_resolved().await {
        set_dns_systemd_resolved(interface, servers, search_domains).await
    } else {
        set_dns_resolvconf(interface, servers, search_domains).await
    }
}

async fn is_systemd_resolved() -> bool {
    tokio::process::Command::new("systemctl")
        .args(["is-active", "systemd-resolved"])
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

async fn set_dns_systemd_resolved(
    interface: &str,
    servers: &[String],
    search_domains: &[String],
) -> Result<(), OpenVpnError> {
    let mut args = vec!["resolvectl".to_string(), "dns".to_string(), interface.to_string()];
    args.extend(servers.iter().cloned());

    let output = tokio::process::Command::new(&args[0])
        .args(&args[1..])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!("resolvectl error: {}", e),
            detail: None,
        })?;

    if !output.status.success() {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!(
                "resolvectl dns failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
            detail: None,
        });
    }

    // Set search domains
    if !search_domains.is_empty() {
        let mut args = vec![
            "resolvectl".to_string(),
            "domain".to_string(),
            interface.to_string(),
        ];
        args.extend(search_domains.iter().cloned());

        let _ = tokio::process::Command::new(&args[0])
            .args(&args[1..])
            .output()
            .await;
    }

    Ok(())
}

async fn set_dns_resolvconf(
    interface: &str,
    servers: &[String],
    search_domains: &[String],
) -> Result<(), OpenVpnError> {
    let mut content = String::new();
    for s in servers {
        content.push_str(&format!("nameserver {}\n", s));
    }
    if !search_domains.is_empty() {
        content.push_str(&format!("search {}\n", search_domains.join(" ")));
    }

    // Pipe to resolvconf
    let mut child = tokio::process::Command::new("resolvconf")
        .args(["-a", &format!("{}.openvpn", interface)])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!("resolvconf error: {}", e),
            detail: None,
        })?;

    if let Some(stdin) = child.stdin.as_mut() {
        use tokio::io::AsyncWriteExt;
        let _ = stdin.write_all(content.as_bytes()).await;
    }

    let status = child.wait().await.map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::DnsError,
        message: format!("resolvconf wait error: {}", e),
        detail: None,
    })?;

    if !status.success() {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: "resolvconf -a failed".into(),
            detail: None,
        });
    }

    Ok(())
}

/// Restore DNS on Linux.
pub async fn restore_dns_linux(interface: &str) -> Result<(), OpenVpnError> {
    if is_systemd_resolved().await {
        let _ = tokio::process::Command::new("resolvectl")
            .args(["revert", interface])
            .output()
            .await;
    } else {
        let _ = tokio::process::Command::new("resolvconf")
            .args(["-d", &format!("{}.openvpn", interface)])
            .output()
            .await;
    }
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS flush
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Flush the system DNS cache.
pub async fn flush_dns_cache() -> Result<(), OpenVpnError> {
    #[cfg(target_os = "windows")]
    let result = tokio::process::Command::new("ipconfig")
        .args(["/flushdns"])
        .output()
        .await;

    #[cfg(target_os = "linux")]
    let result = tokio::process::Command::new("resolvectl")
        .args(["flush-caches"])
        .output()
        .await;

    #[cfg(target_os = "macos")]
    let result = tokio::process::Command::new("dscacheutil")
        .args(["-flushcache"])
        .output()
        .await;

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    let result: Result<std::process::Output, std::io::Error> = Ok(std::process::Output {
        status: std::process::ExitStatus::default(),
        stdout: Vec::new(),
        stderr: Vec::new(),
    });

    result.map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::DnsError,
        message: format!("DNS flush error: {}", e),
        detail: None,
    })?;

    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS leak prevention (Windows firewall rules)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build the Windows firewall rule to block DNS outside the tunnel.
pub fn build_block_outside_dns_rules(
    allowed_servers: &[String],
    vpn_interface: &str,
) -> Vec<Vec<String>> {
    let mut rules = Vec::new();

    // Block all outbound UDP/TCP port 53
    rules.push(vec![
        "netsh".into(),
        "advfirewall".into(),
        "firewall".into(),
        "add".into(),
        "rule".into(),
        "name=OpenVPN_BlockDNS_Out".into(),
        "dir=out".into(),
        "action=block".into(),
        "protocol=udp".into(),
        "remoteport=53".into(),
    ]);
    rules.push(vec![
        "netsh".into(),
        "advfirewall".into(),
        "firewall".into(),
        "add".into(),
        "rule".into(),
        "name=OpenVPN_BlockDNS_TCP_Out".into(),
        "dir=out".into(),
        "action=block".into(),
        "protocol=tcp".into(),
        "remoteport=53".into(),
    ]);

    // Allow DNS to specific VPN-pushed servers
    for (i, server) in allowed_servers.iter().enumerate() {
        rules.push(vec![
            "netsh".into(),
            "advfirewall".into(),
            "firewall".into(),
            "add".into(),
            "rule".into(),
            format!("name=OpenVPN_AllowDNS_{}", i),
            "dir=out".into(),
            "action=allow".into(),
            "protocol=udp".into(),
            "remoteport=53".into(),
            format!("remoteip={}", server),
        ]);
    }

    let _ = vpn_interface; // might be used for interface-specific rules
    rules
}

/// Remove the DNS-blocking firewall rules.
pub fn build_remove_dns_block_rules() -> Vec<Vec<String>> {
    let mut rules = Vec::new();
    // Remove all our rules by name
    for name in &[
        "OpenVPN_BlockDNS_Out",
        "OpenVPN_BlockDNS_TCP_Out",
    ] {
        rules.push(vec![
            "netsh".into(),
            "advfirewall".into(),
            "firewall".into(),
            "delete".into(),
            "rule".into(),
            format!("name={}", name),
        ]);
    }
    // Also remove numbered allow rules (up to 10)
    for i in 0..10 {
        rules.push(vec![
            "netsh".into(),
            "advfirewall".into(),
            "firewall".into(),
            "delete".into(),
            "rule".into(),
            format!("name=OpenVPN_AllowDNS_{}", i),
        ]);
    }
    rules
}

/// Apply DNS block-outside-dns rules.
pub async fn apply_dns_leak_prevention(
    servers: &[String],
    vpn_interface: &str,
) -> Result<(), OpenVpnError> {
    let rules = build_block_outside_dns_rules(servers, vpn_interface);
    for cmd in &rules {
        if cmd.is_empty() {
            continue;
        }
        let _ = tokio::process::Command::new(&cmd[0])
            .args(&cmd[1..])
            .output()
            .await;
    }
    Ok(())
}

/// Remove DNS leak prevention rules.
pub async fn remove_dns_leak_prevention() -> Result<(), OpenVpnError> {
    let rules = build_remove_dns_block_rules();
    for cmd in &rules {
        if cmd.is_empty() {
            continue;
        }
        let _ = tokio::process::Command::new(&cmd[0])
            .args(&cmd[1..])
            .output()
            .await;
    }
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DNS leak test
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Result of a DNS leak check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLeakResult {
    pub resolved_servers: Vec<String>,
    pub expected_servers: Vec<String>,
    pub is_leaking: bool,
    pub message: String,
}

/// Run a basic DNS leak test by resolving a known domain and checking the resolver.
pub async fn check_dns_leak(
    expected_servers: &[String],
    test_domain: &str,
) -> Result<DnsLeakResult, OpenVpnError> {
    // Use nslookup to see which DNS server answers
    let output = tokio::process::Command::new("nslookup")
        .args([test_domain])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::DnsError,
            message: format!("nslookup error: {}", e),
            detail: None,
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let resolved = parse_nslookup_server(&stdout);

    let is_leaking = if let Some(ref server) = resolved {
        !expected_servers.iter().any(|s| s == server)
    } else {
        true // can't determine = assume risk
    };

    Ok(DnsLeakResult {
        resolved_servers: resolved.into_iter().collect(),
        expected_servers: expected_servers.to_vec(),
        is_leaking,
        message: if is_leaking {
            "DNS leak detected: queries going to unexpected server".into()
        } else {
            "No DNS leak detected".into()
        },
    })
}

/// Parse the server address from nslookup output.
pub fn parse_nslookup_server(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Server:") || trimmed.starts_with("Address:") {
            let ip_re =
                regex::Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").ok()?;
            if let Some(cap) = ip_re.captures(trimmed) {
                return Some(cap[1].to_string());
            }
        }
    }
    None
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Composite: apply/restore DNS for a connection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Apply the full DNS configuration for a VPN connection.
pub async fn apply_dns(
    cfg: &DnsConfig,
    interface: &str,
) -> Result<Option<SavedDnsState>, OpenVpnError> {
    if !cfg.has_servers() {
        return Ok(None);
    }

    let saved = SavedDnsState {
        interface_name: interface.to_string(),
        original_servers: Vec::new(), // would be captured from current state
        original_domains: Vec::new(),
        timestamp: chrono::Utc::now(),
    };

    #[cfg(target_os = "windows")]
    {
        set_dns_windows(interface, &cfg.servers).await?;
        if cfg.block_outside_dns {
            apply_dns_leak_prevention(&cfg.servers, interface).await?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        set_dns_linux(interface, &cfg.servers, &cfg.search_domains).await?;
    }

    if cfg.flush_cache {
        let _ = flush_dns_cache().await;
    }

    Ok(Some(saved))
}

/// Restore DNS to the saved state.
pub async fn restore_dns(saved: &SavedDnsState) -> Result<(), OpenVpnError> {
    #[cfg(target_os = "windows")]
    {
        restore_dns_windows(&saved.interface_name, &saved.original_servers).await?;
        remove_dns_leak_prevention().await?;
    }

    #[cfg(target_os = "linux")]
    {
        restore_dns_linux(&saved.interface_name).await?;
    }

    let _ = flush_dns_cache().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── DnsConfig ────────────────────────────────────────────────

    #[test]
    fn dns_config_default() {
        let c = DnsConfig::default();
        assert!(c.servers.is_empty());
        assert!(!c.block_outside_dns);
        assert!(c.flush_cache);
    }

    #[test]
    fn dns_config_from_dhcp() {
        let opts = vec![
            DhcpOption::Dns("8.8.8.8".into()),
            DhcpOption::Dns("8.8.4.4".into()),
            DhcpOption::Domain("vpn.example.com".into()),
        ];
        let cfg = DnsConfig::from_dhcp_options(&opts);
        assert_eq!(cfg.servers, vec!["8.8.8.8", "8.8.4.4"]);
        assert_eq!(cfg.search_domains, vec!["vpn.example.com"]);
    }

    #[test]
    fn dns_config_has_servers() {
        let mut c = DnsConfig::default();
        assert!(!c.has_servers());
        c.servers.push("1.1.1.1".into());
        assert!(c.has_servers());
    }

    #[test]
    fn dns_config_merge() {
        let base = DnsConfig {
            servers: vec!["8.8.8.8".into()],
            search_domains: vec!["base.com".into()],
            ..Default::default()
        };
        let over = DnsConfig {
            servers: vec!["1.1.1.1".into()],
            block_outside_dns: true,
            ..Default::default()
        };
        let merged = base.merge(&over);
        assert_eq!(merged.servers, vec!["1.1.1.1"]);
        assert_eq!(merged.search_domains, vec!["base.com"]);
        assert!(merged.block_outside_dns);
    }

    #[test]
    fn dns_config_merge_empty_override() {
        let base = DnsConfig {
            servers: vec!["8.8.8.8".into()],
            ..Default::default()
        };
        let over = DnsConfig::default();
        let merged = base.merge(&over);
        assert_eq!(merged.servers, vec!["8.8.8.8"]);
    }

    // ── DHCP option parsing ──────────────────────────────────────

    #[test]
    fn parse_dhcp_dns() {
        let opt = parse_dhcp_option("dhcp-option DNS 8.8.8.8").unwrap();
        assert!(matches!(opt, DhcpOption::Dns(ref s) if s == "8.8.8.8"));
    }

    #[test]
    fn parse_dhcp_domain() {
        let opt = parse_dhcp_option("dhcp-option DOMAIN vpn.example.com").unwrap();
        assert!(matches!(opt, DhcpOption::Domain(ref s) if s == "vpn.example.com"));
    }

    #[test]
    fn parse_dhcp_short_form() {
        let opt = parse_dhcp_option("DNS 8.8.8.8").unwrap();
        assert!(matches!(opt, DhcpOption::Dns(ref s) if s == "8.8.8.8"));
    }

    #[test]
    fn parse_dhcp_nbns() {
        let opt = parse_dhcp_option("dhcp-option WINS 192.168.1.1").unwrap();
        assert!(matches!(opt, DhcpOption::NbnsServer(_)));
    }

    #[test]
    fn parse_dhcp_empty() {
        assert!(parse_dhcp_option("").is_none());
    }

    // ── netsh output parsing ─────────────────────────────────────

    #[test]
    fn parse_netsh_output() {
        let output = r#"
Configuration for interface "Ethernet"
    DNS servers configured through DHCP
        192.168.1.1
        8.8.8.8
"#;
        let servers = parse_netsh_dns_output(output);
        assert_eq!(servers.len(), 2);
        assert!(servers.contains(&"192.168.1.1".to_string()));
        assert!(servers.contains(&"8.8.8.8".to_string()));
    }

    #[test]
    fn parse_netsh_empty() {
        let servers = parse_netsh_dns_output("");
        assert!(servers.is_empty());
    }

    // ── nslookup output parsing ──────────────────────────────────

    #[test]
    fn parse_nslookup_basic() {
        let output = "Server:  dns.local\nAddress:  192.168.1.1\n\nName:    example.com\n";
        let server = parse_nslookup_server(output);
        assert_eq!(server, Some("192.168.1.1".into()));
    }

    #[test]
    fn parse_nslookup_no_match() {
        let server = parse_nslookup_server("Error something");
        assert!(server.is_none());
    }

    // ── Firewall rules ───────────────────────────────────────────

    #[test]
    fn block_dns_rules_generated() {
        let rules = build_block_outside_dns_rules(&["8.8.8.8".into()], "tun0");
        // Should have 2 block rules + 1 allow rule
        assert_eq!(rules.len(), 3);
        let block_udp = &rules[0];
        assert!(block_udp.iter().any(|p| p.contains("block")));
        assert!(block_udp.iter().any(|p| p.contains("udp")));
        let allow = &rules[2];
        assert!(allow.iter().any(|p| p.contains("allow")));
    }

    #[test]
    fn remove_dns_rules_generated() {
        let rules = build_remove_dns_block_rules();
        assert!(rules.len() >= 2);
        for rule in &rules {
            assert!(rule.iter().any(|p| p == "delete"));
        }
    }

    // ── DNS serde ────────────────────────────────────────────────

    #[test]
    fn dns_config_serde_roundtrip() {
        let cfg = DnsConfig {
            servers: vec!["8.8.8.8".into(), "1.1.1.1".into()],
            search_domains: vec!["vpn.test".into()],
            block_outside_dns: true,
            doh_endpoint: Some("https://dns.example.com/dns-query".into()),
            dns_suffix: Some("vpn.local".into()),
            flush_cache: true,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: DnsConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.servers, cfg.servers);
        assert_eq!(back.block_outside_dns, true);
        assert_eq!(back.doh_endpoint, cfg.doh_endpoint);
    }

    #[test]
    fn saved_dns_state_serde() {
        let s = SavedDnsState {
            interface_name: "tun0".into(),
            original_servers: vec!["192.168.1.1".into()],
            original_domains: vec!["local".into()],
            timestamp: chrono::Utc::now(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: SavedDnsState = serde_json::from_str(&json).unwrap();
        assert_eq!(back.interface_name, "tun0");
    }

    // ── DnsLeakResult serde ──────────────────────────────────────

    #[test]
    fn dns_leak_result_serde() {
        let r = DnsLeakResult {
            resolved_servers: vec!["8.8.8.8".into()],
            expected_servers: vec!["10.8.0.1".into()],
            is_leaking: true,
            message: "leak detected".into(),
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: DnsLeakResult = serde_json::from_str(&json).unwrap();
        assert!(back.is_leaking);
    }

    // ── DhcpOption serde ─────────────────────────────────────────

    #[test]
    fn dhcp_option_serde() {
        let variants = vec![
            DhcpOption::Dns("8.8.8.8".into()),
            DhcpOption::Domain("test.com".into()),
            DhcpOption::NbnsServer("10.0.0.1".into()),
            DhcpOption::Other("NTP".into(), "10.0.0.2".into()),
        ];
        for v in &variants {
            let json = serde_json::to_string(v).unwrap();
            let back: DhcpOption = serde_json::from_str(&json).unwrap();
            let json2 = serde_json::to_string(&back).unwrap();
            assert_eq!(json, json2);
        }
    }
}
