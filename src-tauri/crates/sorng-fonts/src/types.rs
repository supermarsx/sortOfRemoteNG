use std::collections::HashMap;
use chrono::{DateTime, Utc};

// ═══════════════════════════════════════════════════════════════════════
//  Font category taxonomy
// ═══════════════════════════════════════════════════════════════════════

/// Top-level font category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontCategory {
    /// Monospace — for SSH terminals, code editors, log viewers.
    Monospace,
    /// Sans-serif — for app UI, menus, dialogs.
    SansSerif,
    /// Serif — for documentation, reading panes.
    Serif,
    /// Display / decorative — headers, branding.
    Display,
    /// System — platform-specific UI fonts.
    System,
}

impl Default for FontCategory {
    fn default() -> Self {
        Self::Monospace
    }
}

/// Sub-category giving finer classification (especially within Monospace).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontSubcategory {
    /// Classic terminal fonts (Consolas, Courier New, etc.)
    Terminal,
    /// Programming-oriented with ligatures (Fira Code, JetBrains Mono, etc.)
    CodingLigatures,
    /// Programming-oriented without ligatures
    CodingPlain,
    /// Nerd-font patched variants with glyphs
    NerdFont,
    /// Retro / pixel / bitmap-style
    Retro,
    /// General UI sans-serif
    UiGeneral,
    /// Humanist sans-serif (more readable body text)
    Humanist,
    /// Geometric sans-serif
    Geometric,
    /// Traditional serif
    TraditionalSerif,
    /// Slab serif
    SlabSerif,
    /// Platform native
    PlatformNative,
}

// ═══════════════════════════════════════════════════════════════════════
//  Font metadata — the core data for each known font
// ═══════════════════════════════════════════════════════════════════════

/// Complete metadata for a single font family.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetadata {
    /// Unique identifier (kebab-case, e.g. "fira-code").
    pub id: String,
    /// Human-readable name (e.g. "Fira Code").
    pub name: String,
    /// CSS `font-family` value including quotes if needed.
    pub css_family: String,
    /// Primary category.
    pub category: FontCategory,
    /// Optional sub-category.
    #[serde(default)]
    pub subcategory: Option<FontSubcategory>,
    /// Whether the font supports programming ligatures.
    #[serde(default)]
    pub ligatures: bool,
    /// Whether a Nerd Font patched variant exists.
    #[serde(default)]
    pub nerd_font_available: bool,
    /// Nerd Font CSS name (if different, e.g. "FiraCode Nerd Font").
    #[serde(default)]
    pub nerd_font_css: Option<String>,
    /// The Nerd Font install package name (for reference).
    #[serde(default)]
    pub nerd_font_package: Option<String>,
    /// Recommended font size for SSH terminals (px).
    #[serde(default = "default_terminal_size")]
    pub recommended_terminal_size: f64,
    /// Recommended line-height multiplier for SSH terminals.
    #[serde(default = "default_line_height")]
    pub recommended_line_height: f64,
    /// Recommended letter-spacing (px).
    #[serde(default)]
    pub recommended_letter_spacing: f64,
    /// Available font weights (CSS numeric values).
    #[serde(default = "default_weights")]
    pub available_weights: Vec<u16>,
    /// Whether italic style is available.
    #[serde(default = "default_true")]
    pub has_italic: bool,
    /// Whether variable-weight font is available.
    #[serde(default)]
    pub is_variable: bool,
    /// Platform availability.
    #[serde(default)]
    pub platforms: PlatformAvailability,
    /// Whether this font is typically pre-installed on common OSes.
    #[serde(default)]
    pub preinstalled: bool,
    /// Free / open-source.
    #[serde(default = "default_true")]
    pub is_free: bool,
    /// License identifier (e.g. "OFL-1.1", "Apache-2.0").
    #[serde(default)]
    pub license: Option<String>,
    /// URL to download / homepage.
    #[serde(default)]
    pub homepage_url: Option<String>,
    /// Short description / tagline.
    #[serde(default)]
    pub description: Option<String>,
    /// Searchable tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Year of first release (for "retro" vs "modern" sorting).
    #[serde(default)]
    pub year: Option<u16>,
    /// Popularity ranking (1 = most popular). Used for default sort.
    #[serde(default)]
    pub popularity_rank: Option<u16>,
}

fn default_terminal_size() -> f64 { 14.0 }
fn default_line_height() -> f64 { 1.2 }
fn default_weights() -> Vec<u16> { vec![400, 700] }
fn default_true() -> bool { true }

