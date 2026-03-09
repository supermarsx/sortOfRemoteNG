use crate::types::*;

/// The core clipboard engine — holds the **one** current entry and provides
/// OS clipboard read/write behind a memory-safe abstraction.
///
/// Design goals (similar to secure password-manager clipboard patterns):
///  1. Only **one** secret on the clipboard at a time.
///  2. The plaintext value lives only in process memory — never on disk.
///  3. Auto-clear fires after a configurable timeout.
///  4. Optional "one-time paste" — entry self-destructs after first use.
///  5. Paste-to-terminal sends the value directly to an SSH session
///     without ever touching the OS clipboard.
pub struct ClipEngine {
    /// The active clipboard entry (None when empty).
    current: Option<ClipEntry>,
    /// Counters for stats.
    total_copies: u64,
    total_pastes: u64,
    total_auto_clears: u64,
    total_manual_clears: u64,
}

impl Default for ClipEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ClipEngine {
    pub fn new() -> Self {
        Self {
            current: None,
            total_copies: 0,
            total_pastes: 0,
            total_auto_clears: 0,
            total_manual_clears: 0,
        }
    }

    // ─── Copy ───────────────────────────────────────────────────

    /// Place a value on the secure clipboard.
    /// This replaces any existing entry (the old one is returned for history).
    pub fn copy(
        &mut self,
        request: &CopyRequest,
        config: &SecureClipConfig,
    ) -> (ClipEntry, Option<ClipEntry>) {
        // Resolve timeout.
        let clear_secs = request.clear_after_secs.unwrap_or_else(|| {
            let override_secs = config.kind_clear_overrides.get(&request.kind).copied();
            override_secs.unwrap_or_else(|| {
                if config.auto_clear_secs > 0 {
                    config.auto_clear_secs
                } else {
                    request.kind.default_clear_secs()
                }
            })
        });

        // Resolve max pastes.
        let max_pastes = if request.one_time {
            1
        } else {
            request.max_pastes.unwrap_or(config.default_max_pastes)
        };

        let entry = ClipEntry::new(
            request.value.clone(),
            request.kind,
            request.label.clone(),
            request.connection_id.clone(),
            request.field.clone(),
            clear_secs,
            max_pastes,
        );

        // Replace old entry.
        let mut previous = self.current.take();
        if let Some(ref mut prev) = previous {
            prev.cleared = true;
        }

        self.current = Some(entry.clone());
        self.total_copies += 1;

        // Write to OS clipboard.
        if let Err(e) = write_os_clipboard(&entry.value) {
            log::warn!("Failed to write to OS clipboard: {}", e);
        }

        log::info!(
            "Copied {:?} to secure clipboard (clear in {}s, max_pastes={})",
            entry.kind,
            clear_secs,
            max_pastes
        );

        (entry, previous)
    }

    // ─── Paste / read ───────────────────────────────────────────

    /// Read the current clipboard value (for paste).
    /// Increments paste count and may auto-clear if limits are reached.
    pub fn paste(&mut self) -> Result<String, String> {
        let entry = self
            .current
            .as_mut()
            .ok_or_else(|| "Secure clipboard is empty".to_string())?;

        if !entry.is_valid() {
            return Err("Clipboard entry has expired or been cleared".to_string());
        }

        entry.paste_count += 1;
        self.total_pastes += 1;

        let value = entry.value.clone();

        // Check if we hit max pastes.
        if entry.max_pastes > 0 && entry.paste_count >= entry.max_pastes {
            log::info!("Max pastes ({}) reached, clearing", entry.max_pastes);
            entry.cleared = true;
            clear_os_clipboard();
        }

        Ok(value)
    }

    /// Read the current entry value by ID (for targeted paste-to-terminal).
    pub fn paste_by_id(&mut self, entry_id: &str) -> Result<String, String> {
        let entry = self
            .current
            .as_mut()
            .ok_or_else(|| "Secure clipboard is empty".to_string())?;

        if entry.id != entry_id {
            return Err(format!(
                "Entry '{}' is no longer the current entry",
                entry_id
            ));
        }

        self.paste()
    }

    // ─── Clear ──────────────────────────────────────────────────

    /// Manually clear the clipboard.
    pub fn clear(&mut self, reason: ClearReason) -> Option<ClipEntry> {
        if let Some(ref mut entry) = self.current {
            entry.cleared = true;
            match reason {
                ClearReason::AutoClear => self.total_auto_clears += 1,
                ClearReason::ManualClear | ClearReason::AppLocked | ClearReason::AppExit => {
                    self.total_manual_clears += 1;
                }
                _ => {}
            }
        }

        clear_os_clipboard();

        let taken = self.current.take();
        if taken.is_some() {
            log::info!("Secure clipboard cleared (reason: {:?})", reason);
        }
        taken
    }

    /// Check if auto-clear should fire now and do it.
    pub fn tick_auto_clear(&mut self) -> Option<ClipEntry> {
        let should_clear = self
            .current
            .as_ref()
            .map(|e| !e.is_valid())
            .unwrap_or(false);

        if should_clear {
            self.clear(ClearReason::AutoClear)
        } else {
            None
        }
    }

    // ─── Query ──────────────────────────────────────────────────

