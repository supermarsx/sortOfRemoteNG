//! PAM service management — /etc/pam.d/ file listing, parsing, editing.

use crate::client;
use crate::error::PamError;
use crate::types::{PamControlFlag, PamHost, PamModuleLine, PamModuleType, PamService};
use log::{debug, info, warn};

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse a single non-comment, non-empty line from a PAM service file.
fn parse_pam_line(raw: &str) -> Option<PamModuleLine> {
    let line = raw.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    // Split off inline comment
    let (content, comment) = if let Some(idx) = line.find(" #") {
        (&line[..idx], Some(line[idx + 2..].trim().to_string()))
    } else {
        (line, None)
    };

    let tokens: Vec<&str> = content.split_whitespace().collect();
    if tokens.len() < 3 {
        // Might be an @include directive: "@include common-auth"
        if tokens.len() == 2 && tokens[0].starts_with("@include") {
            return None; // handled separately
        }
        return None;
    }

    let mut type_str = tokens[0];
    let silent = type_str.starts_with('-');
    if silent {
        type_str = &type_str[1..];
    }

    let module_type = PamModuleType::parse(type_str)?;

    // Control can be a simple keyword or a bracketed expression [success=1 ...]
    let control = if tokens[1].starts_with('[') {
        // Find the closing bracket across tokens
        let mut bracket_str = String::new();
        let mut tok_idx = 1;
        while tok_idx < tokens.len() {
            if !bracket_str.is_empty() {
                bracket_str.push(' ');
            }
            bracket_str.push_str(tokens[tok_idx]);
            if tokens[tok_idx].contains(']') {
                tok_idx += 1;
                break;
            }
            tok_idx += 1;
        }
        let module_path = if tok_idx < tokens.len() {
            tokens[tok_idx].to_string()
        } else {
            return None;
        };
        let arguments: Vec<String> = tokens[tok_idx + 1..]
            .iter()
            .map(|s| s.to_string())
            .collect();
        return Some(PamModuleLine {
            module_type,
            control: PamControlFlag::Complex(bracket_str),
            module_path,
            arguments,
            comment,
            silent,
        });
    } else {
        PamControlFlag::parse(tokens[1])
    };

    let module_path = tokens[2].to_string();
    let arguments: Vec<String> = tokens[3..].iter().map(|s| s.to_string()).collect();

    Some(PamModuleLine {
        module_type,
        control,
        module_path,
        arguments,
        comment,
        silent,
    })
}

/// Parse include directives from a PAM service file.
fn parse_includes(content: &str) -> Vec<String> {
    let mut includes = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("@include ") {
            if let Some(name) = trimmed.strip_prefix("@include ") {
                includes.push(name.trim().to_string());
            }
        }
        // Also handle include/substack in module lines
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() >= 3 {
            let ctl = tokens[1].to_lowercase();
            if ctl == "include" || ctl == "substack" {
                includes.push(tokens[2].to_string());
            }
        }
    }
    includes.sort();
    includes.dedup();
    includes
}

/// Parse a full PAM service file into a PamService.
pub fn parse_service(name: &str, content: &str, file_path: &str) -> PamService {
    let lines: Vec<PamModuleLine> = content.lines().filter_map(parse_pam_line).collect();
    let includes = parse_includes(content);

    PamService {
        name: name.to_string(),
        lines,
        includes,
        file_path: file_path.to_string(),
    }
}

/// Serialize a PamService back to file content.
pub fn serialize_service(svc: &PamService) -> String {
    let mut out = String::new();
    out.push_str(&format!("# PAM configuration for {}\n", svc.name));
    for line in &svc.lines {
        out.push_str(&line.to_config_line());
        out.push('\n');
    }
    out
}

// ─── Remote Operations ──────────────────────────────────────────────

/// List all PAM services in /etc/pam.d/.
pub async fn list_services(host: &PamHost) -> Result<Vec<PamService>, PamError> {
    let files = client::list_dir(host, "/etc/pam.d/").await?;
    let mut services = Vec::new();

    for file_name in &files {
        // Skip hidden files and backup files
        if file_name.starts_with('.') || file_name.ends_with('~') || file_name.ends_with(".bak") {
            continue;
        }
        let path = format!("/etc/pam.d/{}", file_name);
        match client::read_file(host, &path).await {
            Ok(content) => {
                services.push(parse_service(file_name, &content, &path));
            }
            Err(e) => {
                warn!("Failed to read PAM service {}: {}", file_name, e);
            }
        }
    }

    services.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(services)
}

