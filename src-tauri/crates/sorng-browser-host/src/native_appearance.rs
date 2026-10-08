//! Closed non-secret appearance data. No network/resource-producing CSS.
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

pub const REQUEST: &str = "sorng.native.appearance.apply.v1";
pub const STATUS: &str = "sorng.native.appearance.status.v1";
pub const MAX_JSON: usize = 32 * 1024;
pub const DEFAULT_JSON: &str = r##"{"enabled":true,"theme":{"followAppTheme":true,"mode":"dynamic","brightness":100,"contrast":100,"sepia":0,"grayscale":0,"backgroundColor":"#181a1b","textColor":"#e8e6e3","preserveMedia":true,"customCss":""}}"##;

pub fn valid_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}
fn color<'de, D: serde::Deserializer<'de>>(decoder: D) -> Result<String, D::Error> {
    let value = String::deserialize(decoder)?;
    if !valid_color(&value) {
        return Err(serde::de::Error::custom("Expected six-digit hex color"));
    }
    Ok(value.to_ascii_lowercase())
}
fn yes() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppPalette {
    #[serde(deserialize_with = "color")]
    pub background_color: String,
    #[serde(deserialize_with = "color")]
    pub text_color: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearanceTheme {
    #[serde(default = "yes")]
    pub follow_app_theme: bool,
    pub mode: String,
    pub brightness: f64,
    pub contrast: f64,
    pub sepia: f64,
    pub grayscale: f64,
    #[serde(deserialize_with = "color")]
    pub background_color: String,
    #[serde(deserialize_with = "color")]
    pub text_color: String,
    pub preserve_media: bool,
    pub custom_css: String,
}

impl Default for AppearanceTheme {
    fn default() -> Self {
        Self {
            follow_app_theme: true,
            mode: "dynamic".into(),
            brightness: 100.,
            contrast: 100.,
            sepia: 0.,
            grayscale: 0.,
            background_color: "#181a1b".into(),
            text_color: "#e8e6e3".into(),
            preserve_media: true,
            custom_css: String::new(),
        }
    }
}

pub fn valid_css(css: &str) -> bool {
    static FUNCTIONS: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\(").unwrap());
    static EXECUTABLE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"(?i)(?:^|[;{\s])(?:behavior|-moz-binding)\s*:").unwrap()
    });
    css.len() <= 16_384
        && !css.contains(['@', '\\', '<'])
        && !css.contains("/*")
        && !css.contains("*/")
        && !css
            .chars()
            .any(|c| (c < ' ' && !matches!(c, '\t' | '\n' | '\r')) || c == '\u{7f}')
        && !EXECUTABLE.is_match(css)
        && FUNCTIONS.captures_iter(css).all(|m| {
            matches!(
                m[1].to_ascii_lowercase().as_str(),
                "rgb"
                    | "rgba"
                    | "hsl"
                    | "hsla"
                    | "hwb"
                    | "lab"
                    | "lch"
                    | "oklab"
                    | "oklch"
                    | "color"
                    | "color-mix"
                    | "calc"
                    | "min"
                    | "max"
                    | "clamp"
                    | "is"
                    | "where"
                    | "not"
                    | "nth-child"
                    | "nth-last-child"
                    | "nth-of-type"
                    | "nth-last-of-type"
                    | "linear-gradient"
                    | "radial-gradient"
                    | "conic-gradient"
                    | "repeating-linear-gradient"
                    | "repeating-radial-gradient"
                    | "repeating-conic-gradient"
            )
        })
}
impl AppearanceTheme {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !matches!(
            self.mode.as_str(),
            "dynamic" | "filter" | "dynamicFilter" | "customCss"
        ) || ![
            (self.brightness, 200.),
            (self.contrast, 200.),
            (self.sepia, 100.),
            (self.grayscale, 100.),
        ]
        .into_iter()
        .all(|(n, max)| n.is_finite() && n >= 0. && n <= max)
            || !valid_color(&self.background_color)
            || !valid_color(&self.text_color)
            || !valid_css(&self.custom_css)
        {
            return Err("Invalid native website appearance.");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearanceConfig {
    pub enabled: bool,
    pub theme: AppearanceTheme,
}
impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            theme: AppearanceTheme::default(),
        }
    }
}
impl AppearanceConfig {
    /// The saved extension master permission is immutable for this attempt.
    /// Its native-only route must never claim that a website client was applied.
    pub fn native_only_status(&self, extensions_enabled: bool) -> Option<AppearanceStatus> {
        (!extensions_enabled).then_some(if self.enabled {
            AppearanceStatus::Fallback
        } else {
            AppearanceStatus::Off
        })
    }

