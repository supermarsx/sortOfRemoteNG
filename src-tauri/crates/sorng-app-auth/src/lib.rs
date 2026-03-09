pub mod commands {
    use sorng_auth::auth::AuthServiceState;

    #[tauri::command]
    pub async fn add_user(
        username: String,
        password: String,
        auth_service: tauri::State<'_, AuthServiceState>,
    ) -> Result<(), String> {
        let mut service = auth_service.lock().await;
        service.add_user(username, password).await
    }

    #[tauri::command]
    pub async fn verify_user(
        username: String,
        password: String,
        auth_service: tauri::State<'_, AuthServiceState>,
    ) -> Result<bool, String> {
        let mut service = auth_service.lock().await;
        service.verify_user(&username, &password).await
    }

    #[tauri::command]
    pub async fn list_users(
        auth_service: tauri::State<'_, AuthServiceState>,
    ) -> Result<Vec<String>, String> {
        let service = auth_service.lock().await;
        Ok(service.list_users().await)
    }

    #[tauri::command]
    pub async fn remove_user(
        username: String,
        auth_service: tauri::State<'_, AuthServiceState>,
    ) -> Result<bool, String> {
        let mut service = auth_service.lock().await;
        service.remove_user(username).await
    }

    #[tauri::command]
    pub async fn update_password(
        username: String,
        new_password: String,
        auth_service: tauri::State<'_, AuthServiceState>,
    ) -> Result<bool, String> {
        let mut service = auth_service.lock().await;
        service.update_password(username, new_password).await
    }
}
