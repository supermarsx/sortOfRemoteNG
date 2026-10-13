use crate::types::*;
use zeroize::Zeroizing;

/// Backends enforce the absolute ceiling; each copy enforces its configured limit.
/// UTF-16 can use at most two bytes per UTF-8 byte, plus its terminator.
const MAX_CLIPBOARD_UTF16_BYTES: usize = (MAX_CLIPBOARD_BYTES + 1) * 2;

#[cfg(unix)]
const HELPER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(any(unix, test))]
const HELPER_IO_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(250);

/// What the OS clipboard holds, as far as ownership is concerned.
pub(crate) enum ClipboardSnapshot {
    /// Plain text within the secure size limit.
    Text(Zeroizing<String>),
    /// Content this engine cannot have written: no text format at all (an
    /// image, files, an empty clipboard), or text that is oversized or
    /// malformed.
    Foreign,
}

impl ClipboardSnapshot {
    /// The clipboard is the engine's only while its text is exactly `value`.
    fn holds(&self, value: &str) -> bool {
        matches!(self, Self::Text(text) if text.as_str() == value)
    }
}

/// What a conditional clear did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClearOutcome {
    /// The clipboard still held the expected value and was emptied.
    Cleared,
    /// The clipboard holds something else and was left untouched.
    NotOwned,
}

/// The OS clipboard as the engine uses it.
///
/// Tests substitute an in-memory fake (`fake::FakeClipboard`); nothing in the
/// test suite may reach [`SystemClipboard`].
pub(crate) trait ClipboardBackend: Send + Sync {
    /// Replace the clipboard content with `text`, marked as a secret where
    /// the platform has a way to say so.
    fn write_secret(&self, text: &str) -> Result<(), SecureClipError>;

    fn clear_matching(&self, expected: &str) -> Result<ClearOutcome, SecureClipError> {
        self.clear_if(expected.len(), &|snapshot| snapshot.holds(expected))
    }

    /// Empty the clipboard if, and only if, `is_owned` accepts what it holds
    /// at that moment.
    ///
    /// `Ok(NotOwned)` leaves the clipboard exactly as it was. An error means
    /// that ownership could not be established, or that owned content could
    /// not be removed; either way the caller still has a secret to clear.
    fn clear_if(
        &self,
        max_bytes: usize,
        is_owned: &dyn Fn(&ClipboardSnapshot) -> bool,
    ) -> Result<ClearOutcome, SecureClipError>;
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
///
/// Ownership rule, applied before every clear (manual, auto, paste limit,
/// lock and exit): the OS clipboard is emptied only while its text is exactly
/// the current entry's value. If it holds anything else, including no text at
/// all, the user or another program has replaced it; the entry is forgotten
/// and the clipboard is not written. Same text placed by another program
/// cannot be told apart and is cleared: it is still the secret.
pub struct ClipEngine {
    /// The active clipboard entry (None when empty).
    current: Option<ClipEntry>,
    /// Where secrets are written and cleared.
    clipboard: Box<dyn ClipboardBackend>,
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
        Self::with_backend(Box::new(SystemClipboard))
    }

    pub(crate) fn with_backend(clipboard: Box<dyn ClipboardBackend>) -> Self {
        Self {
            current: None,
            clipboard,
            total_copies: 0,
            total_pastes: 0,
            total_auto_clears: 0,
            total_manual_clears: 0,
        }
    }

    // ─── Copy ───────────────────────────────────────────────────

