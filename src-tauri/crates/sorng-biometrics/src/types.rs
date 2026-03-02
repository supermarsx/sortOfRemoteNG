//! Shared types for the biometrics crate.

use serde::{Deserialize, Serialize};
use std::fmt;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Availability
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// What kind of biometric sensor(s) the device exposes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BiometricKind {
    Fingerprint,
    FaceRecognition,
    Iris,
    /// Generic / unknown biometric
    Other,
}

/// Availability status for biometric hardware + enrolment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricStatus {
    /// Is any biometric hardware present?
    pub hardware_available: bool,
    /// Has the user enrolled at least one biometric credential?
    pub enrolled: bool,
    /// Set of detected biometric kinds (may be empty).
    pub kinds: Vec<BiometricKind>,
    /// Platform-specific note (e.g. "Windows Hello", "Touch ID").
    pub platform_label: String,
    /// Reason string when not available.
    pub unavailable_reason: Option<String>,
}

impl Default for BiometricStatus {
    fn default() -> Self {
        Self {
            hardware_available: false,
            enrolled: false,
            kinds: Vec::new(),
            platform_label: "Unknown".into(),
            unavailable_reason: Some("Not checked yet".into()),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Authentication result
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Result of a biometric authentication attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricAuthResult {
    /// Did the user pass biometric verification?
    pub success: bool,
    /// Optional derived key material (hex-encoded, 32 bytes).
    /// Only populated when `success == true` and the caller requested key derivation.
    pub derived_key_hex: Option<String>,
    /// Human-readable message.
    pub message: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Error
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BiometricErrorKind {
    /// No hardware sensor detected.
    HardwareUnavailable,
    /// User has not enrolled any biometric credential.
    NotEnrolled,
    /// User cancelled the prompt.
    UserCancelled,
    /// Biometric did not match.
    AuthFailed,
    /// Platform API returned an error.
    PlatformError,
    /// The operation is not supported on this OS.
    Unsupported,
    /// Internal / unexpected error.
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiometricError {
    pub kind: BiometricErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl fmt::Display for BiometricError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(d) = &self.detail {
            write!(f, " — {d}")?;
        }
        Ok(())
    }
}

impl std::error::Error for BiometricError {}

impl BiometricError {
    pub fn platform(msg: impl Into<String>) -> Self {
        Self {
            kind: BiometricErrorKind::PlatformError,
            message: msg.into(),
            detail: None,
        }
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self {
            kind: BiometricErrorKind::Unsupported,
            message: msg.into(),
            detail: None,
        }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            kind: BiometricErrorKind::Internal,
            message: msg.into(),
            detail: None,
        }
    }
    pub fn user_cancelled() -> Self {
        Self {
            kind: BiometricErrorKind::UserCancelled,
            message: "User cancelled biometric prompt".into(),
            detail: None,
        }
    }
    pub fn auth_failed() -> Self {
        Self {
            kind: BiometricErrorKind::AuthFailed,
            message: "Biometric verification failed".into(),
            detail: None,
        }
    }
}

/// Convenience alias.
pub type BiometricResult<T> = Result<T, BiometricError>;
