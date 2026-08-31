//! Error types for the updater facade.

use std::fmt;

#[derive(Debug, Clone)]
pub enum UpdateError {
    InvalidEndpoint(String),
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
    /// The discovery feed carried no minisign signature. The release may
    /// still be shown to the user, but the updater must never download or execute it.
    UnsignedUpdateNotInstallable,
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
                "This release has no updater signature, so it cannot be installed in the app. Download and install it manually from GitHub Releases."
            ),
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
        assert!(message.contains("cannot be installed in the app"));
        assert!(message.contains("manually"));
        assert!(message.contains("GitHub Releases"));
    }
}
