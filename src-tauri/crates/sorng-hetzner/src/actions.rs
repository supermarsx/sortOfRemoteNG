use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct ActionManager;

impl ActionManager {
    pub async fn list_actions(client: &HetznerClient) -> HetznerResult<Vec<HetznerAction>> {
        let resp: ActionsResponse = client.get("/actions").await?;
        Ok(resp.actions)
    }

    pub async fn get_action(client: &HetznerClient, id: u64) -> HetznerResult<HetznerAction> {
        let resp: ActionResponse = client.get(&format!("/actions/{id}")).await?;
        Ok(resp.action)
    }
}
