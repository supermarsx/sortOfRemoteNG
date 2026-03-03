use std::collections::HashMap;

use regex::Regex;

use super::types::*;
use super::ACTIVE_HIGHLIGHTS;

// ===============================
// ANSI colour helpers
// ===============================

/// Strip ANSI escape sequences and return the clean text together with an
/// index map:  `index_map[clean_byte_pos] = original_byte_pos`.
///
/// This lets us run regex against *visible* text and map the match byte
/// offsets back into the original (ANSI-laden) string.
fn strip_ansi_with_map(input: &str) -> (String, Vec<usize>) {
    // Matches CSI sequences (\x1b\[…<letter>), OSC (\x1b\]…\x07/\x1b\\),
    // and two-byte SS2/SS3/ESC-letter sequences.
    lazy_static::lazy_static! {
        static ref ANSI_RE: Regex = Regex::new(
            r"(\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[^[\]])"
        ).unwrap();
    }

    let mut clean = String::with_capacity(input.len());
    let mut index_map: Vec<usize> = Vec::with_capacity(input.len());
    let mut last_end = 0;

    for m in ANSI_RE.find_iter(input) {
        // Visible text before this escape
        let visible = &input[last_end..m.start()];
        for (i, _) in visible.char_indices() {
            let orig_pos = last_end + i;
            let ch = &input[orig_pos..orig_pos + input[orig_pos..].chars().next().unwrap().len_utf8()];
            for _ in 0..ch.len() {
                index_map.push(orig_pos);
            }
            clean.push_str(ch);
        }
        last_end = m.end();
    }

    // Remaining visible text after the last escape
    let visible = &input[last_end..];
    for (i, _) in visible.char_indices() {
        let orig_pos = last_end + i;
        let ch = &input[orig_pos..orig_pos + input[orig_pos..].chars().next().unwrap().len_utf8()];
        for _ in 0..ch.len() {
            index_map.push(orig_pos);
        }
        clean.push_str(ch);
    }

    // Sentinel so we can use `index_map[clean.len()]` for end-of-match
    index_map.push(input.len());

    (clean, index_map)
}

/// Convert a colour spec into an ANSI SGR parameter string.
///
/// Accepted formats:
/// - Named ANSI colours: `black`, `red`, `green`, `yellow`, `blue`,
///   `magenta`, `cyan`, `white`, plus `bright_*` variants.
/// - 8-bit index (`0`–`255`): becomes `38;5;<n>` (fg) or `48;5;<n>` (bg).
/// - 24-bit hex: `#rrggbb` → `38;2;r;g;b` (fg) or `48;2;r;g;b` (bg).
fn color_to_sgr(color: &str, is_bg: bool) -> Option<String> {
    let base: u8 = if is_bg { 40 } else { 30 };
    let bright_base: u8 = if is_bg { 100 } else { 90 };

    match color.to_lowercase().as_str() {
        "black"          => Some(format!("{}", base)),
        "red"            => Some(format!("{}", base + 1)),
        "green"          => Some(format!("{}", base + 2)),
        "yellow"         => Some(format!("{}", base + 3)),
        "blue"           => Some(format!("{}", base + 4)),
        "magenta"        => Some(format!("{}", base + 5)),
        "cyan"           => Some(format!("{}", base + 6)),
        "white"          => Some(format!("{}", base + 7)),
        "bright_black"   => Some(format!("{}", bright_base)),
        "bright_red"     => Some(format!("{}", bright_base + 1)),
        "bright_green"   => Some(format!("{}", bright_base + 2)),
        "bright_yellow"  => Some(format!("{}", bright_base + 3)),
        "bright_blue"    => Some(format!("{}", bright_base + 4)),
        "bright_magenta" => Some(format!("{}", bright_base + 5)),
        "bright_cyan"    => Some(format!("{}", bright_base + 6)),
        "bright_white"   => Some(format!("{}", bright_base + 7)),
        hex if hex.starts_with('#') && hex.len() == 7 => {
            let r = u8::from_str_radix(&hex[1..3], 16).ok()?;
            let g = u8::from_str_radix(&hex[3..5], 16).ok()?;
            let b = u8::from_str_radix(&hex[5..7], 16).ok()?;
            let layer = if is_bg { 48 } else { 38 };
            Some(format!("{};2;{};{};{}", layer, r, g, b))
        }
        idx => {
            // Try parsing as 8-bit colour index
            if let Ok(n) = idx.parse::<u8>() {
                let layer = if is_bg { 48 } else { 38 };
                Some(format!("{};5;{}", layer, n))
            } else {
                None
            }
        }
    }
}

