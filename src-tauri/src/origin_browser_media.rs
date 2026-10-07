//! Owner-bound camera/microphone prompts. No unattended device grants.
use sorng_browser_host::native_media::{MediaPermissionCompletion, NativeMediaChallenge};
use sorng_commands_core::origin_browser_authority::NativeOwnerLease;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    time::Instant,
};
use tauri::WebviewWindow;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

struct PromptSlot(String);
fn slots() -> &'static Mutex<HashSet<String>> {
    static SLOTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SLOTS.get_or_init(Mutex::default)
}
impl PromptSlot {
    fn reserve(window: &WebviewWindow) -> Option<Self> {
        slots()
            .lock()
            .ok()?
            .insert(window.label().to_owned())
            .then(|| Self(window.label().to_owned()))
    }
}
impl Drop for PromptSlot {
    fn drop(&mut self) {
        slots()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.0);
    }
}

pub(super) fn request(
    window: &WebviewWindow,
    lease: NativeOwnerLease,
    challenge: NativeMediaChallenge,
    completion: MediaPermissionCompletion,
) {
    if !lease.is_current() || Instant::now() >= challenge.expires_at {
        return;
    }
    let Some(devices) = device_label(challenge.audio, challenge.video) else {
        return;
    };
    // The native host already validated this origin. Never put page-supplied
    // titles, URL queries, frame names or arbitrary strings in a trust prompt.
    if sorng_browser_host::domain_permissions::canonical_website_permission_origin(
        &challenge.origin,
    )
    .as_deref()
        != Ok(challenge.origin.as_str())
    {
        return;
    }
    let Some(slot) = PromptSlot::reserve(window) else {
        return;
    };
    let parent = window.clone();
    let _ = window.run_on_main_thread(move || {
        if !lease.is_current() || Instant::now() >= challenge.expires_at { return; }
        parent.dialog()
            .message(format!("Allow {} to use your {devices}?\n\nOnly approve a website you trust. This approval applies to this request in this isolated website session. Screen capture and other device permissions are not included. Your operating system may also request permission.", challenge.origin))
            .title("Website device permission")
            .parent(&parent)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Allow this request".into(), "Block".into()))
            .show(move |approved| {
                let _slot = slot;
                completion.complete(approved && lease.is_current() && Instant::now() < challenge.expires_at);
            });
    });
}

fn device_label(audio: bool, video: bool) -> Option<&'static str> {
    match (audio, video) {
        (true, true) => Some("camera and microphone"),
        (true, false) => Some("microphone"),
        (false, true) => Some("camera"),
        (false, false) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn device_prompts_name_only_requested_devices() {
        assert_eq!(device_label(true, false), Some("microphone"));
        assert_eq!(device_label(false, true), Some("camera"));
        assert_eq!(device_label(true, true), Some("camera and microphone"));
        assert_eq!(device_label(false, false), None);
    }
}