    /// Place a value on the secure clipboard.
    /// This replaces any existing entry (the old one is returned for history).
    ///
    /// Every refusal happens before the OS clipboard is touched, except a
    /// failure of the write itself. A failed copy leaves the previous entry in
    /// place so that it is still cleared on time.
    pub fn copy(
        &mut self,
        request: &CopyRequest,
        config: &SecureClipConfig,
    ) -> Result<(ClipEntry, Option<ClipEntry>), SecureClipError> {
        if request.one_time && !config.one_time_paste_available {
            return Err(SecureClipError::Unavailable);
        }
        if !(MIN_CLIPBOARD_BYTES..=MAX_CLIPBOARD_BYTES).contains(&config.max_value_bytes) {
            return Err(SecureClipError::InvalidRequest);
        }
        if request.value.len() > config.max_value_bytes {
            return Err(SecureClipError::TooLarge);
        }
        validate_value(&request.value)?;
        let clear_secs = resolve_clear_secs(request, config)?;

        // Do not claim a secure copy or replace the active entry unless the OS
        // clipboard accepted the value through a trusted backend.
        self.clipboard.write_secret(&request.value)?;

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
    pub(crate) fn paste(&mut self) -> Result<ConsumedPaste, SecureClipError> {
        self.consume_paste(None)
    }

    pub(crate) fn paste_by_id(&mut self, entry_id: &str) -> Result<ConsumedPaste, SecureClipError> {
        self.consume_paste(Some(entry_id))
    }

    fn consume_paste(&mut self, entry_id: Option<&str>) -> Result<ConsumedPaste, SecureClipError> {
        let (entry_id, value, paste_count, should_clear) = {
            let entry = self.current.as_mut().ok_or(SecureClipError::Empty)?;

            if entry_id.is_some_and(|expected| entry.id != expected) {
                return Err(SecureClipError::Stale);
            }

            if !entry.is_valid() {
                return Err(SecureClipError::Expired);
            }

            entry.paste_count = entry
                .paste_count
                .checked_add(1)
                .ok_or(SecureClipError::Unavailable)?;
            self.total_pastes = self.total_pastes.saturating_add(1);

            (
                entry.id.clone(),
                Zeroizing::new(entry.value.as_str().to_owned()),
                entry.paste_count,
                entry.max_pastes > 0 && entry.paste_count >= entry.max_pastes,
            )
        };

        let cleared = if should_clear {
            log::info!("Maximum paste count reached, clearing secure clipboard");
            // The paste is already spent, so it is delivered even when the
            // clear cannot be verified right now. The exhausted entry can no
            // longer be pasted and the next auto-clear tick retries the clear.
            self.clear(ClearReason::MaxPastes).unwrap_or_else(|error| {
                log::warn!("Secure clipboard clear after the last paste is pending: {error}");
                None
            })
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

    /// Retire the current entry: empty the OS clipboard if it still holds the
    /// entry's value, then forget the entry.
    ///
    /// `Ok(Some(entry))` means the entry is gone, whether or not the OS
    /// clipboard still belonged to it. `Err` means ownership could not be
    /// verified or the owned value could not be removed; the entry is kept so
    /// that the clear can be retried, because the secret may still be there.
    pub fn clear(&mut self, reason: ClearReason) -> Result<Option<ClipEntry>, SecureClipError> {
        let Some(entry) = self.current.as_ref() else {
            return Ok(None);
        };

        let outcome = self.clipboard.clear_matching(&entry.value)?;

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
            match outcome {
                ClearOutcome::Cleared => {
                    log::info!("Secure clipboard cleared (reason: {:?})", reason)
                }
                ClearOutcome::NotOwned => log::info!(
                    "Secure clipboard entry retired; the clipboard no longer held it (reason: {:?})",
                    reason
                ),
            }
        }
        Ok(taken)
    }

    /// Check if auto-clear should fire now and do it.
    pub fn tick_auto_clear(&mut self) -> Result<Option<ClipEntry>, SecureClipError> {
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

    /// Make the current entry's auto-clear due without waiting for the clock.
    #[cfg(test)]
    pub(crate) fn expire_current(&mut self) {
        if let Some(entry) = self.current.as_mut() {
            entry.expires_at = Some(chrono::Utc::now() - chrono::Duration::seconds(1));
        }
    }
}

/// A value the engine can put on the clipboard and recognise again later.
fn validate_value(value: &str) -> Result<(), SecureClipError> {
    if value.len() > MAX_CLIPBOARD_BYTES {
        return Err(SecureClipError::TooLarge);
    }
    // An empty copy would only wipe what the user has on the clipboard, and
    // clipboard text ends at the first NUL, so neither could be owned later.
    if value.is_empty() || value.contains('\0') {
        return Err(SecureClipError::InvalidRequest);
    }
    Ok(())
}

/// The auto-clear delay for a request, in seconds (0 = no auto-clear, which
/// only policy can choose).
fn resolve_clear_secs(
    request: &CopyRequest,
    config: &SecureClipConfig,
) -> Result<u64, SecureClipError> {
    if let Some(seconds) = request.clear_after_secs {
        return if (MIN_REQUEST_CLEAR_SECS..=MAX_REQUEST_CLEAR_SECS).contains(&seconds) {
            Ok(seconds)
        } else {
            Err(SecureClipError::InvalidRequest)
        };
    }

    let override_secs = config.kind_clear_overrides.get(&request.kind).copied();
    let policy_secs = override_secs.unwrap_or_else(|| {
        if config.auto_clear_secs > 0 {
            config.auto_clear_secs
        } else {
            request.kind.default_clear_secs()
        }
    });
    Ok(policy_secs.min(MAX_POLICY_CLEAR_SECS))
}

// ═══════════════════════════════════════════════════════════════════════
//  OS clipboard helpers
// ═══════════════════════════════════════════════════════════════════════

struct SystemClipboard;

impl ClipboardBackend for SystemClipboard {
    fn write_secret(&self, text: &str) -> Result<(), SecureClipError> {
        write_os_clipboard(text)
    }

    fn clear_matching(&self, expected: &str) -> Result<ClearOutcome, SecureClipError> {
        #[cfg(target_os = "windows")]
        {
            clear_session_matching(&mut open_clipboard_windows()?, expected)
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.clear_if(expected.len(), &|snapshot| snapshot.holds(expected))
        }
    }

    fn clear_if(
        &self,
        max_bytes: usize,
        is_owned: &dyn Fn(&ClipboardSnapshot) -> bool,
    ) -> Result<ClearOutcome, SecureClipError> {
        clear_os_clipboard_if(max_bytes, is_owned)
    }
}

/// Write text to the operating-system clipboard.
fn write_os_clipboard(text: &str) -> Result<(), SecureClipError> {
    if text.len() > MAX_CLIPBOARD_BYTES {
        return Err(SecureClipError::TooLarge);
    }

    #[cfg(target_os = "windows")]
    {
        return write_clipboard_windows(text);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        return write_clipboard_with_trusted_helpers(text);
    }

    #[allow(unreachable_code)]
    Err(SecureClipError::Unavailable)
}

/// What the operating-system clipboard holds as text.
fn snapshot_os_clipboard() -> Result<ClipboardSnapshot, SecureClipError> {
    #[cfg(target_os = "windows")]
    {
        return Ok(open_clipboard_windows()?.snapshot());
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        return snapshot_clipboard_with_trusted_helpers();
    }

    #[allow(unreachable_code)]
    Err(SecureClipError::Unavailable)
}

/// Read text from the operating-system clipboard.
///
/// The engine never needs the text itself, only whether it is the value it
/// wrote; this entry point exists for the isolated platform tests.
pub fn read_os_clipboard() -> Result<String, SecureClipError> {
    match snapshot_os_clipboard()? {
        ClipboardSnapshot::Text(text) => Ok(text.as_str().to_owned()),
        ClipboardSnapshot::Foreign => Err(SecureClipError::Unavailable),
    }
}

/// Empty the operating-system clipboard if `is_owned` accepts its content.
fn clear_os_clipboard_if(
    max_bytes: usize,
    is_owned: &dyn Fn(&ClipboardSnapshot) -> bool,
) -> Result<ClearOutcome, SecureClipError> {
    #[cfg(target_os = "windows")]
    {
        // One open session: Windows lets no other program change the
        // clipboard between the ownership check and the clear.
        return clear_session_bounded_if(&mut open_clipboard_windows()?, max_bytes, is_owned);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // Helper processes cannot hold the clipboard between reading it and
        // emptying it, so here a copy made in that short gap can be lost.
        if !is_owned(&read_with_helpers_bounded(
            trusted_commands(READ_HELPERS),
            HELPER_TIMEOUT,
            max_bytes,
        )?) {
            return Ok(ClearOutcome::NotOwned);
        }
        write_clipboard_with_trusted_helpers("")?;
        return Ok(ClearOutcome::Cleared);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    let _ = is_owned;

    #[allow(unreachable_code)]
    Err(SecureClipError::Unavailable)
}

// ─── Clipboard sessions ─────────────────────────────────────────────

/// A registered clipboard format that keeps an item out of clipboard history
/// and cross-device sync.
#[cfg(any(target_os = "windows", test))]
struct ExclusionFormat {
    name: &'static str,
    payload: [u8; 4],
}

/// The formats Windows documents for opting a clipboard item out of history
/// and cloud sync. The first works by being present with any data; the other
/// two each carry a serialized DWORD zero.
/// https://learn.microsoft.com/windows/win32/dataxchg/clipboard-formats#cloud-clipboard-and-clipboard-history-formats
#[cfg(any(target_os = "windows", test))]
const EXCLUSION_FORMATS: [ExclusionFormat; 3] = [
    ExclusionFormat {
        name: "ExcludeClipboardContentFromMonitorProcessing",
        payload: [0; 4],
    },
    ExclusionFormat {
        name: "CanIncludeInClipboardHistory",
        payload: [0; 4],
    },
    ExclusionFormat {
        name: "CanUploadToCloudClipboard",
        payload: [0; 4],
    },
];

/// One exclusive session on a format-based clipboard: while it exists no
/// other program can read or change the content. Windows provides it; the
/// test fake models it.
#[cfg(any(target_os = "windows", test))]
trait ClipboardSession {
    /// Remove every format.
    fn empty(&mut self) -> Result<(), SecureClipError>;
    /// Add one exclusion format.
    fn exclude(&mut self, format: &ExclusionFormat) -> Result<(), SecureClipError>;
    /// Add NUL-terminated UTF-16 text.
    fn set_text(&mut self, utf16_with_nul: &[u16]) -> Result<(), SecureClipError>;
    /// What the clipboard holds as text.
    fn snapshot(&mut self) -> ClipboardSnapshot;
    fn matches_text(&mut self, expected: &str) -> bool {
        self.snapshot_bounded(expected.len()).holds(expected)
    }
    fn snapshot_bounded(&mut self, _max_bytes: usize) -> ClipboardSnapshot {
        self.snapshot()
    }
}

/// Replace the clipboard content with a secret.
///
/// The exclusion formats go first and the text last, and any failure empties
/// the clipboard again, so the text is never there without them.
#[cfg(any(target_os = "windows", test))]
fn place_secret(
    session: &mut dyn ClipboardSession,
    utf16_with_nul: &[u16],
) -> Result<(), SecureClipError> {
    session.empty()?;
    let placed = EXCLUSION_FORMATS
        .iter()
        .try_for_each(|format| session.exclude(format))
        .and_then(|()| session.set_text(utf16_with_nul));
    if placed.is_err() {
        let _ = session.empty();
    }
    placed
}

#[cfg(any(target_os = "windows", test))]
fn clear_session_bounded_if(
    session: &mut dyn ClipboardSession,
    max_bytes: usize,
    is_owned: &dyn Fn(&ClipboardSnapshot) -> bool,
) -> Result<ClearOutcome, SecureClipError> {
    if !is_owned(&session.snapshot_bounded(max_bytes)) {
        return Ok(ClearOutcome::NotOwned);
    }
    session.empty()?;
    Ok(ClearOutcome::Cleared)
}

#[cfg(any(target_os = "windows", test))]
fn text_units_match(expected: &str, units: &[u16]) -> bool {
    let mut encoded = expected.encode_utf16().chain(std::iter::once(0));
    for unit in units {
        match encoded.next() {
            Some(value) if value == *unit => {
                if value == 0 {
                    return true;
                }
            }
            _ => return false,
        }
    }
    false
}

#[cfg(any(target_os = "windows", test))]
fn clear_session_matching(
    session: &mut dyn ClipboardSession,
    expected: &str,
) -> Result<ClearOutcome, SecureClipError> {
    if !session.matches_text(expected) {
        return Ok(ClearOutcome::NotOwned);
    }
    session.empty()?;
    Ok(ClearOutcome::Cleared)
}

/// NUL-terminated UTF-16 for the clipboard, refused before the clipboard is
/// touched when it would exceed the secure size limit.
#[cfg(any(target_os = "windows", test))]
fn encode_clipboard_utf16(text: &str) -> Result<Zeroizing<Vec<u16>>, SecureClipError> {
    if text.len() > MAX_CLIPBOARD_BYTES {
        return Err(SecureClipError::TooLarge);
    }
    // UTF-16 never needs more units than UTF-8 needs bytes, so this capacity
    // is final: the buffer is not reallocated and leaves no unwiped copy.
    let mut encoded = Zeroizing::new(Vec::with_capacity(text.len() + 1));
    encoded.extend(text.encode_utf16());
    encoded.push(0);
    if encoded.len() * std::mem::size_of::<u16>() > MAX_CLIPBOARD_UTF16_BYTES {
        return Err(SecureClipError::TooLarge);
    }
    Ok(encoded)
}

/// Text found in a clipboard's UTF-16 memory. Whatever this engine could not
/// have written (no terminator, unpaired surrogates, more than the secure
/// size limit) is foreign.
#[cfg(any(target_os = "windows", test))]
fn decode_clipboard_utf16(units: &[u16]) -> ClipboardSnapshot {
    let Some(terminator) = units.iter().position(|unit| *unit == 0) else {
        return ClipboardSnapshot::Foreign;
    };
    // One UTF-16 unit is at most three UTF-8 bytes: no reallocation either.
    let mut text = Zeroizing::new(String::with_capacity(terminator * 3));
    for character in char::decode_utf16(units[..terminator].iter().copied()) {
        match character {
            Ok(character) => text.push(character),
            Err(_) => return ClipboardSnapshot::Foreign,
        }
    }
    if text.len() > MAX_CLIPBOARD_BYTES {
        return ClipboardSnapshot::Foreign;
    }
    ClipboardSnapshot::Text(text)
}

// ─── Windows ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
const CF_UNICODETEXT: u32 = 13;

#[cfg(target_os = "windows")]
fn write_clipboard_windows(text: &str) -> Result<(), SecureClipError> {
    let encoded = encode_clipboard_utf16(text)?;
    place_secret(&mut open_clipboard_windows()?, &encoded)
}

/// Hand a copy of `data` to the open clipboard under `format`.
///
/// The block may hold the secret, so when the clipboard does not take it over
/// it is wiped before it is released.
#[cfg(target_os = "windows")]
fn set_clipboard_data<T: Copy>(format: u32, data: &[T]) -> Result<(), SecureClipError> {
    use std::ptr::copy_nonoverlapping;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::SetClipboardData;
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use zeroize::Zeroize;

    let byte_len = std::mem::size_of_val(data);

    // SAFETY: the caller holds the clipboard open on this thread, all Win32
    // return values are checked, the movable allocation is only written while
    // locked and within `byte_len`, and it is transferred to the OS only
    // after it has been completely initialized.
    unsafe {
        let allocation = GlobalAlloc(GMEM_MOVEABLE, byte_len);
        if allocation.is_null() {
            return Err(SecureClipError::Unavailable);
        }

        let destination = GlobalLock(allocation).cast::<u8>();
        if destination.is_null() {
            let _ = GlobalFree(allocation);
            return Err(SecureClipError::Unavailable);
        }
        copy_nonoverlapping(data.as_ptr().cast::<u8>(), destination, byte_len);
        let _ = GlobalUnlock(allocation);

        if SetClipboardData(format, allocation).is_null() {
            let rejected = GlobalLock(allocation).cast::<u8>();
            if !rejected.is_null() {
                std::slice::from_raw_parts_mut(rejected, byte_len).zeroize();
                let _ = GlobalUnlock(allocation);
            }
            let _ = GlobalFree(allocation);
            return Err(SecureClipError::Unavailable);
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
struct WindowsClipboardGuard {
    // Drop after CloseClipboard; the message-only window is thread-local and
    // never shown, activated or associated with a CEF field's focus.
    _owner: WindowsClipboardOwner,
}

#[cfg(target_os = "windows")]
struct WindowsClipboardOwner(windows_sys::Win32::Foundation::HWND);

#[cfg(target_os = "windows")]
impl WindowsClipboardOwner {
    fn new() -> Result<Self, SecureClipError> {
        use std::ptr::null_mut;
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, HWND_MESSAGE};
        // SAFETY: STATIC is a system window class. This invisible, message-only
        // window is created and destroyed on this synchronous calling thread.
        let window = unsafe {
            CreateWindowExW(
                0,
                windows_sys::core::w!("STATIC"),
                std::ptr::null(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                null_mut(),
                null_mut(),
                std::ptr::null(),
            )
        };
        if window.is_null() {
            Err(SecureClipError::Unavailable)
        } else {
            Ok(Self(window))
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsClipboardOwner {
    fn drop(&mut self) {
        // SAFETY: this object exclusively owns the same-thread hidden window.
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(self.0);
        }
    }
}

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
impl ClipboardSession for WindowsClipboardGuard {
    fn empty(&mut self) -> Result<(), SecureClipError> {
        // SAFETY: the clipboard is open on this thread for as long as this
        // guard exists.
        if unsafe { windows_sys::Win32::System::DataExchange::EmptyClipboard() } == 0 {
            return Err(SecureClipError::Unavailable);
        }
        Ok(())
    }

    fn exclude(&mut self, format: &ExclusionFormat) -> Result<(), SecureClipError> {
        let name: Vec<u16> = format.name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: `name` is NUL-terminated UTF-16 that outlives the call.
        let registered = unsafe {
            windows_sys::Win32::System::DataExchange::RegisterClipboardFormatW(name.as_ptr())
        };
        if registered == 0 {
            return Err(SecureClipError::Unavailable);
        }
        set_clipboard_data(registered, &format.payload)
    }

    fn set_text(&mut self, utf16_with_nul: &[u16]) -> Result<(), SecureClipError> {
        set_clipboard_data(CF_UNICODETEXT, utf16_with_nul)
    }

    /// Inside an open session nothing here is an error. Text that is
    /// advertised but cannot be retrieved, measured or locked (another
    /// program's delayed rendering, an empty block) is not something this
    /// engine wrote, and treating it as a failure would retry it forever.
    fn snapshot(&mut self) -> ClipboardSnapshot {
        self.snapshot_bounded(MAX_CLIPBOARD_BYTES)
    }

    fn matches_text(&mut self, expected: &str) -> bool {
        use windows_sys::Win32::System::DataExchange::{
            GetClipboardData, IsClipboardFormatAvailable,
        };
        use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        // SAFETY: the open session excludes concurrent clipboard writes. The
        // OS allocation is borrowed only while locked and never retained.
        unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
                return false;
            }
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle.is_null() {
                return false;
            }
            let bytes = GlobalSize(handle).min((expected.len() + 1) * 2);
            if bytes < 2 {
                return false;
            }
            let source = GlobalLock(handle).cast::<u16>();
            if source.is_null() {
                return false;
            }
            let matches = text_units_match(expected, std::slice::from_raw_parts(source, bytes / 2));
            GlobalUnlock(handle);
            matches
        }
    }

    fn snapshot_bounded(&mut self, max_bytes: usize) -> ClipboardSnapshot {
        use std::mem::size_of;
        use std::slice;
        use windows_sys::Win32::System::DataExchange::{
            GetClipboardData, IsClipboardFormatAvailable,
        };
        use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

        // SAFETY: the clipboard remains open while the system-owned global
        // memory is locked and copied into a process-owned, zeroizing buffer
        // of at most the size the system reports for that memory.
        let units = unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
                return ClipboardSnapshot::Foreign;
            }
            let handle = GetClipboardData(CF_UNICODETEXT);
            if handle.is_null() {
                return ClipboardSnapshot::Foreign;
            }
            // The system may round a block up, so the limit caps what is read
            // rather than rejecting the block: this engine's own text always
            // ends inside it, and longer text has no terminator there.
            let byte_len = GlobalSize(handle).min(
                (max_bytes.saturating_add(1))
                    .saturating_mul(2)
                    .min(MAX_CLIPBOARD_UTF16_BYTES),
            );
            if byte_len < size_of::<u16>() {
                return ClipboardSnapshot::Foreign;
            }
            let source = GlobalLock(handle).cast::<u16>();
            if source.is_null() {
                return ClipboardSnapshot::Foreign;
            }
            let copy =
                Zeroizing::new(slice::from_raw_parts(source, byte_len / size_of::<u16>()).to_vec());
            let _ = GlobalUnlock(handle);
            copy
        };

        decode_clipboard_utf16(&units)
    }
}

#[cfg(target_os = "windows")]
fn open_clipboard_windows() -> Result<WindowsClipboardGuard, SecureClipError> {
    use std::thread;
    use std::time::Duration;
    use windows_sys::Win32::System::DataExchange::OpenClipboard;

    let owner = WindowsClipboardOwner::new()?;
    for _ in 0..10 {
        // SAFETY: the owner remains alive until after CloseClipboard. A null
        // owner works for reads, but EmptyClipboard + SetClipboardData fails:
        // https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-openclipboard
        if unsafe { OpenClipboard(owner.0) } != 0 {
            return Ok(WindowsClipboardGuard { _owner: owner });
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err(SecureClipError::Busy)
}

// ─── macOS and Linux ────────────────────────────────────────────────

#[cfg(target_os = "macos")]
const WRITE_HELPERS: &[ClipboardHelperSpec] = &[ClipboardHelperSpec::new("/usr/bin/pbcopy", &[])];

#[cfg(target_os = "macos")]
const READ_HELPERS: &[ClipboardHelperSpec] = &[ClipboardHelperSpec::new("/usr/bin/pbpaste", &[])];

#[cfg(target_os = "linux")]
const WRITE_HELPERS: &[ClipboardHelperSpec] = &[
    ClipboardHelperSpec::new("/usr/bin/wl-copy", &[]),
    ClipboardHelperSpec::new("/usr/bin/xclip", &["-selection", "clipboard"]),
    ClipboardHelperSpec::new("/usr/bin/xsel", &["--clipboard", "--input"]),
];

#[cfg(target_os = "linux")]
const READ_HELPERS: &[ClipboardHelperSpec] = &[
    ClipboardHelperSpec::new("/usr/bin/wl-paste", &["--no-newline"]),
    ClipboardHelperSpec::new("/usr/bin/xclip", &["-selection", "clipboard", "-o"]),
    ClipboardHelperSpec::new("/usr/bin/xsel", &["--clipboard", "--output"]),
];

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn trusted_commands(
    helpers: &'static [ClipboardHelperSpec],
) -> impl Iterator<Item = std::process::Command> {
    helpers
        .iter()
        .filter_map(|helper| trusted_helper_command(*helper))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn write_clipboard_with_trusted_helpers(text: &str) -> Result<(), SecureClipError> {
    write_with_helpers(trusted_commands(WRITE_HELPERS), text, HELPER_TIMEOUT)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn snapshot_clipboard_with_trusted_helpers() -> Result<ClipboardSnapshot, SecureClipError> {
    read_with_helpers(trusted_commands(READ_HELPERS), HELPER_TIMEOUT)
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

/// Why one helper process did not do its job.
#[cfg(any(unix, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelperFailure {
    /// It ran to completion and reported failure. This is how a read helper
    /// says that the clipboard holds nothing it can give as text.
    Refused,
    /// It did not finish in time, or every helper slot is taken.
    Busy,
    /// It could not be started, supervised or talked to.
    Broken,
}

/// Why no helper succeeded.
#[cfg(any(unix, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelpersFailed {
    /// No trusted helper exists on this system.
    NoneTrusted,
    /// Every trusted helper ran to completion and reported failure.
    AllRefused,
    /// At least one helper could not be run to completion, so nothing is
    /// known about the clipboard.
    Incomplete(SecureClipError),
}

#[cfg(any(unix, test))]
impl HelpersFailed {
    fn after(self, failure: HelperFailure) -> Self {
        match (self, failure) {
            (Self::Incomplete(SecureClipError::Busy), _) | (_, HelperFailure::Busy) => {
                Self::Incomplete(SecureClipError::Busy)
            }
            (Self::Incomplete(_), _) | (_, HelperFailure::Broken) => {
                Self::Incomplete(SecureClipError::Unavailable)
            }
            (Self::NoneTrusted | Self::AllRefused, HelperFailure::Refused) => Self::AllRefused,
        }
    }

    fn into_error(self) -> SecureClipError {
        match self {
            Self::Incomplete(error) => error,
            Self::NoneTrusted | Self::AllRefused => SecureClipError::Unavailable,
        }
    }
}

/// Run helpers in order until one succeeds. Later helpers are not started.
#[cfg(any(unix, test))]
fn try_helpers<T>(
    attempts: impl IntoIterator<Item = Result<T, HelperFailure>>,
) -> Result<T, HelpersFailed> {
    let mut failed = HelpersFailed::NoneTrusted;
    for attempt in attempts {
        match attempt {
            Ok(done) => return Ok(done),
            Err(failure) => failed = failed.after(failure),
        }
    }
    Err(failed)
}

#[cfg(any(unix, test))]
fn write_with_helpers(
    commands: impl IntoIterator<Item = std::process::Command>,
    text: &str,
    timeout: std::time::Duration,
) -> Result<(), SecureClipError> {
    try_helpers(
        commands
            .into_iter()
            .map(|command| run_helper_write(command, text, timeout)),
    )
    .map_err(HelpersFailed::into_error)
}

#[cfg(any(unix, test))]
fn read_with_helpers(
    commands: impl IntoIterator<Item = std::process::Command>,
    timeout: std::time::Duration,
) -> Result<ClipboardSnapshot, SecureClipError> {
    read_with_helpers_bounded(commands, timeout, MAX_CLIPBOARD_BYTES)
}

#[cfg(any(unix, test))]
fn read_with_helpers_bounded(
    commands: impl IntoIterator<Item = std::process::Command>,
    timeout: std::time::Duration,
    max_bytes: usize,
) -> Result<ClipboardSnapshot, SecureClipError> {
    match try_helpers(
        commands
            .into_iter()
            .map(|command| run_helper_read_bounded(command, timeout, max_bytes)),
    ) {
        Ok(snapshot) => Ok(snapshot),
        // Every helper answered and none had text to give: an image, files or
        // an empty clipboard. That is content this engine did not write, not
        // a failure to retry.
        Err(HelpersFailed::AllRefused) => Ok(ClipboardSnapshot::Foreign),
        Err(failed) => Err(failed.into_error()),
    }
}

/// Text printed by a read helper. Output this engine could not have written
/// (more than the secure size limit, or not UTF-8) is foreign.
#[cfg(any(unix, test))]
fn decode_helper_text(mut output: Zeroizing<Vec<u8>>) -> ClipboardSnapshot {
    if output.len() > MAX_CLIPBOARD_BYTES {
        return ClipboardSnapshot::Foreign;
    }
    // The buffer moves into the string, so no second copy is made.
    match String::from_utf8(std::mem::take(&mut *output)) {
        Ok(text) => ClipboardSnapshot::Text(Zeroizing::new(text)),
        Err(invalid) => {
            drop(Zeroizing::new(invalid.into_bytes()));
            ClipboardSnapshot::Foreign
        }
    }
}

#[cfg(any(unix, test))]
const MAX_HELPER_OPERATIONS: usize = 16;

#[cfg(any(unix, test))]
static ACTIVE_HELPER_OPERATIONS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(any(unix, test))]
static HELPER_REAPER: std::sync::OnceLock<Result<HelperReaper, HelperFailure>> =
    std::sync::OnceLock::new();

#[cfg(any(unix, test))]
struct HelperPermit;

#[cfg(any(unix, test))]
impl HelperPermit {
    fn acquire() -> Result<Self, HelperFailure> {
        use std::sync::atomic::Ordering;

        let mut current = ACTIVE_HELPER_OPERATIONS.load(Ordering::Acquire);
        loop {
            if current >= MAX_HELPER_OPERATIONS {
                return Err(HelperFailure::Busy);
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
            if let Ok(Some(_)) = child.try_wait() {
                self.child = None;
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
    fn start() -> Result<Self, HelperFailure> {
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
            .map_err(|_| HelperFailure::Broken)?;
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
fn helper_reaper() -> Result<&'static HelperReaper, HelperFailure> {
    HELPER_REAPER
        .get_or_init(HelperReaper::start)
        .as_ref()
        .map_err(|failure| *failure)
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
    fn spawn(mut command: std::process::Command) -> Result<Self, HelperFailure> {
        let reaper = helper_reaper()?;
        let permit = HelperPermit::acquire()?;
        prepare_helper_process_group(&mut command);
        let child = command.spawn().map_err(|_| HelperFailure::Broken)?;
        Ok(Self {
            reaper,
            child: Some(child),
            worker: None,
            permit: Some(permit),
            completion: None,
        })
    }

    fn take_stdin(&mut self) -> Result<std::process::ChildStdin, HelperFailure> {
        match self.child.as_mut().and_then(|child| child.stdin.take()) {
            Some(stdin) => Ok(stdin),
            None => {
                let _ = self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
                Err(HelperFailure::Broken)
            }
        }
    }

    fn take_stdout(&mut self) -> Result<std::process::ChildStdout, HelperFailure> {
        match self.child.as_mut().and_then(|child| child.stdout.take()) {
            Some(stdout) => Ok(stdout),
            None => {
                let _ = self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
                Err(HelperFailure::Broken)
            }
        }
    }

    fn set_worker(&mut self, worker: std::thread::JoinHandle<()>) {
        self.worker = Some(worker);
    }

    fn wait_bounded(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<std::process::ExitStatus, HelperFailure> {
        use std::time::Instant;

        let deadline = Instant::now() + timeout;
        loop {
            let status = self.child.as_mut().ok_or(HelperFailure::Broken)?.try_wait();
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
                    return Err(HelperFailure::Busy);
                }
                Err(_) => {
                    self.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT)?;
                    return Err(HelperFailure::Broken);
                }
            }
        }
    }

    fn terminate_and_reap_bounded(
        &mut self,
        timeout: std::time::Duration,
    ) -> Result<(), HelperFailure> {
        use std::time::Instant;

        let Some(child) = self.child.as_mut() else {
            return Ok(());
        };
        terminate_helper_process_group(child.id());
        let _ = child.kill();
        if timeout.is_zero() {
            return Err(HelperFailure::Busy);
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
                    return Err(HelperFailure::Busy);
                }
            }
        }
    }

    fn join_worker_bounded(&mut self, timeout: std::time::Duration) -> Result<(), HelperFailure> {
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
            return Err(HelperFailure::Busy);
        }
        self.worker
            .take()
            .expect("finished helper worker remains owned")
            .join()
            .map_err(|_| HelperFailure::Broken)
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
) -> Result<(), HelperFailure> {
    use std::io::Write;
    use std::path::Path;
    use std::process::Stdio;
    use std::sync::mpsc;

    if !Path::new(command.get_program()).is_absolute() || text.len() > MAX_CLIPBOARD_BYTES {
        return Err(HelperFailure::Broken);
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
            return Err(HelperFailure::Broken);
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
    let wrote_all = wrote_all.map_err(|_| HelperFailure::Busy)?;
    if !wrote_all || !status.success() {
        return Err(HelperFailure::Refused);
    }
    Ok(())
}

#[cfg(any(unix, test))]
fn run_helper_read_bounded(
    mut command: std::process::Command,
    timeout: std::time::Duration,
    max_bytes: usize,
) -> Result<ClipboardSnapshot, HelperFailure> {
    use std::io::Read;
    use std::path::Path;
    use std::process::Stdio;
    use std::sync::mpsc;

    if !Path::new(command.get_program()).is_absolute() {
        return Err(HelperFailure::Broken);
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
            // Fixed allocation avoids abandoned plaintext during buffer growth.
            let mut output = Zeroizing::new(Vec::with_capacity(max_bytes + 1));
            let result = stdout
                .take((max_bytes + 1) as u64)
                .read_to_end(&mut output)
                .map(|_| output)
                .map_err(|_| ());
            let _ = reader_tx.send(result);
        }) {
        Ok(reader) => reader,
        Err(_) => {
            let _ = operation.terminate_and_reap_bounded(HELPER_IO_DRAIN_TIMEOUT);
            return Err(HelperFailure::Broken);
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
        .map_err(|_| HelperFailure::Busy)?
        .map_err(|()| HelperFailure::Broken)?;
    if !status.success() {
        return Err(HelperFailure::Refused);
    }
    if output.len() > max_bytes {
        return Ok(ClipboardSnapshot::Foreign);
    }
    Ok(decode_helper_text(output))
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

/// An in-memory clipboard for tests.
///
/// It models a format-based clipboard with exclusive sessions and is driven
/// through the same session code as the Windows backend, so that no test ever
/// reaches the operating-system clipboard.
#[cfg(test)]
pub(crate) mod fake {
    use super::{
        decode_clipboard_utf16, encode_clipboard_utf16, place_secret, ClearOutcome, ClipEngine,
        ClipboardBackend, ClipboardSession, ClipboardSnapshot, ExclusionFormat,
    };
    use crate::types::SecureClipError;
    use std::sync::{Arc, Mutex, MutexGuard};

    /// One change the engine made through a session.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum Change {
        Emptied,
        Excluded(&'static str),
        Text,
    }

    #[derive(Default)]
    struct State {
        /// Text memory (UTF-16) when a text format is present.
        text: Option<Vec<u16>>,
        /// Names of the exclusion formats present.
        exclusions: Vec<&'static str>,
        /// A format other than text is present: an image, files.
        image: bool,
        /// Another program holds the clipboard, so it cannot be opened.
        held: bool,
        reject_exclusions: bool,
        reject_text: bool,
        reject_empty: bool,
        /// Sessions the engine opened.
        sessions: usize,
        /// Everything the engine changed, in order.
        changes: Vec<Change>,
        /// A copy by another program that is waiting for the session to end.
        waiting_copy: Option<String>,
    }

    impl State {
        fn replace_with_text(&mut self, text: &str) {
            self.replace_with_utf16(text.encode_utf16().chain(Some(0)).collect());
        }

        fn replace_with_utf16(&mut self, units: Vec<u16>) {
            self.text = Some(units);
            self.exclusions.clear();
            self.image = false;
        }
    }

    #[derive(Clone, Default)]
    pub(crate) struct FakeClipboard {
        state: Arc<Mutex<State>>,
    }

    /// Exclusive access, as an open clipboard gives it.
    struct Session<'a>(MutexGuard<'a, State>);

    impl ClipboardSession for Session<'_> {
        fn empty(&mut self) -> Result<(), SecureClipError> {
            if self.0.reject_empty {
                return Err(SecureClipError::Unavailable);
            }
            self.0.text = None;
            self.0.exclusions.clear();
            self.0.image = false;
            self.0.changes.push(Change::Emptied);
            Ok(())
        }

        fn exclude(&mut self, format: &ExclusionFormat) -> Result<(), SecureClipError> {
            if self.0.reject_exclusions {
                return Err(SecureClipError::Unavailable);
            }
            self.0.exclusions.push(format.name);
            self.0.changes.push(Change::Excluded(format.name));
            Ok(())
        }

        fn set_text(&mut self, utf16_with_nul: &[u16]) -> Result<(), SecureClipError> {
            if self.0.reject_text {
                return Err(SecureClipError::Unavailable);
            }
            self.0.text = Some(utf16_with_nul.to_vec());
            self.0.changes.push(Change::Text);
            Ok(())
        }

        fn matches_text(&mut self, expected: &str) -> bool {
            self.0
                .text
                .as_deref()
                .is_some_and(|units| super::text_units_match(expected, units))
        }

        fn snapshot(&mut self) -> ClipboardSnapshot {
            self.0
                .text
                .as_deref()
                .map_or(ClipboardSnapshot::Foreign, decode_clipboard_utf16)
        }
    }

    impl Drop for Session<'_> {
        fn drop(&mut self) {
            // A program that tried to copy during the session was kept out by
            // it; its copy lands the moment the session ends.
            if let Some(text) = self.0.waiting_copy.take() {
                self.0.replace_with_text(&text);
            }
        }
    }

    impl FakeClipboard {
        fn state(&self) -> MutexGuard<'_, State> {
            self.state.lock().expect("fake clipboard lock")
        }

        fn open(&self) -> Result<Session<'_>, SecureClipError> {
            let mut state = self.state();
            if state.held {
                return Err(SecureClipError::Busy);
            }
            state.sessions += 1;
            Ok(Session(state))
        }

        /// An engine whose clipboard is this fake.
        pub(crate) fn engine(&self) -> ClipEngine {
            ClipEngine::with_backend(Box::new(self.clone()))
        }

        // ── What the user or another program does ──

        pub(crate) fn user_copies_text(&self, text: &str) {
            self.state().replace_with_text(text);
        }

        /// Text memory exactly as given: unterminated, malformed, oversized.
        pub(crate) fn user_copies_utf16(&self, units: Vec<u16>) {
            self.state().replace_with_utf16(units);
        }

        pub(crate) fn user_copies_an_image(&self) {
            let mut state = self.state();
            state.text = None;
            state.exclusions.clear();
            state.image = true;
        }

        /// The copy arrives while the engine holds its next session.
        pub(crate) fn user_copies_text_during_the_next_session(&self, text: &str) {
            self.state().waiting_copy = Some(text.to_string());
        }

        pub(crate) fn hold_by_another_program(&self, held: bool) {
            self.state().held = held;
        }

        pub(crate) fn reject_exclusions(&self, reject: bool) {
            self.state().reject_exclusions = reject;
        }

        pub(crate) fn reject_text(&self, reject: bool) {
            self.state().reject_text = reject;
        }

        pub(crate) fn reject_empty(&self, reject: bool) {
            self.state().reject_empty = reject;
        }

        // ── What a test may observe ──

        pub(crate) fn text(&self) -> Option<String> {
            match self.state().text.as_deref().map(decode_clipboard_utf16) {
                Some(ClipboardSnapshot::Text(text)) => Some(text.as_str().to_owned()),
                Some(ClipboardSnapshot::Foreign) | None => None,
            }
        }

        pub(crate) fn utf16(&self) -> Option<Vec<u16>> {
            self.state().text.clone()
        }

        pub(crate) fn holds_an_image(&self) -> bool {
            self.state().image
        }

        pub(crate) fn exclusions(&self) -> Vec<&'static str> {
            self.state().exclusions.clone()
        }

        pub(crate) fn is_empty(&self) -> bool {
            let state = self.state();
            state.text.is_none() && state.exclusions.is_empty() && !state.image
        }

        pub(crate) fn sessions(&self) -> usize {
            self.state().sessions
        }

        pub(crate) fn changes(&self) -> Vec<Change> {
            self.state().changes.clone()
        }
    }

    impl ClipboardBackend for FakeClipboard {
        fn write_secret(&self, text: &str) -> Result<(), SecureClipError> {
            let encoded = encode_clipboard_utf16(text)?;
            place_secret(&mut self.open()?, &encoded)
        }

        fn clear_matching(&self, expected: &str) -> Result<ClearOutcome, SecureClipError> {
            super::clear_session_matching(&mut self.open()?, expected)
        }

        fn clear_if(
            &self,
            max_bytes: usize,
            is_owned: &dyn Fn(&ClipboardSnapshot) -> bool,
        ) -> Result<ClearOutcome, SecureClipError> {
            super::clear_session_bounded_if(&mut self.open()?, max_bytes, is_owned)
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn clipboard_owner_is_a_valid_invisible_same_thread_window() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, IsWindowVisible};
        let owner = super::WindowsClipboardOwner::new().expect("hidden clipboard owner");
        let handle = owner.0;
        // No clipboard access or mutation: safe even with the user's own text,
        // images or files already on their clipboard.
        unsafe {
            assert_eq!(IsWindow(handle), 1);
            assert_eq!(IsWindowVisible(handle), 0);
        }
        drop(owner);
        unsafe {
            assert_eq!(IsWindow(handle), 0);
        }
    }

    use super::fake::{Change, FakeClipboard};
    use super::*;
    use std::io::{Read, Write};
    use std::process::Command;
    use std::sync::{Arc, Barrier, Mutex};
    use std::time::{Duration, Instant};

    const HELPER_MODE: &str = "SORNG_SECURE_CLIP_TEST_HELPER_MODE";

    /// Every path that clears; `Replaced` is a new copy, not a clear.
    const EVERY_CLEAR_REASON: [ClearReason; 5] = [
        ClearReason::AutoClear,
        ClearReason::MaxPastes,
        ClearReason::ManualClear,
        ClearReason::AppLocked,
        ClearReason::AppExit,
    ];

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

    fn request_with(value: &str, clear_after_secs: Option<u64>) -> CopyRequest {
        let mut request = secret_request(false);
        request.value = value.to_string();
        request.clear_after_secs = clear_after_secs;
        request
    }

    /// An engine that has just copied `fake-secret` to `clipboard`.
    fn engine_with_secret(clipboard: &FakeClipboard) -> ClipEngine {
        let mut engine = clipboard.engine();
        engine
            .copy(&secret_request(false), &SecureClipConfig::default())
            .expect("copy");
        engine
    }

    fn refusal(
        engine: &mut ClipEngine,
        request: &CopyRequest,
        config: &SecureClipConfig,
    ) -> Option<SecureClipError> {
        engine.copy(request, config).err()
    }

    fn run_helper_read_test(
        command: Command,
        timeout: Duration,
    ) -> Result<ClipboardSnapshot, HelperFailure> {
        run_helper_read_bounded(command, timeout, MIN_CLIPBOARD_BYTES)
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
                let output = vec![b'x'; MIN_CLIPBOARD_BYTES + 1];
                let _ = std::io::stdout().write_all(&output);
                let _ = std::io::stdout().flush();
                std::process::exit(0);
            }
            "refuse" => std::process::exit(1),
            "hang" => std::thread::sleep(Duration::from_secs(5)),
            _ => std::process::exit(3),
        }
    }

    // ─── Helper processes ───────────────────────────────────────

    #[test]
    fn helper_write_uses_stdin_and_absolute_executable() {
        run_helper_write(
            helper_command("write"),
            "fake-secret",
            Duration::from_secs(1),
        )
        .expect("fake helper should accept stdin");

        let relative = Command::new("untrusted-relative-helper");
        assert_eq!(
            run_helper_write(relative, "fake-secret", Duration::from_millis(10)),
            Err(HelperFailure::Broken)
        );
    }

    #[test]
    fn helper_read_is_capped() {
        // The test harness prints a preamble before the fixture's own output.
        let read = run_helper_read_test(helper_command("read"), Duration::from_secs(1))
            .expect("fake helper should return bounded text");
        assert!(matches!(&read, ClipboardSnapshot::Text(text) if text.contains("fake-clipboard")));

        // More than this engine ever writes is somebody else's content, not a
        // failure to retry.
        assert!(matches!(
            run_helper_read_bounded(
                helper_command("overflow"),
                Duration::from_secs(1),
                MIN_CLIPBOARD_BYTES
            ),
            Ok(ClipboardSnapshot::Foreign)
        ));
    }

    #[test]
    fn timed_out_helper_is_killed_and_reaped() {
        let started = Instant::now();
        assert!(run_helper_read_test(helper_command("hang"), Duration::from_millis(50)).is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn a_helper_that_reports_failure_is_told_apart_from_one_that_hangs() {
        assert_eq!(
            run_helper_read_test(helper_command("refuse"), Duration::from_secs(1)).err(),
            Some(HelperFailure::Refused)
        );
        assert_eq!(
            run_helper_read_test(helper_command("hang"), Duration::from_millis(50)).err(),
            Some(HelperFailure::Busy)
        );
        assert_eq!(
            run_helper_write(
                helper_command("refuse"),
                "fake-secret",
                Duration::from_secs(1)
            ),
            Err(HelperFailure::Refused)
        );
    }

    #[test]
    fn helper_failures_combine_into_one_answer() {
        use HelperFailure::{Broken, Busy, Refused};
        let combine = |failures: &[HelperFailure]| {
            try_helpers(failures.iter().map(|failure| Err::<(), _>(*failure)))
                .expect_err("no helper succeeded")
        };

        assert_eq!(combine(&[]), HelpersFailed::NoneTrusted);
        assert_eq!(combine(&[Refused, Refused]), HelpersFailed::AllRefused);
        for incomplete in [&[Refused, Broken][..], &[Broken, Refused][..]] {
            assert_eq!(
                combine(incomplete),
                HelpersFailed::Incomplete(SecureClipError::Unavailable)
            );
        }
        for busy in [&[Busy, Refused][..], &[Broken, Busy, Refused][..]] {
            assert_eq!(
                combine(busy),
                HelpersFailed::Incomplete(SecureClipError::Busy)
            );
        }
    }

    #[test]
    fn a_clipboard_no_helper_can_read_as_text_is_foreign_not_an_error() {
        let refused = read_with_helpers(
            [helper_command("refuse"), helper_command("refuse")],
            Duration::from_secs(1),
        );
        assert!(matches!(refused, Ok(ClipboardSnapshot::Foreign)));

        // A helper that could not be run to completion says nothing about the
        // clipboard, so that case stays an error and is retried.
        let hung = read_with_helpers(
            [helper_command("refuse"), helper_command("hang")],
            Duration::from_millis(50),
        );
        assert!(matches!(hung, Err(SecureClipError::Busy)));

        let none = read_with_helpers(Vec::new(), Duration::from_secs(1));
        assert!(matches!(none, Err(SecureClipError::Unavailable)));
    }

    #[test]
    fn the_first_helper_that_succeeds_wins_and_later_ones_are_not_started() {
        let started = std::cell::Cell::new(0);
        let commands = ["refuse", "read", "hang"].into_iter().map(|mode| {
            started.set(started.get() + 1);
            helper_command(mode)
        });

        let read = read_with_helpers(commands, Duration::from_secs(1)).expect("second helper");
        assert!(matches!(&read, ClipboardSnapshot::Text(text) if text.contains("fake-clipboard")));
        assert_eq!(started.get(), 2);
    }

    #[test]
    fn helper_writes_report_fixed_codes() {
        let second = Duration::from_secs(1);
        assert_eq!(
            write_with_helpers(Vec::new(), "fake-secret", second),
            Err(SecureClipError::Unavailable)
        );
        assert_eq!(
            write_with_helpers([helper_command("refuse")], "fake-secret", second),
            Err(SecureClipError::Unavailable)
        );
        assert_eq!(
            write_with_helpers(
                [helper_command("hang")],
                "fake-secret",
                Duration::from_millis(50)
            ),
            Err(SecureClipError::Busy)
        );
        assert_eq!(
            write_with_helpers(
                [helper_command("refuse"), helper_command("write")],
                "fake-secret",
                second
            ),
            Ok(())
        );
    }

    #[test]
    fn helper_output_that_is_not_bounded_utf8_is_foreign() {
        let text = decode_helper_text(Zeroizing::new(b"fake-secret".to_vec()));
        assert!(text.holds("fake-secret"));

        for foreign in [vec![0xff, 0xfe], vec![b'x'; MAX_CLIPBOARD_BYTES + 1]] {
            assert!(matches!(
                decode_helper_text(Zeroizing::new(foreign)),
                ClipboardSnapshot::Foreign
            ));
        }
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

    // ─── Copy ───────────────────────────────────────────────────

    #[test]
    fn one_time_policy_is_enforced_before_clipboard_write() {
        let clipboard = FakeClipboard::default();
        clipboard.user_copies_text("user-content");
        let mut engine = clipboard.engine();
        let config = SecureClipConfig {
            one_time_paste_available: false,
            ..SecureClipConfig::default()
        };

        assert_eq!(
            refusal(&mut engine, &secret_request(true), &config),
            Some(SecureClipError::Unavailable)
        );
        assert_eq!(clipboard.text().as_deref(), Some("user-content"));
        assert_eq!(clipboard.sessions(), 0);
    }

    #[test]
    fn a_secret_is_placed_with_its_history_exclusions_before_the_text() {
        let clipboard = FakeClipboard::default();
        clipboard.user_copies_an_image();
        let _engine = engine_with_secret(&clipboard);

        // The names are the contract with Windows; a typo would silently let
        // secrets into clipboard history and cloud sync.
        let exclusions = [
            "ExcludeClipboardContentFromMonitorProcessing",
            "CanIncludeInClipboardHistory",
            "CanUploadToCloudClipboard",
        ];
        assert_eq!(
            clipboard.changes(),
            [
                Change::Emptied,
                Change::Excluded(exclusions[0]),
                Change::Excluded(exclusions[1]),
                Change::Excluded(exclusions[2]),
                Change::Text,
            ]
        );
        assert_eq!(clipboard.exclusions(), exclusions);
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));
        assert!(!clipboard.holds_an_image());
        for format in &EXCLUSION_FORMATS {
            assert_eq!(format.payload, 0u32.to_le_bytes(), "{}", format.name);
        }
    }

    #[test]
    fn a_failed_exclusion_never_leaves_the_text_behind() {
        let clipboard = FakeClipboard::default();
        clipboard.reject_exclusions(true);
        let mut engine = clipboard.engine();

        assert_eq!(
            refusal(
                &mut engine,
                &secret_request(false),
                &SecureClipConfig::default()
            ),
            Some(SecureClipError::Unavailable)
        );
        assert!(!clipboard.changes().contains(&Change::Text));
        assert!(clipboard.is_empty());
        assert!(engine.current_entry().is_none());
    }

    #[test]
    fn a_failed_text_write_removes_the_exclusions_again() {
        let clipboard = FakeClipboard::default();
        clipboard.reject_text(true);
        let mut engine = clipboard.engine();

        assert_eq!(
            refusal(
                &mut engine,
                &secret_request(false),
                &SecureClipConfig::default()
            ),
            Some(SecureClipError::Unavailable)
        );
        assert_eq!(clipboard.changes().last(), Some(&Change::Emptied));
        assert!(clipboard.is_empty());
        assert!(engine.current_entry().is_none());
    }

    #[test]
    fn a_failed_copy_keeps_the_previous_entry_and_its_clear() {
        let clipboard = FakeClipboard::default();
        let mut engine = engine_with_secret(&clipboard);
        let first = engine.current_entry().expect("first entry").id.clone();
        clipboard.hold_by_another_program(true);

        assert_eq!(
            refusal(
                &mut engine,
                &request_with("second-secret", None),
                &SecureClipConfig::default()
            ),
            Some(SecureClipError::Busy)
        );
        assert_eq!(engine.current_entry().expect("first entry").id, first);

        clipboard.hold_by_another_program(false);
        assert!(engine
            .clear(ClearReason::AutoClear)
            .expect("clear")
            .is_some());
        assert!(clipboard.is_empty());
    }

    #[test]
    fn duration_out_of_range_is_rejected_before_any_write() {
        for seconds in [0, MAX_REQUEST_CLEAR_SECS + 1, i64::MAX as u64, u64::MAX] {
            let clipboard = FakeClipboard::default();
            clipboard.user_copies_text("user-content");
            let mut engine = clipboard.engine();

            assert_eq!(
                refusal(
                    &mut engine,
                    &request_with("fake-secret", Some(seconds)),
                    &SecureClipConfig::default()
                ),
                Some(SecureClipError::InvalidRequest),
                "{seconds}s must be refused"
            );
            assert_eq!(clipboard.text().as_deref(), Some("user-content"));
            assert_eq!(clipboard.sessions(), 0);
            assert!(engine.current_entry().is_none());
        }
    }

    #[test]
    fn durations_inside_the_range_are_honoured() {
        // Every value the frontend sends for a one-time code (1 to 30), and
        // the ceiling.
        for seconds in (MIN_REQUEST_CLEAR_SECS..=30).chain([MAX_REQUEST_CLEAR_SECS]) {
            let (entry, _) = FakeClipboard::default()
                .engine()
                .copy(
                    &request_with("fake-secret", Some(seconds)),
                    &SecureClipConfig::default(),
                )
                .expect("copy");
            let lifetime = entry.expires_at.expect("expiry") - entry.copied_at;
            assert_eq!(lifetime.num_seconds(), seconds as i64);
        }
    }

    fn policy_lifetime(config: &SecureClipConfig, kind: SecretKind) -> Option<i64> {
        let mut request = secret_request(false);
        request.kind = kind;
        let (entry, _) = FakeClipboard::default()
            .engine()
            .copy(&request, config)
            .expect("copy");
        entry
            .expires_at
            .map(|expires| (expires - entry.copied_at).num_seconds())
    }

    #[test]
    fn policy_decides_the_lifetime_when_the_request_does_not() {
        let mut config = SecureClipConfig::default();
        assert_eq!(policy_lifetime(&config, SecretKind::Password), Some(12));

        config.auto_clear_secs = 0;
        assert_eq!(policy_lifetime(&config, SecretKind::TotpCode), Some(30));
        assert_eq!(policy_lifetime(&config, SecretKind::PlainText), None);

        config.kind_clear_overrides.insert(SecretKind::TotpCode, 45);
        assert_eq!(policy_lifetime(&config, SecretKind::TotpCode), Some(45));

        // A policy value that slipped past validation can neither overflow
        // the clock arithmetic nor wrap into the past.
        config
            .kind_clear_overrides
            .insert(SecretKind::TotpCode, u64::MAX);
        assert_eq!(
            policy_lifetime(&config, SecretKind::TotpCode),
            Some(MAX_POLICY_CLEAR_SECS as i64)
        );
    }

    #[test]
    fn duration_beyond_chrono_range_does_not_panic() {
        let entry = ClipEntry::new(
            "fake-secret".to_string(),
            SecretKind::Password,
            None,
            None,
            None,
            i64::MAX as u64,
            0,
        );
        let lifetime = entry.expires_at.expect("expiry") - entry.copied_at;
        assert_eq!(lifetime.num_seconds(), MAX_POLICY_CLEAR_SECS as i64);
    }

    #[test]
    fn streaming_ownership_matches_exact_text_and_keeps_foreign_values() {
        for text in ["secret", "é😀", "x"] {
            let units: Vec<_> = text.encode_utf16().chain(std::iter::once(0)).collect();
            assert!(text_units_match(text, &units));
            let mut padded = units.clone();
            padded.extend([42, 43]);
            assert!(text_units_match(text, &padded));
            assert!(!text_units_match(text, &units[..units.len() - 1]));
            assert!(!text_units_match(&format!("{text}x"), &units));
            assert!(!text_units_match(text, &[0xD800, 0]));
        }
    }

    #[test]
    fn configured_utf8_limit_accepts_boundary_and_refuses_before_any_write() {
        assert_eq!(
            SecureClipConfig::default().max_value_bytes,
            150 * 1024 * 1024
        );
        let config = SecureClipConfig {
            max_value_bytes: MIN_CLIPBOARD_BYTES,
            ..Default::default()
        };
        for value in [
            "x".repeat(MIN_CLIPBOARD_BYTES),
            "é".repeat(MIN_CLIPBOARD_BYTES / 2),
            "😀".repeat(MIN_CLIPBOARD_BYTES / 4),
        ] {
            let clipboard = FakeClipboard::default();
            let mut engine = clipboard.engine();
            engine
                .copy(&request_with(&value, None), &config)
                .expect("UTF-8 boundary accepted");
            engine
                .clear(ClearReason::ManualClear)
                .expect("owned large text clears");
            assert_eq!(clipboard.text(), None);
        }
        let clipboard = FakeClipboard::default();
        clipboard.user_copies_text("user-content");
        let mut engine = clipboard.engine();
        assert_eq!(
            refusal(
                &mut engine,
                &request_with(&"x".repeat(MIN_CLIPBOARD_BYTES + 1), None),
                &config
            ),
            Some(SecureClipError::TooLarge)
        );
        assert_eq!(clipboard.text().as_deref(), Some("user-content"));
        assert_eq!(clipboard.sessions(), 0);
    }

    #[test]
    #[ignore = "allocates a 150 MiB synthetic secret; no system clipboard access"]
    fn benchmark_default_150_mib_copy_and_clear() {
        let clipboard = FakeClipboard::default();
        let mut engine = clipboard.engine();
        let value = "x".repeat(DEFAULT_CLIPBOARD_BYTES);
        let request = request_with(&value, None);
        let start = std::time::Instant::now();
        engine
            .copy(&request, &SecureClipConfig::default())
            .expect("copy");
        let copied = start.elapsed();
        engine.clear(ClearReason::ManualClear).expect("clear");
        eprintln!(
            "150 MiB copy {:?}, clear {:?}",
            copied,
            start.elapsed() - copied
        );
        assert_eq!(clipboard.text(), None);
    }

    #[test]
    fn empty_and_nul_values_are_refused_before_any_write() {
        for value in ["", "fake\0secret"] {
            let clipboard = FakeClipboard::default();
            clipboard.user_copies_text("user-content");
            let mut engine = clipboard.engine();

            assert_eq!(
                refusal(
                    &mut engine,
                    &request_with(value, None),
                    &SecureClipConfig::default()
                ),
                Some(SecureClipError::InvalidRequest)
            );
            assert_eq!(clipboard.text().as_deref(), Some("user-content"));
            assert_eq!(clipboard.sessions(), 0);
        }
    }

    // ─── Ownership and clearing ─────────────────────────────────

    #[test]
    fn every_clear_reason_checks_ownership_first() {
        for reason in EVERY_CLEAR_REASON {
            let clipboard = FakeClipboard::default();
            let mut engine = engine_with_secret(&clipboard);
            assert!(engine.clear(reason).expect("clear").is_some());
            assert!(clipboard.is_empty(), "{reason:?} must remove its secret");

            let clipboard = FakeClipboard::default();
            let mut engine = engine_with_secret(&clipboard);
            clipboard.user_copies_text("user-content");
            let changes = clipboard.changes().len();
            assert!(engine.clear(reason).expect("clear").is_some());
            assert!(engine.current_entry().is_none());
            assert_eq!(clipboard.text().as_deref(), Some("user-content"));
            assert_eq!(
                clipboard.changes().len(),
                changes,
                "{reason:?} changed a clipboard it does not own"
            );
        }
    }

    #[test]
    fn an_entry_is_dropped_without_a_write_when_the_clipboard_holds_no_text() {
        for reason in EVERY_CLEAR_REASON {
            let clipboard = FakeClipboard::default();
            let mut engine = engine_with_secret(&clipboard);
            clipboard.user_copies_an_image();
            let changes = clipboard.changes().len();

            let retired = engine.clear(reason);
            assert!(
                matches!(retired, Ok(Some(_))),
                "{reason:?} must drop the entry when the clipboard holds no text: {:?}",
                retired.as_ref().err()
            );
            assert!(engine.current_entry().is_none());
            assert!(clipboard.holds_an_image());
            assert_eq!(clipboard.changes().len(), changes);
        }
    }

    #[test]
    fn auto_clear_is_not_stuck_by_a_clipboard_without_text() {
        let clipboard = FakeClipboard::default();
        let mut engine = engine_with_secret(&clipboard);
        engine.expire_current();
        clipboard.user_copies_an_image();

        assert!(engine.tick_auto_clear().expect("tick").is_some());
        assert!(engine
            .tick_auto_clear()
            .expect("nothing left to retry")
            .is_none());
        assert!(clipboard.holds_an_image());
        assert_eq!(engine.stats().total_auto_clears, 1);
    }

    #[test]
    fn text_the_engine_cannot_have_written_is_not_owned() {
        let unterminated = vec![0x66, 0x61, 0x6b, 0x65];
        let unpaired_surrogate = vec![0xD800, 0];

        for foreign in [unterminated, unpaired_surrogate] {
            let clipboard = FakeClipboard::default();
            let mut engine = engine_with_secret(&clipboard);
            clipboard.user_copies_utf16(foreign.clone());
            let changes = clipboard.changes().len();

            assert!(engine
                .clear(ClearReason::AutoClear)
                .expect("clear")
                .is_some());
            assert_eq!(clipboard.utf16(), Some(foreign));
            assert_eq!(clipboard.changes().len(), changes);
        }
    }

    #[test]
    fn a_copy_landing_during_the_ownership_check_is_never_wiped() {
        let clipboard = FakeClipboard::default();
        let mut engine = engine_with_secret(&clipboard);
        clipboard.user_copies_text_during_the_next_session("user-content");

        engine.clear(ClearReason::AutoClear).expect("clear");
        assert_eq!(clipboard.text().as_deref(), Some("user-content"));
        assert_eq!(
            clipboard.sessions(),
            2,
            "one session for the copy, and one in which the clear both checks and empties"
        );
    }

    #[test]
    fn unverifiable_ownership_keeps_the_entry_until_it_can_be_checked() {
        for reason in EVERY_CLEAR_REASON {
            let clipboard = FakeClipboard::default();
            let mut engine = engine_with_secret(&clipboard);
            clipboard.hold_by_another_program(true);

            assert_eq!(engine.clear(reason).err(), Some(SecureClipError::Busy));
            assert!(engine.current_entry().is_some());
            assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));

            clipboard.hold_by_another_program(false);
            assert!(engine.clear(reason).expect("retry").is_some());
            assert!(clipboard.is_empty());
        }
    }

    #[test]
    fn clear_preserves_unrelated_clipboard_content() {
        let clipboard = FakeClipboard::default();
        let mut engine = engine_with_secret(&clipboard);
        clipboard.user_copies_text("user-content");

        assert!(engine
            .clear(ClearReason::ManualClear)
            .expect("clear")
            .is_some());
        assert_eq!(clipboard.text().as_deref(), Some("user-content"));
        assert!(engine.current_entry().is_none());
    }

    #[test]
    fn clear_failure_retains_recovery_state() {
        let clipboard = FakeClipboard::default();
        let mut engine = engine_with_secret(&clipboard);
        clipboard.reject_empty(true);

        assert_eq!(
            engine.clear(ClearReason::ManualClear).err(),
            Some(SecureClipError::Unavailable)
        );
        assert!(engine.current_entry().is_some());
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));
    }

