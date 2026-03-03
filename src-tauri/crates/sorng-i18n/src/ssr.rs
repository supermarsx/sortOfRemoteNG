use std::collections::HashMap;

use serde::Serialize;

use crate::engine::I18nEngine;
use crate::loader::{self, FlatMap};

// ─── SSR pre-render types ────────────────────────────────────────────

/// Pre-rendered translation payload for SSR hydration.
///
/// Embed this in the initial HTML so the frontend can hydrate without
/// a round-trip to fetch translations.
#[derive(Debug, Clone, Serialize)]
pub struct SsrTranslationPayload {
    /// The locale tag that was rendered.
    pub locale: String,
    /// The nested JSON translation object (matches frontend file format).
    pub translations: serde_json::Value,
    /// Available locales the user can switch to.
    pub available_locales: Vec<String>,
    /// The default / fallback locale.
    pub default_locale: String,
}

/// Options for SSR rendering.
#[derive(Debug, Clone)]
pub struct SsrOptions {
    /// The locale to render with.
    pub locale: String,
    /// Optional namespace filter — if set, only keys under this namespace
    /// are included. `None` means the full bundle.
    pub namespace: Option<String>,
    /// If true, merge fallback translations into the bundle so the
    /// frontend has every key it needs.
    pub include_fallback: bool,
}

impl Default for SsrOptions {
    fn default() -> Self {
        Self {
            locale: "en".into(),
            namespace: None,
            include_fallback: true,
        }
    }
}

// ─── SSR Functions ───────────────────────────────────────────────────

/// Build the SSR translation payload for embedding in HTML.
pub fn build_ssr_payload(engine: &I18nEngine, opts: &SsrOptions) -> SsrTranslationPayload {
    let mut map = if opts.include_fallback {
        // Start with default locale as base
        engine
            .full_map(engine.default_locale())
            .unwrap_or_default()
    } else {
        FlatMap::new()
    };

    // Overlay with target locale
    if let Some(target) = engine.full_map(&opts.locale) {
        loader::merge_maps(&mut map, &target);
    }

    // Optionally filter to namespace
    let filtered = match &opts.namespace {
        Some(ns) => {
            let prefix = format!("{ns}.");
            map.into_iter()
                .filter(|(k, _)| k.starts_with(&prefix))
                .collect()
        }
        None => map,
    };

    let nested = loader::unflatten(&filtered);

    SsrTranslationPayload {
        locale: opts.locale.clone(),
        translations: nested,
        available_locales: engine.available_locales(),
        default_locale: engine.default_locale().to_string(),
    }
}

/// Generate a `<script>` tag that injects the translation payload into
/// `window.__I18N__` for client-side hydration.
///
/// ```html
/// <script id="__I18N_DATA__">
///   window.__I18N__ = { locale: "en", translations: { … }, ... };
/// </script>
/// ```
pub fn render_hydration_script(payload: &SsrTranslationPayload) -> String {
    let json = serde_json::to_string(payload).unwrap_or_else(|_| "{}".into());
    format!(
        r#"<script id="__I18N_DATA__">window.__I18N__={};</script>"#,
        json
    )
}

