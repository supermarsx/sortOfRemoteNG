// ── Roundcube folder (IMAP mailbox) management ───────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct FolderManager;

impl FolderManager {
    /// GET /folders — list all folders.
    pub async fn list(client: &RoundcubeClient) -> RoundcubeResult<Vec<RoundcubeFolder>> {
        debug!("ROUNDCUBE list_folders");
        client.get("/folders").await
    }

    /// GET /folders/:name — get a single folder by name.
    pub async fn get(client: &RoundcubeClient, name: &str) -> RoundcubeResult<RoundcubeFolder> {
        debug!("ROUNDCUBE get_folder name={name}");
        client.get(&format!("/folders/{name}")).await
    }

    /// POST /folders — create a folder.
    pub async fn create(
        client: &RoundcubeClient,
        req: &CreateFolderRequest,
    ) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE create_folder name={}", req.name);
        let _: serde_json::Value = client.post("/folders", req).await?;
        Ok(())
    }

    /// PUT /folders/rename — rename a folder.
    pub async fn rename(
        client: &RoundcubeClient,
        req: &RenameFolderRequest,
    ) -> RoundcubeResult<()> {
        debug!(
            "ROUNDCUBE rename_folder old={} new={}",
            req.old_name, req.new_name
        );
        client.put_no_response("/folders/rename", req).await
    }

    /// DELETE /folders/:name — delete a folder.
    pub async fn delete(client: &RoundcubeClient, name: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE delete_folder name={name}");
        client.delete(&format!("/folders/{name}")).await
    }

    /// POST /folders/:name/subscribe — subscribe to a folder.
    pub async fn subscribe(client: &RoundcubeClient, name: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE subscribe_folder name={name}");
        client
            .post_no_body(&format!("/folders/{name}/subscribe"))
            .await
    }

    /// POST /folders/:name/unsubscribe — unsubscribe from a folder.
    pub async fn unsubscribe(client: &RoundcubeClient, name: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE unsubscribe_folder name={name}");
        client
            .post_no_body(&format!("/folders/{name}/unsubscribe"))
            .await
    }

    /// POST /folders/:name/purge — purge all messages in a folder.
    pub async fn purge(client: &RoundcubeClient, name: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE purge_folder name={name}");
        client.post_no_body(&format!("/folders/{name}/purge")).await
    }

    /// GET /quota — get IMAP quota information.
    pub async fn get_quota(client: &RoundcubeClient) -> RoundcubeResult<RoundcubeQuota> {
        debug!("ROUNDCUBE get_quota");
        client.get("/quota").await
    }
}
