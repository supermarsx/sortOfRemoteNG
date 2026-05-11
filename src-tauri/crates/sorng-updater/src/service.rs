//! Backend-owned updater state layered over `tauri-plugin-updater`.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use chrono::Utc;
use log::{debug, warn};
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::{
    error::UpdateError,
    types::{
        AvailableUpdate, ResolvedUpdaterEndpoint, UpdaterCheckResult, UpdaterEndpointMode,
        UpdaterEndpointSource, UpdaterSettings, UpdaterSettingsPatch, UpdaterStatusSnapshot,
        UpdaterStatusValue, PUBLIC_ENDPOINT_URL,
    },
};

const SETTINGS_FILENAME: &str = "settings.json";
const SETTINGS_KEY_UPDATER: &str = "updater";
const LEGACY_PRIVATE_ENDPOINT_KEY: &str = "private_endpoint";
const MAX_CHECK_INTERVAL_HOURS: u64 = 24 * 30;

pub type UpdaterServiceState = Arc<UpdaterService>;

#[derive(Debug, Clone)]
struct StoredUpdaterSettings {
    auto_check_enabled: bool,
    check_interval_hours: u64,
    private_endpoint_enabled: bool,
    private_endpoint_url: Option<String>,
}

impl Default for StoredUpdaterSettings {
    fn default() -> Self {
        Self {
            auto_check_enabled: true,
            check_interval_hours: 24,
            private_endpoint_enabled: false,
            private_endpoint_url: None,
        }
    }
}

#[derive(Debug)]
struct UpdaterState {
    settings: StoredUpdaterSettings,
    status: UpdaterStatusValue,
    available_update: Option<AvailableUpdate>,
    last_checked_at: Option<chrono::DateTime<Utc>>,
    last_error: Option<String>,
    private_endpoint_validation_error: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    progress_percent: Option<f64>,
}

impl UpdaterState {
    fn new(settings: StoredUpdaterSettings) -> Self {
        let private_endpoint_validation_error = private_endpoint_validation_error(&settings);
        Self {
            settings,
            status: UpdaterStatusValue::Idle,
            available_update: None,
            last_checked_at: None,
            last_error: None,
            private_endpoint_validation_error,
            downloaded_bytes: 0,
            total_bytes: None,
            progress_percent: None,
        }
    }
}

#[derive(Debug, Clone)]
struct EndpointResolution {
    urls: Vec<Url>,
    endpoints: Vec<ResolvedUpdaterEndpoint>,
    mode: UpdaterEndpointMode,
    validation_error: Option<String>,
}

pub struct UpdaterService {
    current_version: String,
    settings_path: PathBuf,
    inner: Arc<Mutex<UpdaterState>>,
}

impl UpdaterService {
    pub fn new(
        current_version: impl Into<String>,
        app_data_dir: impl AsRef<Path>,
    ) -> UpdaterServiceState {
        let settings_path = app_data_dir.as_ref().join(SETTINGS_FILENAME);
        let (settings, load_error) = match load_settings(&settings_path) {
            Ok(settings) => (settings, None),
            Err(error) => {
                warn!("failed to load updater settings: {error}");
                (StoredUpdaterSettings::default(), Some(error.to_string()))
            }
        };

        let mut state = UpdaterState::new(settings);
        state.last_error = load_error;

        Arc::new(Self {
            current_version: current_version.into(),
            settings_path,
            inner: Arc::new(Mutex::new(state)),
        })
    }

    pub fn get_settings(&self) -> Result<UpdaterSettings, UpdateError> {
        let state = self.lock_state()?;
        self.settings_snapshot(
            &state.settings,
            state.private_endpoint_validation_error.clone(),
        )
    }

