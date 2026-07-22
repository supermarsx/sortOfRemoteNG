//! Linux/macOS strongSwan helper for IPsec-based VPN protocols.
//! Provides shared functions for IKEv2, IPsec, and L2TP/IPsec connections.

#[cfg(not(windows))]
use crate::validation;
#[cfg(not(windows))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(not(windows))]
use std::fs::OpenOptions;
#[cfg(not(windows))]
use std::io::Write;
#[cfg(not(windows))]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
#[cfg(not(windows))]
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use tokio::process::Command;
#[cfg(not(windows))]
use uuid::Uuid;
#[cfg(not(windows))]
use zeroize::Zeroizing;

/// Validated inputs for one managed strongSwan tunnel. Keeping the local and
/// remote authentication roles named prevents positional call-site mixups.
pub struct IpsecConnectionSpec<'a> {
    pub conn_name: &'a str,
    pub server: &'a str,
    pub local_id: Option<&'a str>,
    pub remote_id: Option<&'a str>,
    pub local_auth: &'a str,
    pub remote_auth: &'a str,
    pub eap_identity: Option<&'a str>,
    pub phase1: Option<&'a str>,
    pub phase2: Option<&'a str>,
}

#[cfg(not(windows))]
const TRUSTED_INSTALL_BINARIES: &[&str] = &["/usr/bin/install", "/bin/install"];
#[cfg(not(windows))]
const TRUSTED_MKDIR_BINARIES: &[&str] = &["/usr/bin/mkdir", "/bin/mkdir"];
#[cfg(not(windows))]
const TRUSTED_RM_BINARIES: &[&str] = &["/usr/bin/rm", "/bin/rm"];
#[cfg(not(windows))]
const TRUSTED_GREP_BINARIES: &[&str] = &["/usr/bin/grep", "/bin/grep"];
#[cfg(all(not(windows), target_os = "linux"))]
const TRUSTED_PKEXEC_BINARIES: &[&str] = &["/usr/bin/pkexec", "/bin/pkexec"];
#[cfg(not(windows))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct IpsecLayout {
    binary: PathBuf,
    config_root: PathBuf,
    allow_elevation: bool,
}

#[cfg(not(windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LayoutCandidate {
    binary: &'static str,
    config_root: &'static str,
    allow_user_owned: bool,
}

#[cfg(not(windows))]
const SYSTEM_LAYOUTS: &[LayoutCandidate] = &[
    LayoutCandidate {
        binary: "/usr/sbin/ipsec",
        config_root: "/etc",
        allow_user_owned: false,
    },
    LayoutCandidate {
        binary: "/sbin/ipsec",
        config_root: "/etc",
        allow_user_owned: false,
    },
    LayoutCandidate {
        binary: "/usr/local/sbin/ipsec",
        config_root: "/usr/local/etc",
        allow_user_owned: false,
    },
];

#[cfg(not(windows))]
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const HOMEBREW_LAYOUTS: &[LayoutCandidate] = &[
    LayoutCandidate {
        binary: "/opt/homebrew/bin/ipsec",
        config_root: "/opt/homebrew/etc",
        allow_user_owned: true,
    },
    LayoutCandidate {
        binary: "/usr/local/bin/ipsec",
        config_root: "/usr/local/etc",
        allow_user_owned: true,
    },
];

#[cfg(not(windows))]
fn resolve_ipsec_layout() -> Result<IpsecLayout, String> {
    for candidate in SYSTEM_LAYOUTS {
        if let Some(layout) = validate_layout_candidate(candidate) {
            return Ok(layout);
        }
    }

    #[cfg(target_os = "macos")]
    for candidate in HOMEBREW_LAYOUTS {
        if let Some(layout) = validate_layout_candidate(candidate) {
            return Ok(layout);
        }
    }

    #[cfg(target_os = "macos")]
    return Err(
        "No trusted strongSwan installation was found. Supported macOS Homebrew locations are /opt/homebrew/bin/ipsec (Apple Silicon) and /usr/local/bin/ipsec (Intel); reinstall strongSwan if either executable is group/world writable"
            .to_string(),
    );

    #[cfg(not(target_os = "macos"))]
    Err("No trusted root-owned, non-writable strongSwan ipsec binary was found".to_string())
}

#[cfg(not(windows))]
fn validate_layout_candidate(candidate: &LayoutCandidate) -> Option<IpsecLayout> {
    let configured_binary = Path::new(candidate.binary);
    let canonical_binary = std::fs::canonicalize(configured_binary).ok()?;
    let metadata = std::fs::metadata(&canonical_binary).ok()?;
    if !metadata.is_file() || metadata.mode() & 0o022 != 0 {
        return None;
    }

    if candidate.allow_user_owned {
        let expected_prefix = Path::new(candidate.config_root).parent()?;
        // SAFETY: geteuid has no preconditions and only returns process state.
        let current_uid = unsafe { libc::geteuid() };
        if !canonical_binary.starts_with(expected_prefix)
            || (metadata.uid() != 0 && metadata.uid() != current_uid)
        {
            return None;
        }
    } else if metadata.uid() != 0 {
        return None;
    }

    let layout = IpsecLayout {
        binary: canonical_binary,
        config_root: PathBuf::from(candidate.config_root),
        // Homebrew prefixes are controlled by the login user. Executing or
        // writing through them as root would cross an unsafe trust boundary;
        // those layouts are therefore direct-access only.
        allow_elevation: !candidate.allow_user_owned,
    };
    if layout.allow_elevation && validate_privileged_path(&layout, &layout.config_root).is_err() {
        return None;
    }
    Some(layout)
}

