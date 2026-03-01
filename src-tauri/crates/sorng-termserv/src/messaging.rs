//! Messaging — send message boxes to session desktops.
//!
//! Uses `WTSSendMessageW` to display a Windows message box on the client
//! desktop of a specified session. This is the equivalent of the `msg.exe`
//! command-line tool.
//!
//! The message can be sent synchronously (blocks until the user responds or
//! timeout) or asynchronously (returns immediately).

use crate::types::*;
use crate::wts_ffi;
use log::info;
use windows::Win32::Foundation::HANDLE;

/// Send a message box to a session's desktop.
pub fn send_message(
    server: HANDLE,
    params: &SendMessageParams,
) -> TsResult<MessageResponse> {
    info!(
        "Sending message to session {}: title='{}', wait={}",
        params.session_id, params.title, params.wait
    );
    wts_ffi::send_message(
        server,
        params.session_id,
        &params.title,
        &params.message,
        params.style.to_u32(),
        params.timeout_seconds,
        params.wait,
    )
}

/// Send a quick informational message (OK button, no wait).
pub fn send_info(
    server: HANDLE,
    session_id: u32,
    title: &str,
    message: &str,
) -> TsResult<MessageResponse> {
    let params = SendMessageParams {
        session_id,
        title: title.to_string(),
        message: message.to_string(),
        style: MessageStyle::Ok,
        timeout_seconds: 0,
        wait: false,
    };
    send_message(server, &params)
}

/// Send a warning message to all active sessions on the server.
pub fn broadcast_message(
    server: HANDLE,
    title: &str,
    message: &str,
    timeout_seconds: u32,
) -> TsResult<u32> {
    let sessions = crate::wts_ffi::enumerate_sessions(server)?;
    let mut sent = 0u32;
    for s in &sessions {
        if matches!(s.state, SessionState::Active) {
            let params = SendMessageParams {
                session_id: s.session_id,
                title: title.to_string(),
                message: message.to_string(),
                style: MessageStyle::Ok,
                timeout_seconds,
                wait: false,
            };
            if send_message(server, &params).is_ok() {
                sent += 1;
            }
        }
    }
    info!("Broadcast message to {} sessions", sent);
    Ok(sent)
}

/// Send a Yes/No confirmation to a session and return the response.
pub fn send_confirmation(
    server: HANDLE,
    session_id: u32,
    title: &str,
    message: &str,
    timeout_seconds: u32,
) -> TsResult<MessageResponse> {
    let params = SendMessageParams {
        session_id,
        title: title.to_string(),
        message: message.to_string(),
        style: MessageStyle::YesNo,
        timeout_seconds,
        wait: true,
    };
    send_message(server, &params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_message_params_default_style() {
        let p = SendMessageParams {
            session_id: 1,
            title: "Test".to_string(),
            message: "Hello".to_string(),
            style: MessageStyle::Ok,
            timeout_seconds: 30,
            wait: false,
        };
        assert_eq!(p.style.to_u32(), 0);
    }
}