/// Generate the HTML `lang` and `dir` attributes for the `<html>` tag.
///
/// Returns e.g. `lang="en" dir="ltr"` or `lang="ar" dir="rtl"`.
pub fn html_lang_attributes(locale_tag: &str) -> String {
    let dir = if is_rtl(locale_tag) { "rtl" } else { "ltr" };
    format!(r#"lang="{locale_tag}" dir="{dir}""#)
}

/// Determine whether a locale is right-to-left.
fn is_rtl(locale_tag: &str) -> bool {
    let base = locale_tag.split('-').next().unwrap_or(locale_tag);
    matches!(
        base,
        "ar" | "he" | "fa" | "ur" | "ps" | "sd" | "yi" | "dv" | "ku" | "ug"
    )
}

/// Inject SSR translations into a raw HTML string.
///
/// Looks for `</head>` and inserts the hydration script just before it.
/// Also patches the `<html` tag with the correct `lang` and `dir` attrs.
pub fn inject_ssr_translations(html: &str, engine: &I18nEngine, opts: &SsrOptions) -> String {
    let payload = build_ssr_payload(engine, opts);
    let script = render_hydration_script(&payload);
    let lang_attrs = html_lang_attributes(&opts.locale);

    let mut result = html.to_string();

    // Inject lang/dir on <html> tag
    if let Some(pos) = result.find("<html") {
        if let Some(end) = result[pos..].find('>') {
            let tag_end = pos + end;
            // Check if there's already a lang attribute
            let tag_content = &result[pos..tag_end];
            if !tag_content.contains("lang=") {
                result.insert_str(pos + 5, &format!(" {lang_attrs}"));
            }
        }
    }

    // Inject script before </head>
    if let Some(pos) = result.find("</head>") {
        result.insert_str(pos, &script);
    } else {
        // No </head> — append script at the end
        result.push_str(&script);
    }

    result
}

/// Pre-render a set of translation keys into static strings.
///
/// Useful for email templates, PDF generation, or any non-interactive
/// rendering where you need translated strings without the engine.
pub fn prerender_keys(
    engine: &I18nEngine,
    locale_tag: &str,
    keys: &[&str],
    vars: &HashMap<String, String>,
) -> HashMap<String, String> {
    keys.iter()
        .map(|&key| {
            let translated = engine.t(locale_tag, key, vars);
            (key.to_string(), translated)
        })
        .collect()
}

/// Build a compact JSON bundle containing only the keys that the frontend
/// actually uses.  Pass in the list of keys observed during SSR.
pub fn build_minimal_bundle(
    engine: &I18nEngine,
    locale_tag: &str,
    used_keys: &[String],
) -> serde_json::Value {
    let bundle = match engine.bundle(locale_tag) {
        Some(b) => b,
        None => return serde_json::Value::Object(serde_json::Map::new()),
    };

    let filtered: FlatMap = used_keys
        .iter()
        .filter_map(|k| bundle.get(k).map(|v| (k.clone(), v.clone())))
        .collect();

    loader::unflatten(&filtered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::I18nEngine;
    use std::collections::HashMap;

    fn test_engine() -> I18nEngine {
        let engine = I18nEngine::new_empty("en");
        let mut en = HashMap::new();
        en.insert("app.title".into(), "Test App".into());
        en.insert("greeting".into(), "Hello {{name}}".into());
        engine.add_translations("en", en);

        let mut de = HashMap::new();
        de.insert("app.title".into(), "Test App DE".into());
        engine.add_translations("de", de);

        engine
    }

    #[test]
    fn ssr_payload() {
        let engine = test_engine();
        let opts = SsrOptions {
            locale: "de".into(),
            namespace: None,
            include_fallback: true,
        };
        let payload = build_ssr_payload(&engine, &opts);
        assert_eq!(payload.locale, "de");
        assert_eq!(payload.default_locale, "en");
        // de overrides app.title
        let title = payload
            .translations
            .pointer("/app/title")
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(title, "Test App DE");
        // fallback greeting from en
        let greeting = payload
            .translations
            .pointer("/greeting")
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(greeting, "Hello {{name}}");
    }

    #[test]
    fn hydration_script() {
        let payload = SsrTranslationPayload {
            locale: "en".into(),
            translations: serde_json::json!({"a": "b"}),
            available_locales: vec!["en".into()],
            default_locale: "en".into(),
        };
        let script = render_hydration_script(&payload);
        assert!(script.contains("window.__I18N__"));
        assert!(script.contains("__I18N_DATA__"));
    }

    #[test]
    fn html_injection() {
        let engine = test_engine();
        let html = r#"<html><head><title>Test</title></head><body></body></html>"#;
        let opts = SsrOptions {
            locale: "en".into(),
            ..Default::default()
        };
        let result = inject_ssr_translations(html, &engine, &opts);
        assert!(result.contains(r#"lang="en" dir="ltr""#));
        assert!(result.contains("window.__I18N__"));
    }

    #[test]
    fn rtl_detection() {
        assert_eq!(html_lang_attributes("ar"), r#"lang="ar" dir="rtl""#);
        assert_eq!(html_lang_attributes("en"), r#"lang="en" dir="ltr""#);
    }

    #[test]
    fn prerender() {
        let engine = test_engine();
        let mut vars = HashMap::new();
        vars.insert("name".into(), "World".into());
        let rendered = prerender_keys(&engine, "en", &["greeting", "app.title"], &vars);
        assert_eq!(rendered["greeting"], "Hello World");
        assert_eq!(rendered["app.title"], "Test App");
    }
}
