mod auth;

use auth::{AuthService, AuthServiceState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Initialize auth service
      let app_dir = app.path().app_data_dir().unwrap();
      let user_store_path = app_dir.join("users.json");
      let auth_service = AuthService::new(user_store_path.to_string_lossy().to_string());
      app.manage(auth_service);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        greet,
        add_user,
        verify_user,
        list_users,
        remove_user,
        update_password
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn greet(name: &str) -> String {
  format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn add_user(
  username: String,
  password: String,
  auth_service: tauri::State<AuthServiceState>,
) -> Result<(), String> {
  let mut service = auth_service.lock().await;
  service.add_user(username, password).await
}

#[tauri::command]
async fn verify_user(
  username: String,
  password: String,
  auth_service: tauri::State<AuthServiceState>,
) -> Result<bool, String> {
  let service = auth_service.lock().await;
  service.verify_user(&username, &password).await
}

#[tauri::command]
async fn list_users(auth_service: tauri::State<AuthServiceState>) -> Vec<String> {
  let service = auth_service.lock().await;
  service.list_users().await
}

#[tauri::command]
async fn remove_user(
  username: String,
  auth_service: tauri::State<AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.remove_user(username).await
}

#[tauri::command]
async fn update_password(
  username: String,
  new_password: String,
  auth_service: tauri::State<AuthServiceState>,
) -> Result<bool, String> {
  let mut service = auth_service.lock().await;
  service.update_password(username, new_password).await
}
