//! Explicitly opted-in synthetic-fixture diagnostics, never production handling.
//! No heap allocation, mutex, symbol lookup, memory dump or exception-context
//! modification in the callback. Stack capture is best effort, not crash recovery.
use std::{
    ffi::c_void,
    fmt::{self, Write},
    os::windows::io::IntoRawHandle,
    path::Path,
    ptr,
    sync::atomic::{AtomicBool, AtomicPtr, AtomicUsize, Ordering},
};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    Storage::FileSystem::{FlushFileBuffers, WriteFile},
    System::{
        Diagnostics::Debug::{
            AddVectoredExceptionHandler, RtlCaptureStackBackTrace, RtlPcToFileHeader,
            EXCEPTION_CONTINUE_SEARCH, EXCEPTION_POINTERS,
        },
        LibraryLoader::GetModuleHandleW,
    },
};

const LIMIT: usize = 8;
const MODULE_NAMES: [&str; 7] = [
    "sorng_cef_acceptance.dll",
    "libcef.dll",
    "ntdll.dll",
    "kernelbase.dll",
    "kernel32.dll",
    "user32.dll",
    "win32u.dll",
];
static MODULES: [AtomicUsize; 7] = [const { AtomicUsize::new(0) }; 7];
static OUTPUT: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());
static COUNT: AtomicUsize = AtomicUsize::new(0);
static BUSY: AtomicBool = AtomicBool::new(false);

struct Line {
    bytes: [u8; 4096],
    used: usize,
}
impl Line {
    fn new() -> Self {
        Self {
            bytes: [0; 4096],
            used: 0,
        }
    }
}
impl Write for Line {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        if text.len() > self.bytes.len().saturating_sub(self.used) {
            return Err(fmt::Error);
        }
        self.bytes[self.used..self.used + text.len()].copy_from_slice(text.as_bytes());
        self.used += text.len();
        Ok(())
    }
}

fn severe(code: u32) -> bool {
    // AV, in-page error, illegal instruction, integer divide-by-zero, heap
    // corruption, stack-buffer overrun/fail-fast and fatal callback exception.
    // Not C++/Rust exceptions, debugger breaks or stack overflow (unsafe to walk).
    matches!(
        code,
        0xc0000005 | 0xc0000006 | 0xc000001d | 0xc0000094 | 0xc0000374 | 0xc0000409 | 0xc000041d
    )
}

unsafe fn append_address(line: &mut Line, address: *mut c_void) {
    let mut base = ptr::null_mut();
    RtlPcToFileHeader(address, &mut base);
    let label = MODULES
        .iter()
        .position(|m| base as usize != 0 && m.load(Ordering::Relaxed) == base as usize)
        .map(|i| MODULE_NAMES[i])
        .unwrap_or("unknown");
    let offset = (address as usize).wrapping_sub(base as usize);
    let _ = write!(
        line,
        " addr=0x{:x} module={} base=0x{:x} offset=0x{:x}",
        address as usize, label, base as usize, offset
    );
}

unsafe fn persist(line: &Line) {
    let handle = OUTPUT.load(Ordering::Acquire);
    if handle.is_null() {
        return;
    }
    let mut written = 0;
    // Unbuffered Rust-side; synchronous OS write + flush, no formatter allocation.
    WriteFile(
        handle,
        line.bytes.as_ptr(),
        line.used as u32,
        &mut written,
        ptr::null_mut(),
    );
    FlushFileBuffers(handle);
}

