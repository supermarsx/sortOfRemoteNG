//! Real virtual-network-adapter implementations of
//! [`super::device::DataplaneDevice`] (SE-5b / t33-P4).
//!
//! # Platform support matrix
//!
//! | Platform | Backing                                                   | L2 (TAP) support |
//! |----------|-----------------------------------------------------------|-------------------|
//! | Linux    | `/dev/net/tun` via the `tun` crate's `IFF_TAP` mode       | **Yes** (true L2) |
//! | Windows  | **TAP-Windows** (OpenVPN `tap-windows6`, NDIS6 TAP)       | **Yes** (true L2, driver + Admin required) |
//! | macOS    | `utun`                                                    | **L3-only** (see caveat below) |
//!
//! ## The L2-vs-L3 caveat (read this)
//!
//! SoftEther is an **L2 (Ethernet)** VPN — every frame on the wire
//! carries the 14-byte Ethernet header and the hub bridges frames at
//! layer 2. The data-plane codec ([`super::dataplane`]) sources/sinks
//! complete Ethernet frames, so the adapter underneath must be able to
//! carry raw Ethernet:
//!
//! * **Linux** — `tun` crate in `Layer::L2` (`IFF_TAP`) is a genuine
//!   Ethernet device. True parity.
//! * **Windows** — the right driver is **TAP-Windows** (OpenVPN's
//!   `tap-windows6`, device id `tap0901`), an NDIS6 *Ethernet* (TAP)
//!   adapter. We open its device path `\\.\Global\{<guid>}.tap`, issue
//!   `DeviceIoControl(TAP_IOCTL_SET_MEDIA_STATUS, connected=1)` to bring
//!   the virtual link up, then do **overlapped** `ReadFile`/`WriteFile`
//!   of raw Ethernet frames. This is true L2 parity. We deliberately do
//!   **NOT** use *wintun*: wintun is an **L3 (IP)** driver — it delivers
//!   bare IP packets with no Ethernet header and cannot carry the ARP /
//!   broadcast / non-IP frames a SoftEther hub bridges. Using it would
//!   silently mis-frame the data plane. When TAP-Windows is not
//!   installed we return an actionable [`DeviceError::DriverMissing`]
//!   naming the driver and where to get it — we never fake an adapter.
//! * **macOS** — the only first-party virtual adapter is `utun`, which
//!   is **L3 (IP) only**: it cannot source/sink raw Ethernet frames. The
//!   historical L2 `tap` kext (tuntaposx) is unsigned and broken on
//!   modern (SIP / Apple-silicon) macOS. We therefore implement utun in
//!   an **explicit reduced L3-only mode**: open `/dev/utun<N>` (or let
//!   the kernel auto-assign), read/write IP packets, and the device
//!   reports `is_l2() == false`. Because SoftEther strictly needs L2,
//!   the macOS adapter is honest about being a reduced-capability mode
//!   rather than silently mis-framing Ethernet onto an IP device — the
//!   integration layer (P3) is expected to consult [`TapDevice::is_l2`]
//!   and refuse / warn on a non-L2 device against an L2 hub. (A full L2
//!   shim — ARP/NDP synthesis + a fabricated local MAC — is a possible
//!   future enhancement but is out of scope here.)
//!
//! # Async model
//!
//! Every backend bridges a **blocking** read/write device to async via
//! two `tokio::task::spawn_blocking` worker threads joined by bounded
//! `tokio::sync::mpsc` channels. This matches Cedar's own blocking I/O
//! pattern (`pthread_create` per direction in
//! `Cedar/Session.c::SessionThread`) and keeps the per-frame hot path
//! off the async executor. The three platforms share the
//! [`TapDevice`] struct and the worker-thread plumbing; only the device
//! open + raw read/write primitive differs per OS.
//!
//! # Verification status (t33-P4, ran on a Windows host)
//!
//! * Windows cfg-gated backend: **compiles** and the non-I/O logic
//!   (device-path construction, registry adapter enumeration error
//!   paths, the `DriverMissing` message) is unit-tested here. A real
//!   adapter *open* needs the TAP-Windows driver installed + an elevated
//!   (Administrator) process — that I/O leg is **host-gated**.
//! * macOS cfg-gated backend: written to be syntactically correct and
//!   self-consistent, but **cannot be compiled on this Windows host**
//!   (no macOS target). It is compile-checked only where a macOS
//!   toolchain is available.
//! * Linux: unchanged, still the reference true-L2 path.

use async_trait::async_trait;

use super::device::{DataplaneDevice, DeviceError};

/// Per-direction channel buffer used by [`TapDevice`]. Sized to match
/// Cedar's `MAX_SEND_SOCKET_QUEUE_NUM` / 32 — i.e. a small multiple of
/// the supervisor's per-batch max so the worker can park briefly without
/// dropping frames.
pub const TAP_CHANNEL_CAPACITY: usize = 256;

