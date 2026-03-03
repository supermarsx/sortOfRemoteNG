use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::FontConfigManager;
use crate::detection::FontDetector;
use crate::registry::FontRegistry;
use crate::stacks::{FontPresets, FontStacks};
use crate::types::*;

/// The main font service — orchestrates registry, config, stacks, detection.
pub struct FontService {
    registry: FontRegistry,
    config_manager: FontConfigManager,
}

/// Thread-safe state handle for Tauri managed state.
pub type FontServiceState = Arc<RwLock<FontService>>;

/// Create a new font service state, loading saved config from disk.
pub fn create_font_state(data_dir: &Path) -> FontServiceState {
    let registry = FontRegistry::new();
    let mut config_manager = FontConfigManager::new(data_dir);

    if let Err(e) = config_manager.load() {
        log::warn!("Failed to load font config, using defaults: {}", e);
    }

    Arc::new(RwLock::new(FontService {
        registry,
        config_manager,
    }))
}

impl FontService {
    // ═══════════════════════════════════════════════════════════════
    //  Registry queries
    // ═══════════════════════════════════════════════════════════════

    /// All fonts in the registry.
    pub fn list_all(&self) -> Vec<FontMetadata> {
        self.registry.all().to_vec()
    }

    /// Fonts by category.
    pub fn list_by_category(&self, category: FontCategory) -> Vec<FontMetadata> {
        self.registry.by_category(category).into_iter().cloned().collect()
    }

    /// Get a single font by ID.
    pub fn get_font(&self, id: &str) -> Option<FontMetadata> {
        self.registry.get(id).cloned()
    }

    /// Search fonts.
    pub fn search_fonts(&self, query: &FontSearchQuery) -> Vec<FontMetadata> {
        self.registry.search(query).into_iter().cloned().collect()
    }

    /// All monospace fonts.
    pub fn list_monospace(&self) -> Vec<FontMetadata> {
        self.registry.monospace().into_iter().cloned().collect()
    }

    /// Fonts with ligatures.
    pub fn list_with_ligatures(&self) -> Vec<FontMetadata> {
        self.registry.with_ligatures().into_iter().cloned().collect()
    }

    /// Fonts with Nerd Font variants.
    pub fn list_with_nerd_font(&self) -> Vec<FontMetadata> {
        self.registry.with_nerd_font().into_iter().cloned().collect()
    }

    /// Registry statistics.
    pub fn registry_stats(&self) -> FontStats {
        let mut stats = self.registry.stats();
        stats.custom_stacks = self.config_manager.config().custom_stacks.len();
        stats.favourites = self.config_manager.config().favourites.len();
        stats.connection_overrides = self.config_manager.config().connection_overrides.len();
        stats
    }

    // ═══════════════════════════════════════════════════════════════
    //  Font stacks
    // ═══════════════════════════════════════════════════════════════

    /// All font stacks (built-in + custom).
    pub fn list_stacks(&self) -> Vec<FontStack> {
        let mut stacks = FontStacks::all();
        stacks.extend(self.config_manager.config().custom_stacks.clone());
        stacks
    }

    /// Get a font stack by ID.
    pub fn get_stack(&self, id: &str) -> Option<FontStack> {
        FontStacks::get(id)
            .or_else(|| self.config_manager.config().custom_stacks.iter().find(|s| s.id == id).cloned())
    }

    /// Create or update a custom font stack.
    pub fn upsert_stack(&mut self, stack: FontStack) {
        self.config_manager.upsert_custom_stack(stack);
    }

    /// Delete a custom font stack.
    pub fn delete_stack(&mut self, stack_id: &str) -> bool {
        self.config_manager.delete_custom_stack(stack_id)
    }

    // ═══════════════════════════════════════════════════════════════
    //  Configuration
    // ═══════════════════════════════════════════════════════════════

    /// Get the full font configuration.
    pub fn get_config(&self) -> FontConfiguration {
        self.config_manager.config().clone()
    }

    /// Update SSH terminal font settings.
    pub fn update_ssh_terminal(&mut self, settings: FontSettings) {
        self.config_manager.config_mut().ssh_terminal = settings;
    }

    /// Update app UI font settings.
    pub fn update_app_ui(&mut self, settings: FontSettings) {
        self.config_manager.config_mut().app_ui = settings;
    }

    /// Update code editor font settings.
    pub fn update_code_editor(&mut self, settings: FontSettings) {
        self.config_manager.config_mut().code_editor = settings;
    }

    /// Update tab bar font settings.
    pub fn update_tab_bar(&mut self, settings: FontSettings) {
        self.config_manager.config_mut().tab_bar = settings;
    }

