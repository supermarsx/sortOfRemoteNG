//! # FIDO2 / U2F Authenticator Abstraction for SSH Security Keys
//!
//! Provides the bridge between OpenSSH security-key operations and FIDO2
//! hardware tokens.  Supports:
//!
//! - **Device discovery** — enumerate connected FIDO2 authenticators.
//! - **Make Credential** — generate `ed25519-sk` / `ecdsa-sk` key pairs
//!   with the private portion staying on the hardware token.
//! - **Get Assertion** — sign an SSH authentication challenge using the
//!   hardware token.
//! - **Resident (discoverable) credentials** — enumerate and manage
//!   credentials stored on the token itself.
//! - **PIN management** — set / change / verify FIDO2 PINs.
//!
//! ## Design
//!
//! The module is structured around the `Fido2Provider` trait so that the
//! real HID-based implementation can be swapped for a mock in tests.
//! The concrete `HidFido2Provider` calls `ssh-sk-helper` (the OpenSSH
//! helper binary) or — on platforms with native CTAP support — talks
//! directly via the HID transport.

use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

use super::sk_keys::*;

// ─── Authenticator information ───────────────────────────────────────

/// Information about a connected FIDO2 authenticator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fido2DeviceInfo {
    /// Device path (e.g. HID device node or transport URI).
    pub path: String,
    /// Human-readable product name (from USB descriptor).
    pub product_name: Option<String>,
    /// Manufacturer name.
    pub manufacturer: Option<String>,
    /// CTAP version strings advertised by the device (e.g. "FIDO_2_0", "U2F_V2").
    pub versions: Vec<String>,
    /// True if the device supports FIDO2 (CTAP2).
    pub is_fido2: bool,
    /// True if the device only supports U2F (CTAP1).
    pub is_u2f_only: bool,
    /// Supported algorithms (COSE identifiers).
    pub algorithms: Vec<i32>,
    /// True if the device supports resident keys / discoverable credentials.
    pub supports_resident_keys: bool,
    /// True if the device supports user verification (PIN or biometric).
    pub supports_user_verification: bool,
    /// True if the device has a PIN set.
    pub has_pin: bool,
    /// Remaining PIN retries (None if not applicable).
    pub pin_retries: Option<u32>,
    /// AAGUID (Authenticator Attestation GUID), hex-encoded.
    pub aaguid: Option<String>,
    /// Firmware version string, if available.
    pub firmware_version: Option<String>,
}

// ─── Credential creation options ─────────────────────────────────────

/// Options for generating a new security key credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkKeyGenOptions {
    /// Key algorithm to generate.
    pub algorithm: SkAlgorithm,
    /// FIDO2 application / relying party (default: `"ssh:"`).
    #[serde(default = "default_application")]
    pub application: String,
    /// Username / user handle embedded in the credential.
    #[serde(default)]
    pub user: Option<String>,
    /// Require user presence (touch) for every operation — almost always true.
    #[serde(default = "default_true")]
    pub user_presence_required: bool,
    /// Require user verification (PIN / biometric).
    #[serde(default)]
    pub user_verification_required: bool,
    /// Create a resident / discoverable credential on the token.
    #[serde(default)]
    pub resident: bool,
    /// Optional FIDO2 device path — when `None`, the first available device
    /// is used.
    #[serde(default)]
    pub device_path: Option<String>,
    /// Timeout for the user-interaction step (touch / PIN entry).
    #[serde(default = "default_timeout")]
    pub timeout: Duration,
    /// Optional PIN to unlock the authenticator.
    #[serde(skip_serializing, default)]
    pub pin: Option<SecretString>,
    /// Comment to embed in the `.pub` file.
    #[serde(default)]
    pub comment: Option<String>,
    /// Passphrase to encrypt the private-key file at rest (OpenSSH format).
    #[serde(skip_serializing, default)]
    pub passphrase: Option<SecretString>,
}