#[cfg(not(windows))]
fn require_elevation_allowed(layout: &IpsecLayout, operation: &str) -> Result<(), String> {
    if layout.allow_elevation {
        Ok(())
    } else {
        Err(format!(
            "Cannot {operation} with administrator privileges from a user-owned Homebrew prefix. Run strongSwan through a separately installed root-owned service/helper, or grant the current user the required direct access; SortOfRemoteNG will not elevate a user-owned executable"
        ))
    }
}

#[cfg(not(windows))]
fn validate_privileged_path(layout: &IpsecLayout, destination: &Path) -> Result<(), String> {
    if !destination.starts_with(&layout.config_root) {
        return Err(
            "Refusing privileged access outside the strongSwan configuration root".to_string(),
        );
    }
    let canonical_root = std::fs::canonicalize(&layout.config_root).map_err(|error| {
        format!(
            "Failed to resolve strongSwan configuration root {}: {error}",
            layout.config_root.display()
        )
    })?;
    let root_metadata = std::fs::metadata(&canonical_root).map_err(|error| {
        format!(
            "Failed to inspect strongSwan configuration root {}: {error}",
            canonical_root.display()
        )
    })?;
    if !root_metadata.is_dir() || root_metadata.uid() != 0 || root_metadata.mode() & 0o022 != 0 {
        return Err(format!(
            "Refusing privileged strongSwan access because {} is not a root-owned, non-group/world-writable directory",
            canonical_root.display()
        ));
    }

    let parent_search_root = if destination == layout.config_root {
        destination
    } else {
        destination.parent().unwrap_or(destination)
    };
    let existing_parent = parent_search_root
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "No existing parent for strongSwan destination".to_string())?;
    let canonical_parent = std::fs::canonicalize(existing_parent).map_err(|error| {
        format!(
            "Failed to resolve strongSwan destination parent {}: {error}",
            existing_parent.display()
        )
    })?;
    let parent_metadata = std::fs::metadata(&canonical_parent).map_err(|error| {
        format!(
            "Failed to inspect strongSwan destination parent {}: {error}",
            canonical_parent.display()
        )
    })?;
    if !canonical_parent.starts_with(&canonical_root)
        || !parent_metadata.is_dir()
        || parent_metadata.uid() != 0
        || parent_metadata.mode() & 0o022 != 0
    {
        return Err("Refusing an unsafe strongSwan destination parent".to_string());
    }

    if let Ok(metadata) = std::fs::symlink_metadata(destination) {
        if metadata.file_type().is_symlink() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0
        {
            return Err(format!(
                "Refusing privileged access to unsafe strongSwan path {}",
                destination.display()
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
async fn ensure_managed_includes(layout: &IpsecLayout) -> Result<(), String> {
    let fragment_directory = layout.config_root.join("ipsec.d");
    ensure_directory(layout, &fragment_directory).await?;

    let config_include = format!("include {}/sorng_*.conf", fragment_directory.display());
    let secrets_include = format!("include {}/sorng_*.secrets", fragment_directory.display());
    ensure_managed_include(
        layout,
        &layout.config_root.join("ipsec.conf"),
        &config_include,
        "644",
    )
    .await?;
    ensure_sensitive_managed_include(
        layout,
        &layout.config_root.join("ipsec.secrets"),
        &secrets_include,
    )
    .await
}

#[cfg(not(windows))]
async fn ensure_directory(layout: &IpsecLayout, path: &Path) -> Result<(), String> {
    match tokio::fs::create_dir_all(path).await {
        Ok(()) => {
            if layout.allow_elevation {
                validate_privileged_path(layout, path)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            require_elevation_allowed(layout, "create the strongSwan fragment directory")?;
            validate_privileged_path(layout, path)?;
            let mkdir = trusted_binary(TRUSTED_MKDIR_BINARIES, "mkdir")?;
            let arguments = vec!["-p".to_string(), path.to_string_lossy().into_owned()];
            let output =
                run_elevated(&mkdir, &arguments, "create IPsec configuration directory").await?;
            if output.status.success() {
                Ok(())
            } else {
                Err(command_failure(
                    "create privileged IPsec configuration directory",
                    &output,
                ))
            }
        }
        Err(error) => Err(format!(
            "Failed to create IPsec configuration directory {}: {error}",
            path.display()
        )),
    }
}

#[cfg(not(windows))]
async fn ensure_managed_include(
    layout: &IpsecLayout,
    path: &Path,
    include_line: &str,
    mode: &str,
) -> Result<(), String> {
    let initial_metadata = tokio::fs::metadata(path).await.ok();
    let existing = match tokio::fs::read(path).await {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Zeroizing::new)
            .map_err(|_| format!("{} is not valid UTF-8", path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Zeroizing::new(String::new()),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            if verify_managed_include_elevated(layout, path, include_line).await? {
                return Ok(());
            }
            return Err(format!(
                "The protected strongSwan file {} does not contain the required managed include. Ask an administrator to add this exact line once: {include_line}",
                path.display()
            ));
        }
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };
    verify_file_unchanged(path, initial_metadata.as_ref())?;
    let Some(updated) = append_managed_include(&existing, include_line) else {
        return Ok(());
    };
    verify_file_unchanged(path, initial_metadata.as_ref())?;
    install_private_file(layout, path, Zeroizing::new(updated), mode).await
}

#[cfg(not(windows))]
fn verify_file_unchanged(path: &Path, initial: Option<&std::fs::Metadata>) -> Result<(), String> {
    let current = std::fs::metadata(path).ok();
    let unchanged = match (initial, current.as_ref()) {
        (None, None) => true,
        (Some(initial), Some(current)) => {
            initial.dev() == current.dev()
                && initial.ino() == current.ino()
                && initial.len() == current.len()
                && initial.mtime() == current.mtime()
                && initial.mtime_nsec() == current.mtime_nsec()
        }
        _ => false,
    };
    if unchanged {
        Ok(())
    } else {
        Err(format!(
            "{} changed while SortOfRemoteNG was preparing the managed include; retry the operation",
            path.display()
        ))
    }
}

#[cfg(not(windows))]
async fn verify_managed_include_elevated(
    layout: &IpsecLayout,
    path: &Path,
    include_line: &str,
) -> Result<bool, String> {
    require_elevation_allowed(layout, "verify the protected strongSwan include")?;
    validate_privileged_path(layout, path)?;
    let grep = trusted_binary(TRUSTED_GREP_BINARIES, "grep")?;
    let arguments = vec![
        "-Fqx".to_string(),
        "--".to_string(),
        include_line.to_string(),
        path.to_string_lossy().into_owned(),
    ];
    let output = run_elevated(&grep, &arguments, "verify strongSwan managed include").await?;
    if output.status.success() {
        Ok(true)
    } else if output.status.code() == Some(1) {
        Ok(false)
    } else {
        Err(command_failure(
            "verify strongSwan managed include",
            &output,
        ))
    }
}

#[cfg(not(windows))]
fn append_managed_include(existing: &str, include_line: &str) -> Option<String> {
    if managed_include_present(existing, include_line) {
        return None;
    }

    let mut updated = existing.to_string();
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    if !updated.is_empty() {
        updated.push('\n');
    }
    updated.push_str("# SortOfRemoteNG managed connection fragments\n");
    updated.push_str(include_line);
    updated.push('\n');
    Some(updated)
}

#[cfg(not(windows))]
fn managed_include_present(existing: &str, include_line: &str) -> bool {
    let accepted = covering_include_lines(include_line);
    existing
        .lines()
        .map(str::trim)
        .any(|line| accepted.iter().any(|candidate| line == candidate))
}

#[cfg(not(windows))]
fn covering_include_lines(include_line: &str) -> Vec<String> {
    let mut lines = vec![include_line.to_string()];
    if let Some((prefix, extension)) = include_line.rsplit_once("sorng_*.") {
        lines.push(format!("{prefix}*.{extension}"));
        lines.push(format!("{prefix}*"));
    }
    lines
}

/// Ensure the global secrets file references our fragments without ever
/// reading or rewriting its contents. Direct access uses a locked O_APPEND
/// write of a fixed literal; protected files are only probed with grep and
/// require a one-time administrator edit when the line is absent.
#[cfg(not(windows))]
async fn ensure_sensitive_managed_include(
    layout: &IpsecLayout,
    path: &Path,
    include_line: &str,
) -> Result<(), String> {
    if layout.allow_elevation {
        validate_privileged_path(layout, path)?;
    }
    let grep = trusted_binary(TRUSTED_GREP_BINARIES, "grep")?;
    let path_owned = path.to_path_buf();
    let accepted = covering_include_lines(include_line);
    let include_owned = include_line.to_string();
    let direct = tokio::task::spawn_blocking(move || {
        append_sensitive_include_locked(&path_owned, &grep, &accepted, &include_owned)
    })
    .await
    .map_err(|error| format!("Sensitive include task failed: {error}"))??;
    if direct {
        return Ok(());
    }

    for candidate in covering_include_lines(include_line) {
        if verify_managed_include_elevated(layout, path, &candidate).await? {
            return Ok(());
        }
    }
    Err(format!(
        "The protected strongSwan file {} does not contain an include covering SortOfRemoteNG secrets. Ask an administrator to add this exact line once: {include_line}",
        path.display()
    ))
}

#[cfg(not(windows))]
fn append_sensitive_include_locked(
    path: &Path,
    grep: &Path,
    accepted_lines: &[String],
    include_line: &str,
) -> Result<bool, String> {
    use std::os::fd::AsRawFd;

    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "Refusing to modify symlinked secrets file {}",
            path.display()
        ));
    }
    let mut file = match OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return Ok(false),
        Err(error) => return Err(format!("Failed to open {}: {error}", path.display())),
    };
    // SAFETY: file is an open regular-file descriptor for this scope.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(format!("Failed to lock {}", path.display()));
    }
    let result = (|| {
        for accepted in accepted_lines {
            let status = std::process::Command::new(grep)
                .args(["-Fqx", "--", accepted])
                .arg(path)
                .env("LC_ALL", "C")
                .status()
                .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
            if status.success() {
                return Ok(());
            }
            if status.code() != Some(1) {
                return Err(format!("Failed to inspect {}", path.display()));
            }
        }
        let block = format!("\n# SortOfRemoteNG managed connection fragments\n{include_line}\n");
        file.write_all(block.as_bytes())
            .map_err(|error| format!("Failed to append {}: {error}", path.display()))?;
        file.sync_data()
            .map_err(|error| format!("Failed to sync {}: {error}", path.display()))
    })();
    // SAFETY: releasing a lock held on the same valid descriptor.
    let _ = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
    result.map(|_| true)
}