/// Get a single PAM service by name.
pub async fn get_service(host: &PamHost, name: &str) -> Result<PamService, PamError> {
    let path = format!("/etc/pam.d/{}", name);
    let content = client::read_file(host, &path)
        .await
        .map_err(|_| PamError::ServiceNotFound(name.to_string()))?;
    Ok(parse_service(name, &content, &path))
}

/// Create a new PAM service file.
pub async fn create_service(
    host: &PamHost,
    name: &str,
    lines: &[PamModuleLine],
) -> Result<(), PamError> {
    let path = format!("/etc/pam.d/{}", name);

    // Check it doesn't already exist
    if client::file_exists(host, &path).await? {
        return Err(PamError::InvalidConfig(format!(
            "PAM service '{}' already exists",
            name
        )));
    }

    let svc = PamService {
        name: name.to_string(),
        lines: lines.to_vec(),
        includes: Vec::new(),
        file_path: path.clone(),
    };
    let content = serialize_service(&svc);
    client::write_file(host, &path, &content).await?;
    info!("Created PAM service: {}", name);
    Ok(())
}

/// Update an existing PAM service file.
pub async fn update_service(
    host: &PamHost,
    name: &str,
    lines: &[PamModuleLine],
) -> Result<(), PamError> {
    let path = format!("/etc/pam.d/{}", name);
    if !client::file_exists(host, &path).await? {
        return Err(PamError::ServiceNotFound(name.to_string()));
    }

    let svc = PamService {
        name: name.to_string(),
        lines: lines.to_vec(),
        includes: Vec::new(),
        file_path: path.clone(),
    };
    let content = serialize_service(&svc);
    client::write_file(host, &path, &content).await?;
    info!("Updated PAM service: {}", name);
    Ok(())
}

/// Delete a PAM service file.
pub async fn delete_service(host: &PamHost, name: &str) -> Result<(), PamError> {
    let path = format!("/etc/pam.d/{}", name);
    if !client::file_exists(host, &path).await? {
        return Err(PamError::ServiceNotFound(name.to_string()));
    }
    client::remove_file(host, &path).await?;
    info!("Deleted PAM service: {}", name);
    Ok(())
}

/// Add a module line at a specific position in a PAM service.
pub async fn add_module_line(
    host: &PamHost,
    service_name: &str,
    position: usize,
    line: PamModuleLine,
) -> Result<PamService, PamError> {
    let mut svc = get_service(host, service_name).await?;
    if position > svc.lines.len() {
        svc.lines.push(line);
    } else {
        svc.lines.insert(position, line);
    }
    let content = serialize_service(&svc);
    client::write_file(host, &svc.file_path, &content).await?;
    debug!(
        "Added module line to {} at position {}",
        service_name, position
    );
    Ok(svc)
}

/// Remove a module line by index from a PAM service.
pub async fn remove_module_line(
    host: &PamHost,
    service_name: &str,
    index: usize,
) -> Result<PamService, PamError> {
    let mut svc = get_service(host, service_name).await?;
    if index >= svc.lines.len() {
        return Err(PamError::InvalidConfig(format!(
            "Line index {} out of range (service has {} lines)",
            index,
            svc.lines.len()
        )));
    }
    svc.lines.remove(index);
    let content = serialize_service(&svc);
    client::write_file(host, &svc.file_path, &content).await?;
    debug!("Removed module line {} from {}", index, service_name);
    Ok(svc)
}

/// Update a module line by index in a PAM service.
pub async fn update_module_line(
    host: &PamHost,
    service_name: &str,
    index: usize,
    line: PamModuleLine,
) -> Result<PamService, PamError> {
    let mut svc = get_service(host, service_name).await?;
    if index >= svc.lines.len() {
        return Err(PamError::InvalidConfig(format!(
            "Line index {} out of range (service has {} lines)",
            index,
            svc.lines.len()
        )));
    }
    svc.lines[index] = line;
    let content = serialize_service(&svc);
    client::write_file(host, &svc.file_path, &content).await?;
    debug!("Updated module line {} in {}", index, service_name);
    Ok(svc)
}

