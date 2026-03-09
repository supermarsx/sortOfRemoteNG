// ── sorng-freeipa/src/sudo.rs ─────────────────────────────────────────────────
//! Sudo rule, command, and command group management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct SudoManager;

impl SudoManager {
    // ── Sudo Rules ───────────────────────────────────────────────

    pub async fn list_sudo_rules(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaSudoRule>> {
        let result = client
            .rpc::<Vec<IpaSudoRule>>(
                "sudorule_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_sudo_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<IpaSudoRule> {
        let result = client
            .rpc::<IpaSudoRule>(
                "sudorule_show",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_sudo_rule(
        client: &FreeIpaClient,
        req: &CreateSudoRuleRequest,
    ) -> FreeIpaResult<IpaSudoRule> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.description {
            map.insert("description".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.usercategory {
            map.insert("usercategory".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.hostcategory {
            map.insert("hostcategory".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.cmdcategory {
            map.insert("cmdcategory".into(), serde_json::json!(v));
        }

        let result = client
            .rpc::<IpaSudoRule>("sudorule_add", vec![serde_json::json!(req.cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn modify_sudo_rule(
        client: &FreeIpaClient,
        cn: &str,
        description: Option<&str>,
    ) -> FreeIpaResult<IpaSudoRule> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut()
                .unwrap()
                .insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaSudoRule>("sudorule_mod", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_sudo_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudorule_del",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn enable_sudo_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudorule_enable",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn disable_sudo_rule(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudorule_disable",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn add_sudo_user(
        client: &FreeIpaClient,
        cn: &str,
        user: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_add_user",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "user": [user]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_sudo_user(
        client: &FreeIpaClient,
        cn: &str,
        user: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_remove_user",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "user": [user]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_sudo_host(
        client: &FreeIpaClient,
        cn: &str,
        host: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_add_host",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_sudo_host(
        client: &FreeIpaClient,
        cn: &str,
        host: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_remove_host",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "host": [host]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_sudo_allow_cmd(
        client: &FreeIpaClient,
        cn: &str,
        cmd: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_add_allow_command",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "sudocmd": [cmd]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_sudo_allow_cmd(
        client: &FreeIpaClient,
        cn: &str,
        cmd: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_remove_allow_command",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "sudocmd": [cmd]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_sudo_deny_cmd(
        client: &FreeIpaClient,
        cn: &str,
        cmd: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_add_deny_command",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "sudocmd": [cmd]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn remove_sudo_deny_cmd(
        client: &FreeIpaClient,
        cn: &str,
        cmd: &str,
    ) -> FreeIpaResult<MemberResult> {
        let result = client
            .rpc::<MemberResult>(
                "sudorule_remove_deny_command",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "sudocmd": [cmd]}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_sudo_option(
        client: &FreeIpaClient,
        cn: &str,
        option: &str,
    ) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudorule_add_option",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "ipasudoopt": option}),
            )
            .await?;
        Ok(())
    }

    pub async fn remove_sudo_option(
        client: &FreeIpaClient,
        cn: &str,
        option: &str,
    ) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudorule_remove_option",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251", "ipasudoopt": option}),
            )
            .await?;
        Ok(())
    }

    // ── Sudo Commands ────────────────────────────────────────────

    pub async fn list_sudo_cmds(client: &FreeIpaClient) -> FreeIpaResult<Vec<IpaSudoCmd>> {
        let result = client
            .rpc::<Vec<IpaSudoCmd>>(
                "sudocmd_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_sudo_cmd(
        client: &FreeIpaClient,
        cmd: &str,
        description: Option<&str>,
    ) -> FreeIpaResult<IpaSudoCmd> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut()
                .unwrap()
                .insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaSudoCmd>("sudocmd_add", vec![serde_json::json!(cmd)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_sudo_cmd(client: &FreeIpaClient, cmd: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudocmd_del",
                vec![serde_json::json!(cmd)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    // ── Sudo Command Groups ─────────────────────────────────────

    pub async fn list_sudo_cmd_groups(
        client: &FreeIpaClient,
    ) -> FreeIpaResult<Vec<IpaSudoCmdGroup>> {
        let result = client
            .rpc::<Vec<IpaSudoCmdGroup>>(
                "sudocmdgroup_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_sudo_cmd_group(
        client: &FreeIpaClient,
        cn: &str,
        description: Option<&str>,
    ) -> FreeIpaResult<IpaSudoCmdGroup> {
        let mut opts = serde_json::json!({"version": "2.251"});
        if let Some(d) = description {
            opts.as_object_mut()
                .unwrap()
                .insert("description".into(), serde_json::json!(d));
        }
        let result = client
            .rpc::<IpaSudoCmdGroup>("sudocmdgroup_add", vec![serde_json::json!(cn)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_sudo_cmd_group(client: &FreeIpaClient, cn: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "sudocmdgroup_del",
                vec![serde_json::json!(cn)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }
}
