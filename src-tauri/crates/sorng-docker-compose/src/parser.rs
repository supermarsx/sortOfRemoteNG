// ── sorng-docker-compose/src/parser.rs ─────────────────────────────────────────
//! Compose file parsing, merging, interpolation, and validation.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::{ComposeError, ComposeResult};
use crate::types::*;

/// Parser for Docker Compose files.
pub struct ComposeParser;

impl ComposeParser {
    // ── Parse ─────────────────────────────────────────────────────

    /// Parse a compose file from a YAML string.
    pub fn parse_yaml(content: &str) -> ComposeResult<ComposeFile> {
        serde_yaml::from_str(content).map_err(|e| ComposeError::parse(&e.to_string()))
    }

    /// Parse a compose file from a JSON string.
    pub fn parse_json(content: &str) -> ComposeResult<ComposeFile> {
        serde_json::from_str(content).map_err(|e| ComposeError::parse(&e.to_string()))
    }

    /// Read and parse a compose file from disk.
    pub fn parse_file(path: &Path) -> ComposeResult<ComposeFile> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            ComposeError::file_not_found(&format!("Cannot read {}: {}", path.display(), e))
        })?;

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("yml");

        match ext {
            "json" => Self::parse_json(&content),
            _ => Self::parse_yaml(&content),
        }
    }

    /// Discover compose files in a directory using standard naming.
    pub fn discover_files(dir: &Path) -> Vec<PathBuf> {
        let candidates = [
            "compose.yaml",
            "compose.yml",
            "docker-compose.yaml",
            "docker-compose.yml",
        ];
        let mut found = Vec::new();
        for name in &candidates {
            let p = dir.join(name);
            if p.exists() {
                found.push(p);
            }
        }
        // Also look for override files.
        let overrides = [
            "compose.override.yaml",
            "compose.override.yml",
            "docker-compose.override.yaml",
            "docker-compose.override.yml",
        ];
        for name in &overrides {
            let p = dir.join(name);
            if p.exists() {
                found.push(p);
            }
        }
        found
    }

    // ── Merge ─────────────────────────────────────────────────────

    /// Merge multiple compose files in order (later files override earlier).
    pub fn merge(files: &[ComposeFile]) -> ComposeResult<ComposeFile> {
        if files.is_empty() {
            return Ok(ComposeFile::default());
        }

        let mut merged = files[0].clone();

        for overlay in &files[1..] {
            // Merge services
            for (name, svc) in &overlay.services {
                if let Some(existing) = merged.services.get_mut(name) {
                    Self::merge_service(existing, svc);
                } else {
                    merged.services.insert(name.clone(), svc.clone());
                }
            }

            // Merge volumes
            for (name, vol) in &overlay.volumes {
                merged.volumes.insert(name.clone(), vol.clone());
            }

            // Merge networks
            for (name, net) in &overlay.networks {
                merged.networks.insert(name.clone(), net.clone());
            }

            // Merge secrets
            for (name, sec) in &overlay.secrets {
                merged.secrets.insert(name.clone(), sec.clone());
            }

            // Merge configs
            for (name, cfg) in &overlay.configs {
                merged.configs.insert(name.clone(), cfg.clone());
            }

            // Override name / version if present
            if overlay.name.is_some() {
                merged.name = overlay.name.clone();
            }
            if overlay.version.is_some() {
                merged.version = overlay.version.clone();
            }
        }

        Ok(merged)
    }

    /// Merge overlay service into an existing base service.
    fn merge_service(base: &mut ServiceDefinition, overlay: &ServiceDefinition) {
        macro_rules! override_opt {
            ($field:ident) => {
                if overlay.$field.is_some() {
                    base.$field = overlay.$field.clone();
                }
            };
        }

        override_opt!(image);
        override_opt!(build);
        override_opt!(pull_policy);
        override_opt!(platform);
        override_opt!(command);
        override_opt!(entrypoint);
        override_opt!(working_dir);
        override_opt!(user);
        override_opt!(container_name);
        override_opt!(hostname);
        override_opt!(domainname);
        override_opt!(network_mode);
        override_opt!(mac_address);
        override_opt!(healthcheck);
        override_opt!(deploy);
        override_opt!(restart);
        override_opt!(logging);
        override_opt!(mem_limit);
        override_opt!(mem_reservation);
        override_opt!(memswap_limit);
        override_opt!(cpus);
        override_opt!(cpu_shares);
        override_opt!(cpu_quota);
        override_opt!(cpu_period);
        override_opt!(cpuset);
        override_opt!(shm_size);
        override_opt!(pids_limit);
        override_opt!(oom_kill_disable);
        override_opt!(oom_score_adj);
        override_opt!(privileged);
        override_opt!(read_only);
        override_opt!(userns_mode);
        override_opt!(tty);
        override_opt!(stdin_open);
        override_opt!(init);
        override_opt!(stop_signal);
        override_opt!(stop_grace_period);
        override_opt!(pid);
        override_opt!(ipc);
        override_opt!(cgroup_parent);
        override_opt!(scale);
        override_opt!(runtime);
        override_opt!(isolation);
        override_opt!(environment);
        override_opt!(depends_on);

        // Append-merge for list fields
        if !overlay.ports.is_empty() {
            base.ports = overlay.ports.clone();
        }
        if !overlay.expose.is_empty() {
            base.expose = overlay.expose.clone();
        }
        if !overlay.volumes.is_empty() {
            base.volumes = overlay.volumes.clone();
        }
        if !overlay.tmpfs.is_empty() {
            base.tmpfs = overlay.tmpfs.clone();
        }
        if !overlay.env_file.is_empty() {
            base.env_file = overlay.env_file.clone();
        }
        if !overlay.dns.is_empty() {
            base.dns = overlay.dns.clone();
        }
        if !overlay.dns_search.is_empty() {
            base.dns_search = overlay.dns_search.clone();
        }
        if !overlay.dns_opt.is_empty() {
            base.dns_opt = overlay.dns_opt.clone();
        }
        if !overlay.extra_hosts.is_empty() {
            base.extra_hosts = overlay.extra_hosts.clone();
        }
        if !overlay.cap_add.is_empty() {
            base.cap_add = overlay.cap_add.clone();
        }
        if !overlay.cap_drop.is_empty() {
            base.cap_drop = overlay.cap_drop.clone();
        }
        if !overlay.security_opt.is_empty() {
            base.security_opt = overlay.security_opt.clone();
        }
        if !overlay.devices.is_empty() {
            base.devices = overlay.devices.clone();
        }
        if !overlay.links.is_empty() {
            base.links = overlay.links.clone();
        }
        if !overlay.external_links.is_empty() {
            base.external_links = overlay.external_links.clone();
        }
        if !overlay.profiles.is_empty() {
            base.profiles = overlay.profiles.clone();
        }
        if !overlay.secrets.is_empty() {
            base.secrets = overlay.secrets.clone();
        }
        if !overlay.configs.is_empty() {
            base.configs = overlay.configs.clone();
        }

        // Merge maps
        if overlay.networks.is_some() {
            base.networks = overlay.networks.clone();
        }
        if !overlay.labels.is_empty() {
            for (k, v) in &overlay.labels {
                base.labels.insert(k.clone(), v.clone());
            }
        }
        if !overlay.annotations.is_empty() {
            for (k, v) in &overlay.annotations {
                base.annotations.insert(k.clone(), v.clone());
            }
        }
        if !overlay.sysctls.is_empty() {
            for (k, v) in &overlay.sysctls {
                base.sysctls.insert(k.clone(), v.clone());
            }
        }
    }

    // ── Interpolation ─────────────────────────────────────────────

    /// Interpolate `${VAR}` and `$VAR` references in a YAML string using
    /// the provided variable map (typically from env files + process env).
    pub fn interpolate(content: &str, vars: &HashMap<String, String>) -> ComposeResult<String> {
        let re = regex::Regex::new(r"\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)")
            .map_err(|e| ComposeError::interpolation(&e.to_string()))?;

        let result = re.replace_all(content, |caps: &regex::Captures| {
            let var_expr = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str())
                .unwrap_or("");

            // Handle ${VAR:-default} and ${VAR-default}
            if let Some(idx) = var_expr.find(":-") {
                let var_name = &var_expr[..idx];
                let default = &var_expr[idx + 2..];
                vars.get(var_name)
                    .filter(|v| !v.is_empty())
                    .map(|v| v.clone())
                    .unwrap_or_else(|| default.to_string())
            } else if let Some(idx) = var_expr.find('-') {
                let var_name = &var_expr[..idx];
                let default = &var_expr[idx + 1..];
                vars.get(var_name)
                    .cloned()
                    .unwrap_or_else(|| default.to_string())
            } else if let Some(idx) = var_expr.find(":?") {
                // ${VAR:?error} — error if unset or empty
                let var_name = &var_expr[..idx];
                let err_msg = &var_expr[idx + 2..];
                vars.get(var_name)
                    .filter(|v| !v.is_empty())
                    .cloned()
                    .unwrap_or_else(|| format!("ERROR: {}", err_msg))
            } else if let Some(idx) = var_expr.find('?') {
                // ${VAR?error} — error if unset
                let var_name = &var_expr[..idx];
                let err_msg = &var_expr[idx + 1..];
                vars.get(var_name)
                    .cloned()
                    .unwrap_or_else(|| format!("ERROR: {}", err_msg))
            } else if let Some(idx) = var_expr.find(":+") {
                // ${VAR:+replacement}
                let var_name = &var_expr[..idx];
                let replacement = &var_expr[idx + 2..];
                vars.get(var_name)
                    .filter(|v| !v.is_empty())
                    .map(|_| replacement.to_string())
                    .unwrap_or_default()
            } else if let Some(idx) = var_expr.find('+') {
                // ${VAR+replacement}
                let var_name = &var_expr[..idx];
                let replacement = &var_expr[idx + 1..];
                if vars.contains_key(var_name) {
                    replacement.to_string()
                } else {
                    String::new()
                }
            } else {
                vars.get(var_expr).cloned().unwrap_or_default()
            }
        });

        Ok(result.into_owned())
    }

    // ── Env files ─────────────────────────────────────────────────

    /// Parse a `.env` file into key-value pairs.
    pub fn parse_env_file(path: &Path) -> ComposeResult<EnvFile> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            ComposeError::file_not_found(&format!("Cannot read env file {}: {}", path.display(), e))
        })?;

        let mut env_file = EnvFile {
            path: path.display().to_string(),
            ..Default::default()
        };

        for (line_no, line) in content.lines().enumerate() {
            let trimmed = line.trim();

            // Skip empty lines and comments.
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            if let Some(eq_pos) = trimmed.find('=') {
                let key = trimmed[..eq_pos].trim().to_string();
                let mut value = trimmed[eq_pos + 1..].trim().to_string();

                // Strip surrounding quotes
                if (value.starts_with('"') && value.ends_with('"'))
                    || (value.starts_with('\'') && value.ends_with('\''))
                {
                    value = value[1..value.len() - 1].to_string();
                }

                if key.is_empty() {
                    env_file
                        .errors
                        .push(format!("Line {}: empty variable name", line_no + 1));
                    continue;
                }

                env_file.variables.push(EnvVar {
                    key,
                    value: Some(value),
                    source: Some(path.display().to_string()),
                });
            } else {
                // Bare variable name (no `=`), value comes from environment.
                env_file.variables.push(EnvVar {
                    key: trimmed.to_string(),
                    value: None,
                    source: Some(path.display().to_string()),
                });
            }
        }

        Ok(env_file)
    }

    /// Build a variable map from env files + current process environment.
    pub fn build_env_map(env_files: &[&Path]) -> ComposeResult<HashMap<String, String>> {
        let mut map = HashMap::new();

        // Process env files in order (later overrides earlier).
        for path in env_files {
            let ef = Self::parse_env_file(path)?;
            for var in &ef.variables {
                if let Some(ref val) = var.value {
                    map.insert(var.key.clone(), val.clone());
                }
            }
        }

        // Layer process environment on top (higher precedence).
        for (key, value) in std::env::vars() {
            map.insert(key, value);
        }

        Ok(map)
    }

    // ── Validation ────────────────────────────────────────────────

    /// Validate a parsed compose file.
    pub fn validate(compose: &ComposeFile) -> ComposeValidation {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Check each service
        for (name, svc) in &compose.services {
            // Must have image or build
            if svc.image.is_none() && svc.build.is_none() {
                errors.push(ValidationIssue {
                    service: Some(name.clone()),
                    field: Some("image/build".to_string()),
                    message: "Service must specify either 'image' or 'build'".to_string(),
                    severity: "error".to_string(),
                });
            }

            // Warn on deprecated fields
            if svc.links.len() > 0 {
                warnings.push(ValidationIssue {
                    service: Some(name.clone()),
                    field: Some("links".to_string()),
                    message: "'links' is deprecated; use networks and service aliases instead"
                        .to_string(),
                    severity: "warning".to_string(),
                });
            }

            // Validate depends_on references
            if let Some(ref deps) = svc.depends_on {
                let dep_names: Vec<&str> = match deps {
                    DependsOn::List(list) => list.iter().map(|s| s.as_str()).collect(),
                    DependsOn::Map(map) => map.keys().map(|s| s.as_str()).collect(),
                };
                for dep in dep_names {
                    if !compose.services.contains_key(dep) {
                        errors.push(ValidationIssue {
                            service: Some(name.clone()),
                            field: Some("depends_on".to_string()),
                            message: format!(
                                "depends_on references unknown service '{}'",
                                dep
                            ),
                            severity: "error".to_string(),
                        });
                    }
                }
            }

            // Validate network references
            if let Some(ref nets) = svc.networks {
                let net_names: Vec<&str> = match nets {
                    ServiceNetworks::List(list) => list.iter().map(|s| s.as_str()).collect(),
                    ServiceNetworks::Map(map) => map.keys().map(|s| s.as_str()).collect(),
                };
                for net_name in net_names {
                    if !compose.networks.contains_key(net_name)
                        && net_name != "default"
                    {
                        errors.push(ValidationIssue {
                            service: Some(name.clone()),
                            field: Some("networks".to_string()),
                            message: format!(
                                "references undefined network '{}'",
                                net_name
                            ),
                            severity: "error".to_string(),
                        });
                    }
                }
            }

            // Validate secret references
            for sec_ref in &svc.secrets {
                let sec_name = match sec_ref {
                    ServiceSecretRef::Short(s) => s.as_str(),
                    ServiceSecretRef::Long(l) => l.source.as_str(),
                };
                if !compose.secrets.contains_key(sec_name) {
                    errors.push(ValidationIssue {
                        service: Some(name.clone()),
                        field: Some("secrets".to_string()),
                        message: format!(
                            "references undefined secret '{}'",
                            sec_name
                        ),
                        severity: "error".to_string(),
                    });
                }
            }

            // Validate config references
            for cfg_ref in &svc.configs {
                let cfg_name = match cfg_ref {
                    ServiceConfigRef::Short(s) => s.as_str(),
                    ServiceConfigRef::Long(l) => l.source.as_str(),
                };
                if !compose.configs.contains_key(cfg_name) {
                    errors.push(ValidationIssue {
                        service: Some(name.clone()),
                        field: Some("configs".to_string()),
                        message: format!(
                            "references undefined config '{}'",
                            cfg_name
                        ),
                        severity: "error".to_string(),
                    });
                }
            }

            // Warn on privileged mode
            if svc.privileged == Some(true) {
                warnings.push(ValidationIssue {
                    service: Some(name.clone()),
                    field: Some("privileged".to_string()),
                    message: "Service runs in privileged mode — potential security risk"
                        .to_string(),
                    severity: "warning".to_string(),
                });
            }

            // Warn on missing healthcheck for services with depends_on condition
            if svc.healthcheck.is_none() {
                // Check if any other service depends on this one with service_healthy
                for (other_name, other_svc) in &compose.services {
                    if other_name == name {
                        continue;
                    }
                    if let Some(DependsOn::Map(ref map)) = other_svc.depends_on {
                        if let Some(cond) = map.get(name) {
                            if cond.condition.as_deref() == Some("service_healthy") {
                                warnings.push(ValidationIssue {
                                    service: Some(name.clone()),
                                    field: Some("healthcheck".to_string()),
                                    message: format!(
                                        "Service '{}' depends on '{}' with condition service_healthy but no healthcheck is defined",
                                        other_name, name
                                    ),
                                    severity: "warning".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        ComposeValidation {
            valid: errors.is_empty(),
            errors,
            warnings,
        }
    }

    // ── Serialization ─────────────────────────────────────────────

    /// Serialize a compose file to YAML.
    pub fn to_yaml(compose: &ComposeFile) -> ComposeResult<String> {
        serde_yaml::to_string(compose).map_err(|e| ComposeError::parse(&e.to_string()))
    }

    /// Serialize a compose file to JSON.
    pub fn to_json(compose: &ComposeFile) -> ComposeResult<String> {
        serde_json::to_string_pretty(compose).map_err(|e| ComposeError::parse(&e.to_string()))
    }

    /// Write a compose file to disk as YAML.
    pub fn write_file(compose: &ComposeFile, path: &Path) -> ComposeResult<()> {
        let content = Self::to_yaml(compose)?;
        std::fs::write(path, content)
            .map_err(|e| ComposeError::io(&format!("Cannot write {}: {}", path.display(), e)))
    }
}
