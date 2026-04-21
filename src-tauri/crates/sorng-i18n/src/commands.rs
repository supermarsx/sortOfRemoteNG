
use super::command_types::*;
use super::error::I18nError;
use super::ssr::{self, SsrOptions, SsrTranslationPayload};

// ─── Tauri commands ──────────────────────────────────────────────────

/// Translate a single key.
#[tauri::command]
pub fn i18n_translate(
    state: tauri::State<'_, I18nServiceState>,
    request: TranslateRequest,
) -> Result<String, I18nError> {
    Ok(state.engine.t(&request.locale, &request.key, &request.vars))
}

/// Translate a single key with pluralisation.
#[tauri::command]
pub fn i18n_translate_plural(
    state: tauri::State<'_, I18nServiceState>,
    request: TranslatePluralRequest,
) -> Result<String, I18nError> {
    Ok(state
        .engine
        .t_plural(&request.locale, &request.key, request.count, &request.vars))
}

/// Translate a batch of keys at once (reduces IPC round-trips).
#[tauri::command]
pub fn i18n_translate_batch(
    state: tauri::State<'_, I18nServiceState>,
    request: TranslateBatchRequest,
) -> Result<TranslateBatchResponse, I18nError> {
    let translations = request
        .keys
        .iter()
        .map(|key| {
            let translated = state.engine.t(&request.locale, key, &request.vars);
            (key.clone(), translated)
        })
        .collect();

    Ok(TranslateBatchResponse { translations })
}

/// Get the full translation bundle for a locale (nested JSON).
///
/// This is the primary command the frontend should use on startup or
/// language switch to fetch all translations at once.
#[tauri::command]
pub fn i18n_get_bundle(
    state: tauri::State<'_, I18nServiceState>,
    locale: String,
) -> Result<serde_json::Value, I18nError> {
    state
        .engine
        .export_nested_json(&locale)
        .ok_or(I18nError::LocaleNotFound(locale))
}

/// Get a bundle scoped to a namespace.
#[tauri::command]
pub fn i18n_get_namespace_bundle(
    state: tauri::State<'_, I18nServiceState>,
    locale: String,
    namespace: String,
) -> Result<serde_json::Value, I18nError> {
    let map = state.engine.namespace_map(&locale, &namespace);
    if map.is_empty() {
        return Err(I18nError::NamespaceNotFound(namespace));
    }
    Ok(super::loader::unflatten(&map))
}

/// List available locales.
#[tauri::command]
pub fn i18n_available_locales(
    state: tauri::State<'_, I18nServiceState>,
) -> Result<Vec<String>, I18nError> {
    Ok(state.engine.available_locales())
}

/// Get i18n engine status / diagnostics.
#[tauri::command]
pub fn i18n_status(state: tauri::State<'_, I18nServiceState>) -> Result<I18nStatus, I18nError> {
    let locales: Vec<LocaleInfo> = state
        .engine
        .available_locales()
        .into_iter()
        .map(|tag| {
            let key_count = state.engine.bundle(&tag).map(|b| b.len()).unwrap_or(0);
            LocaleInfo { tag, key_count }
        })
        .collect();

    let total_keys: usize = locales.iter().map(|l| l.key_count).sum();

    Ok(I18nStatus {
        default_locale: state.engine.default_locale().to_string(),
        available_locales: locales,
        total_keys,
    })
}

/// Detect the OS locale.
#[tauri::command]
pub fn i18n_detect_os_locale() -> Result<String, I18nError> {
    super::locale::Locale::detect_os_locale()
        .map(|l| l.to_tag())
        .ok_or_else(|| I18nError::Other("could not detect OS locale".into()))
}

/// Check whether a translation key exists.
#[tauri::command]
pub fn i18n_has_key(
    state: tauri::State<'_, I18nServiceState>,
    locale: String,
    key: String,
) -> Result<bool, I18nError> {
    Ok(state.engine.has_key(&locale, &key))
}

/// Find keys present in the default locale but missing in the target.
#[tauri::command]
pub fn i18n_missing_keys(
    state: tauri::State<'_, I18nServiceState>,
    locale: String,
) -> Result<Vec<String>, I18nError> {
    Ok(state.engine.missing_keys(&locale))
}

/// Force a full reload of all locale files from disk.
#[tauri::command]
pub fn i18n_reload(state: tauri::State<'_, I18nServiceState>) -> Result<(), I18nError> {
    state.engine.reload_all()
}

/// Build the SSR hydration payload for a locale.
#[tauri::command]
pub fn i18n_ssr_payload(
    state: tauri::State<'_, I18nServiceState>,
    locale: String,
    namespace: Option<String>,
    include_fallback: Option<bool>,
) -> Result<SsrTranslationPayload, I18nError> {
    let opts = SsrOptions {
        locale,
        namespace,
        include_fallback: include_fallback.unwrap_or(true),
    };
    Ok(ssr::build_ssr_payload(&state.engine, &opts))
}

/// Build the SSR `<script>` tag for injecting translations into HTML.
#[tauri::command]
pub fn i18n_ssr_script(
    state: tauri::State<'_, I18nServiceState>,
    locale: String,
) -> Result<String, I18nError> {
    let payload = ssr::build_ssr_payload(
        &state.engine,
        &SsrOptions {
            locale,
            ..Default::default()
        },
    );
    Ok(ssr::render_hydration_script(&payload))
}
