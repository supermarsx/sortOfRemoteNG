use crate::*;

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "rec_get_config"
            | "rec_update_config"
            | "rec_start_terminal"
            | "rec_stop_terminal"
            | "rec_terminal_status"
            | "rec_is_terminal_recording"
            | "rec_append_terminal_output"
            | "rec_append_terminal_input"
            | "rec_append_terminal_resize"
            | "rec_start_screen"
            | "rec_stop_screen"
            | "rec_screen_status"
            | "rec_is_screen_recording"
            | "rec_append_screen_frame"
            | "rec_start_http"
            | "rec_stop_http"
            | "rec_http_status"
            | "rec_is_http_recording"
            | "rec_append_http_entry"
            | "rec_start_telnet"
            | "rec_stop_telnet"
            | "rec_telnet_status"
            | "rec_is_telnet_recording"
            | "rec_append_telnet_entry"
            | "rec_start_serial"
            | "rec_stop_serial"
            | "rec_serial_status"
            | "rec_is_serial_recording"
            | "rec_append_serial_entry"
            | "rec_start_db"
            | "rec_stop_db"
            | "rec_db_status"
            | "rec_is_db_recording"
            | "rec_append_db_entry"
            | "rec_start_macro"
            | "rec_macro_input"
            | "rec_stop_macro"
            | "rec_is_macro_recording"
            | "rec_list_macros"
            | "rec_get_macro"
            | "rec_update_macro"
            | "rec_delete_macro"
            | "rec_import_macro"
            | "rec_encode_asciicast"
            | "rec_encode_script"
            | "rec_encode_har"
            | "rec_encode_db_csv"
            | "rec_encode_http_csv"
            | "rec_encode_telnet_asciicast"
            | "rec_encode_serial_raw"
            | "rec_encode_frame_manifest"
            | "rec_compress"
            | "rec_decompress"
            | "rec_save_terminal"
            | "rec_save_http"
            | "rec_save_screen"
            | "rec_library_list"
            | "rec_library_get"
            | "rec_library_by_protocol"
            | "rec_library_search"
            | "rec_library_rename"
            | "rec_library_update_tags"
            | "rec_library_delete"
            | "rec_library_clear"
            | "rec_library_summary"
            | "rec_list_active"
            | "rec_active_count"
            | "rec_stop_all"
            | "rec_list_jobs"
            | "rec_get_job"
            | "rec_clear_jobs"
            | "rec_run_cleanup"
            | "rec_storage_size"
            | "llm_add_provider"
            | "llm_remove_provider"
            | "llm_update_provider"
            | "llm_list_providers"
            | "llm_set_default_provider"
            | "llm_chat_completion"
            | "llm_create_embedding"
            | "llm_list_models"
            | "llm_models_for_provider"
            | "llm_model_info"
            | "llm_health_check"
            | "llm_health_check_all"
            | "llm_usage_summary"
            | "llm_cache_stats"
            | "llm_clear_cache"
            | "llm_status"
            | "llm_get_config"
            | "llm_update_config"
            | "llm_set_balancer_strategy"
            | "llm_estimate_tokens"
            | "ai_assist_create_session"
            | "ai_assist_remove_session"
            | "ai_assist_list_sessions"
            | "ai_assist_update_context"
            | "ai_assist_record_command"
            | "ai_assist_set_tools"
            | "ai_assist_complete"
            | "ai_assist_explain_error"
            | "ai_assist_lookup_command"
            | "ai_assist_search_commands"
            | "ai_assist_translate"
            | "ai_assist_assess_risk"
            | "ai_assist_quick_risk"
            | "ai_assist_list_snippets"
            | "ai_assist_search_snippets"
            | "ai_assist_get_snippet"
            | "ai_assist_render_snippet"
            | "ai_assist_add_snippet"
            | "ai_assist_remove_snippet"
            | "ai_assist_analyze_history"
            | "ai_assist_get_config"
            | "ai_assist_update_config"
            | "palette_search"
            | "palette_record_command"
            | "palette_search_history"
            | "palette_get_history"
            | "palette_pin_command"
            | "palette_tag_command"
            | "palette_remove_history"
            | "palette_clear_history"
            | "palette_add_snippet"
            | "palette_get_snippet"
            | "palette_update_snippet"
            | "palette_remove_snippet"
            | "palette_list_snippets"
            | "palette_search_snippets"
            | "palette_render_snippet"
            | "palette_import_snippets"
            | "palette_export_snippets"
            | "palette_add_alias"
            | "palette_remove_alias"
            | "palette_list_aliases"
            | "palette_get_config"
            | "palette_update_config"
            | "palette_get_stats"
            | "palette_save"
            | "palette_export"
            | "palette_import"
            | "palette_export_advanced"
            | "palette_export_history"
            | "palette_export_snippets_filtered"
            | "palette_validate_import"
            | "palette_validate_import_file"
            | "palette_preview_import"
            | "palette_preview_import_file"
            | "palette_import_advanced"
            | "palette_import_file_advanced"
            | "palette_create_share_package"
            | "palette_import_share_package"
            | "palette_export_clipboard"
            | "palette_import_clipboard"
            | "palette_save_share_package"
            | "palette_import_share_package_file"
            | "palette_get_snapshot_stats"
            | "palette_list_os_families"
            | "palette_list_os_distros"
            | "palette_snippets_by_os"
            | "palette_snippets_by_os_family"
            | "palette_snippets_universal"
            | "palette_set_snippet_os_target"
            | "palette_set_alias_os_target"
            | "fonts_list_all"
            | "fonts_by_category"
            | "fonts_get"
            | "fonts_search"
            | "fonts_list_monospace"
            | "fonts_list_with_ligatures"
            | "fonts_list_with_nerd_font"
            | "fonts_get_stats"
            | "fonts_list_stacks"
            | "fonts_get_stack"
            | "fonts_create_stack"
            | "fonts_delete_stack"
            | "fonts_get_config"
            | "fonts_update_ssh_terminal"
            | "fonts_update_app_ui"
            | "fonts_update_code_editor"
            | "fonts_update_tab_bar"
            | "fonts_update_log_viewer"
            | "fonts_set_connection_override"
            | "fonts_remove_connection_override"
            | "fonts_resolve_connection"
            | "fonts_add_favourite"
            | "fonts_remove_favourite"
            | "fonts_get_favourites"
            | "fonts_get_recent"
            | "fonts_record_recent"
            | "fonts_list_presets"
            | "fonts_apply_preset"
            | "fonts_detect_system"
            | "fonts_detect_system_monospace"
            | "fonts_resolve_css"
            | "fonts_resolve_settings_css"
            | "fonts_save"
            | "fonts_export"
            | "fonts_import"
            | "secure_clip_copy"
            | "secure_clip_copy_password"
            | "secure_clip_copy_totp"
            | "secure_clip_copy_username"
            | "secure_clip_copy_passphrase"
            | "secure_clip_copy_api_key"
            | "secure_clip_paste"
            | "secure_clip_paste_by_id"
            | "secure_clip_paste_to_terminal"
            | "secure_clip_record_terminal_paste"
            | "secure_clip_clear"
            | "secure_clip_on_app_lock"
            | "secure_clip_on_app_exit"
            | "secure_clip_get_current"
            | "secure_clip_has_entry"
            | "secure_clip_get_stats"
            | "secure_clip_get_history"
            | "secure_clip_get_history_for_connection"
            | "secure_clip_clear_history"
            | "secure_clip_get_config"
            | "secure_clip_update_config"
            | "secure_clip_read_os_clipboard"
            | "terminal_themes_list"
            | "terminal_themes_list_dark"
            | "terminal_themes_list_light"
            | "terminal_themes_list_by_category"
            | "terminal_themes_search"
            | "terminal_themes_get"
            | "terminal_themes_get_active"
            | "terminal_themes_get_active_id"
            | "terminal_themes_get_session_theme"
            | "terminal_themes_get_xterm"
            | "terminal_themes_get_css_vars"
            | "terminal_themes_recent"
            | "terminal_themes_count"
            | "terminal_themes_set_active"
            | "terminal_themes_set_session"
            | "terminal_themes_clear_session"
            | "terminal_themes_register"
            | "terminal_themes_update"
            | "terminal_themes_remove"
            | "terminal_themes_duplicate"
            | "terminal_themes_create_custom"
            | "terminal_themes_derive_hue"
            | "terminal_themes_generate_from_accent"
            | "terminal_themes_export_json"
            | "terminal_themes_export_iterm2"
            | "terminal_themes_export_windows_terminal"
            | "terminal_themes_export_alacritty"
            | "terminal_themes_export_xterm"
            | "terminal_themes_import"
            | "terminal_themes_check_contrast"
            | "terminal_themes_blend_colors"
            | "terminal_themes_validate"
            | "ext_install"
            | "ext_install_with_manifest"
            | "ext_enable"
            | "ext_disable"
            | "ext_uninstall"
            | "ext_update"
            | "ext_execute_handler"
            | "ext_dispatch_event"
            | "ext_storage_get"
            | "ext_storage_set"
            | "ext_storage_delete"
            | "ext_storage_list_keys"
            | "ext_storage_clear"
            | "ext_storage_export"
            | "ext_storage_import"
            | "ext_storage_summary"
            | "ext_get_setting"
            | "ext_set_setting"
            | "ext_get_extension"
            | "ext_list_extensions"
            | "ext_engine_stats"
            | "ext_validate_manifest"
            | "ext_create_manifest_template"
            | "ext_api_documentation"
            | "ext_permission_groups"
            | "ext_get_config"
            | "ext_update_config"
            | "ext_audit_log"
            | "ext_dispatch_log"
            | "k8s_connect"
            | "k8s_connect_kubeconfig"
            | "k8s_disconnect"
            | "k8s_list_connections"
            | "k8s_kubeconfig_default_path"
            | "k8s_kubeconfig_load"
            | "k8s_kubeconfig_parse"
            | "k8s_kubeconfig_list_contexts"
            | "k8s_kubeconfig_validate"
            | "k8s_cluster_info"
            | "k8s_health_check"
            | "k8s_list_namespaces"
            | "k8s_get_namespace"
            | "k8s_create_namespace"
            | "k8s_delete_namespace"
            | "k8s_update_namespace_labels"
            | "k8s_list_resource_quotas"
            | "k8s_get_resource_quota"
            | "k8s_create_resource_quota"
            | "k8s_delete_resource_quota"
            | "k8s_list_limit_ranges"
            | "k8s_list_pods"
            | "k8s_list_all_pods"
            | "k8s_get_pod"
            | "k8s_create_pod"
            | "k8s_delete_pod"
            | "k8s_pod_logs"
            | "k8s_evict_pod"
            | "k8s_update_pod_labels"
            | "k8s_update_pod_annotations"
            | "k8s_list_deployments"
            | "k8s_list_all_deployments"
            | "k8s_get_deployment"
            | "k8s_create_deployment"
            | "k8s_update_deployment"
            | "k8s_patch_deployment"
            | "k8s_delete_deployment"
            | "k8s_scale_deployment"
            | "k8s_restart_deployment"
            | "k8s_pause_deployment"
            | "k8s_resume_deployment"
            | "k8s_set_deployment_image"
            | "k8s_deployment_rollout_status"
            | "k8s_rollback_deployment"
            | "k8s_list_statefulsets"
            | "k8s_list_daemonsets"
            | "k8s_list_replicasets"
            | "k8s_list_services"
            | "k8s_list_all_services"
            | "k8s_get_service"
            | "k8s_create_service"
            | "k8s_update_service"
            | "k8s_patch_service"
            | "k8s_delete_service"
            | "k8s_get_endpoints"
            | "k8s_list_configmaps"
            | "k8s_get_configmap"
            | "k8s_create_configmap"
            | "k8s_update_configmap"
            | "k8s_patch_configmap"
            | "k8s_delete_configmap"
            | "k8s_list_secrets"
            | "k8s_get_secret"
            | "k8s_create_secret"
            | "k8s_update_secret"
            | "k8s_patch_secret"
            | "k8s_delete_secret"
            | "k8s_list_ingresses"
            | "k8s_get_ingress"
            | "k8s_create_ingress"
            | "k8s_update_ingress"
            | "k8s_delete_ingress"
            | "k8s_list_ingress_classes"
            | "k8s_list_network_policies"
            | "k8s_get_network_policy"
            | "k8s_create_network_policy"
            | "k8s_delete_network_policy"
            | "k8s_list_jobs"
            | "k8s_get_job"
            | "k8s_create_job"
            | "k8s_delete_job"
            | "k8s_suspend_job"
            | "k8s_resume_job"
            | "k8s_list_cronjobs"
            | "k8s_get_cronjob"
            | "k8s_create_cronjob"
            | "k8s_delete_cronjob"
            | "k8s_suspend_cronjob"
            | "k8s_resume_cronjob"
            | "k8s_trigger_cronjob"
            | "k8s_list_nodes"
            | "k8s_get_node"
            | "k8s_cordon_node"
            | "k8s_uncordon_node"
            | "k8s_drain_node"
            | "k8s_add_node_taint"
            | "k8s_remove_node_taint"
            | "k8s_update_node_labels"
            | "k8s_list_persistent_volumes"
            | "k8s_list_pvcs"
            | "k8s_list_storage_classes"
            | "k8s_list_roles"
            | "k8s_list_cluster_roles"
            | "k8s_list_role_bindings"
            | "k8s_list_cluster_role_bindings"
            | "k8s_list_service_accounts"
            | "k8s_create_service_account_token"
            | "k8s_helm_is_available"
            | "k8s_helm_version"
            | "k8s_helm_list_releases"
            | "k8s_helm_get_release"
            | "k8s_helm_release_history"
            | "k8s_helm_install"
            | "k8s_helm_upgrade"
            | "k8s_helm_rollback"
            | "k8s_helm_uninstall"
            | "k8s_helm_get_values"
            | "k8s_helm_get_manifest"
            | "k8s_helm_template"
            | "k8s_helm_list_repos"
            | "k8s_helm_add_repo"
            | "k8s_helm_remove_repo"
            | "k8s_helm_update_repos"
            | "k8s_helm_search_charts"
            | "k8s_list_events"
            | "k8s_list_all_events"
            | "k8s_list_events_for_resource"
            | "k8s_filter_events"
            | "k8s_list_warnings"
            | "k8s_list_crds"
            | "k8s_get_crd"
            | "k8s_list_hpas"
            | "k8s_get_hpa"
            | "k8s_metrics_available"
            | "k8s_node_metrics"
            | "k8s_pod_metrics"
            | "k8s_cluster_resource_summary"
            | "docker_connect"
            | "docker_disconnect"
            | "docker_list_connections"
            | "docker_system_info"
            | "docker_system_version"
            | "docker_ping"
            | "docker_disk_usage"
            | "docker_system_events"
            | "docker_system_prune"
            | "docker_list_containers"
            | "docker_inspect_container"
            | "docker_create_container"
            | "docker_run_container"
            | "docker_start_container"
            | "docker_stop_container"
            | "docker_restart_container"
            | "docker_kill_container"
            | "docker_pause_container"
            | "docker_unpause_container"
            | "docker_remove_container"
            | "docker_rename_container"
            | "docker_container_logs"
            | "docker_container_stats"
            | "docker_container_top"
            | "docker_container_changes"
            | "docker_container_wait"
            | "docker_container_exec"
            | "docker_container_update"
            | "docker_prune_containers"
            | "docker_list_images"
            | "docker_inspect_image"
            | "docker_image_history"
            | "docker_pull_image"
            | "docker_tag_image"
            | "docker_push_image"
            | "docker_remove_image"
            | "docker_search_images"
            | "docker_prune_images"
            | "docker_commit_container"
            | "docker_list_volumes"
            | "docker_inspect_volume"
            | "docker_create_volume"
            | "docker_remove_volume"
            | "docker_prune_volumes"
            | "docker_list_networks"
            | "docker_inspect_network"
            | "docker_create_network"
            | "docker_remove_network"
            | "docker_connect_network"
            | "docker_disconnect_network"
            | "docker_prune_networks"
            | "docker_compose_is_available"
            | "docker_compose_version"
            | "docker_compose_list_projects"
            | "docker_compose_up"
            | "docker_compose_down"
            | "docker_compose_ps"
            | "docker_compose_logs"
            | "docker_compose_build"
            | "docker_compose_pull"
            | "docker_compose_restart"
            | "docker_compose_stop"
            | "docker_compose_start"
            | "docker_compose_config"
            | "docker_registry_login"
            | "docker_registry_search"
            | "ansible_connect"
            | "ansible_disconnect"
            | "ansible_list_connections"
            | "ansible_is_available"
            | "ansible_get_info"
            | "ansible_inventory_parse"
            | "ansible_inventory_graph"
            | "ansible_inventory_list_hosts"
            | "ansible_inventory_host_vars"
            | "ansible_inventory_add_host"
            | "ansible_inventory_remove_host"
            | "ansible_inventory_add_group"
            | "ansible_inventory_remove_group"
            | "ansible_inventory_dynamic"
            | "ansible_playbook_parse"
            | "ansible_playbook_list"
            | "ansible_playbook_syntax_check"
            | "ansible_playbook_lint"
            | "ansible_playbook_run"
            | "ansible_playbook_check"
            | "ansible_playbook_diff"
            | "ansible_adhoc_run"
            | "ansible_adhoc_ping"
            | "ansible_adhoc_shell"
            | "ansible_adhoc_copy"
            | "ansible_adhoc_service"
            | "ansible_adhoc_package"
            | "ansible_roles_list"
            | "ansible_role_inspect"
            | "ansible_role_init"
            | "ansible_role_dependencies"
            | "ansible_role_install_deps"
            | "ansible_vault_encrypt"
            | "ansible_vault_decrypt"
            | "ansible_vault_view"
            | "ansible_vault_rekey"
            | "ansible_vault_encrypt_string"
            | "ansible_vault_is_encrypted"
            | "ansible_galaxy_install_role"
            | "ansible_galaxy_list_roles"
            | "ansible_galaxy_remove_role"
            | "ansible_galaxy_install_collection"
            | "ansible_galaxy_list_collections"
            | "ansible_galaxy_remove_collection"
            | "ansible_galaxy_search"
            | "ansible_galaxy_role_info"
            | "ansible_galaxy_install_requirements"
            | "ansible_facts_gather"
            | "ansible_facts_gather_min"
            | "ansible_config_dump"
            | "ansible_config_get"
            | "ansible_config_parse_file"
            | "ansible_config_detect_path"
            | "ansible_list_modules"
            | "ansible_module_doc"
            | "ansible_module_examples"
            | "ansible_list_plugins"
            | "ansible_history_list"
            | "ansible_history_get"
            | "ansible_history_clear"
            | "terraform_connect"
            | "terraform_disconnect"
            | "terraform_list_connections"
            | "terraform_is_available"
            | "terraform_get_info"
            | "terraform_init"
            | "terraform_init_no_backend"
            | "terraform_plan"
            | "terraform_show_plan_json"
            | "terraform_show_plan_text"
            | "terraform_apply"
            | "terraform_destroy"
            | "terraform_refresh"
            | "terraform_state_list"
            | "terraform_state_show"
            | "terraform_state_show_json"
            | "terraform_state_pull"
            | "terraform_state_push"
            | "terraform_state_mv"
            | "terraform_state_rm"
            | "terraform_state_import"
            | "terraform_state_taint"
            | "terraform_state_untaint"
            | "terraform_state_force_unlock"
            | "terraform_workspace_list"
            | "terraform_workspace_show"
            | "terraform_workspace_new"
            | "terraform_workspace_select"
            | "terraform_workspace_delete"
            | "terraform_validate"
            | "terraform_fmt"
            | "terraform_fmt_check"
            | "terraform_output_list"
            | "terraform_output_get"
            | "terraform_output_get_raw"
            | "terraform_providers_list"
            | "terraform_providers_schemas"
            | "terraform_providers_lock"
            | "terraform_providers_mirror"
            | "terraform_providers_parse_lock_file"
            | "terraform_modules_get"
            | "terraform_modules_list_installed"
            | "terraform_modules_search_registry"
            | "terraform_graph_generate"
            | "terraform_graph_plan"
            | "terraform_hcl_analyse"
            | "terraform_hcl_analyse_file"
            | "terraform_hcl_summarise"
            | "terraform_drift_detect"
            | "terraform_drift_has_drift"
            | "terraform_drift_compare_snapshots"
            | "terraform_history_list"
            | "terraform_history_get"
            | "terraform_history_clear"
    )
}