unsafe extern "system" fn observe(pointers: *mut EXCEPTION_POINTERS) -> i32 {
    if pointers.is_null() || (*pointers).ExceptionRecord.is_null() {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    let record = &*(*pointers).ExceptionRecord;
    let code = record.ExceptionCode as u32;
    if !severe(code)
        || OUTPUT.load(Ordering::Acquire).is_null()
        || BUSY
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
    {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    let index = COUNT.load(Ordering::Relaxed);
    if index < LIMIT {
        COUNT.store(index + 1, Ordering::Relaxed);
        let mut line = Line::new();
        let _ = write!(line, "exception={} code=0x{:08x} ip", index, code);
        append_address(&mut line, record.ExceptionAddress);
        let _ = line.write_str("\n");
        // Preserve the original fault address before attempting stack capture.
        persist(&line);
        let mut frames = [ptr::null_mut(); 24];
        let count =
            RtlCaptureStackBackTrace(0, frames.len() as u32, frames.as_mut_ptr(), ptr::null_mut());
        let mut trace = Line::new();
        let _ = write!(trace, "exception={} handler-stack", index);
        for frame in frames.iter().take(usize::from(count).min(frames.len())) {
            append_address(&mut trace, *frame);
        }
        let _ = trace.write_str("\n");
        persist(&trace);
    }
    BUSY.store(false, Ordering::Release);
    // Never swallow, resume, modify context, or substitute a crash handler.
    EXCEPTION_CONTINUE_SEARCH
}

pub fn install_if_enabled(output: &Path) -> std::io::Result<()> {
    if std::env::var_os("SORNG_CEF_ACCEPTANCE_EXCEPTION_TRACE").as_deref()
        != Some(std::ffi::OsStr::new("1"))
    {
        return Ok(());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output.join("native-exceptions.txt"))?;
    use std::io::Write as _;
    file.write_all(b"synthetic-fixture-only exception-observer-v1 max-records=8 frames=24 disposition=CONTINUE_SEARCH\n")?;
    file.sync_all()?;
    for (index, name) in MODULE_NAMES.iter().enumerate() {
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        MODULES[index].store(
            unsafe { GetModuleHandleW(wide.as_ptr()) } as usize,
            Ordering::Relaxed,
        );
    }
    let handle = file.into_raw_handle();
    if OUTPUT
        .compare_exchange(ptr::null_mut(), handle, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        unsafe {
            CloseHandle(handle);
        }
        return Err(std::io::Error::other(
            "exception observer already installed",
        ));
    }
    // Process lifetime registration/handle: no unload/close race with callbacks.
    // Appending (First=0) does not reorder pre-existing exception handlers.
    if unsafe { AddVectoredExceptionHandler(0, Some(observe)) }.is_null() {
        let error = std::io::Error::last_os_error();
        OUTPUT.store(ptr::null_mut(), Ordering::Release);
        unsafe {
            CloseHandle(handle);
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observer_filters_and_always_continues_search() {
        assert!(severe(0xc0000005));
        assert!(severe(0xc000041d));
        for code in [0, 0xe06d7363, 0xe0421000, 0x80000003, 0xc00000fd] {
            assert!(!severe(code));
        }
        assert_eq!(
            unsafe { observe(ptr::null_mut()) },
            EXCEPTION_CONTINUE_SEARCH
        );
        let mut record =
            windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_RECORD::default();
        record.ExceptionCode = 0xc0000005u32 as i32;
        record.ExceptionAddress = observe as *const () as *mut c_void;
        let mut pointers = EXCEPTION_POINTERS {
            ExceptionRecord: &mut record,
            ContextRecord: ptr::null_mut(),
        };
        assert_eq!(unsafe { observe(&mut pointers) }, EXCEPTION_CONTINUE_SEARCH);
        // Exercise persistence and the cap without raising a Windows exception
        // or installing a handler in the test process.
        let path = std::env::temp_dir().join(format!(
            "sorng-cef-exceptions-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        OUTPUT.store(file.into_raw_handle(), Ordering::Release);
        for _ in 0..64 {
            assert_eq!(unsafe { observe(&mut pointers) }, EXCEPTION_CONTINUE_SEARCH);
        }
        let handle = OUTPUT.swap(ptr::null_mut(), Ordering::AcqRel);
        unsafe {
            CloseHandle(handle);
        }
        let evidence = std::fs::read_to_string(&path).unwrap();
        assert_eq!(COUNT.load(Ordering::Relaxed), LIMIT);
        assert_eq!(evidence.lines().count(), LIMIT * 2);
        assert_eq!(
            evidence
                .lines()
                .filter(|line| line.contains("code=0xc0000005 ip"))
                .count(),
            LIMIT
        );
        assert!(evidence.len() <= LIMIT * 2 * 4096);
        assert!(!BUSY.load(Ordering::Acquire));
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn fixed_output_buffer_rejects_overflow() {
        let mut line = Line::new();
        assert!(line.write_str(&"x".repeat(4096)).is_ok());
        assert!(line.write_str("x").is_err());
        assert_eq!(line.used, 4096);
    }
}
