// ═══════════════════════════════════════════════════════════════════════
//  sorng-command-palette – Extensive import / export engine
// ═══════════════════════════════════════════════════════════════════════
//
//  Supports: JSON, Shell Script, CSV, Markdown, Base64 (clipboard),
//  shareable packages with checksums, selective & filtered export,
//  conflict-aware import with dry-run preview, validation, and more.

use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;
use sha2::{Digest, Sha256};

use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Checksum helpers
// ═══════════════════════════════════════════════════════════════════════

/// Compute SHA-256 hex digest of arbitrary bytes.
fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

// ═══════════════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════════════

/// Main entry-point: run a full export pipeline.
pub fn export(data: &PersistentData, request: &ExportRequest) -> Result<ExportResult, String> {
    // 1. Apply scope + filter to narrow the data.
    let filtered = apply_scope_and_filter(data, &request.scope, &request.filter);

    let stats = ExportStats {
        history_entries: filtered.history.len(),
        snippets: filtered.snippets.len(),
        aliases: filtered.aliases.len(),
        pinned_commands: filtered.pinned_commands.len(),
    };

    // 2. Serialise to the requested format.
    let content = serialise(&filtered, request.format)?;

    // 3. Optionally write to disk.
    if let Some(ref path) = request.output_path {
        std::fs::write(path, &content)
            .map_err(|e| format!("Failed to write export file: {}", e))?;
        Ok(ExportResult {
            content: None,
            path: Some(path.clone()),
            format: request.format,
            stats,
        })
    } else {
        Ok(ExportResult {
            content: Some(content),
            path: None,
            format: request.format,
            stats,
        })
    }
}

/// Export history with specialised options (shell script, CSV, etc.).
pub fn export_history(
    entries: &[HistoryEntry],
    options: &HistoryExportOptions,
    format: ExportFormat,
) -> Result<String, String> {
    let filtered = filter_history(entries, options);
    let sorted = sort_history(filtered, options.sort_by);

    match format {
        ExportFormat::ShellScript => Ok(history_to_shell_script(&sorted, options)),
        ExportFormat::Csv => Ok(history_to_csv(&sorted)),
        ExportFormat::Json => serde_json::to_string_pretty(&sorted)
            .map_err(|e| format!("JSON serialise error: {}", e)),
        ExportFormat::Markdown => Ok(history_to_markdown(&sorted)),
        ExportFormat::Base64 => {
            let json = serde_json::to_string(&sorted).map_err(|e| format!("JSON error: {}", e))?;
            Ok(base64_encode(json.as_bytes()))
        }
    }
}

/// Export snippets filtered by category.
pub fn export_snippets_by_category(
    snippets: &[Snippet],
    categories: &[SnippetCategory],
) -> Vec<Snippet> {
    if categories.is_empty() {
        return snippets.to_vec();
    }
    snippets
        .iter()
        .filter(|s| categories.contains(&s.category))
        .cloned()
        .collect()
}

