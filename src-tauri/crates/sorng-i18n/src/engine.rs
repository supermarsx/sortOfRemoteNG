use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use arc_swap::ArcSwap;
use dashmap::DashMap;

use crate::error::{I18nError, I18nResult};
use crate::interpolation;
use crate::loader::{self, FlatMap};
use crate::locale::Locale;

// ─── Translation bundle ──────────────────────────────────────────────

/// An immutable snapshot of all translations for one locale.
///
/// Wrapped in `Arc` and swapped atomically so readers never block.
#[derive(Debug, Clone)]
pub struct TranslationBundle {
    pub locale_tag: String,
    pub translations: FlatMap,
}

impl TranslationBundle {
    pub fn new(locale_tag: String, translations: FlatMap) -> Self {
        Self {
            locale_tag,
            translations,
        }
    }

    /// Look up a key.  Returns `None` if missing.
    pub fn get(&self, key: &str) -> Option<&String> {
        self.translations.get(key)
    }

    /// Look up a key and interpolate variables.
    pub fn translate(&self, key: &str, vars: &HashMap<String, String>) -> Option<String> {
        self.translations
            .get(key)
            .map(|tmpl| interpolation::interpolate(tmpl, vars))
    }

    /// Look up a pluralised key.
    ///
    /// Expects sub-keys like `key.one`, `key.other`, etc.
    pub fn translate_plural(
        &self,
        key: &str,
        count: i64,
        vars: &HashMap<String, String>,
    ) -> Option<String> {
        // Gather all plural forms: key.one, key.other, key.=0, …
        let prefix = format!("{key}.");
        let forms: HashMap<String, String> = self
            .translations
            .iter()
            .filter_map(|(k, v)| {
                k.strip_prefix(&prefix)
                    .map(|suffix| (suffix.to_string(), v.clone()))
            })
            .collect();

        if forms.is_empty() {
            // Fall back to non-plural key and just interpolate count
            let mut v = vars.clone();
            v.insert("count".into(), count.to_string());
            return self.translate(key, &v);
        }

        interpolation::pluralise(&forms, count, vars)
    }

    /// Return the number of keys in this bundle.
    pub fn len(&self) -> usize {
        self.translations.len()
    }

    pub fn is_empty(&self) -> bool {
        self.translations.is_empty()
    }

    /// Return all keys matching a dot-notation prefix.
    pub fn keys_for_namespace(&self, namespace: &str) -> Vec<String> {
        let prefix = format!("{namespace}.");
        self.translations
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect()
    }
}

// ─── I18n Engine ─────────────────────────────────────────────────────

/// The main i18n engine.
///
/// Holds all loaded locale bundles and provides the high-level translation
/// API.  Designed for concurrent access:
///
/// - Each locale bundle is stored inside `ArcSwap` so that hot-reload can
///   atomically replace a bundle without blocking readers.
/// - The outer map is a `DashMap` so new locales can be added concurrently.
pub struct I18nEngine {
    /// `locale_tag → ArcSwap<TranslationBundle>`
    bundles: DashMap<String, ArcSwap<TranslationBundle>>,
    /// Default / fallback locale tag (e.g. `"en"`).
    default_locale: String,
    /// Path to the directory containing `*.json` locale files.
    locales_dir: PathBuf,
    /// Optional namespace prefixes that have been loaded on top.
    namespaces: DashMap<String, PathBuf>,
}

impl I18nEngine {
    /// Create a new engine and eager-load all locale files from `locales_dir`.
    pub fn new(
        locales_dir: impl Into<PathBuf>,
        default_locale: impl Into<String>,
    ) -> I18nResult<Self> {
        let locales_dir = locales_dir.into();
        let default_locale = default_locale.into();
        let engine = Self {
            bundles: DashMap::new(),
            default_locale,
            locales_dir: locales_dir.clone(),
            namespaces: DashMap::new(),
        };

        engine.reload_all()?;
        Ok(engine)
    }

