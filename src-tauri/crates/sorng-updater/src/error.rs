//! Error types for the updater facade.

use std::fmt;

#[derive(Debug, Clone)]
pub enum UpdateError {
    InvalidEndpoint(String),
    /// A caller-provided global HTTP proxy did not pass the native boundary.
    /// Reasons must never include the raw URL because it may carry secrets.
    InvalidProxy(&'static str),
    Settings(String),
    SelfUpdateUnsupported(String),
    /// The feed carried no entry for the per-installer updater target this
    /// install mode pins (see [`crate::types::UpdaterInstallMode::updater_target_suffix`]).
    ///
    /// Pinning the target disables the plugin's silent `{os}-{arch}` fallback, so a feed
    /// without the per-installer key surfaces here instead of installing a different
    /// installer's payload side by side.
    UpdaterTargetMissing {
        target: String,
    },
    Plugin(String),
    Io(String),
    Serialization(String),
    NoUpdateAvailable,
    /// The discovery feed carried no minisign signature. The normal verified
    /// updater path must reject it before download; callers may separately choose
    /// the explicitly acknowledged unsigned command.
    UnsignedUpdateNotInstallable,
    /// The explicitly unsafe path is a separate command and must be acknowledged on
    /// every invocation before it performs even the feed request.
    UnsignedRiskNotAcknowledged,
    /// The unsigned acknowledgement must be bound to the version the caller
    /// displayed rather than silently accepting whichever version is now latest.
    UnsignedVersionRequired,
    /// Only one updater check/download/install operation may run at a time.
    OperationInProgress,
    /// A signed release must continue through the plugin's verified install path.
    SignedUpdateRequiresVerifiedInstall,
    InvalidUnsignedReleaseUrl(String),
    IncompatibleUnsignedArtifact(String),
    UnsignedDownload(String),
    UnsignedPayloadTooLarge {
        limit_bytes: u64,
    },
    UnsignedLaunch(String),
    VersionMismatch {
        requested: String,
        available: String,
    },
    State(String),
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEndpoint(msg) => write!(f, "invalid updater endpoint: {msg}"),
            Self::InvalidProxy(reason) => write!(f, "invalid updater proxy URL: {reason}"),
            Self::Settings(msg) => write!(f, "updater settings error: {msg}"),
            Self::SelfUpdateUnsupported(msg) => write!(f, "{msg}"),
            Self::UpdaterTargetMissing { target } => write!(
                f,
                "This MSI installation found no matching .msi package in the update feed (target {target}). Install a newer .msi package from GitHub Releases."
            ),
            Self::Plugin(msg) => write!(f, "tauri updater plugin error: {msg}"),
            Self::Io(msg) => write!(f, "I/O error: {msg}"),
            Self::Serialization(msg) => write!(f, "serialization error: {msg}"),
            Self::NoUpdateAvailable => write!(f, "no update available"),
            Self::UnsignedUpdateNotInstallable => write!(
                f,
                "This release has no updater signature, so the normal verified updater cannot install it. Use the separately confirmed unsigned action or install it manually from GitHub Releases."
            ),
            Self::UnsignedRiskNotAcknowledged => write!(
                f,
                "Installing an unsigned update requires explicit acknowledgement of the risk."
            ),
            Self::UnsignedVersionRequired => write!(
                f,
                "Installing an unsigned update requires the exact displayed version."
            ),
            Self::OperationInProgress => write!(
                f,
                "An updater operation is already in progress."
            ),
            Self::SignedUpdateRequiresVerifiedInstall => write!(
                f,
                "This release is signed. Use the normal verified updater install path."
            ),
            Self::InvalidUnsignedReleaseUrl(msg) => {
                write!(f, "invalid unsigned GitHub release URL: {msg}")
            }
            Self::IncompatibleUnsignedArtifact(msg) => {
                write!(f, "incompatible unsigned update artifact: {msg}")
            }
            Self::UnsignedDownload(msg) => {
                write!(f, "unsigned update download failed: {msg}")
            }
            Self::UnsignedPayloadTooLarge { limit_bytes } => write!(
                f,
                "unsigned update payload exceeds the {limit_bytes}-byte safety limit"
            ),
            Self::UnsignedLaunch(msg) => {
                write!(f, "failed to launch unsigned update artifact: {msg}")
            }
            Self::VersionMismatch {
                requested,
                available,
            } => write!(
                f,
                "requested updater version {requested}, but the updater feed offered {available}"
            ),
            Self::State(msg) => write!(f, "updater state error: {msg}"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<std::io::Error> for UpdateError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_json::Error> for UpdateError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serialization(value.to_string())
    }
}

impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(value: tauri_plugin_updater::Error) -> Self {
        Self::Plugin(value.to_string())
    }
}

impl From<url::ParseError> for UpdateError {
    fn from(value: url::ParseError) -> Self {
        Self::InvalidEndpoint(value.to_string())
    }
}

