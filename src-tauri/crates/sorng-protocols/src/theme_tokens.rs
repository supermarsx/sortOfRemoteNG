//! Theme tokens forwarded from the frontend so proxy-served pages
//! (themed errors, themed auth, themed status) match the app's
//! current theme (P7).
//!
//! Pre-P7 the themed pages hardcoded the dark palette (with a
//! `prefers-color-scheme: light` fallback). That ignored:
//! - the user's explicit theme choice (dark / light / system)
//! - the user's colour-scheme picker (blue / purple / etc.)
//! - any runtime overrides applied by `themeManager.ts`
//!
//! P7 has the frontend snapshot the live `:root` CSS variables at
//! proxy-startup time and ship them in `BasicAuthProxyConfig`. The
//! backend stores them in `AxumProxyState` and interpolates them
//! into the `<style>` block of every themed page. A separate IPC
//! command lets the frontend push updates mid-session when the user
//! changes themes.
//!
//! The struct is intentionally minimal — only the tokens the themed
//! pages actually reference. Adding a new render-only colour means
//! extending here, the frontend `readCurrentThemeTokens` helper, and
//! the CSS block below.

use serde::{Deserialize, Serialize};

/// Snapshot of the frontend's `:root { --color-* }` variables. Hex
/// fields are strict hex CSS colors (`#3b82f6` form); `_rgb` fields
/// are comma- or space-separated byte triplets (`59, 130, 246`) for
/// alpha blending in the page's CSS.
///
/// Every field is a `String` because we receive them as
/// `getPropertyValue('--color-X')` output. Treat those values as
/// untrusted: imported themes can influence them, and they are later
/// embedded in proxy-served `<style>` blocks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeTokens {
    pub background: String,
    pub surface: String,
    pub text: String,
    pub text_secondary: String,
    pub text_muted: String,
    pub border: String,
    pub primary: String,
    pub primary_rgb: String,
    pub error: String,
    pub error_rgb: String,
    pub warning: String,
    pub warning_rgb: String,
    pub success: String,
    pub success_rgb: String,
    pub info: String,
    pub info_rgb: String,
}

impl ThemeTokens {
    /// Dark-theme defaults, matching `themeManager.ts:22-36` (the app's
    /// "dark" base palette). Used as a fallback if the frontend doesn't
    /// provide a snapshot — e.g. an older client or a unit test that
    /// builds an `AxumProxyState` directly.
    pub fn dark_default() -> Self {
        Self {
            background: "#111827".into(),
            surface: "#1f2937".into(),
            text: "#f9fafb".into(),
            text_secondary: "#d1d5db".into(),
            text_muted: "#9ca3af".into(),
            border: "#374151".into(),
            primary: "#3b82f6".into(),
            primary_rgb: "59, 130, 246".into(),
            error: "#ef4444".into(),
            error_rgb: "239, 68, 68".into(),
            warning: "#f59e0b".into(),
            warning_rgb: "245, 158, 11".into(),
            success: "#10b981".into(),
            success_rgb: "16, 185, 129".into(),
            info: "#06b6d4".into(),
            info_rgb: "6, 182, 212".into(),
        }
    }

    /// Return a copy where any malformed token is replaced by the
    /// corresponding dark-default value. This keeps untrusted theme
    /// snapshots from injecting arbitrary CSS/HTML into proxy pages.
    pub fn sanitized(&self) -> Self {
        let defaults = Self::dark_default();
        Self {
            background: sanitize_hex_color(&self.background, &defaults.background),
            surface: sanitize_hex_color(&self.surface, &defaults.surface),
            text: sanitize_hex_color(&self.text, &defaults.text),
            text_secondary: sanitize_hex_color(&self.text_secondary, &defaults.text_secondary),
            text_muted: sanitize_hex_color(&self.text_muted, &defaults.text_muted),
            border: sanitize_hex_color(&self.border, &defaults.border),
            primary: sanitize_hex_color(&self.primary, &defaults.primary),
            primary_rgb: sanitize_rgb_triplet(&self.primary_rgb, &defaults.primary_rgb),
            error: sanitize_hex_color(&self.error, &defaults.error),
            error_rgb: sanitize_rgb_triplet(&self.error_rgb, &defaults.error_rgb),
            warning: sanitize_hex_color(&self.warning, &defaults.warning),
            warning_rgb: sanitize_rgb_triplet(&self.warning_rgb, &defaults.warning_rgb),
            success: sanitize_hex_color(&self.success, &defaults.success),
            success_rgb: sanitize_rgb_triplet(&self.success_rgb, &defaults.success_rgb),
            info: sanitize_hex_color(&self.info, &defaults.info),
            info_rgb: sanitize_rgb_triplet(&self.info_rgb, &defaults.info_rgb),
        }
    }