/// Write a validated ipsec.conf connection block. The rendered file is first
/// created as a private 0600 temporary file and then installed into /etc. When
/// the direct install is not permitted, Linux may use the trusted `pkexec`
/// broker instead of attempting to embed data in a privileged shell command.
#[cfg(not(windows))]
pub async fn write_ipsec_conf(spec: IpsecConnectionSpec<'_>) -> Result<String, String> {
    let config = render_ipsec_conf(&spec)?;
    let layout = resolve_ipsec_layout()?;
    ensure_managed_includes(&layout).await?;
    let config_path = protected_path(&layout, spec.conn_name, "conf")?;
    install_private_file(&layout, &config_path, Zeroizing::new(config), "600").await?;
    Ok(config_path.to_string_lossy().into_owned())
}

/// Write the transport-mode IKEv1 policy required by L2TP/IPsec. L2TP must
/// not reuse an IKEv2 tunnel-mode policy: its protected traffic is UDP/1701
/// between the two IPsec peers.
#[cfg(not(windows))]
pub async fn write_l2tp_ipsec_conf(
    conn_name: &str,
    server: &str,
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    let config = render_l2tp_ipsec_conf(conn_name, server, phase1, phase2)?;
    let layout = resolve_ipsec_layout()?;
    ensure_managed_includes(&layout).await?;
    let config_path = protected_path(&layout, conn_name, "conf")?;
    install_private_file(&layout, &config_path, Zeroizing::new(config), "600").await?;
    Ok(config_path.to_string_lossy().into_owned())
}

