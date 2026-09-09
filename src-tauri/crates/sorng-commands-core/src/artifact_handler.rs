//! The real always-on artifact command surface, also usable by mock-runtime IPC.
pub const COMMAND_NAMES: &[&str] = &[
    "encryption_get_artifact_status",
    "encryption_preview_artifact_policy",
    "encryption_apply_artifact_policy",
    "encryption_cancel_artifact_policy",
    "encryption_release_artifact_preview",
    "encryption_recover_artifact_transition",
];
pub fn build<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
{
    tauri::generate_handler![
        crate::artifact_encryption_commands::encryption_get_artifact_status,
        crate::artifact_encryption_commands::encryption_preview_artifact_policy,
        crate::artifact_encryption_commands::encryption_apply_artifact_policy,
        crate::artifact_encryption_commands::encryption_cancel_artifact_policy,
        crate::artifact_encryption_commands::encryption_release_artifact_preview,
        crate::artifact_encryption_commands::encryption_recover_artifact_transition,
    ]
}
