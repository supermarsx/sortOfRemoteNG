use super::*;

pub(super) fn register(app: &mut tauri::App<tauri::Wry>, app_dir: &std::path::Path) {
    let whatsapp_state: WhatsAppServiceState =
        Arc::new(Mutex::new(whatsapp::service::WhatsAppService::new()));
    app.manage(whatsapp_state);
    app.manage(telegram::service::TelegramService::new());
    app.manage(dropbox::service::DropboxService::new());
    app.manage(nextcloud::service::NextcloudService::new());
    app.manage(gdrive::service::GDriveService::new());

    let onedrive_state: OneDriveServiceState = Arc::new(tokio::sync::RwLock::new(
        onedrive::service::OneDriveService::new(),
    ));
    app.manage(onedrive_state);

    let rec_state: RecordingServiceState =
        recording::service::new_service_state(&app_dir.to_string_lossy());
    if let Some(enc_handle) = app.try_state::<sorng_encryption::EncryptionState>() {
        let enc_arc = Arc::new(enc_handle.inner().clone());
        let rec_clone = rec_state.clone();
        tauri::async_runtime::block_on(async move {
            rec_clone.lock().await.set_encryption_state(enc_arc).await;
        });
    }
    app.manage(rec_state);

    let llm_state: LlmServiceState = llm::service::create_llm_state();
    app.manage(llm_state.clone());
    let ai_assist_state: AiAssistServiceState = ai_assist::service::create_ai_assist_state(
        ai_assist::AiAssistConfig::default(),
        Some(llm_state.clone()),
    );
    app.manage(ai_assist_state.clone());
    let palette: CommandPaletteServiceState =
        command_palette::create_palette_state(app_dir, Some(llm_state));
    app.manage(palette);
    let font: FontServiceState = fonts::create_font_state(app_dir);
    app.manage(font);
    let secure_clip: SecureClipServiceState = secure_clip::create_secure_clip_state();
    if let Some(auto_lock_handle) = app.try_state::<auto_lock::AutoLockServiceState>() {
        let auto_lock = auto_lock_handle.inner().clone();
        let callback_clip = secure_clip.clone();
        let initial_clip = secure_clip.clone();
        tauri::async_runtime::block_on(async move {
            let initially_locked = {
                let mut service = auto_lock.lock().await;
                let callback: auto_lock::LockTransitionCallback = Arc::new(move |locked| {
                    let secure_clip = callback_clip.clone();
                    Box::pin(async move {
                        secure_clip
                            .write()
                            .await
                            .synchronize_lock_state(locked)
                            .await
                    })
                });
                service.set_lock_transition_callback(callback);
                matches!(service.get_lock_state().await, auto_lock::LockState::Locked)
            };
            if let Err(error) = initial_clip
                .write()
                .await
                .synchronize_lock_state(initially_locked)
                .await
            {
                log::error!("Initial secure clipboard lock synchronization failed: {error}");
            }
        });
    } else {
        log::error!("Auto-lock state is unavailable; secure clipboard lock callback was not wired");
    }
    app.manage(secure_clip);
    let theme: ThemeEngineState = terminal_themes::engine::create_theme_engine_state();
    app.manage(theme);
    let extensions: ExtensionsServiceState = extensions::service::ExtensionsService::new();
    app.manage(extensions);
}