    /// Create an engine for testing with no directory backing.
    pub fn new_empty(default_locale: impl Into<String>) -> Self {
        Self {
            bundles: DashMap::new(),
            default_locale: default_locale.into(),
            locales_dir: PathBuf::new(),
            namespaces: DashMap::new(),
        }
    }

    // ── Loading ──────────────────────────────────────────────────────

    /// Reload all locale files from the configured directory.
    pub fn reload_all(&self) -> I18nResult<()> {
        if !self.locales_dir.exists() {
            log::warn!(
                "i18n: locales directory does not exist: {:?}",
                self.locales_dir
            );
            return Ok(());
        }

        let loaded = loader::load_all_locales(&self.locales_dir)?;

        for (tag, map) in loaded {
            let bundle = TranslationBundle::new(tag.clone(), map);
            self.set_bundle(tag, bundle);
        }

        // Re-apply namespace overlays
        let ns_entries: Vec<(String, PathBuf)> = self
            .namespaces
            .iter()
            .map(|e| (e.key().clone(), e.value().clone()))
            .collect();

        for (ns, dir) in ns_entries {
            if let Err(e) = self.load_namespace_from_dir(&ns, &dir) {
                log::warn!("i18n: failed to reload namespace '{}': {}", ns, e);
            }
        }

        log::info!(
            "i18n: reloaded {} locale(s) from {:?}",
            self.bundles.len(),
            self.locales_dir
        );
        Ok(())
    }

    /// Reload a single locale file.
    pub fn reload_locale(&self, tag: &str) -> I18nResult<()> {
        let path = self.locales_dir.join(format!("{tag}.json"));
        if !path.exists() {
            return Err(I18nError::LocaleNotFound(tag.into()));
        }

        let map = loader::load_locale_file(&path)?;
        let bundle = TranslationBundle::new(tag.to_string(), map);
        self.set_bundle(tag.to_string(), bundle);
        log::info!("i18n: reloaded locale '{}'", tag);
        Ok(())
    }

    /// Insert or replace a translation bundle.
    fn set_bundle(&self, tag: String, bundle: TranslationBundle) {
        match self.bundles.get(&tag) {
            Some(existing) => {
                existing.store(Arc::new(bundle));
            }
            None => {
                self.bundles.insert(tag, ArcSwap::from_pointee(bundle));
            }
        }
    }

    /// Manually add translations for a locale (useful for testing or
    /// programmatic locale injection).
    pub fn add_translations(&self, tag: &str, translations: FlatMap) {
        match self.bundles.get(tag) {
            Some(existing) => {
                let mut merged = existing.load().translations.clone();
                loader::merge_maps(&mut merged, &translations);
                let bundle = TranslationBundle::new(tag.to_string(), merged);
                existing.store(Arc::new(bundle));
            }
            None => {
                let bundle = TranslationBundle::new(tag.to_string(), translations);
                self.bundles
                    .insert(tag.to_string(), ArcSwap::from_pointee(bundle));
            }
        }
    }

    // ── Namespaces ───────────────────────────────────────────────────

    /// Register a namespace backed by a directory of locale files.
    ///
    /// Each file in `dir` (e.g. `en.json`) is loaded and its keys are
    /// prefixed with `namespace.` before merging into the main bundle.
    pub fn register_namespace(&self, namespace: &str, dir: impl Into<PathBuf>) -> I18nResult<()> {
        let dir = dir.into();
        self.load_namespace_from_dir(namespace, &dir)?;
        self.namespaces.insert(namespace.to_string(), dir);
        Ok(())
    }

    fn load_namespace_from_dir(&self, namespace: &str, dir: &Path) -> I18nResult<()> {
        let files = loader::discover_locale_files(dir)?;
        for (tag, path) in &files {
            let mut flat = loader::load_locale_file(path)?;
            // Prefix every key with the namespace
            let prefixed: FlatMap = flat
                .drain()
                .map(|(k, v)| (format!("{namespace}.{k}"), v))
                .collect();
            self.add_translations(tag, prefixed);
        }
        log::info!("i18n: loaded namespace '{}' from {:?}", namespace, dir);
        Ok(())
    }