/// Platform availability flags.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAvailability {
    /// Pre-installed on Windows.
    #[serde(default)]
    pub windows: bool,
    /// Pre-installed on macOS.
    #[serde(default)]
    pub macos: bool,
    /// Pre-installed on common Linux distros.
    #[serde(default)]
    pub linux: bool,
    /// Available as a web font (Google Fonts, etc.).
    #[serde(default)]
    pub web_font: bool,
}

// ═══════════════════════════════════════════════════════════════════════
//  Font stacks — ordered fallback chains
// ═══════════════════════════════════════════════════════════════════════

/// A named, ordered fallback chain of font families.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontStack {
    /// Unique identifier (e.g. "ssh-default").
    pub id: String,
    /// Human label.
    pub name: String,
    /// Short description of when to use this stack.
    #[serde(default)]
    pub description: Option<String>,
    /// Ordered CSS family names (first = preferred).
    pub families: Vec<String>,
    /// The category this stack is designed for.
    pub target: FontStackTarget,
    /// Whether this is a built-in stack.
    #[serde(default)]
    pub is_builtin: bool,
}

impl FontStack {
    /// Render as a CSS `font-family` value.
    pub fn to_css(&self) -> String {
        self.families.iter().map(|f| {
            if f.contains(' ') && !f.starts_with('"') && !f.starts_with('\'') {
                format!("\"{}\"", f)
            } else {
                f.clone()
            }
        }).collect::<Vec<_>>().join(", ")
    }
}

/// What a font stack is designed for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontStackTarget {
    /// SSH terminal.
    SshTerminal,
    /// App UI (menus, dialogs, sidebars).
    AppUi,
    /// Code editor panes.
    CodeEditor,
    /// Tab bar / breadcrumbs.
    TabBar,
    /// Log viewer / output panels.
    LogViewer,
    /// Documentation / reading.
    Documentation,
    /// Custom / user-defined.
    Custom,
}

// ═══════════════════════════════════════════════════════════════════════
//  Font configuration — per-context preferences
// ═══════════════════════════════════════════════════════════════════════

/// Weight as either named or numeric.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum FontWeight {
    Named(FontWeightName),
    Numeric(u16),
}

impl Default for FontWeight {
    fn default() -> Self { Self::Named(FontWeightName::Normal) }
}

impl FontWeight {
    pub fn to_css(&self) -> String {
        match self {
            FontWeight::Named(n) => n.to_css().to_string(),
            FontWeight::Numeric(v) => v.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontWeightName {
    Thin,
    ExtraLight,
    Light,
    Normal,
    Medium,
    SemiBold,
    Bold,
    ExtraBold,
    Black,
}

impl FontWeightName {
    pub fn to_css(&self) -> &'static str {
        match self {
            Self::Thin => "100",
            Self::ExtraLight => "200",
            Self::Light => "300",
            Self::Normal => "400",
            Self::Medium => "500",
            Self::SemiBold => "600",
            Self::Bold => "700",
            Self::ExtraBold => "800",
            Self::Black => "900",
        }
    }

    pub fn to_numeric(&self) -> u16 {
        match self {
            Self::Thin => 100,
            Self::ExtraLight => 200,
            Self::Light => 300,
            Self::Normal => 400,
            Self::Medium => 500,
            Self::SemiBold => 600,
            Self::Bold => 700,
            Self::ExtraBold => 800,
            Self::Black => 900,
        }
    }
}

/// Font style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontStyle {
    #[default]
    Normal,
    Italic,
    Oblique,
}

impl FontStyle {
    pub fn to_css(&self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Italic => "italic",
            Self::Oblique => "oblique",
        }
    }
}

/// Text rendering hint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextRendering {
    #[default]
    Auto,
    OptimizeSpeed,
    OptimizeLegibility,
    GeometricPrecision,
}

/// Font smoothing / anti-aliasing mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontSmoothing {
    #[default]
    Auto,
    None,
    Antialiased,
    SubpixelAntialiased,
}

