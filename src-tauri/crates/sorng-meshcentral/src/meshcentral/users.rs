//! User account management — add, edit, remove, list, sessions, info.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::auth;
use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// List all user accounts.
    pub async fn list_users(&self) -> MeshCentralResult<Vec<McUser>> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("users", payload).await?;

        let mut users = Vec::new();
        if let Some(user_list) = resp.get("users") {
            if let Some(arr) = user_list.as_array() {
                for u in arr {
                    if let Ok(user) = serde_json::from_value::<McUser>(u.clone()) {
                        users.push(user);
                    }
                }
            }
        }

        Ok(users)
    }

    /// List active user sessions.
    pub async fn list_user_sessions(&self) -> MeshCentralResult<McUserSessions> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("wssessioncount", payload).await?;

        let mut sessions = std::collections::HashMap::new();
        if let Some(ws_sessions) = resp.get("wssessions") {
            if let Some(obj) = ws_sessions.as_object() {
                for (uid, count) in obj {
                    if let Some(n) = count.as_u64() {
                        sessions.insert(uid.clone(), n as u32);
                    }
                }
            }
        }

        Ok(McUserSessions { sessions })
    }

    /// Add a new user account.
    pub async fn add_user(&self, params: McAddUser) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("username".to_string(), json!(params.username));

        if params.random_password {
            // Server generates a random password
            payload.insert("randompass".to_string(), json!(true));
        } else if let Some(ref pass) = params.password {
            payload.insert("pass".to_string(), json!(pass));
        }

        if let Some(ref email) = params.email {
            payload.insert("email".to_string(), json!(email));
            if params.email_verified {
                payload.insert("emailVerified".to_string(), json!(true));
            }
        }
        if params.reset_password {
            payload.insert("resetNextLogin".to_string(), json!(true));
        }
        if let Some(ref realname) = params.realname {
            payload.insert("realname".to_string(), json!(realname));
        }
        if let Some(ref phone) = params.phone {
            payload.insert("phone".to_string(), json!(phone));
        }
        if let Some(ref domain) = params.domain {
            payload.insert("domain".to_string(), json!(domain));
        }
        if let Some(ref rights_str) = params.rights {
            let rights = auth::parse_site_rights(rights_str);
            payload.insert("siteadmin".to_string(), json!(rights));
        }

        let resp = self.send_action("adduser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User added".to_string());
        Ok(result)
    }

    /// Edit a user account.
    pub async fn edit_user(&self, params: McEditUser) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        let mut userid = params.user_id.clone();
        if let Some(ref domain) = params.domain {
            if !userid.contains('/') {
                userid = format!("user/{}/{}", domain, userid);
            }
        }
        payload.insert("userid".to_string(), json!(userid));

        if let Some(ref email) = params.email {
            payload.insert("email".to_string(), json!(email));
            if params.email_verified {
                payload.insert("emailVerified".to_string(), json!(true));
            }
        }
        if params.reset_password {
            payload.insert("resetNextLogin".to_string(), json!(true));
        }
        if let Some(ref realname) = params.realname {
            payload.insert("realname".to_string(), json!(realname));
        }
        if let Some(ref phone) = params.phone {
            payload.insert("phone".to_string(), json!(phone));
        }
        if let Some(ref domain) = params.domain {
            payload.insert("domain".to_string(), json!(domain));
        }
        if let Some(ref rights_str) = params.rights {
            let rights = auth::parse_site_rights(rights_str);
            payload.insert("siteadmin".to_string(), json!(rights));
        }

        let resp = self.send_action("edituser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User updated".to_string());
        Ok(result)
    }

    /// Remove a user account.
    pub async fn remove_user(
        &self,
        user_id: &str,
        domain: Option<&str>,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        let mut uid = user_id.to_string();
        if let Some(d) = domain {
            if !uid.contains('/') {
                uid = format!("user/{}/{}", d, uid);
            }
        }
        payload.insert("userid".to_string(), json!(uid));

        let resp = self.send_action("deleteuser", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "User removed".to_string());
        Ok(result)
    }

    /// Get info about the currently logged-in user.
    pub async fn get_user_info(&self) -> MeshCentralResult<McUserInfo> {
        self.user_info().await
    }

    /// List login tokens.
    pub async fn list_login_tokens(&self) -> MeshCentralResult<Vec<McLoginToken>> {
        let payload = serde_json::Map::new();
        let resp = self.send_action("loginTokens", payload).await?;

        let mut tokens = Vec::new();
        if let Some(token_list) = resp.get("loginTokens") {
            if let Some(arr) = token_list.as_array() {
                for t in arr {
                    if let Ok(token) = serde_json::from_value::<McLoginToken>(t.clone()) {
                        tokens.push(token);
                    }
                }
            }
        }

        Ok(tokens)
    }

    /// Create a login token.
    pub async fn create_login_token(
        &self,
        params: McCreateLoginToken,
    ) -> MeshCentralResult<McLoginToken> {
        let mut payload = serde_json::Map::new();
        payload.insert("name".to_string(), json!(params.name));
        payload.insert("expire".to_string(), json!(params.expire_minutes));

        let resp = self.send_action("createLoginToken", payload).await?;
        let token: McLoginToken = serde_json::from_value(resp)?;
        Ok(token)
    }

    /// Remove a login token.
    pub async fn remove_login_token(&self, token_name: &str) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("remove".to_string(), json!([token_name]));

        let resp = self.send_action("loginTokens", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Token removed".to_string());
        Ok(result)
    }
}
