#![allow(dead_code, non_snake_case)]

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::ansi;
use crate::custom;
use crate::engine::ThemeEngineState;
use crate::export;
use crate::types::*;

// ─── List / Query ────────────────────────────────────────────

#[tauri::command]
pub fn terminal_themes_list(
    state: State<'_, ThemeEngineState>,
) -> Result<Vec<ThemeSummary>, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.list_themes())
}

#[tauri::command]
pub fn terminal_themes_list_dark(
    state: State<'_, ThemeEngineState>,
) -> Result<Vec<ThemeSummary>, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.list_dark())
}

#[tauri::command]
pub fn terminal_themes_list_light(
    state: State<'_, ThemeEngineState>,
) -> Result<Vec<ThemeSummary>, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.list_light())
}

#[tauri::command]
pub fn terminal_themes_list_by_category(
    state: State<'_, ThemeEngineState>,
    category: ThemeCategory,
) -> Result<Vec<ThemeSummary>, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.list_by_category(&category))
}

#[tauri::command]
pub fn terminal_themes_search(
    state: State<'_, ThemeEngineState>,
    query: String,
) -> Result<Vec<ThemeSummary>, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.search(&query))
}

#[tauri::command]
pub fn terminal_themes_get(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<TerminalTheme, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    engine.get_theme(&id).cloned().map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_get_active(
    state: State<'_, ThemeEngineState>,
) -> Result<TerminalTheme, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    engine.get_active_theme().cloned().map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_get_active_id(state: State<'_, ThemeEngineState>) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.active_theme_id().to_string())
}

#[tauri::command]
pub fn terminal_themes_get_session_theme(
    state: State<'_, ThemeEngineState>,
    session_id: String,
) -> Result<TerminalTheme, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .get_session_theme(&session_id)
        .cloned()
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_get_xterm(
    state: State<'_, ThemeEngineState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    engine.get_xterm_theme(&session_id).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_get_css_vars(
    state: State<'_, ThemeEngineState>,
    session_id: String,
) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    engine.get_css_variables(&session_id).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_recent(
    state: State<'_, ThemeEngineState>,
) -> Result<Vec<ThemeSummary>, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.recent_themes())
}

#[tauri::command]
pub fn terminal_themes_count(state: State<'_, ThemeEngineState>) -> Result<usize, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    Ok(engine.theme_count())
}

// ─── Set / Modify ────────────────────────────────────────────

