// ── sorng-freeipa/src/users.rs ────────────────────────────────────────────────
//! User management operations via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list_users(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaUser>> {
        let result = client
            .rpc::<Vec<IpaUser>>(
                "user_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_user(client: &FreeIpaClient, uid: &str) -> FreeIpaResult<IpaUser> {
        let result = client
            .rpc::<IpaUser>(
                "user_show",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_user(
        client: &FreeIpaClient,
        req: &CreateUserRequest,
    ) -> FreeIpaResult<IpaUser> {
        let mut opts = serde_json::json!({
            "version": "2.251",
            "givenname": req.givenname,
            "sn": req.sn,
        });
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.cn {
            map.insert("cn".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.displayname {
            map.insert("displayname".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.mail {
            map.insert("mail".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.userpassword {
            map.insert("userpassword".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.loginshell {
            map.insert("loginshell".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.homedirectory {
            map.insert("homedirectory".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.title {
            map.insert("title".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ou {
            map.insert("ou".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.telephonenumber {
            map.insert("telephonenumber".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.manager {
            map.insert("manager".into(), serde_json::json!(v));
        }
        if let Some(v) = req.gidnumber {
            map.insert("gidnumber".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ipasshpubkey {
            map.insert("ipasshpubkey".into(), serde_json::json!(v));
        }
        if let Some(v) = req.noprivate {
            map.insert("noprivate".into(), serde_json::json!(v));
        }

        let result = client
            .rpc::<IpaUser>("user_add", vec![serde_json::json!(req.uid)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn modify_user(
        client: &FreeIpaClient,
        uid: &str,
        req: &ModifyUserRequest,
    ) -> FreeIpaResult<IpaUser> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.givenname {
            map.insert("givenname".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.sn {
            map.insert("sn".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.cn {
            map.insert("cn".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.displayname {
            map.insert("displayname".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.mail {
            map.insert("mail".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.title {
            map.insert("title".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ou {
            map.insert("ou".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.manager {
            map.insert("manager".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.loginshell {
            map.insert("loginshell".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.telephonenumber {
            map.insert("telephonenumber".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.ipasshpubkey {
            map.insert("ipasshpubkey".into(), serde_json::json!(v));
        }
        if let Some(v) = req.nsaccountlock {
            map.insert("nsaccountlock".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.userpassword {
            map.insert("userpassword".into(), serde_json::json!(v));
        }

        let result = client
            .rpc::<IpaUser>("user_mod", vec![serde_json::json!(uid)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_user(client: &FreeIpaClient, uid: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "user_del",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn find_users(client: &FreeIpaClient, criteria: &str) -> FreeIpaResult<Vec<IpaUser>> {
        let result = client
            .rpc::<Vec<IpaUser>>(
                "user_find",
                vec![serde_json::json!(criteria)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn enable_user(client: &FreeIpaClient, uid: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "user_enable",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn disable_user(client: &FreeIpaClient, uid: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "user_disable",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn reset_password(
        client: &FreeIpaClient,
        uid: &str,
        new_password: &str,
    ) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "user_mod",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251", "userpassword": new_password}),
            )
            .await?;
        Ok(())
    }

    pub async fn add_ssh_key(
        client: &FreeIpaClient,
        uid: &str,
        ssh_key: &str,
    ) -> FreeIpaResult<IpaUser> {
        let result = client
            .rpc::<IpaUser>(
                "user_mod",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251", "ipasshpubkey": [ssh_key]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_ssh_key(
        client: &FreeIpaClient,
        uid: &str,
        ssh_key: &str,
    ) -> FreeIpaResult<IpaUser> {
        let result = client
            .rpc::<IpaUser>(
                "user_mod",
                vec![serde_json::json!(uid)],
                serde_json::json!({"version": "2.251", "delattr": format!("ipasshpubkey={ssh_key}")}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn lock_user(client: &FreeIpaClient, uid: &str) -> FreeIpaResult<()> {
        Self::disable_user(client, uid).await
    }

    pub async fn unlock_user(client: &FreeIpaClient, uid: &str) -> FreeIpaResult<()> {
        Self::enable_user(client, uid).await
    }
}
