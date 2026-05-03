#[cfg(feature = "db-mssql")]
mod mssql {
    pub use crate::mssql::*;
}

#[cfg(feature = "db-mssql")]
mod generated {
    include!("../crates/sorng-mssql/src/mssql/commands.rs");
}

#[cfg(feature = "db-mssql")]
pub use generated::*;

#[cfg(not(feature = "db-mssql"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("MSSQL support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        mssql_connect,
        mssql_disconnect,
        mssql_disconnect_all,
        mssql_list_sessions,
        mssql_get_session,
        mssql_execute_query,
        mssql_execute_statement,
        mssql_list_databases,
        mssql_list_schemas,
        mssql_list_tables,
        mssql_describe_table,
        mssql_list_indexes,
        mssql_list_foreign_keys,
        mssql_list_views,
        mssql_list_stored_procs,
        mssql_list_triggers,
        mssql_create_database,
        mssql_drop_database,
        mssql_drop_table,
        mssql_truncate_table,
        mssql_get_table_data,
        mssql_insert_row,
        mssql_update_rows,
        mssql_delete_rows,
        mssql_export_table,
        mssql_import_sql,
        mssql_import_csv,
        mssql_server_properties,
        mssql_show_processes,
        mssql_kill_process,
        mssql_list_logins
    );
}

#[cfg(not(feature = "db-mssql"))]
pub use disabled::*;
