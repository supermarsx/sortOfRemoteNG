//! User management for Lenovo XCC/IMM.

use crate::client::LenovoClient;
use crate::error::LenovoResult;
use crate::types::*;

pub struct UserManager<'a> {
    client: &'a LenovoClient,
}

impl<'a> UserManager<'a> {
    pub fn new(client: &'a LenovoClient) -> Self {
        Self { client }
    }

    pub async fn get_users(&self) -> LenovoResult<Vec<BmcUser>> {
        let rf = self.client.require_redfish()?;
        rf.get_users().await
    }

    pub async fn create_user(&self, username: &str, password: &str, role: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.create_user(username, password, role).await
    }

    pub async fn update_password(&self, user_id: &str, password: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.update_password(user_id, password).await
    }

    pub async fn delete_user(&self, user_id: &str) -> LenovoResult<()> {
        let rf = self.client.require_redfish()?;
        rf.delete_user(user_id).await
    }
}
