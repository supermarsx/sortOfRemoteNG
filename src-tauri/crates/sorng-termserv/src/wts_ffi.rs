//! Low-level safe wrappers around the Windows Terminal Services (WTS) API.
//!
//! All functions in this module translate Win32 FFI calls into safe Rust
//! types defined in [`crate::types`]. The module is only compiled on Windows.
//!
//! # Safety
//!
//! Every `unsafe` block is documented with the safety invariant it relies on.
//! All returned pointers are freed via `WTSFreeMemory` before the wrapping
//! function returns, so callers never handle raw Win32 pointers.

use crate::types::*;
use log::{debug, warn};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, GetLastError, HLOCAL, LocalFree};
use windows::Win32::Security::PSID;
use windows::Win32::System::RemoteDesktop::{
    WTSActive, WTSConnectQuery, WTSConnected, WTSDisconnected, WTSDown,
    WTSIdle, WTSInit, WTSListen, WTSReset, WTSShadow,
    WTS_CONNECTSTATE_CLASS, WTS_SESSION_INFOW, WTS_PROCESS_INFOW,
    WTSCloseServer, WTSDisconnectSession, WTSEnumerateProcessesW,
    WTSEnumerateSessionsW, WTSFreeMemory, WTSLogoffSession,
    WTSOpenServerW, WTSQuerySessionInformationW,
    WTSSendMessageW, WTSShutdownSystem,
    WTSTerminateProcess, WTSConnectSessionW,
    WTSStartRemoteControlSessionW, WTSStopRemoteControlSession,
    WTS_INFO_CLASS, ProcessIdToSessionId, WTSWaitSystemEvent,
    WTSVirtualChannelOpen, WTSVirtualChannelClose,
    WTSVirtualChannelRead, WTSVirtualChannelWrite,
    WTSVirtualChannelPurgeInput, WTSVirtualChannelPurgeOutput,
    WTSQueryUserConfigW, WTSSetUserConfigW,
    WTS_CONFIG_CLASS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{MESSAGEBOX_STYLE, MESSAGEBOX_RESULT};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Special handle meaning the local RD Session Host server.
pub const WTS_CURRENT_SERVER: HANDLE = HANDLE(std::ptr::null_mut());
/// Special session ID meaning the calling session.
pub const WTS_CURRENT_SESSION: u32 = 0xFFFF_FFFF;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  State conversion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Convert the native `WTS_CONNECTSTATE_CLASS` to our `SessionState`.
pub fn convert_state(native: WTS_CONNECTSTATE_CLASS) -> SessionState {
    if native == WTSActive {
        SessionState::Active
    } else if native == WTSConnected {
        SessionState::Connected
    } else if native == WTSConnectQuery {
        SessionState::ConnectQuery
    } else if native == WTSShadow {
        SessionState::Shadow
    } else if native == WTSDisconnected {
        SessionState::Disconnected
    } else if native == WTSIdle {
        SessionState::Idle
    } else if native == WTSListen {
        SessionState::Listen
    } else if native == WTSReset {
        SessionState::Reset
    } else if native == WTSDown {
        SessionState::Down
    } else if native == WTSInit {
        SessionState::Init
    } else {
        SessionState::Unknown
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Encode a Rust string as a null-terminated wide string.
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0u16)).collect()
}

/// Decode a null-terminated wide string pointer to a Rust String.
///
/// # Safety
/// `ptr` must be a valid, null-terminated UTF-16 string pointer.
unsafe fn from_wide_ptr(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    OsString::from_wide(slice).to_string_lossy().into_owned()
}

/// Read a DWORD from a raw buffer.
///
/// # Safety
/// `buf` must point to at least 4 valid bytes.
unsafe fn read_u32(buf: *mut u8) -> u32 {
    *(buf as *const u32)
}