/// Export snippets filtered by tags.
pub fn export_snippets_by_tags(snippets: &[Snippet], tags: &[String]) -> Vec<Snippet> {
    if tags.is_empty() {
        return snippets.to_vec();
    }
    snippets
        .iter()
        .filter(|s| s.tags.iter().any(|t| tags.contains(t)))
        .cloned()
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════
//  SHARE PACKAGES
// ═══════════════════════════════════════════════════════════════════════

/// Build a share package with metadata and checksum.
pub fn create_share_package(
    data: PersistentData,
    metadata: SharePackageMetadata,
) -> Result<SharePackage, String> {
    let data_json = serde_json::to_string(&data)
        .map_err(|e| format!("Failed to JSON-serialise data: {}", e))?;
    let checksum = sha256_hex(data_json.as_bytes());

    Ok(SharePackage {
        metadata,
        data,
        checksum,
    })
}

/// Serialise a share package to JSON.
pub fn serialise_share_package(pkg: &SharePackage) -> Result<String, String> {
    serde_json::to_string_pretty(pkg).map_err(|e| format!("Serialise error: {}", e))
}

/// Deserialise and verify a share package.
pub fn deserialise_share_package(json: &str) -> Result<SharePackage, String> {
    let pkg: SharePackage =
        serde_json::from_str(json).map_err(|e| format!("Invalid share package: {}", e))?;

    // Verify checksum.
    let data_json =
        serde_json::to_string(&pkg.data).map_err(|e| format!("Re-serialise error: {}", e))?;
    let computed = sha256_hex(data_json.as_bytes());
    if computed != pkg.checksum {
        return Err(format!(
            "Checksum mismatch: expected {}, computed {}",
            pkg.checksum, computed
        ));
    }

    Ok(pkg)
}

// ═══════════════════════════════════════════════════════════════════════
//  CLIPBOARD
// ═══════════════════════════════════════════════════════════════════════

/// Encode palette data for clipboard sharing.
pub fn encode_for_clipboard(data: &PersistentData) -> Result<String, String> {
    let json = serde_json::to_string(data).map_err(|e| format!("JSON error: {}", e))?;
    let b64 = base64_encode(json.as_bytes());
    let checksum = sha256_hex(json.as_bytes());

    let payload = ClipboardPayload {
        magic: ClipboardPayload::MAGIC.to_string(),
        version: 1,
        data: b64,
        checksum: Some(checksum),
    };

    serde_json::to_string(&payload).map_err(|e| format!("Payload serialise error: {}", e))
}

/// Decode palette data from a clipboard string.
pub fn decode_from_clipboard(text: &str) -> Result<PersistentData, String> {
    let payload: ClipboardPayload =
        serde_json::from_str(text).map_err(|e| format!("Invalid clipboard payload: {}", e))?;

    if payload.magic != ClipboardPayload::MAGIC {
        return Err(format!(
            "Not a SortOfRemoteNG palette payload (magic: {})",
            payload.magic
        ));
    }

    let decoded = base64_decode(&payload.data)?;
    let json = String::from_utf8(decoded).map_err(|e| format!("UTF-8 error: {}", e))?;

    // Verify checksum if present.
    if let Some(ref expected) = payload.checksum {
        let computed = sha256_hex(json.as_bytes());
        if &computed != expected {
            return Err("Clipboard payload checksum mismatch".to_string());
        }
    }

    serde_json::from_str(&json).map_err(|e| format!("Data parse error: {}", e))
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT
// ═══════════════════════════════════════════════════════════════════════

/// Detect the format of a file by examining its content.
pub fn detect_format(content: &str) -> Option<ExportFormat> {
    let trimmed = content.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        // Could be plain JSON or a share package.
        Some(ExportFormat::Json)
    } else if trimmed.starts_with("#!/") || trimmed.starts_with("# ") {
        Some(ExportFormat::ShellScript)
    } else if trimmed.contains(",\"command\"") || trimmed.starts_with("command,") {
        Some(ExportFormat::Csv)
    } else if trimmed.starts_with('#') && trimmed.contains("##") {
        Some(ExportFormat::Markdown)
    } else {
        // Try base64 decode.
        if base64_decode(trimmed).is_ok() {
            Some(ExportFormat::Base64)
        } else {
            None
        }
    }
}

/// Validate an import file without actually importing.
pub fn validate_import(content: &str) -> ValidationResult {
    let detected = detect_format(content);
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut summary = ExportStats::default();
    let mut pkg_meta = None;
    let mut checksum_valid = None;

    match detected {
        Some(ExportFormat::Json) => {
            // Try SharePackage first.
            if let Ok(pkg) = serde_json::from_str::<SharePackage>(content) {
                let data_json = serde_json::to_string(&pkg.data).unwrap_or_default();
                let computed = sha256_hex(data_json.as_bytes());
                checksum_valid = Some(computed == pkg.checksum);
                if checksum_valid == Some(false) {
                    warnings.push("Package checksum does not match — data may be corrupted".into());
                }
                pkg_meta = Some(pkg.metadata.clone());
                summary = count_persistent_data(&pkg.data);
            } else if let Ok(data) = serde_json::from_str::<PersistentData>(content) {
                summary = count_persistent_data(&data);
            } else if let Ok(coll) = serde_json::from_str::<SnippetCollection>(content) {
                summary.snippets = coll.snippets.len();
            } else {
                errors.push("JSON does not match any known palette format".into());
            }
        }
        Some(ExportFormat::Base64) => {
            // Try clipboard payload.
            match decode_from_clipboard(content) {
                Ok(data) => {
                    summary = count_persistent_data(&data);
                }
                Err(e) => {
                    // Try raw base64 -> JSON.
                    match base64_decode(content.trim()) {
                        Ok(bytes) => {
                            let json = String::from_utf8_lossy(&bytes);
                            if let Ok(data) = serde_json::from_str::<PersistentData>(&json) {
                                summary = count_persistent_data(&data);
                            } else {
                                errors.push(format!(
                                    "Base64 decodes but is not valid palette data: {}",
                                    e
                                ));
                            }
                        }
                        Err(e2) => errors.push(format!("Base64 decode failed: {}", e2)),
                    }
                }
            }
        }
        Some(ExportFormat::Csv) => {
            let lines = content.lines().count();
            summary.history_entries = lines.saturating_sub(1);
            if lines < 2 {
                warnings.push("CSV file appears empty".into());
            }
        }
        Some(ExportFormat::ShellScript) => {
            let cmds = content
                .lines()
                .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
                .count();
            summary.history_entries = cmds;
        }
        Some(ExportFormat::Markdown) => {
            warnings.push("Markdown import is not supported (export-only format)".into());
            errors.push("Cannot import Markdown — use JSON, CSV, or shell script".into());
        }
        None => {
            errors.push("Unable to detect file format".into());
        }
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
        content_summary: summary,
        detected_format: detected,
        package_metadata: pkg_meta,
        checksum_valid,
    }
}

/// Parse importable data from a string, handling all supported formats.
pub fn parse_import_data(content: &str) -> Result<PersistentData, String> {
    let trimmed = content.trim();

    // 1. Try clipboard payload.
    if let Ok(data) = decode_from_clipboard(trimmed) {
        return Ok(data);
    }

    // 2. Try SharePackage JSON.
    if let Ok(pkg) = serde_json::from_str::<SharePackage>(trimmed) {
        let data_json = serde_json::to_string(&pkg.data).unwrap_or_default();
        let computed = sha256_hex(data_json.as_bytes());
        if computed != pkg.checksum {
            log::warn!("Share package checksum mismatch during import");
        }
        return Ok(pkg.data);
    }

    // 3. Try PersistentData JSON.
    if let Ok(data) = serde_json::from_str::<PersistentData>(trimmed) {
        return Ok(data);
    }

    // 4. Try SnippetCollection JSON.
    if let Ok(coll) = serde_json::from_str::<SnippetCollection>(trimmed) {
        let data = PersistentData {
            snippets: coll.snippets,
            ..Default::default()
        };
        return Ok(data);
    }

    // 5. Try CSV.
    if trimmed.starts_with("command,") || trimmed.contains(",\"command\"") {
        let entries = parse_csv_history(trimmed)?;
        let data = PersistentData {
            history: entries,
            ..Default::default()
        };
        return Ok(data);
    }

    // 6. Try shell script.
    if trimmed.starts_with("#!/") || (trimmed.starts_with("# ") && trimmed.lines().count() > 1) {
        let entries = parse_shell_script_history(trimmed);
        let data = PersistentData {
            history: entries,
            ..Default::default()
        };
        return Ok(data);
    }

    // 7. Try raw base64.
    if let Ok(bytes) = base64_decode(trimmed) {
        if let Ok(json) = String::from_utf8(bytes) {
            if let Ok(data) = serde_json::from_str::<PersistentData>(&json) {
                return Ok(data);
            }
        }
    }

    Err("Unable to parse import data — no recognised format".to_string())
}

/// Import data into an existing `PersistentData` with conflict resolution.
pub fn import_with_options(
    existing: &PersistentData,
    incoming: &PersistentData,
    options: &ImportOptions,
) -> ImportResult {
    let mut result = ImportResult {
        dry_run: options.dry_run,
        added: ImportCounts::default(),
        updated: ImportCounts::default(),
        skipped: ImportCounts::default(),
        conflicts: Vec::new(),
        warnings: Vec::new(),
        errors: Vec::new(),
    };

    // ── Apply scope filter to incoming data ──
    let filtered = apply_scope_and_filter(incoming, &options.scope, &options.filter);

    // ── History ──
    if options.scope.history {
        let existing_cmds: HashMap<String, &HistoryEntry> = existing
            .history
            .iter()
            .map(|e| (normalise_cmd(&e.command), e))
            .collect();

        for entry in &filtered.history {
            let norm = normalise_cmd(&entry.command);
            if let Some(existing_entry) = existing_cmds.get(&norm) {
                // Conflict!
                let resolution = options.conflict_strategy;
                result.conflicts.push(ImportConflict {
                    data_type: "history".into(),
                    identifier: entry.command.clone(),
                    description: format!(
                        "Existing: {} uses, last {}; Incoming: {} uses, last {}",
                        existing_entry.use_count,
                        existing_entry.last_used.format("%Y-%m-%d"),
                        entry.use_count,
                        entry.last_used.format("%Y-%m-%d"),
                    ),
                    resolution,
                });
                match resolution {
                    ConflictStrategy::Skip => result.skipped.history += 1,
                    ConflictStrategy::Overwrite
                    | ConflictStrategy::Merge
                    | ConflictStrategy::NewestWins => result.updated.history += 1,
                    ConflictStrategy::Rename => result.added.history += 1,
                }
            } else {
                result.added.history += 1;
            }
        }
    }

    // ── Snippets ──
    if options.scope.snippets {
        let existing_ids: HashMap<&str, &Snippet> = existing
            .snippets
            .iter()
            .map(|s| (s.id.as_str(), s))
            .collect();

        for snippet in &filtered.snippets {
            if let Some(existing_snippet) = existing_ids.get(snippet.id.as_str()) {
                let resolution = options.conflict_strategy;
                result.conflicts.push(ImportConflict {
                    data_type: "snippet".into(),
                    identifier: snippet.name.clone(),
                    description: format!(
                        "Existing: '{}' ({}); Incoming: '{}' ({})",
                        existing_snippet.name,
                        existing_snippet
                            .updated_at
                            .map(|d| d.format("%Y-%m-%d").to_string())
                            .unwrap_or_else(|| "unknown".into()),
                        snippet.name,
                        snippet
                            .updated_at
                            .map(|d| d.format("%Y-%m-%d").to_string())
                            .unwrap_or_else(|| "unknown".into()),
                    ),
                    resolution,
                });
                match resolution {
                    ConflictStrategy::Skip => result.skipped.snippets += 1,
                    ConflictStrategy::Overwrite
                    | ConflictStrategy::Merge
                    | ConflictStrategy::NewestWins => result.updated.snippets += 1,
                    ConflictStrategy::Rename => result.added.snippets += 1,
                }
            } else {
                result.added.snippets += 1;
            }
        }
    }

    // ── Aliases ──
    if options.scope.aliases {
        let existing_triggers: HashMap<&str, &Alias> = existing
            .aliases
            .iter()
            .map(|a| (a.trigger.as_str(), a))
            .collect();

        for alias in &filtered.aliases {
            if existing_triggers.contains_key(alias.trigger.as_str()) {
                let resolution = options.conflict_strategy;
                result.conflicts.push(ImportConflict {
                    data_type: "alias".into(),
                    identifier: alias.trigger.clone(),
                    description: format!(
                        "Trigger '{}' already mapped to '{}'",
                        alias.trigger,
                        existing_triggers[alias.trigger.as_str()].expansion,
                    ),
                    resolution,
                });
                match resolution {
                    ConflictStrategy::Skip => result.skipped.aliases += 1,
                    ConflictStrategy::Overwrite
                    | ConflictStrategy::Merge
                    | ConflictStrategy::NewestWins => result.updated.aliases += 1,
                    ConflictStrategy::Rename => result.added.aliases += 1,
                }
            } else {
                result.added.aliases += 1;
            }
        }
    }

    // ── Pinned ──
    if options.scope.pinned_commands {
        for cmd in &filtered.pinned_commands {
            if existing.pinned_commands.contains(cmd) {
                result.skipped.pinned_commands += 1;
            } else {
                result.added.pinned_commands += 1;
            }
        }
    }

    result
}

/// Actually apply an import, mutating `target`.
pub fn apply_import(
    target: &mut PersistentData,
    incoming: &PersistentData,
    options: &ImportOptions,
) {
    let filtered = apply_scope_and_filter(incoming, &options.scope, &options.filter);

    // ── History ──
    if options.scope.history {
        let mut cmd_map: HashMap<String, usize> = target
            .history
            .iter()
            .enumerate()
            .map(|(i, e)| (normalise_cmd(&e.command), i))
            .collect();

        for entry in filtered.history {
            let norm = normalise_cmd(&entry.command);
            if let Some(&idx) = cmd_map.get(&norm) {
                match options.conflict_strategy {
                    ConflictStrategy::Skip => {}
                    ConflictStrategy::Overwrite => {
                        target.history[idx] = entry;
                    }
                    ConflictStrategy::Rename => {
                        let mut renamed = entry;
                        renamed.command = format!("{} #imported", renamed.command);
                        target.history.push(renamed);
                    }
                    ConflictStrategy::Merge | ConflictStrategy::NewestWins => {
                        let existing = &mut target.history[idx];
                        if entry.use_count > existing.use_count {
                            existing.use_count = entry.use_count;
                        }
                        if entry.last_used > existing.last_used {
                            existing.last_used = entry.last_used;
                            existing.session_id = entry.session_id;
                            existing.host = entry.host.or(existing.host.take());
                            existing.username = entry.username.or(existing.username.take());
                            existing.cwd = entry.cwd.or(existing.cwd.take());
                            existing.exit_code = entry.exit_code.or(existing.exit_code);
                            existing.duration_ms = entry.duration_ms.or(existing.duration_ms);
                        }
                        for tag in entry.tags {
                            if !existing.tags.contains(&tag) {
                                existing.tags.push(tag);
                            }
                        }
                        existing.pinned = existing.pinned || entry.pinned;
                    }
                }
            } else {
                let new_idx = target.history.len();
                cmd_map.insert(norm, new_idx);
                target.history.push(entry);
            }
        }
    }

    // ── Snippets ──
    if options.scope.snippets {
        let mut id_map: HashMap<String, usize> = target
            .snippets
            .iter()
            .enumerate()
            .map(|(i, s)| (s.id.clone(), i))
            .collect();

        for snippet in filtered.snippets {
            if let Some(&idx) = id_map.get(&snippet.id) {
                match options.conflict_strategy {
                    ConflictStrategy::Skip => {}
                    ConflictStrategy::Overwrite => {
                        target.snippets[idx] = snippet;
                    }
                    ConflictStrategy::Rename => {
                        let mut renamed = snippet;
                        renamed.id = format!("{}-imported", renamed.id);
                        renamed.name = format!("{} (imported)", renamed.name);
                        let new_idx = target.snippets.len();
                        id_map.insert(renamed.id.clone(), new_idx);
                        target.snippets.push(renamed);
                    }
                    ConflictStrategy::Merge => {
                        let existing = &mut target.snippets[idx];
                        if snippet.use_count > existing.use_count {
                            existing.use_count = snippet.use_count;
                        }
                        if snippet.last_used > existing.last_used {
                            existing.last_used = snippet.last_used;
                        }
                        for tag in snippet.tags {
                            if !existing.tags.contains(&tag) {
                                existing.tags.push(tag);
                            }
                        }
                    }
                    ConflictStrategy::NewestWins => {
                        let existing_ts = target.snippets[idx].updated_at;
                        let incoming_ts = snippet.updated_at;
                        if incoming_ts > existing_ts {
                            target.snippets[idx] = snippet;
                        }
                    }
                }
            } else {
                let new_idx = target.snippets.len();
                id_map.insert(snippet.id.clone(), new_idx);
                target.snippets.push(snippet);
            }
        }
    }

    // ── Aliases ──
    if options.scope.aliases {
        let mut trigger_map: HashMap<String, usize> = target
            .aliases
            .iter()
            .enumerate()
            .map(|(i, a)| (a.trigger.clone(), i))
            .collect();

        for alias in filtered.aliases {
            if let Some(&idx) = trigger_map.get(&alias.trigger) {
                match options.conflict_strategy {
                    ConflictStrategy::Skip => {}
                    ConflictStrategy::Overwrite | ConflictStrategy::NewestWins => {
                        target.aliases[idx] = alias;
                    }
                    ConflictStrategy::Rename => {
                        let mut renamed = alias;
                        renamed.trigger = format!("{}-imported", renamed.trigger);
                        let new_idx = target.aliases.len();
                        trigger_map.insert(renamed.trigger.clone(), new_idx);
                        target.aliases.push(renamed);
                    }
                    ConflictStrategy::Merge => {
                        let existing = &mut target.aliases[idx];
                        if alias.use_count > existing.use_count {
                            existing.use_count = alias.use_count;
                        }
                    }
                }
            } else {
                let new_idx = target.aliases.len();
                trigger_map.insert(alias.trigger.clone(), new_idx);
                target.aliases.push(alias);
            }
        }
    }

    // ── Pinned commands ──
    if options.scope.pinned_commands {
        for cmd in filtered.pinned_commands {
            if !target.pinned_commands.contains(&cmd) {
                target.pinned_commands.push(cmd);
            }
        }
    }

    // ── Config (only if requested) ──
    if options.scope.config {
        target.config = incoming.config.clone();
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  IMPORT FROM FILE
// ═══════════════════════════════════════════════════════════════════════

/// High-level: read a file, parse its content, and return importable data.
pub fn import_from_file(path: &Path) -> Result<PersistentData, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
    parse_import_data(&content)
}

/// Import a file with options (dry-run + conflict detection).
pub fn import_file_with_options(
    path: &Path,
    existing: &PersistentData,
    options: &ImportOptions,
) -> Result<(PersistentData, ImportResult), String> {
    let incoming = import_from_file(path)?;
    let preview = import_with_options(existing, &incoming, options);
    Ok((incoming, preview))
}

// ═══════════════════════════════════════════════════════════════════════
//  SERIALISATION HELPERS (internal)
// ═══════════════════════════════════════════════════════════════════════

fn serialise(data: &PersistentData, format: ExportFormat) -> Result<String, String> {
    match format {
        ExportFormat::Json => {
            serde_json::to_string_pretty(data).map_err(|e| format!("JSON serialise error: {}", e))
        }
        ExportFormat::ShellScript => Ok(persistent_data_to_shell(data)),
        ExportFormat::Csv => Ok(persistent_data_to_csv(data)),
        ExportFormat::Markdown => Ok(persistent_data_to_markdown(data)),
        ExportFormat::Base64 => {
            let json = serde_json::to_string(data).map_err(|e| format!("JSON error: {}", e))?;
            Ok(base64_encode(json.as_bytes()))
        }
    }
}

// ─────────── Shell script ───────────

fn persistent_data_to_shell(data: &PersistentData) -> String {
    let mut out = String::new();
    out.push_str("#!/bin/bash\n");
    out.push_str("# ══════════════════════════════════════════════════════════════\n");
    out.push_str("# SortOfRemoteNG — Command Palette Export\n");
    out.push_str(&format!(
        "# Exported at: {}\n",
        data.saved_at.format("%Y-%m-%d %H:%M:%S UTC")
    ));
    out.push_str("# ══════════════════════════════════════════════════════════════\n\n");

    if !data.history.is_empty() {
        out.push_str("# ── History ──\n");
        for entry in &data.history {
            if let Some(ref host) = entry.host {
                out.push_str(&format!("# host: {}", host));
            }
            out.push_str(&format!(
                "  # uses: {} | last: {}\n",
                entry.use_count,
                entry.last_used.format("%Y-%m-%d")
            ));
            out.push_str(&format!("{}\n", entry.command));
        }
        out.push('\n');
    }

    if !data.snippets.is_empty() {
        out.push_str("# ── Snippets ──\n");
        for snippet in &data.snippets {
            out.push_str(&format!(
                "# snippet: {} — {}\n",
                snippet.name, snippet.description
            ));
            if let Some(ref trigger) = snippet.trigger {
                out.push_str(&format!("# trigger: {}\n", trigger));
            }
            out.push_str(&format!("{}\n\n", snippet.template));
        }
    }

    if !data.aliases.is_empty() {
        out.push_str("# ── Aliases ──\n");
        for alias in &data.aliases {
            out.push_str(&format!(
                "alias {}='{}'\n",
                shell_escape(&alias.trigger),
                shell_escape(&alias.expansion)
            ));
        }
    }

    out
}

fn history_to_shell_script(entries: &[HistoryEntry], opts: &HistoryExportOptions) -> String {
    let mut out = String::new();
    out.push_str("#!/bin/bash\n");
    out.push_str("# SortOfRemoteNG — History Export\n");
    out.push_str(&format!(
        "# Exported at: {}\n",
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
    ));
    if let Some(ref host) = opts.host {
        out.push_str(&format!("# Host filter: {}\n", host));
    }
    out.push_str(&format!("# {} commands\n\n", entries.len()));

    for entry in entries {
        if opts.include_metadata_comments {
            let mut meta_parts = Vec::new();
            if let Some(ref host) = entry.host {
                meta_parts.push(format!("host:{}", host));
            }
            if let Some(ref user) = entry.username {
                meta_parts.push(format!("user:{}", user));
            }
            meta_parts.push(format!("uses:{}", entry.use_count));
            meta_parts.push(format!("last:{}", entry.last_used.format("%Y-%m-%d")));
            if let Some(code) = entry.exit_code {
                meta_parts.push(format!("exit:{}", code));
            }
            if let Some(ms) = entry.duration_ms {
                meta_parts.push(format!("{}ms", ms));
            }
            if !entry.tags.is_empty() {
                meta_parts.push(format!("tags:{}", entry.tags.join(",")));
            }
            out.push_str(&format!("# {}\n", meta_parts.join(" | ")));
        }
        out.push_str(&format!("{}\n", entry.command));
    }

    out
}

// ─────────── CSV ───────────

fn persistent_data_to_csv(data: &PersistentData) -> String {
    history_to_csv(&data.history)
}

fn history_to_csv(entries: &[HistoryEntry]) -> String {
    let mut out = String::new();
    out.push_str("command,host,username,cwd,exit_code,duration_ms,first_used,last_used,use_count,pinned,tags\n");

    for entry in entries {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{}\n",
            csv_escape(&entry.command),
            csv_escape(entry.host.as_deref().unwrap_or("")),
            csv_escape(entry.username.as_deref().unwrap_or("")),
            csv_escape(entry.cwd.as_deref().unwrap_or("")),
            entry.exit_code.map(|c| c.to_string()).unwrap_or_default(),
            entry.duration_ms.map(|d| d.to_string()).unwrap_or_default(),
            entry.first_used.to_rfc3339(),
            entry.last_used.to_rfc3339(),
            entry.use_count,
            entry.pinned,
            csv_escape(&entry.tags.join(";")),
        ));
    }

    out
}