    /// Emit a `:root { --proxy-*: ... }` CSS block for inclusion at
    /// the top of a themed page's `<style>`. The prefix on every name
    /// (`--proxy-...`) is intentional: it keeps these variables
    /// distinct from the app's own `--color-*` so even if an iframe
    /// some day loads a page with both, names don't collide.
    pub fn css_block(&self) -> String {
        let safe = self.sanitized();
        format!(
            r##":root {{
  --proxy-bg: {bg};
  --proxy-surface: {surface};
  --proxy-text: {text};
  --proxy-text-2: {text2};
  --proxy-muted: {muted};
  --proxy-border: {border};
  --proxy-primary: {primary};
  --proxy-primary-rgb: {primary_rgb};
  --proxy-error: {error};
  --proxy-error-rgb: {error_rgb};
  --proxy-warning: {warning};
  --proxy-warning-rgb: {warning_rgb};
  --proxy-success: {success};
  --proxy-success-rgb: {success_rgb};
  --proxy-info: {info};
  --proxy-info-rgb: {info_rgb};
}}"##,
            bg = safe.background,
            surface = safe.surface,
            text = safe.text,
            text2 = safe.text_secondary,
            muted = safe.text_muted,
            border = safe.border,
            primary = safe.primary,
            primary_rgb = safe.primary_rgb,
            error = safe.error,
            error_rgb = safe.error_rgb,
            warning = safe.warning,
            warning_rgb = safe.warning_rgb,
            success = safe.success,
            success_rgb = safe.success_rgb,
            info = safe.info,
            info_rgb = safe.info_rgb,
        )
    }

    /// Pick the (rgb, hex) pair for an error-tone accent (red).
    pub fn error_pair(&self) -> (&str, &str) {
        (
            rgb_or_default(&self.error_rgb, DEFAULT_ERROR_RGB),
            hex_or_default(&self.error, DEFAULT_ERROR),
        )
    }

    /// Pick the (rgb, hex) pair for a warning-tone accent (yellow).
    pub fn warning_pair(&self) -> (&str, &str) {
        (
            rgb_or_default(&self.warning_rgb, DEFAULT_WARNING_RGB),
            hex_or_default(&self.warning, DEFAULT_WARNING),
        )
    }

    /// Pick the (rgb, hex) pair for an info-tone accent (sky blue).
    pub fn info_pair(&self) -> (&str, &str) {
        (
            rgb_or_default(&self.info_rgb, DEFAULT_INFO_RGB),
            hex_or_default(&self.info, DEFAULT_INFO),
        )
    }

    /// Pick the (rgb, hex) pair for the primary brand accent — used
    /// by the auth challenge form's button and focus rings.
    pub fn primary_pair(&self) -> (&str, &str) {
        (
            rgb_or_default(&self.primary_rgb, DEFAULT_PRIMARY_RGB),
            hex_or_default(&self.primary, DEFAULT_PRIMARY),
        )
    }
}

const DEFAULT_PRIMARY: &str = "#3b82f6";
const DEFAULT_PRIMARY_RGB: &str = "59, 130, 246";
const DEFAULT_ERROR: &str = "#ef4444";
const DEFAULT_ERROR_RGB: &str = "239, 68, 68";
const DEFAULT_WARNING: &str = "#f59e0b";
const DEFAULT_WARNING_RGB: &str = "245, 158, 11";
const DEFAULT_INFO: &str = "#06b6d4";
const DEFAULT_INFO_RGB: &str = "6, 182, 212";