/// Virtual network adapter bridged to async via two blocking worker
/// threads.
///
/// * Linux / Windows construct a true **L2 (Ethernet/TAP)** device
///   ([`is_l2`](Self::is_l2) == `true`).
/// * macOS constructs a reduced **L3 (IP/utun)** device
///   ([`is_l2`](Self::is_l2) == `false`) — see module docs for the
///   L2-vs-L3 caveat.
///
/// On platforms / configurations where no usable adapter exists
/// (e.g. Windows without the TAP-Windows driver) [`TapDevice::create`]
/// returns [`DeviceError::DriverMissing`] with an actionable message.
pub struct TapDevice {
    /// Frames read from the kernel adapter, delivered to the supervisor.
    rx: tokio::sync::mpsc::Receiver<Result<Vec<u8>, DeviceError>>,
    /// Frames queued by the supervisor, drained by the writer worker.
    tx: tokio::sync::mpsc::Sender<Vec<u8>>,
    name: String,
    /// `true` when the device carries raw Ethernet (L2/TAP); `false`
    /// when it carries bare IP packets (L3/utun, macOS reduced mode).
    l2: bool,
    /// Flipped to `true` on drop to let worker threads exit promptly.
    /// Workers additionally observe channel closure as a shutdown
    /// signal, so this is defence-in-depth.
    #[allow(dead_code)]
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl std::fmt::Debug for TapDevice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TapDevice").field("name", &self.name).finish()
    }
}