/// Build the full ANSI SGR "open" sequence for a highlight rule.
fn build_ansi_open(rule: &HighlightRule) -> String {
    let mut params: Vec<String> = Vec::new();
    if rule.bold { params.push("1".to_string()); }
    if rule.italic { params.push("3".to_string()); }
    if rule.underline { params.push("4".to_string()); }
    if let Some(ref fg) = rule.fg_color {
        if let Some(sgr) = color_to_sgr(fg, false) {
            params.push(sgr);
        }
    }
    if let Some(ref bg) = rule.bg_color {
        if let Some(sgr) = color_to_sgr(bg, true) {
            params.push(sgr);
        }
    }
    if params.is_empty() {
        // Fallback: bold bright-white so something is visible
        params.push("1".to_string());
    }
    format!("\x1b[{}m", params.join(";"))
}

// ===============================
// Compilation
// ===============================

/// Compile a set of highlight rules into ready-to-use state.
pub(crate) fn compile_rules(rules: &[HighlightRule]) -> Result<HighlightState, String> {
    let mut compiled = Vec::new();
    for rule in rules {
        if !rule.enabled {
            continue;
        }
        let regex = Regex::new(&rule.pattern)
            .map_err(|e| format!("Invalid regex in rule '{}': {}", rule.id, e))?;
        compiled.push(CompiledHighlight {
            rule_id: rule.id.clone(),
            regex,
            ansi_open: build_ansi_open(rule),
            ansi_close: "\x1b[0m".to_string(),
            priority: rule.priority,
        });
    }
    // Sort by priority (lower number = applied first = higher priority)
    compiled.sort_by_key(|c| c.priority);
    Ok(HighlightState {
        rules: rules.to_vec(),
        compiled,
    })
}

// ===============================
// Core highlighting engine
// ===============================

/// Apply compiled highlight rules to a chunk of terminal output.
///
/// The function is ANSI-aware: it strips ANSI sequences, runs regex against
/// the visible text, then injects colour sequences at the correct positions
/// in the original string.
pub(crate) fn apply_highlights(input: &str, state: &HighlightState) -> String {
    if state.compiled.is_empty() || input.is_empty() {
        return input.to_string();
    }

    let (clean, index_map) = strip_ansi_with_map(input);
    if clean.is_empty() {
        return input.to_string();
    }

    // Collect all matches across all rules.
    // Each entry: (start_clean, end_clean, compiled_index)
    let mut all_matches: Vec<(usize, usize, usize)> = Vec::new();

    for (ci, compiled) in state.compiled.iter().enumerate() {
        for m in compiled.regex.find_iter(&clean) {
            all_matches.push((m.start(), m.end(), ci));
        }
    }

    if all_matches.is_empty() {
        return input.to_string();
    }

    // Sort by start position, then by priority (already sorted, but
    // re-sort by start to interleave correctly).
    all_matches.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(state.compiled[a.2].priority.cmp(&state.compiled[b.2].priority))
    });

    // Remove overlapping matches — first match (by position, then priority) wins.
    let mut non_overlapping: Vec<(usize, usize, usize)> = Vec::new();
    for m in all_matches {
        if let Some(last) = non_overlapping.last() {
            if m.0 < last.1 {
                continue; // overlaps with previous winner
            }
        }
        non_overlapping.push(m);
    }

    // Map clean byte offsets → original byte offsets and build output.
    // We walk through the original string, inserting ANSI open/close at
    // the mapped positions.
    //
    // Build a list of "insert at original_pos → string" events.
    let mut inserts: Vec<(usize, &str, bool)> = Vec::new(); // (orig_pos, text, is_open)

    for &(cs, ce, ci) in &non_overlapping {
        let orig_start = index_map[cs];
        let orig_end = if ce < index_map.len() - 1 {
            // End position: the byte *after* the last matched byte in original
            let raw = index_map[ce - 1];
            // Advance past the full character at that position
            raw + input[raw..].chars().next().map(|c| c.len_utf8()).unwrap_or(1)
        } else {
            index_map[ce] // sentinel = input.len()
        };
        inserts.push((orig_start, &state.compiled[ci].ansi_open, true));
        inserts.push((orig_end, &state.compiled[ci].ansi_close, false));
    }

    // Sort inserts by position. For the same position, close before open
    // so that `\x1b[0m\x1b[…m` is emitted (reset then start).
    inserts.sort_by(|a, b| a.0.cmp(&b.0).then(a.2.cmp(&b.2)));

    let mut result = String::with_capacity(input.len() + inserts.len() * 12);
    let mut pos = 0;
    for (insert_pos, text, _) in &inserts {
        if *insert_pos > pos {
            result.push_str(&input[pos..*insert_pos]);
        }
        result.push_str(text);
        pos = *insert_pos;
    }
    if pos < input.len() {
        result.push_str(&input[pos..]);
    }

    result
}

