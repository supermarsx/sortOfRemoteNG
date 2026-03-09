use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

use chrono::Utc;
use sorng_llm::LlmServiceState;

use crate::history::HistoryEngine;
use crate::persistence::PersistenceManager;
use crate::search::SearchEngine;
use crate::snippets::SnippetEngine;
use crate::types::*;

/// Thread-safe state type for Tauri managed state.
pub type CommandPaletteServiceState = Arc<RwLock<CommandPaletteService>>;

/// The top-level service orchestrating all palette sub-systems.
pub struct CommandPaletteService {
    pub history: HistoryEngine,
    pub snippets: SnippetEngine,
    pub aliases: Vec<Alias>,
    pub pinned_commands: Vec<String>,
    pub config: PaletteConfig,
    persistence: PersistenceManager,
    llm: Option<LlmServiceState>,
    dirty: bool,
}

impl CommandPaletteService {
    // ── Construction ─────────────────────────────────────────────

    /// Restore (or create fresh) persistent state from disk.
    pub fn new(data_dir: &Path, llm: Option<LlmServiceState>) -> Self {
        let persistence = PersistenceManager::new(data_dir);
        let data = persistence.load();

        let mut snippets = SnippetEngine::new();
        for s in data.snippets {
            snippets.add(s);
        }

        let mut history = HistoryEngine::new(data.config.frecency.clone());
        for h in data.history {
            history.import_entry(h);
        }

        Self {
            history,
            snippets,
            aliases: data.aliases,
            pinned_commands: data.pinned_commands,
            config: data.config,
            persistence,
            llm,
            dirty: false,
        }
    }

    // ── Unified search ──────────────────────────────────────────

    pub async fn search(&self, query: PaletteQuery) -> PaletteResponse {
        SearchEngine::search(
            &query,
            &self.history,
            &self.snippets,
            &self.aliases,
            &self.config,
            self.llm.as_ref(),
        )
        .await
    }

    // ── History façade ──────────────────────────────────────────

    pub fn record_command(&mut self, entry: HistoryEntry) {
        self.history.import_entry(entry);
        self.dirty = true;
    }

    pub fn search_history(&self, query: &str, max: usize) -> Vec<(HistoryEntry, f64)> {
        self.history.search(query, max)
    }

    pub fn pin_command(&mut self, command: &str, pinned: bool) {
        self.history.set_pinned(command, pinned);
        if pinned && !self.pinned_commands.contains(&command.to_string()) {
            self.pinned_commands.push(command.to_string());
        } else if !pinned {
            self.pinned_commands.retain(|c| c != command);
        }
        self.dirty = true;
    }

    pub fn tag_command(&mut self, command: &str, tag: &str) {
        self.history.add_tag(command, tag);
        self.dirty = true;
    }

    pub fn remove_history_entry(&mut self, command: &str) {
        self.history.remove(command);
        self.dirty = true;
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
        self.dirty = true;
    }

    /// Build a `PaletteStats` from history + snippets + aliases.
    pub fn stats(&self) -> PaletteStats {
        let (total_history, unique_commands, top_commands, commands_by_host) = self.history.stats();
        let (total_snippets, builtin_snippets, custom_snippets, top_snippets) =
            self.snippets.stats();
        PaletteStats {
            total_history_entries: total_history,
            unique_commands,
            total_snippets,
            builtin_snippets,
            custom_snippets,
            total_aliases: self.aliases.len(),
            top_commands,
            top_snippets,
            commands_by_host,
            most_active_sessions: Vec::new(), // TODO: track session activity
        }
    }

    // ── Snippet façade ──────────────────────────────────────────

    pub fn add_snippet(&mut self, snippet: Snippet) -> String {
        let id = self.snippets.add(snippet);
        self.dirty = true;
        id
    }

    pub fn get_snippet(&self, id: &str) -> Option<&Snippet> {
        self.snippets.get(id)
    }

    pub fn update_snippet(&mut self, snippet: Snippet) -> Result<(), String> {
        if self.snippets.update(snippet) {
            self.dirty = true;
            Ok(())
        } else {
            Err("Snippet not found".to_string())
        }
    }