impl Drop for TapDevice {
    fn drop(&mut self) {
        self.shutdown
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl TapDevice {
    /// Creates an L2 TAP device. On Linux requires `CAP_NET_ADMIN`
    /// (surfaces as [`DeviceError::PermissionDenied`]). Elsewhere
    /// returns [`DeviceError::DriverMissing`] — see module docs.
    ///
    /// `requested_name` lets callers pin a device name (`"tap0"`). Pass
    /// `None` to let the kernel auto-assign.
    pub async fn create(requested_name: Option<&str>) -> Result<Self, DeviceError> {
        #[cfg(target_os = "linux")]
        {
            Self::create_linux(requested_name).await
        }

        #[cfg(target_os = "windows")]
        {
            Self::create_windows(requested_name).await
        }

        #[cfg(target_os = "macos")]
        {
            Self::create_macos(requested_name).await
        }

        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        {
            let _ = requested_name;
            Err(DeviceError::DriverMissing(format!(
                "L2 TAP not implemented on this platform ({})",
                std::env::consts::OS
            )))
        }
    }

    /// Whether this device carries raw Ethernet frames (L2/TAP) rather
    /// than bare IP packets (L3/utun).
    ///
    /// SoftEther's data plane is L2; the integration layer should treat
    /// `false` (macOS utun reduced mode) as a degraded/limited adapter
    /// and refuse or warn against an L2 hub rather than mis-framing
    /// Ethernet over an IP device. See the module-level L2-vs-L3 caveat.
    pub fn is_l2(&self) -> bool {
        self.l2
    }

    #[cfg(target_os = "linux")]
    async fn create_linux(requested_name: Option<&str>) -> Result<Self, DeviceError> {
        use std::io::{Read, Write};
        use std::sync::atomic::Ordering;

        let req_name = requested_name.map(|s| s.to_string());

        // Open the device on a blocking thread — `tun::create` is sync.
        let (device, name) = tokio::task::spawn_blocking(move || -> Result<_, DeviceError> {
            let mut cfg = tun::Configuration::default();
            cfg.layer(tun::Layer::L2).up();
            if let Some(ref n) = req_name {
                cfg.name(n);
            }
            match tun::create(&cfg) {
                Ok(dev) => {
                    let name = req_name.unwrap_or_else(|| "tap".to_string());
                    Ok((dev, name))
                }
                Err(e) => {
                    let msg = e.to_string();
                    let mapped = if msg.contains("Operation not permitted")
                        || msg.contains("permission denied")
                        || msg.contains("EPERM")
                    {
                        DeviceError::PermissionDenied(format!(
                            "TAP open requires CAP_NET_ADMIN: {}",
                            msg
                        ))
                    } else if msg.contains("No such device") || msg.contains("ENODEV") {
                        DeviceError::DriverMissing(format!(
                            "TAP module not loaded (`modprobe tun`): {}",
                            msg
                        ))
                    } else {
                        DeviceError::Io(std::io::Error::new(std::io::ErrorKind::Other, msg))
                    };
                    Err(mapped)
                }
            }
        })
        .await
        .map_err(|_| DeviceError::Closed)??;

        // Share the single device between reader + writer threads
        // behind a std::sync::Mutex. Concurrent read/write from the
        // same fd is safe at the kernel level (different operations)
        // but the `tun::Device` doesn't expose an FD split helper
        // without enabling the crate's `async` feature. The Mutex
        // cost per frame is a single uncontended acquire on the
        // "other" direction because workers alternate naturally —
        // reads park in `read()` itself while writes only acquire
        // briefly. This is acceptable for now and matches typical TAP
        // bridge implementations.
        let device = std::sync::Arc::new(std::sync::Mutex::new(device));
        let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let (frame_tx, frame_rx) =
            tokio::sync::mpsc::channel::<Result<Vec<u8>, DeviceError>>(TAP_CHANNEL_CAPACITY);
        let (out_tx, mut out_rx) =
            tokio::sync::mpsc::channel::<Vec<u8>>(TAP_CHANNEL_CAPACITY);

        // Reader thread: blocking read() in a loop, push each frame.
        let reader_dev = device.clone();
        let reader_sd = shutdown.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = vec![0u8; (super::dataplane::MAX_BLOCK_SIZE as usize) + 64];
            loop {
                if reader_sd.load(Ordering::SeqCst) {
                    break;
                }
                let result = {
                    let mut guard = match reader_dev.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    guard.read(&mut buf)
                };
                match result {
                    Ok(0) => {
                        let _ = frame_tx.blocking_send(Err(DeviceError::Closed));
                        break;
                    }
                    Ok(n) => {
                        if frame_tx
                            .blocking_send(Ok(buf[..n].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = frame_tx.blocking_send(Err(DeviceError::Io(e)));
                        break;
                    }
                }
            }
        });

        // Writer thread: pull frames off the channel, blocking write().
        let writer_dev = device.clone();
        let writer_sd = shutdown.clone();
        tokio::task::spawn_blocking(move || {
            while let Some(frame) = out_rx.blocking_recv() {
                if writer_sd.load(Ordering::SeqCst) {
                    break;
                }
                let mut guard = match writer_dev.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if let Err(e) = guard.write_all(&frame) {
                    log::warn!("TAP write error: {}", e);
                    break;
                }
            }
        });

        Ok(TapDevice {
            rx: frame_rx,
            tx: out_tx,
            name,
            l2: true,
            shutdown,
        })
    }
}

// ─── Shared worker-thread plumbing (Windows + macOS) ────────────────────

/// A blocking, bidirectional packet device. Both `read_packet` and
/// `write_packet` block the calling (worker) thread. Implemented by the
/// per-OS raw handles below and bridged to async by
/// [`spawn_blocking_workers`].
#[cfg(any(target_os = "windows", target_os = "macos"))]
trait BlockingPacketIo: Send + Sync + 'static {
    /// Read one packet/frame into `buf`, returning its length. `Ok(0)`
    /// signals a clean close.
    fn read_packet(&self, buf: &mut [u8]) -> std::io::Result<usize>;
    /// Write one complete packet/frame.
    fn write_packet(&self, buf: &[u8]) -> std::io::Result<()>;
}

/// Spawn the reader + writer worker threads around a [`BlockingPacketIo`]
/// and return the wired-up [`TapDevice`]. Mirrors the Linux worker model
/// so all three platforms share the async bridge and shutdown semantics.
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn spawn_blocking_workers<D: BlockingPacketIo>(
    device: D,
    name: String,
    l2: bool,
) -> TapDevice {
    use std::sync::atomic::Ordering;

    let device = std::sync::Arc::new(device);
    let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let (frame_tx, frame_rx) =
        tokio::sync::mpsc::channel::<Result<Vec<u8>, DeviceError>>(TAP_CHANNEL_CAPACITY);
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(TAP_CHANNEL_CAPACITY);

    // Reader worker: blocking read() loop, push each frame.
    let reader_dev = device.clone();
    let reader_sd = shutdown.clone();
    tokio::task::spawn_blocking(move || {
        let mut buf = vec![0u8; (super::dataplane::MAX_BLOCK_SIZE as usize) + 64];
        loop {
            if reader_sd.load(Ordering::SeqCst) {
                break;
            }
            match reader_dev.read_packet(&mut buf) {
                Ok(0) => {
                    let _ = frame_tx.blocking_send(Err(DeviceError::Closed));
                    break;
                }
                Ok(n) => {
                    if frame_tx.blocking_send(Ok(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = frame_tx.blocking_send(Err(DeviceError::Io(e)));
                    break;
                }
            }
        }
    });

    // Writer worker: pull frames off the channel, blocking write().
    let writer_dev = device.clone();
    let writer_sd = shutdown.clone();
    tokio::task::spawn_blocking(move || {
        while let Some(frame) = out_rx.blocking_recv() {
            if writer_sd.load(Ordering::SeqCst) {
                break;
            }
            if let Err(e) = writer_dev.write_packet(&frame) {
                log::warn!("TAP/utun write error: {}", e);
                break;
            }
        }
    });

    TapDevice {
        rx: frame_rx,
        tx: out_tx,
        name,
        l2,
        shutdown,
    }
}

// ─── Windows: TAP-Windows (OpenVPN tap-windows6) L2 backend ─────────────

#[cfg(target_os = "windows")]
mod windows_tap {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::sync::Mutex;

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_IO_PENDING, FALSE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_SYSTEM, FILE_FLAG_OVERLAPPED,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE,
        KEY_READ, REG_SZ,
    };
    use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::System::IO::{GetOverlappedResult, OVERLAPPED};

    // tap-windows6 component id. The driver registers adapters with this
    // ComponentId in the network-adapter class key.
    const TAP_COMPONENT_ID: &str = "tap0901";

    // Network adapter class GUID — the registry root under which all NIC
    // instances (incl. TAP-Windows) are enumerated.
    const ADAPTER_KEY: &str =
        "SYSTEM\\CurrentControlSet\\Control\\Class\\{4D36E972-E325-11CE-BFC1-08002BE10318}";
    // Network connection name → GUID mapping (unused for open, kept for
    // documentation of where the human-readable connection name lives).
    #[allow(dead_code)]
    const NETWORK_CONNECTIONS_KEY: &str =
        "SYSTEM\\CurrentControlSet\\Control\\Network\\{4D36E972-E325-11CE-BFC1-08002BE10318}";

    // CTL_CODE(FILE_DEVICE_UNKNOWN=0x22, function, METHOD_BUFFERED=0,
    // FILE_ANY_ACCESS=0). TAP-Windows defines its IOCTLs with
    // TAP_CONTROL_CODE(request, METHOD_BUFFERED).
    const fn tap_control_code(request: u32) -> u32 {
        // (DeviceType << 16) | (Access << 14) | (Function << 2) | Method
        (0x0000_0022u32 << 16) | (request << 2)
    }
    // TAP_IOCTL_SET_MEDIA_STATUS = TAP_CONTROL_CODE(6, METHOD_BUFFERED).
    const TAP_IOCTL_SET_MEDIA_STATUS: u32 = tap_control_code(6);

    /// Build the user-mode device path for a TAP-Windows adapter GUID:
    /// `\\.\Global\{<guid>}.tap`. This is the canonical path the OpenVPN
    /// driver exposes for overlapped user-mode I/O.
    pub(super) fn device_path_for_guid(guid: &str) -> String {
        format!("\\\\.\\Global\\{}.tap", guid)
    }

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Enumerate the network-adapter class registry to find the GUID(s)
    /// of installed TAP-Windows (`tap0901`) adapters. Returns the list of
    /// `NetCfgInstanceId` GUID strings.
    pub(super) fn find_tap_adapter_guids() -> std::io::Result<Vec<String>> {
        unsafe {
            let mut root: HKEY = std::ptr::null_mut();
            let key_w = wide(ADAPTER_KEY);
            let rc = RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                key_w.as_ptr(),
                0,
                KEY_READ,
                &mut root,
            );
            if rc != 0 {
                return Err(std::io::Error::from_raw_os_error(rc as i32));
            }

            let mut guids = Vec::new();
            let mut index: u32 = 0;
            loop {
                // Subkeys are 4-digit instance indices ("0000", "0001", ...).
                let mut name_buf = [0u16; 256];
                let mut name_len = name_buf.len() as u32;
                let rc = RegEnumKeyExW(
                    root,
                    index,
                    name_buf.as_mut_ptr(),
                    &mut name_len,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                );
                if rc != 0 {
                    // ERROR_NO_MORE_ITEMS (259) or any error ends enumeration.
                    break;
                }
                index += 1;

                let subkey_name = OsString::from_wide(&name_buf[..name_len as usize])
                    .to_string_lossy()
                    .into_owned();
                let subkey_path = format!("{}\\{}", ADAPTER_KEY, subkey_name);

                if let (Some(component), Some(guid)) = (
                    read_reg_sz(HKEY_LOCAL_MACHINE, &subkey_path, "ComponentId"),
                    read_reg_sz(HKEY_LOCAL_MACHINE, &subkey_path, "NetCfgInstanceId"),
                ) {
                    if component.eq_ignore_ascii_case(TAP_COMPONENT_ID) {
                        guids.push(guid);
                    }
                }
            }

            RegCloseKey(root);
            Ok(guids)
        }
    }

    /// Read a `REG_SZ` value, returning the trimmed string or `None`.
    fn read_reg_sz(root: HKEY, subkey: &str, value: &str) -> Option<String> {
        unsafe {
            let mut key: HKEY = std::ptr::null_mut();
            let subkey_w = wide(subkey);
            if RegOpenKeyExW(root, subkey_w.as_ptr(), 0, KEY_READ, &mut key) != 0 {
                return None;
            }
            let value_w = wide(value);
            let mut ty: u32 = 0;
            let mut data = [0u16; 512];
            let mut len = (data.len() * 2) as u32; // bytes
            let rc = RegQueryValueExW(
                key,
                value_w.as_ptr(),
                std::ptr::null_mut(),
                &mut ty,
                data.as_mut_ptr() as *mut u8,
                &mut len,
            );
            RegCloseKey(key);
            if rc != 0 || ty != REG_SZ {
                return None;
            }
            let chars = (len as usize / 2).saturating_sub(1); // drop NUL
            Some(
                OsString::from_wide(&data[..chars])
                    .to_string_lossy()
                    .trim()
                    .to_string(),
            )
        }
    }

    /// An open TAP-Windows adapter handle with its persistent overlapped
    /// events. Concurrent read+write from the same handle is safe because
    /// each direction owns its own `OVERLAPPED`/event.
    pub(super) struct TapWindowsHandle {
        handle: HANDLE,
        read_event: HANDLE,
        write_event: HANDLE,
        // OVERLAPPED structs are guarded so the reader/writer worker
        // threads don't race the same struct (each direction uses one).
        read_ov: Mutex<()>,
        write_ov: Mutex<()>,
    }

    // SAFETY: the raw HANDLE is only ever used from the worker threads via
    // the per-direction mutexes; the kernel object itself is thread-safe
    // for concurrent ReadFile/WriteFile with distinct OVERLAPPEDs.
    unsafe impl Send for TapWindowsHandle {}
    unsafe impl Sync for TapWindowsHandle {}

    impl TapWindowsHandle {
        /// Open the adapter at `guid`, set its media status to connected,
        /// and return a handle ready for overlapped I/O.
        pub(super) fn open(guid: &str) -> Result<Self, DeviceError> {
            let path = device_path_for_guid(guid);
            let path_w = wide(&path);
            unsafe {
                let handle = CreateFileW(
                    path_w.as_ptr(),
                    // GENERIC_READ | GENERIC_WRITE
                    0x8000_0000 | 0x4000_0000,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_SYSTEM | FILE_FLAG_OVERLAPPED,
                    std::ptr::null_mut(),
                );
                if handle == INVALID_HANDLE_VALUE || handle.is_null() {
                    let err = GetLastError();
                    return Err(DeviceError::Io(std::io::Error::from_raw_os_error(err as i32)));
                }

                // Bring the virtual Ethernet link up.
                let mut status: u32 = 1; // connected
                let mut bytes_returned: u32 = 0;
                use windows_sys::Win32::System::IO::DeviceIoControl;
                let ok = DeviceIoControl(
                    handle,
                    TAP_IOCTL_SET_MEDIA_STATUS,
                    &mut status as *mut u32 as *mut core::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                    &mut status as *mut u32 as *mut core::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                    &mut bytes_returned,
                    std::ptr::null_mut(),
                );
                if ok == FALSE {
                    let err = GetLastError();
                    CloseHandle(handle);
                    return Err(DeviceError::Io(std::io::Error::from_raw_os_error(err as i32)));
                }

                let read_event = CreateEventW(
                    std::ptr::null(),
                    1, // manual reset
                    0, // initially non-signaled
                    std::ptr::null(),
                );
                let write_event =
                    CreateEventW(std::ptr::null(), 1, 0, std::ptr::null());
                if read_event.is_null() || write_event.is_null() {
                    let err = GetLastError();
                    CloseHandle(handle);
                    return Err(DeviceError::Io(std::io::Error::from_raw_os_error(err as i32)));
                }

                Ok(TapWindowsHandle {
                    handle,
                    read_event,
                    write_event,
                    read_ov: Mutex::new(()),
                    write_ov: Mutex::new(()),
                })
            }
        }
    }

    impl Drop for TapWindowsHandle {
        fn drop(&mut self) {
            unsafe {
                if !self.read_event.is_null() {
                    CloseHandle(self.read_event);
                }
                if !self.write_event.is_null() {
                    CloseHandle(self.write_event);
                }
                if self.handle != INVALID_HANDLE_VALUE && !self.handle.is_null() {
                    CloseHandle(self.handle);
                }
            }
        }
    }

    impl super::BlockingPacketIo for TapWindowsHandle {
        fn read_packet(&self, buf: &mut [u8]) -> std::io::Result<usize> {
            let _g = self.read_ov.lock().unwrap();
            unsafe {
                let mut ov: OVERLAPPED = std::mem::zeroed();
                ov.hEvent = self.read_event;
                let mut read: u32 = 0;
                let ok = ReadFile(
                    self.handle,
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut read,
                    &mut ov,
                );
                if ok == FALSE {
                    let err = GetLastError();
                    if err != ERROR_IO_PENDING {
                        return Err(std::io::Error::from_raw_os_error(err as i32));
                    }
                    WaitForSingleObject(self.read_event, INFINITE);
                    let got = GetOverlappedResult(self.handle, &ov, &mut read, FALSE);
                    if got == FALSE {
                        let err = GetLastError();
                        return Err(std::io::Error::from_raw_os_error(err as i32));
                    }
                }
                Ok(read as usize)
            }
        }

        fn write_packet(&self, buf: &[u8]) -> std::io::Result<()> {
            let _g = self.write_ov.lock().unwrap();
            unsafe {
                let mut ov: OVERLAPPED = std::mem::zeroed();
                ov.hEvent = self.write_event;
                let mut written: u32 = 0;
                let ok = WriteFile(
                    self.handle,
                    buf.as_ptr(),
                    buf.len() as u32,
                    &mut written,
                    &mut ov,
                );
                if ok == FALSE {
                    let err = GetLastError();
                    if err != ERROR_IO_PENDING {
                        return Err(std::io::Error::from_raw_os_error(err as i32));
                    }
                    WaitForSingleObject(self.write_event, INFINITE);
                    let got = GetOverlappedResult(self.handle, &ov, &mut written, FALSE);
                    if got == FALSE {
                        let err = GetLastError();
                        return Err(std::io::Error::from_raw_os_error(err as i32));
                    }
                }
                if (written as usize) != buf.len() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::WriteZero,
                        "TAP-Windows short write",
                    ));
                }
                Ok(())
            }
        }
    }

    /// Human-readable, actionable "driver not installed" message.
    pub(super) fn driver_missing_message() -> String {
        "TAP-Windows adapter (OpenVPN tap-windows6, component id `tap0901`) not found. \
         SoftEther is an L2/Ethernet VPN and requires a true L2 TAP adapter; \
         Windows' built-in wintun is L3 (IP) only and cannot carry SoftEther frames. \
         Install the TAP-Windows driver (https://build.openvpn.net/downloads/releases/ \
         — `tap-windows-9.x` / bundled with the OpenVPN community installer), reboot if \
         prompted, then run the VPN with Administrator privileges."
            .to_string()
    }
}

