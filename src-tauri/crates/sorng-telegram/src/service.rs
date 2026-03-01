//! Service — central state management, bringing together bots, messaging,
//! chat, files, notifications, monitoring, templates, and scheduled messages.

use crate::bot::BotManager;
use crate::chat;
use crate::files;
use crate::messaging;
use crate::monitoring::{MonitoringAlertType, MonitoringManager};
use crate::notifications::NotificationManager;
use crate::templates::TemplateManager;
use crate::types::*;
use crate::webhooks;
use chrono::Utc;

use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Shared service state, managed by Tauri.
pub type TelegramServiceState = Arc<Mutex<TelegramService>>;

/// The central Telegram integration service.
#[derive(Debug)]
pub struct TelegramService {
    pub bots: BotManager,
    pub notifications: NotificationManager,
    pub monitoring: MonitoringManager,
    pub templates: TemplateManager,
    /// Scheduled messages queue.
    pub scheduled_messages: Vec<ScheduledMessage>,
    /// Digest configurations.
    pub digests: Vec<DigestConfig>,
    /// Message log.
    pub message_log: Vec<MessageLogEntry>,
    max_log_entries: usize,
    /// Service start time for uptime tracking.
    started_at: chrono::DateTime<Utc>,
    /// Global counters.
    total_messages_sent: u64,
    total_messages_failed: u64,
    total_notifications_sent: u64,
    total_alerts_sent: u64,
}

impl TelegramService {
    /// Create a new service wrapped in an Arc<Mutex>.
    pub fn new() -> TelegramServiceState {
        let mut templates = TemplateManager::new();
        templates.load_builtins();

        Arc::new(Mutex::new(Self {
            bots: BotManager::new(),
            notifications: NotificationManager::new(),
            monitoring: MonitoringManager::new(),
            templates,
            scheduled_messages: Vec::new(),
            digests: Vec::new(),
            message_log: Vec::new(),
            max_log_entries: 5000,
            started_at: Utc::now(),
            total_messages_sent: 0,
            total_messages_failed: 0,
            total_notifications_sent: 0,
            total_alerts_sent: 0,
        }))
    }

    // ── Bot management ──────────────────────────────────────────────

    pub fn add_bot(&mut self, config: TelegramBotConfig) -> Result<(), String> {
        self.bots.add_bot(config)
    }

    pub fn remove_bot(&mut self, name: &str) -> Result<(), String> {
        self.bots.remove_bot(name)
    }

    pub fn list_bots(&self) -> Vec<BotSummary> {
        self.bots.summaries()
    }

    pub async fn validate_bot(&mut self, name: &str) -> Result<TgUser, String> {
        self.bots.validate_bot(name).await
    }

    // ── Messaging ──────────────────────────────────────────────────

    pub async fn send_message(
        &mut self,
        bot_name: &str,
        req: &SendMessageRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_message(req);
        let client = self.bots.client(bot_name)?;
        let result: Result<TgMessage, String> = client.call("sendMessage", &body).await;
        self.log_message_result(bot_name, &req.chat_id, &req.text, &result, MessageSource::Manual);
        result
    }

