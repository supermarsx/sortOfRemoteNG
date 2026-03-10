#[cfg(feature = "db-postgres")]
mod generated {
    include!("../crates/sorng-postgres/src/postgres/commands.rs");
}

#[cfg(feature = "db-postgres")]
pub use generated::*;

#[cfg(not(feature = "db-postgres"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("PostgreSQL support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        pg_connect,
        pg_disconnect,
        pg_disconnect_all,
        pg_list_sessions,
        pg_get_session,
        pg_ping,
        pg_execute_query,
        pg_execute_statement,
        pg_explain_query,
        pg_list_databases,
        pg_list_schemas,
        pg_list_tables,
        pg_describe_table,
        pg_list_indexes,
        pg_list_foreign_keys,
        pg_list_views,
        pg_list_routines,
        pg_list_triggers,
        pg_list_sequences,
        pg_list_extensions,
        pg_create_database,
        pg_drop_database,
        pg_create_schema,
        pg_drop_schema,
        pg_drop_table,
        pg_truncate_table,
        pg_get_table_data,
        pg_insert_row,
        pg_update_rows,
        pg_delete_rows,
        pg_export_table,
        pg_export_schema,
        pg_import_sql,
        pg_import_csv,
        pg_show_settings,
        pg_show_activity,
        pg_terminate_backend,
        pg_cancel_backend,
        pg_vacuum_table,
        pg_list_roles,
        pg_list_tablespaces,
        pg_server_uptime,
        pg_database_size
    );
}

#[cfg(not(feature = "db-postgres"))]
pub use disabled::*;