#[cfg(target_os = "windows")]
impl TapDevice {
    /// Open a real TAP-Windows (OpenVPN tap-windows6) L2 adapter.
    ///
    /// `requested_name` is currently advisory — the adapter is selected
    /// by its `tap0901` component id from the registry (the first
    /// installed TAP-Windows adapter). A future enhancement could match
    /// `requested_name` against the adapter's network-connection name.
    ///
    /// Requires the driver installed **and** an elevated (Administrator)
    /// process; the actual open is host-gated.
    async fn create_windows(requested_name: Option<&str>) -> Result<Self, DeviceError> {
        let req = requested_name.map(|s| s.to_string());
        tokio::task::spawn_blocking(move || -> Result<Self, DeviceError> {
            let guids = windows_tap::find_tap_adapter_guids().map_err(|e| {
                // Registry unreadable → treat as "can't find driver" with
                // the actionable install message rather than a bare io err.
                DeviceError::DriverMissing(format!(
                    "{} (registry enumeration failed: {})",
                    windows_tap::driver_missing_message(),
                    e
                ))
            })?;

            let guid = guids.into_iter().next().ok_or_else(|| {
                DeviceError::DriverMissing(windows_tap::driver_missing_message())
            })?;

            let handle = windows_tap::TapWindowsHandle::open(&guid)?;
            let name = req.unwrap_or_else(|| format!("tap-windows:{}", guid));
            Ok(spawn_blocking_workers(handle, name, true))
        })
        .await
        .map_err(|_| DeviceError::Closed)?
    }
}