    // ── Translation ──────────────────────────────────────────────────

    /// Get a snapshot of the bundle for a locale.
    pub fn bundle(&self, locale_tag: &str) -> Option<Arc<TranslationBundle>> {
        self.bundles.get(locale_tag).map(|e| e.load_full())
    }

    /// Get the default locale bundle.
    pub fn default_bundle(&self) -> Option<Arc<TranslationBundle>> {
        self.bundle(&self.default_locale)
    }

    /// Translate a key for the given locale, falling back through the
    /// locale's fallback chain and then to the default locale.
    pub fn t(&self, locale_tag: &str, key: &str, vars: &HashMap<String, String>) -> String {
        // Build fallback chain
        let chain = if let Some(loc) = Locale::parse(locale_tag) {
            loc.fallback_chain()
        } else {
            vec![locale_tag.to_string()]
        };

        for tag in &chain {
            if let Some(bundle) = self.bundle(tag) {
                if let Some(translated) = bundle.translate(key, vars) {
                    return translated;
                }
            }
        }

        // Fallback to default locale
        if let Some(bundle) = self.default_bundle() {
            if let Some(translated) = bundle.translate(key, vars) {
                return translated;
            }
        }

        // Last resort: return the key itself
        key.to_string()
    }

    /// Translate with pluralisation.
    pub fn t_plural(
        &self,
        locale_tag: &str,
        key: &str,
        count: i64,
        vars: &HashMap<String, String>,
    ) -> String {
        let chain = if let Some(loc) = Locale::parse(locale_tag) {
            loc.fallback_chain()
        } else {
            vec![locale_tag.to_string()]
        };

        for tag in &chain {
            if let Some(bundle) = self.bundle(tag) {
                if let Some(translated) = bundle.translate_plural(key, count, vars) {
                    return translated;
                }
            }
        }

        if let Some(bundle) = self.default_bundle() {
            if let Some(translated) = bundle.translate_plural(key, count, vars) {
                return translated;
            }
        }

        key.to_string()
    }

    /// Check whether a key exists for a locale (checking fallbacks).
    pub fn has_key(&self, locale_tag: &str, key: &str) -> bool {
        let chain = if let Some(loc) = Locale::parse(locale_tag) {
            loc.fallback_chain()
        } else {
            vec![locale_tag.to_string()]
        };

        for tag in &chain {
            if let Some(bundle) = self.bundle(tag) {
                if bundle.get(key).is_some() {
                    return true;
                }
            }
        }

        self.default_bundle().is_some_and(|b| b.get(key).is_some())
    }

    // ── Introspection ────────────────────────────────────────────────

    /// List all loaded locale tags.
    pub fn available_locales(&self) -> Vec<String> {
        self.bundles.iter().map(|e| e.key().clone()).collect()
    }

    /// Get the default locale tag.
    pub fn default_locale(&self) -> &str {
        &self.default_locale
    }

    /// Set the default locale tag.
    pub fn set_default_locale(&mut self, tag: impl Into<String>) {
        self.default_locale = tag.into();
    }

    /// Return the path being watched.
    pub fn locales_dir(&self) -> &Path {
        &self.locales_dir
    }

    /// Find keys present in the default locale but missing in `target`.
    pub fn missing_keys(&self, target_locale: &str) -> Vec<String> {
        let default = match self.default_bundle() {
            Some(b) => b,
            None => return vec![],
        };
        let target = match self.bundle(target_locale) {
            Some(b) => b,
            None => return default.translations.keys().cloned().collect(),
        };

        default
            .translations
            .keys()
            .filter(|k| !target.translations.contains_key(k.as_str()))
            .cloned()
            .collect()
    }