    pub fn with_palette(&self, palette: Option<&AppPalette>) -> Result<Self, &'static str> {
        self.theme.validate()?;
        let mut result = self.clone();
        if let Some(palette) = palette {
            if !valid_color(&palette.background_color) || !valid_color(&palette.text_color) {
                return Err("Invalid app palette.");
            }
            if result.theme.follow_app_theme {
                result.theme.background_color = palette.background_color.to_ascii_lowercase();
                result.theme.text_color = palette.text_color.to_ascii_lowercase();
            }
        }
        Ok(result)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppearanceStatus {
    Applied,
    Off,
    Fallback,
}
impl AppearanceStatus {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "applied" => Some(Self::Applied),
            "off" => Some(Self::Off),
            "fallback" => Some(Self::Fallback),
            _ => None,
        }
    }
}

/// Appearance is local presentation only. Unlike credential delivery it is
/// safe on ordinary HTTP pages as well as HTTPS and inert bootstrap documents.
pub fn eligible_document(value: &str) -> bool {
    if matches!(value, "about:blank" | "about:srcdoc") {
        return true;
    }
    if value.len() > 16_384 || value.contains('\\') || value.chars().any(char::is_control) {
        return false;
    }
    url::Url::parse(value).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
    })
}

#[cfg(feature = "cef-host")]
pub(crate) mod wire {
    use super::*;
    use cef::*;
    fn text(row: &DictionaryValue, key: &str, max: usize) -> Option<String> {
        let key = CefString::from(key);
        if row.get_type(Some(&key)) != ValueType::STRING {
            return None;
        }
        let value = CefString::from(&row.string(Some(&key)));
        // Pinned CEF represents a valid empty string with as_slice() == None.
        // The type check above still rejects missing/null/non-string fields.
        if value.as_slice().is_some_and(|v| v.len() > max) {
            return None;
        }
        let value = value.to_string();
        (value.len() <= max).then_some(value)
    }
    fn boolean(row: &DictionaryValue, key: &str) -> Option<bool> {
        let key = CefString::from(key);
        (row.get_type(Some(&key)) == ValueType::BOOL).then(|| row.bool(Some(&key)) == 1)
    }
    fn number(row: &DictionaryValue, key: &str) -> Option<f64> {
        let key = CefString::from(key);
        match row.get_type(Some(&key)) {
            ValueType::INT => Some(row.int(Some(&key)) as f64),
            ValueType::DOUBLE => Some(row.double(Some(&key))),
            _ => None,
        }
    }
    pub(crate) fn parse(json: &str) -> Option<(AppearanceConfig, Value)> {
        if json.len() > MAX_JSON {
            return None;
        }
        let value = parse_json(Some(&CefString::from(json)), JsonParserOptions::RFC)?;
        let root = value.dictionary()?;
        if root.size() != 2 {
            return None;
        }
        let row = root.dictionary(Some(&CefString::from("theme")))?;
        let mut keys = CefStringList::new();
        if row.keys(Some(&mut keys)) != 1
            || keys.into_iter().any(|key| {
                !matches!(
                    key.as_str(),
                    "followAppTheme"
                        | "mode"
                        | "brightness"
                        | "contrast"
                        | "sepia"
                        | "grayscale"
                        | "backgroundColor"
                        | "textColor"
                        | "preserveMedia"
                        | "customCss"
                )
            })
        {
            return None;
        }
        let config = AppearanceConfig {
            enabled: boolean(&root, "enabled")?,
            theme: AppearanceTheme {
                follow_app_theme: if row.has_key(Some(&CefString::from("followAppTheme"))) == 1 {
                    boolean(&row, "followAppTheme")?
                } else {
                    true
                },
                mode: text(&row, "mode", 32)?,
                brightness: number(&row, "brightness")?,
                contrast: number(&row, "contrast")?,
                sepia: number(&row, "sepia")?,
                grayscale: number(&row, "grayscale")?,
                background_color: text(&row, "backgroundColor", 7)?,
                text_color: text(&row, "textColor", 7)?,
                preserve_media: boolean(&row, "preserveMedia")?,
                custom_css: text(&row, "customCss", 16_384)?,
            },
        };
        config.theme.validate().ok()?;
        Some((config, value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colors_cannot_be_css_or_resource_locations() {
        for value in [
            "#fff",
            "red",
            "#112233;",
            "url(https://fixture.invalid)",
            "#１２３",
        ] {
            assert!(!valid_color(value));
        }
        assert!(valid_color("#Ab09Ef"));
    }
    #[test]
    fn css_matches_local_only_boundary() {
        assert!(valid_css(
            "body:is(.panel){color:rgb(1,2,3);width:calc(100% - 2px)}"
        ));
        for css in [
            "@import 'x';",
            "a{background:url(x)}",
            "a{color:var(--x)}",
            "a{content:attr(x)}",
            "a{behavior:x}",
            "/*x*/a{}",
            "a{color:r\\65 d}",
            "</style>",
        ] {
            assert!(!valid_css(css));
        }
        assert!(!valid_css(&"x".repeat(16_385)));
    }
    #[test]
    fn palette_never_changes_consent_or_nonfollowing_preset() {
        let palette = AppPalette {
            background_color: "#123456".into(),
            text_color: "#abcdef".into(),
        };
        let mut config = AppearanceConfig::default();
        config.enabled = false;
        let applied = config.with_palette(Some(&palette)).unwrap();
        assert!(!applied.enabled);
        assert_eq!(applied.theme.background_color, "#123456");
        config.theme.follow_app_theme = false;
        assert_eq!(config.with_palette(Some(&palette)).unwrap(), config);
    }
    #[test]
    fn numeric_modes_and_css_are_bounded_for_direct_native_values() {
        let mut config = AppearanceConfig::default();
        config.theme.brightness = f64::NAN;
        assert!(config.with_palette(None).is_err());
        config.theme.brightness = 201.;
        assert!(config.with_palette(None).is_err());
        config.theme.brightness = 100.;
        config.theme.mode = "script".into();
        assert!(config.with_palette(None).is_err());
    }

    #[test]
    fn master_disabled_uses_only_native_fallback_or_off() {
        let mut config = AppearanceConfig::default();
        assert_eq!(
            config.native_only_status(false),
            Some(AppearanceStatus::Fallback)
        );
        assert_eq!(config.native_only_status(true), None);
        config.enabled = false;
        assert_eq!(
            config.native_only_status(false),
            Some(AppearanceStatus::Off)
        );
        assert_eq!(config.native_only_status(true), None);
    }

    #[test]
    fn appearance_supports_http_without_widening_credential_origin_policy() {
        for value in [
            "http://fixture.invalid/",
            "https://fixture.invalid/",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(eligible_document(value));
        }
        for value in [
            "file:///private",
            "data:text/html,x",
            "javascript:alert(1)",
            "https://u:p@fixture.invalid/",
            "http://fixture.invalid/\n",
        ] {
            assert!(!eligible_document(value));
        }
    }
}
