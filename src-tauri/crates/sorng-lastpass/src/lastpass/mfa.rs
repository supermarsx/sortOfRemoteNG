use crate::lastpass::types::{
    MfaMethod, MfaStatus, TrustedDevice, LastPassError, LastPassErrorKind,
};

/// Parse MFA requirements from a login error to determine which method is needed.
pub fn detect_mfa_method(error: &LastPassError) -> Option<MfaMethod> {
    match error.kind {
        LastPassErrorKind::GoogleAuthRequired => Some(MfaMethod::GoogleAuthenticator),
        LastPassErrorKind::YubikeyRequired => Some(MfaMethod::YubiKey),
        LastPassErrorKind::DuoRequired => Some(MfaMethod::Duo),
        LastPassErrorKind::OutOfBandRequired => Some(MfaMethod::LastPassAuthenticator),
        LastPassErrorKind::MfaRequired => {
            // Parse from message
            let msg = error.message.to_lowercase();
            if msg.contains("google") {
                Some(MfaMethod::GoogleAuthenticator)
            } else if msg.contains("yubikey") {
                Some(MfaMethod::YubiKey)
            } else if msg.contains("duo") {
                Some(MfaMethod::Duo)
            } else if msg.contains("totp") {
                Some(MfaMethod::Totp)
            } else if msg.contains("sesame") {
                Some(MfaMethod::Sesame)
            } else {
                Some(MfaMethod::Totp)
            }
        }
        _ => None,
    }
}

/// Validate a TOTP code format (6 digits).
pub fn validate_totp_code(code: &str) -> Result<(), LastPassError> {
    let cleaned = code.replace(' ', "").replace('-', "");
    if cleaned.len() != 6 || !cleaned.chars().all(|c| c.is_ascii_digit()) {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "TOTP code must be exactly 6 digits",
        ));
    }
    Ok(())
}

/// Validate a YubiKey OTP (44 characters modhex).
pub fn validate_yubikey_otp(otp: &str) -> Result<(), LastPassError> {
    if otp.len() < 32 || otp.len() > 48 {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "YubiKey OTP must be 32-48 characters",
        ));
    }
    let valid_chars = "cbdefghijklnrtuv";
    if !otp.chars().all(|c| valid_chars.contains(c)) {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "YubiKey OTP contains invalid characters",
        ));
    }
    Ok(())
}

/// Create a default MFA status.
pub fn default_mfa_status() -> MfaStatus {
    MfaStatus {
        enabled: false,
        methods: Vec::new(),
        trusted_devices: Vec::new(),
    }
}

/// Create a trusted device entry for the current device.
pub fn create_trusted_device(label: &str) -> TrustedDevice {
    TrustedDevice {
        id: uuid::Uuid::new_v4().to_string(),
        label: label.to_string(),
        last_used: Some(chrono::Utc::now().to_rfc3339()),
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}

/// Get the display name for an MFA method.
pub fn mfa_method_display_name(method: &MfaMethod) -> &'static str {
    match method {
        MfaMethod::GoogleAuthenticator => "Google Authenticator",
        MfaMethod::LastPassAuthenticator => "LastPass Authenticator",
        MfaMethod::Totp => "TOTP",
        MfaMethod::Duo => "Duo Security",
        MfaMethod::YubiKey => "YubiKey",
        MfaMethod::GridCard => "Grid Card",
        MfaMethod::Sesame => "Sesame",
        MfaMethod::SalesforceAuthenticator => "Salesforce Authenticator",
        MfaMethod::MicrosoftAuthenticator => "Microsoft Authenticator",
    }
}