    /// Return a full translation map for a locale (useful for SSR / bulk
    /// transfer to the frontend).
    pub fn full_map(&self, locale_tag: &str) -> Option<FlatMap> {
        self.bundle(locale_tag).map(|b| b.translations.clone())
    }

    /// Export a bundle as nested JSON (matching the frontend file format).
    pub fn export_nested_json(&self, locale_tag: &str) -> Option<serde_json::Value> {
        self.full_map(locale_tag).map(|m| loader::unflatten(&m))
    }

    /// Return keys for a namespace prefix within a locale.
    pub fn namespace_keys(&self, locale_tag: &str, namespace: &str) -> Vec<String> {
        self.bundle(locale_tag)
            .map(|b| b.keys_for_namespace(namespace))
            .unwrap_or_default()
    }

    /// Subset a bundle to only keys under `namespace`, stripping the prefix.
    pub fn namespace_map(&self, locale_tag: &str, namespace: &str) -> FlatMap {
        let prefix = format!("{namespace}.");
        self.bundle(locale_tag)
            .map(|b| {
                b.translations
                    .iter()
                    .filter_map(|(k, v)| {
                        k.strip_prefix(&prefix)
                            .map(|stripped| (stripped.to_string(), v.clone()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

// Allow sharing via Tauri's `manage()` — I18nEngine is Send+Sync because
// DashMap and ArcSwap are.
unsafe impl Send for I18nEngine {}
unsafe impl Sync for I18nEngine {}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_engine() -> I18nEngine {
        let engine = I18nEngine::new_empty("en");

        let mut en = HashMap::new();
        en.insert("app.title".into(), "SortOfRemoteNG".into());
        en.insert("greeting".into(), "Hello {{name}}!".into());
        en.insert("items.one".into(), "{{count}} item".into());
        en.insert("items.other".into(), "{{count}} items".into());
        engine.add_translations("en", en);

        let mut de = HashMap::new();
        de.insert("app.title".into(), "SortOfRemoteNG".into());
        de.insert("greeting".into(), "Hallo {{name}}!".into());
        engine.add_translations("de", de);

        engine
    }

    #[test]
    fn translate_basic() {
        let engine = test_engine();
        let mut vars = HashMap::new();
        vars.insert("name".into(), "World".into());
        assert_eq!(engine.t("en", "greeting", &vars), "Hello World!");
        assert_eq!(engine.t("de", "greeting", &vars), "Hallo World!");
    }

    #[test]
    fn fallback_to_default() {
        let engine = test_engine();
        let vars = HashMap::new();
        // 'items.one' only exists in en
        assert_eq!(engine.t("de", "items.one", &vars), "{{count}} item");
    }

    #[test]
    fn fallback_locale_chain() {
        let engine = test_engine();
        let vars = HashMap::new();
        // "de-AT" should fall back to "de", then "en"
        assert_eq!(engine.t("de-AT", "app.title", &vars), "SortOfRemoteNG");
    }

    #[test]
    fn missing_key_returns_key() {
        let engine = test_engine();
        let vars = HashMap::new();
        assert_eq!(engine.t("en", "nonexistent.key", &vars), "nonexistent.key");
    }

    #[test]
    fn plural_translation() {
        let engine = test_engine();
        let vars = HashMap::new();
        assert_eq!(engine.t_plural("en", "items", 1, &vars), "1 item");
        assert_eq!(engine.t_plural("en", "items", 5, &vars), "5 items");
    }

    #[test]
    fn available_locales() {
        let engine = test_engine();
        let mut locales = engine.available_locales();
        locales.sort();
        assert_eq!(locales, vec!["de", "en"]);
    }

    #[test]
    fn missing_keys_detection() {
        let engine = test_engine();
        let missing = engine.missing_keys("de");
        assert!(missing.contains(&"items.one".to_string()));
        assert!(missing.contains(&"items.other".to_string()));
    }
}
