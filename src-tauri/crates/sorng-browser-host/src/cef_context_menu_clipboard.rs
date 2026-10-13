//! Plain-text writer for the menu's "Copy ... address" rows. This is the
//! ordinary OS clipboard, never the secure clipboard, and it is write-only.
//! The text is a page-supplied address: it enters no log line and no error
//! value. Linux has no writer yet, so the menu does not offer those rows.
use super::policy::copyable;

/// Why nothing was copied. Carries no text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Failure {
    /// Empty, too long or with control characters. The backend was not asked.
    Rejected,
    /// The platform refused the write, or has no writer.
    Unavailable,
}

pub(super) trait Backend {
    /// Replace the clipboard's content with exactly this text. Success only.
    fn replace(&self, text: &str) -> bool;
}

pub(super) fn write(backend: &dyn Backend, text: &str) -> Result<(), Failure> {
    if !copyable(text) {
        return Err(Failure::Rejected);
    }
    if backend.replace(text) {
        Ok(())
    } else {
        Err(Failure::Unavailable)
    }
}

/// Whether [`System`] can write on this platform.
pub(super) const AVAILABLE: bool = cfg!(any(target_os = "windows", target_os = "macos"));

/// The real OS clipboard. A test build never reaches it: unit tests run on a
/// developer's desktop, so they exercise [`write`] with a fake backend.
pub(super) struct System;

impl Backend for System {
    fn replace(&self, text: &str) -> bool {
        if cfg!(test) {
            return false;
        }
        native(text)
    }
}

#[cfg(target_os = "windows")]
fn native(text: &str) -> bool {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(owner: *mut c_void) -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, memory: *mut c_void) -> *mut c_void;
        fn CloseClipboard() -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }
    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 2;
    // `write` admitted no NUL, so the terminator is the only one.
    let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
    // SAFETY: the block holds exactly `wide.len()` UTF-16 units and is only
    // written while locked. The system owns it once SetClipboardData
    // succeeds; on every other path it is freed here. The clipboard is closed
    // on every path that opened it.
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, std::mem::size_of_val(wide.as_slice()));
        if memory.is_null() {
            return false;
        }
        let block = GlobalLock(memory).cast::<u16>();
        if block.is_null() {
            GlobalFree(memory);
            return false;
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), block, wide.len());
        GlobalUnlock(memory);
        // Another process may hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            opened = OpenClipboard(std::ptr::null_mut()) != 0;
            if opened {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        if !opened {
            GlobalFree(memory);
            return false;
        }
        let written = EmptyClipboard() != 0 && !SetClipboardData(CF_UNICODETEXT, memory).is_null();
        if !written {
            GlobalFree(memory);
        }
        CloseClipboard();
        written
    }
}

#[cfg(target_os = "macos")]
fn native(text: &str) -> bool {
    extern "C" {
        // platform/macos_clipboard.mm
        fn sorng_cef_clipboard_write_text(utf8: *const u8, length: usize) -> bool;
    }
    // SAFETY: the bridge reads exactly `length` bytes and retains nothing.
    unsafe { sorng_cef_clipboard_write_text(text.as_ptr(), text.len()) }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn native(_text: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Stands in for the OS clipboard. No test writes the real one.
    struct Fake {
        accept: bool,
        seen: RefCell<Vec<String>>,
    }
    impl Fake {
        fn new(accept: bool) -> Self {
            Self {
                accept,
                seen: RefCell::default(),
            }
        }
    }
    impl Backend for Fake {
        fn replace(&self, text: &str) -> bool {
            self.seen.borrow_mut().push(text.to_owned());
            self.accept
        }
    }

    #[test]
    fn writer_hands_exactly_the_validated_text_to_the_backend_once() {
        let fake = Fake::new(true);
        let address = "https://fixture.invalid/a?b=c#d";
        assert_eq!(write(&fake, address), Ok(()));
        assert_eq!(*fake.seen.borrow(), [address]);
        // Any scheme may be copied; only "Open" is limited to http(s).
        for other in [
            "mailto:someone@fixture.invalid",
            "data:text/plain,x",
            "https://fixture.invalid/\u{e9}\u{1f600}",
        ] {
            assert_eq!(write(&fake, other), Ok(()));
            assert_eq!(fake.seen.borrow().last().unwrap(), other);
        }
        assert_eq!(fake.seen.borrow().len(), 4);
        let longest = format!("https://fixture.invalid/{}", "a".repeat(16_384 - 24));
        assert_eq!(longest.len(), 16_384);
        assert_eq!(write(&fake, &longest), Ok(()));
    }

    #[test]
    fn writer_rejects_unusable_text_before_the_backend_sees_it() {
        let fake = Fake::new(true);
        let long = format!("https://fixture.invalid/{}", "a".repeat(16_384 - 23));
        assert_eq!(long.len(), 16_385);
        for text in [
            "",
            "https://fixture.invalid/\npath",
            "https://fixture.invalid/\r",
            "https://fixture.invalid/\t",
            "https://fixture.invalid/\0",
            "\0",
            "https://fixture.invalid/\u{7f}",
            "https://fixture.invalid/\u{85}",
            long.as_str(),
        ] {
            assert_eq!(write(&fake, text), Err(Failure::Rejected));
        }
        assert!(fake.seen.borrow().is_empty());
    }

    #[test]
    fn a_refused_write_is_reported_without_the_text() {
        let fake = Fake::new(false);
        let private = "https://fixture.invalid/reset?token=do-not-log";
        assert_eq!(write(&fake, private), Err(Failure::Unavailable));
        assert_eq!(fake.seen.borrow().len(), 1);
        // The error type has no field that could carry the address.
        assert_eq!(std::mem::size_of::<Failure>(), 1);
        for failure in [Failure::Rejected, Failure::Unavailable] {
            let shown = format!("{failure:?}");
            assert!(!shown.contains("fixture") && !shown.contains("token"));
        }
    }

    #[test]
    fn writer_never_logs_and_the_system_backend_is_inert_in_tests() {
        let source = include_str!("cef_context_menu_clipboard.rs");
        let code = source.split("mod tests {").next().unwrap();
        for sink in [
            "println!",
            "eprintln!",
            "print!(",
            "eprint!(",
            "dbg!",
            "writeln!",
            "write!(",
            "stderr",
            "stdout",
            "log::",
            "tracing::",
            "format!",
            "panic!",
            "expect(",
            "unwrap(",
            "assert",
        ] {
            assert!(!code.contains(sink), "{sink}");
        }
        // One guard, ahead of the only call into the platform code. Keep this
        // check ahead of the calls below: they are safe only because of it.
        let guard = code
            .find("if cfg!(test) {\n            return false;")
            .or_else(|| code.find("if cfg!(test) {\r\n            return false;"));
        let call = code.find("        native(text)").unwrap();
        assert!(guard.is_some_and(|guard| guard < call));
        assert_eq!(code.matches("native(text)").count(), 1);
        assert_eq!(code.matches("cfg!(test)").count(), 1);
        assert!(!System.replace("https://fixture.invalid/"));
        assert_eq!(
            write(&System, "https://fixture.invalid/"),
            Err(Failure::Unavailable)
        );
        assert_eq!(
            AVAILABLE,
            cfg!(any(target_os = "windows", target_os = "macos"))
        );
    }
}
