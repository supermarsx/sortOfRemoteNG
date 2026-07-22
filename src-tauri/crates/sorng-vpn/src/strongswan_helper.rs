//! Linux/macOS strongSwan helper for IPsec-based VPN protocols.
//! Provides shared functions for IKEv2, IPsec, and L2TP/IPsec connections.

#[cfg(not(windows))]
use crate::validation;
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

#[cfg(not(windows))]
const IPSEC_DIRECTORY: &str = "/etc/ipsec.d";
#[cfg(not(windows))]
const TRUSTED_IPSEC_BINARIES: &[&str] =
    &["/usr/sbin/ipsec", "/sbin/ipsec", "/usr/local/sbin/ipsec"];
#[cfg(not(windows))]
const TRUSTED_INSTALL_BINARIES: &[&str] = &["/usr/bin/install", "/bin/install"];
#[cfg(all(not(windows), target_os = "linux"))]
const TRUSTED_PKEXEC_BINARIES: &[&str] = &["/usr/bin/pkexec", "/bin/pkexec"];

/// Write a validated ipsec.conf connection block. The rendered file is first
/// created as a private 0600 temporary file and then installed into /etc. When
/// the direct install is not permitted, Linux may use the trusted `pkexec`
/// broker instead of attempting to embed data in a privileged shell command.
#[cfg(not(windows))]
pub async fn write_ipsec_conf(
    conn_name: &str,
    server: &str,
    local_id: Option<&str>,
    remote_id: Option<&str>,
    auth_method: &str,
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    let config = render_ipsec_conf(
        conn_name,
        server,
        local_id,
        remote_id,
        auth_method,
        phase1,
        phase2,
    )?;
    let config_path = protected_path(conn_name, "conf")?;
    install_private_file(&config_path, Zeroizing::new(config)).await?;
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
    let secrets_path = protected_path(conn_name, "secrets")?;
    install_private_file(&secrets_path, content).await?;
    Ok(secrets_path.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
fn render_ipsec_conf(
    conn_name: &str,
    server: &str,
    local_id: Option<&str>,
    remote_id: Option<&str>,
    auth_method: &str,
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    validate_connection_name(conn_name)?;
    validation::validate_hostname(server)?;
    let auth_method = validate_auth_method(auth_method)?;
    let local_id = quote_ipsec_value(local_id.unwrap_or("%any"), "local identity")?;
    let remote_id = quote_ipsec_value(remote_id.unwrap_or(server), "remote identity")?;
    let phase1 = validate_proposal(phase1.unwrap_or("aes256-sha256-modp2048"), "IKE")?;
    let phase2 = validate_proposal(phase2.unwrap_or("aes256-sha256"), "ESP")?;

    Ok(format!(
        "conn {conn_name}\n    type=tunnel\n    left=%defaultroute\n    leftid={local_id}\n    leftauth={auth_method}\n    right={server}\n    rightid={remote_id}\n    rightauth={auth_method}\n    ike={phase1}\n    esp={phase2}\n    keyexchange=ikev2\n    auto=add\n"
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
    let local = quote_ipsec_value(local_id.unwrap_or("%any"), "local identity")?;
    let remote = quote_ipsec_value(remote_id, "remote identity")?;
    if secret_value.is_empty() {
        return Err("IPsec secret must not be empty".to_string());
    }

    let content = match secret_type {
        "PSK" => format!(
            "{local} {remote} : PSK {}\n",
            quote_ipsec_value(secret_value, "PSK")?
        ),
        "EAP" => format!(
            "{local} : EAP {}\n",
            quote_ipsec_value(secret_value, "EAP secret")?
        ),
        "RSA" => {
            validation::validate_path_safe(secret_value)?;
            format!(
                ": RSA {}\n",
                quote_ipsec_value(secret_value, "RSA private key path")?
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
fn protected_path(conn_name: &str, extension: &str) -> Result<PathBuf, String> {
    validate_connection_name(conn_name)?;
    Ok(Path::new(IPSEC_DIRECTORY).join(format!("sorng_{conn_name}.{extension}")))
}

#[cfg(not(windows))]
async fn install_private_file(
    destination: &Path,
    content: Zeroizing<String>,
) -> Result<(), String> {
    let temp_path =
        std::env::temp_dir().join(format!("sortofremoteng-ipsec-{}", Uuid::new_v4().simple()));
    if let Err(error) = write_private_temp_file(temp_path.clone(), content).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(error);
    }

    let install_result = install_file(&temp_path, destination).await;
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
async fn install_file(source: &Path, destination: &Path) -> Result<(), String> {
    let install = trusted_binary(TRUSTED_INSTALL_BINARIES, "install")?;
    let arguments = vec![
        "-m".to_string(),
        "600".to_string(),
        source.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
    ];
    let output = Command::new(&install)
        .args(&arguments)
        .output()
        .await
        .map_err(|error| format!("Failed to install IPsec configuration: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let elevated = run_pkexec(&install, &arguments, "install IPsec configuration").await?;
        if elevated.status.success() {
            return Ok(());
        }
        Err(command_failure(
            "Privileged IPsec configuration install",
            &elevated,
        ))
    }

    #[cfg(not(target_os = "linux"))]
    Err(format!(
        "Installing IPsec configuration requires administrator privileges: {}",
        command_diagnostic(&output)
    ))
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

/// Bring down an IPsec connection via `ipsec down`.
#[cfg(not(windows))]
pub async fn ipsec_down(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    run_ipsec(&["down", conn_name], "bring down IPsec connection").await?;
    Ok(())
}

#[cfg(not(windows))]
async fn run_ipsec(arguments: &[&str], operation: &str) -> Result<std::process::Output, String> {
    let binary = trusted_binary(TRUSTED_IPSEC_BINARIES, "ipsec")?;
    let output = Command::new(&binary)
        .args(arguments)
        .output()
        .await
        .map_err(|error| format!("Failed to {operation}: {error}"))?;
    if output.status.success() {
        return Ok(output);
    }

    #[cfg(target_os = "linux")]
    if looks_like_permission_failure(&output) {
        let owned_arguments: Vec<String> =
            arguments.iter().map(|value| (*value).to_string()).collect();
        let elevated = run_pkexec(&binary, &owned_arguments, operation).await?;
        if elevated.status.success() {
            return Ok(elevated);
        }
        return Err(command_failure(operation, &elevated));
    }

    Err(command_failure(operation, &output))
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
    let config_path = protected_path(conn_name, "conf")?;
    let secrets_path = protected_path(conn_name, "secrets")?;
    remove_protected_file(&config_path).await?;
    remove_protected_file(&secrets_path).await?;
    run_ipsec(&["reload"], "reload IPsec configuration").await?;
    Ok(())
}

#[cfg(not(windows))]
async fn remove_protected_file(path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) if error.kind() != std::io::ErrorKind::PermissionDenied => {
            return Err(format!("Failed to remove {}: {error}", path.display()))
        }
        Err(_) => {}
    }

    #[cfg(target_os = "linux")]
    {
        let rm = trusted_binary(&["/usr/bin/rm", "/bin/rm"], "rm")?;
        let arguments = vec![path.to_string_lossy().into_owned()];
        let output = run_pkexec(&rm, &arguments, "remove IPsec configuration").await?;
        if output.status.success() {
            return Ok(());
        }
        Err(command_failure(
            "remove privileged IPsec configuration",
            &output,
        ))
    }

    #[cfg(not(target_os = "linux"))]
    Err(format!(
        "Removing {} requires administrator privileges",
        path.display()
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
pub async fn write_ipsec_conf(
    _: &str,
    _: &str,
    _: Option<&str>,
    _: Option<&str>,
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
pub async fn ipsec_down(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn cleanup_ipsec_files(_: &str) -> Result<(), String> {
    Ok(())
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
        assert!(render_ipsec_conf(
            "safe_name",
            "vpn.example.com\ninclude /tmp/evil.conf",
            None,
            None,
            "psk",
            None,
            None,
        )
        .is_err());
        assert!(render_ipsec_conf(
            "safe_name",
            "vpn.example.com",
            None,
            None,
            "psk\nrightauth=pubkey",
            None,
            None,
        )
        .is_err());
        assert!(render_ipsec_conf(
            "safe_name",
            "vpn.example.com",
            None,
            None,
            "psk",
            Some("aes256; include /tmp/evil.conf"),
            None,
        )
        .is_err());
    }

    #[test]
    fn secrets_renderer_quotes_punctuation_and_rejects_newlines() {
        let rendered = render_ipsec_secrets(
            "safe_name",
            Some("alice@example.com"),
            "vpn.example.com",
            "PSK",
            "quote\" slash\\ dollar$ semicolon;",
        )
        .unwrap();
        assert!(rendered.contains("quote\\\" slash\\\\ dollar$ semicolon;"));
        assert!(!rendered.contains("\ninclude"));
        assert!(render_ipsec_secrets(
            "safe_name",
            None,
            "vpn.example.com",
            "PSK",
            "secret\ninclude /tmp/evil.secrets",
        )
        .is_err());
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