// ─── macOS: utun (L3-only, reduced mode) backend ────────────────────────

#[cfg(target_os = "macos")]
mod macos_utun {
    use super::*;
    use std::os::unix::io::RawFd;

    // utun control name registered by the kernel.
    const UTUN_CONTROL_NAME: &[u8] = b"com.apple.net.utun_control";
    const UTUN_OPT_IFNAME: libc_compat::c_int = 2;
    // AF_SYS_CONTROL / SYSPROTO_CONTROL constants (xnu sys/sys_domain.h,
    // sys/kern_control.h).
    const AF_SYSTEM: libc_compat::c_int = 32;
    const SYSPROTO_CONTROL: libc_compat::c_int = 2;
    const AF_SYS_CONTROL: u8 = 2;
    const SOCK_DGRAM: libc_compat::c_int = 2;
    const CTLIOCGINFO: libc_compat::c_ulong = 0xc064_4e03; // _IOWR('N', 3, ctl_info)

    /// Minimal libc surface so this module is self-contained and does not
    /// require adding a `libc` dependency to the crate's Cargo.toml.
    /// Compiled only on macOS; never built on this Windows host.
    mod libc_compat {
        #![allow(non_camel_case_types)]
        pub type c_int = i32;
        pub type c_uint = u32;
        pub type c_ulong = u64;
        pub type socklen_t = u32;