    pub fn remove_snippet(&mut self, id: &str) -> Result<Snippet, String> {
        match self.snippets.remove(id) {
            Some(s) => {
                self.dirty = true;
                Ok(s)
            }
            None => Err(format!("Snippet '{}' not found", id)),
        }
    }

    pub fn list_snippets(&self) -> Vec<&Snippet> {
        self.snippets.list()
    }

    pub fn search_snippets(&self, query: &str, max: usize) -> Vec<(&Snippet, f64)> {
        self.snippets.search(query, max)
    }

    pub fn render_snippet(
        &self,
        snippet_id: &str,
        params: &HashMap<String, String>,
    ) -> Result<SnippetRenderResult, String> {
        self.snippets.render(snippet_id, params)
    }

    pub fn import_snippets(&mut self, collection: SnippetCollection) -> usize {
        let count = self.snippets.import_collection(collection, false);
        if count > 0 {
            self.dirty = true;
        }
        count
    }

    pub fn export_snippets(&self) -> SnippetCollection {
        self.snippets.export_custom()
    }

    pub fn export_snippet_category(&self, category: &SnippetCategory) -> SnippetCollection {
        self.snippets.export_category(category)
    }

    // ── OS-aware snippet / alias queries ────────────────────────

    /// Return snippets compatible with the given OS context.
    pub fn snippets_by_os(&self, ctx: &OsContext) -> Vec<Snippet> {
        self.snippets.by_os(ctx).into_iter().cloned().collect()
    }

    /// Return snippets for a family (including universal).
    pub fn snippets_by_os_family(&self, family: &OsFamily) -> Vec<Snippet> {
        self.snippets
            .by_os_family(family)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Return only universal snippets.
    pub fn snippets_universal(&self) -> Vec<Snippet> {
        self.snippets.universal().into_iter().cloned().collect()
    }

    /// Set the OS target on an existing snippet.
    pub fn set_snippet_os_target(&mut self, id: &str, os_target: OsTarget) -> Result<(), String> {
        let snippet = self
            .snippets
            .get(id)
            .ok_or_else(|| format!("Snippet '{}' not found", id))?
            .clone();
        let mut updated = snippet;
        updated.os_target = os_target;
        self.snippets.update(updated);
        self.dirty = true;
        Ok(())
    }

    /// Set the OS target on an existing alias.
    pub fn set_alias_os_target(
        &mut self,
        trigger: &str,
        os_target: OsTarget,
    ) -> Result<(), String> {
        let alias = self
            .aliases
            .iter_mut()
            .find(|a| a.trigger == trigger)
            .ok_or_else(|| format!("Alias '{}' not found", trigger))?;
        alias.os_target = os_target;
        self.dirty = true;
        Ok(())
    }

    // ── Alias façade ────────────────────────────────────────────

    pub fn add_alias(&mut self, alias: Alias) -> Result<(), String> {
        if self.aliases.iter().any(|a| a.trigger == alias.trigger) {
            return Err(format!("Alias '{}' already exists", alias.trigger));
        }
        self.aliases.push(alias);
        self.dirty = true;
        Ok(())
    }

    pub fn remove_alias(&mut self, trigger: &str) -> Result<(), String> {
        let idx = self
            .aliases
            .iter()
            .position(|a| a.trigger == trigger)
            .ok_or_else(|| format!("Alias '{}' not found", trigger))?;
        self.aliases.remove(idx);
        self.dirty = true;
        Ok(())
    }

    pub fn list_aliases(&self) -> &[Alias] {
        &self.aliases
    }

    // ── Configuration ───────────────────────────────────────────

    pub fn get_config(&self) -> &PaletteConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: PaletteConfig) {
        self.config = config;
        self.dirty = true;
    }

    // ── Persistence ─────────────────────────────────────────────

    /// Collect current state into a `PersistentData` blob.
    fn to_persistent_data(&self) -> PersistentData {
        PersistentData {
            history: self.history.entries().to_vec(),
            snippets: self.snippets.all_snippets(),
            aliases: self.aliases.clone(),
            pinned_commands: self.pinned_commands.clone(),
            config: self.config.clone(),
            saved_at: Utc::now(),
            version: 1,
        }
    }

