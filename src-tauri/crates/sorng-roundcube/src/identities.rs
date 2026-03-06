// ── Roundcube identity management ─────────────────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct IdentityManager;

impl IdentityManager {
    /// GET /users/:user_id/identities — list identities for a user.
    pub async fn list(client: &RoundcubeClient, user_id: &str) -> RoundcubeResult<Vec<RoundcubeIdentity>> {
        debug!("ROUNDCUBE list_identities user_id={user_id}");
        client.get(&format!("/users/{user_id}/identities")).await
    }

    /// GET /users/:user_id/identities/:id — get a single identity.
    pub async fn get(client: &RoundcubeClient, user_id: &str, id: &str) -> RoundcubeResult<RoundcubeIdentity> {
        debug!("ROUNDCUBE get_identity user_id={user_id} id={id}");
        client.get(&format!("/users/{user_id}/identities/{id}")).await
    }

    /// POST /users/:user_id/identities — create an identity.
    pub async fn create(client: &RoundcubeClient, user_id: &str, req: &CreateIdentityRequest) -> RoundcubeResult<RoundcubeIdentity> {
        debug!("ROUNDCUBE create_identity user_id={user_id} name={}", req.name);
        client.post(&format!("/users/{user_id}/identities"), req).await
    }

    /// PUT /users/:user_id/identities/:id — update an identity.
    pub async fn update(client: &RoundcubeClient, user_id: &str, id: &str, req: &UpdateIdentityRequest) -> RoundcubeResult<RoundcubeIdentity> {
        debug!("ROUNDCUBE update_identity user_id={user_id} id={id}");
        client.put(&format!("/users/{user_id}/identities/{id}"), req).await
    }

    /// DELETE /users/:user_id/identities/:id — delete an identity.
    pub async fn delete(client: &RoundcubeClient, user_id: &str, id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE delete_identity user_id={user_id} id={id}");
        client.delete(&format!("/users/{user_id}/identities/{id}")).await
    }

    /// POST /users/:user_id/identities/:id/default — set identity as default.
    pub async fn set_default(client: &RoundcubeClient, user_id: &str, id: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE set_default_identity user_id={user_id} id={id}");
        client.post_no_body(&format!("/users/{user_id}/identities/{id}/default")).await
    }
}