fn parse_csv_history(content: &str) -> Result<Vec<HistoryEntry>, String> {
    let mut entries = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    if lines.len() < 2 {
        return Ok(entries);
    }

    // Skip header.
    for (line_num, line) in lines.iter().enumerate().skip(1) {
        let cols = parse_csv_line(line);
        if cols.len() < 9 {
            log::warn!(
                "CSV line {} has fewer than 9 columns, skipping",
                line_num + 1
            );
            continue;
        }

        let first_used = chrono::DateTime::parse_from_rfc3339(&cols[6])
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());
        let last_used = chrono::DateTime::parse_from_rfc3339(&cols[7])
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        entries.push(HistoryEntry {
            command: cols[0].clone(),
            session_id: String::new(),
            host: if cols[1].is_empty() {
                None
            } else {
                Some(cols[1].clone())
            },
            username: if cols[2].is_empty() {
                None
            } else {
                Some(cols[2].clone())
            },
            cwd: if cols[3].is_empty() {
                None
            } else {
                Some(cols[3].clone())
            },
            exit_code: cols[4].parse().ok(),
            duration_ms: cols[5].parse().ok(),
            first_used,
            last_used,
            use_count: cols[8].parse().unwrap_or(1),
            tags: if cols.len() > 10 && !cols[10].is_empty() {
                cols[10].split(';').map(|s| s.to_string()).collect()
            } else {
                Vec::new()
            },
            pinned: cols.get(9).map(|v| v == "true").unwrap_or(false),
            os_context: None,
        });
    }

    Ok(entries)
}

