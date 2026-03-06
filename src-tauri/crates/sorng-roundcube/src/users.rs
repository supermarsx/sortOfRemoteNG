// ── Roundcube user management ─────────────────────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct UserManager;

impl UserManager {
    /// GET /users — list all users.
    pub async fn list(client: &RoundcubeClient) -> RoundcubeResult<Vec<RoundcubeUser>> {
        debug!("ROUNDCUBE list_users");
        client.get("/users").await
    }

    /// GET /users/:id — get a single user.
    pub async fn get(client: &RoundcubeClient, id: &str) -> RoundcubeResult<RoundcubeUser> {
        debug!("ROUNDCUBE get_user id={id}");
        client.get(&format!("/users/{id}")).await
    }

    /// POST /users — create a new user.
    pub async fn create(client: &RoundcubeClient, req: &CreateUserRequest) -> RoundcubeResult<RoundcubeUser> {
        debug!("ROUNDCUBE create_user username={}", req.username);
        client.post("/users", req).await
    }

    /// PUT /users/:id — update an existing user.
    pub async fn update(client: &RoundcubeClient, id: &str, req: &UpdateUserRequest) -> RoundcubeResult<RoundcubeUser> {
        debug!("ROUNDCUBE update_user id={id}");
        client.put(&format!("/users/{id}"), req).await
    }

    /// DELETE /users/:id — delete a user.
    pub async fn delete(client: &RoundcubeClient, id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE delete_user id={id}");
        client.delete(&format!("/users/{id}")).await
    }

    /// GET /users/:id/preferences — get user preferences.
    pub async fn get_preferences(client: &RoundcubeClient, id: &str) -> RoundcubeResult<RoundcubeUserPreferences> {
        debug!("ROUNDCUBE get_user_preferences id={id}");
        client.get(&format!("/users/{id}/preferences")).await
    }

    /// PUT /users/:id/preferences — update user preferences.
    pub async fn update_preferences(client: &RoundcubeClient, id: &str, prefs: &RoundcubeUserPreferences) -> RoundcubeResult<RoundcubeUserPreferences> {
        debug!("ROUNDCUBE update_user_preferences id={id}");
        client.put(&format!("/users/{id}/preferences"), prefs).await
    }
}
