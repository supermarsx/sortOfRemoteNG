// ── sorng-mysql-admin – variable management ──────────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::{MysqlAdminError, MysqlAdminResult};
use crate::types::*;

pub struct VariableManager;

impl VariableManager {
    pub async fn list_global(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<MysqlVariable>> {
        let out = client.exec_mysql("SHOW GLOBAL VARIABLES").await?;
        Ok(parse_variables(&out, Some(VariableScope::Global)))
    }

    pub async fn list_session(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<MysqlVariable>> {
        let out = client.exec_mysql("SHOW SESSION VARIABLES").await?;
        Ok(parse_variables(&out, Some(VariableScope::Session)))
    }

    pub async fn get(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<MysqlVariable> {
        let out = client.exec_mysql(&format!("SHOW GLOBAL VARIABLES LIKE '{}'", name)).await?;
        let line = out.lines().find(|l| !l.is_empty())
            .ok_or_else(|| MysqlAdminError::config(format!("Variable '{}' not found", name)))?;
        let c: Vec<&str> = line.split('\t').collect();
        Ok(MysqlVariable {
            name: c.first().map(|s| s.to_string()).unwrap_or_default(),
            value: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
            is_dynamic: None,
            scope: Some(VariableScope::Global),
        })
    }

    pub async fn set(client: &MysqlAdminClient, req: &SetVariableRequest) -> MysqlAdminResult<()> {
        let scope_str = match req.scope {
            Some(VariableScope::Session) => "SESSION",
            _ => "GLOBAL",
        };
        client.exec_mysql(&format!("SET {} {} = {}", scope_str, req.name, req.value)).await?;
        Ok(())
    }

    pub async fn list_dynamic(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<MysqlVariable>> {
        let out = client.exec_mysql(
            "SELECT VARIABLE_NAME, VARIABLE_VALUE FROM performance_schema.global_variables"
        ).await?;
        let vars = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                MysqlVariable {
                    name: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    value: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    is_dynamic: Some(true),
                    scope: Some(VariableScope::Global),
                }
            })
            .collect();
        Ok(vars)
    }

    pub async fn reset_to_default(client: &MysqlAdminClient, name: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("SET GLOBAL {} = DEFAULT", name)).await?;
        Ok(())
    }

    pub async fn persist_variable(client: &MysqlAdminClient, name: &str, value: &str) -> MysqlAdminResult<()> {
        client.exec_mysql(&format!("SET PERSIST {} = {}", name, value)).await?;
        Ok(())
    }
}

fn parse_variables(output: &str, scope: Option<VariableScope>) -> Vec<MysqlVariable> {
    output.lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let c: Vec<&str> = l.split('\t').collect();
            MysqlVariable {
                name: c.first().map(|s| s.to_string()).unwrap_or_default(),
                value: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                is_dynamic: None,
                scope: scope.clone(),
            }
        })
        .collect()
}
