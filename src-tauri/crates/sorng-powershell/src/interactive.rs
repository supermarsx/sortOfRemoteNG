//! Interactive PowerShell session (Enter-PSSession equivalent).
//!
//! Provides a stateful interactive shell where users can type commands
//! one at a time and see results, similar to Enter-PSSession.

use crate::session::PsSessionManager;
use crate::transport::WinRmTransport;
use crate::types::*;
use chrono::Utc;
use lazy_static::lazy_static;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;
use uuid::Uuid;

lazy_static! {
    /// Buffer for interactive session I/O.
    static ref INTERACTIVE_BUFFERS: StdMutex<HashMap<String, InteractiveBuffer>> =
        StdMutex::new(HashMap::new());

    /// Command history for interactive sessions.
    static ref COMMAND_HISTORY: StdMutex<HashMap<String, Vec<String>>> =
        StdMutex::new(HashMap::new());
}

/// Buffer for streaming interactive output.
#[derive(Debug, Clone)]
pub struct InteractiveBuffer {
    pub session_id: String,
    pub prompt: String,
    pub output_lines: Vec<InteractiveLine>,
    pub is_busy: bool,
    pub last_command: Option<String>,
    pub cwd: Option<String>,
}

/// A line of interactive output.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractiveLine {
    pub stream: PsStreamType,
    pub text: String,
    pub timestamp: chrono::DateTime<Utc>,
}

/// Manages an interactive PowerShell session.
pub struct InteractiveSession {
    pub session_id: String,
    pub interactive_id: String,
    transport: Arc<Mutex<WinRmTransport>>,
    shell_id: String,
    prompt: String,
    cwd: String,
}

impl InteractiveSession {
    /// Enter an interactive session (Enter-PSSession).
    pub async fn enter(
        manager: &PsSessionManager,
        session_id: &str,
    ) -> Result<Self, String> {
        let session = manager.get_session(session_id)?;
        if session.state != PsSessionState::Opened {
            return Err(format!(
                "Cannot enter session in state {:?}",
                session.state
            ));
        }

        let transport = manager.get_transport(session_id)?;
        let shell_id = manager.get_shell_id(session_id)?;

        let interactive_id = Uuid::new_v4().to_string();
        let prompt = format!("[{}]: PS> ", session.computer_name);

        // Initialize buffer
        {
            let mut buffers = INTERACTIVE_BUFFERS.lock().unwrap();
            buffers.insert(
                interactive_id.clone(),
                InteractiveBuffer {
                    session_id: session_id.to_string(),
                    prompt: prompt.clone(),
                    output_lines: Vec::new(),
                    is_busy: false,
                    last_command: None,
                    cwd: None,
                },
            );
        }

        // Initialize command history
        {
            let mut history = COMMAND_HISTORY.lock().unwrap();
            history
                .entry(session_id.to_string())
                .or_insert_with(Vec::new);
        }

        // Get the initial working directory
        let cwd = {
            let mut t = transport.lock().await;
            let cmd_id = t
                .execute_ps_command(&shell_id, "(Get-Location).Path")
                .await?;
            let (stdout, _, _) = t.receive_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            stdout.trim().to_string()
        };

        // Update prompt with CWD
        let prompt = format!("[{}]: PS {}> ", session.computer_name, cwd);
        {
            let mut buffers = INTERACTIVE_BUFFERS.lock().unwrap();
            if let Some(buf) = buffers.get_mut(&interactive_id) {
                buf.prompt = prompt.clone();
                buf.cwd = Some(cwd.clone());
            }
        }

        info!(
            "Entered interactive session {} on {} (CWD: {})",
            interactive_id, session.computer_name, cwd
        );

        Ok(Self {
            session_id: session_id.to_string(),
            interactive_id,
            transport,
            shell_id,
            prompt,
            cwd,
        })
    }

    /// Execute a command in the interactive session.
    pub async fn execute_line(&mut self, line: &str) -> Result<Vec<InteractiveLine>, String> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        // Add to command history
        {
            let mut history = COMMAND_HISTORY.lock().unwrap();
            if let Some(hist) = history.get_mut(&self.session_id) {
                hist.push(trimmed.to_string());
                // Keep last 1000 commands
                if hist.len() > 1000 {
                    hist.remove(0);
                }
            }
        }

        // Handle built-in commands
        match trimmed.to_lowercase().as_str() {
            "exit" | "exit-pssession" => {
                return Err("EXIT_SESSION".to_string());
            }
            _ => {}
        }