    #[test]
    fn lock_clear_removes_only_the_owned_secret() {
        let clipboard = FakeClipboard::default();
        let mut engine = engine_with_secret(&clipboard);

        let cleared = engine.clear(ClearReason::AppLocked).expect("lock clear");
        assert!(cleared.is_some());
        assert!(clipboard.is_empty());
        assert!(engine.current_entry().is_none());
    }

    // ─── Paste ──────────────────────────────────────────────────

    #[test]
    fn one_time_consumption_is_atomic_across_threads() {
        let clipboard = FakeClipboard::default();
        let mut initial = clipboard.engine();
        initial
            .copy(&secret_request(true), &SecureClipConfig::default())
            .expect("copy");
        let engine = Arc::new(Mutex::new(initial));
        let barrier = Arc::new(Barrier::new(8));

        let workers: Vec<_> = (0..8)
            .map(|_| {
                let engine = engine.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    engine.lock().expect("engine lock").paste().is_ok()
                })
            })
            .collect();
        let successes = workers
            .into_iter()
            .map(|worker| worker.join().expect("worker"))
            .filter(|success| *success)
            .count();

        assert_eq!(successes, 1);
        assert!(clipboard.is_empty());
    }

    #[test]
    fn last_permitted_paste_is_delivered_when_the_clear_must_wait() {
        let clipboard = FakeClipboard::default();
        let mut engine = clipboard.engine();
        engine
            .copy(&secret_request(true), &SecureClipConfig::default())
            .expect("copy");
        clipboard.hold_by_another_program(true);

        let paste = engine.paste().expect("the spent paste must be delivered");
        assert_eq!(paste.value.as_str(), "fake-secret");
        assert!(paste.cleared.is_none());
        assert!(!engine.has_entry(), "no second paste");
        assert_eq!(engine.paste().err(), Some(SecureClipError::Expired));
        assert_eq!(clipboard.text().as_deref(), Some("fake-secret"));

        clipboard.hold_by_another_program(false);
        assert!(engine.tick_auto_clear().expect("retry").is_some());
        assert!(clipboard.is_empty());
    }

    #[test]
    fn paste_refusals_carry_fixed_codes() {
        let clipboard = FakeClipboard::default();
        let mut engine = clipboard.engine();
        assert_eq!(engine.paste().err(), Some(SecureClipError::Empty));

        engine
            .copy(&secret_request(false), &SecureClipConfig::default())
            .expect("copy");
        assert_eq!(
            engine.paste_by_id("another-entry").err(),
            Some(SecureClipError::Stale)
        );

        engine.expire_current();
        assert_eq!(engine.paste().err(), Some(SecureClipError::Expired));
    }

    // ─── Values in memory and in output ─────────────────────────

    #[test]
    fn clipboard_utf16_round_trips_and_refuses_foreign_memory() {
        let text = "synthetic \u{1f510} caf\u{e9} \u{79d8}\u{5bc6}\r\nsecond line";
        let encoded = encode_clipboard_utf16(text).expect("encode");
        assert_eq!(encoded.last(), Some(&0));
        assert!(decode_clipboard_utf16(&encoded).holds(text));

        // A clipboard block can be longer than the text it carries.
        let padded = [encoded.to_vec(), vec![0x41, 0x42]].concat();
        assert!(decode_clipboard_utf16(&padded).holds(text));
        assert!(decode_clipboard_utf16(&[0]).holds(""));

        for foreign in [&[][..], &[0x66, 0x61][..], &[0xD800, 0][..]] {
            assert!(matches!(
                decode_clipboard_utf16(foreign),
                ClipboardSnapshot::Foreign
            ));
        }
    }

    #[test]
    fn debug_output_never_contains_the_value() {
        let request = request_with("fake-secret", None);
        assert!(!format!("{request:?}").contains("fake-secret"));

        // A username is shown unmasked in the UI, so its display form holds
        // the whole value.
        let username = ClipEntry::new(
            "fake-secret".to_string(),
            SecretKind::Username,
            None,
            None,
            None,
            30,
            0,
        );
        assert_eq!(username.to_display().masked_value, "fake-secret");
        assert!(!format!("{username:?}").contains("fake-secret"));
        assert!(!format!("{:?}", username.to_display()).contains("fake-secret"));
        assert!(format!("{username:?}").contains("<redacted>"));
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

#[cfg(all(test, target_os = "windows"))]
#[path = "windows_clipboard_tests.rs"]
mod windows_clipboard_tests;
