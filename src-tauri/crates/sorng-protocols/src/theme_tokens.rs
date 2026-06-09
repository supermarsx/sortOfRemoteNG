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
/// fields are the literal CSS value (`#3b82f6` form); `_rgb` fields
/// are space-separated triplets (`59 130 246`) for `rgba(..., a)`
/// blending in the page's CSS.
///
/// Every field is a `String` because we receive them as
/// `getPropertyValue('--color-X')` output — trimmed but otherwise
/// untouched. We don't parse them backend-side; the page CSS is the
/// only consumer and CSS itself validates.
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

    /// Emit a `:root { --proxy-*: ... }` CSS block for inclusion at
    /// the top of a themed page's `<style>`. The prefix on every name
    /// (`--proxy-...`) is intentional: it keeps these variables
    /// distinct from the app's own `--color-*` so even if an iframe
    /// some day loads a page with both, names don't collide.
    pub fn css_block(&self) -> String {
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
            bg = self.background,
            surface = self.surface,
            text = self.text,
            text2 = self.text_secondary,
            muted = self.text_muted,
            border = self.border,
            primary = self.primary,
            primary_rgb = self.primary_rgb,
            error = self.error,
            error_rgb = self.error_rgb,
            warning = self.warning,
            warning_rgb = self.warning_rgb,
            success = self.success,
            success_rgb = self.success_rgb,
            info = self.info,
            info_rgb = self.info_rgb,
        )
    }

    /// Pick the (rgb, hex) pair for an error-tone accent (red).
    pub fn error_pair(&self) -> (&str, &str) {
        (self.error_rgb.as_str(), self.error.as_str())
    }

    /// Pick the (rgb, hex) pair for a warning-tone accent (yellow).
    pub fn warning_pair(&self) -> (&str, &str) {
        (self.warning_rgb.as_str(), self.warning.as_str())
    }

    /// Pick the (rgb, hex) pair for an info-tone accent (sky blue).
    pub fn info_pair(&self) -> (&str, &str) {
        (self.info_rgb.as_str(), self.info.as_str())
    }

    /// Pick the (rgb, hex) pair for the primary brand accent — used
    /// by the auth challenge form's button and focus rings.
    pub fn primary_pair(&self) -> (&str, &str) {
        (self.primary_rgb.as_str(), self.primary.as_str())
    }
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