        // Mark as busy
        {
            let mut buffers = INTERACTIVE_BUFFERS.lock().unwrap();
            if let Some(buf) = buffers.get_mut(&self.interactive_id) {
                buf.is_busy = true;
                buf.last_command = Some(trimmed.to_string());
            }
        }

        // Execute the command, appending CWD update
        let script = format!(
            "{}\n$__pwd = (Get-Location).Path; Write-Host \"__CWD:$__pwd\"",
            trimmed
        );

        let mut output_lines = Vec::new();

        let command_id = {
            let mut t = self.transport.lock().await;
            t.execute_ps_command(&self.shell_id, &script).await?
        };

        // Collect output
        let (stdout, stderr) = {
            let mut t = self.transport.lock().await;
            t.receive_all_output(&self.shell_id, &command_id).await?
        };

        // Signal command completion
        {
            let mut t = self.transport.lock().await;
            let _ = t
                .signal_command(&self.shell_id, &command_id, WsManSignal::TERMINATE)
                .await;
        }

        // Process stdout
        for line in stdout.lines() {
            // Check for CWD marker
            if line.starts_with("__CWD:") {
                self.cwd = line[6..].to_string();
                self.prompt = format!(
                    "[{}]: PS {}> ",
                    self.session_id.split('-').next().unwrap_or("?"),
                    self.cwd
                );
                continue;
            }

            output_lines.push(InteractiveLine {
                stream: PsStreamType::Output,
                text: line.to_string(),
                timestamp: Utc::now(),
            });
        }

        // Process stderr
        for line in stderr.lines() {
            if !line.trim().is_empty() {
                output_lines.push(InteractiveLine {
                    stream: PsStreamType::Error,
                    text: line.to_string(),
                    timestamp: Utc::now(),
                });
            }
        }

        // Update buffer
        {
            let mut buffers = INTERACTIVE_BUFFERS.lock().unwrap();
            if let Some(buf) = buffers.get_mut(&self.interactive_id) {
                buf.is_busy = false;
                buf.output_lines.extend(output_lines.clone());
                buf.prompt = self.prompt.clone();
                buf.cwd = Some(self.cwd.clone());
            }
        }

        Ok(output_lines)
    }

    /// Send raw input (e.g., for interactive prompts).
    pub async fn send_input(&self, data: &str) -> Result<(), String> {
        // Find any active command and send stdin
        let mut t = self.transport.lock().await;
        // Note: In a full implementation, we'd track the active command ID
        // and send input to it. For now, this is a placeholder.
        debug!(
            "Sending input to interactive session {}: {:?}",
            self.interactive_id, data
        );
        Ok(())
    }

    /// Get tab completion suggestions for the current input.
    pub async fn tab_complete(&self, input: &str, cursor_pos: u32) -> Result<Vec<String>, String> {
        let script = format!(
            "[System.Management.Automation.CommandCompletion]::CompleteInput('{}', {}, $null).CompletionMatches | ForEach-Object {{ $_.CompletionText }}",
            input.replace('\'', "''"),
            cursor_pos
        );

        let command_id = {
            let mut t = self.transport.lock().await;
            t.execute_ps_command(&self.shell_id, &script).await?
        };

        let (stdout, _, _) = {
            let mut t = self.transport.lock().await;
            t.receive_output(&self.shell_id, &command_id).await?
        };

        {
            let mut t = self.transport.lock().await;
            let _ = t
                .signal_command(&self.shell_id, &command_id, WsManSignal::TERMINATE)
                .await;
        }

        let completions: Vec<String> = stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.to_string())
            .collect();

        Ok(completions)
    }

    /// Get command history for this session.
    pub fn get_history(&self) -> Vec<String> {
        COMMAND_HISTORY
            .lock()
            .unwrap()
            .get(&self.session_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Get the current prompt string.
    pub fn prompt(&self) -> &str {
        &self.prompt
    }

    /// Get the current working directory.
    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    /// Get the interactive buffer.
    pub fn get_buffer(&self) -> Option<InteractiveBuffer> {
        INTERACTIVE_BUFFERS
            .lock()
            .unwrap()
            .get(&self.interactive_id)
            .cloned()
    }

    /// Clear the output buffer.
    pub fn clear_buffer(&self) {
        let mut buffers = INTERACTIVE_BUFFERS.lock().unwrap();
        if let Some(buf) = buffers.get_mut(&self.interactive_id) {
            buf.output_lines.clear();
        }
    }

    /// Exit the interactive session.
    pub fn exit(self) {
        INTERACTIVE_BUFFERS
            .lock()
            .unwrap()
            .remove(&self.interactive_id);
        info!(
            "Exited interactive session {} on {}",
            self.interactive_id, self.session_id
        );
    }
}