    pub fn save_settings(
        &self,
        patch: UpdaterSettingsPatch,
    ) -> Result<UpdaterSettings, UpdateError> {
        let mut next = {
            let state = self.lock_state()?;
            state.settings.clone()
        };

        let private_url_touched = patch.private_endpoint_url.is_some();

        if let Some(value) = patch.auto_check_enabled {
            next.auto_check_enabled = value;
        }
        if let Some(value) = patch.check_interval_hours {
            if value == 0 || value > MAX_CHECK_INTERVAL_HOURS {
                return Err(UpdateError::Settings(format!(
                    "checkIntervalHours must be between 1 and {MAX_CHECK_INTERVAL_HOURS}"
                )));
            }
            next.check_interval_hours = value;
        }
        if let Some(value) = patch.private_endpoint_enabled {
            next.private_endpoint_enabled = value;
        }
        if let Some(value) = patch.private_endpoint_url {
            let trimmed = value.trim();
            next.private_endpoint_url = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }

        if next.private_endpoint_enabled && next.private_endpoint_url.is_none() {
            return Err(UpdateError::InvalidEndpoint(
                "private endpoint is enabled but no URL is configured".to_string(),
            ));
        }

        let validation_error = private_endpoint_validation_error(&next);
        if let Some(error) = &validation_error {
            if next.private_endpoint_enabled || private_url_touched {
                return Err(UpdateError::InvalidEndpoint(error.clone()));
            }
        }

        persist_settings(&self.settings_path, &next)?;

        let mut state = self.lock_state()?;
        state.settings = next;
        state.private_endpoint_validation_error = validation_error;
        state.last_error = None;
        self.settings_snapshot(
            &state.settings,
            state.private_endpoint_validation_error.clone(),
        )
    }

    pub fn get_status(&self) -> Result<UpdaterStatusSnapshot, UpdateError> {
        let state = self.lock_state()?;
        self.status_snapshot(&state)
    }