/// Simple CSV line parser that handles quoted fields.
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    current.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                current.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' {
            fields.push(current.clone());
            current.clear();
        } else {
            current.push(ch);
        }
    }
    fields.push(current);
    fields
}

// ─────────── Markdown ───────────

fn persistent_data_to_markdown(data: &PersistentData) -> String {
    let mut out = String::new();
    out.push_str("# SortOfRemoteNG — Command Palette Export\n\n");
    out.push_str(&format!(
        "> Exported at **{}**\n\n",
        data.saved_at.format("%Y-%m-%d %H:%M:%S UTC")
    ));

    // Summary table.
    out.push_str("## Summary\n\n");
    out.push_str("| Category | Count |\n");
    out.push_str("|----------|-------|\n");
    out.push_str(&format!("| History entries | {} |\n", data.history.len()));
    out.push_str(&format!("| Snippets | {} |\n", data.snippets.len()));
    out.push_str(&format!("| Aliases | {} |\n", data.aliases.len()));
    out.push_str(&format!(
        "| Pinned commands | {} |\n\n",
        data.pinned_commands.len()
    ));

    // History.
    if !data.history.is_empty() {
        out.push_str("## History\n\n");
        out.push_str("| Command | Host | Uses | Last Used | Exit |\n");
        out.push_str("|---------|------|------|-----------|------|\n");
        for entry in &data.history {
            out.push_str(&format!(
                "| `{}` | {} | {} | {} | {} |\n",
                md_escape(&entry.command),
                entry.host.as_deref().unwrap_or("—"),
                entry.use_count,
                entry.last_used.format("%Y-%m-%d"),
                entry
                    .exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "—".into()),
            ));
        }
        out.push('\n');
    }

    // Snippets.
    if !data.snippets.is_empty() {
        out.push_str("## Snippets\n\n");
        for snippet in &data.snippets {
            out.push_str(&format!("### {}\n\n", snippet.name));
            out.push_str(&format!("{}\n\n", snippet.description));
            out.push_str(&format!("- **Category:** {:?}\n", snippet.category));
            if let Some(ref trigger) = snippet.trigger {
                out.push_str(&format!("- **Trigger:** `{}`\n", trigger));
            }
            if !snippet.tags.is_empty() {
                out.push_str(&format!("- **Tags:** {}\n", snippet.tags.join(", ")));
            }
            out.push_str(&format!("\n```bash\n{}\n```\n\n", snippet.template));
        }
    }

    // Aliases.
    if !data.aliases.is_empty() {
        out.push_str("## Aliases\n\n");
        out.push_str("| Trigger | Expansion | Description |\n");
        out.push_str("|---------|-----------|-------------|\n");
        for alias in &data.aliases {
            out.push_str(&format!(
                "| `{}` | `{}` | {} |\n",
                alias.trigger,
                alias.expansion,
                alias.description.as_deref().unwrap_or(""),
            ));
        }
        out.push('\n');
    }

    out
}

