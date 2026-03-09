use super::*;
use tauri::Manager;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>, app_dir: &std::path::Path) {
    let whatsapp_state: WhatsAppServiceState = std::sync::Arc::new(tokio::sync::Mutex::new(
        whatsapp::service::WhatsAppService::new(),
    ));
    app.manage(whatsapp_state);

    let telegram_state = telegram::service::TelegramService::new();
    app.manage(telegram_state);

    let dropbox_state = dropbox::service::DropboxService::new();
    app.manage(dropbox_state);

    let nextcloud_state = nextcloud::service::NextcloudService::new();
    app.manage(nextcloud_state);

    let gdrive_state = gdrive::service::GDriveService::new();
    app.manage(gdrive_state);

    let rec_app_dir = app_dir.to_string_lossy().to_string();
    let rec_state: RecordingServiceState = recording::service::new_service_state(&rec_app_dir);
    app.manage(rec_state);

    let llm_state: LlmServiceState = llm::service::create_llm_state();
    app.manage(llm_state.clone());

    let ai_assist_state: AiAssistServiceState = ai_assist::service::create_ai_assist_state(
        ai_assist::AiAssistConfig::default(),
        Some(llm_state.clone()),
    );
    app.manage(ai_assist_state.clone());

    let palette_state: CommandPaletteServiceState =
        command_palette::create_palette_state(app_dir, Some(llm_state.clone()));
    app.manage(palette_state.clone());

    let font_state: FontServiceState = fonts::create_font_state(app_dir);
    app.manage(font_state.clone());

    let secure_clip_state: SecureClipServiceState = secure_clip::create_secure_clip_state();
    app.manage(secure_clip_state.clone());

    let theme_engine_state: ThemeEngineState = terminal_themes::engine::create_theme_engine_state();
    app.manage(theme_engine_state.clone());

    let extensions_state: ExtensionsServiceState = extensions::service::ExtensionsService::new();
    app.manage(extensions_state.clone());
}