/// Write a validated ipsec.secrets entry. Secret content is kept out of child
/// process arguments and is zeroized after the private temporary file is
/// written.
#[cfg(not(windows))]
pub async fn write_ipsec_secrets(
    conn_name: &str,
    local_id: Option<&str>,
    remote_id: &str,
    secret_type: &str,
    secret_value: &str,
) -> Result<String, String> {
    let content = render_ipsec_secrets(conn_name, local_id, remote_id, secret_type, secret_value)?;
    let layout = resolve_ipsec_layout()?;
    ensure_managed_includes(&layout).await?;
    let secrets_path = protected_path(&layout, conn_name, "secrets")?;
    install_private_file(&layout, &secrets_path, content, "600").await?;
    Ok(secrets_path.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
fn render_ipsec_conf(spec: &IpsecConnectionSpec<'_>) -> Result<String, String> {
    validate_connection_name(spec.conn_name)?;
    validation::validate_hostname(spec.server)?;
    let local_auth = validate_auth_method(spec.local_auth)?;
    let remote_auth = validate_auth_method(spec.remote_auth)?;
    let local_id = quote_ipsec_value(spec.local_id.unwrap_or("%any"), "local identity")?;
    let remote_id = quote_ipsec_value(spec.remote_id.unwrap_or(spec.server), "remote identity")?;
    let eap_identity = spec
        .eap_identity
        .map(|value| quote_ipsec_value(value, "EAP identity"))
        .transpose()?;
    let phase1 = validate_proposal(spec.phase1.unwrap_or("aes256-sha256-modp2048"), "IKE")?;
    let phase2 = validate_proposal(spec.phase2.unwrap_or("aes256-sha256"), "ESP")?;

    let eap_identity_line = eap_identity
        .map(|value| format!("    eap_identity={value}\n"))
        .unwrap_or_default();

    Ok(format!(
        "conn {}\n    type=tunnel\n    left=%defaultroute\n    leftsourceip=%config\n    leftid={local_id}\n    leftauth={local_auth}\n{eap_identity_line}    right={}\n    rightid={remote_id}\n    rightauth={remote_auth}\n    rightsubnet=0.0.0.0/0,::/0\n    ike={phase1}\n    esp={phase2}\n    keyexchange=ikev2\n    auto=add\n",
        spec.conn_name, spec.server
    ))
}

#[cfg(not(windows))]
fn render_l2tp_ipsec_conf(
    conn_name: &str,
    server: &str,
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    validate_connection_name(conn_name)?;
    validation::validate_hostname(server)?;
    let phase1 = validate_proposal(phase1.unwrap_or("aes256-sha256-modp2048"), "IKE")?;
    let phase2 = validate_proposal(phase2.unwrap_or("aes256-sha256"), "ESP")?;
    Ok(format!(
        "conn {conn_name}\n    type=transport\n    left=%defaultroute\n    leftauth=psk\n    leftprotoport=17/%any\n    right={server}\n    rightauth=psk\n    rightprotoport=17/1701\n    ike={phase1}\n    esp={phase2}\n    keyexchange=ikev1\n    auto=add\n"
    ))
}

#[cfg(not(windows))]
fn render_ipsec_secrets(
    conn_name: &str,
    local_id: Option<&str>,
    remote_id: &str,
    secret_type: &str,
    secret_value: &str,
) -> Result<Zeroizing<String>, String> {
    validate_connection_name(conn_name)?;
    let local = quote_ipsec_secret_selector(local_id.unwrap_or("%any"), "local identity")?;
    let remote = quote_ipsec_secret_selector(remote_id, "remote identity")?;
    if secret_value.is_empty() {
        return Err("IPsec secret must not be empty".to_string());
    }

    let content = match secret_type {
        // strongSwan's stroke parser accepts RFC 4648 base64 after the `0s`
        // prefix. Unlike quoted ipsec.secrets values, this form is reversible
        // for every byte and cannot terminate the line or quoted token early.
        "PSK" => format!(
            "{local} {remote} : PSK 0s{}\n",
            BASE64_STANDARD.encode(secret_value.as_bytes())
        ),
        "EAP" => format!(
            "{local} : EAP 0s{}\n",
            BASE64_STANDARD.encode(secret_value.as_bytes())
        ),
        "RSA" => {
            validation::validate_path_safe(secret_value)?;
            format!(
                ": RSA {}\n",
                quote_ipsec_secret_selector(secret_value, "RSA private key path")?
            )
        }
        _ => return Err("Unsupported IPsec secret type".to_string()),
    };
    Ok(Zeroizing::new(content))
}

#[cfg(not(windows))]
fn validate_connection_name(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 128 {
        return Err("IPsec connection name must contain 1-128 characters".to_string());
    }
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Ok(value)
    } else {
        Err("IPsec connection name contains invalid characters".to_string())
    }
}

#[cfg(not(windows))]
fn validate_auth_method(value: &str) -> Result<&str, String> {
    match value {
        "psk" | "pubkey" | "eap-mschapv2" | "eap-tls" | "eap-peap" => Ok(value),
        _ => Err("Unsupported strongSwan authentication method".to_string()),
    }
}

#[cfg(not(windows))]
fn validate_proposal<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    if value.is_empty() || value.len() > 512 {
        return Err(format!("{label} proposal must contain 1-512 characters"));
    }
    if value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ',' | '+' | '!')
    }) {
        Ok(value)
    } else {
        Err(format!("{label} proposal contains invalid characters"))
    }
}