fn history_to_markdown(entries: &[HistoryEntry]) -> String {
    let mut out = String::new();
    out.push_str("# Command History Export\n\n");
    out.push_str(&format!(
        "> {} entries exported at {}\n\n",
        entries.len(),
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
    ));
    out.push_str("| # | Command | Host | Uses | Last Used | Exit |\n");
    out.push_str("|---|---------|------|------|-----------|------|\n");
    for (i, entry) in entries.iter().enumerate() {
        out.push_str(&format!(
            "| {} | `{}` | {} | {} | {} | {} |\n",
            i + 1,
            md_escape(&entry.command),
            entry.host.as_deref().unwrap_or("—"),
            entry.use_count,
            entry.last_used.format("%Y-%m-%d"),
            entry
                .exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "—".into()),
        ));
    }
    out
}

// ─────────── Shell script import ───────────

fn parse_shell_script_history(content: &str) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    let now = Utc::now();

    for line in content.lines() {
        let trimmed = line.trim();
        // Skip empty, shebangs, and comment lines.
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        entries.push(HistoryEntry {
            command: trimmed.to_string(),
            session_id: String::new(),
            host: None,
            username: None,
            cwd: None,
            exit_code: None,
            duration_ms: None,
            first_used: now,
            last_used: now,
            use_count: 1,
            tags: vec!["imported".to_string()],
            pinned: false,
            os_context: None,
        });
    }

    entries
}

