//! Tauri commands — thin `#[tauri::command]` wrappers that delegate to
//! the [`TelegramService`] state.

use crate::files::FileUpload;
use crate::monitoring::MonitoringSummary;
use crate::service::TelegramServiceState;
use crate::templates;
use crate::types::*;
use std::collections::HashMap;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bot Management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_add_bot(
    state: tauri::State<'_, TelegramServiceState>,
    config: TelegramBotConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_bot(config)
}

#[tauri::command]
pub async fn telegram_remove_bot(
    state: tauri::State<'_, TelegramServiceState>,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_bot(&name)
}

#[tauri::command]
pub async fn telegram_list_bots(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<BotSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.list_bots())
}

#[tauri::command]
pub async fn telegram_validate_bot(
    state: tauri::State<'_, TelegramServiceState>,
    name: String,
) -> Result<TgUser, String> {
    let mut svc = state.lock().await;
    svc.validate_bot(&name).await
}

#[tauri::command]
pub async fn telegram_set_bot_enabled(
    state: tauri::State<'_, TelegramServiceState>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.bots.set_enabled(&name, enabled)
}

#[tauri::command]
pub async fn telegram_update_bot_token(
    state: tauri::State<'_, TelegramServiceState>,
    name: String,
    token: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.bots.update_token(&name, token)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_send_message(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendMessageRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_message(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_photo(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendPhotoRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_photo(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_document(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendDocumentRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_document(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_video(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendVideoRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_video(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_audio(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendAudioRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_audio(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_voice(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendVoiceRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_voice(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_location(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendLocationRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_location(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_contact(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendContactRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_contact(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_poll(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendPollRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_poll(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_dice(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendDiceRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_dice(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_sticker(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: SendStickerRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_sticker(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_send_chat_action(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    action: ChatAction,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.send_chat_action(&bot_name, &chat_id, &action).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Message Management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_edit_message_text(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: EditMessageTextRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.edit_message_text(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_edit_message_caption(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: EditMessageCaptionRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.edit_message_caption(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_edit_message_reply_markup(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: EditMessageReplyMarkupRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.edit_message_reply_markup(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_delete_message(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    message_id: i64,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.delete_message(&bot_name, &chat_id, message_id).await
}

#[tauri::command]
pub async fn telegram_forward_message(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: ForwardMessageRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.forward_message(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_copy_message(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: CopyMessageRequest,
) -> Result<MessageId, String> {
    let mut svc = state.lock().await;
    svc.copy_message(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_pin_message(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    message_id: i64,
    disable_notification: Option<bool>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.pin_message(&bot_name, &chat_id, message_id, disable_notification.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn telegram_unpin_message(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    message_id: Option<i64>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.unpin_message(&bot_name, &chat_id, message_id).await
}

#[tauri::command]
pub async fn telegram_unpin_all_messages(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.unpin_all_messages(&bot_name, &chat_id).await
}

#[tauri::command]
pub async fn telegram_answer_callback_query(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: AnswerCallbackQueryRequest,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.answer_callback_query(&bot_name, &req).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Chat Management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_get_chat(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
) -> Result<TgChat, String> {
    let svc = state.lock().await;
    svc.get_chat(&bot_name, &chat_id).await
}

#[tauri::command]
pub async fn telegram_get_chat_member_count(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
) -> Result<i64, String> {
    let svc = state.lock().await;
    svc.get_chat_member_count(&bot_name, &chat_id).await
}

#[tauri::command]
pub async fn telegram_get_chat_member(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    user_id: i64,
) -> Result<ChatMember, String> {
    let svc = state.lock().await;
    svc.get_chat_member(&bot_name, &chat_id, user_id).await
}

#[tauri::command]
pub async fn telegram_get_chat_administrators(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
) -> Result<Vec<ChatMember>, String> {
    let svc = state.lock().await;
    svc.get_chat_administrators(&bot_name, &chat_id).await
}

#[tauri::command]
pub async fn telegram_set_chat_title(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    title: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.set_chat_title(&bot_name, &chat_id, &title).await
}

#[tauri::command]
pub async fn telegram_set_chat_description(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    description: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.set_chat_description(&bot_name, &chat_id, &description)
        .await
}

#[tauri::command]
pub async fn telegram_ban_chat_member(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: BanChatMemberRequest,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.ban_chat_member(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_unban_chat_member(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    user_id: i64,
    only_if_banned: Option<bool>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.unban_chat_member(&bot_name, &chat_id, user_id, only_if_banned.unwrap_or(true))
        .await
}

#[tauri::command]
pub async fn telegram_restrict_chat_member(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: RestrictChatMemberRequest,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.restrict_chat_member(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_promote_chat_member(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    req: PromoteChatMemberRequest,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.promote_chat_member(&bot_name, &req).await
}

#[tauri::command]
pub async fn telegram_leave_chat(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.leave_chat(&bot_name, &chat_id).await
}

#[tauri::command]
pub async fn telegram_export_chat_invite_link(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.export_chat_invite_link(&bot_name, &chat_id).await
}

#[tauri::command]
pub async fn telegram_create_invite_link(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    name: Option<String>,
    expire_date: Option<i64>,
    member_limit: Option<i64>,
    creates_join_request: Option<bool>,
) -> Result<ChatInviteLink, String> {
    let mut svc = state.lock().await;
    svc.create_invite_link(
        &bot_name,
        &chat_id,
        name.as_deref(),
        expire_date,
        member_limit,
        creates_join_request.unwrap_or(false),
    )
    .await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Files
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_get_file(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    file_id: String,
) -> Result<TgFile, String> {
    let svc = state.lock().await;
    svc.get_file(&bot_name, &file_id).await
}

#[tauri::command]
pub async fn telegram_download_file(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    file_path: String,
) -> Result<Vec<u8>, String> {
    let svc = state.lock().await;
    svc.download_file(&bot_name, &file_path).await
}

#[tauri::command]
pub async fn telegram_upload_file(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    chat_id: ChatId,
    file_name: String,
    data: Vec<u8>,
    caption: Option<String>,
    parse_mode: Option<ParseMode>,
) -> Result<TgMessage, String> {
    let mime = crate::files::guess_mime_type(&file_name);
    let field = crate::files::field_for_mime(mime);
    let mime_string = mime.to_string();
    let upload = FileUpload {
        field_name: field.to_string(),
        file_name,
        mime_type: mime_string,
        data,
    };
    let mut svc = state.lock().await;
    svc.upload_file(
        &bot_name,
        &chat_id,
        &upload,
        caption.as_deref(),
        parse_mode.as_ref(),
    )
    .await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Webhooks & Updates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_get_updates(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    offset: Option<i64>,
    limit: Option<i64>,
    timeout: Option<i64>,
) -> Result<Vec<TgUpdate>, String> {
    let svc = state.lock().await;
    svc.get_updates(&bot_name, offset, limit, timeout).await
}

#[tauri::command]
pub async fn telegram_set_webhook(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    config: WebhookConfig,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.set_webhook(&bot_name, &config).await
}

#[tauri::command]
pub async fn telegram_delete_webhook(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
    drop_pending_updates: Option<bool>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.delete_webhook(&bot_name, drop_pending_updates.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn telegram_get_webhook_info(
    state: tauri::State<'_, TelegramServiceState>,
    bot_name: String,
) -> Result<WebhookInfo, String> {
    let svc = state.lock().await;
    svc.get_webhook_info(&bot_name).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Notification Rules
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_add_notification_rule(
    state: tauri::State<'_, TelegramServiceState>,
    rule: NotificationRule,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_notification_rule(rule);
    Ok(())
}

#[tauri::command]
pub async fn telegram_remove_notification_rule(
    state: tauri::State<'_, TelegramServiceState>,
    rule_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_notification_rule(&rule_id)
}

#[tauri::command]
pub async fn telegram_list_notification_rules(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<NotificationRule>, String> {
    let svc = state.lock().await;
    Ok(svc.list_notification_rules().to_vec())
}

#[tauri::command]
pub async fn telegram_set_notification_rule_enabled(
    state: tauri::State<'_, TelegramServiceState>,
    rule_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.notifications.set_rule_enabled(&rule_id, enabled)
}

#[tauri::command]
pub async fn telegram_process_connection_event(
    state: tauri::State<'_, TelegramServiceState>,
    event: ConnectionEvent,
) -> Result<Vec<NotificationResult>, String> {
    let mut svc = state.lock().await;
    Ok(svc.process_connection_event(&event).await)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Monitoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_add_monitoring_check(
    state: tauri::State<'_, TelegramServiceState>,
    check: MonitoringCheck,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_monitoring_check(check);
    Ok(())
}

#[tauri::command]
pub async fn telegram_remove_monitoring_check(
    state: tauri::State<'_, TelegramServiceState>,
    check_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_monitoring_check(&check_id)
}

#[tauri::command]
pub async fn telegram_list_monitoring_checks(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<MonitoringCheck>, String> {
    let svc = state.lock().await;
    Ok(svc.list_monitoring_checks().to_vec())
}

#[tauri::command]
pub async fn telegram_set_monitoring_check_enabled(
    state: tauri::State<'_, TelegramServiceState>,
    check_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.monitoring.set_check_enabled(&check_id, enabled)
}

#[tauri::command]
pub async fn telegram_monitoring_summary(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<MonitoringSummary, String> {
    let svc = state.lock().await;
    Ok(svc.monitoring.summary())
}

#[tauri::command]
pub async fn telegram_record_monitoring_result(
    state: tauri::State<'_, TelegramServiceState>,
    result: MonitoringCheckResult,
) -> Result<Option<NotificationResult>, String> {
    let mut svc = state.lock().await;
    Ok(svc.record_monitoring_result(result).await)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Templates
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_add_template(
    state: tauri::State<'_, TelegramServiceState>,
    template: MessageTemplate,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_template(template);
    Ok(())
}

#[tauri::command]
pub async fn telegram_remove_template(
    state: tauri::State<'_, TelegramServiceState>,
    template_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_template(&template_id)
}

#[tauri::command]
pub async fn telegram_list_templates(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<MessageTemplate>, String> {
    let svc = state.lock().await;
    Ok(svc.list_templates().to_vec())
}

#[tauri::command]
pub async fn telegram_render_template(
    state: tauri::State<'_, TelegramServiceState>,
    template_id: String,
    variables: HashMap<String, String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.templates.render(&template_id, &variables)
}

#[tauri::command]
pub async fn telegram_validate_template_body(
    body: String,
) -> Result<Vec<String>, String> {
    templates::validate_template_body(&body)
}

#[tauri::command]
pub async fn telegram_send_template(
    state: tauri::State<'_, TelegramServiceState>,
    req: SendTemplateRequest,
) -> Result<TgMessage, String> {
    let mut svc = state.lock().await;
    svc.send_template(&req).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Scheduled Messages
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_schedule_message(
    state: tauri::State<'_, TelegramServiceState>,
    msg: ScheduledMessage,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.schedule_message(msg);
    Ok(())
}

#[tauri::command]
pub async fn telegram_cancel_scheduled_message(
    state: tauri::State<'_, TelegramServiceState>,
    msg_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_scheduled_message(&msg_id)
}

#[tauri::command]
pub async fn telegram_list_scheduled_messages(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<ScheduledMessage>, String> {
    let svc = state.lock().await;
    Ok(svc.list_scheduled_messages().into_iter().cloned().collect())
}

/// Result of processing scheduled messages: Vec of (message_id, send result).
pub type ScheduledProcessResult = Vec<(String, Result<i64, String>)>;

#[tauri::command]
pub async fn telegram_process_scheduled_messages(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<ScheduledProcessResult, String> {
    let mut svc = state.lock().await;
    Ok(svc.process_scheduled_messages().await)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Broadcast
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_broadcast(
    state: tauri::State<'_, TelegramServiceState>,
    req: BroadcastRequest,
) -> Result<BroadcastResult, String> {
    let mut svc = state.lock().await;
    svc.broadcast(&req).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Digests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_add_digest(
    state: tauri::State<'_, TelegramServiceState>,
    config: DigestConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_digest(config);
    Ok(())
}

#[tauri::command]
pub async fn telegram_remove_digest(
    state: tauri::State<'_, TelegramServiceState>,
    digest_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_digest(&digest_id)
}

#[tauri::command]
pub async fn telegram_list_digests(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<DigestConfig>, String> {
    let svc = state.lock().await;
    Ok(svc.list_digests().to_vec())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Stats & Logs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn telegram_stats(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<TelegramStats, String> {
    let svc = state.lock().await;
    Ok(svc.stats())
}

#[tauri::command]
pub async fn telegram_message_log(
    state: tauri::State<'_, TelegramServiceState>,
    limit: Option<usize>,
) -> Result<Vec<MessageLogEntry>, String> {
    let svc = state.lock().await;
    Ok(svc
        .message_log(limit.unwrap_or(100))
        .into_iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn telegram_clear_message_log(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_message_log();
    Ok(())
}

#[tauri::command]
pub async fn telegram_notification_history(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<NotificationResult>, String> {
    let svc = state.lock().await;
    Ok(svc.notifications.history().to_vec())
}

#[tauri::command]
pub async fn telegram_monitoring_history(
    state: tauri::State<'_, TelegramServiceState>,
) -> Result<Vec<MonitoringCheckResult>, String> {
    let svc = state.lock().await;
    Ok(svc.monitoring.history().to_vec())
}
