#[cfg(feature = "db-mongo")]
mod mongodb {
    pub use crate::mongodb::*;
}

#[cfg(feature = "db-mongo")]
mod generated {
    include!("../crates/sorng-mongodb/src/mongodb/commands.rs");
}

#[cfg(feature = "db-mongo")]
pub use generated::*;

#[cfg(not(feature = "db-mongo"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("MongoDB support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        mongo_connect,
        mongo_disconnect,
        mongo_disconnect_all,
        mongo_list_sessions,
        mongo_get_session,
        mongo_ping,
        mongo_list_databases,
        mongo_drop_database,
        mongo_list_collections,
        mongo_create_collection,
        mongo_drop_collection,
        mongo_collection_stats,
        mongo_server_status,
        mongo_list_users,
        mongo_replica_set_status,
        mongo_current_op,
        mongo_kill_op,
        mongo_find,
        mongo_count_documents,
        mongo_estimated_count,
        mongo_aggregate,
        mongo_insert_documents,
        mongo_update_documents,
        mongo_delete_documents,
        mongo_list_indexes,
        mongo_create_index,
        mongo_drop_index
    );
}

#[cfg(not(feature = "db-mongo"))]
pub use disabled::*;