#[cfg(not(windows))]
fn quote_ipsec_value(value: &str, label: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 4096 {
        return Err(format!("{label} must contain 1-4096 characters"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

#[cfg(not(windows))]
fn quote_ipsec_secret_selector(value: &str, label: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 4096 {
        return Err(format!("{label} must contain 1-4096 characters"));
    }
    if value.chars().any(char::is_control) || value.contains('"') {
        return Err(format!(
            "{label} must not contain control characters or double quotes"
        ));
    }
    // ipsec.secrets' stroke parser does not unescape backslashes in quoted
    // selectors, so preserve them byte-for-byte and reject the only character
    // that could terminate the token.
    Ok(format!("\"{value}\""))
}

#[cfg(not(windows))]
fn protected_path(
    layout: &IpsecLayout,
    conn_name: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    validate_connection_name(conn_name)?;
    Ok(layout
        .config_root
        .join("ipsec.d")
        .join(format!("sorng_{conn_name}.{extension}")))
}

#[cfg(not(windows))]
async fn install_private_file(
    layout: &IpsecLayout,
    destination: &Path,
    content: Zeroizing<String>,
    mode: &str,
) -> Result<(), String> {
    let temp_path =
        std::env::temp_dir().join(format!("sortofremoteng-ipsec-{}", Uuid::new_v4().simple()));
    if let Err(error) = write_private_temp_file(temp_path.clone(), content).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(error);
    }

    let install_result = install_file(layout, &temp_path, destination, mode).await;
    let cleanup_result = tokio::fs::remove_file(&temp_path).await;
    if let Err(error) = cleanup_result {
        log::warn!(
            "Failed to remove temporary private IPsec file {}: {error}",
            temp_path.display()
        );
    }
    install_result
}

#[cfg(not(windows))]
async fn write_private_temp_file(path: PathBuf, content: Zeroizing<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|error| format!("Failed to create private IPsec staging file: {error}"))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("Failed to write private IPsec staging file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Failed to sync private IPsec staging file: {error}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("Private IPsec file task failed: {error}"))?
}

#[cfg(not(windows))]
async fn install_file(
    layout: &IpsecLayout,
    source: &Path,
    destination: &Path,
    mode: &str,
) -> Result<(), String> {
    let mode = match mode {
        "600" | "644" => mode,
        _ => return Err("Unsupported IPsec file mode".to_string()),
    };
    if layout.allow_elevation {
        validate_privileged_path(layout, destination)?;
    }
    let install = trusted_binary(TRUSTED_INSTALL_BINARIES, "install")?;
    let arguments = vec![
        "-m".to_string(),
        mode.to_string(),
        source.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
    ];
    let output = Command::new(&install)
        .args(&arguments)
        .env("LC_ALL", "C")
        .output()
        .await
        .map_err(|error| format!("Failed to install IPsec configuration: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    if looks_like_permission_failure(&output) {
        require_elevation_allowed(layout, "install strongSwan configuration")?;
        validate_privileged_path(layout, destination)?;
        let elevated = run_elevated(&install, &arguments, "install IPsec configuration").await?;
        if elevated.status.success() {
            return Ok(());
        }
        return Err(command_failure(
            "Privileged IPsec configuration install",
            &elevated,
        ));
    }
    Err(command_failure("install IPsec configuration", &output))
}

/// Bring up an IPsec connection via `ipsec up`.
#[cfg(not(windows))]
pub async fn ipsec_up(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    run_ipsec(&["reload"], "reload IPsec configuration").await?;
    run_ipsec(&["rereadsecrets"], "reload IPsec secrets").await?;
    run_ipsec(&["up", conn_name], "bring up IPsec connection").await?;
    Ok(())
}

/// Bring a connection up and attempt a down operation if startup reports an
/// error, since strongSwan may have installed a partial CHILD_SA before the
/// command failed.
#[cfg(not(windows))]
pub async fn ipsec_up_transactional(conn_name: &str) -> Result<(), String> {
    match ipsec_up(conn_name).await {
        Ok(()) => Ok(()),
        Err(setup_error) => match ipsec_down(conn_name).await {
            Ok(()) => Err(setup_error),
            Err(teardown_error) => Err(format!(
                "{setup_error}; additionally failed to tear down a partial IPsec setup: {teardown_error}"
            )),
        },
    }
}

/// Bring down an IPsec connection via `ipsec down`.
#[cfg(not(windows))]
pub async fn ipsec_down(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    run_ipsec(&["down", conn_name], "bring down IPsec connection").await?;
    Ok(())
}

#[cfg(not(windows))]
async fn run_ipsec(arguments: &[&str], operation: &str) -> Result<std::process::Output, String> {
    let layout = resolve_ipsec_layout()?;
    let output = Command::new(&layout.binary)
        .args(arguments)
        .env("LC_ALL", "C")
        .output()
        .await
        .map_err(|error| format!("Failed to {operation}: {error}"))?;
    if output.status.success() {
        return Ok(output);
    }

    if looks_like_permission_failure(&output) {
        require_elevation_allowed(&layout, operation)?;
        validate_privileged_path(&layout, &layout.config_root)?;
        let owned_arguments: Vec<String> =
            arguments.iter().map(|value| (*value).to_string()).collect();
        let elevated = run_elevated(&layout.binary, &owned_arguments, operation).await?;
        if elevated.status.success() {
            return Ok(elevated);
        }
        return Err(command_failure(operation, &elevated));
    }

    Err(command_failure(operation, &output))
}

#[cfg(not(windows))]
async fn run_elevated(
    binary: &Path,
    arguments: &[String],
    operation: &str,
) -> Result<std::process::Output, String> {
    #[cfg(target_os = "linux")]
    {
        return run_pkexec(binary, arguments, operation).await;
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (binary, arguments);
        Err(format!(
            "Administrator privileges are required to {operation}, but this build has no signed privileged-helper boundary; refusing to elevate strongSwan directly"
        ))
    }
}

#[cfg(all(not(windows), target_os = "linux"))]
async fn run_pkexec(
    binary: &Path,
    arguments: &[String],
    operation: &str,
) -> Result<std::process::Output, String> {
    let pkexec = trusted_binary(TRUSTED_PKEXEC_BINARIES, "pkexec")?;
    Command::new(pkexec)
        .arg(binary)
        .args(arguments)
        .env("LC_ALL", "C")
        .output()
        .await
        .map_err(|error| format!("Failed to request privileges to {operation}: {error}"))
}

#[cfg(not(windows))]
fn trusted_binary(candidates: &[&str], name: &str) -> Result<PathBuf, String> {
    for candidate in candidates {
        let path = Path::new(candidate);
        let Ok(metadata) = std::fs::metadata(path) else {
            continue;
        };
        if metadata.is_file() && metadata.uid() == 0 && metadata.mode() & 0o022 == 0 {
            return Ok(path.to_path_buf());
        }
    }
    Err(format!(
        "No trusted root-owned, non-writable {name} binary was found"
    ))
}

#[cfg(not(windows))]
fn looks_like_permission_failure(output: &std::process::Output) -> bool {
    let diagnostic = command_diagnostic(output).to_ascii_lowercase();
    diagnostic.contains("permission denied")
        || diagnostic.contains("operation not permitted")
        || diagnostic.contains("not authorized")
        || diagnostic.contains("must be root")
}

#[cfg(not(windows))]
fn command_diagnostic(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        stderr
    } else {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }
}

#[cfg(not(windows))]
fn command_failure(operation: &str, output: &std::process::Output) -> String {
    format!("Failed to {operation}: {}", command_diagnostic(output))
}

/// Remove IPsec config and secrets files for a connection.
#[cfg(not(windows))]
pub async fn cleanup_ipsec_files(conn_name: &str) -> Result<(), String> {
    let layout = resolve_ipsec_layout()?;
    let config_path = protected_path(&layout, conn_name, "conf")?;
    let secrets_path = protected_path(&layout, conn_name, "secrets")?;
    let mut errors = Vec::new();
    if let Err(error) = remove_protected_file(&layout, &config_path).await {
        errors.push(error);
    }
    if let Err(error) = remove_protected_file(&layout, &secrets_path).await {
        errors.push(error);
    }
    if let Err(error) = run_ipsec(&["reload"], "reload IPsec configuration").await {
        errors.push(error);
    }
    if let Err(error) = run_ipsec(&["rereadsecrets"], "reload IPsec secrets").await {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Reconcile a deterministic strongSwan connection and remove its managed
/// files. Every step is attempted and failures are returned together so a
/// caller never reports Disconnected after uncertain teardown.
#[cfg(not(windows))]
pub async fn teardown_ipsec_connection(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    let mut errors = Vec::new();
    match is_ipsec_active(conn_name).await {
        Ok(true) => {
            if let Err(error) = ipsec_down(conn_name).await {
                errors.push(error);
            }
        }
        Ok(false) => {}
        Err(error) => errors.push(error),
    }
    if let Err(error) = cleanup_ipsec_files(conn_name).await {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(not(windows))]
async fn remove_protected_file(layout: &IpsecLayout, path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) if error.kind() != std::io::ErrorKind::PermissionDenied => {
            return Err(format!("Failed to remove {}: {error}", path.display()))
        }
        Err(_) => {}
    }

    require_elevation_allowed(layout, "remove strongSwan configuration")?;
    validate_privileged_path(layout, path)?;
    let rm = trusted_binary(TRUSTED_RM_BINARIES, "rm")?;
    let arguments = vec![path.to_string_lossy().into_owned()];
    let output = run_elevated(&rm, &arguments, "remove IPsec configuration").await?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_failure(
        "remove privileged IPsec configuration",
        &output,
    ))
}

/// Check if an IPsec connection is active.
#[cfg(not(windows))]
pub async fn is_ipsec_active(conn_name: &str) -> Result<bool, String> {
    validate_connection_name(conn_name)?;
    let output = run_ipsec(&["status", conn_name], "query IPsec status").await?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("ESTABLISHED") || stdout.contains("INSTALLED"))
}

// Windows stubs (strongSwan is unavailable; Windows uses RAS).
#[cfg(windows)]
pub async fn write_ipsec_conf(_: IpsecConnectionSpec<'_>) -> Result<String, String> {
    Err("strongSwan is not available on Windows. Use the Windows RAS API.".to_string())
}
#[cfg(windows)]
pub async fn write_l2tp_ipsec_conf(
    _: &str,
    _: &str,
    _: Option<&str>,
    _: Option<&str>,
) -> Result<String, String> {
    Err("strongSwan is not available on Windows. Use the Windows RAS API.".to_string())
}
#[cfg(windows)]
pub async fn write_ipsec_secrets(
    _: &str,
    _: Option<&str>,
    _: &str,
    _: &str,
    _: &str,
) -> Result<String, String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_up(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_up_transactional(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_down(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn cleanup_ipsec_files(_: &str) -> Result<(), String> {
    Ok(())
}
#[cfg(windows)]
pub async fn teardown_ipsec_connection(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn is_ipsec_active(_: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn config_renderer_rejects_directive_and_proposal_injection() {
        assert!(render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com\ninclude /tmp/evil.conf",
            local_id: None,
            remote_id: None,
            local_auth: "psk",
            remote_auth: "psk",
            eap_identity: None,
            phase1: None,
            phase2: None,
        })
        .is_err());
        assert!(render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: None,
            remote_id: None,
            local_auth: "psk\nrightauth=pubkey",
            remote_auth: "psk",
            eap_identity: None,
            phase1: None,
            phase2: None,
        })
        .is_err());
        assert!(render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: None,
            remote_id: None,
            local_auth: "psk",
            remote_auth: "psk",
            eap_identity: None,
            phase1: Some("aes256; include /tmp/evil.conf"),
            phase2: None,
        })
        .is_err());
    }

    #[test]
    fn eap_renderer_separates_client_and_server_auth_and_requests_routes() {
        let rendered = render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: Some("alice@example.com"),
            remote_id: Some("gateway.example.com"),
            local_auth: "eap-mschapv2",
            remote_auth: "pubkey",
            eap_identity: Some("alice@example.com"),
            phase1: None,
            phase2: None,
        })
        .unwrap();
        assert!(rendered.contains("leftauth=eap-mschapv2"));
        assert!(rendered.contains("rightauth=pubkey"));
        assert!(rendered.contains("eap_identity=\"alice@example.com\""));
        assert!(rendered.contains("leftsourceip=%config"));
        assert!(rendered.contains("rightsubnet=0.0.0.0/0,::/0"));
    }

    #[test]
    fn secrets_renderer_base64_round_trips_every_secret_byte() {
        let secret = "quote\" slash\\ dollar$ semicolon;\nnull\0Unicode €";
        let rendered = render_ipsec_secrets(
            "safe_name",
            Some("alice@example.com"),
            "vpn.example.com",
            "PSK",
            secret,
        )
        .unwrap();
        assert_eq!(rendered.lines().count(), 1);
        assert!(!rendered.contains(secret));
        let encoded = rendered
            .split_once(" : PSK 0s")
            .expect("PSK marker")
            .1
            .trim();
        assert_eq!(BASE64_STANDARD.decode(encoded).unwrap(), secret.as_bytes());
        assert!(render_ipsec_secrets(
            "safe_name",
            Some("selector\"break"),
            "vpn.example.com",
            "PSK",
            "secret",
        )
        .is_err());
    }

    #[test]
    fn l2tp_renderer_uses_ikev1_transport_udp_1701() {
        let rendered = render_l2tp_ipsec_conf("safe_name", "vpn.example.com", None, None).unwrap();
        assert!(rendered.contains("type=transport"));
        assert!(rendered.contains("keyexchange=ikev1"));
        assert!(rendered.contains("leftprotoport=17/%any"));
        assert!(rendered.contains("rightprotoport=17/1701"));
        assert!(!rendered.contains("rightsubnet="));
    }

    #[test]
    fn managed_include_append_is_preserving_and_idempotent() {
        let existing = "# administrator settings\nconfig setup\n    uniqueids=no\n";
        let include = "include /etc/ipsec.d/sorng_*.conf";
        let updated = append_managed_include(existing, include).unwrap();
        assert!(updated.starts_with(existing));
        assert_eq!(updated.matches(include).count(), 1);
        assert!(append_managed_include(&updated, include).is_none());
        assert!(append_managed_include("include /etc/ipsec.d/*.conf\n", include,).is_none());
    }

    #[test]
    fn sensitive_include_append_preserves_existing_secret_bytes() {
        let path = std::env::temp_dir().join(format!(
            "sortofremoteng-ipsec-secrets-test-{}",
            Uuid::new_v4().simple()
        ));
        let original = b": RSA sentinel-private-key\n";
        std::fs::write(&path, original).unwrap();
        let grep = trusted_binary(TRUSTED_GREP_BINARIES, "grep").unwrap();
        let include = format!(
            "include {}/sorng_*.secrets",
            path.parent().unwrap().display()
        );
        let accepted = covering_include_lines(&include);
        assert!(append_sensitive_include_locked(&path, &grep, &accepted, &include).unwrap());
        assert!(append_sensitive_include_locked(&path, &grep, &accepted, &include).unwrap());
        let after = std::fs::read(&path).unwrap();
        assert!(after.starts_with(original));
        assert_eq!(String::from_utf8_lossy(&after).matches(&include).count(), 1);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn psk_secret_selector_uses_the_effective_remote_identity() {
        let rendered =
            render_ipsec_secrets("safe_name", None, "gateway-id.example.com", "PSK", "secret")
                .unwrap();
        assert!(rendered.starts_with("\"%any\" \"gateway-id.example.com\" : PSK 0s"));
    }

    #[test]
    fn homebrew_layouts_cover_apple_silicon_and_intel_prefixes() {
        assert!(HOMEBREW_LAYOUTS.iter().any(|layout| {
            layout.binary == "/opt/homebrew/bin/ipsec"
                && layout.config_root == "/opt/homebrew/etc"
                && layout.allow_user_owned
        }));
        assert!(HOMEBREW_LAYOUTS.iter().any(|layout| {
            layout.binary == "/usr/local/bin/ipsec"
                && layout.config_root == "/usr/local/etc"
                && layout.allow_user_owned
        }));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn privileged_layout_root_validates_itself() {
        let layout = IpsecLayout {
            binary: PathBuf::from("/usr/sbin/ipsec"),
            config_root: PathBuf::from("/"),
            allow_elevation: true,
        };
        validate_privileged_path(&layout, &layout.config_root).unwrap();
    }

    #[tokio::test]
    async fn staging_files_are_owner_only() {
        let path = std::env::temp_dir().join(format!(
            "sortofremoteng-ipsec-mode-test-{}",
            Uuid::new_v4().simple()
        ));
        write_private_temp_file(path.clone(), Zeroizing::new("secret".to_string()))
            .await
            .unwrap();
        let metadata = std::fs::metadata(&path).unwrap();
        assert_eq!(metadata.mode() & 0o777, 0o600);
        std::fs::remove_file(path).unwrap();
    }
}
