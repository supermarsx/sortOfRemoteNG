use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "mysql_connect"
            | "mysql_disconnect"
            | "mysql_disconnect_all"
            | "mysql_list_sessions"
            | "mysql_get_session"
            | "mysql_ping"
            | "mysql_execute_query"
            | "mysql_execute_statement"
            | "mysql_explain_query"
            | "mysql_list_databases"
            | "mysql_list_tables"
            | "mysql_describe_table"
            | "mysql_list_indexes"
            | "mysql_list_foreign_keys"
            | "mysql_list_views"
            | "mysql_list_routines"
            | "mysql_list_triggers"
            | "mysql_create_database"
            | "mysql_drop_database"
            | "mysql_drop_table"
            | "mysql_truncate_table"
            | "mysql_get_table_data"
            | "mysql_insert_row"
            | "mysql_update_rows"
            | "mysql_delete_rows"
            | "mysql_export_table"
            | "mysql_export_database"
            | "mysql_import_sql"
            | "mysql_import_csv"
            | "mysql_show_variables"
            | "mysql_show_processlist"
            | "mysql_kill_process"
            | "mysql_list_users"
            | "mysql_show_grants"
            | "mysql_server_uptime"
            | "pg_connect"
            | "pg_disconnect"
            | "pg_disconnect_all"
            | "pg_list_sessions"
            | "pg_get_session"
            | "pg_ping"
            | "pg_execute_query"
            | "pg_execute_statement"
            | "pg_explain_query"
            | "pg_list_databases"
            | "pg_list_schemas"
            | "pg_list_tables"
            | "pg_describe_table"
            | "pg_list_indexes"
            | "pg_list_foreign_keys"
            | "pg_list_views"
            | "pg_list_routines"
            | "pg_list_triggers"
            | "pg_list_sequences"
            | "pg_list_extensions"
            | "pg_create_database"
            | "pg_drop_database"
            | "pg_create_schema"
            | "pg_drop_schema"
            | "pg_drop_table"
            | "pg_truncate_table"
            | "pg_get_table_data"
            | "pg_insert_row"
            | "pg_update_rows"
            | "pg_delete_rows"
            | "pg_export_table"
            | "pg_export_schema"
            | "pg_import_sql"
            | "pg_import_csv"
            | "pg_show_settings"
            | "pg_show_activity"
            | "pg_terminate_backend"
            | "pg_cancel_backend"
            | "pg_vacuum_table"
            | "pg_list_roles"
            | "pg_list_tablespaces"
            | "pg_server_uptime"
            | "pg_database_size"
            | "mssql_connect"
            | "mssql_disconnect"
            | "mssql_disconnect_all"
            | "mssql_list_sessions"
            | "mssql_get_session"
            | "mssql_execute_query"
            | "mssql_execute_statement"
            | "mssql_list_databases"
            | "mssql_list_schemas"
            | "mssql_list_tables"
            | "mssql_describe_table"
            | "mssql_list_indexes"
            | "mssql_list_foreign_keys"
            | "mssql_list_views"
            | "mssql_list_stored_procs"
            | "mssql_list_triggers"
            | "mssql_create_database"
            | "mssql_drop_database"
            | "mssql_drop_table"
            | "mssql_truncate_table"
            | "mssql_get_table_data"
            | "mssql_insert_row"
            | "mssql_update_rows"
            | "mssql_delete_rows"
            | "mssql_export_table"
            | "mssql_import_sql"
            | "mssql_import_csv"
            | "mssql_server_properties"
            | "mssql_show_processes"
            | "mssql_kill_process"
            | "mssql_list_logins"
            | "sqlite_connect"
            | "sqlite_disconnect"
            | "sqlite_disconnect_all"
            | "sqlite_list_sessions"
            | "sqlite_get_session"
            | "sqlite_ping"
            | "sqlite_execute_query"
            | "sqlite_execute_statement"
            | "sqlite_explain_query"
            | "sqlite_list_tables"
            | "sqlite_describe_table"
            | "sqlite_list_indexes"
            | "sqlite_list_foreign_keys"
            | "sqlite_list_triggers"
            | "sqlite_list_attached_databases"
            | "sqlite_get_pragma"
            | "sqlite_set_pragma"
            | "sqlite_drop_table"
            | "sqlite_vacuum"
            | "sqlite_integrity_check"
            | "sqlite_attach_database"
            | "sqlite_detach_database"
            | "sqlite_get_table_data"
            | "sqlite_insert_row"
            | "sqlite_update_rows"
            | "sqlite_delete_rows"
            | "sqlite_export_table"
            | "sqlite_export_database"
            | "sqlite_import_sql"
            | "sqlite_import_csv"
            | "sqlite_database_size"
            | "sqlite_table_count"
            | "mongo_connect"
            | "mongo_disconnect"
            | "mongo_disconnect_all"
            | "mongo_list_sessions"
            | "mongo_get_session"
            | "mongo_ping"
            | "mongo_list_databases"
            | "mongo_drop_database"
            | "mongo_list_collections"
            | "mongo_create_collection"
            | "mongo_drop_collection"
            | "mongo_collection_stats"
            | "mongo_find"
            | "mongo_count_documents"
            | "mongo_insert_one"
            | "mongo_insert_many"
            | "mongo_update_one"
            | "mongo_update_many"
            | "mongo_delete_one"
            | "mongo_delete_many"
            | "mongo_aggregate"
            | "mongo_run_command"
            | "mongo_list_indexes"
            | "mongo_create_index"
            | "mongo_drop_index"
            | "mongo_server_status"
            | "mongo_list_users"
            | "mongo_replica_set_status"
            | "mongo_current_op"
            | "mongo_kill_op"
            | "mongo_export_collection"
            | "redis_connect"
            | "redis_disconnect"
            | "redis_disconnect_all"
            | "redis_list_sessions"
            | "redis_get_session"
            | "redis_ping"
            | "redis_get"
            | "redis_set"
            | "redis_del"
            | "redis_exists"
            | "redis_expire"
            | "redis_persist"
            | "redis_ttl"
            | "redis_key_type"
            | "redis_rename"
            | "redis_scan"
            | "redis_key_info"
            | "redis_dbsize"
            | "redis_flushdb"
            | "redis_hgetall"
            | "redis_hget"
            | "redis_hset"
            | "redis_hdel"
            | "redis_lrange"
            | "redis_lpush"
            | "redis_rpush"
            | "redis_llen"
            | "redis_smembers"
            | "redis_sadd"
            | "redis_srem"
            | "redis_scard"
            | "redis_zrange_with_scores"
            | "redis_zadd"
            | "redis_zrem"
            | "redis_zcard"
            | "redis_server_info"
            | "redis_memory_info"
            | "redis_client_list"
            | "redis_client_kill"
            | "redis_slowlog_get"
            | "redis_config_get"
            | "redis_config_set"
            | "redis_raw_command"
            | "redis_select_db"
            | "ai_get_settings"
            | "ai_update_settings"
            | "ai_add_provider"
            | "ai_remove_provider"
            | "ai_list_providers"
            | "ai_check_provider_health"
            | "ai_create_conversation"
            | "ai_get_conversation"
            | "ai_delete_conversation"
            | "ai_list_conversations"
            | "ai_rename_conversation"
            | "ai_pin_conversation"
            | "ai_archive_conversation"
            | "ai_set_conversation_tags"
            | "ai_fork_conversation"
            | "ai_search_conversations"
            | "ai_export_conversation"
            | "ai_import_conversation"
            | "ai_send_message"
            | "ai_get_messages"
            | "ai_clear_messages"
            | "ai_chat_completion"
            | "ai_run_agent"
            | "ai_code_assist"
            | "ai_code_generate"
            | "ai_code_review"
            | "ai_code_refactor"
            | "ai_code_explain"
            | "ai_code_document"
            | "ai_code_find_bugs"
            | "ai_code_optimize"
            | "ai_code_write_tests"
            | "ai_code_convert"
            | "ai_code_fix_error"
            | "ai_list_templates"
            | "ai_get_template"
            | "ai_create_template"
            | "ai_delete_template"
            | "ai_render_template"
            | "ai_add_memory"
            | "ai_search_memory"
            | "ai_list_memory"
            | "ai_remove_memory"
            | "ai_clear_memory"
            | "ai_get_memory_config"
            | "ai_update_memory_config"
            | "ai_add_vector"
            | "ai_search_vectors"
            | "ai_ingest_document"
            | "ai_remove_document"
            | "ai_search_rag"
            | "ai_list_rag_collections"
            | "ai_create_workflow"
            | "ai_get_workflow"
            | "ai_delete_workflow"
            | "ai_list_workflows"
            | "ai_run_workflow"
            | "ai_count_tokens"
            | "ai_get_budget_status"
            | "ai_update_budget"
            | "ai_reset_budget"
            | "ai_diagnostics"
            | "op_get_config"
            | "op_set_config"
            | "op_connect"
            | "op_disconnect"
            | "op_is_authenticated"
            | "op_list_vaults"
            | "op_get_vault"
            | "op_find_vault_by_name"
            | "op_get_vault_stats"
            | "op_list_items"
            | "op_get_item"
            | "op_find_items_by_title"
            | "op_create_item"
            | "op_update_item"
            | "op_patch_item"
            | "op_delete_item"
            | "op_archive_item"
            | "op_restore_item"
            | "op_search_all_vaults"
            | "op_get_password"
            | "op_get_username"
            | "op_add_field"
            | "op_update_field_value"
            | "op_remove_field"
            | "op_list_files"
            | "op_download_file"
            | "op_get_totp_code"
            | "op_add_totp"
            | "op_watchtower_analyze_all"
            | "op_watchtower_analyze_vault"
            | "op_heartbeat"
            | "op_health"
            | "op_is_healthy"
            | "op_get_activity"
            | "op_list_favorites"
            | "op_toggle_favorite"
            | "op_export_vault_json"
            | "op_export_vault_csv"
            | "op_import_json"
            | "op_import_csv"
            | "op_generate_password"
            | "op_generate_passphrase"
            | "op_rate_password_strength"
            | "op_list_categories"
            | "op_invalidate_cache"
            | "lp_configure"
            | "lp_login"
            | "lp_logout"
            | "lp_is_logged_in"
            | "lp_is_configured"
            | "lp_list_accounts"
            | "lp_get_account"
            | "lp_search_accounts"
            | "lp_search_by_url"
            | "lp_create_account"
            | "lp_update_account"
            | "lp_delete_account"
            | "lp_toggle_favorite"
            | "lp_move_account"
            | "lp_get_favorites"
            | "lp_get_duplicates"
            | "lp_list_folders"
            | "lp_create_folder"
            | "lp_security_challenge"
            | "lp_export_csv"
            | "lp_export_json"
            | "lp_import_csv"
            | "lp_generate_password"
            | "lp_generate_passphrase"
            | "lp_check_password_strength"
            | "lp_get_stats"
            | "lp_invalidate_cache"
            | "gp_configure"
            | "gp_is_configured"
            | "gp_is_authenticated"
            | "gp_get_auth_url"
            | "gp_authenticate"
            | "gp_refresh_auth"
            | "gp_logout"
            | "gp_list_credentials"
            | "gp_get_credential"
            | "gp_search_credentials"
            | "gp_search_by_url"
            | "gp_create_credential"
            | "gp_update_credential"
            | "gp_delete_credential"
            | "gp_run_checkup"
            | "gp_get_insecure_urls"
            | "gp_import_csv"
            | "gp_export_csv"
            | "gp_export_json"
            | "gp_generate_password"
            | "gp_check_password_strength"
            | "gp_get_stats"
            | "gp_get_sync_info"
            | "dl_configure"
            | "dl_login"
            | "dl_login_with_token"
            | "dl_logout"
            | "dl_is_authenticated"
            | "dl_list_credentials"
            | "dl_get_credential"
            | "dl_search_credentials"
            | "dl_search_by_url"
            | "dl_create_credential"
            | "dl_update_credential"
            | "dl_delete_credential"
            | "dl_find_duplicate_passwords"
            | "dl_get_categories"
            | "dl_list_notes"
            | "dl_get_note"
            | "dl_search_notes"
            | "dl_create_note"
            | "dl_delete_note"
            | "dl_list_identities"
            | "dl_create_identity"
            | "dl_list_secrets"
            | "dl_create_secret"
            | "dl_list_devices"
            | "dl_deregister_device"
            | "dl_list_sharing_groups"
            | "dl_create_sharing_group"
            | "dl_get_dark_web_alerts"
            | "dl_get_active_dark_web_alerts"
            | "dl_dismiss_dark_web_alert"
            | "dl_get_password_health"
            | "dl_generate_password"
            | "dl_generate_passphrase"
            | "dl_check_password_strength"
            | "dl_export_csv"
            | "dl_export_json"
            | "dl_import_csv"
            | "dl_get_stats"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── MySQL ───────────────────────────────────────────────────
        mysql::commands::mysql_connect,
        mysql::commands::mysql_disconnect,
        mysql::commands::mysql_disconnect_all,
        mysql::commands::mysql_list_sessions,
        mysql::commands::mysql_get_session,
        mysql::commands::mysql_ping,
        mysql::commands::mysql_execute_query,
        mysql::commands::mysql_execute_statement,
        mysql::commands::mysql_explain_query,
        mysql::commands::mysql_list_databases,
        mysql::commands::mysql_list_tables,
        mysql::commands::mysql_describe_table,
        mysql::commands::mysql_list_indexes,
        mysql::commands::mysql_list_foreign_keys,
        mysql::commands::mysql_list_views,
        mysql::commands::mysql_list_routines,
        mysql::commands::mysql_list_triggers,
        mysql::commands::mysql_create_database,
        mysql::commands::mysql_drop_database,
        mysql::commands::mysql_drop_table,
        mysql::commands::mysql_truncate_table,
        mysql::commands::mysql_get_table_data,
        mysql::commands::mysql_insert_row,
        mysql::commands::mysql_update_rows,
        mysql::commands::mysql_delete_rows,
        mysql::commands::mysql_export_table,
        mysql::commands::mysql_export_database,
        mysql::commands::mysql_import_sql,
        mysql::commands::mysql_import_csv,
        mysql::commands::mysql_show_variables,
        mysql::commands::mysql_show_processlist,
        mysql::commands::mysql_kill_process,
        mysql::commands::mysql_list_users,
        mysql::commands::mysql_show_grants,
        mysql::commands::mysql_server_uptime,
        // ── PostgreSQL ──────────────────────────────────────────────
        postgres::commands::pg_connect,
        postgres::commands::pg_disconnect,
        postgres::commands::pg_disconnect_all,
        postgres::commands::pg_list_sessions,
        postgres::commands::pg_get_session,
        postgres::commands::pg_ping,
        postgres::commands::pg_execute_query,
        postgres::commands::pg_execute_statement,
        postgres::commands::pg_explain_query,
        postgres::commands::pg_list_databases,
        postgres::commands::pg_list_schemas,
        postgres::commands::pg_list_tables,
        postgres::commands::pg_describe_table,
        postgres::commands::pg_list_indexes,
        postgres::commands::pg_list_foreign_keys,
        postgres::commands::pg_list_views,
        postgres::commands::pg_list_routines,
        postgres::commands::pg_list_triggers,
        postgres::commands::pg_list_sequences,
        postgres::commands::pg_list_extensions,
        postgres::commands::pg_create_database,
        postgres::commands::pg_drop_database,
        postgres::commands::pg_create_schema,
        postgres::commands::pg_drop_schema,
        postgres::commands::pg_drop_table,
        postgres::commands::pg_truncate_table,
        postgres::commands::pg_get_table_data,
        postgres::commands::pg_insert_row,
        postgres::commands::pg_update_rows,
        postgres::commands::pg_delete_rows,
        postgres::commands::pg_export_table,
        postgres::commands::pg_export_schema,
        postgres::commands::pg_import_sql,
        postgres::commands::pg_import_csv,
        postgres::commands::pg_show_settings,
        postgres::commands::pg_show_activity,
        postgres::commands::pg_terminate_backend,
        postgres::commands::pg_cancel_backend,
        postgres::commands::pg_vacuum_table,
        postgres::commands::pg_list_roles,
        postgres::commands::pg_list_tablespaces,
        postgres::commands::pg_server_uptime,
        postgres::commands::pg_database_size,
        // ── MSSQL ───────────────────────────────────────────────────
        mssql::commands::mssql_connect,
        mssql::commands::mssql_disconnect,
        mssql::commands::mssql_disconnect_all,
        mssql::commands::mssql_list_sessions,
        mssql::commands::mssql_get_session,
        mssql::commands::mssql_execute_query,
        mssql::commands::mssql_execute_statement,
        mssql::commands::mssql_list_databases,
        mssql::commands::mssql_list_schemas,
        mssql::commands::mssql_list_tables,
        mssql::commands::mssql_describe_table,
        mssql::commands::mssql_list_indexes,
        mssql::commands::mssql_list_foreign_keys,
        mssql::commands::mssql_list_views,
        mssql::commands::mssql_list_stored_procs,
        mssql::commands::mssql_list_triggers,
        mssql::commands::mssql_create_database,
        mssql::commands::mssql_drop_database,
        mssql::commands::mssql_drop_table,
        mssql::commands::mssql_truncate_table,
        mssql::commands::mssql_get_table_data,
        mssql::commands::mssql_insert_row,
        mssql::commands::mssql_update_rows,
        mssql::commands::mssql_delete_rows,
        mssql::commands::mssql_export_table,
        mssql::commands::mssql_import_sql,
        mssql::commands::mssql_import_csv,
        mssql::commands::mssql_server_properties,
        mssql::commands::mssql_show_processes,
        mssql::commands::mssql_kill_process,
        mssql::commands::mssql_list_logins,
        // ── SQLite ──────────────────────────────────────────────────
        sqlite::commands::sqlite_connect,
        sqlite::commands::sqlite_disconnect,
        sqlite::commands::sqlite_disconnect_all,
        sqlite::commands::sqlite_list_sessions,
        sqlite::commands::sqlite_get_session,
        sqlite::commands::sqlite_ping,
        sqlite::commands::sqlite_execute_query,
        sqlite::commands::sqlite_execute_statement,
        sqlite::commands::sqlite_explain_query,
        sqlite::commands::sqlite_list_tables,
        sqlite::commands::sqlite_describe_table,
        sqlite::commands::sqlite_list_indexes,
        sqlite::commands::sqlite_list_foreign_keys,
        sqlite::commands::sqlite_list_triggers,
        sqlite::commands::sqlite_list_attached_databases,
        sqlite::commands::sqlite_get_pragma,
        sqlite::commands::sqlite_set_pragma,
        sqlite::commands::sqlite_drop_table,
        sqlite::commands::sqlite_vacuum,
        sqlite::commands::sqlite_integrity_check,
        sqlite::commands::sqlite_attach_database,
        sqlite::commands::sqlite_detach_database,
        sqlite::commands::sqlite_get_table_data,
        sqlite::commands::sqlite_insert_row,
        sqlite::commands::sqlite_update_rows,
        sqlite::commands::sqlite_delete_rows,
        sqlite::commands::sqlite_export_table,
        sqlite::commands::sqlite_export_database,
        sqlite::commands::sqlite_import_sql,
        sqlite::commands::sqlite_import_csv,
        sqlite::commands::sqlite_database_size,
        sqlite::commands::sqlite_table_count,
        // ── MongoDB ─────────────────────────────────────────────────
        mongodb::commands::mongo_connect,
        mongodb::commands::mongo_disconnect,
        mongodb::commands::mongo_disconnect_all,
        mongodb::commands::mongo_list_sessions,
        mongodb::commands::mongo_get_session,
        mongodb::commands::mongo_ping,
        mongodb::commands::mongo_list_databases,
        mongodb::commands::mongo_drop_database,
        mongodb::commands::mongo_list_collections,
        mongodb::commands::mongo_create_collection,
        mongodb::commands::mongo_drop_collection,
        mongodb::commands::mongo_collection_stats,
        mongodb::commands::mongo_find,
        mongodb::commands::mongo_count_documents,
        mongodb::commands::mongo_insert_one,
        mongodb::commands::mongo_insert_many,
        mongodb::commands::mongo_update_one,
        mongodb::commands::mongo_update_many,
        mongodb::commands::mongo_delete_one,
        mongodb::commands::mongo_delete_many,
        mongodb::commands::mongo_aggregate,
        mongodb::commands::mongo_run_command,
        mongodb::commands::mongo_list_indexes,
        mongodb::commands::mongo_create_index,
        mongodb::commands::mongo_drop_index,
        mongodb::commands::mongo_server_status,
        mongodb::commands::mongo_list_users,
        mongodb::commands::mongo_replica_set_status,
        mongodb::commands::mongo_current_op,
        mongodb::commands::mongo_kill_op,
        mongodb::commands::mongo_export_collection,
        // ── Redis ───────────────────────────────────────────────────
        redis::commands::redis_connect,
        redis::commands::redis_disconnect,
        redis::commands::redis_disconnect_all,
        redis::commands::redis_list_sessions,
        redis::commands::redis_get_session,
        redis::commands::redis_ping,
        redis::commands::redis_get,
        redis::commands::redis_set,
        redis::commands::redis_del,
        redis::commands::redis_exists,
        redis::commands::redis_expire,
        redis::commands::redis_persist,
        redis::commands::redis_ttl,
        redis::commands::redis_key_type,
        redis::commands::redis_rename,
        redis::commands::redis_scan,
        redis::commands::redis_key_info,
        redis::commands::redis_dbsize,
        redis::commands::redis_flushdb,
        redis::commands::redis_hgetall,
        redis::commands::redis_hget,
        redis::commands::redis_hset,
        redis::commands::redis_hdel,
        redis::commands::redis_lrange,
        redis::commands::redis_lpush,
        redis::commands::redis_rpush,
        redis::commands::redis_llen,
        redis::commands::redis_smembers,
        redis::commands::redis_sadd,
        redis::commands::redis_srem,
        redis::commands::redis_scard,
        redis::commands::redis_zrange_with_scores,
        redis::commands::redis_zadd,
        redis::commands::redis_zrem,
        redis::commands::redis_zcard,
        redis::commands::redis_server_info,
        redis::commands::redis_memory_info,
        redis::commands::redis_client_list,
        redis::commands::redis_client_kill,
        redis::commands::redis_slowlog_get,
        redis::commands::redis_config_get,
        redis::commands::redis_config_set,
        redis::commands::redis_raw_command,
        redis::commands::redis_select_db,
        // ── AI Agent ──────────────────────────────────────────────
        ai_agent::commands::ai_get_settings,
        ai_agent::commands::ai_update_settings,
        ai_agent::commands::ai_add_provider,
        ai_agent::commands::ai_remove_provider,
        ai_agent::commands::ai_list_providers,
        ai_agent::commands::ai_check_provider_health,
        ai_agent::commands::ai_create_conversation,
        ai_agent::commands::ai_get_conversation,
        ai_agent::commands::ai_delete_conversation,
        ai_agent::commands::ai_list_conversations,
        ai_agent::commands::ai_rename_conversation,
        ai_agent::commands::ai_pin_conversation,
        ai_agent::commands::ai_archive_conversation,
        ai_agent::commands::ai_set_conversation_tags,
        ai_agent::commands::ai_fork_conversation,
        ai_agent::commands::ai_search_conversations,
        ai_agent::commands::ai_export_conversation,
        ai_agent::commands::ai_import_conversation,
        ai_agent::commands::ai_send_message,
        ai_agent::commands::ai_get_messages,
        ai_agent::commands::ai_clear_messages,
        ai_agent::commands::ai_chat_completion,
        ai_agent::commands::ai_run_agent,
        ai_agent::commands::ai_code_assist,
        ai_agent::commands::ai_code_generate,
        ai_agent::commands::ai_code_review,
        ai_agent::commands::ai_code_refactor,
        ai_agent::commands::ai_code_explain,
        ai_agent::commands::ai_code_document,
        ai_agent::commands::ai_code_find_bugs,
        ai_agent::commands::ai_code_optimize,
        ai_agent::commands::ai_code_write_tests,
        ai_agent::commands::ai_code_convert,
        ai_agent::commands::ai_code_fix_error,
        ai_agent::commands::ai_list_templates,
        ai_agent::commands::ai_get_template,
        ai_agent::commands::ai_create_template,
        ai_agent::commands::ai_delete_template,
        ai_agent::commands::ai_render_template,
        ai_agent::commands::ai_add_memory,
        ai_agent::commands::ai_search_memory,
        ai_agent::commands::ai_list_memory,
        ai_agent::commands::ai_remove_memory,
        ai_agent::commands::ai_clear_memory,
        ai_agent::commands::ai_get_memory_config,
        ai_agent::commands::ai_update_memory_config,
        ai_agent::commands::ai_add_vector,
        ai_agent::commands::ai_search_vectors,
        ai_agent::commands::ai_ingest_document,
        ai_agent::commands::ai_remove_document,
        ai_agent::commands::ai_search_rag,
        ai_agent::commands::ai_list_rag_collections,
        ai_agent::commands::ai_create_workflow,
        ai_agent::commands::ai_get_workflow,
        ai_agent::commands::ai_delete_workflow,
        ai_agent::commands::ai_list_workflows,
        ai_agent::commands::ai_run_workflow,
        ai_agent::commands::ai_count_tokens,
        ai_agent::commands::ai_get_budget_status,
        ai_agent::commands::ai_update_budget,
        ai_agent::commands::ai_reset_budget,
        ai_agent::commands::ai_diagnostics,
        // ── 1Password ────────────────────────────────────────────────
        onepassword::op_get_config,
        onepassword::op_set_config,
        onepassword::op_connect,
        onepassword::op_disconnect,
        onepassword::op_is_authenticated,
        onepassword::op_list_vaults,
        onepassword::op_get_vault,
        onepassword::op_find_vault_by_name,
        onepassword::op_get_vault_stats,
        onepassword::op_list_items,
        onepassword::op_get_item,
        onepassword::op_find_items_by_title,
        onepassword::op_create_item,
        onepassword::op_update_item,
        onepassword::op_patch_item,
        onepassword::op_delete_item,
        onepassword::op_archive_item,
        onepassword::op_restore_item,
        onepassword::op_search_all_vaults,
        onepassword::op_get_password,
        onepassword::op_get_username,
        onepassword::op_add_field,
        onepassword::op_update_field_value,
        onepassword::op_remove_field,
        onepassword::op_list_files,
        onepassword::op_download_file,
        onepassword::op_get_totp_code,
        onepassword::op_add_totp,
        onepassword::op_watchtower_analyze_all,
        onepassword::op_watchtower_analyze_vault,
        onepassword::op_heartbeat,
        onepassword::op_health,
        onepassword::op_is_healthy,
        onepassword::op_get_activity,
        onepassword::op_list_favorites,
        onepassword::op_toggle_favorite,
        onepassword::op_export_vault_json,
        onepassword::op_export_vault_csv,
        onepassword::op_import_json,
        onepassword::op_import_csv,
        onepassword::op_generate_password,
        onepassword::op_generate_passphrase,
        onepassword::op_rate_password_strength,
        onepassword::op_list_categories,
        onepassword::op_invalidate_cache,
        // ── LastPass ─────────────────────────────────────────────────
        lastpass::lp_configure,
        lastpass::lp_login,
        lastpass::lp_logout,
        lastpass::lp_is_logged_in,
        lastpass::lp_is_configured,
        lastpass::lp_list_accounts,
        lastpass::lp_get_account,
        lastpass::lp_search_accounts,
        lastpass::lp_search_by_url,
        lastpass::lp_create_account,
        lastpass::lp_update_account,
        lastpass::lp_delete_account,
        lastpass::lp_toggle_favorite,
        lastpass::lp_move_account,
        lastpass::lp_get_favorites,
        lastpass::lp_get_duplicates,
        lastpass::lp_list_folders,
        lastpass::lp_create_folder,
        lastpass::lp_security_challenge,
        lastpass::lp_export_csv,
        lastpass::lp_export_json,
        lastpass::lp_import_csv,
        lastpass::lp_generate_password,
        lastpass::lp_generate_passphrase,
        lastpass::lp_check_password_strength,
        lastpass::lp_get_stats,
        lastpass::lp_invalidate_cache,
        // ── Google Passwords ─────────────────────────────────────────
        google_passwords::gp_configure,
        google_passwords::gp_is_configured,
        google_passwords::gp_is_authenticated,
        google_passwords::gp_get_auth_url,
        google_passwords::gp_authenticate,
        google_passwords::gp_refresh_auth,
        google_passwords::gp_logout,
        google_passwords::gp_list_credentials,
        google_passwords::gp_get_credential,
        google_passwords::gp_search_credentials,
        google_passwords::gp_search_by_url,
        google_passwords::gp_create_credential,
        google_passwords::gp_update_credential,
        google_passwords::gp_delete_credential,
        google_passwords::gp_run_checkup,
        google_passwords::gp_get_insecure_urls,
        google_passwords::gp_import_csv,
        google_passwords::gp_export_csv,
        google_passwords::gp_export_json,
        google_passwords::gp_generate_password,
        google_passwords::gp_check_password_strength,
        google_passwords::gp_get_stats,
        google_passwords::gp_get_sync_info,
        // ── Dashlane ─────────────────────────────────────────────────
        dashlane::dl_configure,
        dashlane::dl_login,
        dashlane::dl_login_with_token,
        dashlane::dl_logout,
        dashlane::dl_is_authenticated,
        dashlane::dl_list_credentials,
        dashlane::dl_get_credential,
        dashlane::dl_search_credentials,
        dashlane::dl_search_by_url,
        dashlane::dl_create_credential,
        dashlane::dl_update_credential,
        dashlane::dl_delete_credential,
        dashlane::dl_find_duplicate_passwords,
        dashlane::dl_get_categories,
        dashlane::dl_list_notes,
        dashlane::dl_get_note,
        dashlane::dl_search_notes,
        dashlane::dl_create_note,
        dashlane::dl_delete_note,
        dashlane::dl_list_identities,
        dashlane::dl_create_identity,
        dashlane::dl_list_secrets,
        dashlane::dl_create_secret,
        dashlane::dl_list_devices,
        dashlane::dl_deregister_device,
        dashlane::dl_list_sharing_groups,
        dashlane::dl_create_sharing_group,
        dashlane::dl_get_dark_web_alerts,
        dashlane::dl_get_active_dark_web_alerts,
        dashlane::dl_dismiss_dark_web_alert,
        dashlane::dl_get_password_health,
        dashlane::dl_generate_password,
        dashlane::dl_generate_passphrase,
        dashlane::dl_check_password_strength,
        dashlane::dl_export_csv,
        dashlane::dl_export_json,
        dashlane::dl_import_csv,
        dashlane::dl_get_stats,
        // Hyper-V commands — Config / Module
    ]
}