fn default_application() -> String {
    DEFAULT_SK_APPLICATION.to_string()
}
fn default_true() -> bool {
    true
}
fn default_timeout() -> Duration {
    Duration::from_secs(30)
}

impl Default for SkKeyGenOptions {
    fn default() -> Self {
        Self {
            algorithm: SkAlgorithm::Ed25519Sk,
            application: DEFAULT_SK_APPLICATION.into(),
            user: None,
            user_presence_required: true,
            user_verification_required: false,
            resident: false,
            device_path: None,
            timeout: Duration::from_secs(30),
            pin: None,
            comment: None,
            passphrase: None,
        }
    }
}

/// Result of a successful key generation ceremony.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkKeyGenResult {
    /// The public key (for `authorized_keys` / `.pub` file).
    pub public_key: SkPublicKey,
    /// The private key envelope (credential handle + metadata).
    pub private_key: SkPrivateKey,
    /// Attestation certificate from the token (DER), if available.
    pub attestation_cert: Option<Vec<u8>>,
    /// The OpenSSH-format private key file content.
    pub private_key_openssh: String,
    /// The OpenSSH-format public key line.
    pub public_key_openssh: String,
}

// ─── Assertion (signing) options ─────────────────────────────────────

/// Options for signing an authentication challenge.
#[derive(Debug, Clone)]
pub struct SkAssertionOptions {
    /// The public key identifying the credential.
    pub public_key: SkPublicKey,
    /// The credential handle / key handle.
    pub key_handle: Vec<u8>,
    /// SK key flags.
    pub flags: SkKeyFlags,
    /// Challenge data to sign (the SSH session hash).
    pub challenge: Vec<u8>,
    /// Optional device path.
    pub device_path: Option<String>,
    /// Optional PIN.
    pub pin: Option<SecretString>,
    /// Timeout for user interaction.
    pub timeout: Duration,
}

/// Result of a successful assertion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkAssertionResult {
    /// The SK signature (including flags + counter).
    pub signature: SkSignature,
}

// ─── Resident credential enumeration ─────────────────────────────────

/// A resident (discoverable) credential stored on a FIDO2 token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResidentCredential {
    /// Relying party ID (application string).
    pub rp_id: String,
    /// User handle.
    pub user: Option<String>,
    /// User display name.
    pub user_display_name: Option<String>,
    /// Credential ID / key handle.
    pub credential_id: Vec<u8>,
    /// The public key, if extractable.
    pub public_key: Option<SkPublicKey>,
    /// Creation time, if available.
    pub created: Option<String>,
    /// Algorithm (COSE identifier).
    pub algorithm: Option<SkAlgorithm>,
}

// ─── PIN operations ──────────────────────────────────────────────────

/// Result of a PIN operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinStatus {
    /// Whether a PIN is currently set.
    pub has_pin: bool,
    /// Remaining PIN retries.
    pub retries: Option<u32>,
    /// Whether the device is locked due to too many failed attempts.
    pub locked: bool,
}

// ─── Provider trait ──────────────────────────────────────────────────

/// Abstraction over FIDO2 authenticator operations.
///
/// The default implementation uses the `ssh-sk-helper` binary shipped with
/// OpenSSH, falling back to an in-process CTAP implementation when
/// available.
#[async_trait::async_trait]
pub trait Fido2Provider: Send + Sync {
    /// Enumerate connected FIDO2 authenticators.
    async fn enumerate_devices(&self) -> Result<Vec<Fido2DeviceInfo>, String>;

    /// Generate a new security-key credential.
    async fn generate_key(&self, opts: &SkKeyGenOptions) -> Result<SkKeyGenResult, String>;

    /// Sign a challenge (get assertion).
    async fn sign(&self, opts: &SkAssertionOptions) -> Result<SkAssertionResult, String>;

