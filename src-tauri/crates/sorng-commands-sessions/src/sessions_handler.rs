use crate::*;

pub fn is_command(command: &str) -> bool {
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
            | "mongo_server_status"
            | "mongo_list_users"
            | "mongo_replica_set_status"
            | "mongo_current_op"
            | "mongo_kill_op"
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

pub fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── MySQL ───────────────────────────────────────────────────
        mysql_commands::mysql_connect,
        mysql_commands::mysql_disconnect,
        mysql_commands::mysql_disconnect_all,
        mysql_commands::mysql_list_sessions,
        mysql_commands::mysql_get_session,
        mysql_commands::mysql_ping,
        mysql_commands::mysql_execute_query,
        mysql_commands::mysql_execute_statement,
        mysql_commands::mysql_explain_query,
        mysql_commands::mysql_list_databases,
        mysql_commands::mysql_list_tables,
        mysql_commands::mysql_describe_table,
        mysql_commands::mysql_list_indexes,
        mysql_commands::mysql_list_foreign_keys,
        mysql_commands::mysql_list_views,
        mysql_commands::mysql_list_routines,
        mysql_commands::mysql_list_triggers,
        mysql_commands::mysql_create_database,
        mysql_commands::mysql_drop_database,
        mysql_commands::mysql_drop_table,
        mysql_commands::mysql_truncate_table,
        mysql_commands::mysql_get_table_data,
        mysql_commands::mysql_insert_row,
        mysql_commands::mysql_update_rows,
        mysql_commands::mysql_delete_rows,
        mysql_commands::mysql_export_table,
        mysql_commands::mysql_export_database,
        mysql_commands::mysql_import_sql,
        mysql_commands::mysql_import_csv,
        mysql_commands::mysql_show_variables,
        mysql_commands::mysql_show_processlist,
        mysql_commands::mysql_kill_process,
        mysql_commands::mysql_list_users,
        mysql_commands::mysql_show_grants,
        mysql_commands::mysql_server_uptime,
        // ── PostgreSQL ──────────────────────────────────────────────
        postgres_commands::pg_connect,
        postgres_commands::pg_disconnect,
        postgres_commands::pg_disconnect_all,
        postgres_commands::pg_list_sessions,
        postgres_commands::pg_get_session,
        postgres_commands::pg_ping,
        postgres_commands::pg_execute_query,
        postgres_commands::pg_execute_statement,
        postgres_commands::pg_explain_query,
        postgres_commands::pg_list_databases,
        postgres_commands::pg_list_schemas,
        postgres_commands::pg_list_tables,
        postgres_commands::pg_describe_table,
        postgres_commands::pg_list_indexes,
        postgres_commands::pg_list_foreign_keys,
        postgres_commands::pg_list_views,
        postgres_commands::pg_list_routines,
        postgres_commands::pg_list_triggers,
        postgres_commands::pg_list_sequences,
        postgres_commands::pg_list_extensions,
        postgres_commands::pg_create_database,
        postgres_commands::pg_drop_database,
        postgres_commands::pg_create_schema,
        postgres_commands::pg_drop_schema,
        postgres_commands::pg_drop_table,
        postgres_commands::pg_truncate_table,
        postgres_commands::pg_get_table_data,
        postgres_commands::pg_insert_row,
        postgres_commands::pg_update_rows,
        postgres_commands::pg_delete_rows,
        postgres_commands::pg_export_table,
        postgres_commands::pg_export_schema,
        postgres_commands::pg_import_sql,
        postgres_commands::pg_import_csv,
        postgres_commands::pg_show_settings,
        postgres_commands::pg_show_activity,
        postgres_commands::pg_terminate_backend,
        postgres_commands::pg_cancel_backend,
        postgres_commands::pg_vacuum_table,
        postgres_commands::pg_list_roles,
        postgres_commands::pg_list_tablespaces,
        postgres_commands::pg_server_uptime,
        postgres_commands::pg_database_size,
        // ── MSSQL ───────────────────────────────────────────────────
        mssql_commands::mssql_connect,
        mssql_commands::mssql_disconnect,
        mssql_commands::mssql_disconnect_all,
        mssql_commands::mssql_list_sessions,
        mssql_commands::mssql_get_session,
        mssql_commands::mssql_execute_query,
        mssql_commands::mssql_execute_statement,
        mssql_commands::mssql_list_databases,
        mssql_commands::mssql_list_schemas,
        mssql_commands::mssql_list_tables,
        mssql_commands::mssql_describe_table,
        mssql_commands::mssql_list_indexes,
        mssql_commands::mssql_list_foreign_keys,
        mssql_commands::mssql_list_views,
        mssql_commands::mssql_list_stored_procs,
        mssql_commands::mssql_list_triggers,
        mssql_commands::mssql_create_database,
        mssql_commands::mssql_drop_database,
        mssql_commands::mssql_drop_table,
        mssql_commands::mssql_truncate_table,
        mssql_commands::mssql_get_table_data,
        mssql_commands::mssql_insert_row,
        mssql_commands::mssql_update_rows,
        mssql_commands::mssql_delete_rows,
        mssql_commands::mssql_export_table,
        mssql_commands::mssql_import_sql,
        mssql_commands::mssql_import_csv,
        mssql_commands::mssql_server_properties,
        mssql_commands::mssql_show_processes,
        mssql_commands::mssql_kill_process,
        mssql_commands::mssql_list_logins,
        // ── SQLite ──────────────────────────────────────────────────
        sqlite_commands::sqlite_connect,
        sqlite_commands::sqlite_disconnect,
        sqlite_commands::sqlite_disconnect_all,
        sqlite_commands::sqlite_list_sessions,
        sqlite_commands::sqlite_get_session,
        sqlite_commands::sqlite_ping,
        sqlite_commands::sqlite_execute_query,
        sqlite_commands::sqlite_execute_statement,
        sqlite_commands::sqlite_explain_query,
        sqlite_commands::sqlite_list_tables,
        sqlite_commands::sqlite_describe_table,
        sqlite_commands::sqlite_list_indexes,
        sqlite_commands::sqlite_list_foreign_keys,
        sqlite_commands::sqlite_list_triggers,
        sqlite_commands::sqlite_list_attached_databases,
        sqlite_commands::sqlite_get_pragma,
        sqlite_commands::sqlite_set_pragma,
        sqlite_commands::sqlite_drop_table,
        sqlite_commands::sqlite_vacuum,
        sqlite_commands::sqlite_integrity_check,
        sqlite_commands::sqlite_attach_database,
        sqlite_commands::sqlite_detach_database,
        sqlite_commands::sqlite_get_table_data,
        sqlite_commands::sqlite_insert_row,
        sqlite_commands::sqlite_update_rows,
        sqlite_commands::sqlite_delete_rows,
        sqlite_commands::sqlite_export_table,
        sqlite_commands::sqlite_export_database,
        sqlite_commands::sqlite_import_sql,
        sqlite_commands::sqlite_import_csv,
        sqlite_commands::sqlite_database_size,
        sqlite_commands::sqlite_table_count,
        // ── MongoDB ─────────────────────────────────────────────────
        mongodb_commands::mongo_connect,
        mongodb_commands::mongo_disconnect,
        mongodb_commands::mongo_disconnect_all,
        mongodb_commands::mongo_list_sessions,
        mongodb_commands::mongo_get_session,
        mongodb_commands::mongo_ping,
        mongodb_commands::mongo_list_databases,
        mongodb_commands::mongo_drop_database,
        mongodb_commands::mongo_list_collections,
        mongodb_commands::mongo_create_collection,
        mongodb_commands::mongo_drop_collection,
        mongodb_commands::mongo_collection_stats,
        mongodb_commands::mongo_server_status,
        mongodb_commands::mongo_list_users,
        mongodb_commands::mongo_replica_set_status,
        mongodb_commands::mongo_current_op,
        mongodb_commands::mongo_kill_op,
        // ── Redis ───────────────────────────────────────────────────
        redis_commands::redis_connect,
        redis_commands::redis_disconnect,
        redis_commands::redis_disconnect_all,
        redis_commands::redis_list_sessions,
        redis_commands::redis_get_session,
        redis_commands::redis_ping,
        redis_commands::redis_get,
        redis_commands::redis_set,
        redis_commands::redis_del,
        redis_commands::redis_exists,
        redis_commands::redis_expire,
        redis_commands::redis_persist,
        redis_commands::redis_ttl,
        redis_commands::redis_key_type,
        redis_commands::redis_rename,
        redis_commands::redis_scan,
        redis_commands::redis_key_info,
        redis_commands::redis_dbsize,
        redis_commands::redis_flushdb,
        redis_commands::redis_hgetall,
        redis_commands::redis_hget,
        redis_commands::redis_hset,
        redis_commands::redis_hdel,
        redis_commands::redis_lrange,
        redis_commands::redis_lpush,
        redis_commands::redis_rpush,
        redis_commands::redis_llen,
        redis_commands::redis_smembers,
        redis_commands::redis_sadd,
        redis_commands::redis_srem,
        redis_commands::redis_scard,
        redis_commands::redis_zrange_with_scores,
        redis_commands::redis_zadd,
        redis_commands::redis_zrem,
        redis_commands::redis_zcard,
        redis_commands::redis_server_info,
        redis_commands::redis_memory_info,
        redis_commands::redis_client_list,
        redis_commands::redis_client_kill,
        redis_commands::redis_slowlog_get,
        redis_commands::redis_config_get,
        redis_commands::redis_config_set,
        redis_commands::redis_raw_command,
        redis_commands::redis_select_db,
        // ── AI Agent ──────────────────────────────────────────────
        ai_agent_commands::ai_get_settings,
        ai_agent_commands::ai_update_settings,
        ai_agent_commands::ai_add_provider,
        ai_agent_commands::ai_remove_provider,
        ai_agent_commands::ai_list_providers,
        ai_agent_commands::ai_check_provider_health,
        ai_agent_commands::ai_create_conversation,
        ai_agent_commands::ai_get_conversation,
        ai_agent_commands::ai_delete_conversation,
        ai_agent_commands::ai_list_conversations,
        ai_agent_commands::ai_rename_conversation,
        ai_agent_commands::ai_pin_conversation,
        ai_agent_commands::ai_archive_conversation,
        ai_agent_commands::ai_set_conversation_tags,
        ai_agent_commands::ai_fork_conversation,
        ai_agent_commands::ai_search_conversations,
        ai_agent_commands::ai_export_conversation,
        ai_agent_commands::ai_import_conversation,
        ai_agent_commands::ai_send_message,
        ai_agent_commands::ai_get_messages,
        ai_agent_commands::ai_clear_messages,
        ai_agent_commands::ai_chat_completion,
        ai_agent_commands::ai_run_agent,
        ai_agent_commands::ai_code_assist,
        ai_agent_commands::ai_code_generate,
        ai_agent_commands::ai_code_review,
        ai_agent_commands::ai_code_refactor,
        ai_agent_commands::ai_code_explain,
        ai_agent_commands::ai_code_document,
        ai_agent_commands::ai_code_find_bugs,
        ai_agent_commands::ai_code_optimize,
        ai_agent_commands::ai_code_write_tests,
        ai_agent_commands::ai_code_convert,
        ai_agent_commands::ai_code_fix_error,
        ai_agent_commands::ai_list_templates,
        ai_agent_commands::ai_get_template,
        ai_agent_commands::ai_create_template,
        ai_agent_commands::ai_delete_template,
        ai_agent_commands::ai_render_template,
        ai_agent_commands::ai_add_memory,
        ai_agent_commands::ai_search_memory,
        ai_agent_commands::ai_list_memory,
        ai_agent_commands::ai_remove_memory,
        ai_agent_commands::ai_clear_memory,
        ai_agent_commands::ai_get_memory_config,
        ai_agent_commands::ai_update_memory_config,
        ai_agent_commands::ai_add_vector,
        ai_agent_commands::ai_search_vectors,
        ai_agent_commands::ai_ingest_document,
        ai_agent_commands::ai_remove_document,
        ai_agent_commands::ai_search_rag,
        ai_agent_commands::ai_list_rag_collections,
        ai_agent_commands::ai_create_workflow,
        ai_agent_commands::ai_get_workflow,
        ai_agent_commands::ai_delete_workflow,
        ai_agent_commands::ai_list_workflows,
        ai_agent_commands::ai_run_workflow,
        ai_agent_commands::ai_count_tokens,
        ai_agent_commands::ai_get_budget_status,
        ai_agent_commands::ai_update_budget,
        ai_agent_commands::ai_reset_budget,
        ai_agent_commands::ai_diagnostics,
        // ── 1Password ────────────────────────────────────────────────
        onepassword_commands::op_get_config,
        onepassword_commands::op_set_config,
        onepassword_commands::op_connect,
        onepassword_commands::op_disconnect,
        onepassword_commands::op_is_authenticated,
        onepassword_commands::op_list_vaults,
        onepassword_commands::op_get_vault,
        onepassword_commands::op_find_vault_by_name,
        onepassword_commands::op_get_vault_stats,
        onepassword_commands::op_list_items,
        onepassword_commands::op_get_item,
        onepassword_commands::op_find_items_by_title,
        onepassword_commands::op_create_item,
        onepassword_commands::op_update_item,
        onepassword_commands::op_patch_item,
        onepassword_commands::op_delete_item,
        onepassword_commands::op_archive_item,
        onepassword_commands::op_restore_item,
        onepassword_commands::op_search_all_vaults,
        onepassword_commands::op_get_password,
        onepassword_commands::op_get_username,
        onepassword_commands::op_add_field,
        onepassword_commands::op_update_field_value,
        onepassword_commands::op_remove_field,
        onepassword_commands::op_list_files,
        onepassword_commands::op_download_file,
        onepassword_commands::op_get_totp_code,
        onepassword_commands::op_add_totp,
        onepassword_commands::op_watchtower_analyze_all,
        onepassword_commands::op_watchtower_analyze_vault,
        onepassword_commands::op_heartbeat,
        onepassword_commands::op_health,
        onepassword_commands::op_is_healthy,
        onepassword_commands::op_get_activity,
        onepassword_commands::op_list_favorites,
        onepassword_commands::op_toggle_favorite,
        onepassword_commands::op_export_vault_json,
        onepassword_commands::op_export_vault_csv,
        onepassword_commands::op_import_json,
        onepassword_commands::op_import_csv,
        onepassword_commands::op_generate_password,
        onepassword_commands::op_generate_passphrase,
        onepassword_commands::op_rate_password_strength,
        onepassword_commands::op_list_categories,
        onepassword_commands::op_invalidate_cache,
        // ── LastPass ─────────────────────────────────────────────────
        lastpass_commands::lp_configure,
        lastpass_commands::lp_login,
        lastpass_commands::lp_logout,
        lastpass_commands::lp_is_logged_in,
        lastpass_commands::lp_is_configured,
        lastpass_commands::lp_list_accounts,
        lastpass_commands::lp_get_account,
        lastpass_commands::lp_search_accounts,
        lastpass_commands::lp_search_by_url,
        lastpass_commands::lp_create_account,
        lastpass_commands::lp_update_account,
        lastpass_commands::lp_delete_account,
        lastpass_commands::lp_toggle_favorite,
        lastpass_commands::lp_move_account,
        lastpass_commands::lp_get_favorites,
        lastpass_commands::lp_get_duplicates,
        lastpass_commands::lp_list_folders,
        lastpass_commands::lp_create_folder,
        lastpass_commands::lp_security_challenge,
        lastpass_commands::lp_export_csv,
        lastpass_commands::lp_export_json,
        lastpass_commands::lp_import_csv,
        lastpass_commands::lp_generate_password,
        lastpass_commands::lp_generate_passphrase,
        lastpass_commands::lp_check_password_strength,
        lastpass_commands::lp_get_stats,
        lastpass_commands::lp_invalidate_cache,
        // ── Google Passwords ─────────────────────────────────────────
        google_passwords_commands::gp_configure,
        google_passwords_commands::gp_is_configured,
        google_passwords_commands::gp_is_authenticated,
        google_passwords_commands::gp_get_auth_url,
        google_passwords_commands::gp_authenticate,
        google_passwords_commands::gp_refresh_auth,
        google_passwords_commands::gp_logout,
        google_passwords_commands::gp_list_credentials,
        google_passwords_commands::gp_get_credential,
        google_passwords_commands::gp_search_credentials,
        google_passwords_commands::gp_search_by_url,
        google_passwords_commands::gp_create_credential,
        google_passwords_commands::gp_update_credential,
        google_passwords_commands::gp_delete_credential,
        google_passwords_commands::gp_run_checkup,
        google_passwords_commands::gp_get_insecure_urls,
        google_passwords_commands::gp_import_csv,
        google_passwords_commands::gp_export_csv,
        google_passwords_commands::gp_export_json,
        google_passwords_commands::gp_generate_password,
        google_passwords_commands::gp_check_password_strength,
        google_passwords_commands::gp_get_stats,
        google_passwords_commands::gp_get_sync_info,
        // ── Dashlane ─────────────────────────────────────────────────
        dashlane_commands::dl_configure,
        dashlane_commands::dl_login,
        dashlane_commands::dl_login_with_token,
        dashlane_commands::dl_logout,
        dashlane_commands::dl_is_authenticated,
        dashlane_commands::dl_list_credentials,
        dashlane_commands::dl_get_credential,
        dashlane_commands::dl_search_credentials,
        dashlane_commands::dl_search_by_url,
        dashlane_commands::dl_create_credential,
        dashlane_commands::dl_update_credential,
        dashlane_commands::dl_delete_credential,
        dashlane_commands::dl_find_duplicate_passwords,
        dashlane_commands::dl_get_categories,
        dashlane_commands::dl_list_notes,
        dashlane_commands::dl_get_note,
        dashlane_commands::dl_search_notes,
        dashlane_commands::dl_create_note,
        dashlane_commands::dl_delete_note,
        dashlane_commands::dl_list_identities,
        dashlane_commands::dl_create_identity,
        dashlane_commands::dl_list_secrets,
        dashlane_commands::dl_create_secret,
        dashlane_commands::dl_list_devices,
        dashlane_commands::dl_deregister_device,
        dashlane_commands::dl_list_sharing_groups,
        dashlane_commands::dl_create_sharing_group,
        dashlane_commands::dl_get_dark_web_alerts,
        dashlane_commands::dl_get_active_dark_web_alerts,
        dashlane_commands::dl_dismiss_dark_web_alert,
        dashlane_commands::dl_get_password_health,
        dashlane_commands::dl_generate_password,
        dashlane_commands::dl_generate_passphrase,
        dashlane_commands::dl_check_password_strength,
        dashlane_commands::dl_export_csv,
        dashlane_commands::dl_export_json,
        dashlane_commands::dl_import_csv,
        dashlane_commands::dl_get_stats,
        // Hyper-V commands — Config / Module
    ]
}