    pub async fn check<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        force: bool,
    ) -> Result<UpdaterCheckResult, UpdateError> {
        let _ = force;
        self.set_status(UpdaterStatusValue::Checking, None)?;

        let settings = self.settings_clone()?;
        let resolution = self.resolve_endpoints(&settings)?;
        self.set_validation_error(resolution.validation_error.clone())?;

        let update_result = app
            .updater_builder()
            .endpoints(resolution.urls)?
            .build()?
            .check()
            .await;

        match update_result {
            Ok(Some(update)) => {
                let available = available_update_from_plugin(&update);
                debug!("signed updater feed offered version {}", available.version);
                self.record_available_update(available.clone())?;
                self.check_result(true, Some(available))
            }
            Ok(None) => {
                self.record_no_update()?;
                self.check_result(false, None)
            }
            Err(error) => {
                let error = UpdateError::from(error);
                self.record_error(error.to_string())?;
                Err(error)
            }
        }
    }

    pub async fn download_and_install<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        version: Option<String>,
    ) -> Result<UpdaterStatusSnapshot, UpdateError> {
        self.set_status(UpdaterStatusValue::Checking, None)?;

        let settings = self.settings_clone()?;
        let resolution = self.resolve_endpoints(&settings)?;
        self.set_validation_error(resolution.validation_error.clone())?;

        let update = app
            .updater_builder()
            .endpoints(resolution.urls)?
            .build()?
            .check()
            .await?;

        let Some(update) = update else {
            self.record_no_update()?;
            return Err(UpdateError::NoUpdateAvailable);
        };

        if let Some(requested) = version.as_deref() {
            if requested != update.version {
                let available = available_update_from_plugin(&update);
                self.record_available_update(available.clone())?;
                return Err(UpdateError::VersionMismatch {
                    requested: requested.to_string(),
                    available: available.version,
                });
            }
        }

        let available = available_update_from_plugin(&update);
        self.begin_download(available)?;

        let inner_for_progress = self.inner.clone();
        let inner_for_finished = self.inner.clone();
        let result = update
            .download_and_install(
                move |chunk_length, content_length| {
                    if let Ok(mut state) = inner_for_progress.lock() {
                        state.status = UpdaterStatusValue::Downloading;
                        if let Some(total) = content_length {
                            state.total_bytes = Some(total);
                        }
                        state.downloaded_bytes = state
                            .downloaded_bytes
                            .saturating_add(u64::try_from(chunk_length).unwrap_or(u64::MAX));
                        state.progress_percent = state.total_bytes.and_then(|total| {
                            if total == 0 {
                                None
                            } else {
                                Some(
                                    ((state.downloaded_bytes as f64 / total as f64) * 100.0)
                                        .min(100.0),
                                )
                            }
                        });
                    }
                },
                move || {
                    if let Ok(mut state) = inner_for_finished.lock() {
                        state.status = UpdaterStatusValue::Installing;
                        state.progress_percent = Some(100.0);
                    }
                },
            )
            .await;

        match result {
            Ok(()) => {
                let mut state = self.lock_state()?;
                state.status = UpdaterStatusValue::RestartRequired;
                state.last_error = None;
                state.progress_percent = Some(100.0);
                self.status_snapshot(&state)
            }
            Err(error) => {
                let error = UpdateError::from(error);
                self.record_error(error.to_string())?;
                Err(error)
            }
        }
    }

    pub fn relaunch<R: Runtime>(&self, app: &AppHandle<R>) {
        app.request_restart();
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, UpdaterState>, UpdateError> {
        self.inner
            .lock()
            .map_err(|_| UpdateError::State("updater state lock poisoned".to_string()))
    }

    fn settings_clone(&self) -> Result<StoredUpdaterSettings, UpdateError> {
        Ok(self.lock_state()?.settings.clone())
    }

    fn set_status(
        &self,
        status: UpdaterStatusValue,
        last_error: Option<String>,
    ) -> Result<(), UpdateError> {
        let mut state = self.lock_state()?;
        state.status = status;
        state.last_error = last_error;
        state.downloaded_bytes = 0;
        state.total_bytes = None;
        state.progress_percent = None;
        Ok(())
    }

    fn set_validation_error(&self, validation_error: Option<String>) -> Result<(), UpdateError> {
        let mut state = self.lock_state()?;
        state.private_endpoint_validation_error = validation_error;
        Ok(())
    }

    fn record_available_update(&self, available: AvailableUpdate) -> Result<(), UpdateError> {
        let mut state = self.lock_state()?;
        state.status = UpdaterStatusValue::Available;
        state.available_update = Some(available);
        state.last_checked_at = Some(Utc::now());
        state.last_error = None;
        state.downloaded_bytes = 0;
        state.total_bytes = None;
        state.progress_percent = None;
        Ok(())
    }

    fn record_no_update(&self) -> Result<(), UpdateError> {
        let mut state = self.lock_state()?;
        state.status = UpdaterStatusValue::UpToDate;
        state.available_update = None;
        state.last_checked_at = Some(Utc::now());
        state.last_error = None;
        state.downloaded_bytes = 0;
        state.total_bytes = None;
        state.progress_percent = None;
        Ok(())
    }

    fn record_error(&self, message: String) -> Result<(), UpdateError> {
        let mut state = self.lock_state()?;
        state.status = UpdaterStatusValue::Error;
        state.last_error = Some(message);
        state.progress_percent = None;
        Ok(())
    }

    fn begin_download(&self, available: AvailableUpdate) -> Result<(), UpdateError> {
        let mut state = self.lock_state()?;
        state.status = UpdaterStatusValue::Downloading;
        state.available_update = Some(available);
        state.last_error = None;
        state.downloaded_bytes = 0;
        state.total_bytes = None;
        state.progress_percent = Some(0.0);
        Ok(())
    }

    fn check_result(
        &self,
        update_available: bool,
        available_update: Option<AvailableUpdate>,
    ) -> Result<UpdaterCheckResult, UpdateError> {
        Ok(UpdaterCheckResult {
            update_available,
            available_update,
            status: self.get_status()?,
        })
    }

    fn settings_snapshot(
        &self,
        settings: &StoredUpdaterSettings,
        validation_error: Option<String>,
    ) -> Result<UpdaterSettings, UpdateError> {
        let resolution = self.resolve_endpoints(settings)?;
        Ok(UpdaterSettings {
            auto_check_enabled: settings.auto_check_enabled,
            check_interval_hours: settings.check_interval_hours,
            private_endpoint_enabled: settings.private_endpoint_enabled,
            private_endpoint_url: settings.private_endpoint_url.clone(),
            public_endpoint_url: PUBLIC_ENDPOINT_URL.to_string(),
            endpoint_mode: resolution.mode,
            resolved_endpoints: resolution.endpoints,
            dynamic_plugin_endpoints_supported: true,
            dynamic_plugin_endpoints_message: Some(
                "Runtime endpoints are applied through tauri-plugin-updater's Rust updater_builder().endpoints(...) API."
                    .to_string(),
            ),
            private_endpoint_validation_error: validation_error.or(resolution.validation_error),
        })
    }

    fn status_snapshot(&self, state: &UpdaterState) -> Result<UpdaterStatusSnapshot, UpdateError> {
        let resolution = self.resolve_endpoints(&state.settings)?;
        let endpoint_source = match resolution.mode {
            UpdaterEndpointMode::PublicOnly => "public".to_string(),
            UpdaterEndpointMode::PrivateThenPublic => "private_then_public".to_string(),
        };

        Ok(UpdaterStatusSnapshot {
            status: state.status,
            current_version: self.current_version.clone(),
            available_update: state.available_update.clone(),
            last_checked_at: state.last_checked_at,
            last_error: state.last_error.clone(),
            endpoint_mode: resolution.mode,
            endpoint_source,
            resolved_endpoints: resolution.endpoints,
            dynamic_plugin_endpoints_supported: true,
            dynamic_plugin_endpoints_message: Some(
                "Runtime endpoints are applied through tauri-plugin-updater's Rust updater_builder().endpoints(...) API."
                    .to_string(),
            ),
            private_endpoint_validation_error: state
                .private_endpoint_validation_error
                .clone()
                .or(resolution.validation_error),
            downloaded_bytes: state.downloaded_bytes,
            total_bytes: state.total_bytes,
            progress_percent: state.progress_percent,
        })
    }

    fn resolve_endpoints(
        &self,
        settings: &StoredUpdaterSettings,
    ) -> Result<EndpointResolution, UpdateError> {
        let public = Url::parse(PUBLIC_ENDPOINT_URL)?;
        let mut urls = vec![public];
        let mut endpoints = vec![ResolvedUpdaterEndpoint {
            url: PUBLIC_ENDPOINT_URL.to_string(),
            source: UpdaterEndpointSource::Public,
        }];
        let mut mode = UpdaterEndpointMode::PublicOnly;
        let mut validation_error = private_endpoint_validation_error(settings);

        if settings.private_endpoint_enabled {
            if validation_error.is_none() {
                if let Some(private_url) = settings.private_endpoint_url.as_deref() {
                    let parsed = Url::parse(private_url)?;
                    urls.insert(0, parsed);
                    endpoints.insert(
                        0,
                        ResolvedUpdaterEndpoint {
                            url: private_url.to_string(),
                            source: UpdaterEndpointSource::Private,
                        },
                    );
                    mode = UpdaterEndpointMode::PrivateThenPublic;
                }
            } else {
                warn!(
                    "private updater endpoint is enabled but invalid; falling back to public endpoint"
                );
            }
        } else {
            validation_error = None;
        }

        Ok(EndpointResolution {
            urls,
            endpoints,
            mode,
            validation_error,
        })
    }
}

