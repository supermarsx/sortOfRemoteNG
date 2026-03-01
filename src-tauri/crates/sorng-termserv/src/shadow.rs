//! Shadow / Remote Control — start and stop shadowing another session.
//!
//! Remote control (shadowing) allows an administrator to view and optionally
//! interact with another user's session. The caller must be in a remote session
//! themselves (you cannot shadow from the physical console).
//!
//! # Requirements
//! - The calling session must be an RDP session (not the physical console).
//! - The caller must have Remote Control permission on the target session.
//! - The target user will be prompted to accept/deny unless Group Policy
//!   overrides this.

use crate::types::*;
use crate::wts_ffi;
use log::info;

/// Start remote control (shadow) of the target session.
///
/// The hot-key combination specified in `opts` will terminate the shadow
/// when pressed. The default is Ctrl+NumPad* (VK_MULTIPLY).
pub fn start_shadow(opts: &ShadowOptions) -> TsResult<()> {
    info!(
        "Starting shadow of session {} (control={})",
        opts.target_session_id, opts.control
    );
    wts_ffi::start_remote_control(opts)
}

/// Stop the remote control session on the specified session ID.
pub fn stop_shadow(session_id: u32) -> TsResult<()> {
    info!("Stopping shadow of session {}", session_id);
    wts_ffi::stop_remote_control(session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shadow_options_defaults_are_sane() {
        let opts = ShadowOptions::default();
        assert_eq!(opts.hotkey_vk, 0x6A);
        assert_eq!(opts.hotkey_modifier, 2);
        assert!(opts.control);
    }
}