    /// Is there an active entry?
    pub fn has_entry(&self) -> bool {
        self.current.as_ref().map(|e| e.is_valid()).unwrap_or(false)
    }

    /// Get a display-safe view of the current entry.
    pub fn current_display(&self) -> Option<ClipEntryDisplay> {
        self.current.as_ref().map(|e| e.to_display())
    }

    /// Get raw current entry (for internal service use only).
    pub fn current_entry(&self) -> Option<&ClipEntry> {
        self.current.as_ref()
    }

    /// Public static wrapper for `read_os_clipboard` (no &self needed).
    pub fn read_os_clipboard_static() -> Result<String, String> {
        read_os_clipboard()
    }

    /// Stats.
    pub fn stats(&self) -> SecureClipStats {
        SecureClipStats {
            current_entry_active: self.has_entry(),
            current_entry_kind: self.current.as_ref().map(|e| e.kind),
            seconds_remaining: self.current.as_ref().and_then(|e| e.seconds_remaining()),
            total_copies: self.total_copies,
            total_pastes: self.total_pastes,
            total_auto_clears: self.total_auto_clears,
            total_manual_clears: self.total_manual_clears,
            history_entries: 0, // filled by service
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  OS clipboard helpers
// ═══════════════════════════════════════════════════════════════════════

/// Write text to the operating-system clipboard.
fn write_os_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return write_clipboard_windows(text);
    }

    #[cfg(target_os = "macos")]
    {
        return write_clipboard_macos(text);
    }

    #[cfg(target_os = "linux")]
    {
        return write_clipboard_linux(text);
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

/// Clear the operating-system clipboard.
fn clear_os_clipboard() {
    if let Err(e) = write_os_clipboard("") {
        log::warn!("Failed to clear OS clipboard: {}", e);
    }
}

// ─── Windows ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn write_clipboard_windows(text: &str) -> Result<(), String> {
    use std::process::Command;
    // Use PowerShell's Set-Clipboard. For empty strings, use `$null` to clear.
    let _script = if text.is_empty() {
        "Set-Clipboard -Value $null".to_string()
    } else {
        // Pipe via stdin to avoid escaping issues.
        format!(
            "[System.Windows.Forms.Clipboard]::SetText('{}')",
            text.replace('\'', "''")
        )
    };

    // Prefer a simpler approach: echo | clip or Set-Clipboard.
    let output = if text.is_empty() {
        Command::new("powershell")
            .args(["-NoProfile", "-Command", "Set-Clipboard -Value $null"])
            .output()
    } else {
        // Write to a temp process via stdin → Set-Clipboard.
        let mut child = Command::new("powershell")
            .args(["-NoProfile", "-Command", "$input | Set-Clipboard"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn clipboard write: {}", e))?;

        if let Some(ref mut stdin) = child.stdin {
            use std::io::Write;
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to clipboard stdin: {}", e))?;
        }
        // Drop stdin so the process can finish.
        drop(child.stdin.take());
        child.wait_with_output()
    };

    output
        .map_err(|e| format!("Clipboard write failed: {}", e))
        .and_then(|o| {
            if o.status.success() {
                Ok(())
            } else {
                Err(format!(
                    "Clipboard write returned {}",
                    String::from_utf8_lossy(&o.stderr)
                ))
            }
        })
}

// ─── macOS ──────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn write_clipboard_macos(text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::Command;

    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn pbcopy: {}", e))?;

    if let Some(ref mut stdin) = child.stdin {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Failed to write to pbcopy: {}", e))?;
    }
    drop(child.stdin.take());

    let output = child
        .wait_with_output()
        .map_err(|e| format!("pbcopy failed: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "pbcopy returned: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

// ─── Linux ──────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn write_clipboard_linux(text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::Command;

    // Try xclip first, fall back to xsel, then wl-copy for Wayland.
    let programs = [
        ("xclip", vec!["-selection", "clipboard"]),
        ("xsel", vec!["--clipboard", "--input"]),
        ("wl-copy", vec![]),
    ];

    for (prog, args) in &programs {
        if let Ok(mut child) = Command::new(prog)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            if let Some(ref mut stdin) = child.stdin {
                let _ = stdin.write_all(text.as_bytes());
            }
            drop(child.stdin.take());
            if let Ok(status) = child.wait() {
                if status.success() {
                    return Ok(());
                }
            }
        }
    }

    Err("No clipboard utility found (tried xclip, xsel, wl-copy)".to_string())
}

/// Read text from the operating-system clipboard.
pub fn read_os_clipboard() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        return read_clipboard_windows();
    }

    #[cfg(target_os = "macos")]
    {
        return read_clipboard_macos();
    }

    #[cfg(target_os = "linux")]
    {
        return read_clipboard_linux();
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

#[cfg(target_os = "windows")]
fn read_clipboard_windows() -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Clipboard"])
        .output()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn read_clipboard_macos() -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "linux")]
fn read_clipboard_linux() -> Result<String, String> {
    use std::process::Command;
    let programs = [
        ("xclip", vec!["-selection", "clipboard", "-o"]),
        ("xsel", vec!["--clipboard", "--output"]),
        ("wl-paste", vec![]),
    ];

    for (prog, args) in &programs {
        if let Ok(output) = Command::new(prog).args(args).output() {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).to_string());
            }
        }
    }

    Err("No clipboard utility found".to_string())
}
