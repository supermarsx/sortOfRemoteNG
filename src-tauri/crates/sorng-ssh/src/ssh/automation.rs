use std::time::Duration;
use regex::Regex;
use chrono::Utc;

use super::types::*;
use super::{ACTIVE_AUTOMATIONS, TERMINAL_BUFFERS};

// ===============================
// Internal automation helper
// ===============================

/// Process automation patterns against new output (internal helper)
pub(crate) fn process_automation_output(session_id: &str, output: &str) {
    if let Ok(mut automations) = ACTIVE_AUTOMATIONS.lock() {
        if let Some(state) = automations.get_mut(session_id) {
            // Check for timeout
            let elapsed_ms = state.start_time.elapsed().as_millis() as u64;
            if state.script.timeout_ms > 0 && elapsed_ms > state.script.timeout_ms {
                log::warn!("Automation timeout for session {}", session_id);
                return;
            }

            // Check max matches
            if state.script.max_matches > 0 && state.matches.len() >= state.script.max_matches as usize {
                return;
            }

            // Add output to buffer
            state.output_buffer.push_str(output);

            // Try to match patterns
            let mut matched = false;
            for (index, pattern) in state.compiled_patterns.iter().enumerate() {
                if let Some(captures) = pattern.captures(&state.output_buffer) {
                    matched = true;
                    let matched_text = captures.get(0)
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

                    log::debug!("Automation pattern {} matched for session {}",
                               expect_pattern.label.as_deref().unwrap_or(&format!("#{}", index)),
                               session_id);

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

/// Start automation on a session - patterns will be matched against terminal output
#[tauri::command]
pub async fn start_automation(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    script: AutomationScript,
) -> Result<(), String> {
    let ssh = state.lock().await;

    let shell = ssh.shells.get(&session_id)
        .ok_or("No active shell for this session")?;

    // Compile regex patterns
    let compiled_patterns: Vec<Regex> = script.patterns.iter()
        .map(|p| Regex::new(&p.pattern))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    let mut automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;

    if automations.contains_key(&session_id) {
        return Err("Automation already active for this session".to_string());
    }

    automations.insert(session_id.clone(), AutomationState {
        script: script.clone(),
        compiled_patterns,
        output_buffer: String::new(),
        matches: Vec::new(),
        start_time: std::time::Instant::now(),
        start_utc: Utc::now(),
        tx: shell.sender.clone(),
    });

    log::info!("Started automation '{}' on session {}", script.name, session_id);
    Ok(())
}

/// Stop automation on a session and return results
#[tauri::command]
pub fn stop_automation(session_id: String) -> Result<AutomationStatus, String> {
    let mut automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;

    let state = automations.remove(&session_id)
        .ok_or("No active automation for this session")?;

    let elapsed_ms = state.start_time.elapsed().as_millis() as u64;

    log::info!("Stopped automation '{}' on session {} ({} matches)",
               state.script.name, session_id, state.matches.len());

    Ok(AutomationStatus {
        session_id,
        script_id: state.script.id,
        script_name: state.script.name,
        is_active: false,
        matches: state.matches,
        started_at: state.start_utc,
        elapsed_ms,
    })
}

/// Check if automation is active on a session
#[tauri::command]
pub fn is_automation_active(session_id: String) -> Result<bool, String> {
    let automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    Ok(automations.contains_key(&session_id))
}

/// Get automation status for a session
#[tauri::command]
pub fn get_automation_status(session_id: String) -> Result<Option<AutomationStatus>, String> {
    let automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;

    if let Some(state) = automations.get(&session_id) {
        let elapsed_ms = state.start_time.elapsed().as_millis() as u64;
        Ok(Some(AutomationStatus {
            session_id: session_id.clone(),
            script_id: state.script.id.clone(),
            script_name: state.script.name.clone(),
            is_active: true,
            matches: state.matches.clone(),
            started_at: state.start_utc,
            elapsed_ms,
        }))
    } else {
        Ok(None)
    }
}

/// List all active automations
#[tauri::command]
pub fn list_active_automations() -> Result<Vec<String>, String> {
    let automations = ACTIVE_AUTOMATIONS.lock()
        .map_err(|e| format!("Failed to lock automations: {}", e))?;
    Ok(automations.keys().cloned().collect())
}

/// Send a command and wait for expected output pattern
#[tauri::command]
pub async fn expect_and_send(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    command: String,
    expect_pattern: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let ssh = state.lock().await;

    let shell = ssh.shells.get(&session_id)
        .ok_or("No active shell for this session")?;

    shell.sender.send(SshShellCommand::Input(format!("{}\n", command)))
        .map_err(|e| format!("Failed to send command: {}", e))?;

    drop(ssh);

    let pattern = Regex::new(&expect_pattern)
        .map_err(|e| format!("Invalid expect pattern: {}", e))?;

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(10000));
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            return Err("Timeout waiting for expected pattern".to_string());
        }

        if let Ok(buffers) = TERMINAL_BUFFERS.lock() {
            if let Some(buffer) = buffers.get(&session_id) {
                if let Some(captures) = pattern.captures(buffer) {
                    let matched_text = captures.get(0)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default();
                    return Ok(matched_text);
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Execute a sequence of commands with optional expect patterns between them
#[tauri::command]
pub async fn execute_command_sequence(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    commands: Vec<String>,
    delay_between_ms: Option<u64>,
) -> Result<Vec<String>, String> {
    let delay = Duration::from_millis(delay_between_ms.unwrap_or(500));
    let mut results = Vec::new();

    for (i, cmd) in commands.iter().enumerate() {
        let ssh = state.lock().await;

        let shell = ssh.shells.get(&session_id)
            .ok_or("No active shell for this session")?;

        shell.sender.send(SshShellCommand::Input(format!("{}\n", cmd)))
            .map_err(|e| format!("Failed to send command {}: {}", i, e))?;

        drop(ssh);

        tokio::time::sleep(delay).await;

        if let Ok(buffers) = TERMINAL_BUFFERS.lock() {
            if let Some(buffer) = buffers.get(&session_id) {
                results.push(buffer.clone());
            } else {
                results.push(String::new());
            }
        }
    }

    Ok(results)
}