/// Complete font settings for a single context (e.g. SSH terminal).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontSettings {
    /// The primary font-family or stack ID to use.
    pub family: String,
    /// Font size in pixels.
    #[serde(default = "default_terminal_size")]
    pub size: f64,
    /// Font weight.
    #[serde(default)]
    pub weight: FontWeight,
    /// Bold weight (used for bold text in terminals).
    #[serde(default = "default_bold_weight")]
    pub bold_weight: FontWeight,
    /// Font style.
    #[serde(default)]
    pub style: FontStyle,
    /// Line height multiplier (e.g. 1.2).
    #[serde(default = "default_line_height")]
    pub line_height: f64,
    /// Letter spacing in pixels (can be negative).
    #[serde(default)]
    pub letter_spacing: f64,
    /// Whether to enable ligatures.
    #[serde(default)]
    pub ligatures_enabled: bool,
    /// Text rendering mode.
    #[serde(default)]
    pub text_rendering: TextRendering,
    /// Font smoothing / anti-aliasing.
    #[serde(default)]
    pub font_smoothing: FontSmoothing,
    /// Whether to use the Nerd Font variant if available.
    #[serde(default)]
    pub prefer_nerd_font: bool,
    /// Fallback families (appended after the primary).
    #[serde(default)]
    pub fallback_families: Vec<String>,
}

fn default_bold_weight() -> FontWeight {
    FontWeight::Named(FontWeightName::Bold)
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            family: "Cascadia Code".to_string(),
            size: 14.0,
            weight: FontWeight::default(),
            bold_weight: default_bold_weight(),
            style: FontStyle::default(),
            line_height: 1.2,
            letter_spacing: 0.0,
            ligatures_enabled: true,
            text_rendering: TextRendering::default(),
            font_smoothing: FontSmoothing::default(),
            prefer_nerd_font: false,
            fallback_families: vec![
                "Fira Code".to_string(),
                "Consolas".to_string(),
                "monospace".to_string(),
            ],
        }
    }
}

impl FontSettings {
    /// Render the full CSS `font-family` value including fallbacks.
    pub fn to_css_family(&self) -> String {
        let mut parts = vec![css_quote(&self.family)];
        for f in &self.fallback_families {
            parts.push(css_quote(f));
        }
        parts.join(", ")
    }
}