/// Reorder module lines in a PAM service. `order` is a vec of current indices
/// specifying the desired new order.
pub async fn reorder_module_lines(
    host: &PamHost,
    service_name: &str,
    order: &[usize],
) -> Result<PamService, PamError> {
    let mut svc = get_service(host, service_name).await?;
    let len = svc.lines.len();

    // Validate order
    if order.len() != len {
        return Err(PamError::InvalidConfig(format!(
            "Order length ({}) does not match line count ({})",
            order.len(),
            len
        )));
    }
    for &idx in order {
        if idx >= len {
            return Err(PamError::InvalidConfig(format!(
                "Index {} out of range ({})",
                idx, len
            )));
        }
    }

    let old_lines = svc.lines.clone();
    svc.lines = order.iter().map(|&i| old_lines[i].clone()).collect();

    let content = serialize_service(&svc);
    client::write_file(host, &svc.file_path, &content).await?;
    debug!("Reordered module lines in {}", service_name);
    Ok(svc)
}

/// Backup a PAM service and return its raw content.
pub async fn backup_service(host: &PamHost, name: &str) -> Result<String, PamError> {
    let path = format!("/etc/pam.d/{}", name);
    let content = client::read_file(host, &path)
        .await
        .map_err(|_| PamError::ServiceNotFound(name.to_string()))?;
    debug!("Backed up PAM service: {}", name);
    Ok(content)
}

/// Restore a PAM service from raw content.
pub async fn restore_service(host: &PamHost, name: &str, content: &str) -> Result<(), PamError> {
    let path = format!("/etc/pam.d/{}", name);
    client::write_file(host, &path, content).await?;
    info!("Restored PAM service: {}", name);
    Ok(())
}

/// Validate a PAM service and return any warnings.
pub async fn validate_service(host: &PamHost, name: &str) -> Result<Vec<String>, PamError> {
    let svc = get_service(host, name).await?;
    let mut warnings = Vec::new();

    if svc.lines.is_empty() {
        warnings.push(format!("Service '{}' has no module lines", name));
    }

    // Check that all referenced modules exist
    for (i, line) in svc.lines.iter().enumerate() {
        let mod_path = &line.module_path;
        // Only check absolute paths or well-known module names
        if mod_path.starts_with('/') {
            if !client::file_exists(host, mod_path).await.unwrap_or(false) {
                warnings.push(format!(
                    "Line {}: module '{}' not found on disk",
                    i + 1,
                    mod_path
                ));
            }
        } else if !mod_path.ends_with(".so") && !mod_path.contains('/') {
            // Bare name without .so — might be okay (PAM resolves it)
        } else {
            // Relative path with .so — check common locations
            let found = check_module_paths(host, mod_path).await;
            if !found {
                warnings.push(format!(
                    "Line {}: module '{}' not found in standard paths",
                    i + 1,
                    mod_path
                ));
            }
        }
    }

    // Check for auth stack completeness
    let has_auth = svc
        .lines
        .iter()
        .any(|l| l.module_type == PamModuleType::Auth);
    let has_account = svc
        .lines
        .iter()
        .any(|l| l.module_type == PamModuleType::Account);
    if !has_auth && svc.includes.is_empty() {
        warnings.push(format!("Service '{}' has no auth lines", name));
    }
    if !has_account && svc.includes.is_empty() {
        warnings.push(format!("Service '{}' has no account lines", name));
    }

    Ok(warnings)
}