fn available_update_from_plugin(update: &Update) -> AvailableUpdate {
    AvailableUpdate {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|date| date.to_string()),
        body: update.body.clone(),
        target: update.target.clone(),
        download_url: update.download_url.to_string(),
        signature_present: !update.signature.trim().is_empty(),
        raw_json: update.raw_json.clone(),
    }
}

fn private_endpoint_validation_error(settings: &StoredUpdaterSettings) -> Option<String> {
    let Some(url) = settings.private_endpoint_url.as_deref() else {
        return settings
            .private_endpoint_enabled
            .then(|| "private endpoint is enabled but no URL is configured".to_string());
    };

    validate_private_endpoint(url)
        .err()
        .map(|error| error.to_string())
}

fn validate_private_endpoint(input: &str) -> Result<String, UpdateError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(UpdateError::InvalidEndpoint(
            "private endpoint URL cannot be empty".to_string(),
        ));
    }

    let parsed = Url::parse(trimmed)?;
    match parsed.scheme() {
        "https" => Ok(trimmed.to_string()),
        "http" if cfg!(debug_assertions) && is_local_dev_endpoint(&parsed) => {
            Ok(trimmed.to_string())
        }
        "http" => Err(UpdateError::InvalidEndpoint(
            "private endpoint must use HTTPS; HTTP is allowed only for local development endpoints in debug builds"
                .to_string(),
        )),
        scheme => Err(UpdateError::InvalidEndpoint(format!(
            "private endpoint must use HTTPS, got {scheme:?}"
        ))),
    }
}