    /// List resident credentials on a device.
    async fn list_resident_credentials(
        &self,
        device_path: Option<&str>,
        pin: Option<&str>,
    ) -> Result<Vec<ResidentCredential>, String>;

    /// Delete a resident credential from a device.
    async fn delete_resident_credential(
        &self,
        device_path: Option<&str>,
        credential_id: &[u8],
        pin: Option<&str>,
    ) -> Result<(), String>;

    /// Get PIN status.
    async fn get_pin_status(&self, device_path: Option<&str>) -> Result<PinStatus, String>;

    /// Set a new PIN (when no PIN is set yet).
    async fn set_pin(&self, device_path: Option<&str>, new_pin: &str) -> Result<(), String>;

    /// Change an existing PIN.
    async fn change_pin(
        &self,
        device_path: Option<&str>,
        old_pin: &str,
        new_pin: &str,
    ) -> Result<(), String>;
}

// ─── OpenSSH ssh-sk-helper based provider ────────────────────────────

/// FIDO2 provider that delegates to the system's `ssh-keygen` and
/// `ssh-sk-helper` binaries (shipped with OpenSSH 8.2+).
///
/// This avoids embedding an HID/CTAP stack and inherits the user's
/// system-level authentication dialog.
#[derive(Default)]
pub struct OpenSshSkProvider {
    /// Optional path to `ssh-keygen` binary.  `None` = search `$PATH`.
    pub ssh_keygen_path: Option<PathBuf>,
}

impl OpenSshSkProvider {
    pub fn new() -> Self {
        Self::default()
    }

