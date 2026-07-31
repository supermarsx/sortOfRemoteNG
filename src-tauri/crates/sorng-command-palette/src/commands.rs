use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
};

use super::service::CommandPaletteServiceState;
use super::types::*;
use tauri_plugin_fs::FsExt;

const MAX_PALETTE_TRANSFER_BYTES: usize = 8 * 1024 * 1024;
const MAX_PALETTE_IMPORT_ITEMS: usize = 50_000;

fn require_bounded_payload(label: &str, content: &str) -> Result<(), String> {
    if content.len() > MAX_PALETTE_TRANSFER_BYTES {
        return Err(format!(
            "{label} exceeds the {MAX_PALETTE_TRANSFER_BYTES}-byte safety limit"
        ));
    }
    Ok(())
}

fn require_bounded_import(content: &str) -> Result<(), String> {
    require_bounded_payload("palette import", content)?;
    let data = super::import_export::parse_import_data(content)?;
    let item_count = data
        .history
        .len()
        .saturating_add(data.snippets.len())
        .saturating_add(data.aliases.len())
        .saturating_add(data.pinned_commands.len());
    if item_count > MAX_PALETTE_IMPORT_ITEMS {
        return Err(format!(
            "palette import contains {item_count} items, exceeding the {MAX_PALETTE_IMPORT_ITEMS}-item safety limit"
        ));
    }
    Ok(())
}

fn require_absolute_palette_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("selected file path must be absolute".to_string());
    }
    Ok(())
}

fn require_palette_scope_grant(_path: &Path, is_allowed: bool) -> Result<(), String> {
    if !is_allowed {
        return Err("file path was not granted by the native file picker".to_string());
    }
    Ok(())
}

fn require_renderer_scoped_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    require_absolute_palette_path(path)?;
    let scope = app
        .try_fs_scope()
        .ok_or_else(|| "filesystem scope is unavailable; refusing path access".to_string())?;
    require_palette_scope_grant(path, scope.is_allowed(path))
}

fn read_bounded_regular_text(path: &Path) -> Result<String, String> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|e| format!("inspect {}: {e}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "{} must be a regular, non-symlink file",
            path.display()
        ));
    }
    if metadata.len() > MAX_PALETTE_TRANSFER_BYTES as u64 {
        return Err(format!(
            "{} exceeds the {MAX_PALETTE_TRANSFER_BYTES}-byte safety limit",
            path.display()
        ));
    }

    let file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_PALETTE_TRANSFER_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if bytes.len() > MAX_PALETTE_TRANSFER_BYTES {
        return Err(format!(
            "{} changed while reading and exceeded the safety limit",
            path.display()
        ));
    }
    String::from_utf8(bytes).map_err(|_| "palette import must be valid UTF-8".to_string())
}

fn read_scoped_text(app: &tauri::AppHandle, path: &Path) -> Result<String, String> {
    require_renderer_scoped_path(app, path)?;
    read_bounded_regular_text(path)
}

fn atomic_write_scoped(app: &tauri::AppHandle, path: &Path, bytes: &[u8]) -> Result<(), String> {
    require_renderer_scoped_path(app, path)?;
    if bytes.len() > MAX_PALETTE_TRANSFER_BYTES {
        return Err(format!(
            "palette export exceeds the {MAX_PALETTE_TRANSFER_BYTES}-byte safety limit"
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "destination has no parent directory".to_string())?;
    let parent_metadata = std::fs::symlink_metadata(parent)
        .map_err(|e| format!("inspect destination directory: {e}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err("destination parent must be a regular directory".to_string());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("destination must be a regular, non-symlink file".to_string());
        }
    }

    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("create temporary file: {e}"))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("write temporary file: {e}"))?;
    tmp.as_file_mut()
        .sync_all()
        .map_err(|e| format!("sync temporary file: {e}"))?;
    tmp.persist(path)
        .map_err(|e| format!("replace destination: {}", e.error))?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| format!("sync destination directory: {e}"))?;
    Ok(())
}

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
    if collection.snippets.len() > MAX_PALETTE_IMPORT_ITEMS {
        return Err(format!(
            "snippet import exceeds the {MAX_PALETTE_IMPORT_ITEMS}-item safety limit"
        ));
    }
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
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.read().await;
    let body = serde_json::to_vec_pretty(&svc.snapshot())
        .map_err(|e| format!("Failed to serialize palette export: {e}"))?;
    atomic_write_scoped(&app, Path::new(&path), &body)
}

