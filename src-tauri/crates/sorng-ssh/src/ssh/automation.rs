
use super::types::*;
use super::ACTIVE_AUTOMATIONS;

// ===============================
// Internal automation helper
// ===============================

/// Process automation patterns against new output (internal helper)
pub fn process_automation_output(session_id: &str, output: &str) {
    if let Ok(mut automations) = ACTIVE_AUTOMATIONS.lock() {
        if let Some(state) = automations.get_mut(session_id) {
            // Check for timeout
            let elapsed_ms = state.start_time.elapsed().as_millis() as u64;
            if state.script.timeout_ms > 0 && elapsed_ms > state.script.timeout_ms {
                log::warn!("Automation timeout for session {}", session_id);
                return;
            }

            // Check max matches
            if state.script.max_matches > 0
                && state.matches.len() >= state.script.max_matches as usize
            {
                return;
            }

            // Add output to buffer
            state.output_buffer.push_str(output);

            // Try to match patterns
            let mut matched = false;
            for (index, pattern) in state.compiled_patterns.iter().enumerate() {
                if let Some(captures) = pattern.captures(&state.output_buffer) {
                    matched = true;
                    let matched_text = captures
                        .get(0)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default();

                    let expect_pattern = &state.script.patterns[index];
                    let mut response = expect_pattern.response.clone();
                    if expect_pattern.send_newline {
                        response.push('\n');
                    }

                    // Send response
                    let _ = state.tx.send(SshShellCommand::Input(response.clone()));

                    // Record match
                    state.matches.push(AutomationMatch {
                        pattern_index: index,
                        matched_text,
                        response_sent: response,
                        timestamp_ms: elapsed_ms,
                    });

                    log::debug!(
                        "Automation pattern {} matched for session {}",
                        expect_pattern
                            .label
                            .as_deref()
                            .unwrap_or(&format!("#{}", index)),
                        session_id
                    );

                    // Clear buffer after match to avoid re-matching
                    state.output_buffer.clear();
                    break;
                }
            }

            // Limit buffer size to prevent memory issues
            if state.output_buffer.len() > 64 * 1024 {
                let excess = state.output_buffer.len() - 32 * 1024;
                state.output_buffer = state.output_buffer[excess..].to_string();
            }

            // Stop on no match if configured and we've had matches before
            if state.script.stop_on_no_match && !matched && !state.matches.is_empty() {
                // The caller should stop automation when this happens
            }
        }
    }
}

// ===============================
// Tauri commands for automation
// ===============================