    pub async fn send_photo(
        &mut self,
        bot_name: &str,
        req: &SendPhotoRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_photo(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendPhoto", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[photo]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_document(
        &mut self,
        bot_name: &str,
        req: &SendDocumentRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_document(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendDocument", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[document]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_video(
        &mut self,
        bot_name: &str,
        req: &SendVideoRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_video(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendVideo", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[video]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_audio(
        &mut self,
        bot_name: &str,
        req: &SendAudioRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_audio(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendAudio", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[audio]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_voice(
        &mut self,
        bot_name: &str,
        req: &SendVoiceRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_voice(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendVoice", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[voice]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_location(
        &mut self,
        bot_name: &str,
        req: &SendLocationRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_location(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendLocation", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[location]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_contact(
        &mut self,
        bot_name: &str,
        req: &SendContactRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_contact(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendContact", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[contact]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_poll(
        &mut self,
        bot_name: &str,
        req: &SendPollRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_poll(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendPoll", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[poll]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_dice(
        &mut self,
        bot_name: &str,
        req: &SendDiceRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_dice(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendDice", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[dice]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_sticker(
        &mut self,
        bot_name: &str,
        req: &SendStickerRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_send_sticker(req);
        let client = self.bots.client(bot_name)?;
        let result = client.call("sendSticker", &body).await;
        self.log_message_result(bot_name, &req.chat_id, "[sticker]", &result, MessageSource::Manual);
        result
    }

    pub async fn send_chat_action(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        action: &ChatAction,
    ) -> Result<bool, String> {
        let body = messaging::build_send_chat_action(chat_id, action);
        let client = self.bots.client(bot_name)?;
        client.call("sendChatAction", &body).await
    }

    // ── Message management ──────────────────────────────────────────

    pub async fn edit_message_text(
        &mut self,
        bot_name: &str,
        req: &EditMessageTextRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_edit_message_text(req);
        let client = self.bots.client(bot_name)?;
        client.call("editMessageText", &body).await
    }

    pub async fn edit_message_caption(
        &mut self,
        bot_name: &str,
        req: &EditMessageCaptionRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_edit_message_caption(req);
        let client = self.bots.client(bot_name)?;
        client.call("editMessageCaption", &body).await
    }

    pub async fn edit_message_reply_markup(
        &mut self,
        bot_name: &str,
        req: &EditMessageReplyMarkupRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_edit_reply_markup(req);
        let client = self.bots.client(bot_name)?;
        client.call("editMessageReplyMarkup", &body).await
    }

    pub async fn delete_message(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        message_id: i64,
    ) -> Result<bool, String> {
        let body = messaging::build_delete_message(chat_id, message_id);
        let client = self.bots.client(bot_name)?;
        client.call("deleteMessage", &body).await
    }

    pub async fn forward_message(
        &mut self,
        bot_name: &str,
        req: &ForwardMessageRequest,
    ) -> Result<TgMessage, String> {
        let body = messaging::build_forward_message(req);
        let client = self.bots.client(bot_name)?;
        client.call("forwardMessage", &body).await
    }

    pub async fn copy_message(
        &mut self,
        bot_name: &str,
        req: &CopyMessageRequest,
    ) -> Result<MessageId, String> {
        let body = messaging::build_copy_message(req);
        let client = self.bots.client(bot_name)?;
        client.call("copyMessage", &body).await
    }

    pub async fn pin_message(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        message_id: i64,
        disable_notification: bool,
    ) -> Result<bool, String> {
        let body = messaging::build_pin_message(chat_id, message_id, disable_notification);
        let client = self.bots.client(bot_name)?;
        client.call("pinChatMessage", &body).await
    }

    pub async fn unpin_message(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        message_id: Option<i64>,
    ) -> Result<bool, String> {
        let body = messaging::build_unpin_message(chat_id, message_id);
        let client = self.bots.client(bot_name)?;
        client.call("unpinChatMessage", &body).await
    }

    pub async fn unpin_all_messages(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
    ) -> Result<bool, String> {
        let body = messaging::build_unpin_all_messages(chat_id);
        let client = self.bots.client(bot_name)?;
        client.call("unpinAllChatMessages", &body).await
    }

    pub async fn answer_callback_query(
        &mut self,
        bot_name: &str,
        req: &AnswerCallbackQueryRequest,
    ) -> Result<bool, String> {
        let body = messaging::build_answer_callback_query(req);
        let client = self.bots.client(bot_name)?;
        client.call("answerCallbackQuery", &body).await
    }

    // ── Chat management ─────────────────────────────────────────────

    pub async fn get_chat(
        &self,
        bot_name: &str,
        chat_id: &ChatId,
    ) -> Result<TgChat, String> {
        let body = chat::build_get_chat(chat_id);
        let client = self.bots.client(bot_name)?;
        client.call("getChat", &body).await
    }

    pub async fn get_chat_member_count(
        &self,
        bot_name: &str,
        chat_id: &ChatId,
    ) -> Result<i64, String> {
        let body = chat::build_get_chat_member_count(chat_id);
        let client = self.bots.client(bot_name)?;
        client.call("getChatMemberCount", &body).await
    }

    pub async fn get_chat_member(
        &self,
        bot_name: &str,
        chat_id: &ChatId,
        user_id: i64,
    ) -> Result<ChatMember, String> {
        let body = chat::build_get_chat_member(chat_id, user_id);
        let client = self.bots.client(bot_name)?;
        client.call("getChatMember", &body).await
    }

    pub async fn get_chat_administrators(
        &self,
        bot_name: &str,
        chat_id: &ChatId,
    ) -> Result<Vec<ChatMember>, String> {
        let body = chat::build_get_chat_administrators(chat_id);
        let client = self.bots.client(bot_name)?;
        client.call("getChatAdministrators", &body).await
    }

    pub async fn set_chat_title(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        title: &str,
    ) -> Result<bool, String> {
        let body = chat::build_set_chat_title(chat_id, title);
        let client = self.bots.client(bot_name)?;
        client.call("setChatTitle", &body).await
    }

    pub async fn set_chat_description(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        description: &str,
    ) -> Result<bool, String> {
        let body = chat::build_set_chat_description(chat_id, description);
        let client = self.bots.client(bot_name)?;
        client.call("setChatDescription", &body).await
    }

    pub async fn ban_chat_member(
        &mut self,
        bot_name: &str,
        req: &BanChatMemberRequest,
    ) -> Result<bool, String> {
        let body = chat::build_ban_chat_member(req);
        let client = self.bots.client(bot_name)?;
        client.call("banChatMember", &body).await
    }

    pub async fn unban_chat_member(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        user_id: i64,
        only_if_banned: bool,
    ) -> Result<bool, String> {
        let body = chat::build_unban_chat_member(chat_id, user_id, only_if_banned);
        let client = self.bots.client(bot_name)?;
        client.call("unbanChatMember", &body).await
    }

    pub async fn restrict_chat_member(
        &mut self,
        bot_name: &str,
        req: &RestrictChatMemberRequest,
    ) -> Result<bool, String> {
        let body = chat::build_restrict_chat_member(req);
        let client = self.bots.client(bot_name)?;
        client.call("restrictChatMember", &body).await
    }

    pub async fn promote_chat_member(
        &mut self,
        bot_name: &str,
        req: &PromoteChatMemberRequest,
    ) -> Result<bool, String> {
        let body = chat::build_promote_chat_member(req);
        let client = self.bots.client(bot_name)?;
        client.call("promoteChatMember", &body).await
    }

    pub async fn leave_chat(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
    ) -> Result<bool, String> {
        let body = chat::build_leave_chat(chat_id);
        let client = self.bots.client(bot_name)?;
        client.call("leaveChat", &body).await
    }

    pub async fn export_chat_invite_link(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
    ) -> Result<String, String> {
        let body = chat::build_export_chat_invite_link(chat_id);
        let client = self.bots.client(bot_name)?;
        client.call("exportChatInviteLink", &body).await
    }

    pub async fn create_invite_link(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        name: Option<&str>,
        expire_date: Option<i64>,
        member_limit: Option<i64>,
        creates_join_request: bool,
    ) -> Result<ChatInviteLink, String> {
        let body =
            chat::build_create_invite_link(chat_id, name, expire_date, member_limit, creates_join_request);
        let client = self.bots.client(bot_name)?;
        client.call("createChatInviteLink", &body).await
    }

    // ── Files ───────────────────────────────────────────────────────

    pub async fn get_file(&self, bot_name: &str, file_id: &str) -> Result<TgFile, String> {
        let body = files::build_get_file(file_id);
        let client = self.bots.client(bot_name)?;
        client.call("getFile", &body).await
    }

    pub async fn download_file(
        &self,
        bot_name: &str,
        file_path: &str,
    ) -> Result<Vec<u8>, String> {
        let client = self.bots.client(bot_name)?;
        client.download_file(file_path).await
    }

    pub async fn upload_file(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        upload: &files::FileUpload,
        caption: Option<&str>,
        parse_mode: Option<&ParseMode>,
    ) -> Result<TgMessage, String> {
        let form = files::build_upload_form(chat_id, upload, caption, parse_mode, false, None)?;
        let method = files::upload_method_for_field(&upload.field_name);
        let client = self.bots.client(bot_name)?;
        let result = client.call_multipart(method, form).await;
        self.log_message_result(
            bot_name,
            chat_id,
            &format!("[file: {}]", upload.file_name),
            &result,
            MessageSource::Manual,
        );
        result
    }

    // ── Webhooks ────────────────────────────────────────────────────

    pub async fn get_updates(
        &self,
        bot_name: &str,
        offset: Option<i64>,
        limit: Option<i64>,
        timeout: Option<i64>,
    ) -> Result<Vec<TgUpdate>, String> {
        let body = webhooks::build_get_updates(offset, limit, timeout, None);
        let client = self.bots.client(bot_name)?;
        client.call("getUpdates", &body).await
    }

    pub async fn set_webhook(
        &self,
        bot_name: &str,
        config: &WebhookConfig,
    ) -> Result<bool, String> {
        let body = webhooks::build_set_webhook(config);
        let client = self.bots.client(bot_name)?;
        client.call("setWebhook", &body).await
    }

    pub async fn delete_webhook(
        &self,
        bot_name: &str,
        drop_pending: bool,
    ) -> Result<bool, String> {
        let body = webhooks::build_delete_webhook(drop_pending);
        let client = self.bots.client(bot_name)?;
        client.call("deleteWebhook", &body).await
    }

    pub async fn get_webhook_info(&self, bot_name: &str) -> Result<WebhookInfo, String> {
        let client = self.bots.client(bot_name)?;
        client.call_no_params("getWebhookInfo").await
    }

    // ── Notifications ───────────────────────────────────────────────

    pub fn add_notification_rule(&mut self, rule: NotificationRule) {
        self.notifications.upsert_rule(rule);
    }

    pub fn remove_notification_rule(&mut self, rule_id: &str) -> Result<(), String> {
        self.notifications.remove_rule(rule_id)
    }

    pub fn list_notification_rules(&self) -> &[NotificationRule] {
        self.notifications.list_rules()
    }

    /// Process a connection event through notification rules.
    ///
    /// Returns the list of notification results for rules that fired.
    pub async fn process_connection_event(
        &mut self,
        event: &ConnectionEvent,
    ) -> Vec<NotificationResult> {
        let to_fire = self.notifications.process_event(event);
        // Collect into a Vec to release the immutable borrow on self.notifications
        let to_fire: Vec<_> = to_fire.into_iter().map(|(r, m)| {
            (r.id.clone(), r.name.clone(), r.bot_name.clone(), r.chat_id.clone(), r.parse_mode.clone(), m)
        }).collect();
        let mut results = Vec::new();

        for (rule_id, rule_name, bot_name, chat_id, parse_mode, message) in to_fire {
            let send_req = SendMessageRequest {
                chat_id: chat_id.clone(),
                text: message.clone(),
                parse_mode,
                disable_web_page_preview: false,
                disable_notification: false,
                protect_content: false,
                reply_to_message_id: None,
                reply_markup: None,
                message_thread_id: None,
            };

            let body = messaging::build_send_message(&send_req);
            let send_result = match self.bots.client(&bot_name) {
                Ok(client) => {
                    let r: Result<TgMessage, String> = client.call("sendMessage", &body).await;
                    r
                }
                Err(e) => Err(e),
            };

            let nr = match send_result {
                Ok(msg) => {
                    self.bots.record_success(&bot_name);
                    self.total_notifications_sent += 1;
                    self.notifications.mark_triggered(&rule_id);
                    NotificationResult {
                        rule_id,
                        rule_name,
                        success: true,
                        message_id: Some(msg.message_id),
                        error: None,
                        timestamp: Utc::now(),
                    }
                }
                Err(e) => {
                    self.bots.record_failure(&bot_name);
                    NotificationResult {
                        rule_id,
                        rule_name,
                        success: false,
                        message_id: None,
                        error: Some(e),
                        timestamp: Utc::now(),
                    }
                }
            };

            let send_ok: Result<(), String> = if nr.success {
                Ok(())
            } else {
                Err(nr.error.clone().unwrap_or_default())
            };
            self.log_message_result(
                &bot_name,
                &chat_id,
                &message,
                &send_ok,
                MessageSource::Notification,
            );
            self.notifications.record_result(nr.clone());
            results.push(nr);
        }

        results
    }

    // ── Monitoring ──────────────────────────────────────────────────

    pub fn add_monitoring_check(&mut self, check: MonitoringCheck) {
        self.monitoring.upsert_check(check);
    }

    pub fn remove_monitoring_check(&mut self, check_id: &str) -> Result<(), String> {
        self.monitoring.remove_check(check_id)
    }

    pub fn list_monitoring_checks(&self) -> &[MonitoringCheck] {
        self.monitoring.list_checks()
    }

    /// Record a monitoring check result and send alert if needed.
    pub async fn record_monitoring_result(
        &mut self,
        result: MonitoringCheckResult,
    ) -> Option<NotificationResult> {
        let alert = self.monitoring.record_result(result);

        if let Some((alert_type, message)) = alert {
            // Find the check to get bot_name and chat_id.
            // We need to clone values since we can't borrow self.monitoring and self.bots simultaneously.
            let check_info: Option<(String, ChatId, Option<ParseMode>)> = self
                .monitoring
                .list_checks()
                .iter()
                .find(|c| c.consecutive_failures >= c.failure_threshold || alert_type == MonitoringAlertType::Recovery)
                .map(|c| (c.bot_name.clone(), c.chat_id.clone(), c.parse_mode.clone()));

            if let Some((bot_name, chat_id, parse_mode)) = check_info {
                let send_req = SendMessageRequest {
                    chat_id: chat_id.clone(),
                    text: message.clone(),
                    parse_mode,
                    disable_web_page_preview: false,
                    disable_notification: false,
                    protect_content: false,
                    reply_to_message_id: None,
                    reply_markup: None,
                    message_thread_id: None,
                };

                let body = messaging::build_send_message(&send_req);
                let send_result = match self.bots.client(&bot_name) {
                    Ok(client) => {
                        let r: Result<TgMessage, String> = client.call("sendMessage", &body).await;
                        r
                    }
                    Err(e) => Err(e),
                };

                let nr = match send_result {
                    Ok(msg) => {
                        self.bots.record_success(&bot_name);
                        self.total_alerts_sent += 1;
                        NotificationResult {
                            rule_id: format!("monitoring-{:?}", alert_type),
                            rule_name: format!("Monitoring {:?}", alert_type),
                            success: true,
                            message_id: Some(msg.message_id),
                            error: None,
                            timestamp: Utc::now(),
                        }
                    }
                    Err(e) => {
                        self.bots.record_failure(&bot_name);
                        NotificationResult {
                            rule_id: format!("monitoring-{:?}", alert_type),
                            rule_name: format!("Monitoring {:?}", alert_type),
                            success: false,
                            message_id: None,
                            error: Some(e),
                            timestamp: Utc::now(),
                        }
                    }
                };

                return Some(nr);
            }
        }

        None
    }

    // ── Templates ───────────────────────────────────────────────────

    pub fn add_template(&mut self, template: MessageTemplate) {
        self.templates.upsert(template);
    }

    pub fn remove_template(&mut self, template_id: &str) -> Result<(), String> {
        self.templates.remove(template_id)
    }

    pub fn list_templates(&self) -> &[MessageTemplate] {
        self.templates.list()
    }

    pub async fn send_template(
        &mut self,
        req: &SendTemplateRequest,
    ) -> Result<TgMessage, String> {
        let rendered = self.templates.render(&req.template_id, &req.variables)?;
        let template = self
            .templates
            .get(&req.template_id)
            .ok_or("Template not found")?;

        let send_req = SendMessageRequest {
            chat_id: req.chat_id.clone(),
            text: rendered.clone(),
            parse_mode: template.parse_mode.clone(),
            disable_web_page_preview: false,
            disable_notification: req.disable_notification,
            protect_content: false,
            reply_to_message_id: req.reply_to_message_id,
            reply_markup: template
                .reply_markup
                .as_ref()
                .map(|rm| ReplyMarkup::InlineKeyboard(rm.clone())),
            message_thread_id: None,
        };

        let body = messaging::build_send_message(&send_req);
        let client = self.bots.client(&req.bot_name)?;
        let result = client.call("sendMessage", &body).await;
        self.log_message_result(
            &req.bot_name,
            &req.chat_id,
            &rendered,
            &result,
            MessageSource::Template,
        );
        result
    }

    // ── Scheduled messages ──────────────────────────────────────────

    pub fn schedule_message(&mut self, msg: ScheduledMessage) {
        self.scheduled_messages.push(msg);
    }

    pub fn cancel_scheduled_message(&mut self, msg_id: &str) -> Result<(), String> {
        let initial = self.scheduled_messages.len();
        self.scheduled_messages
            .retain(|m| m.id != msg_id || m.delivered);
        if self.scheduled_messages.len() == initial {
            return Err(format!("Scheduled message '{}' not found or already delivered", msg_id));
        }
        Ok(())
    }

    pub fn list_scheduled_messages(&self) -> Vec<&ScheduledMessage> {
        self.scheduled_messages
            .iter()
            .filter(|m| !m.delivered)
            .collect()
    }

    /// Process due scheduled messages (send those past their scheduled_at time).
    pub async fn process_scheduled_messages(&mut self) -> Vec<(String, Result<i64, String>)> {
        let now = Utc::now();
        let due_indices: Vec<usize> = self
            .scheduled_messages
            .iter()
            .enumerate()
            .filter(|(_, m)| !m.delivered && m.scheduled_at <= now)
            .map(|(i, _)| i)
            .collect();

        let mut results = Vec::new();

        for idx in due_indices {
            let msg = &self.scheduled_messages[idx];
            let bot_name = msg.bot_name.clone();
            let msg_id = msg.id.clone();
            let chat_id = msg.chat_id.clone();

            let send_req = SendMessageRequest {
                chat_id: msg.chat_id.clone(),
                text: msg.text.clone(),
                parse_mode: msg.parse_mode.clone(),
                disable_web_page_preview: msg.disable_web_page_preview,
                disable_notification: msg.disable_notification,
                protect_content: false,
                reply_to_message_id: None,
                reply_markup: msg.reply_markup.clone(),
                message_thread_id: None,
            };

            let body = messaging::build_send_message(&send_req);
            let send_result = match self.bots.client(&bot_name) {
                Ok(client) => {
                    let r: Result<TgMessage, String> = client.call("sendMessage", &body).await;
                    r
                }
                Err(e) => Err(e),
            };

            match send_result {
                Ok(tg_msg) => {
                    let sm = &mut self.scheduled_messages[idx];
                    sm.delivered = true;
                    sm.delivered_at = Some(now);
                    sm.message_id = Some(tg_msg.message_id);
                    self.bots.record_success(&bot_name);
                    self.total_messages_sent += 1;
                    results.push((msg_id, Ok(tg_msg.message_id)));
                }
                Err(e) => {
                    let sm = &mut self.scheduled_messages[idx];
                    sm.error = Some(e.clone());
                    self.bots.record_failure(&bot_name);
                    self.total_messages_failed += 1;
                    results.push((msg_id, Err(e)));
                }
            }

            let sched_ok: Result<(), String> = match &results.last().unwrap().1 {
                Ok(_) => Ok(()),
                Err(e) => Err(e.clone()),
            };
            self.log_message_result(
                &bot_name,
                &chat_id,
                "[scheduled]",
                &sched_ok,
                MessageSource::Scheduled,
            );
        }

        results
    }

    // ── Broadcast ───────────────────────────────────────────────────

    pub async fn broadcast(
        &mut self,
        req: &BroadcastRequest,
    ) -> Result<BroadcastResult, String> {
        let mut item_results = Vec::new();
        let total = req.chat_ids.len();

        for cid in &req.chat_ids {
            let send_req = SendMessageRequest {
                chat_id: cid.clone(),
                text: req.text.clone(),
                parse_mode: req.parse_mode.clone(),
                disable_web_page_preview: req.disable_web_page_preview,
                disable_notification: req.disable_notification,
                protect_content: false,
                reply_to_message_id: None,
                reply_markup: req.reply_markup.clone(),
                message_thread_id: None,
            };

            let body = messaging::build_send_message(&send_req);
            let client = self.bots.client(&req.bot_name)?;
            let result: Result<TgMessage, String> = client.call("sendMessage", &body).await;

            match result {
                Ok(msg) => {
                    self.bots.record_success(&req.bot_name);
                    self.total_messages_sent += 1;
                    item_results.push(BroadcastItemResult {
                        chat_id: cid.to_string(),
                        success: true,
                        message_id: Some(msg.message_id),
                        error: None,
                    });
                }
                Err(e) => {
                    self.bots.record_failure(&req.bot_name);
                    self.total_messages_failed += 1;
                    item_results.push(BroadcastItemResult {
                        chat_id: cid.to_string(),
                        success: false,
                        message_id: None,
                        error: Some(e),
                    });
                }
            }
        }

        let successful = item_results.iter().filter(|r| r.success).count();
        let failed = item_results.iter().filter(|r| !r.success).count();

        Ok(BroadcastResult {
            total,
            successful,
            failed,
            results: item_results,
        })
    }

    // ── Digests ─────────────────────────────────────────────────────

    pub fn add_digest(&mut self, config: DigestConfig) {
        if let Some(existing) = self.digests.iter_mut().find(|d| d.id == config.id) {
            *existing = config;
        } else {
            self.digests.push(config);
        }
    }

    pub fn remove_digest(&mut self, digest_id: &str) -> Result<(), String> {
        let initial = self.digests.len();
        self.digests.retain(|d| d.id != digest_id);
        if self.digests.len() == initial {
            return Err(format!("Digest '{}' not found", digest_id));
        }
        Ok(())
    }

    pub fn list_digests(&self) -> &[DigestConfig] {
        &self.digests
    }

    // ── Stats & logs ────────────────────────────────────────────────

    pub fn stats(&self) -> TelegramStats {
        let uptime = Utc::now()
            .signed_duration_since(self.started_at)
            .num_seconds()
            .max(0) as u64;

        TelegramStats {
            configured_bots: self.bots.count(),
            active_bots: self.bots.active_count(),
            notification_rules: self.notifications.list_rules().len(),
            active_rules: self.notifications.active_rule_count(),
            monitoring_checks: self.monitoring.list_checks().len(),
            active_checks: self.monitoring.active_count(),
            digest_configs: self.digests.len(),
            templates: self.templates.count(),
            scheduled_messages_pending: self
                .scheduled_messages
                .iter()
                .filter(|m| !m.delivered)
                .count(),
            total_messages_sent: self.total_messages_sent,
            total_messages_failed: self.total_messages_failed,
            total_notifications_sent: self.total_notifications_sent,
            total_alerts_sent: self.total_alerts_sent,
            message_log_size: self.message_log.len(),
            uptime_seconds: uptime,
        }
    }

    pub fn message_log(&self, limit: usize) -> Vec<&MessageLogEntry> {
        self.message_log.iter().rev().take(limit).collect()
    }

    pub fn clear_message_log(&mut self) {
        self.message_log.clear();
    }

    // ── Internal helpers ────────────────────────────────────────────

    fn log_message_result<T>(
        &mut self,
        bot_name: &str,
        chat_id: &ChatId,
        text_preview: &str,
        result: &Result<T, String>,
        source: MessageSource,
    ) {
        let (success, error) = match result {
            Ok(_) => {
                self.total_messages_sent += 1;
                self.bots.record_success(bot_name);
                (true, None)
            }
            Err(e) => {
                self.total_messages_failed += 1;
                self.bots.record_failure(bot_name);
                (false, Some(e.clone()))
            }
        };

        let entry = MessageLogEntry {
            id: Uuid::new_v4().to_string(),
            bot_name: bot_name.to_string(),
            chat_id: chat_id.to_string(),
            text_preview: text_preview.chars().take(100).collect(),
            message_id: None,
            success,
            error,
            timestamp: Utc::now(),
            source,
        };

        self.message_log.push(entry);
        while self.message_log.len() > self.max_log_entries {
            self.message_log.remove(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[tokio::test]
    async fn service_creation() {
        let state = TelegramService::new();
        let svc = state.lock().await;
        assert_eq!(svc.bots.count(), 0);
        assert!(svc.templates.count() >= 4); // builtins loaded
    }

    #[tokio::test]
    async fn add_and_list_bots() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        svc.add_bot(TelegramBotConfig {
            name: "test".to_string(),
            token: "123:ABC".to_string(),
            ..Default::default()
        })
        .unwrap();
        let bots = svc.list_bots();
        assert_eq!(bots.len(), 1);
        assert_eq!(bots[0].name, "test");
    }

    #[tokio::test]
    async fn stats_initial() {
        let state = TelegramService::new();
        let svc = state.lock().await;
        let stats = svc.stats();
        assert_eq!(stats.configured_bots, 0);
        assert_eq!(stats.total_messages_sent, 0);
        assert!(stats.templates >= 4);
    }

    #[tokio::test]
    async fn schedule_and_cancel() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        svc.schedule_message(ScheduledMessage {
            id: "s1".to_string(),
            bot_name: "bot".to_string(),
            chat_id: ChatId::Numeric(1),
            text: "Hello".to_string(),
            parse_mode: None,
            scheduled_at: Utc::now() + chrono::Duration::hours(1),
            delivered: false,
            delivered_at: None,
            message_id: None,
            error: None,
            reply_markup: None,
            disable_web_page_preview: false,
            disable_notification: false,
            created_at: Utc::now(),
        });
        assert_eq!(svc.list_scheduled_messages().len(), 1);
        svc.cancel_scheduled_message("s1").unwrap();
        assert_eq!(svc.list_scheduled_messages().len(), 0);
    }

    #[tokio::test]
    async fn notification_rules_crud() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        let rule = NotificationRule {
            id: "r1".to_string(),
            name: "Test Rule".to_string(),
            enabled: true,
            bot_name: "bot".to_string(),
            chat_id: ChatId::Numeric(1),
            event_types: vec![ConnectionEventType::Connected],
            min_severity: None,
            host_filter: None,
            protocol_filter: None,
            template: None,
            parse_mode: None,
            throttle_seconds: None,
            created_at: Utc::now(),
            last_triggered: None,
            trigger_count: 0,
        };
        svc.add_notification_rule(rule);
        assert_eq!(svc.list_notification_rules().len(), 1);
        svc.remove_notification_rule("r1").unwrap();
        assert_eq!(svc.list_notification_rules().len(), 0);
    }

    #[tokio::test]
    async fn monitoring_checks_crud() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        svc.add_monitoring_check(MonitoringCheck {
            id: "c1".to_string(),
            name: "Ping".to_string(),
            enabled: true,
            bot_name: "bot".to_string(),
            chat_id: ChatId::Numeric(1),
            check_type: MonitoringCheckType::Ping,
            interval_seconds: 60,
            thresholds: None,
            failure_threshold: 3,
            notify_on_recovery: true,
            parse_mode: None,
            alert_template: None,
            recovery_template: None,
            created_at: Utc::now(),
            status: MonitoringStatus::Unknown,
            consecutive_failures: 0,
            last_check: None,
            last_alert: None,
        });
        assert_eq!(svc.list_monitoring_checks().len(), 1);
        svc.remove_monitoring_check("c1").unwrap();
        assert_eq!(svc.list_monitoring_checks().len(), 0);
    }

    #[tokio::test]
    async fn templates_crud() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        let initial = svc.list_templates().len();
        svc.add_template(MessageTemplate {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            body: "Hello {{name}}".to_string(),
            parse_mode: None,
            default_variables: HashMap::new(),
            reply_markup: None,
            description: None,
            created_at: Utc::now(),
            updated_at: None,
        });
        assert_eq!(svc.list_templates().len(), initial + 1);
        svc.remove_template("custom").unwrap();
        assert_eq!(svc.list_templates().len(), initial);
    }

    #[tokio::test]
    async fn digests_crud() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        svc.add_digest(DigestConfig {
            id: "d1".to_string(),
            name: "Daily".to_string(),
            enabled: true,
            bot_name: "bot".to_string(),
            chat_id: ChatId::Numeric(1),
            schedule: "daily".to_string(),
            include: DigestIncludes {
                active_sessions: true,
                recent_connections: true,
                failed_connections: true,
                monitoring_status: true,
                system_stats: false,
                notification_summary: false,
            },
            parse_mode: None,
            template: None,
            created_at: Utc::now(),
            last_sent: None,
        });
        assert_eq!(svc.list_digests().len(), 1);
        svc.remove_digest("d1").unwrap();
        assert_eq!(svc.list_digests().len(), 0);
    }

    #[tokio::test]
    async fn message_log() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;

        // Manually add a log entry by calling the internal helper.
        svc.log_message_result::<()>(
            "bot1",
            &ChatId::Numeric(1),
            "test message",
            &Err("test error".to_string()),
            MessageSource::Manual,
        );

        let log = svc.message_log(10);
        assert_eq!(log.len(), 1);
        assert!(!log[0].success);
        assert_eq!(log[0].source, MessageSource::Manual);

        svc.clear_message_log();
        assert_eq!(svc.message_log(10).len(), 0);
    }

    #[tokio::test]
    async fn remove_bot_test() {
        let state = TelegramService::new();
        let mut svc = state.lock().await;
        svc.add_bot(TelegramBotConfig {
            name: "test".to_string(),
            token: "123:ABC".to_string(),
            ..Default::default()
        })
        .unwrap();
        svc.remove_bot("test").unwrap();
        assert!(svc.list_bots().is_empty());
    }
}
