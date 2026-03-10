#[cfg(feature = "db-mysql")]
mod generated {
    include!("../crates/sorng-mysql/src/mysql/commands.rs");
}

#[cfg(feature = "db-mysql")]
pub use generated::*;

#[cfg(not(feature = "db-mysql"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("MySQL support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        mysql_connect,
        mysql_disconnect,
        mysql_disconnect_all,
        mysql_list_sessions,
        mysql_get_session,
        mysql_ping,
        mysql_execute_query,
        mysql_execute_statement,
        mysql_explain_query,
        mysql_list_databases,
        mysql_list_tables,
        mysql_describe_table,
        mysql_list_indexes,
        mysql_list_foreign_keys,
        mysql_list_views,
        mysql_list_routines,
        mysql_list_triggers,
        mysql_create_database,
        mysql_drop_database,
        mysql_drop_table,
        mysql_truncate_table,
        mysql_get_table_data,
        mysql_insert_row,
        mysql_update_rows,
        mysql_delete_rows,
        mysql_export_table,
        mysql_export_database,
        mysql_import_sql,
        mysql_import_csv,
        mysql_show_variables,
        mysql_show_processlist,
        mysql_kill_process,
        mysql_list_users,
        mysql_show_grants,
        mysql_server_uptime
    );
}

#[cfg(not(feature = "db-mysql"))]
pub use disabled::*;