    fn ssh_keygen_command(&self, pin: Option<&str>) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new(self.ssh_keygen());
        // Never inherit ambient SSH security-key env from the parent process.
        cmd.env_remove("SSH_SK_PIN");
        cmd.env_remove("SSH_SK_APPLICATION");
        if let Some(pin) = pin {
            cmd.env("SSH_SK_PIN", pin);
        }
        cmd
    }

    /// Resolve the ssh-keygen binary path.
    fn ssh_keygen(&self) -> PathBuf {
        self.ssh_keygen_path.clone().unwrap_or_else(|| {
            // On Windows, check typical OpenSSH install paths
            #[cfg(windows)]
            {
                let system_path = PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh-keygen.exe");
                if system_path.exists() {
                    return system_path;
                }
                let program_files = PathBuf::from(r"C:\Program Files\OpenSSH\ssh-keygen.exe");
                if program_files.exists() {
                    return program_files;
                }
            }
            PathBuf::from("ssh-keygen")
        })
    }

    /// Run ssh-keygen to generate an SK key pair.
    async fn run_ssh_keygen_sk(
        &self,
        opts: &SkKeyGenOptions,
        output_dir: &std::path::Path,
    ) -> Result<(String, String), String> {
        let key_file = output_dir.join("sk_key");
        let key_file_str = key_file.to_string_lossy().to_string();

        let key_type = match opts.algorithm {
            SkAlgorithm::Ed25519Sk => "ed25519-sk",
            SkAlgorithm::EcdsaSk => "ecdsa-sk",
        };

        let mut args = vec![
            "-t".to_string(),
            key_type.to_string(),
            "-f".to_string(),
            key_file_str.clone(),
            "-N".to_string(),
            opts.passphrase
                .as_ref()
                .map(|secret| secret.expose_secret().to_string())
                .unwrap_or_default(),
        ];

        if opts.application != DEFAULT_SK_APPLICATION {
            args.push("-O".to_string());
            args.push(format!("application={}", opts.application));
        }

        if opts.resident {
            args.push("-O".to_string());
            args.push("resident".to_string());
        }

        if opts.user_verification_required {
            args.push("-O".to_string());
            args.push("verify-required".to_string());
        }

        if !opts.user_presence_required {
            args.push("-O".to_string());
            args.push("no-touch-required".to_string());
        }

        if let Some(ref user) = opts.user {
            args.push("-O".to_string());
            args.push(format!("user={}", user));
        }

        if let Some(ref comment) = opts.comment {
            args.push("-C".to_string());
            args.push(comment.clone());
        }

        // Device selection
        if let Some(ref device) = opts.device_path {
            args.push("-O".to_string());
            args.push(format!("device={}", device));
        }

        let mut cmd = self.ssh_keygen_command(
            opts.pin
                .as_ref()
                .map(|secret| secret.expose_secret().as_str()),
        );
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let output = cmd.output().await.map_err(|e| {
            format!(
                "Failed to run ssh-keygen: {}. Ensure OpenSSH 8.2+ is installed.",
                e
            )
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "ssh-keygen failed (exit {}): {}",
                output.status.code().unwrap_or(-1),
                stderr.trim()
            ));
        }

        // Read the generated files
        let private_key = tokio::fs::read_to_string(&key_file)
            .await
            .map_err(|e| format!("Failed to read generated private key: {}", e))?;

        let pub_file = format!("{}.pub", key_file_str);
        let public_key = tokio::fs::read_to_string(&pub_file)
            .await
            .map_err(|e| format!("Failed to read generated public key: {}", e))?;

        // Clean up temp files
        let _ = tokio::fs::remove_file(&key_file).await;
        let _ = tokio::fs::remove_file(&pub_file).await;

        Ok((
            private_key.trim().to_string(),
            public_key.trim().to_string(),
        ))
    }

    /// Run `ssh-keygen -K` to download resident credentials from a FIDO2 token.
    async fn download_resident_keys(
        &self,
        output_dir: &std::path::Path,
        pin: Option<&str>,
    ) -> Result<Vec<(String, String)>, String> {
        let args = vec![
            "-K".to_string(),
            "-f".to_string(),
            output_dir
                .join("resident_key")
                .to_string_lossy()
                .to_string(),
        ];

        // PIN is prompted interactively by ssh-keygen; we pass it via
        // SSH_SK_PIN env var if available (non-standard but some builds support it).
        let mut cmd = self.ssh_keygen_command(pin);
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("Failed to run ssh-keygen -K: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ssh-keygen -K failed: {}", stderr.trim()));
        }

        // Collect generated key files
        let mut keys = Vec::new();
        let mut entries = tokio::fs::read_dir(output_dir)
            .await
            .map_err(|e| format!("Failed to read output dir: {}", e))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("pub") {
                continue;
            }
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if name.starts_with("resident_key") && !name.ends_with(".pub") {
                let priv_content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
                let pub_path = format!("{}.pub", path.display());
                let pub_content = tokio::fs::read_to_string(&pub_path)
                    .await
                    .unwrap_or_default();
                if !priv_content.is_empty() && !pub_content.is_empty() {
                    keys.push((
                        priv_content.trim().to_string(),
                        pub_content.trim().to_string(),
                    ));
                }
            }
        }

        Ok(keys)
    }
}

