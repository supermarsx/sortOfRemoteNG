//! `.ovpn` file parsing, generation, validation, and templating.

use crate::openvpn::types::*;
use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Config parsing (.ovpn → OpenVpnConfig)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse an `.ovpn` configuration file into our structured config.
pub fn parse_ovpn(content: &str) -> Result<OpenVpnConfig, String> {
    let mut cfg = OpenVpnConfig::default();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let raw = lines[i].trim();
        // Skip comments and blank lines
        if raw.is_empty() || raw.starts_with('#') || raw.starts_with(';') {
            i += 1;
            continue;
        }

        let parts: Vec<&str> = raw.splitn(2, char::is_whitespace).collect();
        let directive = parts[0].to_lowercase();
        let args: Vec<&str> = if parts.len() > 1 {
            parts[1].split_whitespace().collect()
        } else {
            Vec::new()
        };

        match directive.as_str() {
            // ── Remote endpoints ──────────────────────────────
            "remote" => {
                if let Some(host) = args.first() {
                    let port = args.get(1).and_then(|p| p.parse().ok()).unwrap_or(1194);
                    let proto = args
                        .get(2)
                        .map(|p| VpnProtocol::from_str_loose(p))
                        .unwrap_or(VpnProtocol::Udp);
                    cfg.remotes.push(RemoteEndpoint {
                        host: host.to_string(),
                        port,
                        protocol: proto,
                    });
                }
            }
            "remote-random" => cfg.remote_random = true,
            "resolv-retry" => {
                if args.first().map(|a| *a) == Some("infinite") {
                    cfg.resolve_retry_infinite = true;
                }
            }

            // ── Device ────────────────────────────────────────
            "dev" => {
                if let Some(dev) = args.first() {
                    if dev.starts_with("tap") {
                        cfg.device_type = DeviceType::Tap;
                    } else {
                        cfg.device_type = DeviceType::Tun;
                    }
                    if dev.len() > 3 {
                        cfg.device_name = Some(dev.to_string());
                    }
                }
            }
            "dev-type" => {
                if args.first().map(|a| *a) == Some("tap") {
                    cfg.device_type = DeviceType::Tap;
                }
            }

            // ── Protocol ──────────────────────────────────────
            "proto" => {
                if let Some(p) = args.first() {
                    let proto = VpnProtocol::from_str_loose(p);
                    // Apply to last remote or as default
                    if let Some(r) = cfg.remotes.last_mut() {
                        r.protocol = proto;
                    }
                }
            }
            "port" => {
                if let Some(p) = args.first().and_then(|p| p.parse().ok()) {
                    if let Some(r) = cfg.remotes.last_mut() {
                        r.port = p;
                    }
                }
            }

            // ── Cipher / auth ─────────────────────────────────
            "cipher" => {
                if let Some(c) = args.first() {
                    cfg.cipher = Cipher::from_str_loose(c);
                }
            }
            "data-ciphers" | "ncp-ciphers" => {
                if let Some(list) = args.first() {
                    cfg.data_ciphers = list.split(':').map(|c| Cipher::from_str_loose(c)).collect();
                }
            }
            "auth" => {
                if let Some(a) = args.first() {
                    cfg.auth_digest = AuthDigest::from_str_loose(a);
                }
            }

            // ── TLS ───────────────────────────────────────────
            "tls-auth" => {
                let key = args.first().map(|p| p.to_string()).unwrap_or_default();
                let dir = args.get(1).and_then(|d| d.parse().ok());
                cfg.tls_mode = TlsMode::TlsAuth {
                    key_path: key,
                    direction: dir,
                };
            }
            "tls-crypt" => {
                let key = args.first().map(|p| p.to_string()).unwrap_or_default();
                cfg.tls_mode = TlsMode::TlsCrypt { key_path: key };
            }
            "tls-crypt-v2" => {
                let key = args.first().map(|p| p.to_string()).unwrap_or_default();
                cfg.tls_mode = TlsMode::TlsCryptV2 { key_path: key };
            }
            "tls-version-min" => {
                if let Some(v) = args.first() {
                    cfg.tls_version_min = Some(v.to_string());
                }
            }
            "tls-cipher" => {
                cfg.tls_cipher = parts.get(1).map(|s| s.to_string());
            }

            // ── Authentication ────────────────────────────────
            "auth-user-pass" => {
                cfg.auth_user_pass = true;
                if let Some(path) = args.first() {
                    cfg.auth_file = Some(path.to_string());
                }
            }
            "ca" => cfg.ca_cert = args.first().map(|p| p.to_string()),
            "cert" => cfg.client_cert = args.first().map(|p| p.to_string()),
            "key" => cfg.client_key = args.first().map(|p| p.to_string()),
            "pkcs12" => cfg.pkcs12 = args.first().map(|p| p.to_string()),
            "verify-x509-name" => {
                cfg.verify_x509_name = parts.get(1).map(|s| s.to_string());
            }
            "remote-cert-tls" => {
                cfg.remote_cert_tls = args.first().map(|a| *a) != Some("none");
            }

            // ── Network tuning ────────────────────────────────
            "tun-mtu" => cfg.mtu = args.first().and_then(|p| p.parse().ok()),
            "mssfix" => cfg.mss_fix = args.first().and_then(|p| p.parse().ok()),
            "fragment" => cfg.fragment = args.first().and_then(|p| p.parse().ok()),
            "sndbuf" => cfg.sndbuf = args.first().and_then(|p| p.parse().ok()),
            "rcvbuf" => cfg.rcvbuf = args.first().and_then(|p| p.parse().ok()),
            "compress" => {
                cfg.compression = args
                    .first()
                    .map(|c| Compression::from_str_loose(c))
                    .unwrap_or(Compression::Lz4);
            }
            "comp-lzo" => cfg.compression = Compression::Lzo,

            // ── Keep-alive / timeouts ─────────────────────────
            "keepalive" => {
                cfg.keepalive_interval = args.first().and_then(|p| p.parse().ok());
                cfg.keepalive_timeout = args.get(1).and_then(|p| p.parse().ok());
            }
            "connect-timeout" => {
                cfg.connect_timeout = args.first().and_then(|p| p.parse().ok());
            }
            "connect-retry" => {
                cfg.connect_retry = args.first().and_then(|p| p.parse().ok());
            }
            "connect-retry-max" => {
                cfg.connect_retry_max = args.first().and_then(|p| p.parse().ok());
            }
            "server-poll-timeout" => {
                cfg.server_poll_timeout = args.first().and_then(|p| p.parse().ok());
            }
            "hand-window" => cfg.hand_window = args.first().and_then(|p| p.parse().ok()),
            "tran-window" => cfg.tran_window = args.first().and_then(|p| p.parse().ok()),
            "inactive" => cfg.inactive_timeout = args.first().and_then(|p| p.parse().ok()),

            // ── Routing ───────────────────────────────────────
            "pull" => cfg.pull_routes = true,
            "route-nopull" | "route-no-pull" => {
                cfg.route_no_pull = true;
                cfg.pull_routes = false;
            }
            "redirect-gateway" => cfg.redirect_gateway = true,
            "route" => {
                if args.len() >= 2 {
                    cfg.routes.push(RouteEntry {
                        network: args[0].to_string(),
                        netmask: args[1].to_string(),
                        gateway: args.get(2).map(|g| g.to_string()),
                        metric: args.get(3).and_then(|m| m.parse().ok()),
                    });
                }
            }
            "route-ipv6" => {
                if let Some(network_str) = args.first() {
                    let parts_net: Vec<&str> = network_str.split('/').collect();
                    cfg.ipv6_routes.push(Ipv6RouteEntry {
                        network: parts_net[0].to_string(),
                        prefix_len: parts_net.get(1).and_then(|p| p.parse().ok()).unwrap_or(64),
                        gateway: args.get(1).map(|g| g.to_string()),
                    });
                }
            }

            // ── DNS ───────────────────────────────────────────
            "dhcp-option" => {
                if args.len() >= 2 {
                    match args[0].to_uppercase().as_str() {
                        "DNS" => cfg.dns_servers.push(args[1].to_string()),
                        "DOMAIN" | "DOMAIN-SEARCH" => {
                            cfg.search_domains.push(args[1].to_string());
                        }
                        _ => {}
                    }
                }
            }
            "block-outside-dns" => cfg.block_outside_dns = true,

            // ── Proxy ─────────────────────────────────────────
            "http-proxy" => {
                if args.len() >= 2 {
                    cfg.http_proxy = Some(ProxyConfig {
                        host: args[0].to_string(),
                        port: args[1].parse().unwrap_or(8080),
                        username: args.get(2).map(|u| u.to_string()),
                        password: args.get(3).map(|p| p.to_string()),
                    });
                }
            }
            "socks-proxy" => {
                if args.len() >= 2 {
                    cfg.socks_proxy = Some(ProxyConfig {
                        host: args[0].to_string(),
                        port: args[1].parse().unwrap_or(1080),
                        username: None,
                        password: None,
                    });
                }
            }

            // ── Management ────────────────────────────────────
            "management" => {
                cfg.management_addr = args.first().map(|a| a.to_string());
                cfg.management_port = args.get(1).and_then(|p| p.parse().ok());
            }

            // ── Logging ───────────────────────────────────────
            "verb" | "verbosity" => {
                cfg.verbosity = args.first().and_then(|v| v.parse().ok()).unwrap_or(3);
            }
            "mute" => cfg.mute = args.first().and_then(|m| m.parse().ok()),
            "log" | "log-append" => cfg.log_file = args.first().map(|p| p.to_string()),

            // ── Misc flags ────────────────────────────────────
            "persist-tun" => cfg.persist_tun = true,
            "persist-key" => cfg.persist_key = true,
            "nobind" => cfg.nobind = true,
            "float" => cfg.float = true,
            "passtos" => cfg.passtos = true,
            "fast-io" => cfg.fast_io = true,
            "allow-pull-fqdn" => cfg.allow_pull_fqdn = true,
            "client" => {} // implied
            "pull-filter" | "setenv" | "up" | "down" | "script-security" | "user"
            | "group" | "chroot" | "daemon" => {
                // Recognised but stored as custom
                cfg.custom_directives.push(raw.to_string());
            }

            // ── Inline blocks ─────────────────────────────────
            "<ca>" => {
                let block = collect_inline_block(&lines, &mut i, "</ca>");
                cfg.inline_ca = Some(block);
            }
            "<cert>" => {
                let block = collect_inline_block(&lines, &mut i, "</cert>");
                cfg.inline_cert = Some(block);
            }
            "<key>" => {
                let block = collect_inline_block(&lines, &mut i, "</key>");
                cfg.inline_key = Some(block);
            }
            "<tls-auth>" => {
                let block = collect_inline_block(&lines, &mut i, "</tls-auth>");
                cfg.inline_tls_auth = Some(block);
                cfg.tls_mode = TlsMode::TlsAuth {
                    key_path: String::new(),
                    direction: None,
                };
            }
            "<tls-crypt>" => {
                let block = collect_inline_block(&lines, &mut i, "</tls-crypt>");
                cfg.inline_tls_crypt = Some(block);
                cfg.tls_mode = TlsMode::TlsCrypt {
                    key_path: String::new(),
                };
            }

            // ── Unknown → custom ──────────────────────────────
            _ => {
                cfg.custom_directives.push(raw.to_string());
            }
        }

        i += 1;
    }

    Ok(cfg)
}

