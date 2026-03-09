use crate::builtin::all_builtin_themes;
use crate::types::*;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// The core theme engine managing a registry of themes, the global active theme,
/// and per-session theme overrides.
pub struct ThemeEngine {
    /// All registered themes keyed by id.
    themes: HashMap<String, TerminalTheme>,
    /// Global active theme id.
    active_theme_id: String,
    /// Per-session theme overrides: session_id -> theme_id.
    session_themes: HashMap<String, String>,
    /// Recently used theme ids (most recent last).
    recent: Vec<String>,
    /// Maximum number of recent entries to keep.
    max_recent: usize,
}

impl Default for ThemeEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ThemeEngine {
    pub fn new() -> Self {
        let mut themes = HashMap::new();
        for theme in all_builtin_themes() {
            themes.insert(theme.id.clone(), theme);
        }
        let active_theme_id = "dracula".to_string();
        Self {
            themes,
            active_theme_id,
            session_themes: HashMap::new(),
            recent: vec!["dracula".to_string()],
            max_recent: 20,
        }
    }

    // ─── Query ───────────────────────────────────────────────────

    /// List all themes as lightweight summaries.
    pub fn list_themes(&self) -> Vec<ThemeSummary> {
        let mut summaries: Vec<ThemeSummary> =
            self.themes.values().map(ThemeSummary::from).collect();
        summaries.sort_by(|a, b| a.name.cmp(&b.name));
        summaries
    }

    /// List themes filtered by category.
    pub fn list_by_category(&self, category: &ThemeCategory) -> Vec<ThemeSummary> {
        self.themes
            .values()
            .filter(|t| &t.category == category)
            .map(ThemeSummary::from)
            .collect()
    }

    /// List only dark themes.
    pub fn list_dark(&self) -> Vec<ThemeSummary> {
        self.themes
            .values()
            .filter(|t| t.is_dark)
            .map(ThemeSummary::from)
            .collect()
    }

    /// List only light themes.
    pub fn list_light(&self) -> Vec<ThemeSummary> {
        self.themes
            .values()
            .filter(|t| !t.is_dark)
            .map(ThemeSummary::from)
            .collect()
    }

    /// Get a theme by id.
    pub fn get_theme(&self, id: &str) -> Result<&TerminalTheme, ThemeError> {
        self.themes.get(id).ok_or_else(|| ThemeError::not_found(id))
    }

    /// Get the currently active global theme.
    pub fn get_active_theme(&self) -> Result<&TerminalTheme, ThemeError> {
        self.get_theme(&self.active_theme_id.clone())
    }

    /// Get the active theme id.
    pub fn active_theme_id(&self) -> &str {
        &self.active_theme_id
    }

    /// Get a theme for a specific session (falls back to global).
    pub fn get_session_theme(&self, session_id: &str) -> Result<&TerminalTheme, ThemeError> {
        let id = self
            .session_themes
            .get(session_id)
            .unwrap_or(&self.active_theme_id);
        self.get_theme(id)
    }

    /// Get the xterm.js theme object for a session.
    pub fn get_xterm_theme(&self, session_id: &str) -> Result<serde_json::Value, ThemeError> {
        let theme = self.get_session_theme(session_id)?;
        Ok(theme.to_xterm_theme())
    }

    /// Get CSS variables string for a session.
    pub fn get_css_variables(&self, session_id: &str) -> Result<String, ThemeError> {
        let theme = self.get_session_theme(session_id)?;
        Ok(theme.to_css_variables("--terminal"))
    }

    /// Search themes by query (matches name, description, author, tags).
    pub fn search(&self, query: &str) -> Vec<ThemeSummary> {
        let q = query.to_lowercase();
        self.themes
            .values()
            .filter(|t| {
                t.name.to_lowercase().contains(&q)
                    || t.description.to_lowercase().contains(&q)
                    || t.author.to_lowercase().contains(&q)
                    || t.tags.iter().any(|tag| tag.to_lowercase().contains(&q))
            })
            .map(ThemeSummary::from)
            .collect()
    }