        #[repr(C)]
        pub struct ctl_info {
            pub ctl_id: c_uint,
            pub ctl_name: [u8; 96],
        }

        #[repr(C)]
        pub struct sockaddr_ctl {
            pub sc_len: u8,
            pub sc_family: u8,
            pub ss_sysaddr: u16,
            pub sc_id: c_uint,
            pub sc_unit: c_uint,
            pub sc_reserved: [c_uint; 5],
        }

        extern "C" {
            pub fn socket(domain: c_int, ty: c_int, protocol: c_int) -> c_int;
            pub fn ioctl(fd: c_int, request: c_ulong, ...) -> c_int;
            pub fn connect(fd: c_int, addr: *const sockaddr_ctl, len: socklen_t) -> c_int;
            pub fn getsockopt(
                fd: c_int,
                level: c_int,
                optname: c_int,
                optval: *mut core::ffi::c_void,
                optlen: *mut socklen_t,
            ) -> c_int;
            pub fn read(fd: c_int, buf: *mut core::ffi::c_void, count: usize) -> isize;
            pub fn write(fd: c_int, buf: *const core::ffi::c_void, count: usize) -> isize;
            pub fn close(fd: c_int) -> c_int;
        }
    }

    /// Open the next available `utun` interface and return its fd + name.
    ///
    /// utun delivers IP packets prefixed with a 4-byte address-family
    /// header (`AF_INET`/`AF_INET6`, big-endian). This is an **L3** path;
    /// it cannot carry raw Ethernet, so the resulting [`TapDevice`] is
    /// flagged `l2 == false`. See module docs for the caveat.
    pub(super) fn open_utun(requested_unit: Option<u32>) -> Result<(RawFd, String), DeviceError> {
        unsafe {
            let fd = libc_compat::socket(AF_SYSTEM, SOCK_DGRAM, SYSPROTO_CONTROL);
            if fd < 0 {
                return Err(map_errno("socket(AF_SYSTEM)"));
            }

            // Resolve the utun control id.
            let mut info: libc_compat::ctl_info = std::mem::zeroed();
            for (i, b) in UTUN_CONTROL_NAME.iter().enumerate() {
                info.ctl_name[i] = *b;
            }
            if libc_compat::ioctl(fd, CTLIOCGINFO, &mut info) < 0 {
                let e = map_errno("ioctl(CTLIOCGINFO)");
                libc_compat::close(fd);
                return Err(e);
            }

            // unit 0 → let the kernel pick the next free utun; otherwise
            // request unit N (interface utun(N-1)).
            let unit = requested_unit.unwrap_or(0);
            let addr = libc_compat::sockaddr_ctl {
                sc_len: std::mem::size_of::<libc_compat::sockaddr_ctl>() as u8,
                sc_family: AF_SYSTEM as u8,
                ss_sysaddr: AF_SYS_CONTROL as u16,
                sc_id: info.ctl_id,
                sc_unit: unit,
                sc_reserved: [0; 5],
            };
            if libc_compat::connect(
                fd,
                &addr,
                std::mem::size_of::<libc_compat::sockaddr_ctl>() as libc_compat::socklen_t,
            ) < 0
            {
                let e = map_errno("connect(utun)");
                libc_compat::close(fd);
                return Err(e);
            }

            // Read back the assigned interface name (utunN).
            let mut name_buf = [0u8; 64];
            let mut name_len = name_buf.len() as libc_compat::socklen_t;
            let name = if libc_compat::getsockopt(
                fd,
                SYSPROTO_CONTROL,
                UTUN_OPT_IFNAME,
                name_buf.as_mut_ptr() as *mut core::ffi::c_void,
                &mut name_len,
            ) == 0
            {
                let end = name_buf
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(name_buf.len());
                String::from_utf8_lossy(&name_buf[..end]).into_owned()
            } else {
                "utun".to_string()
            };

            Ok((fd, name))
        }
    }