    /// Save all state to disk if there are unsaved changes.
    pub fn save(&mut self) -> Result<(), String> {
        if !self.dirty {
            return Ok(());
        }
        let mut data = self.to_persistent_data();
        self.persistence.save(&mut data)?;
        self.dirty = false;
        Ok(())
    }

    /// Force save regardless of dirty flag.
    pub fn force_save(&mut self) -> Result<(), String> {
        self.dirty = true;
        self.save()
    }

    /// Export full state to an arbitrary path.
    pub fn export_to(&self, path: &Path) -> Result<(), String> {
        let data = self.to_persistent_data();
        self.persistence.export_to(path, &data)
    }

    /// Import full state from an arbitrary path (merges).
    pub fn import_from(&self, path: &Path) -> Result<PersistentData, String> {
        self.persistence.import_from(path)
    }

    // ── Extended Import / Export ─────────────────────────────────

    /// Get the current persistent-data snapshot (public for import/export module).
    pub fn snapshot(&self) -> PersistentData {
        self.to_persistent_data()
    }

    /// Perform a selective, filtered export in any supported format.
    pub fn export_advanced(&self, request: &ExportRequest) -> Result<ExportResult, String> {
        let data = self.to_persistent_data();
        crate::import_export::export(&data, request)
    }

    /// Export history with specialised options.
    pub fn export_history(
        &self,
        options: &HistoryExportOptions,
        format: ExportFormat,
    ) -> Result<String, String> {
        let entries: Vec<HistoryEntry> = self.history.entries().to_vec();
        crate::import_export::export_history(&entries, options, format)
    }

    /// Validate an import file or string without mutating state.
    pub fn validate_import(&self, content: &str) -> ValidationResult {
        crate::import_export::validate_import(content)
    }

    /// Preview an import (dry-run) — returns conflict info and counts.
    pub fn preview_import(
        &self,
        content: &str,
        options: &ImportOptions,
    ) -> Result<ImportResult, String> {
        let incoming = crate::import_export::parse_import_data(content)?;
        let existing = self.to_persistent_data();
        let mut opts = options.clone();
        opts.dry_run = true;
        Ok(crate::import_export::import_with_options(
            &existing, &incoming, &opts,
        ))
    }

    /// Execute an import, applying conflict resolution and mutating state.
    pub fn import_advanced(
        &mut self,
        content: &str,
        options: &ImportOptions,
    ) -> Result<ImportResult, String> {
        let incoming = crate::import_export::parse_import_data(content)?;
        let mut current = self.to_persistent_data();

        // Compute stats for the result.
        let result = crate::import_export::import_with_options(&current, &incoming, options);

        if !options.dry_run {
            crate::import_export::apply_import(&mut current, &incoming, options);

            // Reload state from the merged PersistentData.
            self.reload_from_persistent_data(current);
            self.dirty = true;
        }

        Ok(result)
    }