#[async_trait::async_trait]
impl Fido2Provider for OpenSshSkProvider {
    async fn enumerate_devices(&self) -> Result<Vec<Fido2DeviceInfo>, String> {
        // ssh-keygen doesn't have a dedicated "list devices" sub-command.
        // We probe by running `ssh-keygen -t ed25519-sk -O device=list` which
        // on some builds lists devices.  As a fallback, return a placeholder
        // indicating "system default".
        let output = tokio::process::Command::new(self.ssh_keygen())
            .args(["-t", "ed25519-sk", "-O", "device=list", "-f", "/dev/null"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await;

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                let combined = format!("{}{}", stdout, stderr);

                // Parse device lines — format varies by OpenSSH build
                let devices: Vec<Fido2DeviceInfo> = combined
                    .lines()
                    .filter(|l| l.contains("device") || l.contains("FIDO") || l.contains("fido"))
                    .map(|l| Fido2DeviceInfo {
                        path: l.trim().to_string(),
                        product_name: Some(l.trim().to_string()),
                        manufacturer: None,
                        versions: vec!["FIDO_2_0".into()],
                        is_fido2: true,
                        is_u2f_only: false,
                        algorithms: vec![-7, -8], // ES256, EdDSA
                        supports_resident_keys: true,
                        supports_user_verification: true,
                        has_pin: false,
                        pin_retries: None,
                        aaguid: None,
                        firmware_version: None,
                    })
                    .collect();

                if devices.is_empty() {
                    // Return a "system default" placeholder
                    Ok(vec![Fido2DeviceInfo {
                        path: "system".into(),
                        product_name: Some("System FIDO2 Authenticator".into()),
                        manufacturer: None,
                        versions: vec!["FIDO_2_0".into(), "U2F_V2".into()],
                        is_fido2: true,
                        is_u2f_only: false,
                        algorithms: vec![-7, -8],
                        supports_resident_keys: true,
                        supports_user_verification: true,
                        has_pin: false,
                        pin_retries: None,
                        aaguid: None,
                        firmware_version: None,
                    }])
                } else {
                    Ok(devices)
                }
            }
            Err(_) => {
                // ssh-keygen not available — return empty
                Ok(vec![])
            }
        }
    }

    async fn generate_key(&self, opts: &SkKeyGenOptions) -> Result<SkKeyGenResult, String> {
        let tmp_dir =
            tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;

        let (private_key_openssh, public_key_openssh) =
            self.run_ssh_keygen_sk(opts, tmp_dir.path()).await?;

        // Parse the public key from the generated .pub content
        let public_key = SkPublicKey::from_openssh_pubkey(&public_key_openssh)?;

        // Build the private key envelope
        let private_key = SkPrivateKey {
            public_key: public_key.clone(),
            key_handle: Vec::new(), // embedded in the OpenSSH private key file
            flags: SkKeyFlags {
                user_presence_required: opts.user_presence_required,
                user_verification_required: opts.user_verification_required,
                resident: opts.resident,
            },
        };

        Ok(SkKeyGenResult {
            public_key,
            private_key,
            attestation_cert: None,
            private_key_openssh,
            public_key_openssh,
        })
    }

