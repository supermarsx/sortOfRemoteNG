#[cfg(feature = "db-sqlite")]
mod sqlite {
    pub use crate::sqlite::*;
}

#[cfg(feature = "db-sqlite")]
mod generated {
    include!("../crates/sorng-sqlite/src/sqlite/commands.rs");
}

#[cfg(feature = "db-sqlite")]
pub use generated::*;

#[cfg(not(feature = "db-sqlite"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("SQLite support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        sqlite_connect,
        sqlite_disconnect,
        sqlite_disconnect_all,
        sqlite_list_sessions,
        sqlite_get_session,
        sqlite_ping,
        sqlite_execute_query,
        sqlite_execute_statement,
        sqlite_explain_query,
        sqlite_list_tables,
        sqlite_describe_table,
        sqlite_list_indexes,
        sqlite_list_foreign_keys,
        sqlite_list_triggers,
        sqlite_list_attached_databases,
        sqlite_get_pragma,
        sqlite_set_pragma,
        sqlite_drop_table,
        sqlite_vacuum,
        sqlite_integrity_check,
        sqlite_attach_database,
        sqlite_detach_database,
        sqlite_get_table_data,
        sqlite_insert_row,
        sqlite_update_rows,
        sqlite_delete_rows,
        sqlite_export_table,
        sqlite_export_database,
        sqlite_import_sql,
        sqlite_import_csv,
        sqlite_database_size,
        sqlite_table_count
    );
}

#[cfg(not(feature = "db-sqlite"))]
pub use disabled::*;
