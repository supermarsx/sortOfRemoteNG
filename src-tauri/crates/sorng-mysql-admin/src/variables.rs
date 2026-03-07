// ── sorng-mysql-admin – variable management ──────────────────────────────────
//! MySQL global/session variable and status inspection/control via SSH.

use crate::client::MysqlClient;
use crate::error::{MysqlError, MysqlResult};
use crate::types::*;

pub struct VariableManager;

impl VariableManager {
    /// List all global variables.
    pub async fn list_global(client: &MysqlClient) -> MysqlResult<Vec<MysqlVariable>> {
        let out = client.exec_sql("SHOW GLOBAL VARIABLES").await?;
        Ok(parse_variable_output(&out, true, false))
    }

    /// List all session variables.
    pub async fn list_session(client: &MysqlClient) -> MysqlResult<Vec<MysqlVariable>> {
        let out = client.exec_sql("SHOW SESSION VARIABLES").await?;
        Ok(parse_variable_output(&out, false, true))
    }

    /// Get a specific global variable.
    pub async fn get_global(client: &MysqlClient, name: &str) -> MysqlResult<MysqlVariable> {
        let sql = format!("SHOW GLOBAL VARIABLES LIKE '{}'", sql_escape(name));
        let out = client.exec_sql(&sql).await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::variable_not_found(name))?;
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 2 {
            return Err(MysqlError::parse("unexpected variable output format"));
        }
        Ok(MysqlVariable {
            name: cols[0].to_string(),
            value: cols[1].to_string(),
            is_global: true,
            is_session: false,
        })
    }

    /// Get a specific session variable.
    pub async fn get_session(client: &MysqlClient, name: &str) -> MysqlResult<MysqlVariable> {
        let sql = format!("SHOW SESSION VARIABLES LIKE '{}'", sql_escape(name));
        let out = client.exec_sql(&sql).await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::variable_not_found(name))?;
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 2 {
            return Err(MysqlError::parse("unexpected variable output format"));
        }
        Ok(MysqlVariable {
            name: cols[0].to_string(),
            value: cols[1].to_string(),
            is_global: false,
            is_session: true,
        })
    }

    /// Set a global variable value.
    pub async fn set_global(client: &MysqlClient, name: &str, value: &str) -> MysqlResult<()> {
        let sql = format!("SET GLOBAL {} = '{}'", name, sql_escape(value));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// Set a session variable value.
    pub async fn set_session(client: &MysqlClient, name: &str, value: &str) -> MysqlResult<()> {
        let sql = format!("SET SESSION {} = '{}'", name, sql_escape(value));
        client.exec_sql(&sql).await?;
        Ok(())
    }

    /// List all global status counters.
    pub async fn list_status(client: &MysqlClient) -> MysqlResult<Vec<MysqlVariable>> {
        let out = client.exec_sql("SHOW GLOBAL STATUS").await?;
        Ok(parse_variable_output(&out, true, false))
    }

    /// Get a specific global status counter.
    pub async fn get_status(client: &MysqlClient, name: &str) -> MysqlResult<MysqlVariable> {
        let sql = format!("SHOW GLOBAL STATUS LIKE '{}'", sql_escape(name));
        let out = client.exec_sql(&sql).await?;
        let line = out.lines().next()
            .ok_or_else(|| MysqlError::variable_not_found(name))?;
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 2 {
            return Err(MysqlError::parse("unexpected status output format"));
        }
        Ok(MysqlVariable {
            name: cols[0].to_string(),
            value: cols[1].to_string(),
            is_global: true,
            is_session: false,
        })
    }

    /// Get the MySQL server version string.
    pub async fn get_server_info(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SELECT VERSION()").await?;
        Ok(out.trim().to_string())
    }
}

fn parse_variable_output(output: &str, is_global: bool, is_session: bool) -> Vec<MysqlVariable> {
    let mut vars = Vec::new();
    for line in output.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() >= 2 {
            vars.push(MysqlVariable {
                name: cols[0].to_string(),
                value: cols[1].to_string(),
                is_global,
                is_session,
            });
        }
    }
    vars
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "\\'")
}