    /// Get recently used themes.
    pub fn recent_themes(&self) -> Vec<ThemeSummary> {
        self.recent
            .iter()
            .rev()
            .filter_map(|id| self.themes.get(id))
            .map(ThemeSummary::from)
            .collect()
    }

    /// Get the number of registered themes.
    pub fn theme_count(&self) -> usize {
        self.themes.len()
    }

    // ─── Mutation ────────────────────────────────────────────────

    /// Set the global active theme.
    pub fn set_active_theme(&mut self, id: &str) -> Result<(), ThemeError> {
        if !self.themes.contains_key(id) {
            return Err(ThemeError::not_found(id));
        }
        self.active_theme_id = id.to_string();
        self.add_to_recent(id);
        Ok(())
    }

    /// Set a per-session theme override.
    pub fn set_session_theme(
        &mut self,
        session_id: &str,
        theme_id: &str,
    ) -> Result<(), ThemeError> {
        if !self.themes.contains_key(theme_id) {
            return Err(ThemeError::not_found(theme_id));
        }
        self.session_themes
            .insert(session_id.to_string(), theme_id.to_string());
        self.add_to_recent(theme_id);
        Ok(())
    }

    /// Remove a per-session theme override (reverts to global).
    pub fn clear_session_theme(&mut self, session_id: &str) {
        self.session_themes.remove(session_id);
    }

    /// Register a new custom theme.
    pub fn register_theme(&mut self, theme: TerminalTheme) -> Result<(), ThemeError> {
        if self.themes.contains_key(&theme.id) {
            return Err(ThemeError::duplicate(&theme.id));
        }
        self.themes.insert(theme.id.clone(), theme);
        Ok(())
    }

    /// Update an existing custom theme (cannot update builtins).
    pub fn update_theme(&mut self, theme: TerminalTheme) -> Result<(), ThemeError> {
        if let Some(existing) = self.themes.get(&theme.id) {
            if existing.is_builtin {
                return Err(ThemeError::invalid("Cannot modify a built-in theme"));
            }
        } else {
            return Err(ThemeError::not_found(&theme.id));
        }
        self.themes.insert(theme.id.clone(), theme);
        Ok(())
    }

    /// Remove a custom theme (cannot remove builtins).
    pub fn remove_theme(&mut self, id: &str) -> Result<TerminalTheme, ThemeError> {
        if let Some(t) = self.themes.get(id) {
            if t.is_builtin {
                return Err(ThemeError::invalid("Cannot remove a built-in theme"));
            }
        } else {
            return Err(ThemeError::not_found(id));
        }
        // If this theme is the active one, fall back to dracula
        if self.active_theme_id == id {
            self.active_theme_id = "dracula".to_string();
        }
        // Remove from session overrides
        self.session_themes.retain(|_, v| v != id);
        self.themes
            .remove(id)
            .ok_or_else(|| ThemeError::not_found(id))
    }

    /// Duplicate a theme with a new id and name (creates a custom copy).
    pub fn duplicate_theme(
        &mut self,
        source_id: &str,
        new_id: &str,
        new_name: &str,
    ) -> Result<(), ThemeError> {
        let source = self.get_theme(source_id)?.clone();
        if self.themes.contains_key(new_id) {
            return Err(ThemeError::duplicate(new_id));
        }
        let mut copy = source;
        copy.id = new_id.to_string();
        copy.name = new_name.to_string();
        copy.is_builtin = false;
        self.themes.insert(new_id.to_string(), copy);
        Ok(())
    }

    // ─── Internal ────────────────────────────────────────────────

    fn add_to_recent(&mut self, id: &str) {
        self.recent.retain(|r| r != id);
        self.recent.push(id.to_string());
        if self.recent.len() > self.max_recent {
            self.recent.remove(0);
        }
    }
}

/// Thread-safe shared state for the theme engine.
pub type ThemeEngineState = Arc<RwLock<ThemeEngine>>;

/// Create a new shared theme engine.
pub fn create_theme_engine_state() -> ThemeEngineState {
    Arc::new(RwLock::new(ThemeEngine::new()))
}
