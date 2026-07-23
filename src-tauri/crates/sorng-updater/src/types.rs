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
        matches!(self, Self::AppImage | Self::Nsis | Self::MacOsApp)
    }

    pub fn self_update_message(self) -> Option<&'static str> {
        match self {
            Self::AppImage | Self::Nsis | Self::MacOsApp => None,
            Self::Deb => Some(
                "This Debian package is updated externally. Install a newer .deb package from GitHub Releases.",
            ),
            Self::Rpm => Some(
                "This RPM package is updated externally. Install a newer .rpm package from GitHub Releases.",
            ),
            Self::Msi => Some(
                "This MSI installation is updated externally. Install a newer .msi package from GitHub Releases.",
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
