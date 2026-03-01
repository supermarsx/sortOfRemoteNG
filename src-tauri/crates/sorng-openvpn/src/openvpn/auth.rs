//! Certificate helpers, credential management, PKCS#12 handling, inline cert
//! extraction, and OTP / 2FA support.

use crate::openvpn::types::*;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Credential store
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// In-memory credential holder that can be serialised (passwords are masked).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VpnCredentials {
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    /// Optional one-time password for 2FA.
    #[serde(skip_serializing)]
    pub otp: Option<String>,
    /// Optional private-key passphrase.
    #[serde(skip_serializing)]
    pub key_passphrase: Option<String>,
    /// Optional PKCS#12 passphrase.
    #[serde(skip_serializing)]
    pub pkcs12_passphrase: Option<String>,
}

impl VpnCredentials {
    pub fn basic(username: impl Into<String>, password: impl Into<String>) -> Self {
        Self {
            username: username.into(),
            password: password.into(),
            otp: None,
            key_passphrase: None,
            pkcs12_passphrase: None,
        }
    }

    pub fn with_otp(mut self, otp: impl Into<String>) -> Self {
        self.otp = Some(otp.into());
        self
    }

    pub fn with_key_passphrase(mut self, p: impl Into<String>) -> Self {
        self.key_passphrase = Some(p.into());
        self
    }

    pub fn with_pkcs12_passphrase(mut self, p: impl Into<String>) -> Self {
        self.pkcs12_passphrase = Some(p.into());
        self
    }

    /// Build the `auth-user-pass` payload for the management interface.
    pub fn to_mgmt_auth(&self) -> String {
        let pass = match &self.otp {
            Some(code) => format!("{}:{}", self.password, code),
            None => self.password.clone(),
        };
        format!("username \"Auth\" {}\npassword \"Auth\" {}", self.username, pass)
    }

    /// Write a temp auth file with user\npass.
    pub fn write_auth_file(&self, dir: &Path) -> Result<PathBuf, OpenVpnError> {
        let path = dir.join(format!("ovpn_auth_{}.txt", uuid::Uuid::new_v4()));
        let content = format!("{}\n{}", self.username, self.password);
        std::fs::write(&path, &content).map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::IoError,
            message: format!("Cannot write auth file {}: {}", path.display(), e),
            detail: None,
        })?;

        // restrict permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }

        Ok(path)
    }

    /// Securely erase from memory (best-effort).
    pub fn wipe(&mut self) {
        self.password = String::new();
        self.otp = None;
        self.key_passphrase = None;
        self.pkcs12_passphrase = None;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Certificate helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Metadata extracted from a PEM certificate.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CertInfo {
    pub subject: String,
    pub issuer: String,
    pub serial: String,
    pub fingerprint_sha256: String,
    pub not_before: String,
    pub not_after: String,
    pub is_ca: bool,
    pub key_usage: Vec<String>,
}

/// Extract PEM blocks from a file.
pub fn extract_pem_blocks(content: &str) -> Vec<PemBlock> {
    let mut blocks = Vec::new();
    let mut current_type: Option<String> = None;
    let mut current_lines = Vec::new();

    for line in content.lines() {
        if let Some(typ) = line.strip_prefix("-----BEGIN ") {
            if let Some(typ) = typ.strip_suffix("-----") {
                current_type = Some(typ.to_string());
                current_lines.clear();
                current_lines.push(line.to_string());
            }
        } else if let Some(typ) = line.strip_prefix("-----END ") {
            if let Some(_t) = typ.strip_suffix("-----") {
                current_lines.push(line.to_string());
                if let Some(ct) = current_type.take() {
                    blocks.push(PemBlock {
                        block_type: ct,
                        data: current_lines.join("\n"),
                    });
                }
                current_lines.clear();
            }
        } else if current_type.is_some() {
            current_lines.push(line.to_string());
        }
    }

    blocks
}

/// A single PEM block.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PemBlock {
    pub block_type: String,
    pub data: String,
}

