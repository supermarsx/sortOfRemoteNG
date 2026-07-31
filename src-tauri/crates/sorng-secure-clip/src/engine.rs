use crate::types::*;
use zeroize::Zeroizing;

const MAX_CLIPBOARD_BYTES: usize = 64 * 1024;

#[cfg(any(unix, test))]
const HELPER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(any(unix, test))]
const HELPER_IO_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(250);

trait ClipboardBackend: Send + Sync {
    fn write(&self, text: &str) -> Result<(), String>;
    fn read(&self) -> Result<String, String>;
}

struct SystemClipboard;

impl ClipboardBackend for SystemClipboard {
    fn write(&self, text: &str) -> Result<(), String> {
        write_os_clipboard(text)
    }

    fn read(&self) -> Result<String, String> {
        read_os_clipboard()
    }
}

pub(crate) struct ConsumedPaste {
    pub entry_id: String,
    pub value: Zeroizing<String>,
    pub paste_count: u32,
    pub cleared: Option<ClipEntry>,
}

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
    ) -> Result<(ClipEntry, Option<ClipEntry>), String> {
        self.copy_with_clipboard(request, config, &SystemClipboard)
    }

    fn copy_with_clipboard(
        &mut self,
        request: &CopyRequest,
        config: &SecureClipConfig,
        clipboard: &dyn ClipboardBackend,
    ) -> Result<(ClipEntry, Option<ClipEntry>), String> {
        if request.one_time && !config.one_time_paste_available {
            return Err("One-time paste is disabled by secure clipboard policy".to_string());
        }

        // Do not claim a secure copy or replace the active entry unless the OS
        // clipboard accepted the value through a trusted backend.
        clipboard.write(&request.value)?;

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

        log::info!(
            "Copied {:?} to secure clipboard (clear in {}s, max_pastes={})",
            entry.kind,
            clear_secs,
            max_pastes
        );

        Ok((entry, previous))
    }

    // ─── Paste / read ───────────────────────────────────────────

    /// Read the current clipboard value (for paste).
    /// Increments paste count and may auto-clear if limits are reached.
    pub(crate) fn paste(&mut self) -> Result<ConsumedPaste, String> {
        self.consume_paste_with_clipboard(None, &SystemClipboard)
    }

    pub(crate) fn paste_by_id(&mut self, entry_id: &str) -> Result<ConsumedPaste, String> {
        self.consume_paste_with_clipboard(Some(entry_id), &SystemClipboard)
    }

    fn consume_paste_with_clipboard(
        &mut self,
        entry_id: Option<&str>,
        clipboard: &dyn ClipboardBackend,
    ) -> Result<ConsumedPaste, String> {
        let (entry_id, value, paste_count, should_clear) = {
            let entry = self
                .current
                .as_mut()
                .ok_or_else(|| "Secure clipboard is empty".to_string())?;

            if let Some(expected_id) = entry_id {
                if entry.id != expected_id {
                    return Err(format!(
                        "Entry '{}' is no longer the current entry",
                        expected_id
                    ));
                }
            }

            if !entry.is_valid() {
                return Err("Clipboard entry has expired or been cleared".to_string());
            }

            entry.paste_count = entry
                .paste_count
                .checked_add(1)
                .ok_or_else(|| "Clipboard paste counter exhausted".to_string())?;
            self.total_pastes = self.total_pastes.saturating_add(1);

            (
                entry.id.clone(),
                Zeroizing::new(entry.value.clone()),
                entry.paste_count,
                entry.max_pastes > 0 && entry.paste_count >= entry.max_pastes,
            )
        };

        let cleared = if should_clear {
            log::info!("Maximum paste count reached, clearing secure clipboard");
            self.clear_with_clipboard(ClearReason::MaxPastes, clipboard)?
        } else {
            None
        };

        Ok(ConsumedPaste {
            entry_id,
            value,
            paste_count,
            cleared,
        })
    }

    // ─── Clear ──────────────────────────────────────────────────

    /// Manually clear the clipboard.
    pub fn clear(&mut self, reason: ClearReason) -> Result<Option<ClipEntry>, String> {
        self.clear_with_clipboard(reason, &SystemClipboard)
    }

    fn clear_with_clipboard(
        &mut self,
        reason: ClearReason,
        clipboard: &dyn ClipboardBackend,
    ) -> Result<Option<ClipEntry>, String> {
        let Some(entry) = self.current.as_ref() else {
            return Ok(None);
        };

        let clipboard_value = Zeroizing::new(clipboard.read().map_err(|_| {
            "Could not verify OS clipboard ownership; secure entry was retained".to_string()
        })?);
        if clipboard_value.as_str() == entry.value {
            clipboard.write("").map_err(|_| {
                "Could not clear the owned OS clipboard value; secure entry was retained"
                    .to_string()
            })?;
        }

        let mut taken = self.current.take();
        if let Some(ref mut entry) = taken {
            entry.cleared = true;
            match reason {
                ClearReason::AutoClear => {
                    self.total_auto_clears = self.total_auto_clears.saturating_add(1)
                }
                ClearReason::ManualClear | ClearReason::AppLocked | ClearReason::AppExit => {
                    self.total_manual_clears = self.total_manual_clears.saturating_add(1);
                }
                _ => {}
            }
        }
        if taken.is_some() {
            log::info!("Secure clipboard cleared (reason: {:?})", reason);
        }
        Ok(taken)
    }

    /// Check if auto-clear should fire now and do it.
    pub fn tick_auto_clear(&mut self) -> Result<Option<ClipEntry>, String> {
        let should_clear = self
            .current
            .as_ref()
            .map(|e| !e.is_valid())
            .unwrap_or(false);

        if should_clear {
            self.clear(ClearReason::AutoClear)
        } else {
            Ok(None)
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
    if text.len() > MAX_CLIPBOARD_BYTES {
        return Err("Clipboard value exceeds the secure size limit".to_string());
    }

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

// ─── Windows ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn write_clipboard_windows(text: &str) -> Result<(), String> {
    use std::mem::size_of;
    use std::ptr::copy_nonoverlapping;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    const CF_UNICODETEXT: u32 = 13;

    let encoded = Zeroizing::new(
        text.encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>(),
    );
    let byte_len = encoded
        .len()
        .checked_mul(size_of::<u16>())
        .filter(|size| *size <= MAX_CLIPBOARD_BYTES)
        .ok_or_else(|| "Clipboard value exceeds the secure size limit".to_string())?;
    let _clipboard = open_clipboard_windows()?;

    // SAFETY: the clipboard is open on this thread, all Win32 return values
    // are checked, and the movable allocation is transferred to the OS only
    // after it has been completely initialized.
    unsafe {
        if EmptyClipboard() == 0 {
            return Err("The OS clipboard could not be cleared".to_string());
        }
        if text.is_empty() {
            return Ok(());
        }

        let allocation = GlobalAlloc(GMEM_MOVEABLE, byte_len);
        if allocation.is_null() {
            return Err("The OS clipboard allocation failed".to_string());
        }

        let destination = GlobalLock(allocation).cast::<u16>();
        if destination.is_null() {
            let _ = GlobalFree(allocation);
            return Err("The OS clipboard allocation could not be locked".to_string());
        }
        copy_nonoverlapping(encoded.as_ptr(), destination, encoded.len());
        let _ = GlobalUnlock(allocation);

        if SetClipboardData(CF_UNICODETEXT, allocation).is_null() {
            let _ = GlobalFree(allocation);
            return Err("The OS clipboard rejected the value".to_string());
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
struct WindowsClipboardGuard;

#[cfg(target_os = "windows")]
impl Drop for WindowsClipboardGuard {
    fn drop(&mut self) {
        // SAFETY: this guard is created only after OpenClipboard succeeds and
        // remains on the same synchronous thread until it is dropped.
        unsafe {
            let _ = windows_sys::Win32::System::DataExchange::CloseClipboard();
        }
    }
}

#[cfg(target_os = "windows")]
fn open_clipboard_windows() -> Result<WindowsClipboardGuard, String> {
    use std::ptr::null_mut;
    use std::thread;
    use std::time::Duration;
    use windows_sys::Win32::System::DataExchange::OpenClipboard;

    for _ in 0..10 {
        // SAFETY: a null owner is explicitly supported by OpenClipboard.
        if unsafe { OpenClipboard(null_mut()) } != 0 {
            return Ok(WindowsClipboardGuard);
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err("The OS clipboard is busy".to_string())
}

// ─── macOS ──────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn write_clipboard_macos(text: &str) -> Result<(), String> {
    write_clipboard_with_helpers(&[ClipboardHelperSpec::new("/usr/bin/pbcopy", &[])], text)
}

// ─── Linux ──────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn write_clipboard_linux(text: &str) -> Result<(), String> {
    write_clipboard_with_helpers(
        &[
            ClipboardHelperSpec::new("/usr/bin/wl-copy", &[]),
            ClipboardHelperSpec::new("/usr/bin/xclip", &["-selection", "clipboard"]),
            ClipboardHelperSpec::new("/usr/bin/xsel", &["--clipboard", "--input"]),
        ],
        text,
    )
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
    use std::mem::size_of;
    use std::slice;
    use windows_sys::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    // SAFETY: this only queries availability and does not dereference memory.
    if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) } == 0 {
        return Err("The OS clipboard does not contain text".to_string());
    }
    let _clipboard = open_clipboard_windows()?;

    // SAFETY: the clipboard remains open while the system-owned global memory
    // is locked and copied into a process-owned, zeroizing buffer.
    let mut encoded = unsafe {
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            return Err("The OS clipboard text is unavailable".to_string());
        }
        let byte_len = GlobalSize(handle);
        if byte_len == 0 || byte_len > MAX_CLIPBOARD_BYTES || byte_len % size_of::<u16>() != 0 {
            return Err("The OS clipboard text exceeds the secure size limit".to_string());
        }
        let source = GlobalLock(handle).cast::<u16>();
        if source.is_null() {
            return Err("The OS clipboard text could not be locked".to_string());
        }
        let copy = Zeroizing::new(slice::from_raw_parts(source, byte_len / 2).to_vec());
        let _ = GlobalUnlock(handle);
        copy
    };

    let terminator = encoded
        .iter()
        .position(|unit| *unit == 0)
        .ok_or_else(|| "The OS clipboard text is malformed".to_string())?;
    encoded.truncate(terminator);
    let value = String::from_utf16(&encoded)
        .map_err(|_| "The OS clipboard text is malformed".to_string())?;
    if value.len() > MAX_CLIPBOARD_BYTES {
        return Err("The OS clipboard text exceeds the secure size limit".to_string());
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
fn read_clipboard_macos() -> Result<String, String> {
    read_clipboard_with_helpers(&[ClipboardHelperSpec::new("/usr/bin/pbpaste", &[])])
}

#[cfg(target_os = "linux")]
fn read_clipboard_linux() -> Result<String, String> {
    read_clipboard_with_helpers(&[
        ClipboardHelperSpec::new("/usr/bin/wl-paste", &["--no-newline"]),
        ClipboardHelperSpec::new("/usr/bin/xclip", &["-selection", "clipboard", "-o"]),
        ClipboardHelperSpec::new("/usr/bin/xsel", &["--clipboard", "--output"]),
    ])
}

#[cfg(unix)]
#[derive(Clone, Copy)]
struct ClipboardHelperSpec {
    program: &'static str,
    args: &'static [&'static str],
}

#[cfg(unix)]
impl ClipboardHelperSpec {
    const fn new(program: &'static str, args: &'static [&'static str]) -> Self {
        Self { program, args }
    }
}

#[cfg(unix)]
fn trusted_helper_command(spec: ClipboardHelperSpec) -> Option<std::process::Command> {
    use std::fs;
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    let path = Path::new(spec.program);
    if !path.is_absolute() || path.parent() != Some(Path::new("/usr/bin")) {
        return None;
    }
    let link_metadata = fs::symlink_metadata(path).ok()?;
    if link_metadata.file_type().is_symlink() {
        return None;
    }
    let canonical = fs::canonicalize(path).ok()?;
    if canonical != path {
        return None;
    }
    let metadata = fs::metadata(&canonical).ok()?;
    let parent_metadata = fs::metadata(canonical.parent()?).ok()?;
    let trusted_mode = |mode: u32| mode & 0o022 == 0;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o111 == 0
        || !trusted_mode(metadata.mode())
        || parent_metadata.uid() != 0
        || !trusted_mode(parent_metadata.mode())
    {
        return None;
    }

    let mut command = std::process::Command::new(canonical);
    command.args(spec.args).env_clear();
    for key in [
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "XAUTHORITY",
        "DBUS_SESSION_BUS_ADDRESS",
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    Some(command)
}

#[cfg(unix)]
fn write_clipboard_with_helpers(helpers: &[ClipboardHelperSpec], text: &str) -> Result<(), String> {
    let mut found_trusted = false;
    for helper in helpers {
        if let Some(command) = trusted_helper_command(*helper) {
            found_trusted = true;
            if run_helper_write(command, text, HELPER_TIMEOUT).is_ok() {
                return Ok(());
            }
        }
    }
    if found_trusted {
        Err("Every trusted clipboard helper failed".to_string())
    } else {
        Err("No trusted clipboard helper is available".to_string())
    }
}

#[cfg(unix)]
fn read_clipboard_with_helpers(helpers: &[ClipboardHelperSpec]) -> Result<String, String> {
    let mut found_trusted = false;
    for helper in helpers {
        if let Some(command) = trusted_helper_command(*helper) {
            found_trusted = true;
            if let Ok(value) = run_helper_read(command, HELPER_TIMEOUT) {
                return Ok(value);
            }
        }
    }
    if found_trusted {
        Err("Every trusted clipboard helper failed".to_string())
    } else {
        Err("No trusted clipboard helper is available".to_string())
    }
}

#[cfg(any(unix, test))]
const MAX_HELPER_OPERATIONS: usize = 16;

#[cfg(any(unix, test))]
static ACTIVE_HELPER_OPERATIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(any(unix, test))]
static HELPER_REAPER: std::sync::OnceLock<Result<HelperReaper, String>> =
    std::sync::OnceLock::new();

#[cfg(any(unix, test))]
struct HelperPermit;

#[cfg(any(unix, test))]
impl HelperPermit {
    fn acquire() -> Result<Self, String> {
        use std::sync::atomic::Ordering;

        let mut current = ACTIVE_HELPER_OPERATIONS.load(Ordering::Acquire);
        loop {
            if current >= MAX_HELPER_OPERATIONS {
                return Err("Secure clipboard helper capacity is exhausted".to_string());
            }
            match ACTIVE_HELPER_OPERATIONS.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(Self),
                Err(actual) => current = actual,
            }
        }
    }
}

#[cfg(any(unix, test))]
impl Drop for HelperPermit {
    fn drop(&mut self) {
        use std::sync::atomic::Ordering;
        ACTIVE_HELPER_OPERATIONS.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(any(unix, test))]
struct HelperReapJob {
    child: Option<std::process::Child>,
    worker: Option<std::thread::JoinHandle<()>>,
    _permit: HelperPermit,
    completion: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

#[cfg(any(unix, test))]
impl HelperReapJob {
    fn poll(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            terminate_helper_process_group(child.id());
            let _ = child.kill();
            match child.try_wait() {
                Ok(Some(_)) => self.child = None,
                Ok(None) | Err(_) => {}
            }
        }

        if self
            .worker
            .as_ref()
            .map(std::thread::JoinHandle::is_finished)
            .unwrap_or(false)
        {
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }

        self.child.is_none() && self.worker.is_none()
    }

    fn notify_complete(&self) {
        if let Some(completion) = &self.completion {
            completion.store(true, std::sync::atomic::Ordering::Release);
        }
    }
}

#[cfg(any(unix, test))]
struct HelperReaper {
    state: std::sync::Arc<(std::sync::Mutex<Vec<HelperReapJob>>, std::sync::Condvar)>,
    _thread: std::thread::JoinHandle<()>,
}

#[cfg(any(unix, test))]
impl HelperReaper {
    fn start() -> Result<Self, String> {
        let state = std::sync::Arc::new((
            std::sync::Mutex::new(Vec::<HelperReapJob>::new()),
            std::sync::Condvar::new(),
        ));
        let thread_state = state.clone();
        let thread = std::thread::Builder::new()
            .name("secure-clip-helper-reaper".to_string())
            .spawn(move || loop {
                let (lock, wake) = &*thread_state;
                let jobs = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let (mut jobs, _) = wake
                    .wait_timeout(jobs, std::time::Duration::from_millis(25))
                    .unwrap_or_else(|poisoned| poisoned.into_inner());

                let mut index = 0;
                while index < jobs.len() {
                    if jobs[index].poll() {
                        let job = jobs.swap_remove(index);
                        job.notify_complete();
                    } else {
                        index += 1;
                    }
                }
            })
            .map_err(|_| "Secure clipboard helper reaper could not be started".to_string())?;
        Ok(Self {
            state,
            _thread: thread,
        })
    }

    fn hand_off(&self, job: HelperReapJob) {
        let (lock, wake) = &*self.state;
        let mut jobs = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        jobs.push(job);
        wake.notify_one();
    }
}

#[cfg(any(unix, test))]
fn helper_reaper() -> Result<&'static HelperReaper, String> {
    HELPER_REAPER
        .get_or_init(HelperReaper::start)
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(any(unix, test))]
struct HelperOperation {
    reaper: &'static HelperReaper,
    child: Option<std::process::Child>,
    worker: Option<std::thread::JoinHandle<()>>,
    permit: Option<HelperPermit>,
    completion: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

#[cfg(any(unix, test))]
impl HelperOperation {
    fn spawn(mut command: std::process::Command) -> Result<Self, String> {
        let reaper = helper_reaper()?;
        let permit = HelperPermit::acquire()?;
        prepare_helper_process_group(&mut command);
        let child = command
            .spawn()
            .map_err(|_| "Trusted clipboard helper could not be started".to_string())?;
        Ok(Self {
            reaper,
            child: Some(child),
            worker: None,
            permit: Some(permit),
            completion: None,
        })
    }

    fn take_stdin(&mut self) -> Result<std::process::ChildStdin, String> {
        match self.child.as_mut().and_then(|child| child.stdin.take()) {
            Some(stdin) => Ok(stdin),
            None => {
                let _ = self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
                Err("Trusted clipboard helper stdin is unavailable".to_string())
            }
        }
    }

    fn take_stdout(&mut self) -> Result<std::process::ChildStdout, String> {
        match self.child.as_mut().and_then(|child| child.stdout.take()) {
            Some(stdout) => Ok(stdout),
            None => {
                let _ = self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
                Err("Trusted clipboard helper output is unavailable".to_string())
            }
        }
    }

    fn set_worker(&mut self, worker: std::thread::JoinHandle<()>) {
        self.worker = Some(worker);
    }

    fn wait_bounded(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<std::process::ExitStatus, String> {
        use std::time::Instant;

        let deadline = Instant::now() + timeout;
        loop {
            let status = self
                .child
                .as_mut()
                .ok_or_else(|| "Trusted clipboard helper is unavailable".to_string())?
                .try_wait();
            match status {
                Ok(Some(status)) => {
                    if let Some(child) = self.child.as_ref() {
                        terminate_helper_process_group(child.id());
                    }
                    self.child = None;
                    return Ok(status);
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Ok(None) => {
                    self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT)?;
                    return Err("Trusted clipboard helper timed out".to_string());
                }
                Err(_) => {
                    self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT)?;
                    return Err("Trusted clipboard helper status failed".to_string());
                }
            }
        }
    }

    fn terminate_and_reap_bounded(&mut self, timeout: std::time::Duration) -> Result<(), String> {
        use std::time::Instant;

        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };
        terminate_helper_process_group(child.id());
        let _ = child.kill();
        if timeout.is_zero() {
            return Err("Trusted clipboard helper reap timed out".to_string());
        }

        let deadline = Instant::now() + timeout;
        loop {
            let status = self
                .child
                .as_mut()
                .expect("helper child remains owned while reaping")
                .try_wait();
            match status {
                Ok(Some(_)) => {
                    self.child = None;
                    return Ok(());
                }
                Ok(None) | Err(_) if Instant::now() < deadline => {
                    if let Some(child) = self.child.as_mut() {
                        terminate_helper_process_group(child.id());
                        let _ = child.kill();
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Ok(None) | Err(_) => {
                    return Err("Trusted clipboard helper reap timed out".to_string());
                }
            }
        }
    }

    fn join_worker_bounded(&mut self, timeout: std::time::Duration) -> Result<(), String> {
        use std::time::Instant;

        let Some(worker) = self.worker.as_ref() else {
            return Ok(());
        };
        let deadline = Instant::now() + timeout;
        while !worker.is_finished() && Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        if !self
            .worker
            .as_ref()
            .map(std::thread::JoinHandle::is_finished)
            .unwrap_or(false)
        {
            return Err("Trusted clipboard helper worker did not terminate".to_string());
        }
        self.worker
            .take()
            .expect("finished helper worker remains owned")
            .join()
            .map_err(|_| "Trusted clipboard helper worker failed".to_string())
    }

    #[cfg(test)]
    fn set_completion_notification(
        &mut self,
        completion: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) {
        self.completion = Some(completion);
    }
}

#[cfg(any(unix, test))]
impl Drop for HelperOperation {
    fn drop(&mut self) {
        if self.child.is_none() && self.worker.is_none() {
            return;
        }
        if let Some(child) = self.child.as_mut() {
            terminate_helper_process_group(child.id());
            let _ = child.kill();
        }
        self.reaper.hand_off(HelperReapJob {
            child: self.child.take(),
            worker: self.worker.take(),
            _permit: self
                .permit
                .take()
                .expect("active helper operation owns its capacity permit"),
            completion: self.completion.take(),
        });
    }
}

#[cfg(any(unix, test))]
fn run_helper_write(
    mut command: std::process::Command,
    text: &str,
    timeout: std::time::Duration,
) -> Result<(), String> {
    use std::io::Write;
    use std::path::Path;
    use std::process::Stdio;
    use std::sync::mpsc;

    if !Path::new(command.get_program()).is_absolute() {
        return Err("Clipboard helper path must be absolute".to_string());
    }
    if text.len() > MAX_CLIPBOARD_BYTES {
        return Err("Clipboard value exceeds the secure size limit".to_string());
    }

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut operation = HelperOperation::spawn(command)?;
    let mut stdin = operation.take_stdin()?;
    let input = Zeroizing::new(text.as_bytes().to_vec());
    let (writer_tx, writer_rx) = mpsc::sync_channel(1);
    let writer = match std::thread::Builder::new()
        .name("secure-clip-helper-input".to_string())
        .spawn(move || {
            let result = stdin.write_all(&input).and_then(|_| stdin.flush());
            drop(stdin);
            let _ = writer_tx.send(result.is_ok());
        }) {
        Ok(writer) => writer,
        Err(_) => {
            let _ = operation.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
            return Err("Trusted clipboard helper input worker could not be started".to_string());
        }
    };
    operation.set_worker(writer);

    let status = operation.wait_bounded(timeout);
    let wrote_all = writer_rx.recv_timeout(HELPER_IO_DRAIN_TIMEOUT);
    if wrote_all.is_err() {
        let _ = operation.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
    }
    operation.join_worker_bounded(HELPER_IO_DRAIN_TIMEOUT)?;
    let status = status?;
    let wrote_all =
        wrote_all.map_err(|_| "Trusted clipboard helper input did not terminate".to_string())?;
    if !wrote_all || !status.success() {
        return Err("Trusted clipboard helper rejected the value".to_string());
    }
    Ok(())
}

#[cfg(any(unix, test))]
fn run_helper_read(
    mut command: std::process::Command,
    timeout: std::time::Duration,
) -> Result<String, String> {
    use std::io::Read;
    use std::path::Path;
    use std::process::Stdio;
    use std::sync::mpsc;

    if !Path::new(command.get_program()).is_absolute() {
        return Err("Clipboard helper path must be absolute".to_string());
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut operation = HelperOperation::spawn(command)?;
    let stdout = operation.take_stdout()?;
    let (reader_tx, reader_rx) = mpsc::sync_channel(1);
    let reader = match std::thread::Builder::new()
        .name("secure-clip-helper-output".to_string())
        .spawn(move || {
            let mut output = Zeroizing::new(Vec::new());
            let result = stdout
                .take((MAX_CLIPBOARD_BYTES + 1) as u64)
                .read_to_end(&mut output)
                .map(|_| output)
                .map_err(|_| ());
            let _ = reader_tx.send(result);
        }) {
        Ok(reader) => reader,
        Err(_) => {
            let _ = operation.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
            return Err("Trusted clipboard helper output worker could not be started".to_string());
        }
    };
    operation.set_worker(reader);

    let status = operation.wait_bounded(timeout);
    let output = reader_rx.recv_timeout(HELPER_IO_DRAIN_TIMEOUT);
    if output.is_err() {
        let _ = operation.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
    }
    operation.join_worker_bounded(HELPER_IO_DRAIN_TIMEOUT)?;
    let status = status?;
    let output = output
        .map_err(|_| "Trusted clipboard helper output did not terminate".to_string())?
        .map_err(|_| "Trusted clipboard helper output failed".to_string())?;
    if !status.success() {
        return Err("Trusted clipboard helper failed".to_string());
    }
    if output.len() > MAX_CLIPBOARD_BYTES {
        return Err("Clipboard text exceeds the secure size limit".to_string());
    }
    std::str::from_utf8(&output)
        .map(str::to_owned)
        .map_err(|_| "Clipboard text is not valid UTF-8".to_string())
}

#[cfg(any(unix, test))]
fn prepare_helper_process_group(command: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

#[cfg(unix)]
fn terminate_helper_process_group(child_id: u32) {
    if child_id <= i32::MAX as u32 {
        // SAFETY: helpers are spawned into a fresh process group whose ID is
        // the direct child's PID. A negative PID targets only that group.
        unsafe {
            libc::kill(-(child_id as i32), libc::SIGKILL);
        }
    }
}

#[cfg(all(test, not(unix)))]
fn terminate_helper_process_group(_child_id: u32) {}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::process::Command;
    use std::sync::{Arc, Barrier, Mutex};
    use std::time::{Duration, Instant};

    const HELPER_MODE: &str = "SORNG_SECURE_CLIP_TEST_HELPER_MODE";

    #[derive(Clone, Default)]
    struct FakeClipboard {
        state: Arc<Mutex<FakeClipboardState>>,
    }

    #[derive(Default)]
    struct FakeClipboardState {
        value: String,
        fail_read: bool,
        fail_write: bool,
    }

    impl ClipboardBackend for FakeClipboard {
        fn write(&self, text: &str) -> Result<(), String> {
            let mut state = self.state.lock().expect("fake clipboard lock");
            if state.fail_write {
                return Err("injected write failure".to_string());
            }
            state.value = text.to_string();
            Ok(())
        }

        fn read(&self) -> Result<String, String> {
            let state = self.state.lock().expect("fake clipboard lock");
            if state.fail_read {
                return Err("injected read failure".to_string());
            }
            Ok(state.value.clone())
        }
    }

    impl FakeClipboard {
        fn set_external(&self, value: &str) {
            self.state.lock().expect("fake clipboard lock").value = value.to_string();
        }

        fn value(&self) -> String {
            self.state
                .lock()
                .expect("fake clipboard lock")
                .value
                .clone()
        }

        fn fail_writes(&self, fail: bool) {
            self.state.lock().expect("fake clipboard lock").fail_write = fail;
        }
    }

    fn secret_request(one_time: bool) -> CopyRequest {
        CopyRequest {
            value: "fake-secret".to_string(),
            kind: SecretKind::Password,
            label: None,
            connection_id: None,
            field: None,
            clear_after_secs: None,
            max_pastes: None,
            one_time,
        }
    }

    fn helper_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().expect("test executable"));
        command
            .args([
                "--exact",
                "engine::tests::clipboard_helper_process",
                "--nocapture",
            ])
            .env(HELPER_MODE, mode)
            .env("RUST_TEST_THREADS", "1");
        command
    }

    #[test]
    fn clipboard_helper_process() {
        let Ok(mode) = std::env::var(HELPER_MODE) else {
            return;
        };
        match mode.as_str() {
            "write" => {
                let mut input = Zeroizing::new(Vec::new());
                let success = std::io::stdin().read_to_end(&mut input).is_ok()
                    && input.as_slice() == b"fake-secret";
                std::process::exit(if success { 0 } else { 2 });
            }
            "read" => {
                let _ = std::io::stdout().write_all(b"fake-clipboard");
                let _ = std::io::stdout().flush();
                std::process::exit(0);
            }
            "overflow" => {
                let output = vec![b'x'; MAX_CLIPBOARD_BYTES + 1];
                let _ = std::io::stdout().write_all(&output);
                let _ = std::io::stdout().flush();
                std::process::exit(0);
            }
            "hang" => std::thread::sleep(Duration::from_secs(5)),
            _ => std::process::exit(3),
        }
    }

    #[test]
    fn helper_write_uses_stdin_and_absolute_executable() {
        run_helper_write(
            helper_command("write"),
            "fake-secret",
            Duration::from_secs(1),
        )
        .expect("fake helper should accept stdin");

        let relative = Command::new("untrusted-relative-helper");
        assert!(run_helper_write(relative, "fake-secret", Duration::from_millis(10)).is_err());
    }

    #[test]
    fn helper_read_is_capped() {
        let value = run_helper_read(helper_command("read"), Duration::from_secs(1))
            .expect("fake helper should return bounded text");
        assert!(value.contains("fake-clipboard"));

        assert!(run_helper_read(helper_command("overflow"), Duration::from_secs(1)).is_err());
    }

    #[test]
    fn timed_out_helper_is_killed_and_reaped() {
        let started = Instant::now();
        assert!(run_helper_read(helper_command("hang"), Duration::from_millis(50)).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn unavailable_pipes_terminate_and_reap_helpers() {
        for missing_stdin in [true, false] {
            let mut command = helper_command("hang");
            command
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null());
            let mut operation = HelperOperation::spawn(command).expect("helper process");
            if missing_stdin {
                drop(operation.child.as_mut().expect("owned helper").stdin.take());
                assert!(operation.take_stdin().is_err());
            } else {
                drop(
                    operation
                        .child
                        .as_mut()
                        .expect("owned helper")
                        .stdout
                        .take(),
                );
                assert!(operation.take_stdout().is_err());
            }
            assert!(operation.child.is_none());
        }
    }

    fn wait_for_reaper(completion: &std::sync::atomic::AtomicBool) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !completion.load(std::sync::atomic::Ordering::Acquire) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(completion.load(std::sync::atomic::Ordering::Acquire));
    }

    #[test]
    fn stuck_worker_is_retained_by_the_bounded_reaper() {
        let reaper = helper_reaper().expect("central helper reaper");
        let permit = HelperPermit::acquire().expect("helper capacity");
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel::<()>(1);
        let worker = std::thread::spawn(move || {
            let _ = release_rx.recv();
        });
        let completion = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut operation = HelperOperation {
            reaper,
            child: None,
            worker: Some(worker),
            permit: Some(permit),
            completion: Some(completion.clone()),
        };

        assert!(operation
            .join_worker_bounded(Duration::from_millis(20))
            .is_err());
        drop(operation);
        release_tx.send(()).expect("release retained worker");
        wait_for_reaper(&completion);
    }

    #[test]
    fn reap_timeout_hands_process_ownership_to_the_reaper() {
        let mut command = helper_command("hang");
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let completion = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut operation = HelperOperation::spawn(command).expect("helper process");
        operation.set_completion_notification(completion.clone());

        assert!(operation
            .terminate_and_reap_bounded(Duration::ZERO)
            .is_err());
        drop(operation);
        wait_for_reaper(&completion);
    }

    #[test]
    fn one_time_policy_is_enforced_before_clipboard_write() {
        let clipboard = FakeClipboard::default();
        let mut engine = ClipEngine::new();
        let config = SecureClipConfig {
            one_time_paste_available: false,
            ..SecureClipConfig::default()
        };

        assert!(engine
            .copy_with_clipboard(&secret_request(true), &config, &clipboard)
            .is_err());
        assert_eq!(clipboard.value(), "");
    }

    #[test]
    fn clear_preserves_unrelated_clipboard_content() {
        let clipboard = FakeClipboard::default();
        let mut engine = ClipEngine::new();
        engine
            .copy_with_clipboard(
                &secret_request(false),
                &SecureClipConfig::default(),
                &clipboard,
            )
            .expect("copy");
        clipboard.set_external("user-content");

        assert!(engine
            .clear_with_clipboard(ClearReason::ManualClear, &clipboard)
            .expect("clear")
            .is_some());
        assert_eq!(clipboard.value(), "user-content");
        assert!(engine.current_entry().is_none());
    }

    #[test]
    fn clear_failure_retains_recovery_state() {
        let clipboard = FakeClipboard::default();
        let mut engine = ClipEngine::new();
        engine
            .copy_with_clipboard(
                &secret_request(false),
                &SecureClipConfig::default(),
                &clipboard,
            )
            .expect("copy");
        clipboard.fail_writes(true);

        assert!(engine
            .clear_with_clipboard(ClearReason::ManualClear, &clipboard)
            .is_err());
        assert!(engine.current_entry().is_some());
        assert_eq!(clipboard.value(), "fake-secret");
    }

    #[test]
    fn lock_clear_removes_only_the_owned_secret() {
        let clipboard = FakeClipboard::default();
        let mut engine = ClipEngine::new();
        engine
            .copy_with_clipboard(
                &secret_request(false),
                &SecureClipConfig::default(),
                &clipboard,
            )
            .expect("copy");

        let cleared = engine
            .clear_with_clipboard(ClearReason::AppLocked, &clipboard)
            .expect("lock clear");
        assert!(cleared.is_some());
        assert_eq!(clipboard.value(), "");
        assert!(engine.current_entry().is_none());
    }

    #[test]
    fn one_time_consumption_is_atomic_across_threads() {
        let clipboard = Arc::new(FakeClipboard::default());
        let mut initial = ClipEngine::new();
        initial
            .copy_with_clipboard(
                &secret_request(true),
                &SecureClipConfig::default(),
                clipboard.as_ref(),
            )
            .expect("copy");
        let engine = Arc::new(Mutex::new(initial));
        let barrier = Arc::new(Barrier::new(8));

        let workers: Vec<_> = (0..8)
            .map(|_| {
                let engine = engine.clone();
                let clipboard = clipboard.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    engine
                        .lock()
                        .expect("engine lock")
                        .consume_paste_with_clipboard(None, clipboard.as_ref())
                        .is_ok()
                })
            })
            .collect();
        let successes = workers
            .into_iter()
            .filter(|worker| worker.join().expect("worker"))
            .count();

        assert_eq!(successes, 1);
        assert_eq!(clipboard.value(), "");
    }

    #[test]
    fn masking_is_unicode_scalar_safe() {
        let entry = ClipEntry::new(
            "🔐秘密abcé".to_string(),
            SecretKind::Password,
            None,
            None,
            None,
            30,
            0,
        );
        assert_eq!(entry.to_display().masked_value, "🔐••••é");
    }
}