    /// Update log viewer font settings.
    pub fn update_log_viewer(&mut self, settings: FontSettings) {
        self.config_manager.config_mut().log_viewer = settings;
    }

    // ─── Connection overrides ───────────────────────────────────

    /// Set a per-connection font override.
    pub fn set_connection_override(&mut self, connection_id: &str, settings: FontSettings) {
        self.config_manager.set_connection_override(connection_id, settings);
    }

    /// Remove a per-connection font override.
    pub fn remove_connection_override(&mut self, connection_id: &str) -> bool {
        self.config_manager.remove_connection_override(connection_id)
    }

    /// Resolve font settings for a specific connection.
    pub fn resolve_connection_settings(&self, connection_id: &str) -> FontSettings {
        self.config_manager.settings_for_connection(connection_id).clone()
    }

    // ─── Favourites ─────────────────────────────────────────────

    pub fn add_favourite(&mut self, font_id: &str) {
        self.config_manager.add_favourite(font_id);
    }

    pub fn remove_favourite(&mut self, font_id: &str) -> bool {
        self.config_manager.remove_favourite(font_id)
    }

    pub fn get_favourites(&self) -> Vec<FontMetadata> {
        self.config_manager.config().favourites.iter()
            .filter_map(|id| self.registry.get(id).cloned())
            .collect()
    }

    // ─── Recent fonts ───────────────────────────────────────────

    pub fn get_recent(&self) -> Vec<FontMetadata> {
        self.config_manager.config().recent_fonts.iter()
            .filter_map(|id| self.registry.get(id).cloned())
            .collect()
    }

    pub fn record_recent(&mut self, font_id: &str) {
        self.config_manager.record_recent(font_id);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Presets
    // ═══════════════════════════════════════════════════════════════

    pub fn list_presets(&self) -> Vec<FontPreset> {
        FontPresets::all()
    }

    pub fn apply_preset(&mut self, preset_id: &str) -> Result<FontPreset, String> {
        let preset = FontPresets::get(preset_id)
            .ok_or_else(|| format!("Preset '{}' not found", preset_id))?;

        let config = self.config_manager.config_mut();

        if let Some(ref s) = preset.ssh_terminal {
            config.ssh_terminal = s.clone();
        }
        if let Some(ref s) = preset.app_ui {
            config.app_ui = s.clone();
        }
        if let Some(ref s) = preset.code_editor {
            config.code_editor = s.clone();
        }
        if let Some(ref s) = preset.tab_bar {
            config.tab_bar = s.clone();
        }
        if let Some(ref s) = preset.log_viewer {
            config.log_viewer = s.clone();
        }

        Ok(preset)
    }

    // ═══════════════════════════════════════════════════════════════
    //  System font detection
    // ═══════════════════════════════════════════════════════════════

    pub async fn detect_system_fonts(&self) -> Vec<SystemFont> {
        let mut fonts = FontDetector::detect().await;

        // Mark fonts that are in our registry.
        for sf in &mut fonts {
            sf.in_registry = self.registry.by_css_family(&sf.family).is_some();
        }

        fonts
    }

    pub async fn detect_system_monospace(&self) -> Vec<SystemFont> {
        let mut fonts = FontDetector::detect_monospace().await;
        for sf in &mut fonts {
            sf.in_registry = self.registry.by_css_family(&sf.family).is_some();
        }
        fonts
    }

    // ═══════════════════════════════════════════════════════════════
    //  CSS resolution helpers
    // ═══════════════════════════════════════════════════════════════

    /// Resolve a font ID to a full CSS font-family string.
    /// If `prefer_nerd_font` is true and the font has a Nerd Font variant, use that.
    pub fn resolve_css(&self, font_id: &str, prefer_nerd_font: bool) -> Option<String> {
        let font = self.registry.get(font_id)?;

        if prefer_nerd_font {
            if let Some(ref nf_css) = font.nerd_font_css {
                return Some(css_quote(nf_css));
            }
        }

        Some(css_quote(&font.css_family))
    }

    /// Resolve a FontSettings to a full CSS font-family value string.
    pub fn resolve_settings_css(&self, settings: &FontSettings) -> String {
        settings.to_css_family()
    }

    // ═══════════════════════════════════════════════════════════════
    //  Persistence (save / export / import)
    // ═══════════════════════════════════════════════════════════════

    pub fn save(&self) -> Result<(), String> {
        self.config_manager.save()
    }

    pub fn export_to(&self, path: &str) -> Result<(), String> {
        self.config_manager.export_to(std::path::Path::new(path))
    }

    pub fn import_from(&mut self, path: &str) -> Result<(), String> {
        self.config_manager.import_from(std::path::Path::new(path))
    }
}