    /// Import from a file path with options.
    pub fn import_file_advanced(
        &mut self,
        path: &Path,
        options: &ImportOptions,
    ) -> Result<ImportResult, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read import file: {}", e))?;
        self.import_advanced(&content, options)
    }

    /// Create a shareable package from current (or filtered) state.
    pub fn create_share_package(
        &self,
        metadata: SharePackageMetadata,
        scope: Option<&ExportScope>,
        filter: Option<&ExportFilter>,
    ) -> Result<SharePackage, String> {
        let mut data = self.to_persistent_data();

        // Apply optional scope/filter.
        if scope.is_some() || filter.is_some() {
            let req = ExportRequest {
                format: ExportFormat::Json,
                scope: scope.cloned().unwrap_or_default(),
                filter: filter.cloned().unwrap_or_default(),
                output_path: None,
            };
            let result = crate::import_export::export(&data, &req)?;
            if let Some(content) = result.content {
                data = serde_json::from_str(&content)
                    .map_err(|e| format!("Failed to rebuild filtered data: {}", e))?;
            }
        }

        crate::import_export::create_share_package(data, metadata)
    }

    /// Import from a share package JSON string.
    pub fn import_share_package(
        &mut self,
        json: &str,
        options: &ImportOptions,
    ) -> Result<ImportResult, String> {
        let pkg = crate::import_export::deserialise_share_package(json)?;
        let mut current = self.to_persistent_data();
        let result = crate::import_export::import_with_options(&current, &pkg.data, options);

        if !options.dry_run {
            crate::import_export::apply_import(&mut current, &pkg.data, options);
            self.reload_from_persistent_data(current);
            self.dirty = true;
        }

        Ok(result)
    }

    /// Encode current state for clipboard sharing.
    pub fn export_to_clipboard(&self) -> Result<String, String> {
        let data = self.to_persistent_data();
        crate::import_export::encode_for_clipboard(&data)
    }

    /// Import from clipboard payload string.
    pub fn import_from_clipboard(
        &mut self,
        text: &str,
        options: &ImportOptions,
    ) -> Result<ImportResult, String> {
        let incoming = crate::import_export::decode_from_clipboard(text)?;
        let mut current = self.to_persistent_data();
        let result = crate::import_export::import_with_options(&current, &incoming, options);

        if !options.dry_run {
            crate::import_export::apply_import(&mut current, &incoming, options);
            self.reload_from_persistent_data(current);
            self.dirty = true;
        }

        Ok(result)
    }

    /// Export snippets by category, filtered by tags, in any format.
    pub fn export_snippets_filtered(
        &self,
        categories: &[SnippetCategory],
        tags: &[String],
        format: ExportFormat,
    ) -> Result<String, String> {
        let all = self.snippets.all_snippets();
        let by_cat = crate::import_export::export_snippets_by_category(&all, categories);
        let filtered = crate::import_export::export_snippets_by_tags(&by_cat, tags);

        let collection = SnippetCollection {
            name: "Filtered Snippets Export".into(),
            description: Some(format!("Exported {} snippets", filtered.len())),
            snippets: filtered,
            exported_at: Utc::now(),
            version: Some("1".into()),
        };

        match format {
            ExportFormat::Json => {
                serde_json::to_string_pretty(&collection).map_err(|e| format!("JSON error: {}", e))
            }
            ExportFormat::Markdown => {
                let data = PersistentData {
                    snippets: collection.snippets,
                    ..PersistentData::default()
                };
                let req = ExportRequest {
                    format: ExportFormat::Markdown,
                    scope: ExportScope {
                        history: false,
                        snippets: true,
                        aliases: false,
                        pinned_commands: false,
                        config: false,
                    },
                    filter: ExportFilter::default(),
                    output_path: None,
                };
                crate::import_export::export(&data, &req).map(|r| r.content.unwrap_or_default())
            }
            ExportFormat::ShellScript => {
                let data = PersistentData {
                    snippets: collection.snippets,
                    ..PersistentData::default()
                };
                let req = ExportRequest {
                    format: ExportFormat::ShellScript,
                    scope: ExportScope {
                        history: false,
                        snippets: true,
                        aliases: false,
                        pinned_commands: false,
                        config: false,
                    },
                    filter: ExportFilter::default(),
                    output_path: None,
                };
                crate::import_export::export(&data, &req).map(|r| r.content.unwrap_or_default())
            }
            _ => {
                serde_json::to_string_pretty(&collection).map_err(|e| format!("JSON error: {}", e))
            }
        }
    }

    // ── Internal helpers ────────────────────────────────────────

    /// Replace the entire in-memory state from a `PersistentData` blob.
    fn reload_from_persistent_data(&mut self, data: PersistentData) {
        // Rebuild history.
        self.history = HistoryEngine::new(data.config.frecency.clone());
        for h in data.history {
            self.history.import_entry(h);
        }

        // Rebuild snippets.
        self.snippets = SnippetEngine::new();
        for s in data.snippets {
            self.snippets.add(s);
        }

        self.aliases = data.aliases;
        self.pinned_commands = data.pinned_commands;
        self.config = data.config;
    }
}

/// Create the Tauri-managed state, loading persisted data from disk.
pub fn create_palette_state(
    data_dir: &Path,
    llm: Option<LlmServiceState>,
) -> CommandPaletteServiceState {
    Arc::new(RwLock::new(CommandPaletteService::new(data_dir, llm)))
}