#[tauri::command]
pub async fn palette_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
) -> Result<(), String> {
    let content = read_scoped_text(&app, Path::new(&path))?;
    require_bounded_import(&content)?;
    let data = super::import_export::parse_import_data(&content)?;
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
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    mut request: ExportRequest,
) -> Result<ExportResult, String> {
    let output_path = request.output_path.take();
    let svc = state.read().await;
    let mut result = svc.export_advanced(&request)?;
    if let Some(path) = output_path {
        let content = result
            .content
            .take()
            .ok_or_else(|| "palette export produced no content".to_string())?;
        atomic_write_scoped(&app, Path::new(&path), content.as_bytes())?;
        result.path = Some(path);
    }
    Ok(result)
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
    require_bounded_payload("palette import", &content)?;
    let svc = state.read().await;
    Ok(svc.validate_import(&content))
}

/// Validate an import file by path.
#[tauri::command]
pub async fn palette_validate_import_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
) -> Result<ValidationResult, String> {
    let content = read_scoped_text(&app, Path::new(&path))?;
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
    require_bounded_import(&content)?;
    let svc = state.read().await;
    svc.preview_import(&content, &options)
}

/// Preview importing from a file path.
#[tauri::command]
pub async fn palette_preview_import_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let content = read_scoped_text(&app, Path::new(&path))?;
    require_bounded_import(&content)?;
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
    require_bounded_import(&content)?;
    let mut svc = state.write().await;
    let result = svc.import_advanced(&content, &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Import from a file with conflict resolution options.
#[tauri::command]
pub async fn palette_import_file_advanced(
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let content = read_scoped_text(&app, Path::new(&path))?;
    require_bounded_import(&content)?;
    let mut svc = state.write().await;
    let result = svc.import_advanced(&content, &options)?;
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
    require_bounded_import(&json)?;
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
    require_bounded_import(&text)?;
    let mut svc = state.write().await;
    let result = svc.import_from_clipboard(&text, &options)?;
    let _ = svc.save();
    Ok(result)
}

/// Save a share package to a file.
#[tauri::command]
pub async fn palette_save_share_package(
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    metadata: SharePackageMetadata,
    scope: Option<ExportScope>,
    filter: Option<ExportFilter>,
) -> Result<(), String> {
    let svc = state.read().await;
    let pkg = svc.create_share_package(metadata, scope.as_ref(), filter.as_ref())?;
    let json = super::import_export::serialise_share_package(&pkg)?;
    atomic_write_scoped(&app, Path::new(&path), json.as_bytes())
}

/// Load and import a share package from a file path.
#[tauri::command]
pub async fn palette_import_share_package_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, CommandPaletteServiceState>,
    path: String,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    let content = read_scoped_text(&app, Path::new(&path))?;
    require_bounded_import(&content)?;
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

#[cfg(test)]
mod path_security_tests {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "sorng-command-palette-security-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create command-palette security fixture");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn traversal_and_ungranted_paths_are_rejected_without_disclosure() {
        let traversal = Path::new("..").join("vault-secret.json");
        let error = require_absolute_palette_path(&traversal).unwrap_err();
        assert_eq!(error, "selected file path must be absolute");
        assert!(!error.contains("vault-secret"));

        let ungranted = std::env::temp_dir()
            .join("granted")
            .join("..")
            .join("api-token.json");
        let error = require_palette_scope_grant(&ungranted, false).unwrap_err();
        assert_eq!(error, "file path was not granted by the native file picker");
        assert!(!error.contains("api-token"));
    }

    #[test]
    fn oversized_sparse_file_is_rejected_before_reading() {
        let fixture = TestDir::new();
        let path = fixture.path().join("oversized.json");
        let file = fs::File::create(&path).expect("create sparse palette fixture");
        file.set_len(MAX_PALETTE_TRANSFER_BYTES as u64 + 1)
            .expect("size sparse palette fixture");

        let error = read_bounded_regular_text(&path).unwrap_err();
        assert!(error.contains(&format!("{MAX_PALETTE_TRANSFER_BYTES}-byte safety limit")));
    }

    #[test]
    fn directory_cannot_be_read_as_palette_data() {
        let fixture = TestDir::new();
        let error = read_bounded_regular_text(fixture.path()).unwrap_err();
        assert!(error.contains("regular, non-symlink file"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected_before_reading() {
        use std::os::unix::fs::symlink;

        let fixture = TestDir::new();
        let target = fixture.path().join("outside-secret.json");
        fs::write(&target, "{}").expect("write symlink target");
        let link = fixture.path().join("selected.json");
        symlink(&target, &link).expect("create palette symlink fixture");

        let error = read_bounded_regular_text(&link).unwrap_err();
        assert!(error.contains("regular, non-symlink file"));
    }
}
