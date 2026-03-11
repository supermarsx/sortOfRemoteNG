use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::engine::I18nEngine;
use crate::watcher::I18nWatcher;

// ─── Managed state ───────────────────────────────────────────────────

/// State managed by Tauri's `app.manage()`.
pub struct I18nServiceState {
    pub engine: Arc<I18nEngine>,
    /// Hold the watcher alive for the lifetime of the app.
    pub _watcher: Option<I18nWatcher>,
}

// ─── Command payloads ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TranslateRequest {
    pub locale: String,
    pub key: String,
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct TranslatePluralRequest {
    pub locale: String,
    pub key: String,
    pub count: i64,
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct TranslateBatchRequest {
    pub locale: String,
    pub keys: Vec<String>,
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct TranslateBatchResponse {
    pub translations: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct LocaleInfo {
    pub tag: String,
    pub key_count: usize,
}

#[derive(Debug, Serialize)]
pub struct I18nStatus {
    pub default_locale: String,
    pub available_locales: Vec<LocaleInfo>,
    pub total_keys: usize,
}