/// Collect lines between current position and the closing tag.
fn collect_inline_block(lines: &[&str], i: &mut usize, end_tag: &str) -> String {
    let mut buf = String::new();
    *i += 1;
    while *i < lines.len() && lines[*i].trim() != end_tag {
        buf.push_str(lines[*i]);
        buf.push('\n');
        *i += 1;
    }
    buf
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Config generation (OpenVpnConfig → .ovpn text)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate a complete `.ovpn` config string from structured config.
pub fn generate_ovpn(cfg: &OpenVpnConfig) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push("# Generated by SortOfRemoteNG".to_string());
    lines.push("client".to_string());

    // Device
    let dev_str = match cfg.device_type {
        DeviceType::Tun => "tun",
        DeviceType::Tap => "tap",
    };
    if let Some(name) = &cfg.device_name {
        lines.push(format!("dev {}", name));
    } else {
        lines.push(format!("dev {}", dev_str));
    }

    // Remotes
    for r in &cfg.remotes {
        lines.push(format!("remote {} {} {}", r.host, r.port, r.protocol));
    }
    if cfg.remote_random {
        lines.push("remote-random".to_string());
    }
    if cfg.resolve_retry_infinite {
        lines.push("resolv-retry infinite".to_string());
    }

    // Cipher / auth
    lines.push(format!("cipher {}", cfg.cipher));
    if !cfg.data_ciphers.is_empty() {
        let dc: Vec<String> = cfg.data_ciphers.iter().map(|c| c.to_string()).collect();
        lines.push(format!("data-ciphers {}", dc.join(":")));
    }
    if !cfg.cipher.is_aead() {
        lines.push(format!("auth {}", cfg.auth_digest));
    }

    // TLS
    match &cfg.tls_mode {
        TlsMode::None => {}
        TlsMode::TlsAuth { key_path, direction } => {
            if key_path.is_empty() {
                // inline
            } else if let Some(d) = direction {
                lines.push(format!("tls-auth {} {}", key_path, d));
            } else {
                lines.push(format!("tls-auth {}", key_path));
            }
        }
        TlsMode::TlsCrypt { key_path } => {
            if !key_path.is_empty() {
                lines.push(format!("tls-crypt {}", key_path));
            }
        }
        TlsMode::TlsCryptV2 { key_path } => {
            if !key_path.is_empty() {
                lines.push(format!("tls-crypt-v2 {}", key_path));
            }
        }
    }
    if let Some(v) = &cfg.tls_version_min {
        lines.push(format!("tls-version-min {}", v));
    }
    if let Some(tc) = &cfg.tls_cipher {
        lines.push(format!("tls-cipher {}", tc));
    }

    // Authentication
    if cfg.auth_user_pass {
        if let Some(af) = &cfg.auth_file {
            lines.push(format!("auth-user-pass {}", af));
        } else {
            lines.push("auth-user-pass".to_string());
        }
    }
    if let Some(ca) = &cfg.ca_cert {
        lines.push(format!("ca {}", ca));
    }
    if let Some(cert) = &cfg.client_cert {
        lines.push(format!("cert {}", cert));
    }
    if let Some(key) = &cfg.client_key {
        lines.push(format!("key {}", key));
    }
    if let Some(p12) = &cfg.pkcs12 {
        lines.push(format!("pkcs12 {}", p12));
    }
    if cfg.remote_cert_tls {
        lines.push("remote-cert-tls server".to_string());
    }
    if let Some(x509) = &cfg.verify_x509_name {
        lines.push(format!("verify-x509-name {}", x509));
    }

    // Network tuning
    if let Some(mtu) = cfg.mtu {
        lines.push(format!("tun-mtu {}", mtu));
    }
    if let Some(mss) = cfg.mss_fix {
        lines.push(format!("mssfix {}", mss));
    }
    if let Some(frag) = cfg.fragment {
        lines.push(format!("fragment {}", frag));
    }
    if let Some(sb) = cfg.sndbuf {
        lines.push(format!("sndbuf {}", sb));
    }
    if let Some(rb) = cfg.rcvbuf {
        lines.push(format!("rcvbuf {}", rb));
    }
    match cfg.compression {
        Compression::None => {}
        ref c => lines.push(format!("compress {}", c)),
    }

    // Keep-alive
    if let (Some(interval), Some(timeout)) = (cfg.keepalive_interval, cfg.keepalive_timeout) {
        lines.push(format!("keepalive {} {}", interval, timeout));
    }
    if let Some(ct) = cfg.connect_timeout {
        lines.push(format!("connect-timeout {}", ct));
    }
    if let Some(cr) = cfg.connect_retry {
        lines.push(format!("connect-retry {}", cr));
    }
    if let Some(crm) = cfg.connect_retry_max {
        lines.push(format!("connect-retry-max {}", crm));
    }
    if let Some(spt) = cfg.server_poll_timeout {
        lines.push(format!("server-poll-timeout {}", spt));
    }
    if let Some(hw) = cfg.hand_window {
        lines.push(format!("hand-window {}", hw));
    }
    if let Some(tw) = cfg.tran_window {
        lines.push(format!("tran-window {}", tw));
    }
    if let Some(it) = cfg.inactive_timeout {
        lines.push(format!("inactive {}", it));
    }

    // Routing
    if cfg.route_no_pull {
        lines.push("route-nopull".to_string());
    }
    if cfg.redirect_gateway {
        lines.push("redirect-gateway def1".to_string());
    }
    for r in &cfg.routes {
        let mut line = format!("route {} {}", r.network, r.netmask);
        if let Some(gw) = &r.gateway {
            line.push_str(&format!(" {}", gw));
        }
        if let Some(m) = r.metric {
            line.push_str(&format!(" {}", m));
        }
        lines.push(line);
    }
    for r in &cfg.ipv6_routes {
        let mut line = format!("route-ipv6 {}/{}", r.network, r.prefix_len);
        if let Some(gw) = &r.gateway {
            line.push_str(&format!(" {}", gw));
        }
        lines.push(line);
    }

    // DNS
    for dns in &cfg.dns_servers {
        lines.push(format!("dhcp-option DNS {}", dns));
    }
    for domain in &cfg.search_domains {
        lines.push(format!("dhcp-option DOMAIN-SEARCH {}", domain));
    }
    if cfg.block_outside_dns {
        lines.push("block-outside-dns".to_string());
    }

    // Proxy
    if let Some(hp) = &cfg.http_proxy {
        let mut line = format!("http-proxy {} {}", hp.host, hp.port);
        if let Some(u) = &hp.username {
            line.push_str(&format!(" {}", u));
            if let Some(p) = &hp.password {
                line.push_str(&format!(" {}", p));
            }
        }
        lines.push(line);
    }
    if let Some(sp) = &cfg.socks_proxy {
        lines.push(format!("socks-proxy {} {}", sp.host, sp.port));
    }

    // Logging
    lines.push(format!("verb {}", cfg.verbosity));
    if let Some(m) = cfg.mute {
        lines.push(format!("mute {}", m));
    }

    // Misc flags
    if cfg.persist_tun {
        lines.push("persist-tun".to_string());
    }
    if cfg.persist_key {
        lines.push("persist-key".to_string());
    }
    if cfg.nobind {
        lines.push("nobind".to_string());
    }
    if cfg.float {
        lines.push("float".to_string());
    }
    if cfg.passtos {
        lines.push("passtos".to_string());
    }
    if cfg.fast_io {
        lines.push("fast-io".to_string());
    }
    if cfg.allow_pull_fqdn {
        lines.push("allow-pull-fqdn".to_string());
    }

    // Custom directives
    for d in &cfg.custom_directives {
        lines.push(d.clone());
    }

    // Inline blocks
    if let Some(ca) = &cfg.inline_ca {
        lines.push("<ca>".to_string());
        lines.push(ca.trim_end().to_string());
        lines.push("</ca>".to_string());
    }
    if let Some(cert) = &cfg.inline_cert {
        lines.push("<cert>".to_string());
        lines.push(cert.trim_end().to_string());
        lines.push("</cert>".to_string());
    }
    if let Some(key) = &cfg.inline_key {
        lines.push("<key>".to_string());
        lines.push(key.trim_end().to_string());
        lines.push("</key>".to_string());
    }
    if let Some(ta) = &cfg.inline_tls_auth {
        lines.push("<tls-auth>".to_string());
        lines.push(ta.trim_end().to_string());
        lines.push("</tls-auth>".to_string());
    }
    if let Some(tc) = &cfg.inline_tls_crypt {
        lines.push("<tls-crypt>".to_string());
        lines.push(tc.trim_end().to_string());
        lines.push("</tls-crypt>".to_string());
    }

    lines.join("\n") + "\n"
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Config validation result.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Validate an `OpenVpnConfig` for common issues.
pub fn validate_config(cfg: &OpenVpnConfig) -> ValidationResult {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    // Must have at least one remote
    if cfg.remotes.is_empty() && cfg.config_file.is_none() {
        errors.push("No remote server specified".to_string());
    }

    // Check remote ports
    for r in &cfg.remotes {
        if r.host.is_empty() {
            errors.push("Remote host is empty".to_string());
        }
        if r.port == 0 {
            warnings.push(format!("Port 0 for remote {}", r.host));
        }
    }

    // TLS checks
    if cfg.ca_cert.is_none() && cfg.inline_ca.is_none() && cfg.pkcs12.is_none() {
        warnings.push("No CA certificate – connection may fail TLS verification".to_string());
    }

    // Auth checks
    if cfg.auth_user_pass && cfg.username.is_none() && cfg.auth_file.is_none() {
        warnings.push("auth-user-pass enabled but no username or auth file".to_string());
    }

    // Deprecated cipher
    if cfg.cipher == Cipher::BlowfishCbc {
        warnings.push("BF-CBC is deprecated and insecure".to_string());
    }

    // MTU sanity
    if let Some(mtu) = cfg.mtu {
        if mtu < 576 {
            warnings.push("MTU below 576 may cause issues".to_string());
        }
        if mtu > 9000 {
            warnings.push("MTU above 9000 is unusual".to_string());
        }
    }

    // Fragment must be < MTU
    if let (Some(mtu), Some(frag)) = (cfg.mtu, cfg.fragment) {
        if frag >= mtu {
            warnings.push("Fragment size should be less than MTU".to_string());
        }
    }

    // Route-no-pull with redirect-gateway makes no sense
    if cfg.route_no_pull && cfg.redirect_gateway {
        warnings.push("route-nopull and redirect-gateway are contradictory".to_string());
    }

    // Verbosity
    if cfg.verbosity > 11 {
        warnings.push("Verbosity above 11 is extremely noisy".to_string());
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

/// Validate raw `.ovpn` text.
pub fn validate_ovpn(content: &str) -> ValidationResult {
    match parse_ovpn(content) {
        Ok(cfg) => validate_config(&cfg),
        Err(e) => ValidationResult {
            valid: false,
            errors: vec![e],
            warnings: Vec::new(),
        },
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Templating – prebuilt config templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A named config template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigTemplate {
    pub name: String,
    pub description: String,
    pub config: OpenVpnConfig,
}

/// Return a list of built-in templates.
pub fn builtin_templates() -> Vec<ConfigTemplate> {
    vec![
        ConfigTemplate {
            name: "Standard UDP".to_string(),
            description: "Default UDP connection with AES-256-GCM".to_string(),
            config: {
                let mut c = OpenVpnConfig::default();
                c.remotes.push(RemoteEndpoint {
                    host: "vpn.example.com".into(),
                    port: 1194,
                    protocol: VpnProtocol::Udp,
                });
                c
            },
        },
        ConfigTemplate {
            name: "TCP 443 (Firewall Bypass)".to_string(),
            description: "TCP on port 443 to bypass restrictive firewalls".to_string(),
            config: {
                let mut c = OpenVpnConfig::default();
                c.remotes.push(RemoteEndpoint {
                    host: "vpn.example.com".into(),
                    port: 443,
                    protocol: VpnProtocol::Tcp,
                });
                c
            },
        },
        ConfigTemplate {
            name: "Full Tunnel (Redirect Gateway)".to_string(),
            description: "Routes all traffic through VPN, blocks outside DNS".to_string(),
            config: {
                let mut c = OpenVpnConfig::default();
                c.redirect_gateway = true;
                c.block_outside_dns = true;
                c.remotes.push(RemoteEndpoint {
                    host: "vpn.example.com".into(),
                    port: 1194,
                    protocol: VpnProtocol::Udp,
                });
                c
            },
        },
        ConfigTemplate {
            name: "Split Tunnel".to_string(),
            description: "Only routes specified networks through VPN".to_string(),
            config: {
                let mut c = OpenVpnConfig::default();
                c.route_no_pull = true;
                c.pull_routes = false;
                c.routes.push(RouteEntry {
                    network: "10.0.0.0".into(),
                    netmask: "255.0.0.0".into(),
                    gateway: None,
                    metric: None,
                });
                c.routes.push(RouteEntry {
                    network: "172.16.0.0".into(),
                    netmask: "255.240.0.0".into(),
                    gateway: None,
                    metric: None,
                });
                c.remotes.push(RemoteEndpoint {
                    host: "vpn.example.com".into(),
                    port: 1194,
                    protocol: VpnProtocol::Udp,
                });
                c
            },
        },
        ConfigTemplate {
            name: "High Security".to_string(),
            description: "TLS-crypt, SHA512 auth, TLS 1.3 minimum".to_string(),
            config: {
                let mut c = OpenVpnConfig::default();
                c.cipher = Cipher::Aes256Gcm;
                c.auth_digest = AuthDigest::Sha512;
                c.tls_version_min = Some("1.3".to_string());
                c.tls_mode = TlsMode::TlsCrypt { key_path: "tls-crypt.key".into() };
                c.block_outside_dns = true;
                c.redirect_gateway = true;
                c.remotes.push(RemoteEndpoint {
                    host: "vpn.example.com".into(),
                    port: 1194,
                    protocol: VpnProtocol::Udp,
                });
                c
            },
        },
        ConfigTemplate {
            name: "Through HTTP Proxy".to_string(),
            description: "TCP connection through an HTTP proxy".to_string(),
            config: {
                let mut c = OpenVpnConfig::default();
                c.remotes.push(RemoteEndpoint {
                    host: "vpn.example.com".into(),
                    port: 443,
                    protocol: VpnProtocol::Tcp,
                });
                c.http_proxy = Some(ProxyConfig {
                    host: "proxy.corp.local".into(),
                    port: 8080,
                    username: None,
                    password: None,
                });
                c
            },
        },
    ]
}

/// Build a config from a template, applying overrides.
pub fn from_template(
    template_name: &str,
    host: &str,
    port: Option<u16>,
) -> Result<OpenVpnConfig, String> {
    let templates = builtin_templates();
    let tmpl = templates
        .iter()
        .find(|t| t.name.to_lowercase() == template_name.to_lowercase())
        .ok_or_else(|| format!("Template '{}' not found", template_name))?;

    let mut cfg = tmpl.config.clone();
    // Replace placeholder host/port
    for r in &mut cfg.remotes {
        if r.host == "vpn.example.com" {
            r.host = host.to_string();
            if let Some(p) = port {
                r.port = p;
            }
        }
    }
    Ok(cfg)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Config diff
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// A single config difference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigDiff {
    pub field: String,
    pub old_value: String,
    pub new_value: String,
}

/// Compare two configs and return differences.
pub fn diff_configs(a: &OpenVpnConfig, b: &OpenVpnConfig) -> Vec<ConfigDiff> {
    let mut diffs = Vec::new();

    macro_rules! cmp_field {
        ($field:ident) => {
            let a_val = format!("{:?}", a.$field);
            let b_val = format!("{:?}", b.$field);
            if a_val != b_val {
                diffs.push(ConfigDiff {
                    field: stringify!($field).to_string(),
                    old_value: a_val,
                    new_value: b_val,
                });
            }
        };
    }

    cmp_field!(cipher);
    cmp_field!(auth_digest);
    cmp_field!(device_type);
    cmp_field!(compression);
    cmp_field!(mtu);
    cmp_field!(mss_fix);
    cmp_field!(fragment);
    cmp_field!(keepalive_interval);
    cmp_field!(keepalive_timeout);
    cmp_field!(redirect_gateway);
    cmp_field!(route_no_pull);
    cmp_field!(block_outside_dns);
    cmp_field!(verbosity);
    cmp_field!(nobind);
    cmp_field!(persist_tun);
    cmp_field!(persist_key);
    cmp_field!(tls_version_min);
    cmp_field!(auth_user_pass);

    // Compare remotes count
    if a.remotes.len() != b.remotes.len() {
        diffs.push(ConfigDiff {
            field: "remotes".into(),
            old_value: format!("{} endpoint(s)", a.remotes.len()),
            new_value: format!("{} endpoint(s)", b.remotes.len()),
        });
    }

    diffs
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Parsing ──────────────────────────────────────────────────

    #[test]
    fn parse_minimal_ovpn() {
        let ovpn = "remote vpn.example.com 443 tcp\ncipher AES-256-GCM\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.remotes.len(), 1);
        assert_eq!(cfg.remotes[0].host, "vpn.example.com");
        assert_eq!(cfg.remotes[0].port, 443);
        assert_eq!(cfg.remotes[0].protocol, VpnProtocol::Tcp);
        assert_eq!(cfg.cipher, Cipher::Aes256Gcm);
    }

    #[test]
    fn parse_multiple_remotes() {
        let ovpn = "remote a.com 1194\nremote b.com 443 tcp\nremote-random\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.remotes.len(), 2);
        assert!(cfg.remote_random);
    }

    #[test]
    fn parse_keepalive() {
        let cfg = parse_ovpn("keepalive 15 180\n").unwrap();
        assert_eq!(cfg.keepalive_interval, Some(15));
        assert_eq!(cfg.keepalive_timeout, Some(180));
    }

    #[test]
    fn parse_routes() {
        let ovpn = "route 10.0.0.0 255.0.0.0 vpn_gateway\nroute 172.16.0.0 255.240.0.0\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.routes.len(), 2);
        assert_eq!(cfg.routes[0].gateway, Some("vpn_gateway".into()));
        assert!(cfg.routes[1].gateway.is_none());
    }

    #[test]
    fn parse_ipv6_route() {
        let cfg = parse_ovpn("route-ipv6 2001:db8::/32 ::1\n").unwrap();
        assert_eq!(cfg.ipv6_routes.len(), 1);
        assert_eq!(cfg.ipv6_routes[0].prefix_len, 32);
    }

    #[test]
    fn parse_dns_options() {
        let ovpn = "dhcp-option DNS 8.8.8.8\ndhcp-option DNS 8.8.4.4\ndhcp-option DOMAIN example.com\nblock-outside-dns\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.dns_servers.len(), 2);
        assert_eq!(cfg.search_domains.len(), 1);
        assert!(cfg.block_outside_dns);
    }

    #[test]
    fn parse_tls_crypt() {
        let cfg = parse_ovpn("tls-crypt tc.key\n").unwrap();
        assert!(matches!(cfg.tls_mode, TlsMode::TlsCrypt { .. }));
    }

    #[test]
    fn parse_tls_auth_with_direction() {
        let cfg = parse_ovpn("tls-auth ta.key 1\n").unwrap();
        if let TlsMode::TlsAuth { direction, .. } = cfg.tls_mode {
            assert_eq!(direction, Some(1));
        } else {
            panic!("Expected TlsAuth");
        }
    }

    #[test]
    fn parse_inline_ca() {
        let ovpn = "<ca>\nMIICxxx...\nmore lines\n</ca>\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert!(cfg.inline_ca.is_some());
        assert!(cfg.inline_ca.unwrap().contains("MIICxxx"));
    }

    #[test]
    fn parse_compression() {
        let cfg = parse_ovpn("compress lz4\n").unwrap();
        assert_eq!(cfg.compression, Compression::Lz4);
    }

    #[test]
    fn parse_comments_skipped() {
        let ovpn = "# comment\n; another\nremote host 1194\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.remotes.len(), 1);
        assert!(cfg.custom_directives.is_empty());
    }

    #[test]
    fn parse_proxy() {
        let ovpn = "http-proxy proxy.local 8080\nsocks-proxy socks.local 1080\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert!(cfg.http_proxy.is_some());
        assert_eq!(cfg.http_proxy.as_ref().unwrap().port, 8080);
        assert!(cfg.socks_proxy.is_some());
    }

    #[test]
    fn parse_misc_flags() {
        let ovpn = "persist-tun\npersist-key\nnobind\nfloat\nfast-io\npasstos\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert!(cfg.persist_tun);
        assert!(cfg.persist_key);
        assert!(cfg.nobind);
        assert!(cfg.float);
        assert!(cfg.fast_io);
        assert!(cfg.passtos);
    }

    #[test]
    fn parse_mtu_settings() {
        let ovpn = "tun-mtu 1400\nmssfix 1300\nfragment 1200\nsndbuf 524288\nrcvbuf 524288\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.mtu, Some(1400));
        assert_eq!(cfg.mss_fix, Some(1300));
        assert_eq!(cfg.fragment, Some(1200));
        assert_eq!(cfg.sndbuf, Some(524288));
        assert_eq!(cfg.rcvbuf, Some(524288));
    }

    #[test]
    fn parse_auth_user_pass() {
        let cfg = parse_ovpn("auth-user-pass /etc/openvpn/creds.txt\n").unwrap();
        assert!(cfg.auth_user_pass);
        assert_eq!(cfg.auth_file, Some("/etc/openvpn/creds.txt".into()));
    }

    #[test]
    fn parse_empty() {
        let cfg = parse_ovpn("").unwrap();
        assert!(cfg.remotes.is_empty());
    }

    #[test]
    fn parse_data_ciphers() {
        let cfg = parse_ovpn("data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305\n").unwrap();
        assert_eq!(cfg.data_ciphers.len(), 3);
        assert_eq!(cfg.data_ciphers[2], Cipher::ChaCha20Poly1305);
    }

    #[test]
    fn parse_timeouts() {
        let ovpn = "connect-timeout 60\nconnect-retry 10\nconnect-retry-max 5\nserver-poll-timeout 30\ninactive 3600\n";
        let cfg = parse_ovpn(ovpn).unwrap();
        assert_eq!(cfg.connect_timeout, Some(60));
        assert_eq!(cfg.connect_retry, Some(10));
        assert_eq!(cfg.connect_retry_max, Some(5));
        assert_eq!(cfg.server_poll_timeout, Some(30));
        assert_eq!(cfg.inactive_timeout, Some(3600));
    }

    // ── Generation ───────────────────────────────────────────────

    #[test]
    fn generate_roundtrip() {
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "test.example.com".into(),
            port: 443,
            protocol: VpnProtocol::Tcp,
        });
        cfg.cipher = Cipher::Aes256Gcm;
        cfg.redirect_gateway = true;

        let text = generate_ovpn(&cfg);
        assert!(text.contains("remote test.example.com 443 tcp"));
        assert!(text.contains("cipher AES-256-GCM"));
        assert!(text.contains("redirect-gateway def1"));

        // Parse back
        let parsed = parse_ovpn(&text).unwrap();
        assert_eq!(parsed.remotes[0].host, "test.example.com");
        assert_eq!(parsed.cipher, Cipher::Aes256Gcm);
        assert!(parsed.redirect_gateway);
    }

    #[test]
    fn generate_includes_inline_certs() {
        let mut cfg = OpenVpnConfig::default();
        cfg.inline_ca = Some("CERT-DATA\n".into());
        let text = generate_ovpn(&cfg);
        assert!(text.contains("<ca>"));
        assert!(text.contains("CERT-DATA"));
        assert!(text.contains("</ca>"));
    }

    #[test]
    fn generate_with_proxy() {
        let mut cfg = OpenVpnConfig::default();
        cfg.http_proxy = Some(ProxyConfig {
            host: "proxy.local".into(),
            port: 8080,
            username: Some("user".into()),
            password: Some("pass".into()),
        });
        let text = generate_ovpn(&cfg);
        assert!(text.contains("http-proxy proxy.local 8080 user pass"));
    }

    // ── Validation ───────────────────────────────────────────────

    #[test]
    fn validate_no_remote_is_error() {
        let cfg = OpenVpnConfig::default();
        let result = validate_config(&cfg);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("No remote")));
    }

    #[test]
    fn validate_valid_config() {
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "vpn.example.com".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        cfg.inline_ca = Some("CA-DATA".into());
        let result = validate_config(&cfg);
        assert!(result.valid);
    }

    #[test]
    fn validate_deprecated_cipher() {
        let mut cfg = OpenVpnConfig::default();
        cfg.cipher = Cipher::BlowfishCbc;
        cfg.remotes.push(RemoteEndpoint {
            host: "h".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        let result = validate_config(&cfg);
        assert!(result.warnings.iter().any(|w| w.contains("BF-CBC")));
    }

    #[test]
    fn validate_contradictory_routing() {
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint {
            host: "h".into(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        });
        cfg.route_no_pull = true;
        cfg.redirect_gateway = true;
        let result = validate_config(&cfg);
        assert!(result.warnings.iter().any(|w| w.contains("contradictory")));
    }

    #[test]
    fn validate_ovpn_text() {
        let result = validate_ovpn("remote host 1194\n<ca>\ndata\n</ca>\n");
        assert!(result.valid);
    }

    #[test]
    fn validate_mtu_range() {
        let mut cfg = OpenVpnConfig::default();
        cfg.remotes.push(RemoteEndpoint { host: "h".into(), port: 1, protocol: VpnProtocol::Udp });
        cfg.mtu = Some(100);
        let result = validate_config(&cfg);
        assert!(result.warnings.iter().any(|w| w.contains("576")));
    }

    // ── Templates ────────────────────────────────────────────────

    #[test]
    fn builtin_templates_not_empty() {
        let ts = builtin_templates();
        assert!(ts.len() >= 5);
    }

    #[test]
    fn from_template_replaces_host() {
        let cfg = from_template("Standard UDP", "my.vpn.com", Some(443)).unwrap();
        assert_eq!(cfg.remotes[0].host, "my.vpn.com");
        assert_eq!(cfg.remotes[0].port, 443);
    }

    #[test]
    fn from_template_not_found() {
        let result = from_template("nonexistent", "h", None);
        assert!(result.is_err());
    }

    // ── Diff ─────────────────────────────────────────────────────

    #[test]
    fn diff_no_changes() {
        let cfg = OpenVpnConfig::default();
        let diffs = diff_configs(&cfg, &cfg);
        assert!(diffs.is_empty());
    }

    #[test]
    fn diff_detects_changes() {
        let mut a = OpenVpnConfig::default();
        let mut b = a.clone();
        b.cipher = Cipher::Aes128Cbc;
        b.verbosity = 5;
        let diffs = diff_configs(&a, &b);
        assert!(diffs.iter().any(|d| d.field == "cipher"));
        assert!(diffs.iter().any(|d| d.field == "verbosity"));
        a.remotes.push(RemoteEndpoint::default());
        let diffs2 = diff_configs(&a, &b);
        assert!(diffs2.iter().any(|d| d.field == "remotes"));
    }
}
