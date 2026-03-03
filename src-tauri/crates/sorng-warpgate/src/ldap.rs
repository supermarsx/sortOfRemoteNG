// ── sorng-warpgate/src/ldap.rs ──────────────────────────────────────────────
//! Warpgate LDAP server management (CRUD, test, query users, import).

use crate::client::WarpgateClient;
use crate::error::WarpgateResult;
use crate::types::*;

pub struct LdapManager;

impl LdapManager {
    /// GET /ldap-servers?search=
    pub async fn list(client: &WarpgateClient, search: Option<&str>) -> WarpgateResult<Vec<WarpgateLdapServer>> {
        let resp = match search {
            Some(s) => client.get_with_params("/ldap-servers", &[("search", s)]).await?,
            None => client.get("/ldap-servers").await?,
        };
        let servers: Vec<WarpgateLdapServer> = serde_json::from_value(resp)?;
        Ok(servers)
    }

    /// POST /ldap-servers
    pub async fn create(client: &WarpgateClient, req: &CreateLdapServerRequest) -> WarpgateResult<WarpgateLdapServer> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/ldap-servers", &body).await?;
        let server: WarpgateLdapServer = serde_json::from_value(resp)?;
        Ok(server)
    }

    /// GET /ldap-servers/:id
    pub async fn get(client: &WarpgateClient, server_id: &str) -> WarpgateResult<WarpgateLdapServer> {
        let resp = client.get(&format!("/ldap-servers/{}", server_id)).await?;
        let server: WarpgateLdapServer = serde_json::from_value(resp)?;
        Ok(server)
    }

    /// PUT /ldap-servers/:id
    pub async fn update(client: &WarpgateClient, server_id: &str, req: &UpdateLdapServerRequest) -> WarpgateResult<WarpgateLdapServer> {
        let body = serde_json::to_value(req)?;
        let resp = client.put(&format!("/ldap-servers/{}", server_id), &body).await?;
        let server: WarpgateLdapServer = serde_json::from_value(resp)?;
        Ok(server)
    }

    /// DELETE /ldap-servers/:id
    pub async fn delete(client: &WarpgateClient, server_id: &str) -> WarpgateResult<()> {
        client.delete(&format!("/ldap-servers/{}", server_id)).await?;
        Ok(())
    }

    /// POST /ldap-servers/test
    pub async fn test_connection(client: &WarpgateClient, req: &TestLdapServerRequest) -> WarpgateResult<TestLdapServerResponse> {
        let body = serde_json::to_value(req)?;
        let resp = client.post("/ldap-servers/test", &body).await?;
        let result: TestLdapServerResponse = serde_json::from_value(resp)?;
        Ok(result)
    }

    /// GET /ldap-servers/:id/users
    pub async fn get_users(client: &WarpgateClient, server_id: &str) -> WarpgateResult<Vec<LdapUser>> {
        let resp = client.get(&format!("/ldap-servers/{}/users", server_id)).await?;
        let users: Vec<LdapUser> = serde_json::from_value(resp)?;
        Ok(users)
    }

    /// POST /ldap-servers/:id/import-users
    pub async fn import_users(client: &WarpgateClient, server_id: &str, req: &ImportLdapUsersRequest) -> WarpgateResult<Vec<String>> {
        let body = serde_json::to_value(req)?;
        let resp = client.post(&format!("/ldap-servers/{}/import-users", server_id), &body).await?;
        let imported: Vec<String> = serde_json::from_value(resp)?;
        Ok(imported)
    }
}