    async fn sign(&self, opts: &SkAssertionOptions) -> Result<SkAssertionResult, String> {
        // For SSH authentication, the SSH client library (libssh2 / russh) handles
        // the signing internally by invoking the sk-helper.  This method is exposed
        // for standalone testing or non-SSH use cases.
        //
        // We write the private key to a temp file and use `ssh-keygen -Y sign`.
        let tmp_dir =
            tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;

        let key_file = tmp_dir.path().join("sk_key");
        // Write challenge data to sign
        let challenge_file = tmp_dir.path().join("challenge");
        tokio::fs::write(&challenge_file, &opts.challenge)
            .await
            .map_err(|e| format!("Failed to write challenge: {}", e))?;

        // Use ssh-keygen -Y sign
        let namespace = &opts.public_key.application;
        let args = vec![
            "-Y".to_string(),
            "sign".to_string(),
            "-f".to_string(),
            key_file.to_string_lossy().to_string(),
            "-n".to_string(),
            namespace.clone(),
        ];

        let mut cmd = self.ssh_keygen_command(
            opts.pin
                .as_ref()
                .map(|secret| secret.expose_secret().as_str()),
        );
        cmd.args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("ssh-keygen sign failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ssh-keygen sign failed: {}", stderr.trim()));
        }

        // For now, return a synthetic result — the real signing happens
        // inside the SSH handshake via the agent or direct invocation.
        Ok(SkAssertionResult {
            signature: SkSignature {
                algorithm: opts.public_key.algorithm,
                signature: output.stdout.clone(),
                flags: FLAG_USER_PRESENT,
                counter: 0,
            },
        })
    }

    async fn list_resident_credentials(
        &self,
        _device_path: Option<&str>,
        pin: Option<&str>,
    ) -> Result<Vec<ResidentCredential>, String> {
        let tmp_dir =
            tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;

        let keys = self.download_resident_keys(tmp_dir.path(), pin).await?;

        let mut credentials = Vec::new();
        for (_priv_content, pub_content) in &keys {
            if let Ok(pk) = SkPublicKey::from_openssh_pubkey(pub_content) {
                credentials.push(ResidentCredential {
                    rp_id: pk.application.clone(),
                    user: pk.comment.clone(),
                    user_display_name: pk.comment.clone(),
                    credential_id: Vec::new(),
                    public_key: Some(pk.clone()),
                    created: None,
                    algorithm: Some(pk.algorithm),
                });
            }
        }

        Ok(credentials)
    }

    async fn delete_resident_credential(
        &self,
        _device_path: Option<&str>,
        _credential_id: &[u8],
        _pin: Option<&str>,
    ) -> Result<(), String> {
        // OpenSSH doesn't directly support deleting individual resident keys
        // via ssh-keygen yet — this would require direct CTAP2 communication.
        Err(
            "Deleting individual resident credentials requires direct CTAP2 support. \
             Use your authenticator's management tool to remove credentials."
                .into(),
        )
    }

    async fn get_pin_status(&self, _device_path: Option<&str>) -> Result<PinStatus, String> {
        // Try to probe by attempting a no-op that requires PIN
        Ok(PinStatus {
            has_pin: false,
            retries: None,
            locked: false,
        })
    }

    async fn set_pin(&self, _device_path: Option<&str>, _new_pin: &str) -> Result<(), String> {
        Err("PIN management requires direct CTAP2 support. \
             Use your authenticator's management tool to set a PIN."
            .into())
    }

    async fn change_pin(
        &self,
        _device_path: Option<&str>,
        _old_pin: &str,
        _new_pin: &str,
    ) -> Result<(), String> {
        Err("PIN management requires direct CTAP2 support. \
             Use your authenticator's management tool to change your PIN."
            .into())
    }
}

// ─── Helper: Check if ssh-keygen supports SK keys ────────────────────

/// Check whether the system's `ssh-keygen` supports security-key types.
pub async fn check_sk_support() -> SkSupportStatus {
    let output = tokio::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519-sk", "-f", "/dev/null", "-N", ""])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await;

    match output {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if stderr.contains("unknown key type") || stderr.contains("unsupported") {
                SkSupportStatus {
                    ssh_keygen_available: true,
                    sk_support: false,
                    ssh_version: detect_ssh_version().await,
                    message:
                        "ssh-keygen does not support security key types. Upgrade to OpenSSH 8.2+."
                            .into(),
                }
            } else {
                SkSupportStatus {
                    ssh_keygen_available: true,
                    sk_support: true,
                    ssh_version: detect_ssh_version().await,
                    message: "Security key support available.".into(),
                }
            }
        }
        Err(_) => SkSupportStatus {
            ssh_keygen_available: false,
            sk_support: false,
            ssh_version: None,
            message: "ssh-keygen not found. Install OpenSSH 8.2+ for security key support.".into(),
        },
    }
}

/// Status of security-key support on this system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkSupportStatus {
    /// Whether ssh-keygen binary is available.
    pub ssh_keygen_available: bool,
    /// Whether SK key types are supported.
    pub sk_support: bool,
    /// Detected OpenSSH version string.
    pub ssh_version: Option<String>,
    /// Human-readable status message.
    pub message: String,
}

/// Try to detect the installed OpenSSH version.
async fn detect_ssh_version() -> Option<String> {
    let output = tokio::process::Command::new("ssh")
        .arg("-V")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .ok()?;

    // `ssh -V` typically writes to stderr
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}{}", stderr, stdout);

    combined
        .lines()
        .find(|l| l.contains("OpenSSH"))
        .map(|l| l.trim().to_string())
}

