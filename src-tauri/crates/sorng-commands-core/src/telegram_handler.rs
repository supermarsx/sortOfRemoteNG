//! Always-on Telegram bot/settings IPC. The optional collaboration command crate
//! must not own these routes: settings are available in lean builds as well.

macro_rules! define_telegram_commands {
    ($($command:ident),+ $(,)?) => {
        pub const COMMAND_NAMES: &[&str] = &[$(stringify!($command)),+];

        pub fn is_command(command: &str) -> bool {
            matches!(command, $(stringify!($command))|+)
        }

        pub fn build<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$(crate::telegram_commands::$command),+]
        }
    };
}

define_telegram_commands!(
    telegram_add_bot,
    telegram_remove_bot,
    telegram_list_bots,
    telegram_validate_bot,
    telegram_set_bot_enabled,
    telegram_update_bot_token,
    telegram_send_message,
    telegram_send_photo,
    telegram_send_document,
    telegram_send_video,
    telegram_send_audio,
    telegram_send_voice,
    telegram_send_location,
    telegram_send_contact,
    telegram_send_poll,
    telegram_send_dice,
    telegram_send_sticker,
    telegram_send_chat_action,
    telegram_edit_message_text,
    telegram_edit_message_caption,
    telegram_edit_message_reply_markup,
    telegram_delete_message,
    telegram_forward_message,
    telegram_copy_message,
    telegram_pin_message,
    telegram_unpin_message,
    telegram_unpin_all_messages,
    telegram_answer_callback_query,
    telegram_get_chat,
    telegram_get_chat_member_count,
    telegram_get_chat_member,
    telegram_get_chat_administrators,
    telegram_set_chat_title,
    telegram_set_chat_description,
    telegram_ban_chat_member,
    telegram_unban_chat_member,
    telegram_restrict_chat_member,
    telegram_promote_chat_member,
    telegram_leave_chat,
    telegram_export_chat_invite_link,
    telegram_create_invite_link,
    telegram_get_file,
    telegram_download_file,
    telegram_upload_file,
    telegram_get_updates,
    telegram_set_webhook,
    telegram_delete_webhook,
    telegram_get_webhook_info,
    telegram_add_notification_rule,
    telegram_remove_notification_rule,
    telegram_list_notification_rules,
    telegram_set_notification_rule_enabled,
    telegram_process_connection_event,
    telegram_add_monitoring_check,
    telegram_remove_monitoring_check,
    telegram_list_monitoring_checks,
    telegram_set_monitoring_check_enabled,
    telegram_monitoring_summary,
    telegram_record_monitoring_result,
    telegram_add_template,
    telegram_remove_template,
    telegram_list_templates,
    telegram_render_template,
    telegram_validate_template_body,
    telegram_send_template,
    telegram_schedule_message,
    telegram_cancel_scheduled_message,
    telegram_list_scheduled_messages,
    telegram_process_scheduled_messages,
    telegram_broadcast,
    telegram_add_digest,
    telegram_remove_digest,
    telegram_list_digests,
    telegram_stats,
    telegram_message_log,
    telegram_clear_message_log,
    telegram_notification_history,
    telegram_monitoring_history,
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_frontend_and_native_telegram_commands_are_owned_by_core() {
        let frontend = include_str!("../../../../src/hooks/integration/useTelegram.ts");
        let native = include_str!("../../sorng-telegram/src/commands.rs");
        let collab = include_str!("../../sorng-commands-collab/src/collab_handler.rs");
        let frontend_names: std::collections::HashSet<_> = frontend
            .split('"')
            .filter(|part| part.starts_with("telegram_") && !part.contains(char::is_whitespace))
            .collect();
        let native_names: std::collections::HashSet<_> = native
            .split("pub async fn ")
            .skip(1)
            .filter_map(|part| part.split('(').next())
            .collect();
        let expected = COMMAND_NAMES.iter().copied().collect();
        assert_eq!(COMMAND_NAMES.len(), 78);
        assert_eq!(frontend_names, expected);
        assert_eq!(native_names, expected);
        for command in COMMAND_NAMES {
            assert!(crate::is_command(command), "{command} missing from core");
            assert!(is_command(command));
            assert!(!collab.contains(command), "{command} still owned by collab");
        }
        assert!(!is_command("telegram_unknown"));
        assert!(!is_command("wa_list_sessions"));
    }
}