impl From<UpdateError> for crate::types::UnsignedUpdateCommandError {
    fn from(error: UpdateError) -> Self {
        use crate::types::{UnsignedUpdateCommandError, UnsignedUpdateErrorCode};

        let code = match &error {
            UpdateError::UnsignedRiskNotAcknowledged => {
                UnsignedUpdateErrorCode::AcknowledgementRequired
            }
            UpdateError::UnsignedVersionRequired => UnsignedUpdateErrorCode::VersionRequired,
            UpdateError::OperationInProgress => UnsignedUpdateErrorCode::OperationInProgress,
            UpdateError::SelfUpdateUnsupported(_) => {
                UnsignedUpdateErrorCode::UnsupportedInstallMode
            }
            UpdateError::NoUpdateAvailable => UnsignedUpdateErrorCode::NoUpdateAvailable,
            UpdateError::VersionMismatch { .. } => UnsignedUpdateErrorCode::VersionMismatch,
            UpdateError::SignedUpdateRequiresVerifiedInstall => {
                UnsignedUpdateErrorCode::SignedUpdateRequiresVerifiedInstall
            }
            UpdateError::UnsignedUpdateNotInstallable => {
                UnsignedUpdateErrorCode::AcknowledgementRequired
            }
            UpdateError::InvalidUnsignedReleaseUrl(_) => UnsignedUpdateErrorCode::InvalidReleaseUrl,
            UpdateError::IncompatibleUnsignedArtifact(_) => {
                UnsignedUpdateErrorCode::IncompatibleArtifact
            }
            UpdateError::UnsignedDownload(_) | UpdateError::Io(_) => {
                UnsignedUpdateErrorCode::DownloadFailed
            }
            UpdateError::UnsignedPayloadTooLarge { .. } => UnsignedUpdateErrorCode::PayloadTooLarge,
            UpdateError::UnsignedLaunch(_) => UnsignedUpdateErrorCode::LaunchFailed,
            UpdateError::InvalidProxy(_) => UnsignedUpdateErrorCode::InvalidProxy,
            UpdateError::Plugin(_)
            | UpdateError::UpdaterTargetMissing { .. }
            | UpdateError::InvalidEndpoint(_) => UnsignedUpdateErrorCode::CheckFailed,
            UpdateError::Settings(_) | UpdateError::Serialization(_) | UpdateError::State(_) => {
                UnsignedUpdateErrorCode::Internal
            }
        };

        UnsignedUpdateCommandError {
            code,
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_target_missing_names_the_target_and_points_at_github_releases() {
        let message = UpdateError::UpdaterTargetMissing {
            target: "windows-x86_64-msi".to_string(),
        }
        .to_string();

        assert!(
            message.contains("windows-x86_64-msi"),
            "the missing target must be legible to the user: {message}"
        );
        assert!(
            message.contains("GitHub Releases"),
            "the fallback instruction must survive: {message}"
        );
        assert!(
            message.contains(".msi"),
            "the message must name the package type to install: {message}"
        );
    }

    #[test]
    fn plugin_errors_still_convert_through_the_generic_from_impl() {
        let error = UpdateError::from(std::io::Error::other("disk gone"));
        assert!(matches!(error, UpdateError::Io(_)));
        assert!(error.to_string().contains("disk gone"));

        let error = UpdateError::from(serde_json::from_str::<serde_json::Value>("{").unwrap_err());
        assert!(matches!(error, UpdateError::Serialization(_)));

        let error = UpdateError::from("not a url".parse::<url::Url>().unwrap_err());
        assert!(matches!(error, UpdateError::InvalidEndpoint(_)));
    }

    #[test]
    fn unsigned_update_error_explains_the_fail_closed_manual_path() {
        let message = UpdateError::UnsignedUpdateNotInstallable.to_string();

        assert!(message.contains("no updater signature"));
        assert!(message.contains("normal verified updater cannot install"));
        assert!(message.contains("separately confirmed unsigned action"));
        assert!(message.contains("manually"));
        assert!(message.contains("GitHub Releases"));
    }

    #[test]
    fn unsigned_command_errors_preserve_machine_readable_failure_codes() {
        use crate::types::UnsignedUpdateErrorCode;

        let error = crate::types::UnsignedUpdateCommandError::from(
            UpdateError::UnsignedRiskNotAcknowledged,
        );
        assert_eq!(error.code, UnsignedUpdateErrorCode::AcknowledgementRequired);

        let error = crate::types::UnsignedUpdateCommandError::from(
            UpdateError::IncompatibleUnsignedArtifact("wrong package".to_string()),
        );
        assert_eq!(error.code, UnsignedUpdateErrorCode::IncompatibleArtifact);

        let error = crate::types::UnsignedUpdateCommandError::from(UpdateError::UnsignedLaunch(
            "spawn failed".to_string(),
        ));
        assert_eq!(error.code, UnsignedUpdateErrorCode::LaunchFailed);

        let error = crate::types::UnsignedUpdateCommandError::from(UpdateError::InvalidProxy(
            "the proxy endpoint is not usable",
        ));
        assert_eq!(error.code, UnsignedUpdateErrorCode::InvalidProxy);
    }
}
