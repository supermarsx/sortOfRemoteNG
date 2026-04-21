//! macOS biometric helper utilities.
//!
//! Machine ID retrieval, biometry type detection, and platform label generation.

use crate::types::*;

/// Get the macOS hardware UUID (IOPlatformUUID).
///
/// This is the same identifier used by macOS for machine-level operations.
/// Deterministic and stable across reboots.
pub(crate) fn get_machine_uuid() -> String {
    std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()
        .and_then(|o| {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout
                .lines()
                .find(|l| l.contains("IOPlatformUUID"))
                .and_then(|l| l.split('"').nth(3))
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| {
            hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown-mac".into())
        })
}

/// Map a `BiometryType` to the user-facing platform label.
pub(crate) fn platform_label(biometry_type: BiometryType) -> &'static str {
    match biometry_type {
        BiometryType::TouchID => "Touch ID",
        BiometryType::FaceID => "Face ID",
        BiometryType::OpticID => "Optic ID",
        BiometryType::None => "macOS Biometrics",
    }
}

/// Map a `BiometryType` to the `BiometricKind` vector.
pub(crate) fn biometric_kinds(biometry_type: BiometryType) -> Vec<BiometricKind> {
    match biometry_type {
        BiometryType::TouchID => vec![BiometricKind::Fingerprint],
        BiometryType::FaceID => vec![BiometricKind::FaceRecognition],
        BiometryType::OpticID => vec![BiometricKind::Other],
        BiometryType::None => vec![],
    }
}

/// Get the icon hint string for the frontend to select the appropriate icon.
pub(crate) fn icon_hint(biometry_type: BiometryType) -> &'static str {
    match biometry_type {
        BiometryType::TouchID => "fingerprint",
        BiometryType::FaceID => "face",
        BiometryType::OpticID => "eye",
        BiometryType::None => "shield",
    }
}

/// Build an unavailability reason string from biometry info.
pub(crate) fn unavailable_reason(info: &BiometryInfo) -> Option<String> {
    if !info.available {
        Some("No biometric hardware detected".into())
    } else if !info.enrolled {
        let label = platform_label(info.biometry_type);
        Some(format!("No biometrics enrolled — open System Settings → {label}"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_labels_are_correct() {
        assert_eq!(platform_label(BiometryType::TouchID), "Touch ID");
        assert_eq!(platform_label(BiometryType::FaceID), "Face ID");
        assert_eq!(platform_label(BiometryType::OpticID), "Optic ID");
        assert_eq!(platform_label(BiometryType::None), "macOS Biometrics");
    }

    #[test]
    fn biometric_kinds_mapping() {
        assert_eq!(biometric_kinds(BiometryType::TouchID), vec![BiometricKind::Fingerprint]);
        assert_eq!(biometric_kinds(BiometryType::FaceID), vec![BiometricKind::FaceRecognition]);
        assert!(biometric_kinds(BiometryType::None).is_empty());
    }

    #[test]
    fn icon_hints() {
        assert_eq!(icon_hint(BiometryType::TouchID), "fingerprint");
        assert_eq!(icon_hint(BiometryType::FaceID), "face");
        assert_eq!(icon_hint(BiometryType::None), "shield");
    }

    #[test]
    fn unavailable_reason_text() {
        let info = BiometryInfo {
            available: false,
            biometry_type: BiometryType::None,
            enrolled: false,
        };
        assert_eq!(unavailable_reason(&info), Some("No biometric hardware detected".into()));

        let info = BiometryInfo {
            available: true,
            biometry_type: BiometryType::TouchID,
            enrolled: false,
        };
        assert_eq!(
            unavailable_reason(&info),
            Some("No biometrics enrolled — open System Settings → Touch ID".into())
        );

        let info = BiometryInfo {
            available: true,
            biometry_type: BiometryType::TouchID,
            enrolled: true,
        };
        assert_eq!(unavailable_reason(&info), None);
    }
}