// ===============================
// Internal helper called from the reader thread
// ===============================

/// Process highlight rules against terminal output and return the
/// (potentially modified) output string.
///
/// If no highlights are active for this session the input is returned
/// unchanged.
pub(crate) fn process_highlight_output(session_id: &str, output: &str) -> String {
    if let Ok(highlights) = ACTIVE_HIGHLIGHTS.lock() {
        if let Some(state) = highlights.get(session_id) {
            return apply_highlights(output, state);
        }
    }
    output.to_string()
}

// ===============================
// Tauri commands
// ===============================

/// Set (replace) the full list of highlight rules for a session.
#[tauri::command]
pub fn set_highlight_rules(
    session_id: String,
    rules: Vec<HighlightRule>,
) -> Result<(), String> {
    let state = compile_rules(&rules)?;
    let mut highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    highlights.insert(session_id.clone(), state);
    log::info!("Set {} highlight rules for session {}", rules.len(), session_id);
    Ok(())
}

/// Get the current highlight rules for a session.
#[tauri::command]
pub fn get_highlight_rules(session_id: String) -> Result<Vec<HighlightRule>, String> {
    let highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    Ok(highlights.get(&session_id)
        .map(|s| s.rules.clone())
        .unwrap_or_default())
}

/// Add a single highlight rule to a session (appended to the end).
#[tauri::command]
pub fn add_highlight_rule(
    session_id: String,
    rule: HighlightRule,
) -> Result<(), String> {
    let mut highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;

    let mut rules = highlights.get(&session_id)
        .map(|s| s.rules.clone())
        .unwrap_or_default();

    // Validate the regex eagerly
    Regex::new(&rule.pattern)
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    rules.push(rule);
    let state = compile_rules(&rules)?;
    highlights.insert(session_id, state);
    Ok(())
}

/// Remove a highlight rule by its id.
#[tauri::command]
pub fn remove_highlight_rule(
    session_id: String,
    rule_id: String,
) -> Result<bool, String> {
    let mut highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;

    if let Some(existing) = highlights.get(&session_id) {
        let mut rules = existing.rules.clone();
        let before = rules.len();
        rules.retain(|r| r.id != rule_id);
        let removed = rules.len() < before;
        let state = compile_rules(&rules)?;
        highlights.insert(session_id, state);
        Ok(removed)
    } else {
        Ok(false)
    }
}

/// Update an existing highlight rule in-place (matched by `rule.id`).
#[tauri::command]
pub fn update_highlight_rule(
    session_id: String,
    rule: HighlightRule,
) -> Result<bool, String> {
    let mut highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;

    if let Some(existing) = highlights.get(&session_id) {
        let mut rules = existing.rules.clone();
        let mut found = false;
        for r in rules.iter_mut() {
            if r.id == rule.id {
                *r = rule.clone();
                found = true;
                break;
            }
        }
        if !found {
            return Ok(false);
        }
        // Re-validate
        Regex::new(&rule.pattern)
            .map_err(|e| format!("Invalid regex pattern: {}", e))?;
        let state = compile_rules(&rules)?;
        highlights.insert(session_id, state);
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Clear all highlight rules for a session.
#[tauri::command]
pub fn clear_highlight_rules(session_id: String) -> Result<(), String> {
    let mut highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    highlights.remove(&session_id);
    log::info!("Cleared highlight rules for session {}", session_id);
    Ok(())
}

/// Get highlight status for a session.
#[tauri::command]
pub fn get_highlight_status(session_id: String) -> Result<Option<HighlightStatus>, String> {
    let highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;

    Ok(highlights.get(&session_id).map(|state| HighlightStatus {
        session_id: session_id.clone(),
        rules: state.rules.clone(),
        active_count: state.compiled.len(),
    }))
}

/// List all sessions that have active highlight rules.
#[tauri::command]
pub fn list_highlighted_sessions() -> Result<Vec<String>, String> {
    let highlights = ACTIVE_HIGHLIGHTS.lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    Ok(highlights.keys().cloned().collect())
}

/// Test highlight rules against sample text without affecting any session.
#[tauri::command]
pub fn test_highlight_rules(
    rules: Vec<HighlightRule>,
    sample_text: String,
) -> Result<HighlightTestResult, String> {
    let state = compile_rules(&rules)?;
    let output = apply_highlights(&sample_text, &state);

    // Count matches per rule
    let (clean, _) = strip_ansi_with_map(&sample_text);
    let mut match_counts: HashMap<String, usize> = HashMap::new();
    for compiled in &state.compiled {
        let count = compiled.regex.find_iter(&clean).count();
        match_counts.insert(compiled.rule_id.clone(), count);
    }

    Ok(HighlightTestResult {
        input: sample_text,
        output,
        match_counts,
    })
}
