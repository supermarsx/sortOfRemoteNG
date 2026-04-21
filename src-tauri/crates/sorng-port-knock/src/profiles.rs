use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::PortKnockError;
use crate::types::{
    FirewallRuleOptions, FwknopClientConfig, HmacAlgorithm, IpVersion, KnockEncryption,
    KnockMethod, KnockOptions, KnockProfile, KnockProtocol, KnockSequence, KnockStep,
    ProfileFormat, SpaOptions, TcpFlags,
};

/// TOML import/export uses a wrapper table because TOML's top-level must be a
/// table, not an array. The JSON format keeps the bare `Vec<KnockProfile>` form
/// for backward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TomlProfileDoc {
    #[serde(default)]
    profiles: Vec<KnockProfile>,
}

/// Manages saved knock profiles.
pub struct ProfileManager {
    profiles: Vec<KnockProfile>,
}

impl Default for ProfileManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProfileManager {
    pub fn new() -> Self {
        Self {
            profiles: Vec::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_profile(
        &mut self,
        name: String,
        description: String,
        method: KnockMethod,
        sequence: Option<KnockSequence>,
        spa_options: Option<SpaOptions>,
        fwknop_config: Option<FwknopClientConfig>,
        firewall_options: Option<FirewallRuleOptions>,
        knock_options: KnockOptions,
        tags: Vec<String>,
    ) -> Result<KnockProfile, PortKnockError> {
        if self.profiles.iter().any(|p| p.name == name) {
            return Err(PortKnockError::ProfileAlreadyExists(name));
        }

        let now = Utc::now();
        let profile = KnockProfile {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            method,
            sequence,
            spa_options,
            fwknop_config,
            firewall_options,
            knock_options,
            tags,
            is_default: false,
            created_at: now,
            updated_at: now,
        };

        Self::validate_profile(&profile)?;
        self.profiles.push(profile.clone());
        Ok(profile)
    }

    pub fn update_profile(
        &mut self,
        id: &str,
        updates: KnockProfile,
    ) -> Result<KnockProfile, PortKnockError> {
        let idx = self
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))?;

        Self::validate_profile(&updates)?;

        let profile = &mut self.profiles[idx];
        profile.name = updates.name;
        profile.description = updates.description;
        profile.method = updates.method;
        profile.sequence = updates.sequence;
        profile.spa_options = updates.spa_options;
        profile.fwknop_config = updates.fwknop_config;
        profile.firewall_options = updates.firewall_options;
        profile.knock_options = updates.knock_options;
        profile.tags = updates.tags;
        profile.updated_at = Utc::now();

        Ok(self.profiles[idx].clone())
    }

