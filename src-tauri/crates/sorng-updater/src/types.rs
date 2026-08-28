//! Stable command contract for the backend-owned updater facade.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const PUBLIC_ENDPOINT_URL: &str =
    "https://github.com/supermarsx/sortOfRemoteNG/releases/latest/download/latest.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdaterInstallMode {
    #[serde(rename = "appimage")]
    AppImage,
    Nsis,
    #[serde(rename = "macos_app")]
    MacOsApp,
    Deb,
    Rpm,
    Msi,
    Flatpak,
    Portable,
    Unknown,
}

impl UpdaterInstallMode {
    pub fn self_update_supported(self) -> bool {
        matches!(
            self,
            Self::AppImage | Self::Nsis | Self::MacOsApp | Self::Msi
        )
    }

    /// Suffix appended to the plugin's base updater target to pin a per-installer
    /// manifest key (e.g. `windows-x86_64` + `msi` -> `windows-x86_64-msi`).
    /// `None` means "use the plugin's default target resolution".
    ///
    /// Suffix strings must match `tauri_plugin_updater::Installer::name()` values
    /// (`msi`, `nsis`, `deb`, `rpm`, `appimage`, `app`) so that future per-installer
    /// manifest keys are a one-line addition here.
    ///
    /// `Nsis` deliberately stays `None`: its silent fallback from `windows-<arch>-nsis`
    /// to `windows-<arch>` is what keeps already-published feeds working.
    pub fn updater_target_suffix(self) -> Option<&'static str> {
        match self {
            Self::Msi => Some("msi"),
            Self::AppImage
            | Self::Nsis
            | Self::MacOsApp
            | Self::Deb
            | Self::Rpm
            | Self::Flatpak
            | Self::Portable
            | Self::Unknown => None,
        }
    }

    pub fn self_update_message(self) -> Option<&'static str> {
        match self {
            Self::AppImage | Self::Nsis | Self::MacOsApp | Self::Msi => None,
            Self::Deb => Some(
                "This Debian package is updated externally. Install a newer .deb package from GitHub Releases.",
            ),
            Self::Rpm => Some(
                "This RPM package is updated externally. Install a newer .rpm package from GitHub Releases.",
            ),
            Self::Flatpak => Some(
                "This Flatpak installation is updated externally. Install a newer Flatpak from GitHub Releases.",
            ),
            Self::Portable => Some(
                "This portable installation is updated manually. Download and extract a newer portable ZIP from GitHub Releases.",
            ),
            Self::Unknown => Some(
                "This installation type cannot be safely updated in the app. Install the appropriate newer package from GitHub Releases.",
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdaterStatusValue {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Installing,
    RestartRequired,
    Error,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdaterEndpointMode {
    #[default]
    PublicOnly,
    PrivateThenPublic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdaterEndpointSource {
    Public,
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedUpdaterEndpoint {
    pub url: String,
    pub source: UpdaterEndpointSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSettings {
    pub auto_check_enabled: bool,
    pub check_interval_hours: u64,
    pub install_mode: UpdaterInstallMode,
    pub self_update_supported: bool,
    pub self_update_message: Option<String>,
    pub private_endpoint_enabled: bool,
    pub private_endpoint_url: Option<String>,
    pub public_endpoint_url: String,
    pub endpoint_mode: UpdaterEndpointMode,
    pub resolved_endpoints: Vec<ResolvedUpdaterEndpoint>,
    pub dynamic_plugin_endpoints_supported: bool,
    pub dynamic_plugin_endpoints_message: Option<String>,
    pub private_endpoint_validation_error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterSettingsPatch {
    pub auto_check_enabled: Option<bool>,
    pub check_interval_hours: Option<u64>,
    pub private_endpoint_enabled: Option<bool>,
    pub private_endpoint_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub target: String,
    pub download_url: String,
    pub signature_present: bool,
    pub raw_json: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatusSnapshot {
    pub status: UpdaterStatusValue,
    pub current_version: String,
    pub install_mode: UpdaterInstallMode,
    pub self_update_supported: bool,
    pub self_update_message: Option<String>,
    pub available_update: Option<AvailableUpdate>,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub endpoint_mode: UpdaterEndpointMode,
    pub endpoint_source: String,
    pub resolved_endpoints: Vec<ResolvedUpdaterEndpoint>,
    pub dynamic_plugin_endpoints_supported: bool,
    pub dynamic_plugin_endpoints_message: Option<String>,
    pub private_endpoint_validation_error: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterCheckResult {
    pub update_available: bool,
    pub available_update: Option<AvailableUpdate>,
    pub status: UpdaterStatusSnapshot,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ALL_MODES: [UpdaterInstallMode; 9] = [
        UpdaterInstallMode::AppImage,
        UpdaterInstallMode::Nsis,
        UpdaterInstallMode::MacOsApp,
        UpdaterInstallMode::Deb,
        UpdaterInstallMode::Rpm,
        UpdaterInstallMode::Msi,
        UpdaterInstallMode::Flatpak,
        UpdaterInstallMode::Portable,
        UpdaterInstallMode::Unknown,
    ];

    #[test]
    fn msi_installs_self_update_from_the_signed_feed() {
        assert!(
            UpdaterInstallMode::Msi.self_update_supported(),
            "MSI installs must self-update from the signed feed"
        );
        assert_eq!(
            UpdaterInstallMode::Msi.self_update_message(),
            None,
            "a supported mode must not carry an externally-managed message"
        );
    }

    #[test]
    fn feed_compatible_modes_are_supported_and_message_free() {
        for mode in [
            UpdaterInstallMode::AppImage,
            UpdaterInstallMode::Nsis,
            UpdaterInstallMode::MacOsApp,
            UpdaterInstallMode::Msi,
        ] {
            assert!(mode.self_update_supported(), "{mode:?} should self-update");
            assert_eq!(mode.self_update_message(), None, "{mode:?}");
        }
    }

    #[test]
    fn externally_managed_modes_keep_manual_update_guidance() {
        for mode in [
            UpdaterInstallMode::Deb,
            UpdaterInstallMode::Rpm,
            UpdaterInstallMode::Flatpak,
            UpdaterInstallMode::Portable,
            UpdaterInstallMode::Unknown,
        ] {
            assert!(
                !mode.self_update_supported(),
                "{mode:?} must stay externally managed"
            );
            assert!(
                mode.self_update_message()
                    .is_some_and(|message| message.contains("GitHub Releases")),
                "{mode:?} needs manual update guidance"
            );
        }
    }

    #[test]
    fn support_and_message_stay_mutually_exclusive() {
        for mode in ALL_MODES {
            assert_eq!(
                mode.self_update_supported(),
                mode.self_update_message().is_none(),
                "{mode:?} must either self-update or explain why it cannot"
            );
        }
    }

    #[test]
    fn only_msi_pins_a_per_installer_updater_target() {
        assert_eq!(
            UpdaterInstallMode::Msi.updater_target_suffix(),
            Some("msi"),
            "MSI must pin the per-installer manifest key"
        );

        for mode in ALL_MODES {
            if mode == UpdaterInstallMode::Msi {
                continue;
            }
            assert_eq!(
                mode.updater_target_suffix(),
                None,
                "{mode:?} must keep the plugin's default target resolution"
            );
        }
    }

    #[test]
    fn updater_target_suffixes_match_plugin_installer_names() {
        // Suffixes are appended to the plugin's base target, so they must be spelled
        // exactly as `tauri_plugin_updater::Installer::name()` spells them.
        const INSTALLER_NAMES: [&str; 6] = ["appimage", "deb", "rpm", "app", "msi", "nsis"];

        for mode in ALL_MODES {
            if let Some(suffix) = mode.updater_target_suffix() {
                assert!(
                    INSTALLER_NAMES.contains(&suffix),
                    "{mode:?} suffix {suffix:?} is not a plugin installer name"
                );
            }
        }
    }

    #[test]
    fn serializes_install_modes_as_stable_contract_values() {
        let cases = [
            (UpdaterInstallMode::AppImage, "appimage"),
            (UpdaterInstallMode::Nsis, "nsis"),
            (UpdaterInstallMode::MacOsApp, "macos_app"),
            (UpdaterInstallMode::Deb, "deb"),
            (UpdaterInstallMode::Rpm, "rpm"),
            (UpdaterInstallMode::Msi, "msi"),
            (UpdaterInstallMode::Flatpak, "flatpak"),
            (UpdaterInstallMode::Portable, "portable"),
            (UpdaterInstallMode::Unknown, "unknown"),
        ];

        for (mode, expected) in cases {
            assert_eq!(
                serde_json::to_value(mode).expect("serialize updater install mode"),
                json!(expected),
                "{mode:?} wire value changed"
            );
            assert_eq!(
                serde_json::from_value::<UpdaterInstallMode>(json!(expected))
                    .expect("deserialize updater install mode"),
                mode
            );
        }
    }
}
