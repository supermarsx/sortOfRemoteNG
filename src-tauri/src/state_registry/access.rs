use super::*;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>) {
    let ai_agent_service: AiAgentServiceState =
        Arc::new(Mutex::new(ai_agent::service::AiAgentService::new()));
    app.manage(ai_agent_service);

    let onepassword_service: OnePasswordServiceState =
        Arc::new(Mutex::new(onepassword::service::OnePasswordService::new()));
    app.manage(onepassword_service);

    let lastpass_service: LastPassServiceState =
        Arc::new(Mutex::new(lastpass::service::LastPassService::new()));
    app.manage(lastpass_service);

    let google_passwords_service: GooglePasswordsServiceState = Arc::new(Mutex::new(
        google_passwords::service::GooglePasswordsService::new(),
    ));
    app.manage(google_passwords_service);

    let dashlane_service: DashlaneServiceState =
        Arc::new(Mutex::new(dashlane::service::DashlaneService::new()));
    app.manage(dashlane_service);
}