impl PemBlock {
    /// Decode the Base64 body (excluding header/footer).
    pub fn decode_body(&self) -> Result<Vec<u8>, OpenVpnError> {
        let body: String = self
            .data
            .lines()
            .filter(|l| !l.starts_with("-----"))
            .collect::<Vec<_>>()
            .join("");
        B64.decode(&body).map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::TlsError,
            message: format!("Base64 decode error: {}", e),
            detail: None,
        })
    }

    /// SHA-256 fingerprint of the DER-encoded body.
    pub fn fingerprint_sha256(&self) -> Result<String, OpenVpnError> {
        let der = self.decode_body()?;
        let hash = Sha256::digest(&der);
        Ok(hex::encode(hash))
    }
}

/// Extract inline certs from an OpenVPN config string.
pub fn extract_inline_certs(ovpn: &str) -> Vec<PemBlock> {
    // Inline blocks in .ovpn are wrapped in <ca>…</ca>, <cert>…</cert>, etc.
    let mut all_pem = Vec::new();

    for tag in &["ca", "cert", "key", "tls-auth", "tls-crypt", "extra-certs", "pkcs12"] {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        if let Some(start) = ovpn.find(&open) {
            if let Some(end) = ovpn.find(&close) {
                let inner = &ovpn[start + open.len()..end];
                let mut blocks = extract_pem_blocks(inner.trim());
                if blocks.is_empty() && !inner.trim().is_empty() {
                    // Treat as raw data block (e.g. tls-crypt key)
                    blocks.push(PemBlock {
                        block_type: tag.to_uppercase(),
                        data: inner.trim().to_string(),
                    });
                }
                all_pem.extend(blocks);
            }
        }
    }

    all_pem
}

/// Validate that a CA cert file exists and is PEM-formatted.
pub fn validate_ca_cert(path: &Path) -> Result<Vec<PemBlock>, OpenVpnError> {
    let content = std::fs::read_to_string(path).map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::TlsError,
        message: format!("Cannot read CA cert {}: {}", path.display(), e),
        detail: None,
    })?;
    let blocks = extract_pem_blocks(&content);
    if blocks.is_empty() {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::TlsError,
            message: format!("No PEM blocks found in {}", path.display()),
            detail: None,
        });
    }
    let has_cert = blocks.iter().any(|b| b.block_type.contains("CERTIFICATE"));
    if !has_cert {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::TlsError,
            message: "File does not contain a CERTIFICATE block".into(),
            detail: None,
        });
    }
    Ok(blocks)
}

/// Validate a client certificate + key pair.
pub fn validate_cert_pair(cert_path: &Path, key_path: &Path) -> Result<(), OpenVpnError> {
    let cert = std::fs::read_to_string(cert_path).map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::TlsError,
        message: format!("Cannot read cert {}: {}", cert_path.display(), e),
        detail: None,
    })?;
    let key = std::fs::read_to_string(key_path).map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::TlsError,
        message: format!("Cannot read key {}: {}", key_path.display(), e),
        detail: None,
    })?;

    let cert_blocks = extract_pem_blocks(&cert);
    let key_blocks = extract_pem_blocks(&key);

    if !cert_blocks.iter().any(|b| b.block_type.contains("CERTIFICATE")) {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::TlsError,
            message: "Cert file has no CERTIFICATE block".into(),
            detail: None,
        });
    }
    if !key_blocks.iter().any(|b| b.block_type.contains("KEY")) {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::TlsError,
            message: "Key file has no KEY block".into(),
            detail: None,
        });
    }

    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Auth method detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Auth methods that a config may require.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequiredAuth {
    None,
    UserPass,
    Certificate,
    UserPassCert,
    Pkcs12,
    Pkcs12UserPass,
    ExternalKey,
}

