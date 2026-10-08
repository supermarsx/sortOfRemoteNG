use serde::{Deserialize, Serialize};
use sorng_browser_host::{
    ipc::OriginBrowserIdentity,
    native_appearance::{AppPalette, AppearanceStatus},
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AppearanceRequest {
    pub identity: OriginBrowserIdentity,
    pub app_palette: Option<AppPalette>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppearanceResponse {
    pub status: AppearanceStatus,
    pub following_app_theme: bool,
}

impl AppearanceResponse {
    pub(crate) fn acknowledged(status: AppearanceStatus, following_app_theme: bool) -> Self {
        Self {
            status,
            following_app_theme: following_app_theme && status == AppearanceStatus::Applied,
        }
    }
}