    fn map_errno(ctx: &str) -> DeviceError {
        let err = std::io::Error::last_os_error();
        match err.raw_os_error() {
            // EPERM / EACCES — utun open needs root.
            Some(1) | Some(13) => DeviceError::PermissionDenied(format!(
                "{}: utun open requires root: {}",
                ctx, err
            )),
            // ENOENT / ENXIO — utun control unavailable.
            Some(2) | Some(6) => {
                DeviceError::DriverMissing(format!("{}: utun unavailable: {}", ctx, err))
            }
            _ => DeviceError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("{}: {}", ctx, err),
            )),
        }
    }

    /// Owns the utun fd and prepends/strips the 4-byte AF header so the
    /// data plane sees bare IP packets. Implements [`BlockingPacketIo`].
    pub(super) struct UtunHandle {
        fd: RawFd,
    }

    // SAFETY: the fd is used only from the worker threads; concurrent
    // read/write on the same socket fd is permitted by the kernel.
    unsafe impl Send for UtunHandle {}
    unsafe impl Sync for UtunHandle {}

    impl UtunHandle {
        pub(super) fn new(fd: RawFd) -> Self {
            UtunHandle { fd }
        }
    }

    impl Drop for UtunHandle {
        fn drop(&mut self) {
            unsafe {
                libc_compat::close(self.fd);
            }
        }
    }

    impl super::BlockingPacketIo for UtunHandle {
        fn read_packet(&self, buf: &mut [u8]) -> std::io::Result<usize> {
            // utun frames arrive as [4-byte AF header][IP packet]. Read
            // into a scratch buffer then strip the header.
            let mut scratch = vec![0u8; buf.len() + 4];
            let n = unsafe {
                libc_compat::read(
                    self.fd,
                    scratch.as_mut_ptr() as *mut core::ffi::c_void,
                    scratch.len(),
                )
            };
            if n < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if n == 0 {
                return Ok(0);
            }
            let n = n as usize;
            if n < 4 {
                // Runt — nothing usable.
                return Ok(0);
            }
            let payload = n - 4;
            let copy = payload.min(buf.len());
            buf[..copy].copy_from_slice(&scratch[4..4 + copy]);
            Ok(copy)
        }

        fn write_packet(&self, buf: &[u8]) -> std::io::Result<()> {
            if buf.is_empty() {
                return Ok(());
            }
            // Prepend the AF header. Infer family from the IP version
            // nibble of the first byte (4 → AF_INET=2, 6 → AF_INET6=30).
            let af: u32 = match buf[0] >> 4 {
                6 => 30, // AF_INET6 on macOS
                _ => 2,  // AF_INET
            };
            let mut framed = Vec::with_capacity(buf.len() + 4);
            framed.extend_from_slice(&af.to_be_bytes());
            framed.extend_from_slice(buf);
            let n = unsafe {
                libc_compat::write(
                    self.fd,
                    framed.as_ptr() as *const core::ffi::c_void,
                    framed.len(),
                )
            };
            if n < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if (n as usize) != framed.len() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "utun short write",
                ));
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
impl TapDevice {
    /// Open a `utun` interface in **reduced L3-only mode**.
    ///
    /// macOS has no first-party signed L2 (Ethernet/TAP) driver on modern
    /// (SIP / Apple-silicon) systems, so this is the best available
    /// adapter. The returned device reports `is_l2() == false`; SoftEther
    /// strictly needs L2, so the integration layer must treat this as a
    /// degraded/limited mode (see the module-level caveat) rather than
    /// assume Ethernet framing. Requires root.
    async fn create_macos(requested_name: Option<&str>) -> Result<Self, DeviceError> {
        // Allow callers to pin "utunN" → unit N+1; otherwise auto-assign.
        let requested_unit = requested_name.and_then(|n| {
            n.strip_prefix("utun")
                .and_then(|d| d.parse::<u32>().ok())
                .map(|n| n + 1)
        });
        tokio::task::spawn_blocking(move || -> Result<Self, DeviceError> {
            let (fd, name) = macos_utun::open_utun(requested_unit)?;
            let handle = macos_utun::UtunHandle::new(fd);
            // l2 = false: this is an IP (L3) device, NOT Ethernet.
            Ok(spawn_blocking_workers(handle, name, false))
        })
        .await
        .map_err(|_| DeviceError::Closed)?
    }
}