/// Detect the authentication methods required by a config.
pub fn detect_required_auth(cfg: &OpenVpnConfig) -> RequiredAuth {
    let has_user_pass = cfg.username.is_some()
        || cfg.password.is_some()
        || cfg.auth_user_pass;
    let has_cert = cfg.client_cert.is_some() || cfg.inline_cert.is_some();
    let has_key = cfg.client_key.is_some() || cfg.inline_key.is_some();
    let has_pkcs12 = cfg.pkcs12.is_some();

    if has_pkcs12 && has_user_pass {
        RequiredAuth::Pkcs12UserPass
    } else if has_pkcs12 {
        RequiredAuth::Pkcs12
    } else if has_user_pass && has_cert && has_key {
        RequiredAuth::UserPassCert
    } else if has_cert && has_key {
        RequiredAuth::Certificate
    } else if has_user_pass {
        RequiredAuth::UserPass
    } else {
        RequiredAuth::None
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OTP / 2FA helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Methods for combining OTP with the password for auth.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OtpMethod {
    /// OTP appended to password: "password<otp>"
    Append,
    /// OTP sent as a separate response via management interface.
    ChallengeResponse,
    /// OTP in a dedicated field (e.g. password2 for some providers).
    DedicatedField,
}

/// Build the auth payload for management interface with OTP.
pub fn build_otp_auth_payload(
    username: &str,
    password: &str,
    otp: &str,
    method: &OtpMethod,
) -> String {
    match method {
        OtpMethod::Append => {
            format!(
                "username \"Auth\" {}\npassword \"Auth\" {}{}",
                username, password, otp
            )
        }
        OtpMethod::ChallengeResponse | OtpMethod::DedicatedField => {
            // These are sent as separate management commands
            format!(
                "username \"Auth\" {}\npassword \"Auth\" {}",
                username, password
            )
        }
    }
}

/// Build the challenge-response payload for 2FA.
pub fn build_challenge_response(otp: &str) -> String {
    format!("password \"Auth\" {}", otp)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PKCS#12 helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Basic PKCS#12 info (requires external tool or native API for deep inspection).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Pkcs12Info {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub has_passphrase: bool,
}

/// Get basic info about a PKCS#12 file.
pub fn inspect_pkcs12(path: &Path) -> Result<Pkcs12Info, OpenVpnError> {
    let metadata = std::fs::metadata(path).map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::TlsError,
        message: format!("Cannot stat PKCS#12 file {}: {}", path.display(), e),
        detail: None,
    })?;
    let data = std::fs::read(path).map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::TlsError,
        message: format!("Cannot read PKCS#12 file {}: {}", path.display(), e),
        detail: None,
    })?;

    let hash = Sha256::digest(&data);

    Ok(Pkcs12Info {
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        sha256: hex::encode(hash),
        has_passphrase: true, // assume yes — actual test requires parsing
    })
}

/// Verify a PKCS#12 file by attempting to open it with the given passphrase.
/// Uses `openssl` CLI as a fallback.
pub async fn verify_pkcs12(
    path: &Path,
    passphrase: &str,
) -> Result<bool, OpenVpnError> {
    let output = tokio::process::Command::new("openssl")
        .args([
            "pkcs12",
            "-in",
            &path.to_string_lossy(),
            "-passin",
            &format!("pass:{}", passphrase),
            "-noout",
        ])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::TlsError,
            message: format!("Cannot run openssl: {}", e),
            detail: None,
        })?;

    Ok(output.status.success())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TLS key helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate a static TLS key using OpenVPN's own tool.