// ═══════════════════════════════════════════════════════════════════════
//  FILTERING HELPERS
// ═══════════════════════════════════════════════════════════════════════

/// Apply scope and filter to a `PersistentData`, returning a new filtered copy.
fn apply_scope_and_filter(
    data: &PersistentData,
    scope: &ExportScope,
    filter: &ExportFilter,
) -> PersistentData {
    PersistentData {
        history: if scope.history {
            filter_history_entries(&data.history, filter)
        } else {
            Vec::new()
        },
        snippets: if scope.snippets {
            filter_snippets(&data.snippets, filter)
        } else {
            Vec::new()
        },
        aliases: if scope.aliases {
            filter_aliases(&data.aliases, filter)
        } else {
            Vec::new()
        },
        pinned_commands: if scope.pinned_commands {
            data.pinned_commands.clone()
        } else {
            Vec::new()
        },
        config: data.config.clone(),
        saved_at: data.saved_at,
        version: data.version,
    }
}

fn filter_history_entries(entries: &[HistoryEntry], filter: &ExportFilter) -> Vec<HistoryEntry> {
    entries
        .iter()
        .filter(|e| {
            // Host filter.
            if !filter.hosts.is_empty() {
                match &e.host {
                    Some(h) => {
                        if !filter.hosts.iter().any(|fh| fh == h) {
                            return false;
                        }
                    }
                    None => return false,
                }
            }
            // Tag filter.
            if !filter.tags.is_empty() && !e.tags.iter().any(|t| filter.tags.contains(t)) {
                return false;
            }
            // Session filter.
            if !filter.session_ids.is_empty() && !filter.session_ids.contains(&e.session_id) {
                return false;
            }
            // Date range.
            if let Some(from) = filter.date_from {
                if e.last_used < from {
                    return false;
                }
            }
            if let Some(to) = filter.date_to {
                if e.last_used > to {
                    return false;
                }
            }
            // Exit code filter.
            if !filter.exit_codes.is_empty() {
                match e.exit_code {
                    Some(c) => {
                        if !filter.exit_codes.contains(&c) {
                            return false;
                        }
                    }
                    None => return false,
                }
            }
            // Min use count.
            if let Some(min) = filter.min_use_count {
                if e.use_count < min {
                    return false;
                }
            }
            // Pinned only.
            if filter.pinned_only && !e.pinned {
                return false;
            }
            // Text query.
            if let Some(ref q) = filter.text_query {
                let lower = q.to_lowercase();
                if !e.command.to_lowercase().contains(&lower) {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

fn filter_snippets(snippets: &[Snippet], filter: &ExportFilter) -> Vec<Snippet> {
    snippets
        .iter()
        .filter(|s| {
            // Category filter.
            if !filter.snippet_categories.is_empty()
                && !filter.snippet_categories.contains(&s.category)
            {
                return false;
            }
            // Tag filter.
            if !filter.tags.is_empty() && !s.tags.iter().any(|t| filter.tags.contains(t)) {
                return false;
            }
            // Builtin filter.
            if let Some(builtin) = filter.builtin_snippets {
                if s.is_builtin != builtin {
                    return false;
                }
            }
            // Risk level.
            if let Some(ref min_risk) = filter.min_risk_level {
                if risk_ordinal(&s.risk_level) < risk_ordinal(min_risk) {
                    return false;
                }
            }
            if let Some(ref max_risk) = filter.max_risk_level {
                if risk_ordinal(&s.risk_level) > risk_ordinal(max_risk) {
                    return false;
                }
            }
            // Min use count.
            if let Some(min) = filter.min_use_count {
                if s.use_count < min {
                    return false;
                }
            }
            // Text query.
            if let Some(ref q) = filter.text_query {
                let lower = q.to_lowercase();
                if !s.name.to_lowercase().contains(&lower)
                    && !s.description.to_lowercase().contains(&lower)
                    && !s.template.to_lowercase().contains(&lower)
                {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

fn filter_aliases(aliases: &[Alias], filter: &ExportFilter) -> Vec<Alias> {
    aliases
        .iter()
        .filter(|a| {
            // Tag filter — aliases don't have tags, but we can filter by text.
            if let Some(ref q) = filter.text_query {
                let lower = q.to_lowercase();
                if !a.trigger.to_lowercase().contains(&lower)
                    && !a.expansion.to_lowercase().contains(&lower)
                {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

fn filter_history(entries: &[HistoryEntry], options: &HistoryExportOptions) -> Vec<HistoryEntry> {
    entries
        .iter()
        .filter(|e| {
            if let Some(ref host) = options.host {
                if e.host.as_deref() != Some(host.as_str()) {
                    return false;
                }
            }
            if let Some(ref sid) = options.session_id {
                if &e.session_id != sid {
                    return false;
                }
            }
            if let Some(from) = options.from {
                if e.last_used < from {
                    return false;
                }
            }
            if let Some(to) = options.to {
                if e.last_used > to {
                    return false;
                }
            }
            if options.successful_only && e.exit_code != Some(0) {
                return false;
            }
            true
        })
        .cloned()
        .collect()
}

fn sort_history(mut entries: Vec<HistoryEntry>, order: HistorySortOrder) -> Vec<HistoryEntry> {
    match order {
        HistorySortOrder::MostRecent => {
            entries.sort_by(|a, b| b.last_used.cmp(&a.last_used));
        }
        HistorySortOrder::MostUsed => {
            entries.sort_by(|a, b| b.use_count.cmp(&a.use_count));
        }
        HistorySortOrder::Alphabetical => {
            entries.sort_by(|a, b| a.command.to_lowercase().cmp(&b.command.to_lowercase()));
        }
        HistorySortOrder::Chronological => {
            entries.sort_by(|a, b| a.first_used.cmp(&b.first_used));
        }
    }
    entries
}

// ═══════════════════════════════════════════════════════════════════════
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════════

fn risk_ordinal(level: &PaletteRiskLevel) -> u8 {
    match level {
        PaletteRiskLevel::Safe => 0,
        PaletteRiskLevel::Low => 1,
        PaletteRiskLevel::Medium => 2,
        PaletteRiskLevel::High => 3,
        PaletteRiskLevel::Critical => 4,
    }
}

fn normalise_cmd(cmd: &str) -> String {
    cmd.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn count_persistent_data(data: &PersistentData) -> ExportStats {
    ExportStats {
        history_entries: data.history.len(),
        snippets: data.snippets.len(),
        aliases: data.aliases.len(),
        pinned_commands: data.pinned_commands.len(),
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn shell_escape(s: &str) -> String {
    s.replace('\'', "'\\''")
}

fn md_escape(s: &str) -> String {
    s.replace('|', "\\|").replace('`', "\\`")
}

// ─────────── Base64 (no external dep) ───────────

const B64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut result = String::new();
    let chunks = data.chunks(3);
    for chunk in chunks {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(B64_CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(B64_CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(B64_CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(B64_CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let input = input.trim().replace(['\n', '\r', ' '], "");
    if input.is_empty() {
        return Err("Empty base64 input".into());
    }
    if !input.len().is_multiple_of(4) {
        return Err("Invalid base64 length".into());
    }

    let mut output = Vec::new();
    for chunk in input.as_bytes().chunks(4) {
        let vals: Vec<u8> = chunk
            .iter()
            .map(|&b| b64_val(b))
            .collect::<Result<Vec<_>, _>>()?;

        let triple = ((vals[0] as u32) << 18)
            | ((vals[1] as u32) << 12)
            | ((vals[2] as u32) << 6)
            | (vals[3] as u32);

        output.push(((triple >> 16) & 0xFF) as u8);
        if chunk[2] != b'=' {
            output.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk[3] != b'=' {
            output.push((triple & 0xFF) as u8);
        }
    }
    Ok(output)
}

fn b64_val(c: u8) -> Result<u8, String> {
    match c {
        b'A'..=b'Z' => Ok(c - b'A'),
        b'a'..=b'z' => Ok(c - b'a' + 26),
        b'0'..=b'9' => Ok(c - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        b'=' => Ok(0),
        _ => Err(format!("Invalid base64 character: {}", c as char)),
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_data() -> PersistentData {
        PersistentData {
            history: vec![
                HistoryEntry {
                    command: "ls -la".into(),
                    session_id: "s1".into(),
                    host: Some("server1".into()),
                    username: Some("root".into()),
                    cwd: Some("/root".into()),
                    exit_code: Some(0),
                    duration_ms: Some(50),
                    first_used: Utc::now(),
                    last_used: Utc::now(),
                    use_count: 5,
                    tags: vec!["common".into()],
                    pinned: false,
                    os_context: None,
                },
                HistoryEntry {
                    command: "docker ps".into(),
                    session_id: "s2".into(),
                    host: Some("server2".into()),
                    username: Some("admin".into()),
                    cwd: None,
                    exit_code: Some(1),
                    duration_ms: Some(200),
                    first_used: Utc::now(),
                    last_used: Utc::now(),
                    use_count: 3,
                    tags: vec!["docker".into()],
                    pinned: true,
                    os_context: None,
                },
            ],
            snippets: vec![Snippet {
                id: "snip1".into(),
                name: "List files".into(),
                description: "List all files".into(),
                template: "ls -la {{path}}".into(),
                parameters: vec![SnippetParameter {
                    name: "path".into(),
                    label: Some("Path".into()),
                    description: None,
                    default_value: Some(".".into()),
                    required: false,
                    placeholder: None,
                    validation_regex: None,
                    choices: Vec::new(),
                }],
                category: SnippetCategory::FileOperations,
                trigger: Some("!ls".into()),
                tags: vec!["files".into()],
                risk_level: PaletteRiskLevel::Safe,
                is_builtin: false,
                created_at: Utc::now(),
                updated_at: None,
                use_count: 10,
                last_used: Some(Utc::now()),
                os_target: OsTarget::default(),
            }],
            aliases: vec![Alias {
                trigger: "ll".into(),
                expansion: "ls -la".into(),
                description: Some("Long listing".into()),
                enabled: true,
                use_count: 20,
                created_at: Utc::now(),
                os_target: OsTarget::default(),
            }],
            pinned_commands: vec!["ls -la".into()],
            config: PaletteConfig::default(),
            saved_at: Utc::now(),
            version: 1,
        }
    }

    #[test]
    fn test_export_json() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Json,
            scope: ExportScope::default(),
            filter: ExportFilter::default(),
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        assert!(result.content.is_some());
        let content = result.content.unwrap();
        assert!(content.contains("ls -la"));
        assert!(content.contains("docker ps"));
        assert_eq!(result.stats.history_entries, 2);
        assert_eq!(result.stats.snippets, 1);
        assert_eq!(result.stats.aliases, 1);
    }

    #[test]
    fn test_export_shell_script() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::ShellScript,
            scope: ExportScope::default(),
            filter: ExportFilter::default(),
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        let content = result.content.unwrap();
        assert!(content.starts_with("#!/bin/bash"));
        assert!(content.contains("ls -la"));
        assert!(content.contains("alias ll="));
    }

    #[test]
    fn test_export_csv() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Csv,
            scope: ExportScope::default(),
            filter: ExportFilter::default(),
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        let content = result.content.unwrap();
        assert!(content.starts_with("command,"));
        assert!(content.contains("ls -la"));
    }

    #[test]
    fn test_export_markdown() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Markdown,
            scope: ExportScope::default(),
            filter: ExportFilter::default(),
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        let content = result.content.unwrap();
        assert!(content.contains("# SortOfRemoteNG"));
        assert!(content.contains("## History"));
        assert!(content.contains("## Snippets"));
        assert!(content.contains("## Aliases"));
    }

    #[test]
    fn test_export_base64_roundtrip() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Base64,
            scope: ExportScope::default(),
            filter: ExportFilter::default(),
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        let encoded = result.content.unwrap();

        // Decode.
        let decoded_bytes = base64_decode(&encoded).unwrap();
        let json = String::from_utf8(decoded_bytes).unwrap();
        let decoded: PersistentData = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.history.len(), 2);
        assert_eq!(decoded.snippets.len(), 1);
    }

    #[test]
    fn test_clipboard_roundtrip() {
        let data = sample_data();
        let encoded = encode_for_clipboard(&data).unwrap();
        let decoded = decode_from_clipboard(&encoded).unwrap();
        assert_eq!(decoded.history.len(), data.history.len());
        assert_eq!(decoded.snippets.len(), data.snippets.len());
        assert_eq!(decoded.aliases.len(), data.aliases.len());
    }

    #[test]
    fn test_share_package_roundtrip() {
        let data = sample_data();
        let metadata = SharePackageMetadata {
            name: "Test Package".into(),
            description: Some("A test package".into()),
            author: Some("Test Author".into()),
            version: "1.0.0".into(),
            tags: vec!["test".into()],
            created_at: Utc::now(),
            homepage: None,
            min_app_version: None,
            format_version: 1,
        };
        let pkg = create_share_package(data.clone(), metadata).unwrap();
        let json = serialise_share_package(&pkg).unwrap();
        let restored = deserialise_share_package(&json).unwrap();
        assert_eq!(restored.data.history.len(), 2);
        assert_eq!(restored.metadata.name, "Test Package");
    }

    #[test]
    fn test_share_package_checksum_tamper() {
        let data = sample_data();
        let metadata = SharePackageMetadata {
            name: "Test".into(),
            description: None,
            author: None,
            version: "1.0.0".into(),
            tags: Vec::new(),
            created_at: Utc::now(),
            homepage: None,
            min_app_version: None,
            format_version: 1,
        };
        let mut pkg = create_share_package(data, metadata).unwrap();
        // Tamper.
        pkg.data.history.clear();
        let json = serde_json::to_string_pretty(&pkg).unwrap();
        let err = deserialise_share_package(&json);
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("Checksum mismatch"));
    }

    #[test]
    fn test_filter_by_host() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Json,
            scope: ExportScope::default(),
            filter: ExportFilter {
                hosts: vec!["server1".into()],
                ..Default::default()
            },
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        assert_eq!(result.stats.history_entries, 1);
    }

    #[test]
    fn test_filter_by_tags() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Json,
            scope: ExportScope::default(),
            filter: ExportFilter {
                tags: vec!["docker".into()],
                ..Default::default()
            },
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        assert_eq!(result.stats.history_entries, 1);
    }

    #[test]
    fn test_filter_pinned_only() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Json,
            scope: ExportScope::default(),
            filter: ExportFilter {
                pinned_only: true,
                ..Default::default()
            },
            output_path: None,
        };
        let result = export(&data, &req).unwrap();
        assert_eq!(result.stats.history_entries, 1);
    }

    #[test]
    fn test_scope_snippets_only() {
        let data = sample_data();
        let req = ExportRequest {
            format: ExportFormat::Json,
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
        let result = export(&data, &req).unwrap();
        assert_eq!(result.stats.history_entries, 0);
        assert_eq!(result.stats.snippets, 1);
        assert_eq!(result.stats.aliases, 0);
    }

    #[test]
    fn test_import_with_skip() {
        let existing = sample_data();
        let incoming = sample_data();
        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Skip,
            dry_run: true,
            ..Default::default()
        };
        let result = import_with_options(&existing, &incoming, &options);
        assert!(result.dry_run);
        assert_eq!(result.skipped.history, 2);
        assert_eq!(result.skipped.snippets, 1);
        assert_eq!(result.skipped.aliases, 1);
        assert_eq!(result.added.history, 0);
    }

    #[test]
    fn test_import_with_overwrite() {
        let existing = sample_data();
        let incoming = sample_data();
        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Overwrite,
            dry_run: true,
            ..Default::default()
        };
        let result = import_with_options(&existing, &incoming, &options);
        assert_eq!(result.updated.history, 2);
        assert_eq!(result.updated.snippets, 1);
    }

    #[test]
    fn test_apply_import_merge() {
        let mut target = sample_data();
        let mut incoming = sample_data();
        incoming.history[0].use_count = 100;
        incoming.history[0].tags.push("extra".into());

        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Merge,
            dry_run: false,
            ..Default::default()
        };
        apply_import(&mut target, &incoming, &options);

        assert_eq!(target.history[0].use_count, 100);
        assert!(target.history[0].tags.contains(&"extra".into()));
    }

    #[test]
    fn test_apply_import_rename() {
        let mut target = sample_data();
        let incoming = sample_data();

        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Rename,
            dry_run: false,
            ..Default::default()
        };
        apply_import(&mut target, &incoming, &options);

        // Original + renamed.
        assert!(target.history.len() > 2);
        assert!(target
            .snippets
            .iter()
            .any(|s| s.name.contains("(imported)")));
    }

    #[test]
    fn test_validate_valid_json() {
        let data = sample_data();
        let json = serde_json::to_string_pretty(&data).unwrap();
        let result = validate_import(&json);
        assert!(result.valid);
        assert_eq!(result.content_summary.history_entries, 2);
        assert_eq!(result.detected_format, Some(ExportFormat::Json));
    }

    #[test]
    fn test_validate_share_package() {
        let data = sample_data();
        let meta = SharePackageMetadata {
            name: "Test".into(),
            description: None,
            author: None,
            version: "1.0.0".into(),
            tags: Vec::new(),
            created_at: Utc::now(),
            homepage: None,
            min_app_version: None,
            format_version: 1,
        };
        let pkg = create_share_package(data, meta).unwrap();
        let json = serde_json::to_string_pretty(&pkg).unwrap();
        let result = validate_import(&json);
        assert!(result.valid);
        assert!(result.package_metadata.is_some());
        assert_eq!(result.checksum_valid, Some(true));
    }

    #[test]
    fn test_validate_invalid_json() {
        let result = validate_import("{ not valid json }");
        assert!(!result.valid);
    }

    #[test]
    fn test_csv_roundtrip() {
        let data = sample_data();
        let csv = history_to_csv(&data.history);
        let parsed = parse_csv_history(&csv).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].command, "ls -la");
        assert_eq!(parsed[0].use_count, 5);
    }

    #[test]
    fn test_parse_import_data_json() {
        let data = sample_data();
        let json = serde_json::to_string(&data).unwrap();
        let parsed = parse_import_data(&json).unwrap();
        assert_eq!(parsed.history.len(), 2);
    }

    #[test]
    fn test_parse_import_data_snippet_collection() {
        let snippets = SnippetCollection {
            name: "Test".into(),
            description: None,
            snippets: sample_data().snippets,
            exported_at: Utc::now(),
            version: Some("1".into()),
        };
        let json = serde_json::to_string(&snippets).unwrap();
        let parsed = parse_import_data(&json).unwrap();
        assert_eq!(parsed.snippets.len(), 1);
    }

    #[test]
    fn test_base64_roundtrip() {
        let original = b"Hello, World! This is a test of base64 encoding.";
        let encoded = base64_encode(original);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_history_export_options() {
        let data = sample_data();
        let opts = HistoryExportOptions {
            host: Some("server1".into()),
            successful_only: true,
            ..Default::default()
        };
        let result = export_history(&data.history, &opts, ExportFormat::ShellScript).unwrap();
        assert!(result.contains("ls -la"));
        assert!(!result.contains("docker ps")); // server2 + exit 1
    }

    #[test]
    fn test_detect_format() {
        assert_eq!(detect_format("{\"version\": 1}"), Some(ExportFormat::Json));
        assert_eq!(
            detect_format("#!/bin/bash\nls"),
            Some(ExportFormat::ShellScript)
        );
        assert_eq!(
            detect_format("command,host,username\nls,srv,root"),
            Some(ExportFormat::Csv)
        );
    }
}