#[async_trait]
impl DataplaneDevice for TapDevice {
    async fn read_frame(&mut self) -> Result<Vec<u8>, DeviceError> {
        match self.rx.recv().await {
            Some(Ok(bytes)) => Ok(bytes),
            Some(Err(e)) => Err(e),
            None => Err(DeviceError::Closed),
        }
    }

    async fn write_frame(&mut self, bytes: &[u8]) -> Result<(), DeviceError> {
        self.tx
            .send(bytes.to_vec())
            .await
            .map_err(|_| DeviceError::Closed)
    }

    fn name(&self) -> &str {
        &self.name
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Windows TAP-Windows backend (non-I/O logic) ───────────────────
    //
    // On a Windows host WITHOUT the TAP-Windows driver installed (the
    // common CI / dev case), `create` must refuse cleanly with an
    // actionable `DriverMissing`. If the driver *is* installed but the
    // process is unelevated, the open fails with `Io`/`PermissionDenied`
    // — we accept any typed error and never a panic or silent success.
    // The real adapter-open leg is host-gated (driver + Administrator).
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn windows_create_surfaces_typed_error_without_driver() {
        match TapDevice::create(None).await {
            Ok(dev) => {
                // Driver present + elevated — true L2 adapter opened.
                assert!(dev.is_l2(), "TAP-Windows must be an L2 device");
            }
            Err(DeviceError::DriverMissing(m)) => {
                // Message must be actionable: name the driver + wintun caveat.
                assert!(m.contains("tap0901"), "message: {}", m);
                assert!(m.to_lowercase().contains("wintun"), "message: {}", m);
            }
            Err(DeviceError::Io(_)) => {}
            Err(DeviceError::PermissionDenied(_)) => {}
            Err(DeviceError::Closed) => panic!("unexpected Closed at open time"),
        }
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn windows_named_request_still_typed() {
        // A pinned name must not change the typed-error contract.
        match TapDevice::create(Some("tap-sorng")).await {
            Ok(dev) => assert!(dev.is_l2()),
            Err(DeviceError::DriverMissing(_))
            | Err(DeviceError::Io(_))
            | Err(DeviceError::PermissionDenied(_)) => {}
            Err(DeviceError::Closed) => panic!("unexpected Closed at open time"),
        }
    }

    // Device-path construction is pure logic and fully testable on the
    // Windows host without any driver: it must match the TAP-Windows
    // user-mode path `\\.\Global\{<guid>}.tap`.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_device_path_format() {
        let guid = "{12345678-90AB-CDEF-1234-567890ABCDEF}";
        let path = super::windows_tap::device_path_for_guid(guid);
        assert_eq!(
            path,
            "\\\\.\\Global\\{12345678-90AB-CDEF-1234-567890ABCDEF}.tap"
        );
    }

    // The DriverMissing message is the user-facing UX: it must name the
    // driver, the wintun L3 caveat, and where to get it.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_driver_missing_message_is_actionable() {
        let m = super::windows_tap::driver_missing_message();
        assert!(m.contains("tap0901"));
        assert!(m.to_lowercase().contains("wintun"));
        assert!(m.contains("openvpn.net"));
        assert!(m.contains("Administrator"));
    }

    // Adapter enumeration must never panic on a host (it returns either a
    // possibly-empty GUID list or a typed io error from the registry).
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_enumeration_does_not_panic() {
        let _ = super::windows_tap::find_tap_adapter_guids();
    }

    // ── macOS utun backend (reduced L3-only mode) ─────────────────────
    //
    // On a macOS host the open needs root; unprivileged CI must surface a
    // typed error (PermissionDenied / DriverMissing / Io), and when it
    // *does* succeed the device must honestly report L3 (is_l2()==false).
    // This leg only compiles where a macOS toolchain is present; it is
    // host-gated for this Windows executor.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn macos_utun_is_l3_or_typed_error() {
        match TapDevice::create(None).await {
            Ok(dev) => {
                assert!(!dev.is_l2(), "macOS utun must report L3 (not L2)");
            }
            Err(DeviceError::PermissionDenied(_)) => {}
            Err(DeviceError::DriverMissing(_)) => {}
            Err(DeviceError::Io(_)) => {}
            Err(DeviceError::Closed) => panic!("unexpected Closed at open time"),
        }
    }

    // On Linux in an unprivileged CI environment the open must fail
    // with a typed error (PermissionDenied / DriverMissing / Io). We
    // accept any of those — CI may or may not grant caps — but the
    // result must never be a panic or a silent success.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn linux_create_surfaces_typed_error_when_unprivileged() {
        match TapDevice::create(Some("sorng-tap-test")).await {
            Ok(_dev) => {
                // Running privileged — accept and move on.
            }
            Err(DeviceError::PermissionDenied(_)) => {}
            Err(DeviceError::DriverMissing(_)) => {}
            Err(DeviceError::Io(_)) => {}
            Err(DeviceError::Closed) => panic!("unexpected Closed at open time"),
        }
    }

    // Compile-guard: module must build on every platform. Value lies
    // in forcing `cargo check` on Windows/macOS to exercise the cfg
    // branches above.
    #[test]
    fn module_compiles_on_all_platforms() {
        let _ = TAP_CHANNEL_CAPACITY;
    }
}