fn is_local_dev_endpoint(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1") | Some("0.0.0.0")
    ) || url
        .host_str()
        .map(|host| host.ends_with(".localhost"))
        .unwrap_or(false)
}

fn load_settings(path: &Path) -> Result<StoredUpdaterSettings, UpdateError> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredUpdaterSettings::default())
        }
        Err(error) => return Err(error.into()),
    };

    let root: Value = serde_json::from_str(&raw)?;
    let Some(updater) = root.get(SETTINGS_KEY_UPDATER).and_then(Value::as_object) else {
        return Ok(StoredUpdaterSettings::default());
    };

    let private_endpoint_url = string_field(updater.get("privateEndpointUrl"))
        .or_else(|| string_field(updater.get(LEGACY_PRIVATE_ENDPOINT_KEY)));
    let private_endpoint_enabled = bool_field(updater.get("privateEndpointEnabled"))
        .unwrap_or_else(|| private_endpoint_url.is_some());

    Ok(StoredUpdaterSettings {
        auto_check_enabled: bool_field(updater.get("autoCheckEnabled"))
            .or_else(|| bool_field(updater.get("autoCheck")))
            .unwrap_or(true),
        check_interval_hours: u64_field(updater.get("checkIntervalHours"))
            .or_else(|| u64_field(updater.get("check_interval_hours")))
            .filter(|value| *value > 0 && *value <= MAX_CHECK_INTERVAL_HOURS)
            .unwrap_or(24),
        private_endpoint_enabled,
        private_endpoint_url,
    })
}

fn persist_settings(path: &Path, settings: &StoredUpdaterSettings) -> Result<(), UpdateError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut root = match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({})),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => return Err(error.into()),
    };

    if !root.is_object() {
        root = json!({});
    }

    let root_obj = root.as_object_mut().expect("root object checked");
    let updater = root_obj
        .entry(SETTINGS_KEY_UPDATER.to_string())
        .or_insert_with(|| json!({}));
    if !updater.is_object() {
        *updater = json!({});
    }
    let updater_obj = updater.as_object_mut().expect("updater object checked");
    updater_obj.insert(
        "autoCheckEnabled".to_string(),
        Value::Bool(settings.auto_check_enabled),
    );
    updater_obj.insert(
        "checkIntervalHours".to_string(),
        Value::Number(settings.check_interval_hours.into()),
    );
    updater_obj.insert(
        "privateEndpointEnabled".to_string(),
        Value::Bool(settings.private_endpoint_enabled),
    );
    match settings.private_endpoint_url.as_deref() {
        Some(url) => {
            updater_obj.insert(
                "privateEndpointUrl".to_string(),
                Value::String(url.to_string()),
            );
        }
        None => {
            updater_obj.remove("privateEndpointUrl");
        }
    }
    updater_obj.remove(LEGACY_PRIVATE_ENDPOINT_KEY);

    let body = serde_json::to_string_pretty(&root)?;
    std::fs::write(path, format!("{body}\n"))?;
    Ok(())
}

fn string_field(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn bool_field(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_bool)
}

fn u64_field(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64)
}
