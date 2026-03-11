use super::highlighting::*;

/// Set (replace) the full list of highlight rules for a session.
#[tauri::command]
pub fn set_highlight_rules(session_id: String, rules: Vec<HighlightRule>) -> Result<(), String> {
    let state = compile_rules(&rules)?;
    let mut highlights = ACTIVE_HIGHLIGHTS
        .lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    highlights.insert(session_id.clone(), state);
    log::info!(
        "Set {} highlight rules for session {}",
        rules.len(),
        session_id
    );
    Ok(())
}

/// Get the current highlight rules for a session.
#[tauri::command]
pub fn get_highlight_rules(session_id: String) -> Result<Vec<HighlightRule>, String> {
    let highlights = ACTIVE_HIGHLIGHTS
        .lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    Ok(highlights
        .get(&session_id)
        .map(|s| s.rules.clone())
        .unwrap_or_default())
}

/// Add a single highlight rule to a session (appended to the end).
#[tauri::command]
pub fn add_highlight_rule(session_id: String, rule: HighlightRule) -> Result<(), String> {
    let mut highlights = ACTIVE_HIGHLIGHTS
        .lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;

    let mut rules = highlights
        .get(&session_id)
        .map(|s| s.rules.clone())
        .unwrap_or_default();

    // Validate the regex eagerly
    Regex::new(&rule.pattern).map_err(|e| format!("Invalid regex pattern: {}", e))?;

    rules.push(rule);
    let state = compile_rules(&rules)?;
    highlights.insert(session_id, state);
    Ok(())
}

/// Remove a highlight rule by its id.
#[tauri::command]
pub fn remove_highlight_rule(session_id: String, rule_id: String) -> Result<bool, String> {
    let mut highlights = ACTIVE_HIGHLIGHTS
        .lock()
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
pub fn update_highlight_rule(session_id: String, rule: HighlightRule) -> Result<bool, String> {
    let mut highlights = ACTIVE_HIGHLIGHTS
        .lock()
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
        Regex::new(&rule.pattern).map_err(|e| format!("Invalid regex pattern: {}", e))?;
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
    let mut highlights = ACTIVE_HIGHLIGHTS
        .lock()
        .map_err(|e| format!("Failed to lock highlights: {}", e))?;
    highlights.remove(&session_id);
    log::info!("Cleared highlight rules for session {}", session_id);
    Ok(())
}

/// Get highlight status for a session.
#[tauri::command]
pub fn get_highlight_status(session_id: String) -> Result<Option<HighlightStatus>, String> {
    let highlights = ACTIVE_HIGHLIGHTS
        .lock()
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
    let highlights = ACTIVE_HIGHLIGHTS
        .lock()
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