#[tauri::command]
pub fn terminal_themes_set_active(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<(), String> {
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine.set_active_theme(&id).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_set_session(
    state: State<'_, ThemeEngineState>,
    session_id: String,
    theme_id: String,
) -> Result<(), String> {
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .set_session_theme(&session_id, &theme_id)
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_clear_session(
    state: State<'_, ThemeEngineState>,
    session_id: String,
) -> Result<(), String> {
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine.clear_session_theme(&session_id);
    Ok(())
}

#[tauri::command]
pub fn terminal_themes_register(
    state: State<'_, ThemeEngineState>,
    theme: TerminalTheme,
) -> Result<(), String> {
    custom::validate_theme(&theme).map_err(|e| e.message)?;
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine.register_theme(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_update(
    state: State<'_, ThemeEngineState>,
    theme: TerminalTheme,
) -> Result<(), String> {
    custom::validate_theme(&theme).map_err(|e| e.message)?;
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine.update_theme(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_remove(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<(), String> {
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .remove_theme(&id)
        .map_err(|_e| "Theme not found or cannot be removed".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_themes_duplicate(
    state: State<'_, ThemeEngineState>,
    source_id: String,
    new_id: String,
    new_name: String,
) -> Result<(), String> {
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .duplicate_theme(&source_id, &new_id, &new_name)
        .map_err(|e| e.message)
}

// ─── Custom Theme Creation ──────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateThemeRequest {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub is_dark: bool,
    pub foreground: String,
    pub background: String,
    pub cursor: String,
    pub selection_background: String,
    pub ansi_colors: Vec<String>,
}

#[tauri::command]
pub fn terminal_themes_create_custom(
    state: State<'_, ThemeEngineState>,
    request: CreateThemeRequest,
) -> Result<TerminalTheme, String> {
    if request.ansi_colors.len() != 16 {
        return Err("ansi_colors must have exactly 16 entries".to_string());
    }
    let colors: [String; 16] = request
        .ansi_colors
        .try_into()
        .map_err(|_| "Failed to convert colors array".to_string())?;
    let theme = custom::create_custom_theme(
        request.id,
        request.name,
        request.author,
        request.description,
        request.is_dark,
        request.foreground,
        request.background,
        request.cursor,
        request.selection_background,
        colors,
    )
    .map_err(|e| e.message)?;
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .register_theme(theme.clone())
        .map_err(|e| e.message)?;
    Ok(theme)
}

#[tauri::command]
pub fn terminal_themes_derive_hue(
    state: State<'_, ThemeEngineState>,
    source_id: String,
    new_id: String,
    new_name: String,
    hue_shift: f64,
) -> Result<TerminalTheme, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    let source = engine
        .get_theme(&source_id)
        .cloned()
        .map_err(|e| e.message)?;
    drop(engine);
    let derived = custom::derive_hue_shifted(&source, &new_id, &new_name, hue_shift)
        .map_err(|e| e.message)?;
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .register_theme(derived.clone())
        .map_err(|e| e.message)?;
    Ok(derived)
}

#[tauri::command]
pub fn terminal_themes_generate_from_accent(
    state: State<'_, ThemeEngineState>,
    id: String,
    name: String,
    accent_primary: String,
    accent_secondary: String,
    dark: bool,
) -> Result<TerminalTheme, String> {
    let theme = custom::generate_from_accent(&id, &name, &accent_primary, &accent_secondary, dark)
        .map_err(|e| e.message)?;
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .register_theme(theme.clone())
        .map_err(|e| e.message)?;
    Ok(theme)
}

// ─── Export / Import ────────────────────────────────────────

#[tauri::command]
pub fn terminal_themes_export_json(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    let theme = engine.get_theme(&id).map_err(|e| e.message)?;
    export::export_json(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_export_iterm2(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    let theme = engine.get_theme(&id).map_err(|e| e.message)?;
    export::export_iterm2(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_export_windows_terminal(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    let theme = engine.get_theme(&id).map_err(|e| e.message)?;
    export::export_windows_terminal(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_export_alacritty(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    let theme = engine.get_theme(&id).map_err(|e| e.message)?;
    export::export_alacritty(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_export_xterm(
    state: State<'_, ThemeEngineState>,
    id: String,
) -> Result<String, String> {
    let engine = state.read().map_err(|e| format!("Lock error: {}", e))?;
    let theme = engine.get_theme(&id).map_err(|e| e.message)?;
    export::export_xterm(theme).map_err(|e| e.message)
}

#[tauri::command]
pub fn terminal_themes_import(
    state: State<'_, ThemeEngineState>,
    content: String,
) -> Result<TerminalTheme, String> {
    let theme = export::import_theme(&content).map_err(|e| e.message)?;
    let mut engine = state.write().map_err(|e| format!("Lock error: {}", e))?;
    engine
        .register_theme(theme.clone())
        .map_err(|e| e.message)?;
    Ok(theme)
}

// ─── Color Utilities ────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ContrastInfo {
    pub ratio: f64,
    pub meets_aa: bool,
    pub meets_aaa: bool,
}

#[tauri::command]
pub fn terminal_themes_check_contrast(
    foreground: String,
    background: String,
) -> Result<ContrastInfo, String> {
    let fg = ansi::parse_hex(&foreground).ok_or("Invalid foreground hex")?;
    let bg = ansi::parse_hex(&background).ok_or("Invalid background hex")?;
    let ratio = ansi::contrast_ratio(&fg, &bg);
    Ok(ContrastInfo {
        ratio,
        meets_aa: ratio >= 4.5,
        meets_aaa: ratio >= 7.0,
    })
}

#[tauri::command]
pub fn terminal_themes_blend_colors(
    color1: String,
    color2: String,
    factor: f64,
) -> Result<String, String> {
    ansi::blend(&color1, &color2, factor).ok_or_else(|| "Invalid hex color(s)".to_string())
}

#[tauri::command]
pub fn terminal_themes_validate(theme: TerminalTheme) -> Result<bool, String> {
    match custom::validate_theme(&theme) {
        Ok(()) => Ok(true),
        Err(e) => Err(e.message),
    }
}
