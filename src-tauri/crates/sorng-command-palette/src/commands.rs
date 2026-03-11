use std::collections::HashMap;

use super::service::CommandPaletteServiceState;
use super::types::*;

// ── Unified Search ──────────────────────────────────────────────

#[tauri::command]
pub async fn palette_search(
    state: tauri::State<'_, CommandPaletteServiceState>,
    query: PaletteQuery,
) -> Result<PaletteResponse, String> {
    let svc = state.read().await;
    Ok(svc.search(query).await)
}

// ── History Commands ────────────────────────────────────────────

#[tauri::command]
pub async fn palette_record_command(
    state: tauri::State<'_, CommandPaletteServiceState>,
    entry: HistoryEntry,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.record_command(entry);
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_search_history(
    state: tauri::State<'_, CommandPaletteServiceState>,
    query: String,
    max: Option<usize>,
) -> Result<Vec<HistoryEntryWithScore>, String> {
    let svc = state.read().await;
    let results = svc.search_history(&query, max.unwrap_or(25));
    Ok(results
        .into_iter()
        .map(|(e, s)| HistoryEntryWithScore { entry: e, score: s })
        .collect())
}

#[tauri::command]
pub async fn palette_get_history(
    state: tauri::State<'_, CommandPaletteServiceState>,
    max: Option<usize>,
) -> Result<Vec<HistoryEntry>, String> {
    let svc = state.read().await;
    let entries = svc.history.top_frecency(max.unwrap_or(50));
    Ok(entries.into_iter().map(|(e, _score)| e).collect())
}

#[tauri::command]
pub async fn palette_pin_command(
    state: tauri::State<'_, CommandPaletteServiceState>,
    command: String,
    pinned: bool,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.pin_command(&command, pinned);
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_tag_command(
    state: tauri::State<'_, CommandPaletteServiceState>,
    command: String,
    tag: String,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.tag_command(&command, &tag);
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_remove_history(
    state: tauri::State<'_, CommandPaletteServiceState>,
    command: String,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.remove_history_entry(&command);
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_clear_history(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.clear_history();
    let _ = svc.save();
    Ok(())
}

// ── Snippet Commands ────────────────────────────────────────────

#[tauri::command]
pub async fn palette_add_snippet(
    state: tauri::State<'_, CommandPaletteServiceState>,
    snippet: Snippet,
) -> Result<String, String> {
    let mut svc = state.write().await;
    let id = svc.add_snippet(snippet);
    let _ = svc.save();
    Ok(id)
}

#[tauri::command]
pub async fn palette_get_snippet(
    state: tauri::State<'_, CommandPaletteServiceState>,
    id: String,
) -> Result<Option<Snippet>, String> {
    let svc = state.read().await;
    Ok(svc.get_snippet(&id).cloned())
}

#[tauri::command]
pub async fn palette_update_snippet(
    state: tauri::State<'_, CommandPaletteServiceState>,
    snippet: Snippet,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_snippet(snippet)?;
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_remove_snippet(
    state: tauri::State<'_, CommandPaletteServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.remove_snippet(&id)?;
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_list_snippets(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<Vec<Snippet>, String> {
    let svc = state.read().await;
    Ok(svc.list_snippets().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn palette_search_snippets(
    state: tauri::State<'_, CommandPaletteServiceState>,
    query: String,
    max: Option<usize>,
) -> Result<Vec<SnippetWithScore>, String> {
    let svc = state.read().await;
    let results = svc.search_snippets(&query, max.unwrap_or(25));
    Ok(results
        .into_iter()
        .map(|(s, score)| SnippetWithScore {
            snippet: s.clone(),
            score,
        })
        .collect())
}

#[tauri::command]
pub async fn palette_render_snippet(
    state: tauri::State<'_, CommandPaletteServiceState>,
    snippet_id: String,
    params: HashMap<String, String>,
) -> Result<SnippetRenderResult, String> {
    let svc = state.read().await;
    svc.render_snippet(&snippet_id, &params)
}

#[tauri::command]
pub async fn palette_import_snippets(
    state: tauri::State<'_, CommandPaletteServiceState>,
    collection: SnippetCollection,
) -> Result<usize, String> {
    let mut svc = state.write().await;
    let count = svc.import_snippets(collection);
    let _ = svc.save();
    Ok(count)
}

#[tauri::command]
pub async fn palette_export_snippets(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<SnippetCollection, String> {
    let svc = state.read().await;
    Ok(svc.export_snippets())
}

// ── Alias Commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn palette_add_alias(
    state: tauri::State<'_, CommandPaletteServiceState>,
    alias: Alias,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.add_alias(alias)?;
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_remove_alias(
    state: tauri::State<'_, CommandPaletteServiceState>,
    trigger: String,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.remove_alias(&trigger)?;
    let _ = svc.save();
    Ok(())
}

#[tauri::command]
pub async fn palette_list_aliases(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<Vec<Alias>, String> {
    let svc = state.read().await;
    Ok(svc.list_aliases().to_vec())
}

// ── Config Commands ─────────────────────────────────────────────

#[tauri::command]
pub async fn palette_get_config(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<PaletteConfig, String> {
    let svc = state.read().await;
    Ok(svc.get_config().clone())
}

#[tauri::command]
pub async fn palette_update_config(
    state: tauri::State<'_, CommandPaletteServiceState>,
    config: PaletteConfig,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_config(config);
    let _ = svc.save();
    Ok(())
}

// ── Stats & Management ──────────────────────────────────────────

#[tauri::command]
pub async fn palette_get_stats(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<PaletteStats, String> {
    let svc = state.read().await;
    Ok(svc.stats())
}

#[tauri::command]
pub async fn palette_save(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.force_save()
}

#[tauri::command]
pub async fn palette_export(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.read().await;
    svc.export_to(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn palette_import(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
) -> Result<(), String> {
    let data = {
        let svc = state.read().await;
        svc.import_from(std::path::Path::new(&path))?
    };
    // Merge imported data into current state.
    let mut svc = state.write().await;
    for entry in data.history {
        svc.record_command(entry);
    }
    for snippet in data.snippets {
        svc.add_snippet(snippet);
    }
    for alias in data.aliases {
        let _ = svc.add_alias(alias); // Ignore duplicates.
    }
    let _ = svc.save();
    Ok(())
}

// ── Helper types for serialization ──────────────────────────────

// ── OS classification commands ──────────────────────────────────

/// List all available OS families.
#[tauri::command]
pub async fn palette_list_os_families() -> Result<Vec<OsFamily>, String> {
    Ok(vec![
        OsFamily::Linux,
        OsFamily::Windows,
        OsFamily::MacOs,
        OsFamily::Bsd,
        OsFamily::Unix,
    ])
}

/// List commonly known distros.
#[tauri::command]
pub async fn palette_list_os_distros() -> Result<Vec<OsDistro>, String> {
    Ok(vec![
        OsDistro::Debian,
        OsDistro::Ubuntu,
        OsDistro::LinuxMint,
        OsDistro::Pop,
        OsDistro::Kali,
        OsDistro::Raspbian,
        OsDistro::Rhel,
        OsDistro::CentOs,
        OsDistro::Fedora,
        OsDistro::Rocky,
        OsDistro::Alma,
        OsDistro::Oracle,
        OsDistro::Amazon,
        OsDistro::OpenSuse,
        OsDistro::Sles,
        OsDistro::Arch,
        OsDistro::Manjaro,
        OsDistro::EndeavourOs,
        OsDistro::Gentoo,
        OsDistro::Alpine,
        OsDistro::Void,
        OsDistro::NixOs,
        OsDistro::Slackware,
        OsDistro::ClearLinux,
        OsDistro::WindowsDesktop,
        OsDistro::WindowsServer,
        OsDistro::WindowsCore,
        OsDistro::MacOsDesktop,
        OsDistro::FreeBsd,
        OsDistro::OpenBsd,
        OsDistro::NetBsd,
    ])
}

/// List snippets compatible with a given OS context.
#[tauri::command]
pub async fn palette_snippets_by_os(
    state: tauri::State<'_, CommandPaletteServiceState>,
    os_context: OsContext,
) -> Result<Vec<Snippet>, String> {
    let svc = state.read().await;
    Ok(svc.snippets_by_os(&os_context))
}

/// List snippets for a particular OS family (including universal ones).
#[tauri::command]
pub async fn palette_snippets_by_os_family(
    state: tauri::State<'_, CommandPaletteServiceState>,
    family: OsFamily,
) -> Result<Vec<Snippet>, String> {
    let svc = state.read().await;
    Ok(svc.snippets_by_os_family(&family))
}

/// List only universal (OS-unconstrained) snippets.
#[tauri::command]
pub async fn palette_snippets_universal(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<Vec<Snippet>, String> {
    let svc = state.read().await;
    Ok(svc.snippets_universal())
}

/// Set / update the OS target on an existing snippet.
#[tauri::command]
pub async fn palette_set_snippet_os_target(
    state: tauri::State<'_, CommandPaletteServiceState>,
    snippet_id: String,
    os_target: OsTarget,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.set_snippet_os_target(&snippet_id, os_target)?;
    let _ = svc.save();
    Ok(())
}

/// Set / update the OS target on an existing alias.
#[tauri::command]
pub async fn palette_set_alias_os_target(
    state: tauri::State<'_, CommandPaletteServiceState>,
    trigger: String,
    os_target: OsTarget,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.set_alias_os_target(&trigger, os_target)?;
    let _ = svc.save();
    Ok(())
}

// ── Helper types for serialization ──────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct HistoryEntryWithScore {
    pub entry: HistoryEntry,
    pub score: f64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SnippetWithScore {
    pub snippet: Snippet,
    pub score: f64,
}

// ═══════════════════════════════════════════════════════════════════════
//  Extended Import / Export Commands
// ═══════════════════════════════════════════════════════════════════════

/// Advanced export with format selection, scope, and filters.
#[tauri::command]
pub async fn palette_export_advanced(
    state: tauri::State<'_, CommandPaletteServiceState>,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    let svc = state.read().await;
    svc.export_advanced(&request)
}

/// Export history with specialised options (host, date range, format).
#[tauri::command]
pub async fn palette_export_history(
    state: tauri::State<'_, CommandPaletteServiceState>,
    options: HistoryExportOptions,
    format: ExportFormat,
) -> Result<String, String> {
    let svc = state.read().await;
    svc.export_history(&options, format)
}

/// Export snippets filtered by category and/or tags.
#[tauri::command]
pub async fn palette_export_snippets_filtered(
    state: tauri::State<'_, CommandPaletteServiceState>,
    categories: Vec<SnippetCategory>,
    tags: Vec<String>,
    format: ExportFormat,
) -> Result<String, String> {
    let svc = state.read().await;
    svc.export_snippets_filtered(&categories, &tags, format)
}

/// Validate an import file/string before importing.
#[tauri::command]
pub async fn palette_validate_import(
    state: tauri::State<'_, CommandPaletteServiceState>,
    content: String,
) -> Result<ValidationResult, String> {
    let svc = state.read().await;
    Ok(svc.validate_import(&content))
}

/// Validate an import file by path.
#[tauri::command]
pub async fn palette_validate_import_file(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
) -> Result<ValidationResult, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let svc = state.read().await;
    Ok(svc.validate_import(&content))
}

/// Preview an import (dry-run) — returns conflicts and counts.
#[tauri::command]
pub async fn palette_preview_import(
    state: tauri::State<'_, CommandPaletteServiceState>,
    content: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let svc = state.read().await;
    svc.preview_import(&content, &options)
}

/// Preview importing from a file path.
#[tauri::command]
pub async fn palette_preview_import_file(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let svc = state.read().await;
    svc.preview_import(&content, &options)
}

/// Execute an advanced import with conflict resolution.
#[tauri::command]
pub async fn palette_import_advanced(
    state: tauri::State<'_, CommandPaletteServiceState>,
    content: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let mut svc = state.write().await;
    let result = svc.import_advanced(&content, &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Import from a file with conflict resolution options.
#[tauri::command]
pub async fn palette_import_file_advanced(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let mut svc = state.write().await;
    let result = svc.import_file_advanced(std::path::Path::new(&path), &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Create a shareable package.
#[tauri::command]
pub async fn palette_create_share_package(
    state: tauri::State<'_, CommandPaletteServiceState>,
    metadata: SharePackageMetadata,
    scope: Option<ExportScope>,
    filter: Option<ExportFilter>,
) -> Result<String, String> {
    let svc = state.read().await;
    let pkg = svc.create_share_package(metadata, scope.as_ref(), filter.as_ref())?;
    super::import_export::serialise_share_package(&pkg)
}

/// Import from a share package JSON string.
#[tauri::command]
pub async fn palette_import_share_package(
    state: tauri::State<'_, CommandPaletteServiceState>,
    json: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let mut svc = state.write().await;
    let result = svc.import_share_package(&json, &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Export palette data for clipboard sharing (base64 encoded).
#[tauri::command]
pub async fn palette_export_clipboard(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<String, String> {
    let svc = state.read().await;
    svc.export_to_clipboard()
}

/// Import palette data from clipboard payload.
#[tauri::command]
pub async fn palette_import_clipboard(
    state: tauri::State<'_, CommandPaletteServiceState>,
    text: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let mut svc = state.write().await;
    let result = svc.import_from_clipboard(&text, &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Save a share package to a file.
#[tauri::command]
pub async fn palette_save_share_package(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    metadata: SharePackageMetadata,
    scope: Option<ExportScope>,
    filter: Option<ExportFilter>,
) -> Result<(), String> {
    let svc = state.read().await;
    let pkg = svc.create_share_package(metadata, scope.as_ref(), filter.as_ref())?;
    let json = super::import_export::serialise_share_package(&pkg)?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write share package: {}", e))
}

/// Load and import a share package from a file path.
#[tauri::command]
pub async fn palette_import_share_package_file(
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read share package: {}", e))?;
    let mut svc = state.write().await;
    let result = svc.import_share_package(&content, &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Get a summary/snapshot of current palette state (useful for diffing).
#[tauri::command]
pub async fn palette_get_snapshot_stats(
    state: tauri::State<'_, CommandPaletteServiceState>,
) -> Result<ExportStats, String> {
    let svc = state.read().await;
    let data = svc.snapshot();
    Ok(ExportStats {
        history_entries: data.history.len(),
        snippets: data.snippets.len(),
        aliases: data.aliases.len(),
        pinned_commands: data.pinned_commands.len(),
    })
}