fn sanitize_hex_color(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if is_hex_color(trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn sanitize_rgb_triplet(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if is_rgb_triplet(trimmed) {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

fn hex_or_default<'a>(value: &'a str, fallback: &'static str) -> &'a str {
    let trimmed = value.trim();
    if is_hex_color(trimmed) {
        trimmed
    } else {
        fallback
    }
}

fn rgb_or_default<'a>(value: &'a str, fallback: &'static str) -> &'a str {
    let trimmed = value.trim();
    if is_rgb_triplet(trimmed) {
        trimmed
    } else {
        fallback
    }
}

fn is_hex_color(value: &str) -> bool {
    let hex = match value.strip_prefix('#') {
        Some(hex) => hex,
        None => return false,
    };
    matches!(hex.len(), 3 | 6) && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_rgb_triplet(value: &str) -> bool {
    let parts: Vec<&str> = if value.contains(',') {
        value.split(',').collect()
    } else {
        value.split_whitespace().collect()
    };
    parts.len() == 3
        && parts.iter().all(|part| {
            let part = part.trim();
            !part.is_empty() && part.parse::<u8>().is_ok()
        })
}

impl Default for ThemeTokens {
    fn default() -> Self {
        Self::dark_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dark_default_has_expected_text_token() {
        let t = ThemeTokens::dark_default();
        assert_eq!(t.text, "#f9fafb");
        assert_eq!(t.background, "#111827");
    }

    #[test]
    fn css_block_contains_every_token() {
        let t = ThemeTokens::dark_default();
        let css = t.css_block();
        assert!(css.contains("--proxy-bg: #111827"));
        assert!(css.contains("--proxy-surface: #1f2937"));
        assert!(css.contains("--proxy-text: #f9fafb"));
        assert!(css.contains("--proxy-primary: #3b82f6"));
        assert!(css.contains("--proxy-error: #ef4444"));
        assert!(css.contains("--proxy-warning: #f59e0b"));
        assert!(css.contains("--proxy-info: #06b6d4"));
        assert!(css.contains("--proxy-primary-rgb: 59, 130, 246"));
        assert!(css.contains("--proxy-error-rgb: 239, 68, 68"));
    }

    #[test]
    fn css_block_replaces_malicious_tokens_with_defaults() {
        let mut t = ThemeTokens::dark_default();
        t.background = "</style><script>alert(1)</script><style>".into();
        t.primary_rgb = "1, 2, 3);}</style><script>alert(1)</script><style>".into();
        t.error = "red".into();

        let css = t.css_block();

        assert!(!css.contains("</style>"));
        assert!(!css.contains("<script"));
        assert!(css.contains("--proxy-bg: #111827"));
        assert!(css.contains("--proxy-primary-rgb: 59, 130, 246"));
        assert!(css.contains("--proxy-error: #ef4444"));
    }

    #[test]
    fn sanitized_preserves_valid_hex_and_rgb_triplets() {
        let mut t = ThemeTokens::dark_default();
        t.background = " #abc ".into();
        t.primary = "#abcdef".into();
        t.primary_rgb = "1 2 3".into();
        t.error_rgb = "4, 5, 6".into();

        let safe = t.sanitized();

        assert_eq!(safe.background, "#abc");
        assert_eq!(safe.primary, "#abcdef");
        assert_eq!(safe.primary_rgb, "1 2 3");
        assert_eq!(safe.error_rgb, "4, 5, 6");
    }

    #[test]
    fn tone_pairs_match_token_fields() {
        let t = ThemeTokens::dark_default();
        let (rgb, hex) = t.error_pair();
        assert_eq!(rgb, "239, 68, 68");
        assert_eq!(hex, "#ef4444");
        let (rgb, hex) = t.warning_pair();
        assert_eq!(hex, "#f59e0b");
        assert_eq!(rgb, "245, 158, 11");
    }

    #[test]
    fn round_trip_serde_camel_case() {
        let t = ThemeTokens {
            background: "#abcdef".into(),
            surface: "#fedcba".into(),
            text: "#000000".into(),
            text_secondary: "#111111".into(),
            text_muted: "#222222".into(),
            border: "#333333".into(),
            primary: "#444444".into(),
            primary_rgb: "1, 2, 3".into(),
            error: "#555555".into(),
            error_rgb: "4, 5, 6".into(),
            warning: "#666666".into(),
            warning_rgb: "7, 8, 9".into(),
            success: "#777777".into(),
            success_rgb: "10, 11, 12".into(),
            info: "#888888".into(),
            info_rgb: "13, 14, 15".into(),
        };
        let json = serde_json::to_string(&t).unwrap();
        // Field names must be camelCase on the wire so the
        // frontend can emit them directly without conversion.
        assert!(json.contains(r#""textSecondary""#));
        assert!(json.contains(r#""primaryRgb""#));
        let back: ThemeTokens = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }
}