/// Quote a font family name for CSS if it contains spaces.
pub fn css_quote(name: &str) -> String {
    if name.contains(' ') && !name.starts_with('"') && !name.starts_with('\'') {
        format!("\"{}\"", name)
    } else {
        name.to_string()
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  App-wide font configuration
// ═══════════════════════════════════════════════════════════════════════

/// The full font configuration persisted to disk.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontConfiguration {
    /// SSH terminal font settings.
    #[serde(default)]
    pub ssh_terminal: FontSettings,
    /// Application UI font settings (menus, dialogs, sidebar).
    #[serde(default = "default_ui_settings")]
    pub app_ui: FontSettings,
    /// Code editor / script editor font settings.
    #[serde(default)]
    pub code_editor: FontSettings,
    /// Tab bar font settings.
    #[serde(default = "default_tab_settings")]
    pub tab_bar: FontSettings,
    /// Log viewer font settings.
    #[serde(default)]
    pub log_viewer: FontSettings,
    /// Per-connection font overrides (connection_id → FontSettings).
    #[serde(default)]
    pub connection_overrides: HashMap<String, FontSettings>,
    /// Custom font stacks created by the user.
    #[serde(default)]
    pub custom_stacks: Vec<FontStack>,
    /// Favourite font IDs (for quick access).
    #[serde(default)]
    pub favourites: Vec<String>,
    /// Recently used font IDs.
    #[serde(default)]
    pub recent_fonts: Vec<String>,
    /// Global setting: prefer Nerd Font variants when available.
    #[serde(default)]
    pub global_prefer_nerd_fonts: bool,
    /// Global setting: enable ligatures everywhere.
    #[serde(default = "default_true")]
    pub global_ligatures: bool,
}

fn default_ui_settings() -> FontSettings {
    FontSettings {
        family: "Inter".to_string(),
        size: 13.0,
        weight: FontWeight::default(),
        bold_weight: default_bold_weight(),
        style: FontStyle::default(),
        line_height: 1.5,
        letter_spacing: 0.0,
        ligatures_enabled: false,
        text_rendering: TextRendering::OptimizeLegibility,
        font_smoothing: FontSmoothing::Antialiased,
        prefer_nerd_font: false,
        fallback_families: vec![
            "system-ui".to_string(),
            "-apple-system".to_string(),
            "Segoe UI".to_string(),
            "Roboto".to_string(),
            "sans-serif".to_string(),
        ],
    }
}

fn default_tab_settings() -> FontSettings {
    FontSettings {
        family: "Inter".to_string(),
        size: 12.0,
        weight: FontWeight::Named(FontWeightName::Medium),
        bold_weight: default_bold_weight(),
        style: FontStyle::default(),
        line_height: 1.4,
        letter_spacing: 0.2,
        ligatures_enabled: false,
        text_rendering: TextRendering::OptimizeLegibility,
        font_smoothing: FontSmoothing::Antialiased,
        prefer_nerd_font: false,
        fallback_families: vec![
            "system-ui".to_string(),
            "sans-serif".to_string(),
        ],
    }
}

impl Default for FontConfiguration {
    fn default() -> Self {
        Self {
            ssh_terminal: FontSettings::default(),
            app_ui: default_ui_settings(),
            code_editor: FontSettings::default(),
            tab_bar: default_tab_settings(),
            log_viewer: FontSettings {
                family: "JetBrains Mono".to_string(),
                size: 12.0,
                line_height: 1.3,
                ..FontSettings::default()
            },
            connection_overrides: HashMap::new(),
            custom_stacks: Vec::new(),
            favourites: Vec::new(),
            recent_fonts: Vec::new(),
            global_prefer_nerd_fonts: false,
            global_ligatures: true,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Font preset — quick-apply bundles
// ═══════════════════════════════════════════════════════════════════════

/// A named preset that applies font settings across multiple contexts at once.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPreset {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Which contexts this preset configures.
    #[serde(default)]
    pub ssh_terminal: Option<FontSettings>,
    #[serde(default)]
    pub app_ui: Option<FontSettings>,
    #[serde(default)]
    pub code_editor: Option<FontSettings>,
    #[serde(default)]
    pub tab_bar: Option<FontSettings>,
    #[serde(default)]
    pub log_viewer: Option<FontSettings>,
    pub is_builtin: bool,
}

// ═══════════════════════════════════════════════════════════════════════
//  Persistent data envelope
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPersistentData {
    pub config: FontConfiguration,
    pub custom_stacks: Vec<FontStack>,
    pub saved_at: DateTime<Utc>,
    #[serde(default)]
    pub version: u32,
}

impl Default for FontPersistentData {
    fn default() -> Self {
        Self {
            config: FontConfiguration::default(),
            custom_stacks: Vec::new(),
            saved_at: Utc::now(),
            version: 1,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  System font detection result
// ═══════════════════════════════════════════════════════════════════════

/// A font found on the local system.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    /// Family name as reported by the OS.
    pub family: String,
    /// Full font name (including weight/style, e.g. "Consolas Bold Italic").
    #[serde(default)]
    pub full_name: Option<String>,
    /// File path on disk.
    #[serde(default)]
    pub path: Option<String>,
    /// Whether this is a monospace font (heuristic).
    #[serde(default)]
    pub is_monospace: bool,
    /// Whether we have metadata for this font in our registry.
    #[serde(default)]
    pub in_registry: bool,
}

// ═══════════════════════════════════════════════════════════════════════
//  Font search / filter
// ═══════════════════════════════════════════════════════════════════════

/// Query parameters for searching the font registry.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontSearchQuery {
    /// Text to fuzzy-match against name, tags, description.
    #[serde(default)]
    pub query: String,
    /// Filter by category.
    #[serde(default)]
    pub category: Option<FontCategory>,
    /// Filter by sub-category.
    #[serde(default)]
    pub subcategory: Option<FontSubcategory>,
    /// Only show fonts with ligatures.
    #[serde(default)]
    pub ligatures_only: bool,
    /// Only show fonts with Nerd Font variants.
    #[serde(default)]
    pub nerd_font_only: bool,
    /// Only show free/open-source fonts.
    #[serde(default)]
    pub free_only: bool,
    /// Only show fonts pre-installed on the current platform.
    #[serde(default)]
    pub preinstalled_only: bool,
    /// Maximum results.
    #[serde(default = "default_max")]
    pub max_results: usize,
}

fn default_max() -> usize { 50 }

/// Stats about the font registry and configuration.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontStats {
    pub total_fonts: usize,
    pub monospace_fonts: usize,
    pub sans_serif_fonts: usize,
    pub serif_fonts: usize,
    pub display_fonts: usize,
    pub system_fonts: usize,
    pub ligature_fonts: usize,
    pub nerd_fonts: usize,
    pub free_fonts: usize,
    pub preinstalled_fonts: usize,
    pub custom_stacks: usize,
    pub favourites: usize,
    pub connection_overrides: usize,
}
