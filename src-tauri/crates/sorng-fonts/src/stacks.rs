use crate::types::*;

/// Pre-built font stacks — curated fallback chains for different contexts.
pub struct FontStacks;

impl FontStacks {
    /// All built-in font stacks.
    pub fn all() -> Vec<FontStack> {
        vec![
            Self::ssh_default(),
            Self::ssh_coding(),
            Self::ssh_retro(),
            Self::ssh_nerd(),
            Self::ssh_platform_native(),
            Self::ui_default(),
            Self::ui_clean(),
            Self::ui_system(),
            Self::code_default(),
            Self::code_ligatures(),
            Self::log_default(),
            Self::tab_default(),
        ]
    }

    /// Get a built-in stack by ID.
    pub fn get(id: &str) -> Option<FontStack> {
        Self::all().into_iter().find(|s| s.id == id)
    }

    // ─── SSH / Terminal stacks ──────────────────────────────────

    /// Default SSH terminal stack: modern coding fonts → platform fallbacks → generic.
    pub fn ssh_default() -> FontStack {
        FontStack {
            id: "ssh-default".to_string(),
            name: "SSH Default".to_string(),
            description: Some("Balanced terminal font stack with modern coding fonts".to_string()),
            families: vec![
                "Cascadia Code".to_string(),
                "Fira Code".to_string(),
                "JetBrains Mono".to_string(),
                "Consolas".to_string(),
                "Menlo".to_string(),
                "Monaco".to_string(),
                "Ubuntu Mono".to_string(),
                "Liberation Mono".to_string(),
                "Courier New".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::SshTerminal,
            is_builtin: true,
        }
    }

    /// Coding-optimized stack: ligature-enabled fonts with clean fallbacks.
    pub fn ssh_coding() -> FontStack {
        FontStack {
            id: "ssh-coding".to_string(),
            name: "SSH Coding".to_string(),
            description: Some("Ligature-enabled coding fonts for productive terminal work".to_string()),
            families: vec![
                "Fira Code".to_string(),
                "Cascadia Code".to_string(),
                "JetBrains Mono".to_string(),
                "Victor Mono".to_string(),
                "Iosevka".to_string(),
                "Hack".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::SshTerminal,
            is_builtin: true,
        }
    }

    /// Retro / bitmap-style stack for a nostalgic terminal feel.
    pub fn ssh_retro() -> FontStack {
        FontStack {
            id: "ssh-retro".to_string(),
            name: "SSH Retro".to_string(),
            description: Some("Bitmap and retro monospace fonts for classic terminal aesthetics".to_string()),
            families: vec![
                "Terminus".to_string(),
                "ProggyClean".to_string(),
                "Courier New".to_string(),
                "Courier".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::SshTerminal,
            is_builtin: true,
        }
    }

    /// Nerd Font stack: patched fonts with glyphs for powerline, devicons, etc.
    pub fn ssh_nerd() -> FontStack {
        FontStack {
            id: "ssh-nerd".to_string(),
            name: "SSH Nerd Font".to_string(),
            description: Some("Patched Nerd Fonts with powerline glyphs and dev icons".to_string()),
            families: vec![
                "CaskaydiaCove Nerd Font".to_string(),
                "FiraCode Nerd Font".to_string(),
                "JetBrainsMono Nerd Font".to_string(),
                "Hack Nerd Font".to_string(),
                "MesloLGS Nerd Font".to_string(),
                "DejaVuSansMono Nerd Font".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::SshTerminal,
            is_builtin: true,
        }
    }

    /// Platform-native terminal fonts only.
    pub fn ssh_platform_native() -> FontStack {
        FontStack {
            id: "ssh-platform-native".to_string(),
            name: "SSH Platform Native".to_string(),
            description: Some("Platform-specific preinstalled terminal fonts".to_string()),
            families: vec![
                "ui-monospace".to_string(),
                "Consolas".to_string(),
                "SF Mono".to_string(),
                "Menlo".to_string(),
                "DejaVu Sans Mono".to_string(),
                "Liberation Mono".to_string(),
                "Courier New".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::SshTerminal,
            is_builtin: true,
        }
    }

    // ─── App UI stacks ──────────────────────────────────────────

    /// Default UI font stack.
    pub fn ui_default() -> FontStack {
        FontStack {
            id: "ui-default".to_string(),
            name: "App UI Default".to_string(),
            description: Some("Modern, readable UI fonts for the application interface".to_string()),
            families: vec![
                "Inter".to_string(),
                "Geist".to_string(),
                "Segoe UI".to_string(),
                "-apple-system".to_string(),
                "BlinkMacSystemFont".to_string(),
                "Roboto".to_string(),
                "Helvetica Neue".to_string(),
                "Arial".to_string(),
                "sans-serif".to_string(),
            ],
            target: FontStackTarget::AppUi,
            is_builtin: true,
        }
    }

    /// Clean / minimal UI stack.
    pub fn ui_clean() -> FontStack {
        FontStack {
            id: "ui-clean".to_string(),
            name: "App UI Clean".to_string(),
            description: Some("Minimal, uncluttered sans-serif stack".to_string()),
            families: vec![
                "IBM Plex Sans".to_string(),
                "Open Sans".to_string(),
                "Lato".to_string(),
                "Noto Sans".to_string(),
                "sans-serif".to_string(),
            ],
            target: FontStackTarget::AppUi,
            is_builtin: true,
        }
    }

    /// OS system-native UI.
    pub fn ui_system() -> FontStack {
        FontStack {
            id: "ui-system".to_string(),
            name: "App UI System".to_string(),
            description: Some("Use the operating system's native UI font".to_string()),
            families: vec![
                "system-ui".to_string(),
                "-apple-system".to_string(),
                "BlinkMacSystemFont".to_string(),
                "Segoe UI".to_string(),
                "Roboto".to_string(),
                "sans-serif".to_string(),
            ],
            target: FontStackTarget::AppUi,
            is_builtin: true,
        }
    }

    // ─── Code editor / log viewer stacks ────────────────────────

    /// Default code editor stack.
    pub fn code_default() -> FontStack {
        FontStack {
            id: "code-default".to_string(),
            name: "Code Editor Default".to_string(),
            description: Some("Standard monospace fonts for inline code blocks and editors".to_string()),
            families: vec![
                "JetBrains Mono".to_string(),
                "Source Code Pro".to_string(),
                "Cascadia Code".to_string(),
                "Consolas".to_string(),
                "Menlo".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::CodeEditor,
            is_builtin: true,
        }
    }

    /// Code editor with ligature emphasis.
    pub fn code_ligatures() -> FontStack {
        FontStack {
            id: "code-ligatures".to_string(),
            name: "Code Ligatures".to_string(),
            description: Some("Coding fonts prioritizing ligature support".to_string()),
            families: vec![
                "Fira Code".to_string(),
                "JetBrains Mono".to_string(),
                "Cascadia Code".to_string(),
                "Iosevka".to_string(),
                "Victor Mono".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::CodeEditor,
            is_builtin: true,
        }
    }

    /// Log viewer stack — dense, compact monospace.
    pub fn log_default() -> FontStack {
        FontStack {
            id: "log-default".to_string(),
            name: "Log Viewer Default".to_string(),
            description: Some("Compact monospace fonts optimized for dense log output".to_string()),
            families: vec![
                "JetBrains Mono".to_string(),
                "IBM Plex Mono".to_string(),
                "Source Code Pro".to_string(),
                "Cascadia Mono".to_string(),
                "Consolas".to_string(),
                "monospace".to_string(),
            ],
            target: FontStackTarget::LogViewer,
            is_builtin: true,
        }
    }

    /// Tab bar stack — small, readable UI.
    pub fn tab_default() -> FontStack {
        FontStack {
            id: "tab-default".to_string(),
            name: "Tab Bar Default".to_string(),
            description: Some("Compact UI fonts for the tab/title bar".to_string()),
            families: vec![
                "Inter".to_string(),
                "Segoe UI".to_string(),
                "SF Pro".to_string(),
                "system-ui".to_string(),
                "sans-serif".to_string(),
            ],
            target: FontStackTarget::TabBar,
            is_builtin: true,
        }
    }
}

/// Built-in font presets — quick-apply profiles.
pub struct FontPresets;

impl FontPresets {
    pub fn all() -> Vec<FontPreset> {
        vec![
            Self::default_preset(),
            Self::hacker(),
            Self::corporate(),
            Self::retro(),
            Self::minimalist(),
            Self::nerd_font(),
            Self::high_contrast(),
        ]
    }

    pub fn get(id: &str) -> Option<FontPreset> {
        Self::all().into_iter().find(|p| p.id == id)
    }

    fn default_preset() -> FontPreset {
        FontPreset {
            id: "default".to_string(),
            name: "Default".to_string(),
            description: Some("Balanced defaults for terminal and UI".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "Cascadia Code".to_string(),
                size: 14.0,
                line_height: 1.2,
                ligatures_enabled: true,
                ..FontSettings::default()
            }),
            app_ui: Some(FontSettings {
                family: "Inter".to_string(),
                size: 13.0,
                line_height: 1.5,
                ..FontSettings::default()
            }),
            code_editor: None,
            tab_bar: None,
            log_viewer: None,
            is_builtin: true,
        }
    }

    fn hacker() -> FontPreset {
        FontPreset {
            id: "hacker".to_string(),
            name: "Hacker".to_string(),
            description: Some("Dark terminal aesthetic with coding ligatures".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "Fira Code".to_string(),
                size: 14.0,
                line_height: 1.15,
                ligatures_enabled: true,
                font_smoothing: FontSmoothing::SubpixelAntialiased,
                ..FontSettings::default()
            }),
            app_ui: Some(FontSettings {
                family: "Geist".to_string(),
                size: 13.0,
                line_height: 1.4,
                ..FontSettings::default()
            }),
            code_editor: Some(FontSettings {
                family: "Fira Code".to_string(),
                size: 13.0,
                ligatures_enabled: true,
                ..FontSettings::default()
            }),
            tab_bar: None,
            log_viewer: Some(FontSettings {
                family: "JetBrains Mono".to_string(),
                size: 11.0,
                line_height: 1.1,
                ..FontSettings::default()
            }),
            is_builtin: true,
        }
    }

    fn corporate() -> FontPreset {
        FontPreset {
            id: "corporate".to_string(),
            name: "Corporate".to_string(),
            description: Some("Professional IBM Plex family throughout".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "IBM Plex Mono".to_string(),
                size: 14.0,
                line_height: 1.25,
                ..FontSettings::default()
            }),
            app_ui: Some(FontSettings {
                family: "IBM Plex Sans".to_string(),
                size: 13.0,
                line_height: 1.5,
                ..FontSettings::default()
            }),
            code_editor: Some(FontSettings {
                family: "IBM Plex Mono".to_string(),
                size: 13.0,
                ..FontSettings::default()
            }),
            tab_bar: Some(FontSettings {
                family: "IBM Plex Sans".to_string(),
                size: 12.0,
                weight: FontWeight::Named(FontWeightName::Medium),
                ..FontSettings::default()
            }),
            log_viewer: Some(FontSettings {
                family: "IBM Plex Mono".to_string(),
                size: 12.0,
                ..FontSettings::default()
            }),
            is_builtin: true,
        }
    }

    fn retro() -> FontPreset {
        FontPreset {
            id: "retro".to_string(),
            name: "Retro Terminal".to_string(),
            description: Some("Classic bitmap-style terminal look".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "Courier New".to_string(),
                size: 15.0,
                line_height: 1.0,
                font_smoothing: FontSmoothing::None,
                ..FontSettings::default()
            }),
            app_ui: None,
            code_editor: None,
            tab_bar: None,
            log_viewer: Some(FontSettings {
                family: "Courier New".to_string(),
                size: 13.0,
                line_height: 1.0,
                ..FontSettings::default()
            }),
            is_builtin: true,
        }
    }

    fn minimalist() -> FontPreset {
        FontPreset {
            id: "minimalist".to_string(),
            name: "Minimalist".to_string(),
            description: Some("Clean, distraction-free look".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "Source Code Pro".to_string(),
                size: 14.0,
                line_height: 1.3,
                ligatures_enabled: false,
                ..FontSettings::default()
            }),
            app_ui: Some(FontSettings {
                family: "Open Sans".to_string(),
                size: 13.0,
                line_height: 1.5,
                ..FontSettings::default()
            }),
            code_editor: Some(FontSettings {
                family: "Source Code Pro".to_string(),
                size: 13.0,
                ..FontSettings::default()
            }),
            tab_bar: None,
            log_viewer: None,
            is_builtin: true,
        }
    }

    fn nerd_font() -> FontPreset {
        FontPreset {
            id: "nerd-font".to_string(),
            name: "Nerd Font".to_string(),
            description: Some("Powerline glyphs and dev icons everywhere".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "CaskaydiaCove Nerd Font".to_string(),
                size: 14.0,
                line_height: 1.2,
                ligatures_enabled: true,
                prefer_nerd_font: true,
                ..FontSettings::default()
            }),
            app_ui: None,
            code_editor: Some(FontSettings {
                family: "FiraCode Nerd Font".to_string(),
                size: 13.0,
                ligatures_enabled: true,
                prefer_nerd_font: true,
                ..FontSettings::default()
            }),
            tab_bar: None,
            log_viewer: Some(FontSettings {
                family: "JetBrainsMono Nerd Font".to_string(),
                size: 12.0,
                prefer_nerd_font: true,
                ..FontSettings::default()
            }),
            is_builtin: true,
        }
    }

    fn high_contrast() -> FontPreset {
        FontPreset {
            id: "high-contrast".to_string(),
            name: "High Contrast".to_string(),
            description: Some("Larger sizes and heavier weights for accessibility".to_string()),
            ssh_terminal: Some(FontSettings {
                family: "Hack".to_string(),
                size: 16.0,
                line_height: 1.35,
                weight: FontWeight::Named(FontWeightName::Medium),
                bold_weight: FontWeight::Named(FontWeightName::ExtraBold),
                text_rendering: TextRendering::OptimizeLegibility,
                font_smoothing: FontSmoothing::Antialiased,
                ..FontSettings::default()
            }),
            app_ui: Some(FontSettings {
                family: "Roboto".to_string(),
                size: 15.0,
                weight: FontWeight::Named(FontWeightName::Medium),
                line_height: 1.6,
                text_rendering: TextRendering::OptimizeLegibility,
                ..FontSettings::default()
            }),
            code_editor: None,
            tab_bar: None,
            log_viewer: None,
            is_builtin: true,
        }
    }
}