pub async fn generate_tls_key() -> Result<String, OpenVpnError> {
    let binary = find_openvpn_binary().ok_or_else(|| OpenVpnError {
        kind: OpenVpnErrorKind::ConfigFileNotFound,
        message: "openvpn binary not found".into(),
        detail: None,
    })?;

    let output = tokio::process::Command::new(&binary)
        .args(["--genkey", "secret", "/dev/stdout"])
        .output()
        .await
        .map_err(|e| OpenVpnError {
            kind: OpenVpnErrorKind::ProcessSpawnFailed,
            message: format!("Cannot generate TLS key: {}", e),
            detail: None,
        })?;

    if !output.status.success() {
        return Err(OpenVpnError {
            kind: OpenVpnErrorKind::ProcessSpawnFailed,
            message: "openvpn --genkey failed".into(),
            detail: Some(String::from_utf8_lossy(&output.stderr).to_string()),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Determine the TLS key direction from config.
pub fn tls_key_direction(cfg: &OpenVpnConfig) -> Option<&str> {
    if matches!(cfg.tls_mode, TlsMode::TlsAuth { .. }) {
        // direction is usually 1 for client
        Some("1")
    } else {
        None
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Utility: hash credentials
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Return a SHA-256 hash of the credential pair (for caching/comparison w/o storing cleartext).
pub fn hash_credentials(username: &str, password: &str) -> String {
    let mut h = Sha256::new();
    h.update(username.as_bytes());
    h.update(b":");
    h.update(password.as_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── VpnCredentials ───────────────────────────────────────────

    #[test]
    fn credentials_basic() {
        let c = VpnCredentials::basic("user", "pass");
        assert_eq!(c.username, "user");
        assert_eq!(c.password, "pass");
        assert!(c.otp.is_none());
    }

    #[test]
    fn credentials_builder() {
        let c = VpnCredentials::basic("u", "p")
            .with_otp("123456")
            .with_key_passphrase("kp")
            .with_pkcs12_passphrase("pp");
        assert_eq!(c.otp.as_deref(), Some("123456"));
        assert_eq!(c.key_passphrase.as_deref(), Some("kp"));
        assert_eq!(c.pkcs12_passphrase.as_deref(), Some("pp"));
    }

    #[test]
    fn credentials_mgmt_auth_no_otp() {
        let c = VpnCredentials::basic("alice", "secret");
        let payload = c.to_mgmt_auth();
        assert!(payload.contains("username \"Auth\" alice"));
        assert!(payload.contains("password \"Auth\" secret"));
    }

    #[test]
    fn credentials_mgmt_auth_with_otp() {
        let c = VpnCredentials::basic("alice", "secret").with_otp("654321");
        let payload = c.to_mgmt_auth();
        assert!(payload.contains("password \"Auth\" secret:654321"));
    }

    #[test]
    fn credentials_wipe() {
        let mut c = VpnCredentials::basic("u", "secret").with_otp("123");
        c.wipe();
        assert!(c.password.is_empty());
        assert!(c.otp.is_none());
        assert!(c.key_passphrase.is_none());
    }

    #[test]
    fn credentials_serde_skips_password() {
        let c = VpnCredentials::basic("alice", "secret");
        let json = serde_json::to_string(&c).unwrap();
        assert!(!json.contains("secret"));
        assert!(json.contains("alice"));
    }

    // ── PEM extraction ───────────────────────────────────────────

    #[test]
    fn extract_pem_single() {
        let pem = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
        let blocks = extract_pem_blocks(pem);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].block_type, "CERTIFICATE");
    }

    #[test]
    fn extract_pem_multiple() {
        let pem = "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n\
                    -----BEGIN RSA PRIVATE KEY-----\nBBB\n-----END RSA PRIVATE KEY-----";
        let blocks = extract_pem_blocks(pem);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].block_type, "CERTIFICATE");
        assert_eq!(blocks[1].block_type, "RSA PRIVATE KEY");
    }

    #[test]
    fn extract_pem_empty() {
        let blocks = extract_pem_blocks("no certs here");
        assert!(blocks.is_empty());
    }

    // ── Inline cert extraction ───────────────────────────────────

    #[test]
    fn inline_cert_extraction() {
        let ovpn = "<ca>\n-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n</ca>";
        let blocks = extract_inline_certs(ovpn);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].block_type, "CERTIFICATE");
    }

    #[test]
    fn inline_tls_crypt_extraction() {
        let ovpn = "<tls-crypt>\nsome-key-data\n</tls-crypt>";
        let blocks = extract_inline_certs(ovpn);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].block_type, "TLS-CRYPT");
    }

    // ── Auth detection ───────────────────────────────────────────

    #[test]
    fn detect_auth_none() {
        let cfg = OpenVpnConfig::default();
        assert_eq!(detect_required_auth(&cfg), RequiredAuth::None);
    }

    #[test]
    fn detect_auth_user_pass() {
        let mut cfg = OpenVpnConfig::default();
        cfg.username = Some("u".into());
        assert_eq!(detect_required_auth(&cfg), RequiredAuth::UserPass);
    }

    #[test]
    fn detect_auth_cert() {
        let mut cfg = OpenVpnConfig::default();
        cfg.client_cert = Some("/c.pem".into());
        cfg.client_key = Some("/k.pem".into());
        assert_eq!(detect_required_auth(&cfg), RequiredAuth::Certificate);
    }

    #[test]
    fn detect_auth_user_pass_cert() {
        let mut cfg = OpenVpnConfig::default();
        cfg.username = Some("u".into());
        cfg.client_cert = Some("/c.pem".into());
        cfg.client_key = Some("/k.pem".into());
        assert_eq!(detect_required_auth(&cfg), RequiredAuth::UserPassCert);
    }

    #[test]
    fn detect_auth_pkcs12() {
        let mut cfg = OpenVpnConfig::default();
        cfg.pkcs12 = Some("/p.p12".into());
        assert_eq!(detect_required_auth(&cfg), RequiredAuth::Pkcs12);
    }

    #[test]
    fn detect_auth_pkcs12_user_pass() {
        let mut cfg = OpenVpnConfig::default();
        cfg.pkcs12 = Some("/p.p12".into());
        cfg.username = Some("u".into());
        assert_eq!(detect_required_auth(&cfg), RequiredAuth::Pkcs12UserPass);
    }

    // ── OTP helpers ──────────────────────────────────────────────

    #[test]
    fn otp_append_method() {
        let payload = build_otp_auth_payload("user", "pass", "123456", &OtpMethod::Append);
        assert!(payload.contains("pass123456"));
    }

    #[test]
    fn otp_challenge_response_build() {
        let cr = build_challenge_response("654321");
        assert_eq!(cr, "password \"Auth\" 654321");
    }

    // ── Hash credentials ─────────────────────────────────────────

    #[test]
    fn hash_creds_deterministic() {
        let h1 = hash_credentials("alice", "pass");
        let h2 = hash_credentials("alice", "pass");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn hash_creds_different() {
        let h1 = hash_credentials("alice", "pass1");
        let h2 = hash_credentials("alice", "pass2");
        assert_ne!(h1, h2);
    }

    // ── PemBlock fingerprint ─────────────────────────────────────

    #[test]
    fn pem_block_fingerprint() {
        let block = PemBlock {
            block_type: "CERTIFICATE".into(),
            data: "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----".into(),
        };
        let fp = block.fingerprint_sha256().unwrap();
        assert_eq!(fp.len(), 64);
    }

    #[test]
    fn pem_block_decode_body() {
        let block = PemBlock {
            block_type: "CERTIFICATE".into(),
            data: "-----BEGIN CERTIFICATE-----\naGVsbG8=\n-----END CERTIFICATE-----".into(),
        };
        let body = block.decode_body().unwrap();
        assert_eq!(body, b"hello");
    }

    // ── RequiredAuth serde ───────────────────────────────────────

    #[test]
    fn required_auth_serde() {
        let variants = vec![
            RequiredAuth::None,
            RequiredAuth::UserPass,
            RequiredAuth::Certificate,
            RequiredAuth::UserPassCert,
            RequiredAuth::Pkcs12,
            RequiredAuth::Pkcs12UserPass,
            RequiredAuth::ExternalKey,
        ];
        for v in &variants {
            let json = serde_json::to_string(v).unwrap();
            let back: RequiredAuth = serde_json::from_str(&json).unwrap();
            assert_eq!(v, &back);
        }
    }

    // ── TLS direction ────────────────────────────────────────────

    #[test]
    fn tls_direction_auth() {
        let mut cfg = OpenVpnConfig::default();
        cfg.tls_mode = TlsMode::TlsAuth { key_path: "/ta.key".into(), direction: Some(1) };
        assert_eq!(tls_key_direction(&cfg), Some("1"));
    }

    #[test]
    fn tls_direction_none() {
        let cfg = OpenVpnConfig::default();
        assert_eq!(tls_key_direction(&cfg), None);
    }

    // ── OtpMethod serde ──────────────────────────────────────────

    #[test]
    fn otp_method_serde() {
        for m in &[OtpMethod::Append, OtpMethod::ChallengeResponse, OtpMethod::DedicatedField] {
            let json = serde_json::to_string(m).unwrap();
            let back: OtpMethod = serde_json::from_str(&json).unwrap();
            assert_eq!(m, &back);
        }
    }
}
