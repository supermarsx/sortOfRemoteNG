use super::service::RustDeskService;
use super::types::*;

/// Server administration operations that delegate to the API client.
impl RustDeskService {
    // ─── Devices ────────────────────────────────────────────────────

    pub async fn api_list_devices(
        &self,
        filter: DeviceFilter,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .list_devices(
                filter.id.as_deref(),
                filter.device_name.as_deref(),
                filter.user_name.as_deref(),
                filter.group_name.as_deref(),
                filter.device_group_name.as_deref(),
                filter.offline_days,
                filter.page,
                filter.page_size,
            )
            .await
    }

    pub async fn api_get_device(&self, device_id: &str) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.get_device(device_id).await
    }

    pub async fn api_device_action(
        &self,
        device_guid: &str,
        action: DeviceAction,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        match action {
            DeviceAction::Enable => client.enable_device(device_guid).await,
            DeviceAction::Disable => client.disable_device(device_guid).await,
            DeviceAction::Delete => client.delete_device(device_guid).await,
        }
    }

    pub async fn api_assign_device(
        &self,
        assignment: DeviceAssignment,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .assign_device(
                &assignment.device_id,
                assignment.user_name.as_deref(),
                assignment.device_group_name.as_deref(),
                None,
            )
            .await
    }

    // ─── Users ──────────────────────────────────────────────────────

    pub async fn api_list_users(
        &self,
        filter: UserFilter,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .list_users(
                filter.name.as_deref(),
                filter.group_name.as_deref(),
                filter.page,
                filter.page_size,
            )
            .await
    }

    pub async fn api_create_user(
        &self,
        request: CreateUserRequest,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .create_user(
                &request.name,
                &request.password,
                &request.group_name,
                request.email.as_deref(),
                request.note.as_deref(),
                request.is_admin,
            )
            .await
    }

    pub async fn api_user_action(
        &self,
        user_guid: &str,
        action: UserAction,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        match action {
            UserAction::Enable => client.enable_user(user_guid).await,
            UserAction::Disable => client.disable_user(user_guid).await,
            UserAction::Delete => client.delete_user(user_guid).await,
            UserAction::ResetTwoFactor => client.reset_user_2fa(user_guid).await,
            UserAction::ForceLogout => client.force_logout_user(user_guid).await,
        }
    }

    // ─── User Groups ────────────────────────────────────────────────

    pub async fn api_list_user_groups(
        &self,
        name: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_user_groups(name.as_deref()).await
    }

    pub async fn api_create_user_group(
        &self,
        request: CreateGroupRequest,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .create_user_group(
                &request.name,
                request.note.as_deref(),
                request.accessed_from.as_ref(),
                request.access_to.as_ref(),
            )
            .await
    }

    pub async fn api_update_user_group(
        &self,
        guid: &str,
        new_name: Option<String>,
        note: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .update_user_group(guid, new_name.as_deref(), note.as_deref())
            .await
    }

    pub async fn api_delete_user_group(
        &self,
        guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.delete_user_group(guid).await
    }

    pub async fn api_add_users_to_group(
        &self,
        group_guid: &str,
        user_guids: Vec<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.add_users_to_group(group_guid, &user_guids).await
    }

    // ─── Device Groups ──────────────────────────────────────────────

    pub async fn api_list_device_groups(
        &self,
        name: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_device_groups(name.as_deref()).await
    }

    pub async fn api_create_device_group(
        &self,
        request: CreateGroupRequest,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .create_device_group(
                &request.name,
                request.note.as_deref(),
                request.accessed_from.as_ref(),
            )
            .await
    }

    pub async fn api_update_device_group(
        &self,
        guid: &str,
        new_name: Option<String>,
        note: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .update_device_group(guid, new_name.as_deref(), note.as_deref())
            .await
    }

    pub async fn api_delete_device_group(
        &self,
        guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.delete_device_group(guid).await
    }

    pub async fn api_add_devices_to_group(
        &self,
        group_guid: &str,
        device_guids: Vec<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.add_devices_to_group(group_guid, &device_guids).await
    }

    pub async fn api_remove_devices_from_group(
        &self,
        group_guid: &str,
        device_guids: Vec<String>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .remove_devices_from_group(group_guid, &device_guids)
            .await
    }

    // ─── Strategies ─────────────────────────────────────────────────

    pub async fn api_list_strategies(&self) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.list_strategies().await
    }

    pub async fn api_get_strategy(
        &self,
        name: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.get_strategy(name).await
    }

    pub async fn api_enable_strategy(
        &self,
        guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.enable_strategy(guid).await
    }

    pub async fn api_disable_strategy(
        &self,
        guid: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.disable_strategy(guid).await
    }

    pub async fn api_assign_strategy(
        &self,
        assignment: StrategyAssignment,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        // We'd need a strategy GUID lookup by name in real usage
        // For now pass the strategy_name as if it were a GUID
        client
            .assign_strategy(
                &assignment.strategy_name,
                assignment.peers.as_deref(),
                assignment.users.as_deref(),
                assignment.device_groups.as_deref(),
            )
            .await
    }

    pub async fn api_unassign_strategy(
        &self,
        peers: Option<Vec<String>>,
        users: Option<Vec<String>>,
        device_groups: Option<Vec<String>>,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .unassign_strategy(
                peers.as_deref(),
                users.as_deref(),
                device_groups.as_deref(),
            )
            .await
    }

    // ─── Login ──────────────────────────────────────────────────────

    pub async fn api_login(
        &self,
        username: &str,
        password: &str,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client.login(username, password).await
    }
}