    pub fn delete_profile(&mut self, id: &str) -> Result<(), PortKnockError> {
        let idx = self
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))?;
        self.profiles.remove(idx);
        Ok(())
    }

    pub fn get_profile(&self, id: &str) -> Result<&KnockProfile, PortKnockError> {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))
    }

    pub fn get_profile_by_name(&self, name: &str) -> Option<&KnockProfile> {
        self.profiles.iter().find(|p| p.name == name)
    }

    pub fn list_profiles(&self) -> &[KnockProfile] {
        &self.profiles
    }

    pub fn list_profiles_by_method(&self, method: KnockMethod) -> Vec<&KnockProfile> {
        self.profiles
            .iter()
            .filter(|p| std::mem::discriminant(&p.method) == std::mem::discriminant(&method))
            .collect()
    }

    pub fn list_profiles_by_tag(&self, tag: &str) -> Vec<&KnockProfile> {
        self.profiles
            .iter()
            .filter(|p| p.tags.iter().any(|t| t == tag))
            .collect()
    }

    pub fn set_default_profile(&mut self, id: &str) -> Result<(), PortKnockError> {
        if !self.profiles.iter().any(|p| p.id == id) {
            return Err(PortKnockError::ProfileNotFound(id.to_string()));
        }
        for p in &mut self.profiles {
            p.is_default = p.id == id;
        }
        Ok(())
    }

    pub fn get_default_profile(&self) -> Option<&KnockProfile> {
        self.profiles.iter().find(|p| p.is_default)
    }

    pub fn clone_profile(
        &mut self,
        id: &str,
        new_name: &str,
    ) -> Result<KnockProfile, PortKnockError> {
        let source = self
            .profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))?
            .clone();

        let now = Utc::now();
        let cloned = KnockProfile {
            id: Uuid::new_v4().to_string(),
            name: new_name.to_string(),
            is_default: false,
            created_at: now,
            updated_at: now,
            ..source
        };

        self.profiles.push(cloned.clone());
        Ok(cloned)
    }

    pub fn validate_profile(profile: &KnockProfile) -> Result<(), PortKnockError> {
        if profile.name.is_empty() {
            return Err(PortKnockError::ProfileValidationError(
                "Profile name cannot be empty".to_string(),
            ));
        }

        match &profile.method {
            KnockMethod::SimpleSequence
            | KnockMethod::EncryptedSequence
            | KnockMethod::KnockdCompat => {
                if profile.sequence.is_none() {
                    return Err(PortKnockError::ProfileValidationError(format!(
                        "Sequence is required for {:?} method",
                        profile.method
                    )));
                }
            }
            KnockMethod::Spa => {
                if profile.spa_options.is_none() {
                    return Err(PortKnockError::ProfileValidationError(
                        "SPA options are required for SPA method".to_string(),
                    ));
                }
            }
            KnockMethod::Fwknop => {
                if profile.fwknop_config.is_none() {
                    return Err(PortKnockError::ProfileValidationError(
                        "fwknop config is required for Fwknop method".to_string(),
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn export_profiles(
        &self,
        profile_ids: &[String],
        format: ProfileFormat,
    ) -> Result<String, PortKnockError> {
        let selected: Vec<&KnockProfile> = profile_ids
            .iter()
            .map(|id| {
                self.profiles
                    .iter()
                    .find(|p| p.id == *id)
                    .ok_or_else(|| PortKnockError::ProfileNotFound(id.clone()))
            })
            .collect::<Result<Vec<_>, _>>()?;

        match format {
            ProfileFormat::Json => serde_json::to_string_pretty(&selected)
                .map_err(|e| PortKnockError::ExportError(e.to_string())),
            ProfileFormat::Toml => {
                let doc = TomlProfileDoc {
                    profiles: selected.into_iter().cloned().collect(),
                };
                toml::to_string_pretty(&doc)
                    .map(|s| format!("# Exported profiles (TOML)\n{}", s))
                    .map_err(|e| PortKnockError::ExportError(e.to_string()))
            }
            ProfileFormat::KnockdConf => {
                let mut out =
                    String::from("# knockd configuration generated by SortOfRemoteNG\n\n");
                out.push_str("[options]\n");
                out.push_str("    UseSyslog\n\n");
                for profile in &selected {
                    out.push_str(&export_profile_knockd(profile));
                }
                Ok(out)
            }
            ProfileFormat::FwknopRc => {
                let mut out = String::from("# .fwknoprc generated by SortOfRemoteNG\n\n");
                for profile in &selected {
                    out.push_str(&export_profile_fwknoprc(profile));
                }
                Ok(out)
            }
        }
    }

    pub fn import_profiles(
        &mut self,
        data: &str,
        format: ProfileFormat,
    ) -> Result<Vec<KnockProfile>, PortKnockError> {
        let imported: Vec<KnockProfile> = match format {
            ProfileFormat::Json => serde_json::from_str(data)
                .map_err(|e| PortKnockError::ImportError(e.to_string()))?,
            ProfileFormat::Toml => {
                // Accept a `{ profiles = [...] }` wrapper (preferred) or a bare
                // top-level `[[profiles]]` array-of-tables — both deserialize
                // into `TomlProfileDoc`. A bare top-level array isn't valid TOML.
                let doc: TomlProfileDoc = toml::from_str(data)
                    .map_err(|e| PortKnockError::ImportError(e.to_string()))?;
                doc.profiles
            }
            ProfileFormat::KnockdConf => parse_knockd_conf(data)?,
            ProfileFormat::FwknopRc => parse_fwknoprc(data)?,
        };

        let now = Utc::now();
        let mut added = Vec::new();
        for mut profile in imported {
            profile.id = Uuid::new_v4().to_string();
            profile.created_at = now;
            profile.updated_at = now;
            self.profiles.push(profile.clone());
            added.push(profile);
        }

        Ok(added)
    }

    pub fn search_profiles(&self, query: &str) -> Vec<&KnockProfile> {
        let q = query.to_lowercase();
        self.profiles
            .iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&q)
                    || p.description.to_lowercase().contains(&q)
                    || p.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .collect()
    }
}

// ── knockd.conf export/import helpers ─────────────────────────────────────

/// Export a single profile to knockd.conf stanza format.
fn export_profile_knockd(profile: &KnockProfile) -> String {
    let mut out = format!("[{}]\n", profile.name);

    if let Some(ref seq) = profile.sequence {
        let ports: Vec<String> = seq
            .steps
            .iter()
            .map(|s| {
                let proto = match s.protocol {
                    KnockProtocol::Tcp => "tcp",
                    KnockProtocol::Udp => "udp",
                };
                format!("{}:{}", s.port, proto)
            })
            .collect();
        out.push_str(&format!("    sequence    = {}\n", ports.join(",")));
        out.push_str(&format!("    seq_timeout = {}\n", seq.timeout_ms / 1000));
        out.push_str(&format!(
            "    tcpflags    = {}\n",
            profile
                .knock_options
                .tcp_flags
                .as_ref()
                .map(tcp_flags_str)
                .unwrap_or_else(|| "syn".to_string())
        ));
        // Include target port info as a comment for reference
        out.push_str(&format!(
            "    # target: {}:{}\n",
            seq.target_port,
            match seq.target_protocol {
                KnockProtocol::Tcp => "tcp",
                KnockProtocol::Udp => "udp",
            }
        ));
    }

    if let Some(ref fw) = profile.firewall_options {
        if let Some(exp) = fw.expire_seconds {
            out.push_str(&format!("    cmd_timeout = {}\n", exp));
        }
    }

    out.push('\n');
    out
}

/// Export a single profile to .fwknoprc stanza format.
fn export_profile_fwknoprc(profile: &KnockProfile) -> String {
    let mut out = format!("[{}]\n", profile.name);

    if let Some(ref cfg) = profile.fwknop_config {
        out.push_str(&format!("SPA_SERVER       {}\n", cfg.spa_server));
        out.push_str(&format!("SPA_SERVER_PORT  {}\n", cfg.spa_server_port));
        out.push_str(&format!(
            "SPA_SERVER_PROTO {}\n",
            match cfg.spa_server_proto {
                KnockProtocol::Tcp => "tcp",
                KnockProtocol::Udp => "udp",
            }
        ));
        out.push_str(&format!("ACCESS           {}\n", cfg.access_port));

        if let Some(ref ip) = cfg.allow_ip {
            out.push_str(&format!("ALLOW_IP         {}\n", ip));
        }
        if let Some(ref url) = cfg.resolve_ip_url {
            out.push_str(&format!("RESOLVE_IP_HTTPS {}\n", url));
        }
        if let Some(ref key) = cfg.key_base64 {
            out.push_str(&format!("KEY_BASE64       {}\n", key));
        }
        if let Some(ref hmac) = cfg.hmac_key_base64 {
            out.push_str(&format!("HMAC_KEY_BASE64  {}\n", hmac));
        }
        if cfg.nat_local {
            out.push_str("NAT_LOCAL        Y\n");
        }
        if let Some(ref nat_access) = cfg.nat_access {
            out.push_str(&format!("NAT_ACCESS       {}\n", nat_access));
        }
        if let Some(port) = cfg.nat_port {
            out.push_str(&format!("NAT_PORT         {}\n", port));
        }
    }

    out.push('\n');
    out
}

fn tcp_flags_str(flags: &TcpFlags) -> String {
    let mut parts = Vec::new();
    if flags.syn {
        parts.push("syn");
    }
    if flags.ack {
        parts.push("ack");
    }
    if flags.fin {
        parts.push("fin");
    }
    if flags.rst {
        parts.push("rst");
    }
    if flags.psh {
        parts.push("psh");
    }
    if flags.urg {
        parts.push("urg");
    }
    if parts.is_empty() {
        "syn".to_string()
    } else {
        parts.join(",")
    }
}

/// Parse a knockd.conf file into profiles.
///
/// Supports the standard knockd configuration format with `[section]` headers
/// and `key = value` pairs.
fn parse_knockd_conf(data: &str) -> Result<Vec<KnockProfile>, PortKnockError> {
    let mut profiles = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_seq_str: Option<String> = None;
    let mut current_timeout: u64 = 10;
    let now = Utc::now();

    for line in data.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Section header
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Flush previous section
            if let Some(ref name) = current_name {
                if name != "options" {
                    if let Some(ref seq_str) = current_seq_str {
                        let steps = parse_knockd_sequence(seq_str);
                        let seq = KnockSequence {
                            id: Uuid::new_v4().to_string(),
                            name: name.clone(),
                            steps,
                            description: format!("Imported from knockd.conf: {}", name),
                            target_port: 22,
                            target_protocol: KnockProtocol::Tcp,
                            timeout_ms: current_timeout * 1000,
                            max_retries: 3,
                            ip_version: IpVersion::Auto,
                            created_at: now,
                            updated_at: now,
                        };
                        profiles.push(KnockProfile {
                            id: Uuid::new_v4().to_string(),
                            name: name.clone(),
                            description: format!("Imported from knockd.conf: {}", name),
                            method: KnockMethod::KnockdCompat,
                            sequence: Some(seq),
                            spa_options: None,
                            fwknop_config: None,
                            firewall_options: None,
                            knock_options: KnockOptions::default(),
                            tags: vec!["knockd".to_string()],
                            is_default: false,
                            created_at: now,
                            updated_at: now,
                        });
                    }
                }
            }
            current_name = Some(trimmed[1..trimmed.len() - 1].to_string());
            current_seq_str = None;
            current_timeout = 10;
            continue;
        }

        // Key = value
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim().to_lowercase();
            let value = value.trim();
            match key.as_str() {
                "sequence" => current_seq_str = Some(value.to_string()),
                "seq_timeout" => current_timeout = value.parse().unwrap_or(10),
                _ => {}
            }
        }
    }

    // Flush last section
    if let Some(ref name) = current_name {
        if name != "options" {
            if let Some(ref seq_str) = current_seq_str {
                let steps = parse_knockd_sequence(seq_str);
                let seq = KnockSequence {
                    id: Uuid::new_v4().to_string(),
                    name: name.clone(),
                    steps,
                    description: format!("Imported from knockd.conf: {}", name),
                    target_port: 22,
                    target_protocol: KnockProtocol::Tcp,
                    timeout_ms: current_timeout * 1000,
                    max_retries: 3,
                    ip_version: IpVersion::Auto,
                    created_at: now,
                    updated_at: now,
                };
                profiles.push(KnockProfile {
                    id: Uuid::new_v4().to_string(),
                    name: name.clone(),
                    description: format!("Imported from knockd.conf: {}", name),
                    method: KnockMethod::KnockdCompat,
                    sequence: Some(seq),
                    spa_options: None,
                    fwknop_config: None,
                    firewall_options: None,
                    knock_options: KnockOptions::default(),
                    tags: vec!["knockd".to_string()],
                    is_default: false,
                    created_at: now,
                    updated_at: now,
                });
            }
        }
    }

    if profiles.is_empty() {
        return Err(PortKnockError::ImportError(
            "No valid knock profiles found in knockd.conf data".to_string(),
        ));
    }

    Ok(profiles)
}

/// Parse a knockd sequence string like "7000:tcp,8000:udp,9000:tcp" into steps.
fn parse_knockd_sequence(seq_str: &str) -> Vec<KnockStep> {
    seq_str
        .split(',')
        .filter_map(|part| {
            let part = part.trim();
            let (port_str, proto) = if let Some((p, pr)) = part.split_once(':') {
                (
                    p.trim(),
                    match pr.trim().to_lowercase().as_str() {
                        "udp" => KnockProtocol::Udp,
                        _ => KnockProtocol::Tcp,
                    },
                )
            } else {
                (part, KnockProtocol::Tcp)
            };
            let port: u16 = port_str.parse().ok()?;
            Some(KnockStep {
                port,
                protocol: proto,
                payload: None,
                delay_after_ms: 100,
            })
        })
        .collect()
}

/// Parse a .fwknoprc file into profiles.
///
/// Supports stanza-based format with `[stanzaname]` headers and
/// `KEY  value` pairs.
fn parse_fwknoprc(data: &str) -> Result<Vec<KnockProfile>, PortKnockError> {
    let mut profiles = Vec::new();
    let mut current_name: Option<String> = None;
    let mut spa_server = String::new();
    let mut spa_server_port: u16 = 62201;
    let mut access_port = String::from("tcp/22");
    let mut key_base64: Option<String> = None;
    let mut hmac_key_base64: Option<String> = None;
    let mut allow_ip: Option<String> = None;
    let mut resolve_ip_url: Option<String> = None;
    let now = Utc::now();

    let flush = |name: &str,
                 spa_server: &str,
                 spa_server_port: u16,
                 access_port: &str,
                 key_base64: &Option<String>,
                 hmac_key_base64: &Option<String>,
                 allow_ip: &Option<String>,
                 resolve_ip_url: &Option<String>,
                 now: chrono::DateTime<Utc>|
     -> KnockProfile {
        let cfg = FwknopClientConfig {
            spa_server: spa_server.to_string(),
            spa_server_port,
            spa_server_proto: KnockProtocol::Udp,
            access_port: access_port.to_string(),
            allow_ip: allow_ip.clone(),
            resolve_ip_url: resolve_ip_url.clone(),
            encryption_mode: KnockEncryption::Aes256Cbc,
            key: None,
            key_base64: key_base64.clone(),
            hmac_key: None,
            hmac_key_base64: hmac_key_base64.clone(),
            hmac_digest_type: HmacAlgorithm::Sha256,
            spa_source_port: None,
            nat_access: None,
            nat_local: false,
            nat_port: None,
            server_timeout: None,
            gpg_recipient: None,
            gpg_signer: None,
            gpg_home_dir: None,
        };
        KnockProfile {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            description: format!("Imported from .fwknoprc: {}", name),
            method: KnockMethod::Fwknop,
            sequence: None,
            spa_options: None,
            fwknop_config: Some(cfg),
            firewall_options: None,
            knock_options: KnockOptions::default(),
            tags: vec!["fwknop".to_string()],
            is_default: false,
            created_at: now,
            updated_at: now,
        }
    };

    for line in data.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Flush previous stanza
            if let Some(ref name) = current_name {
                if !spa_server.is_empty() {
                    profiles.push(flush(
                        name,
                        &spa_server,
                        spa_server_port,
                        &access_port,
                        &key_base64,
                        &hmac_key_base64,
                        &allow_ip,
                        &resolve_ip_url,
                        now,
                    ));
                }
            }
            current_name = Some(trimmed[1..trimmed.len() - 1].to_string());
            spa_server = String::new();
            spa_server_port = 62201;
            access_port = String::from("tcp/22");
            key_base64 = None;
            hmac_key_base64 = None;
            allow_ip = None;
            resolve_ip_url = None;
            continue;
        }

        // KEY  value (whitespace separated)
        if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
            let key = key.trim();
            let value = value.trim();
            match key {
                "SPA_SERVER" => spa_server = value.to_string(),
                "SPA_SERVER_PORT" => spa_server_port = value.parse().unwrap_or(62201),
                "ACCESS" => access_port = value.to_string(),
                "KEY_BASE64" => key_base64 = Some(value.to_string()),
                "HMAC_KEY_BASE64" => hmac_key_base64 = Some(value.to_string()),
                "ALLOW_IP" => allow_ip = Some(value.to_string()),
                "RESOLVE_IP_HTTPS" => resolve_ip_url = Some(value.to_string()),
                _ => {}
            }
        }
    }

    // Flush last stanza
    if let Some(ref name) = current_name {
        if !spa_server.is_empty() {
            profiles.push(flush(
                name,
                &spa_server,
                spa_server_port,
                &access_port,
                &key_base64,
                &hmac_key_base64,
                &allow_ip,
                &resolve_ip_url,
                now,
            ));
        }
    }

    if profiles.is_empty() {
        return Err(PortKnockError::ImportError(
            "No valid profiles found in .fwknoprc data".to_string(),
        ));
    }

    Ok(profiles)
}
