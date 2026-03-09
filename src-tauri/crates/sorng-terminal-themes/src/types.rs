use serde::{Deserialize, Serialize};

/// A complete terminal theme with all color slots, font options, and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalTheme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub category: ThemeCategory,
    pub is_dark: bool,
    pub is_builtin: bool,

    // ─── Core colors ─────────────────────────────────────
    pub foreground: String,
    pub background: String,
    pub cursor: String,
    pub cursor_accent: Option<String>,
    pub selection_background: String,
    pub selection_foreground: Option<String>,
    pub selection_inactive_background: Option<String>,

    // ─── ANSI standard 16 colors ─────────────────────────
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,

    // ─── Extended colors (optional) ──────────────────────
    pub ansi_256: Option<Vec<String>>,

    // ─── Terminal chrome ─────────────────────────────────
    pub scrollbar_thumb: Option<String>,
    pub scrollbar_track: Option<String>,
    pub tab_active_background: Option<String>,
    pub tab_active_foreground: Option<String>,
    pub tab_inactive_background: Option<String>,
    pub tab_inactive_foreground: Option<String>,
    pub border_color: Option<String>,
    pub find_match_background: Option<String>,
    pub find_match_highlight_background: Option<String>,

    // ─── Font overrides (per-theme) ──────────────────────
    pub font_family: Option<String>,
    pub font_size: Option<f64>,
    pub font_weight: Option<String>,
    pub font_weight_bold: Option<String>,
    pub line_height: Option<f64>,
    pub letter_spacing: Option<f64>,

    // ─── Terminal behavior ───────────────────────────────
    pub cursor_style: Option<CursorStyle>,
    pub cursor_blink: Option<bool>,
    pub scrollback: Option<u32>,
    pub minimum_contrast_ratio: Option<f64>,

    // ─── Tags for search & filtering ─────────────────────
    pub tags: Vec<String>,
}

impl TerminalTheme {
    /// Convert to an xterm.js-compatible JSON object.
    pub fn to_xterm_theme(&self) -> serde_json::Value {
        let mut theme = serde_json::json!({
            "foreground": self.foreground,
            "background": self.background,
            "cursor": self.cursor,
            "selectionBackground": self.selection_background,
            "black": self.black,
            "red": self.red,
            "green": self.green,
            "yellow": self.yellow,
            "blue": self.blue,
            "magenta": self.magenta,
            "cyan": self.cyan,
            "white": self.white,
            "brightBlack": self.bright_black,
            "brightRed": self.bright_red,
            "brightGreen": self.bright_green,
            "brightYellow": self.bright_yellow,
            "brightBlue": self.bright_blue,
            "brightMagenta": self.bright_magenta,
            "brightCyan": self.bright_cyan,
            "brightWhite": self.bright_white,
        });

        if let Some(ref ca) = self.cursor_accent {
            theme["cursorAccent"] = serde_json::Value::String(ca.clone());
        }
        if let Some(ref sf) = self.selection_foreground {
            theme["selectionForeground"] = serde_json::Value::String(sf.clone());
        }
        if let Some(ref si) = self.selection_inactive_background {
            theme["selectionInactiveBackground"] = serde_json::Value::String(si.clone());
        }

        theme
    }

    /// Generate CSS custom properties from this theme.
    pub fn to_css_variables(&self, prefix: &str) -> String {
        let p = if prefix.is_empty() {
            "--terminal"
        } else {
            prefix
        };
        let mut lines: Vec<String> = Vec::new();
        lines.push(format!("{}-foreground: {};", p, self.foreground));
        lines.push(format!("{}-background: {};", p, self.background));
        lines.push(format!("{}-cursor: {};", p, self.cursor));
        lines.push(format!(
            "{}-selection-bg: {};",
            p, self.selection_background
        ));
        lines.push(format!("{}-black: {};", p, self.black));
        lines.push(format!("{}-red: {};", p, self.red));
        lines.push(format!("{}-green: {};", p, self.green));
        lines.push(format!("{}-yellow: {};", p, self.yellow));
        lines.push(format!("{}-blue: {};", p, self.blue));
        lines.push(format!("{}-magenta: {};", p, self.magenta));
        lines.push(format!("{}-cyan: {};", p, self.cyan));
        lines.push(format!("{}-white: {};", p, self.white));
        lines.push(format!("{}-bright-black: {};", p, self.bright_black));
        lines.push(format!("{}-bright-red: {};", p, self.bright_red));
        lines.push(format!("{}-bright-green: {};", p, self.bright_green));
        lines.push(format!("{}-bright-yellow: {};", p, self.bright_yellow));
        lines.push(format!("{}-bright-blue: {};", p, self.bright_blue));
        lines.push(format!("{}-bright-magenta: {};", p, self.bright_magenta));
        lines.push(format!("{}-bright-cyan: {};", p, self.bright_cyan));
        lines.push(format!("{}-bright-white: {};", p, self.bright_white));

        if let Some(ref border) = self.border_color {
            lines.push(format!("{}-border: {};", p, border));
        }

        lines.join("\n")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ThemeCategory {
    #[default]
    Dark,
    Light,
    HighContrast,
    Retro,
    Pastel,
    Monochrome,
    Nature,
    Synthwave,
    Holiday,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum CursorStyle {
    #[default]
    Block,
    Underline,
    Bar,
}

/// Lightweight summary for listing themes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeSummary {
    pub id: String,
    pub name: String,
    pub category: ThemeCategory,
    pub is_dark: bool,
    pub is_builtin: bool,
    pub author: String,
    pub foreground: String,
    pub background: String,
    pub tags: Vec<String>,
}

impl From<&TerminalTheme> for ThemeSummary {
    fn from(t: &TerminalTheme) -> Self {
        Self {
            id: t.id.clone(),
            name: t.name.clone(),
            category: t.category.clone(),
            is_dark: t.is_dark,
            is_builtin: t.is_builtin,
            author: t.author.clone(),
            foreground: t.foreground.clone(),
            background: t.background.clone(),
            tags: t.tags.clone(),
        }
    }
}

/// Theme error type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeError {
    pub code: String,
    pub message: String,
}

impl ThemeError {
    pub fn new(code: &str, msg: &str) -> Self {
        Self {
            code: code.to_string(),
            message: msg.to_string(),
        }
    }
    pub fn not_found(id: &str) -> Self {
        Self::new("NOT_FOUND", &format!("Theme '{}' not found", id))
    }
    pub fn invalid(msg: &str) -> Self {
        Self::new("INVALID", msg)
    }
    pub fn duplicate(id: &str) -> Self {
        Self::new("DUPLICATE", &format!("Theme '{}' already exists", id))
    }
}

impl std::fmt::Display for ThemeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for ThemeError {}