pub(crate) fn build() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── Recording engine commands ────────────────────────────────
        // Config
        recording::commands::rec_get_config,
        recording::commands::rec_update_config,
        // Terminal recording (SSH, Telnet, etc.)
        recording::commands::rec_start_terminal,
        recording::commands::rec_stop_terminal,
        recording::commands::rec_terminal_status,
        recording::commands::rec_is_terminal_recording,
        recording::commands::rec_append_terminal_output,
        recording::commands::rec_append_terminal_input,
        recording::commands::rec_append_terminal_resize,
        // Screen recording (RDP, VNC)
        recording::commands::rec_start_screen,
        recording::commands::rec_stop_screen,
        recording::commands::rec_screen_status,
        recording::commands::rec_is_screen_recording,
        recording::commands::rec_append_screen_frame,
        // HTTP / HAR recording
        recording::commands::rec_start_http,
        recording::commands::rec_stop_http,
        recording::commands::rec_http_status,
        recording::commands::rec_is_http_recording,
        recording::commands::rec_append_http_entry,
        // Telnet recording
        recording::commands::rec_start_telnet,
        recording::commands::rec_stop_telnet,
        recording::commands::rec_telnet_status,
        recording::commands::rec_is_telnet_recording,
        recording::commands::rec_append_telnet_entry,
        // Serial recording
        recording::commands::rec_start_serial,
        recording::commands::rec_stop_serial,
        recording::commands::rec_serial_status,
        recording::commands::rec_is_serial_recording,
        recording::commands::rec_append_serial_entry,
        // Database query recording
        recording::commands::rec_start_db,
        recording::commands::rec_stop_db,
        recording::commands::rec_db_status,
        recording::commands::rec_is_db_recording,
        recording::commands::rec_append_db_entry,
        // Macro recording & CRUD
        recording::commands::rec_start_macro,
        recording::commands::rec_macro_input,
        recording::commands::rec_stop_macro,
        recording::commands::rec_is_macro_recording,
        recording::commands::rec_list_macros,
        recording::commands::rec_get_macro,
        recording::commands::rec_update_macro,
        recording::commands::rec_delete_macro,
        recording::commands::rec_import_macro,
        // Encoding
        recording::commands::rec_encode_asciicast,
        recording::commands::rec_encode_script,
        recording::commands::rec_encode_har,
        recording::commands::rec_encode_db_csv,
        recording::commands::rec_encode_http_csv,
        recording::commands::rec_encode_telnet_asciicast,
        recording::commands::rec_encode_serial_raw,
        recording::commands::rec_encode_frame_manifest,
        // Compression
        recording::commands::rec_compress,
        recording::commands::rec_decompress,
        // Combined encode + compress + save
        recording::commands::rec_save_terminal,
        recording::commands::rec_save_http,
        recording::commands::rec_save_screen,
        // Library
        recording::commands::rec_library_list,
        recording::commands::rec_library_get,
        recording::commands::rec_library_by_protocol,
        recording::commands::rec_library_search,
        recording::commands::rec_library_rename,
        recording::commands::rec_library_update_tags,
        recording::commands::rec_library_delete,
        recording::commands::rec_library_clear,
        recording::commands::rec_library_summary,
        // Aggregate / status
        recording::commands::rec_list_active,
        recording::commands::rec_active_count,
        recording::commands::rec_stop_all,
        // Jobs
        recording::commands::rec_list_jobs,
        recording::commands::rec_get_job,
        recording::commands::rec_clear_jobs,
        // Cleanup & storage
        recording::commands::rec_run_cleanup,
        recording::commands::rec_storage_size,
        // LLM backend commands
        llm::commands::llm_add_provider,
        llm::commands::llm_remove_provider,
        llm::commands::llm_update_provider,
        llm::commands::llm_list_providers,
        llm::commands::llm_set_default_provider,
        llm::commands::llm_chat_completion,
        llm::commands::llm_create_embedding,
        llm::commands::llm_list_models,
        llm::commands::llm_models_for_provider,
        llm::commands::llm_model_info,
        llm::commands::llm_health_check,
        llm::commands::llm_health_check_all,
        llm::commands::llm_usage_summary,
        llm::commands::llm_cache_stats,
        llm::commands::llm_clear_cache,
        llm::commands::llm_status,
        llm::commands::llm_get_config,
        llm::commands::llm_update_config,
        llm::commands::llm_set_balancer_strategy,
        llm::commands::llm_estimate_tokens,
        // AI Assist commands
        ai_assist::commands::ai_assist_create_session,
        ai_assist::commands::ai_assist_remove_session,
        ai_assist::commands::ai_assist_list_sessions,
        ai_assist::commands::ai_assist_update_context,
        ai_assist::commands::ai_assist_record_command,
        ai_assist::commands::ai_assist_set_tools,
        ai_assist::commands::ai_assist_complete,
        ai_assist::commands::ai_assist_explain_error,
        ai_assist::commands::ai_assist_lookup_command,
        ai_assist::commands::ai_assist_search_commands,
        ai_assist::commands::ai_assist_translate,
        ai_assist::commands::ai_assist_assess_risk,
        ai_assist::commands::ai_assist_quick_risk,
        ai_assist::commands::ai_assist_list_snippets,
        ai_assist::commands::ai_assist_search_snippets,
        ai_assist::commands::ai_assist_get_snippet,
        ai_assist::commands::ai_assist_render_snippet,
        ai_assist::commands::ai_assist_add_snippet,
        ai_assist::commands::ai_assist_remove_snippet,
        ai_assist::commands::ai_assist_analyze_history,
        ai_assist::commands::ai_assist_get_config,
        ai_assist::commands::ai_assist_update_config,
        // Command Palette commands
        command_palette::commands::palette_search,
        command_palette::commands::palette_record_command,
        command_palette::commands::palette_search_history,
        command_palette::commands::palette_get_history,
        command_palette::commands::palette_pin_command,
        command_palette::commands::palette_tag_command,
        command_palette::commands::palette_remove_history,
        command_palette::commands::palette_clear_history,
        command_palette::commands::palette_add_snippet,
        command_palette::commands::palette_get_snippet,
        command_palette::commands::palette_update_snippet,
        command_palette::commands::palette_remove_snippet,
        command_palette::commands::palette_list_snippets,
        command_palette::commands::palette_search_snippets,
        command_palette::commands::palette_render_snippet,
        command_palette::commands::palette_import_snippets,
        command_palette::commands::palette_export_snippets,
        command_palette::commands::palette_add_alias,
        command_palette::commands::palette_remove_alias,
        command_palette::commands::palette_list_aliases,
        command_palette::commands::palette_get_config,
        command_palette::commands::palette_update_config,
        command_palette::commands::palette_get_stats,
        command_palette::commands::palette_save,
        command_palette::commands::palette_export,
        command_palette::commands::palette_import,
        // Extended palette import/export commands
        command_palette::commands::palette_export_advanced,
        command_palette::commands::palette_export_history,
        command_palette::commands::palette_export_snippets_filtered,
        command_palette::commands::palette_validate_import,
        command_palette::commands::palette_validate_import_file,
        command_palette::commands::palette_preview_import,
        command_palette::commands::palette_preview_import_file,
        command_palette::commands::palette_import_advanced,
        command_palette::commands::palette_import_file_advanced,
        command_palette::commands::palette_create_share_package,
        command_palette::commands::palette_import_share_package,
        command_palette::commands::palette_export_clipboard,
        command_palette::commands::palette_import_clipboard,
        command_palette::commands::palette_save_share_package,
        command_palette::commands::palette_import_share_package_file,
        command_palette::commands::palette_get_snapshot_stats,
        // OS classification commands
        command_palette::commands::palette_list_os_families,
        command_palette::commands::palette_list_os_distros,
        command_palette::commands::palette_snippets_by_os,
        command_palette::commands::palette_snippets_by_os_family,
        command_palette::commands::palette_snippets_universal,
        command_palette::commands::palette_set_snippet_os_target,
        command_palette::commands::palette_set_alias_os_target,
        // Font management commands
        fonts::commands::fonts_list_all,
        fonts::commands::fonts_by_category,
        fonts::commands::fonts_get,
        fonts::commands::fonts_search,
        fonts::commands::fonts_list_monospace,
        fonts::commands::fonts_list_with_ligatures,
        fonts::commands::fonts_list_with_nerd_font,
        fonts::commands::fonts_get_stats,
        fonts::commands::fonts_list_stacks,
        fonts::commands::fonts_get_stack,
        fonts::commands::fonts_create_stack,
        fonts::commands::fonts_delete_stack,
        fonts::commands::fonts_get_config,
        fonts::commands::fonts_update_ssh_terminal,
        fonts::commands::fonts_update_app_ui,
        fonts::commands::fonts_update_code_editor,
        fonts::commands::fonts_update_tab_bar,
        fonts::commands::fonts_update_log_viewer,
        fonts::commands::fonts_set_connection_override,
        fonts::commands::fonts_remove_connection_override,
        fonts::commands::fonts_resolve_connection,
        fonts::commands::fonts_add_favourite,
        fonts::commands::fonts_remove_favourite,
        fonts::commands::fonts_get_favourites,
        fonts::commands::fonts_get_recent,
        fonts::commands::fonts_record_recent,
        fonts::commands::fonts_list_presets,
        fonts::commands::fonts_apply_preset,
        fonts::commands::fonts_detect_system,
        fonts::commands::fonts_detect_system_monospace,
        fonts::commands::fonts_resolve_css,
        fonts::commands::fonts_resolve_settings_css,
        fonts::commands::fonts_save,
        fonts::commands::fonts_export,
        fonts::commands::fonts_import,
        // Secure Clipboard commands
        secure_clip::commands::secure_clip_copy,
        secure_clip::commands::secure_clip_copy_password,
        secure_clip::commands::secure_clip_copy_totp,
        secure_clip::commands::secure_clip_copy_username,
        secure_clip::commands::secure_clip_copy_passphrase,
        secure_clip::commands::secure_clip_copy_api_key,
        secure_clip::commands::secure_clip_paste,
        secure_clip::commands::secure_clip_paste_by_id,
        secure_clip::commands::secure_clip_paste_to_terminal,
        secure_clip::commands::secure_clip_record_terminal_paste,
        secure_clip::commands::secure_clip_clear,
        secure_clip::commands::secure_clip_on_app_lock,
        secure_clip::commands::secure_clip_on_app_exit,
        secure_clip::commands::secure_clip_get_current,
        secure_clip::commands::secure_clip_has_entry,
        secure_clip::commands::secure_clip_get_stats,
        secure_clip::commands::secure_clip_get_history,
        secure_clip::commands::secure_clip_get_history_for_connection,
        secure_clip::commands::secure_clip_clear_history,
        secure_clip::commands::secure_clip_get_config,
        secure_clip::commands::secure_clip_update_config,
        secure_clip::commands::secure_clip_read_os_clipboard,
        // Terminal Themes commands
        terminal_themes::commands::terminal_themes_list,
        terminal_themes::commands::terminal_themes_list_dark,
        terminal_themes::commands::terminal_themes_list_light,
        terminal_themes::commands::terminal_themes_list_by_category,
        terminal_themes::commands::terminal_themes_search,
        terminal_themes::commands::terminal_themes_get,
        terminal_themes::commands::terminal_themes_get_active,
        terminal_themes::commands::terminal_themes_get_active_id,
        terminal_themes::commands::terminal_themes_get_session_theme,
        terminal_themes::commands::terminal_themes_get_xterm,
        terminal_themes::commands::terminal_themes_get_css_vars,
        terminal_themes::commands::terminal_themes_recent,
        terminal_themes::commands::terminal_themes_count,
        terminal_themes::commands::terminal_themes_set_active,
        terminal_themes::commands::terminal_themes_set_session,
        terminal_themes::commands::terminal_themes_clear_session,
        terminal_themes::commands::terminal_themes_register,
        terminal_themes::commands::terminal_themes_update,
        terminal_themes::commands::terminal_themes_remove,
        terminal_themes::commands::terminal_themes_duplicate,
        terminal_themes::commands::terminal_themes_create_custom,
        terminal_themes::commands::terminal_themes_derive_hue,
        terminal_themes::commands::terminal_themes_generate_from_accent,
        terminal_themes::commands::terminal_themes_export_json,
        terminal_themes::commands::terminal_themes_export_iterm2,
        terminal_themes::commands::terminal_themes_export_windows_terminal,
        terminal_themes::commands::terminal_themes_export_alacritty,
        terminal_themes::commands::terminal_themes_export_xterm,
        terminal_themes::commands::terminal_themes_import,
        terminal_themes::commands::terminal_themes_check_contrast,
        terminal_themes::commands::terminal_themes_blend_colors,
        terminal_themes::commands::terminal_themes_validate,
        // Extensions engine commands
        extensions::commands::ext_install,
        extensions::commands::ext_install_with_manifest,
        extensions::commands::ext_enable,
        extensions::commands::ext_disable,
        extensions::commands::ext_uninstall,
        extensions::commands::ext_update,
        extensions::commands::ext_execute_handler,
        extensions::commands::ext_dispatch_event,
        extensions::commands::ext_storage_get,
        extensions::commands::ext_storage_set,
        extensions::commands::ext_storage_delete,
        extensions::commands::ext_storage_list_keys,
        extensions::commands::ext_storage_clear,
        extensions::commands::ext_storage_export,
        extensions::commands::ext_storage_import,
        extensions::commands::ext_storage_summary,
        extensions::commands::ext_get_setting,
        extensions::commands::ext_set_setting,
        extensions::commands::ext_get_extension,
        extensions::commands::ext_list_extensions,
        extensions::commands::ext_engine_stats,
        extensions::commands::ext_validate_manifest,
        extensions::commands::ext_create_manifest_template,
        extensions::commands::ext_api_documentation,
        extensions::commands::ext_permission_groups,
        extensions::commands::ext_get_config,
        extensions::commands::ext_update_config,
        extensions::commands::ext_audit_log,
        extensions::commands::ext_dispatch_log,
        // ── Kubernetes commands ──────────────────────────────────────────
        k8s::commands::k8s_connect,
        k8s::commands::k8s_connect_kubeconfig,
        k8s::commands::k8s_disconnect,
        k8s::commands::k8s_list_connections,
        k8s::commands::k8s_kubeconfig_default_path,
        k8s::commands::k8s_kubeconfig_load,
        k8s::commands::k8s_kubeconfig_parse,
        k8s::commands::k8s_kubeconfig_list_contexts,
        k8s::commands::k8s_kubeconfig_validate,
        k8s::commands::k8s_cluster_info,
        k8s::commands::k8s_health_check,
        k8s::commands::k8s_list_namespaces,
        k8s::commands::k8s_get_namespace,
        k8s::commands::k8s_create_namespace,
        k8s::commands::k8s_delete_namespace,
        k8s::commands::k8s_update_namespace_labels,
        k8s::commands::k8s_list_resource_quotas,
        k8s::commands::k8s_get_resource_quota,
        k8s::commands::k8s_create_resource_quota,
        k8s::commands::k8s_delete_resource_quota,
        k8s::commands::k8s_list_limit_ranges,
        k8s::commands::k8s_list_pods,
        k8s::commands::k8s_list_all_pods,
        k8s::commands::k8s_get_pod,
        k8s::commands::k8s_create_pod,
        k8s::commands::k8s_delete_pod,
        k8s::commands::k8s_pod_logs,
        k8s::commands::k8s_evict_pod,
        k8s::commands::k8s_update_pod_labels,
        k8s::commands::k8s_update_pod_annotations,
        k8s::commands::k8s_list_deployments,
        k8s::commands::k8s_list_all_deployments,
        k8s::commands::k8s_get_deployment,
        k8s::commands::k8s_create_deployment,
        k8s::commands::k8s_update_deployment,
        k8s::commands::k8s_patch_deployment,
        k8s::commands::k8s_delete_deployment,
        k8s::commands::k8s_scale_deployment,
        k8s::commands::k8s_restart_deployment,
        k8s::commands::k8s_pause_deployment,
        k8s::commands::k8s_resume_deployment,
        k8s::commands::k8s_set_deployment_image,
        k8s::commands::k8s_deployment_rollout_status,
        k8s::commands::k8s_rollback_deployment,
        k8s::commands::k8s_list_statefulsets,
        k8s::commands::k8s_list_daemonsets,
        k8s::commands::k8s_list_replicasets,
        k8s::commands::k8s_list_services,
        k8s::commands::k8s_list_all_services,
        k8s::commands::k8s_get_service,
        k8s::commands::k8s_create_service,
        k8s::commands::k8s_update_service,
        k8s::commands::k8s_patch_service,
        k8s::commands::k8s_delete_service,
        k8s::commands::k8s_get_endpoints,
        k8s::commands::k8s_list_configmaps,
        k8s::commands::k8s_get_configmap,
        k8s::commands::k8s_create_configmap,
        k8s::commands::k8s_update_configmap,
        k8s::commands::k8s_patch_configmap,
        k8s::commands::k8s_delete_configmap,
        k8s::commands::k8s_list_secrets,
        k8s::commands::k8s_get_secret,
        k8s::commands::k8s_create_secret,
        k8s::commands::k8s_update_secret,
        k8s::commands::k8s_patch_secret,
        k8s::commands::k8s_delete_secret,
        k8s::commands::k8s_list_ingresses,
        k8s::commands::k8s_get_ingress,
        k8s::commands::k8s_create_ingress,
        k8s::commands::k8s_update_ingress,
        k8s::commands::k8s_delete_ingress,
        k8s::commands::k8s_list_ingress_classes,
        k8s::commands::k8s_list_network_policies,
        k8s::commands::k8s_get_network_policy,
        k8s::commands::k8s_create_network_policy,
        k8s::commands::k8s_delete_network_policy,
        k8s::commands::k8s_list_jobs,
        k8s::commands::k8s_get_job,
        k8s::commands::k8s_create_job,
        k8s::commands::k8s_delete_job,
        k8s::commands::k8s_suspend_job,
        k8s::commands::k8s_resume_job,
        k8s::commands::k8s_list_cronjobs,
        k8s::commands::k8s_get_cronjob,
        k8s::commands::k8s_create_cronjob,
        k8s::commands::k8s_delete_cronjob,
        k8s::commands::k8s_suspend_cronjob,
        k8s::commands::k8s_resume_cronjob,
        k8s::commands::k8s_trigger_cronjob,
        k8s::commands::k8s_list_nodes,
        k8s::commands::k8s_get_node,
        k8s::commands::k8s_cordon_node,
        k8s::commands::k8s_uncordon_node,
        k8s::commands::k8s_drain_node,
        k8s::commands::k8s_add_node_taint,
        k8s::commands::k8s_remove_node_taint,
        k8s::commands::k8s_update_node_labels,
        k8s::commands::k8s_list_persistent_volumes,
        k8s::commands::k8s_list_pvcs,
        k8s::commands::k8s_list_storage_classes,
        k8s::commands::k8s_list_roles,
        k8s::commands::k8s_list_cluster_roles,
        k8s::commands::k8s_list_role_bindings,
        k8s::commands::k8s_list_cluster_role_bindings,
        k8s::commands::k8s_list_service_accounts,
        k8s::commands::k8s_create_service_account_token,
        k8s::commands::k8s_helm_is_available,
        k8s::commands::k8s_helm_version,
        k8s::commands::k8s_helm_list_releases,
        k8s::commands::k8s_helm_get_release,
        k8s::commands::k8s_helm_release_history,
        k8s::commands::k8s_helm_install,
        k8s::commands::k8s_helm_upgrade,
        k8s::commands::k8s_helm_rollback,
        k8s::commands::k8s_helm_uninstall,
        k8s::commands::k8s_helm_get_values,
        k8s::commands::k8s_helm_get_manifest,
        k8s::commands::k8s_helm_template,
        k8s::commands::k8s_helm_list_repos,
        k8s::commands::k8s_helm_add_repo,
        k8s::commands::k8s_helm_remove_repo,
        k8s::commands::k8s_helm_update_repos,
        k8s::commands::k8s_helm_search_charts,
        k8s::commands::k8s_list_events,
        k8s::commands::k8s_list_all_events,
        k8s::commands::k8s_list_events_for_resource,
        k8s::commands::k8s_filter_events,
        k8s::commands::k8s_list_warnings,
        k8s::commands::k8s_list_crds,
        k8s::commands::k8s_get_crd,
        k8s::commands::k8s_list_hpas,
        k8s::commands::k8s_get_hpa,
        k8s::commands::k8s_metrics_available,
        k8s::commands::k8s_node_metrics,
        k8s::commands::k8s_pod_metrics,
        k8s::commands::k8s_cluster_resource_summary,
        // ── Docker commands ──────────────────────────────────────────────
        docker::commands::docker_connect,
        docker::commands::docker_disconnect,
        docker::commands::docker_list_connections,
        docker::commands::docker_system_info,
        docker::commands::docker_system_version,
        docker::commands::docker_ping,
        docker::commands::docker_disk_usage,
        docker::commands::docker_system_events,
        docker::commands::docker_system_prune,
        docker::commands::docker_list_containers,
        docker::commands::docker_inspect_container,
        docker::commands::docker_create_container,
        docker::commands::docker_run_container,
        docker::commands::docker_start_container,
        docker::commands::docker_stop_container,
        docker::commands::docker_restart_container,
        docker::commands::docker_kill_container,
        docker::commands::docker_pause_container,
        docker::commands::docker_unpause_container,
        docker::commands::docker_remove_container,
        docker::commands::docker_rename_container,
        docker::commands::docker_container_logs,
        docker::commands::docker_container_stats,
        docker::commands::docker_container_top,
        docker::commands::docker_container_changes,
        docker::commands::docker_container_wait,
        docker::commands::docker_container_exec,
        docker::commands::docker_container_update,
        docker::commands::docker_prune_containers,
        docker::commands::docker_list_images,
        docker::commands::docker_inspect_image,
        docker::commands::docker_image_history,
        docker::commands::docker_pull_image,
        docker::commands::docker_tag_image,
        docker::commands::docker_push_image,
        docker::commands::docker_remove_image,
        docker::commands::docker_search_images,
        docker::commands::docker_prune_images,
        docker::commands::docker_commit_container,
        docker::commands::docker_list_volumes,
        docker::commands::docker_inspect_volume,
        docker::commands::docker_create_volume,
        docker::commands::docker_remove_volume,
        docker::commands::docker_prune_volumes,
        docker::commands::docker_list_networks,
        docker::commands::docker_inspect_network,
        docker::commands::docker_create_network,
        docker::commands::docker_remove_network,
        docker::commands::docker_connect_network,
        docker::commands::docker_disconnect_network,
        docker::commands::docker_prune_networks,
        docker::commands::docker_compose_is_available,
        docker::commands::docker_compose_version,
        docker::commands::docker_compose_list_projects,
        docker::commands::docker_compose_up,
        docker::commands::docker_compose_down,
        docker::commands::docker_compose_ps,
        docker::commands::docker_compose_logs,
        docker::commands::docker_compose_build,
        docker::commands::docker_compose_pull,
        docker::commands::docker_compose_restart,
        docker::commands::docker_compose_stop,
        docker::commands::docker_compose_start,
        docker::commands::docker_compose_config,
        docker::commands::docker_registry_login,
        docker::commands::docker_registry_search,
        // Ansible commands
        ansible::commands::ansible_connect,
        ansible::commands::ansible_disconnect,
        ansible::commands::ansible_list_connections,
        ansible::commands::ansible_is_available,
        ansible::commands::ansible_get_info,
        ansible::commands::ansible_inventory_parse,
        ansible::commands::ansible_inventory_graph,
        ansible::commands::ansible_inventory_list_hosts,
        ansible::commands::ansible_inventory_host_vars,
        ansible::commands::ansible_inventory_add_host,
        ansible::commands::ansible_inventory_remove_host,
        ansible::commands::ansible_inventory_add_group,
        ansible::commands::ansible_inventory_remove_group,
        ansible::commands::ansible_inventory_dynamic,
        ansible::commands::ansible_playbook_parse,
        ansible::commands::ansible_playbook_list,
        ansible::commands::ansible_playbook_syntax_check,
        ansible::commands::ansible_playbook_lint,
        ansible::commands::ansible_playbook_run,
        ansible::commands::ansible_playbook_check,
        ansible::commands::ansible_playbook_diff,
        ansible::commands::ansible_adhoc_run,
        ansible::commands::ansible_adhoc_ping,
        ansible::commands::ansible_adhoc_shell,
        ansible::commands::ansible_adhoc_copy,
        ansible::commands::ansible_adhoc_service,
        ansible::commands::ansible_adhoc_package,
        ansible::commands::ansible_roles_list,
        ansible::commands::ansible_role_inspect,
        ansible::commands::ansible_role_init,
        ansible::commands::ansible_role_dependencies,
        ansible::commands::ansible_role_install_deps,
        ansible::commands::ansible_vault_encrypt,
        ansible::commands::ansible_vault_decrypt,
        ansible::commands::ansible_vault_view,
        ansible::commands::ansible_vault_rekey,
        ansible::commands::ansible_vault_encrypt_string,
        ansible::commands::ansible_vault_is_encrypted,
        ansible::commands::ansible_galaxy_install_role,
        ansible::commands::ansible_galaxy_list_roles,
        ansible::commands::ansible_galaxy_remove_role,
        ansible::commands::ansible_galaxy_install_collection,
        ansible::commands::ansible_galaxy_list_collections,
        ansible::commands::ansible_galaxy_remove_collection,
        ansible::commands::ansible_galaxy_search,
        ansible::commands::ansible_galaxy_role_info,
        ansible::commands::ansible_galaxy_install_requirements,
        ansible::commands::ansible_facts_gather,
        ansible::commands::ansible_facts_gather_min,
        ansible::commands::ansible_config_dump,
        ansible::commands::ansible_config_get,
        ansible::commands::ansible_config_parse_file,
        ansible::commands::ansible_config_detect_path,
        ansible::commands::ansible_list_modules,
        ansible::commands::ansible_module_doc,
        ansible::commands::ansible_module_examples,
        ansible::commands::ansible_list_plugins,
        ansible::commands::ansible_history_list,
        ansible::commands::ansible_history_get,
        ansible::commands::ansible_history_clear,
        // Terraform commands
        terraform::commands::terraform_connect,
        terraform::commands::terraform_disconnect,
        terraform::commands::terraform_list_connections,
        terraform::commands::terraform_is_available,
        terraform::commands::terraform_get_info,
        terraform::commands::terraform_init,
        terraform::commands::terraform_init_no_backend,
        terraform::commands::terraform_plan,
        terraform::commands::terraform_show_plan_json,
        terraform::commands::terraform_show_plan_text,
        terraform::commands::terraform_apply,
        terraform::commands::terraform_destroy,
        terraform::commands::terraform_refresh,
        terraform::commands::terraform_state_list,
        terraform::commands::terraform_state_show,
        terraform::commands::terraform_state_show_json,
        terraform::commands::terraform_state_pull,
        terraform::commands::terraform_state_push,
        terraform::commands::terraform_state_mv,
        terraform::commands::terraform_state_rm,
        terraform::commands::terraform_state_import,
        terraform::commands::terraform_state_taint,
        terraform::commands::terraform_state_untaint,
        terraform::commands::terraform_state_force_unlock,
        terraform::commands::terraform_workspace_list,
        terraform::commands::terraform_workspace_show,
        terraform::commands::terraform_workspace_new,
        terraform::commands::terraform_workspace_select,
        terraform::commands::terraform_workspace_delete,
        terraform::commands::terraform_validate,
        terraform::commands::terraform_fmt,
        terraform::commands::terraform_fmt_check,
        terraform::commands::terraform_output_list,
        terraform::commands::terraform_output_get,
        terraform::commands::terraform_output_get_raw,
        terraform::commands::terraform_providers_list,
        terraform::commands::terraform_providers_schemas,
        terraform::commands::terraform_providers_lock,
        terraform::commands::terraform_providers_mirror,
        terraform::commands::terraform_providers_parse_lock_file,
        terraform::commands::terraform_modules_get,
        terraform::commands::terraform_modules_list_installed,
        terraform::commands::terraform_modules_search_registry,
        terraform::commands::terraform_graph_generate,
        terraform::commands::terraform_graph_plan,
        terraform::commands::terraform_hcl_analyse,
        terraform::commands::terraform_hcl_analyse_file,
        terraform::commands::terraform_hcl_summarise,
        terraform::commands::terraform_drift_detect,
        terraform::commands::terraform_drift_has_drift,
        terraform::commands::terraform_drift_compare_snapshots,
        terraform::commands::terraform_history_list,
        terraform::commands::terraform_history_get,
        terraform::commands::terraform_history_clear,
    ]
}