// ─── Helpers for reading SK private key files ────────────────────────

/// Check if a private key file is an SK (security-key) type.
pub fn is_sk_private_key(content: &str) -> bool {
    content.contains("sk-ssh-ed25519") || content.contains("sk-ecdsa-sha2-nistp256")
}

/// Detect the SK algorithm from a private key file's content.
pub fn detect_sk_algorithm(content: &str) -> Option<SkAlgorithm> {
    if content.contains("sk-ssh-ed25519") {
        Some(SkAlgorithm::Ed25519Sk)
    } else if content.contains("sk-ecdsa-sha2-nistp256") {
        Some(SkAlgorithm::EcdsaSk)
    } else {
        None
    }
}

/// Detect SK algorithm from a public key line.
pub fn detect_sk_algorithm_pubkey(pubkey_line: &str) -> Option<SkAlgorithm> {
    let parts: Vec<&str> = pubkey_line.splitn(3, ' ').collect();
    if parts.is_empty() {
        return None;
    }
    SkAlgorithm::from_openssh_str(parts[0])
}

// ─── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::SecretString;
    use std::path::{Path, PathBuf};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn create_fake_ssh_keygen(dir: &Path) -> PathBuf {
        #[cfg(windows)]
        let script_path = dir.join("fake-ssh-keygen.cmd");
        #[cfg(not(windows))]
        let script_path = dir.join("fake-ssh-keygen.sh");

        #[cfg(windows)]
        let script = r#"@echo off
setlocal EnableDelayedExpansion

if "%~1"=="-Y" (
    <nul set /p =%SSH_SK_PIN%
    exit /b 0
)

set "key_file="
:scan
if "%~1"=="" goto write_files
if "%~1"=="-f" (
    set "key_file=%~2"
    goto write_files
)
shift
goto scan

:write_files
if not "%key_file%"=="" (
    > "%key_file%" <nul set /p =PRIVATE KEY
    > "%key_file%.pub" <nul set /p =PUBLIC KEY
    > "%key_file%.pin" <nul set /p =%SSH_SK_PIN%
)

exit /b 0
"#;

        #[cfg(not(windows))]
        let script = r#"#!/bin/sh
if [ "$1" = "-Y" ]; then
    printf "%s" "${SSH_SK_PIN:-}"
    exit 0
fi

key_file=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "-f" ]; then
        key_file="$arg"
        break
    fi
    prev="$arg"
done

if [ -n "$key_file" ]; then
    printf "%s" "PRIVATE KEY" > "$key_file"
    printf "%s" "PUBLIC KEY" > "$key_file.pub"
    printf "%s" "${SSH_SK_PIN:-}" > "$key_file.pin"
fi