/// Read a USHORT from a raw buffer.
///
/// # Safety
/// `buf` must point to at least 2 valid bytes.
unsafe fn read_u16(buf: *mut u8) -> u16 {
    *(buf as *const u16)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Server management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Open a handle to a remote RD Session Host server.
pub fn open_server(server_name: &str) -> TsResult<HANDLE> {
    let wide = to_wide(server_name);
    // SAFETY: WTSOpenServerW expects a PCWSTR; our wide vec is null-terminated.
    let handle = unsafe { WTSOpenServerW(PCWSTR(wide.as_ptr())) };
    if handle.is_invalid() || handle.0.is_null() {
        return Err(TsError::win32(&format!("WTSOpenServerW({})", server_name)));
    }
    debug!("Opened WTS server handle for {}", server_name);
    Ok(handle)
}

/// Close an open server handle.
pub fn close_server(handle: HANDLE) {
    if handle != WTS_CURRENT_SERVER && !handle.is_invalid() {
        // SAFETY: only called with a valid handle returned by open_server.
        unsafe { WTSCloseServer(handle) };
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session enumeration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Enumerate all sessions on the given server.
pub fn enumerate_sessions(server: HANDLE) -> TsResult<Vec<SessionEntry>> {
    let mut info_ptr: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
    let mut count: u32 = 0;

    // SAFETY: WTSEnumerateSessionsW fills info_ptr/count; we free with WTSFreeMemory.
    unsafe {
        WTSEnumerateSessionsW(server, 0, 1, &mut info_ptr, &mut count)
    }.map_err(|e| TsError::new(TsErrorKind::Win32Error(e.code().0 as u32), "WTSEnumerateSessionsW"))?;

    let mut sessions = Vec::with_capacity(count as usize);
    for i in 0..count as usize {
        // SAFETY: info_ptr points to `count` contiguous WTS_SESSION_INFOW structs.
        let raw = unsafe { &*info_ptr.add(i) };
        let name = unsafe { from_wide_ptr(raw.pWinStationName.0) };
        sessions.push(SessionEntry {
            session_id: raw.SessionId,
            win_station_name: name,
            state: convert_state(raw.State),
        });
    }

    // SAFETY: freeing the buffer allocated by WTSEnumerateSessionsW.
    unsafe { WTSFreeMemory(info_ptr as *mut _) };
    Ok(sessions)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session query helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// WTS_INFO_CLASS numeric constants.
const WTS_INITIAL_PROGRAM: WTS_INFO_CLASS  = WTS_INFO_CLASS(0);
const WTS_APPLICATION_NAME: WTS_INFO_CLASS = WTS_INFO_CLASS(1);
const WTS_WORKING_DIRECTORY: WTS_INFO_CLASS = WTS_INFO_CLASS(2);
const WTS_USER_NAME: WTS_INFO_CLASS        = WTS_INFO_CLASS(5);
const WTS_WINSTATION_NAME: WTS_INFO_CLASS  = WTS_INFO_CLASS(6);
const WTS_DOMAIN_NAME: WTS_INFO_CLASS      = WTS_INFO_CLASS(7);
const WTS_CONNECT_STATE: WTS_INFO_CLASS    = WTS_INFO_CLASS(8);
const WTS_CLIENT_BUILD_NUMBER: WTS_INFO_CLASS = WTS_INFO_CLASS(9);
const WTS_CLIENT_NAME: WTS_INFO_CLASS      = WTS_INFO_CLASS(10);
const WTS_CLIENT_DIRECTORY: WTS_INFO_CLASS = WTS_INFO_CLASS(11);
const WTS_CLIENT_PRODUCT_ID: WTS_INFO_CLASS = WTS_INFO_CLASS(12);
const WTS_CLIENT_HARDWARE_ID: WTS_INFO_CLASS = WTS_INFO_CLASS(13);
const WTS_CLIENT_ADDRESS: WTS_INFO_CLASS   = WTS_INFO_CLASS(14);
const WTS_CLIENT_DISPLAY: WTS_INFO_CLASS   = WTS_INFO_CLASS(15);
const WTS_CLIENT_PROTOCOL_TYPE: WTS_INFO_CLASS = WTS_INFO_CLASS(16);
const WTS_SESSION_INFO: WTS_INFO_CLASS     = WTS_INFO_CLASS(24);
const WTS_IS_REMOTE_SESSION: WTS_INFO_CLASS = WTS_INFO_CLASS(29);

/// Query a raw buffer from a session, returning the pointer and byte count.
/// Caller must free the buffer with WTSFreeMemory.
fn query_session_raw(
    server: HANDLE,
    session_id: u32,
    info_class: WTS_INFO_CLASS,
) -> Option<(*mut u8, u32)> {
    let mut buf = windows::core::PWSTR::null();
    let mut bytes: u32 = 0;

    let result = unsafe {
        WTSQuerySessionInformationW(
            server,
            session_id,
            info_class,
            &mut buf,
            &mut bytes,
        )
    };

    if result.is_err() || buf.is_null() {
        return None;
    }

    Some((buf.as_ptr() as *mut u8, bytes))
}

/// Query a string property from a session.
fn query_session_string(
    server: HANDLE,
    session_id: u32,
    info_class: WTS_INFO_CLASS,
) -> String {
    let Some((buf, _bytes)) = query_session_raw(server, session_id, info_class) else {
        return String::new();
    };

    let result = unsafe { from_wide_ptr(buf as *const u16) };
    unsafe { WTSFreeMemory(buf as *mut _) };
    result
}

/// Query a u32 property from a session.
fn query_session_u32(
    server: HANDLE,
    session_id: u32,
    info_class: WTS_INFO_CLASS,
) -> u32 {
    let Some((buf, bytes)) = query_session_raw(server, session_id, info_class) else {
        return 0;
    };

    let val = if bytes >= 4 { unsafe { read_u32(buf) } } else { 0 };
    unsafe { WTSFreeMemory(buf as *mut _) };
    val
}

/// Query a u16 property from a session.
fn query_session_u16(
    server: HANDLE,
    session_id: u32,
    info_class: WTS_INFO_CLASS,
) -> u16 {
    let Some((buf, bytes)) = query_session_raw(server, session_id, info_class) else {
        return 0;
    };

    let val = if bytes >= 2 { unsafe { read_u16(buf) } } else { 0 };
    unsafe { WTSFreeMemory(buf as *mut _) };
    val
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Detailed session query
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse the WTS_CLIENT_ADDRESS buffer to an IP string.
fn parse_client_address(server: HANDLE, session_id: u32) -> (String, String) {
    let Some((buf, _bytes)) = query_session_raw(server, session_id, WTS_CLIENT_ADDRESS) else {
        return (String::new(), String::new());
    };

    // WTS_CLIENT_ADDRESS: { DWORD AddressFamily; BYTE Address[20]; }
    let addr_family = unsafe { read_u32(buf) };
    let family_str = match addr_family {
        2 => "AF_INET",
        23 => "AF_INET6",
        _ => "Unknown",
    };

    let ip = if addr_family == 2 {
        // IPv4: Address bytes at offset 2 within the Address[20] array
        let base = unsafe { buf.add(4) }; // skip AddressFamily
        let a = unsafe { *base.add(2) };
        let b = unsafe { *base.add(3) };
        let c = unsafe { *base.add(4) };
        let d = unsafe { *base.add(5) };
        format!("{}.{}.{}.{}", a, b, c, d)
    } else if addr_family == 23 {
        // IPv6: 16 bytes raw
        let base = unsafe { buf.add(4) };
        let mut parts = Vec::new();
        for i in (0..16).step_by(2) {
            let hi = unsafe { *base.add(i) };
            let lo = unsafe { *base.add(i + 1) };
            parts.push(format!("{:02x}{:02x}", hi, lo));
        }
        parts.join(":")
    } else {
        String::new()
    };

    unsafe { WTSFreeMemory(buf as *mut _) };
    (ip, family_str.to_string())
}

/// Parse the WTS_CLIENT_DISPLAY buffer.
fn parse_client_display(server: HANDLE, session_id: u32) -> (u16, u16, u16) {
    let Some((buf, _bytes)) = query_session_raw(server, session_id, WTS_CLIENT_DISPLAY) else {
        return (0, 0, 0);
    };

    // WTS_CLIENT_DISPLAY: { DWORD HorizontalResolution; DWORD VerticalResolution; DWORD ColorDepth; }
    let w = unsafe { read_u32(buf) } as u16;
    let h = unsafe { read_u32(buf.add(4)) } as u16;
    let cd = unsafe { read_u32(buf.add(8)) } as u16;

    unsafe { WTSFreeMemory(buf as *mut _) };
    (w, h, cd)
}

/// Internal struct for timing/traffic data from WTSINFO.
pub struct SessionInfoTimingData {
    pub state: SessionState,
    pub incoming_bytes: u32,
    pub outgoing_bytes: u32,
    pub incoming_frames: u32,
    pub outgoing_frames: u32,
    pub incoming_compressed_bytes: u32,
    pub outgoing_compressed_bytes: u32,
    pub connect_time: Option<chrono::DateTime<chrono::Utc>>,
    pub disconnect_time: Option<chrono::DateTime<chrono::Utc>>,
    pub last_input_time: Option<chrono::DateTime<chrono::Utc>>,
    pub logon_time: Option<chrono::DateTime<chrono::Utc>>,
    pub current_time: Option<chrono::DateTime<chrono::Utc>>,
}

/// Parse the WTSINFO structure (WTSSessionInfo).
fn parse_session_info(
    server: HANDLE,
    session_id: u32,
) -> Option<SessionInfoTimingData> {
    let Some((buf, _bytes)) = query_session_raw(server, session_id, WTS_SESSION_INFO) else {
        return None;
    };

    // WTSINFOW layout (Unicode):
    //  0: WTS_CONNECTSTATE_CLASS State (4 bytes)
    //  4: DWORD SessionId
    //  8: DWORD IncomingBytes
    // 12: DWORD OutgoingBytes
    // 16: DWORD IncomingFrames
    // 20: DWORD OutgoingFrames
    // 24: DWORD IncomingCompressedBytes
    // 28: DWORD OutgoingCompressedBytes
    // 32: WCHAR WinStationName[WINSTATIONNAME_LENGTH=32] = 64 bytes → 32..96
    // 96: WCHAR Domain[DOMAIN_LENGTH=17+1] ≈ 36 bytes → 96..132
    // 132: WCHAR UserName[USERNAME_LENGTH+1=21] = 42 bytes → 132..174
    // 174: 2 bytes padding → 176
    // 176: LARGE_INTEGER ConnectTime
    // 184: LARGE_INTEGER DisconnectTime
    // 192: LARGE_INTEGER LastInputTime
    // 200: LARGE_INTEGER LogonTime
    // 208: LARGE_INTEGER CurrentTime

    let state = unsafe { read_u32(buf) };
    let incoming_bytes = unsafe { read_u32(buf.add(8)) };
    let outgoing_bytes = unsafe { read_u32(buf.add(12)) };
    let incoming_frames = unsafe { read_u32(buf.add(16)) };
    let outgoing_frames = unsafe { read_u32(buf.add(20)) };
    let incoming_compressed_bytes = unsafe { read_u32(buf.add(24)) };
    let outgoing_compressed_bytes = unsafe { read_u32(buf.add(28)) };

    let connect_time = unsafe { *(buf.add(176) as *const i64) };
    let disconnect_time = unsafe { *(buf.add(184) as *const i64) };
    let last_input_time = unsafe { *(buf.add(192) as *const i64) };
    let logon_time = unsafe { *(buf.add(200) as *const i64) };
    let current_time = unsafe { *(buf.add(208) as *const i64) };

    unsafe { WTSFreeMemory(buf as *mut _) };

    Some(SessionInfoTimingData {
        state: convert_state(WTS_CONNECTSTATE_CLASS(state as i32)),
        incoming_bytes,
        outgoing_bytes,
        incoming_frames,
        outgoing_frames,
        incoming_compressed_bytes,
        outgoing_compressed_bytes,
        connect_time: filetime_to_datetime(connect_time),
        disconnect_time: filetime_to_datetime(disconnect_time),
        last_input_time: filetime_to_datetime(last_input_time),
        logon_time: filetime_to_datetime(logon_time),
        current_time: filetime_to_datetime(current_time),
    })
}

/// Convert a Windows FILETIME (100ns since 1601-01-01) to chrono DateTime.
/// Returns None if the value is zero (meaning "not set").
fn filetime_to_datetime(ft: i64) -> Option<chrono::DateTime<chrono::Utc>> {
    if ft <= 0 {
        return None;
    }
    // Windows epoch is 1601-01-01, Unix epoch is 1970-01-01.
    // Difference: 11644473600 seconds = 116444736000000000 in 100ns units.
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
    let unix_100ns = ft - EPOCH_DIFF;
    if unix_100ns < 0 {
        return None;
    }
    let secs = unix_100ns / 10_000_000;
    let nanos = ((unix_100ns % 10_000_000) * 100) as u32;
    chrono::DateTime::from_timestamp(secs, nanos)
}

/// Build a full `SessionDetail` for one session by querying multiple info classes.
pub fn query_session_detail(server: HANDLE, session_id: u32) -> TsResult<SessionDetail> {
    let mut detail = SessionDetail {
        session_id,
        ..Default::default()
    };

    // String properties
    detail.user_name = query_session_string(server, session_id, WTS_USER_NAME);
    detail.domain_name = query_session_string(server, session_id, WTS_DOMAIN_NAME);
    detail.win_station_name = query_session_string(server, session_id, WTS_WINSTATION_NAME);
    detail.client_name = query_session_string(server, session_id, WTS_CLIENT_NAME);
    detail.client_directory = query_session_string(server, session_id, WTS_CLIENT_DIRECTORY);
    detail.initial_program = query_session_string(server, session_id, WTS_INITIAL_PROGRAM);
    detail.application_name = query_session_string(server, session_id, WTS_APPLICATION_NAME);
    detail.working_directory = query_session_string(server, session_id, WTS_WORKING_DIRECTORY);

    // Numeric properties
    detail.client_build_number = query_session_u32(server, session_id, WTS_CLIENT_BUILD_NUMBER);
    detail.client_hardware_id = query_session_u32(server, session_id, WTS_CLIENT_HARDWARE_ID);
    detail.client_product_id = query_session_u16(server, session_id, WTS_CLIENT_PRODUCT_ID);
    let proto = query_session_u16(server, session_id, WTS_CLIENT_PROTOCOL_TYPE);
    detail.client_protocol_type = ClientProtocol::from_u16(proto);

    // Connection state
    let state = query_session_u32(server, session_id, WTS_CONNECT_STATE);
    detail.state = convert_state(WTS_CONNECTSTATE_CLASS(state as i32));

    // Client address
    let (addr, family) = parse_client_address(server, session_id);
    detail.client_address = addr;
    detail.client_address_family = family;

    // Client display
    let (w, h, cd) = parse_client_display(server, session_id);
    detail.client_display_width = w;
    detail.client_display_height = h;
    detail.client_display_color_depth = cd;

    // Timing & traffic from WTSINFO
    if let Some(timing) = parse_session_info(server, session_id) {
        detail.state = timing.state;
        detail.incoming_bytes = timing.incoming_bytes;
        detail.outgoing_bytes = timing.outgoing_bytes;
        detail.incoming_frames = timing.incoming_frames;
        detail.outgoing_frames = timing.outgoing_frames;
        detail.incoming_compressed_bytes = timing.incoming_compressed_bytes;
        detail.outgoing_compressed_bytes = timing.outgoing_compressed_bytes;
        detail.connect_time = timing.connect_time;
        detail.disconnect_time = timing.disconnect_time;
        detail.last_input_time = timing.last_input_time;
        detail.logon_time = timing.logon_time;
        detail.current_time = timing.current_time;
    }

    // Is remote session?
    let is_remote = query_session_u32(server, session_id, WTS_IS_REMOTE_SESSION);
    detail.is_remote_session = is_remote != 0;

    Ok(detail)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Process enumeration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Enumerate all processes on the RD Session Host server.
pub fn enumerate_processes(server: HANDLE) -> TsResult<Vec<TsProcessInfo>> {
    let mut info_ptr: *mut WTS_PROCESS_INFOW = std::ptr::null_mut();
    let mut count: u32 = 0;

    unsafe {
        WTSEnumerateProcessesW(server, 0, 1, &mut info_ptr, &mut count)
    }.map_err(|e| TsError::new(TsErrorKind::Win32Error(e.code().0 as u32), "WTSEnumerateProcessesW"))?;

    let mut procs = Vec::with_capacity(count as usize);
    for i in 0..count as usize {
        let raw = unsafe { &*info_ptr.add(i) };
        let name = unsafe { from_wide_ptr(raw.pProcessName.0) };
        let sid_str = sid_to_string(raw.pUserSid);
        procs.push(TsProcessInfo {
            session_id: raw.SessionId,
            process_id: raw.ProcessId,
            process_name: name,
            user_sid: sid_str,
            user_name: String::new(), // Resolved later if needed
        });
    }

    unsafe { WTSFreeMemory(info_ptr as *mut _) };
    Ok(procs)
}

/// Convert a PSID to a string like "S-1-5-21-...".
fn sid_to_string(psid: PSID) -> String {
    if psid.0.is_null() {
        return String::new();
    }
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    let mut str_ptr = windows::core::PWSTR::null();
    let result = unsafe {
        ConvertSidToStringSidW(psid, &mut str_ptr)
    };
    if result.is_err() || str_ptr.is_null() {
        return String::new();
    }
    let s = unsafe { from_wide_ptr(str_ptr.0) };
    // Free with LocalFree
    unsafe {
        let _ = LocalFree(HLOCAL(str_ptr.0 as *mut _));
    };
    s
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Disconnect a session (user stays logged on, session goes to Disconnected state).
pub fn disconnect_session(server: HANDLE, session_id: u32, wait: bool) -> TsResult<()> {
    unsafe {
        WTSDisconnectSession(server, session_id, wait)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSDisconnectSession({})", session_id),
    ))?;
    debug!("Disconnected session {}", session_id);
    Ok(())
}

/// Log off a session (user's processes are terminated).
pub fn logoff_session(server: HANDLE, session_id: u32, wait: bool) -> TsResult<()> {
    unsafe {
        WTSLogoffSession(server, session_id, wait)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSLogoffSession({})", session_id),
    ))?;
    debug!("Logged off session {}", session_id);
    Ok(())
}

/// Terminate a process by PID.
pub fn terminate_process(server: HANDLE, process_id: u32, exit_code: u32) -> TsResult<()> {
    unsafe {
        WTSTerminateProcess(server, process_id, exit_code)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSTerminateProcess({})", process_id),
    ))?;
    debug!("Terminated process {}", process_id);
    Ok(())
}

/// Connect a session to another session (used to transfer a disconnected session
/// to the current console or another session).
pub fn connect_session(
    logon_id: u32,
    target_logon_id: u32,
    password: &str,
    wait: bool,
) -> TsResult<()> {
    let wide_pass = to_wide(password);
    unsafe {
        WTSConnectSessionW(logon_id, target_logon_id, PCWSTR(wide_pass.as_ptr()), wait)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSConnectSession({} -> {})", logon_id, target_logon_id),
    ))?;
    debug!("Connected session {} to target {}", logon_id, target_logon_id);
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Send a message box to a session's desktop.
pub fn send_message(
    server: HANDLE,
    session_id: u32,
    title: &str,
    message: &str,
    style: u32,
    timeout_seconds: u32,
    wait: bool,
) -> TsResult<MessageResponse> {
    let wide_title = to_wide(title);
    let wide_msg = to_wide(message);
    let mut response = MESSAGEBOX_RESULT(0);

    unsafe {
        WTSSendMessageW(
            server,
            session_id,
            PCWSTR(wide_title.as_ptr()),
            (wide_title.len() as u32) * 2, // byte count
            PCWSTR(wide_msg.as_ptr()),
            (wide_msg.len() as u32) * 2,
            MESSAGEBOX_STYLE(style),
            timeout_seconds,
            &mut response,
            wait,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSSendMessageW(session {})", session_id),
    ))?;

    Ok(MessageResponse::from_u32(response.0 as u32))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Shadow / Remote control
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Start remote control (shadow) of another session.
pub fn start_remote_control(opts: &ShadowOptions) -> TsResult<()> {
    unsafe {
        WTSStartRemoteControlSessionW(
            PCWSTR::null(), // NULL = local server
            opts.target_session_id,
            opts.hotkey_vk,
            opts.hotkey_modifier,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSStartRemoteControlSession(session {})", opts.target_session_id),
    ))?;
    debug!("Started shadow of session {}", opts.target_session_id);
    Ok(())
}

/// Stop remote control of a session.
pub fn stop_remote_control(session_id: u32) -> TsResult<()> {
    unsafe {
        WTSStopRemoteControlSession(session_id)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSStopRemoteControlSession({})", session_id),
    ))?;
    debug!("Stopped shadow of session {}", session_id);
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Server shutdown
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Shut down (and optionally restart) the RD Session Host server.
pub fn shutdown_system(server: HANDLE, flags: u32) -> TsResult<()> {
    unsafe {
        WTSShutdownSystem(server, flags)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSShutdownSystem",
    ))?;
    debug!("Shutdown initiated with flags 0x{:X}", flags);
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Console session
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Get the session ID of the physical console session.
pub fn get_console_session_id() -> u32 {
    // SAFETY: always safe, no parameters, returns DWORD.
    unsafe {
        windows::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId()
    }
}

/// Get the session ID of the current process.
pub fn get_current_session_id() -> u32 {
    let pid = unsafe { GetCurrentProcessId() };
    let mut session_id: u32 = 0;
    let result = unsafe {
        ProcessIdToSessionId(pid, &mut session_id)
    };
    if result.is_ok() {
        session_id
    } else {
        warn!("ProcessIdToSessionId failed, returning 0");
        0
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Server enumeration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Enumerate all RD Session Host servers in a domain.
/// If domain is empty, uses the current domain.
pub fn enumerate_servers(domain: &str) -> TsResult<Vec<TsServerInfo>> {
    use windows::Win32::System::RemoteDesktop::{
        WTSEnumerateServersW, WTS_SERVER_INFOW,
    };

    let wide_domain: Vec<u16>;
    let domain_ptr = if domain.is_empty() {
        PCWSTR::null()
    } else {
        wide_domain = to_wide(domain);
        PCWSTR(wide_domain.as_ptr())
    };

    let mut info_ptr: *mut WTS_SERVER_INFOW = std::ptr::null_mut();
    let mut count: u32 = 0;

    let result = unsafe {
        WTSEnumerateServersW(domain_ptr, 0, 1, &mut info_ptr, &mut count)
    };

    if result.is_err() {
        // Not an error if there are simply no servers.
        let err = unsafe { GetLastError() };
        if err.0 == 0 || count == 0 {
            return Ok(Vec::new());
        }
        return Err(TsError::win32("WTSEnumerateServersW"));
    }

    let mut servers = Vec::with_capacity(count as usize);
    for i in 0..count as usize {
        let raw = unsafe { &*info_ptr.add(i) };
        let name = unsafe { from_wide_ptr(raw.pServerName.0) };
        servers.push(TsServerInfo { server_name: name });
    }

    unsafe { WTSFreeMemory(info_ptr as *mut _) };
    Ok(servers)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Listener enumeration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Enumerate all RDS listeners on the server.
pub fn enumerate_listeners(server: HANDLE) -> TsResult<Vec<TsListenerInfo>> {
    use windows::Win32::System::RemoteDesktop::WTSEnumerateListenersW;

    // First call to get count
    let mut count: u32 = 0;
    let _ = unsafe {
        WTSEnumerateListenersW(server, std::ptr::null(), 0, None, &mut count)
    };

    if count == 0 {
        return Ok(Vec::new());
    }

    // Each listener name is an array of pointers to WCHAR[256] blocks.
    const NAME_LEN: usize = 256;
    let mut buf: Vec<u16> = vec![0u16; (count as usize) * NAME_LEN];

    let result = unsafe {
        WTSEnumerateListenersW(
            server,
            std::ptr::null(),
            0,
            Some(buf.as_mut_ptr() as *mut _),
            &mut count,
        )
    };

    if result.is_err() {
        return Err(TsError::win32("WTSEnumerateListenersW"));
    }

    let mut listeners = Vec::new();
    for i in 0..count as usize {
        let offset = i * NAME_LEN;
        let slice = &buf[offset..offset + NAME_LEN];
        let end = slice.iter().position(|&c| c == 0).unwrap_or(NAME_LEN);
        let name = OsString::from_wide(&slice[..end])
            .to_string_lossy()
            .into_owned();
        if !name.is_empty() {
            listeners.push(TsListenerInfo { name });
        }
    }

    Ok(listeners)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  System event waiting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// WTS_EVENT flag constants.
pub const WTS_EVENT_NONE: u32       = 0x0000_0000;
pub const WTS_EVENT_CREATE: u32     = 0x0000_0001;
pub const WTS_EVENT_DELETE: u32     = 0x0000_0002;
pub const WTS_EVENT_RENAME: u32     = 0x0000_0004;
pub const WTS_EVENT_CONNECT: u32    = 0x0000_0008;
pub const WTS_EVENT_DISCONNECT: u32 = 0x0000_0010;
pub const WTS_EVENT_LOGON: u32      = 0x0000_0020;
pub const WTS_EVENT_LOGOFF: u32     = 0x0000_0040;
pub const WTS_EVENT_STATECHANGE: u32 = 0x0000_0080;
pub const WTS_EVENT_LICENSE: u32    = 0x0000_0100;
pub const WTS_EVENT_ALL: u32        = 0x7FFF_FFFF;
pub const WTS_EVENT_FLUSH: u32      = 0x8000_0000;

/// Wait for a Terminal Services system event (blocking).
///
/// Returns a bitmask of the event(s) that occurred.
/// Passing `WTS_EVENT_FLUSH` as the mask will cause any pending wait
/// on the same server handle to return immediately.
pub fn wait_system_event(server: HANDLE, event_mask: u32) -> TsResult<u32> {
    let mut event_flags: u32 = 0;
    // SAFETY: WTSWaitSystemEvent blocks until an event matches event_mask.
    unsafe {
        WTSWaitSystemEvent(server, event_mask, &mut event_flags)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSWaitSystemEvent",
    ))?;
    Ok(event_flags)
}

/// Decode an event flags bitmask into a list of `TsEventMask` values.
pub fn decode_event_flags(flags: u32) -> Vec<TsEventMask> {
    let mut events = Vec::new();
    if flags & WTS_EVENT_CREATE != 0 { events.push(TsEventMask::Creation); }
    if flags & WTS_EVENT_DELETE != 0 { events.push(TsEventMask::Deletion); }
    if flags & WTS_EVENT_RENAME != 0 { events.push(TsEventMask::Rename); }
    if flags & WTS_EVENT_CONNECT != 0 { events.push(TsEventMask::Connect); }
    if flags & WTS_EVENT_DISCONNECT != 0 { events.push(TsEventMask::Disconnect); }
    if flags & WTS_EVENT_LOGON != 0 { events.push(TsEventMask::Logon); }
    if flags & WTS_EVENT_LOGOFF != 0 { events.push(TsEventMask::Logoff); }
    if flags & WTS_EVENT_STATECHANGE != 0 { events.push(TsEventMask::StateChange); }
    if flags & WTS_EVENT_LICENSE != 0 { events.push(TsEventMask::License); }
    events
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Virtual channel management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Opaque handle to an open virtual channel.
pub type VirtualChannelHandle = HANDLE;

/// Open a virtual channel on a session.
pub fn virtual_channel_open(
    server: HANDLE,
    session_id: u32,
    channel_name: &str,
) -> TsResult<VirtualChannelHandle> {
    // WTSVirtualChannelOpen expects a PCSTR (8-bit). The channel name is ASCII.
    let c_name = std::ffi::CString::new(channel_name).map_err(|_| {
        TsError::new(TsErrorKind::InvalidParameter, "Channel name contains null byte")
    })?;
    let handle = unsafe {
        WTSVirtualChannelOpen(server, session_id, windows::core::PCSTR(c_name.as_ptr() as *const u8))
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSVirtualChannelOpen(session {}, channel '{}')", session_id, channel_name),
    ))?;
    if handle.is_invalid() {
        return Err(TsError::win32(&format!(
            "WTSVirtualChannelOpen returned invalid handle (session {}, channel '{}')",
            session_id, channel_name
        )));
    }
    debug!("Opened virtual channel '{}' on session {}", channel_name, session_id);
    Ok(handle)
}

/// Close a virtual channel handle.
pub fn virtual_channel_close(handle: VirtualChannelHandle) -> TsResult<()> {
    unsafe {
        WTSVirtualChannelClose(handle)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSVirtualChannelClose",
    ))?;
    Ok(())
}

/// Read data from a virtual channel.
/// Returns the bytes read. Blocks until data is available or the channel is closed.
pub fn virtual_channel_read(
    handle: VirtualChannelHandle,
    timeout_ms: u32,
    max_bytes: usize,
) -> TsResult<Vec<u8>> {
    let mut buffer = vec![0u8; max_bytes];
    let mut bytes_read: u32 = 0;
    unsafe {
        WTSVirtualChannelRead(
            handle,
            timeout_ms,
            &mut buffer,
            &mut bytes_read,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSVirtualChannelRead",
    ))?;
    buffer.truncate(bytes_read as usize);
    Ok(buffer)
}

/// Write data to a virtual channel.
pub fn virtual_channel_write(
    handle: VirtualChannelHandle,
    data: &[u8],
) -> TsResult<u32> {
    let mut bytes_written: u32 = 0;
    unsafe {
        WTSVirtualChannelWrite(
            handle,
            data,
            &mut bytes_written,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSVirtualChannelWrite",
    ))?;
    Ok(bytes_written)
}

/// Purge all queued input on a virtual channel.
pub fn virtual_channel_purge_input(handle: VirtualChannelHandle) -> TsResult<()> {
    unsafe {
        WTSVirtualChannelPurgeInput(handle)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSVirtualChannelPurgeInput",
    ))?;
    Ok(())
}

/// Purge all queued output on a virtual channel.
pub fn virtual_channel_purge_output(handle: VirtualChannelHandle) -> TsResult<()> {
    unsafe {
        WTSVirtualChannelPurgeOutput(handle)
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        "WTSVirtualChannelPurgeOutput",
    ))?;
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  User configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// WTS_CONFIG_CLASS values (some reserved for future use).
const WTS_CFGCLASS_INITIAL_PROGRAM: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(0);
const WTS_CFGCLASS_WORKING_DIRECTORY: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(1);
const WTS_CFGCLASS_INHERIT_INITIAL_PROGRAM: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(2);
const WTS_CFGCLASS_ALLOW_LOGON: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(3);
const WTS_CFGCLASS_TIMEOUT_DISCONNECT: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(4);
const WTS_CFGCLASS_TIMEOUT_CONNECTION: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(5);
const WTS_CFGCLASS_TIMEOUT_IDLE: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(6);
#[allow(dead_code)]
const WTS_CFGCLASS_CONNECT_CLIENT_DRIVES: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(7);
#[allow(dead_code)]
const WTS_CFGCLASS_CONNECT_PRINTERS: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(8);
#[allow(dead_code)]
const WTS_CFGCLASS_DEFAULT_PRINTER: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(9);
const WTS_CFGCLASS_BROKEN_DISCONNECT: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(10);
const WTS_CFGCLASS_RECONNECT_SAME: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(11);
#[allow(dead_code)]
const WTS_CFGCLASS_MODEM_CALLBACK: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(12);
#[allow(dead_code)]
const WTS_CFGCLASS_SHADOW: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(13);
const WTS_CFGCLASS_TS_PROFILE_PATH: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(14);
const WTS_CFGCLASS_TS_HOME_DIR: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(15);
const WTS_CFGCLASS_TS_HOME_DRIVE: WTS_CONFIG_CLASS = WTS_CONFIG_CLASS(16);

/// Helper to query a string user config value.
fn query_user_config_string(
    server: &str,
    user: &str,
    class: WTS_CONFIG_CLASS,
) -> TsResult<String> {
    let wide_server = to_wide(server);
    let wide_user = to_wide(user);
    let mut buf = windows::core::PWSTR::null();
    let mut bytes: u32 = 0;

    unsafe {
        WTSQueryUserConfigW(
            PCWSTR(wide_server.as_ptr()),
            PCWSTR(wide_user.as_ptr()),
            class,
            &mut buf,
            &mut bytes,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSQueryUserConfigW(class {:?})", class.0),
    ))?;

    let result = if buf.is_null() {
        String::new()
    } else {
        let s = unsafe { from_wide_ptr(buf.as_ptr()) };
        unsafe { WTSFreeMemory(buf.as_ptr() as *mut _) };
        s
    };
    Ok(result)
}

/// Helper to query a u32 user config value.
fn query_user_config_u32(
    server: &str,
    user: &str,
    class: WTS_CONFIG_CLASS,
) -> TsResult<u32> {
    let wide_server = to_wide(server);
    let wide_user = to_wide(user);
    let mut buf = windows::core::PWSTR::null();
    let mut bytes: u32 = 0;

    unsafe {
        WTSQueryUserConfigW(
            PCWSTR(wide_server.as_ptr()),
            PCWSTR(wide_user.as_ptr()),
            class,
            &mut buf,
            &mut bytes,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSQueryUserConfigW(class {:?})", class.0),
    ))?;

    let val = if buf.is_null() || bytes < 4 {
        0u32
    } else {
        let v = unsafe { read_u32(buf.as_ptr() as *mut u8) };
        unsafe { WTSFreeMemory(buf.as_ptr() as *mut _) };
        v
    };
    Ok(val)
}

/// Query full Terminal Services user configuration.
pub fn query_user_config(server: &str, user: &str) -> TsResult<TsUserConfig> {
    let initial_program = query_user_config_string(server, user, WTS_CFGCLASS_INITIAL_PROGRAM)
        .unwrap_or_default();
    let working_directory = query_user_config_string(server, user, WTS_CFGCLASS_WORKING_DIRECTORY)
        .unwrap_or_default();
    let inherit_initial_program = query_user_config_u32(server, user, WTS_CFGCLASS_INHERIT_INITIAL_PROGRAM)
        .unwrap_or(1) != 0;
    let allow_logon = query_user_config_u32(server, user, WTS_CFGCLASS_ALLOW_LOGON)
        .unwrap_or(1) != 0;
    let max_disconnection_time = query_user_config_u32(server, user, WTS_CFGCLASS_TIMEOUT_DISCONNECT)
        .unwrap_or(0);
    let max_connection_time = query_user_config_u32(server, user, WTS_CFGCLASS_TIMEOUT_CONNECTION)
        .unwrap_or(0);
    let max_idle_time = query_user_config_u32(server, user, WTS_CFGCLASS_TIMEOUT_IDLE)
        .unwrap_or(0);
    let broken_connection_action_reset = query_user_config_u32(server, user, WTS_CFGCLASS_BROKEN_DISCONNECT)
        .unwrap_or(0) != 0;
    let reconnect_same_client = query_user_config_u32(server, user, WTS_CFGCLASS_RECONNECT_SAME)
        .unwrap_or(0) != 0;
    let ts_profile_path = query_user_config_string(server, user, WTS_CFGCLASS_TS_PROFILE_PATH)
        .unwrap_or_default();
    let ts_home_dir = query_user_config_string(server, user, WTS_CFGCLASS_TS_HOME_DIR)
        .unwrap_or_default();
    let ts_home_drive = query_user_config_string(server, user, WTS_CFGCLASS_TS_HOME_DRIVE)
        .unwrap_or_default();

    Ok(TsUserConfig {
        user_name: user.to_string(),
        server_name: server.to_string(),
        initial_program,
        working_directory,
        inherit_initial_program,
        allow_logon,
        max_disconnection_time,
        max_connection_time,
        max_idle_time,
        broken_connection_action_reset,
        reconnect_same_client,
        ts_profile_path,
        ts_home_dir,
        ts_home_drive,
    })
}

/// Helper to set a string user config value.
fn set_user_config_string(
    server: &str,
    user: &str,
    class: WTS_CONFIG_CLASS,
    value: &str,
) -> TsResult<()> {
    let wide_server = to_wide(server);
    let wide_user = to_wide(user);
    let wide_value = to_wide(value);
    let byte_len = (wide_value.len() * 2) as u32;

    unsafe {
        WTSSetUserConfigW(
            PCWSTR(wide_server.as_ptr()),
            PCWSTR(wide_user.as_ptr()),
            class,
            PCWSTR(wide_value.as_ptr()),
            byte_len,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSSetUserConfigW(class {:?})", class.0),
    ))?;
    Ok(())
}

/// Helper to set a u32 user config value.
fn set_user_config_u32(
    server: &str,
    user: &str,
    class: WTS_CONFIG_CLASS,
    value: u32,
) -> TsResult<()> {
    let wide_server = to_wide(server);
    let wide_user = to_wide(user);
    let bytes = value.to_le_bytes();

    unsafe {
        WTSSetUserConfigW(
            PCWSTR(wide_server.as_ptr()),
            PCWSTR(wide_user.as_ptr()),
            class,
            PCWSTR(bytes.as_ptr() as *const u16),
            4,
        )
    }.map_err(|e| TsError::new(
        TsErrorKind::Win32Error(e.code().0 as u32),
        &format!("WTSSetUserConfigW(class {:?})", class.0),
    ))?;
    Ok(())
}

/// Update a user's Terminal Services configuration.
/// Only non-empty / non-zero fields are written.
pub fn set_user_config(config: &TsUserConfig) -> TsResult<()> {
    let server = &config.server_name;
    let user = &config.user_name;

    if !config.initial_program.is_empty() {
        set_user_config_string(server, user, WTS_CFGCLASS_INITIAL_PROGRAM, &config.initial_program)?;
    }
    if !config.working_directory.is_empty() {
        set_user_config_string(server, user, WTS_CFGCLASS_WORKING_DIRECTORY, &config.working_directory)?;
    }
    set_user_config_u32(server, user, WTS_CFGCLASS_INHERIT_INITIAL_PROGRAM, config.inherit_initial_program as u32)?;
    set_user_config_u32(server, user, WTS_CFGCLASS_ALLOW_LOGON, config.allow_logon as u32)?;
    if config.max_disconnection_time > 0 {
        set_user_config_u32(server, user, WTS_CFGCLASS_TIMEOUT_DISCONNECT, config.max_disconnection_time)?;
    }
    if config.max_connection_time > 0 {
        set_user_config_u32(server, user, WTS_CFGCLASS_TIMEOUT_CONNECTION, config.max_connection_time)?;
    }
    if config.max_idle_time > 0 {
        set_user_config_u32(server, user, WTS_CFGCLASS_TIMEOUT_IDLE, config.max_idle_time)?;
    }
    set_user_config_u32(server, user, WTS_CFGCLASS_BROKEN_DISCONNECT, config.broken_connection_action_reset as u32)?;
    set_user_config_u32(server, user, WTS_CFGCLASS_RECONNECT_SAME, config.reconnect_same_client as u32)?;
    if !config.ts_profile_path.is_empty() {
        set_user_config_string(server, user, WTS_CFGCLASS_TS_PROFILE_PATH, &config.ts_profile_path)?;
    }
    if !config.ts_home_dir.is_empty() {
        set_user_config_string(server, user, WTS_CFGCLASS_TS_HOME_DIR, &config.ts_home_dir)?;
    }
    if !config.ts_home_drive.is_empty() {
        set_user_config_string(server, user, WTS_CFGCLASS_TS_HOME_DRIVE, &config.ts_home_drive)?;
    }

    debug!("Updated user config for {}\\{}", server, user);
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session address (WTSSessionAddressV4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// WTS_SESSION_ADDRESS info class (value 30 → 0x1E).
const WTS_SESSION_ADDRESS_V4: WTS_INFO_CLASS = WTS_INFO_CLASS(30);

/// Query the virtual IPv4 address assigned to a session, if any.
pub fn query_session_address_v4(server: HANDLE, session_id: u32) -> Option<String> {
    let Some((buf, bytes)) = query_session_raw(server, session_id, WTS_SESSION_ADDRESS_V4) else {
        return None;
    };
    if bytes < 8 {
        unsafe { WTSFreeMemory(buf as *mut _) };
        return None;
    }
    // WTS_SESSION_ADDRESS: { DWORD AddressFamily; BYTE Address[20]; }
    let family = unsafe { read_u32(buf) };
    let ip = if family == 2 {
        let base = unsafe { buf.add(4) };
        let a = unsafe { *base };
        let b = unsafe { *base.add(1) };
        let c = unsafe { *base.add(2) };
        let d = unsafe { *base.add(3) };
        if a == 0 && b == 0 && c == 0 && d == 0 {
            None
        } else {
            Some(format!("{}.{}.{}.{}", a, b, c, d))
        }
    } else {
        None
    };
    unsafe { WTSFreeMemory(buf as *mut _) };
    ip
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Encryption level query
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// WTSConfigInfo class (value 26).
const WTS_CONFIG_INFO: WTS_INFO_CLASS = WTS_INFO_CLASS(26);

/// Query the encryption level for a session.
/// Returns a tuple of (encryption_level, encryption_level_description).
pub fn query_encryption_level(server: HANDLE, session_id: u32) -> (u8, &'static str) {
    let Some((buf, bytes)) = query_session_raw(server, session_id, WTS_CONFIG_INFO) else {
        return (0, "Unknown");
    };

    // WTSCONFIGINFO has EncryptionLevel at offset 4 (DWORD)
    let level = if bytes >= 8 {
        (unsafe { read_u32(buf.add(4)) }) as u8
    } else {
        0
    };
    unsafe { WTSFreeMemory(buf as *mut _) };

    let desc = describe_encryption_level(level);
    (level, desc)
}

/// Human-readable encryption level description.
pub fn describe_encryption_level(level: u8) -> &'static str {
    match level {
        1 => "Low (56-bit)",
        2 => "Client Compatible",
        3 => "High (128-bit)",
        4 => "FIPS Compliant",
        _ => "Unknown",
    }
}
