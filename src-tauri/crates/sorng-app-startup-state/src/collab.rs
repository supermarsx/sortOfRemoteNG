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
    app.manage(secure_clip);
    let theme: ThemeEngineState = terminal_themes::engine::create_theme_engine_state();
    app.manage(theme);
    let extensions: ExtensionsServiceState = extensions::service::ExtensionsService::new();
    app.manage(extensions);
}