/// Check standard PAM module search paths for a module.
async fn check_module_paths(host: &PamHost, module_name: &str) -> bool {
    let paths = [
        format!("/lib/security/{}", module_name),
        format!("/lib64/security/{}", module_name),
        format!("/lib/x86_64-linux-gnu/security/{}", module_name),
        format!("/usr/lib/security/{}", module_name),
        format!("/usr/lib64/security/{}", module_name),
        format!("/usr/lib/x86_64-linux-gnu/security/{}", module_name),
    ];
    for path in &paths {
        if client::file_exists(host, path).await.unwrap_or(false) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_pam_line() {
        let line = "auth\trequired\tpam_unix.so\tnullok";
        let parsed = parse_pam_line(line).unwrap();
        assert_eq!(parsed.module_type, PamModuleType::Auth);
        assert_eq!(parsed.control, PamControlFlag::Required);
        assert_eq!(parsed.module_path, "pam_unix.so");
        assert_eq!(parsed.arguments, vec!["nullok"]);
        assert!(!parsed.silent);
    }

    #[test]
    fn test_parse_silent_line() {
        let line = "-session\toptional\tpam_systemd.so";
        let parsed = parse_pam_line(line).unwrap();
        assert_eq!(parsed.module_type, PamModuleType::Session);
        assert_eq!(parsed.control, PamControlFlag::Optional);
        assert_eq!(parsed.module_path, "pam_systemd.so");
        assert!(parsed.silent);
    }

    #[test]
    fn test_parse_complex_control() {
        let line = "auth\t[success=1 default=ignore]\tpam_unix.so nullok";
        let parsed = parse_pam_line(line).unwrap();
        assert_eq!(parsed.module_type, PamModuleType::Auth);
        let PamControlFlag::Complex(ref s) = parsed.control else {
            unreachable!("Expected Complex control flag")
        };
        assert!(s.contains("success=1"));
        assert_eq!(parsed.module_path, "pam_unix.so");
    }

    #[test]
    fn test_parse_comment_line() {
        let line = "# this is a comment";
        assert!(parse_pam_line(line).is_none());
    }

    #[test]
    fn test_parse_empty_line() {
        assert!(parse_pam_line("").is_none());
        assert!(parse_pam_line("   ").is_none());
    }

    #[test]
    fn test_parse_includes() {
        let content = "\
@include common-auth
auth    required    pam_unix.so
@include common-account
account include common-password
";
        let includes = parse_includes(content);
        assert!(includes.contains(&"common-auth".to_string()));
        assert!(includes.contains(&"common-account".to_string()));
        assert!(includes.contains(&"common-password".to_string()));
    }

    #[test]
    fn test_serialize_roundtrip() {
        let svc = PamService {
            name: "mytest".to_string(),
            lines: vec![
                PamModuleLine {
                    module_type: PamModuleType::Auth,
                    control: PamControlFlag::Required,
                    module_path: "pam_unix.so".to_string(),
                    arguments: vec!["nullok".to_string()],
                    comment: None,
                    silent: false,
                },
                PamModuleLine {
                    module_type: PamModuleType::Session,
                    control: PamControlFlag::Optional,
                    module_path: "pam_systemd.so".to_string(),
                    arguments: vec![],
                    comment: Some("systemd session".to_string()),
                    silent: true,
                },
            ],
            includes: vec![],
            file_path: "/etc/pam.d/mytest".to_string(),
        };
        let content = serialize_service(&svc);
        assert!(content.contains("auth\trequired\tpam_unix.so\tnullok"));
        assert!(content.contains("-session\toptional\tpam_systemd.so\t# systemd session"));
    }

    #[test]
    fn test_parse_full_service() {
        let content = "\
# PAM configuration for sshd
auth      required  pam_sepermit.so
auth      substack  password-auth
auth      include   postlogin
account   required  pam_nologin.so
account   include   password-auth
password  include   password-auth
-session  optional  pam_keyinit.so force revoke
session   required  pam_loginuid.so
session   include   password-auth
session   include   postlogin
";
        let svc = parse_service("sshd", content, "/etc/pam.d/sshd");
        assert_eq!(svc.name, "sshd");
        assert!(!svc.lines.is_empty());

        // Check the first auth line
        let first = &svc.lines[0];
        assert_eq!(first.module_type, PamModuleType::Auth);
        assert_eq!(first.control, PamControlFlag::Required);
        assert_eq!(first.module_path, "pam_sepermit.so");

        // Check includes gathered
        assert!(svc.includes.contains(&"password-auth".to_string()));
        assert!(svc.includes.contains(&"postlogin".to_string()));
    }
}