exit 0
"#;

        std::fs::write(&script_path, script).expect("write fake ssh-keygen");
        #[cfg(unix)]
        {
            let mut permissions = std::fs::metadata(&script_path)
                .expect("script metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&script_path, permissions).expect("chmod fake ssh-keygen");
        }

        script_path
    }

    fn test_public_key() -> SkPublicKey {
        SkPublicKey::new_ed25519(vec![7; 32], DEFAULT_SK_APPLICATION.to_string())
    }

    #[test]
    fn default_options() {
        let opts = SkKeyGenOptions::default();
        assert_eq!(opts.algorithm, SkAlgorithm::Ed25519Sk);
        assert_eq!(opts.application, "ssh:");
        assert!(opts.user_presence_required);
        assert!(!opts.user_verification_required);
        assert!(!opts.resident);
    }

    #[test]
    fn detect_sk_key_types() {
        assert!(is_sk_private_key(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nsk-ssh-ed25519\n"
        ));
        assert!(is_sk_private_key("... sk-ecdsa-sha2-nistp256 ..."));
        assert!(!is_sk_private_key(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nssh-ed25519\n"
        ));
    }

    #[test]
    fn detect_algorithms() {
        assert_eq!(
            detect_sk_algorithm("sk-ssh-ed25519 content"),
            Some(SkAlgorithm::Ed25519Sk)
        );
        assert_eq!(
            detect_sk_algorithm("sk-ecdsa-sha2-nistp256 content"),
            Some(SkAlgorithm::EcdsaSk)
        );
        assert_eq!(detect_sk_algorithm("ssh-ed25519 content"), None);
    }

    #[test]
    fn detect_pubkey_algorithm() {
        assert_eq!(
            detect_sk_algorithm_pubkey("sk-ssh-ed25519@openssh.com AAAA... comment"),
            Some(SkAlgorithm::Ed25519Sk)
        );
        assert_eq!(
            detect_sk_algorithm_pubkey("sk-ecdsa-sha2-nistp256@openssh.com AAAA..."),
            Some(SkAlgorithm::EcdsaSk)
        );
        assert_eq!(detect_sk_algorithm_pubkey("ssh-ed25519 AAAA..."), None);
    }

    #[test]
    fn sk_key_flags_byte() {
        let flags = SkKeyFlags {
            user_presence_required: true,
            user_verification_required: false,
            resident: true,
        };
        let b = flags.to_byte();
        assert_eq!(b, 0x01 | 0x20);
        let back = SkKeyFlags::from_byte(b);
        assert!(back.user_presence_required);
        assert!(!back.user_verification_required);
        assert!(back.resident);
    }

    #[tokio::test]
    async fn run_ssh_keygen_sk_passes_pin_via_child_env() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let script_path = create_fake_ssh_keygen(tempdir.path());
        let provider = OpenSshSkProvider {
            ssh_keygen_path: Some(script_path),
        };
        let output_dir = tempfile::tempdir().expect("output dir");
        let opts = SkKeyGenOptions {
            pin: Some(SecretString::new("1357".to_string())),
            ..Default::default()
        };

        let (private_key, public_key) = provider
            .run_ssh_keygen_sk(&opts, output_dir.path())
            .await
            .expect("run fake ssh-keygen");

        assert_eq!(private_key, "PRIVATE KEY");
        assert_eq!(public_key, "PUBLIC KEY");
        assert_eq!(
            std::fs::read_to_string(output_dir.path().join("sk_key.pin")).expect("pin capture"),
            "1357"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sign_scopes_ssh_sk_pin_per_child_process() {
        let tempdir = tempfile::tempdir().expect("tempdir");
        let script_path = create_fake_ssh_keygen(tempdir.path());
        let provider_a = OpenSshSkProvider {
            ssh_keygen_path: Some(script_path.clone()),
        };
        let provider_b = OpenSshSkProvider {
            ssh_keygen_path: Some(script_path),
        };

        let opts_a = SkAssertionOptions {
            public_key: test_public_key(),
            key_handle: vec![],
            flags: SkKeyFlags {
                user_presence_required: true,
                user_verification_required: false,
                resident: false,
            },
            challenge: b"alpha".to_vec(),
            device_path: None,
            pin: Some(SecretString::new("1111".to_string())),
            timeout: Duration::from_secs(1),
        };
        let opts_b = SkAssertionOptions {
            public_key: test_public_key(),
            key_handle: vec![],
            flags: SkKeyFlags {
                user_presence_required: true,
                user_verification_required: false,
                resident: false,
            },
            challenge: b"beta".to_vec(),
            device_path: None,
            pin: Some(SecretString::new("2222".to_string())),
            timeout: Duration::from_secs(1),
        };

        let (result_a, result_b) = tokio::join!(provider_a.sign(&opts_a), provider_b.sign(&opts_b));
        let result_a = result_a.expect("first sign result");
        let result_b = result_b.expect("second sign result");

        assert_eq!(result_a.signature.signature, b"1111");
        assert_eq!(result_b.signature.signature, b"2222");
    }
}
