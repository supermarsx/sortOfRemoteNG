// useTelegram — real Tauri `invoke(...)` wrappers for the sorng-telegram backend.
//
// Binds all 78 Telegram commands registered in the Tauri handler
// (`sorng-commands-collab/src/collab_handler.rs`, mirroring
// `sorng-telegram/src/commands.rs`). Telegram is a *registry of many bots*:
// commands key by `botName` rather than a single connection id.
//
// Arg names are camelCase — Tauri v2 maps them to the Rust snake_case
// `#[tauri::command]` params (e.g. `botName` → `bot_name`, `chatId` → `chat_id`).
// Request-body structs (`req`, `config`, `rule`, `check`, …) are passed through
// whole; their fields follow the crate's serde casing (see ../../types/telegram).

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AnswerCallbackQueryRequest,
  BanChatMemberRequest,
  BotSummary,
  BroadcastRequest,
  BroadcastResult,
  ChatAction,
  ChatId,
  ChatInviteLink,
  ChatMember,
  ConnectionEvent,
  CopyMessageRequest,
  DigestConfig,
  EditMessageCaptionRequest,
  EditMessageReplyMarkupRequest,
  EditMessageTextRequest,
  ForwardMessageRequest,
  MessageId,
  MessageLogEntry,
  MessageTemplate,
  MonitoringCheck,
  MonitoringCheckResult,
  MonitoringSummary,
  NotificationResult,
  NotificationRule,
  ParseMode,
  PromoteChatMemberRequest,
  RestrictChatMemberRequest,
  ScheduledMessage,
  ScheduledProcessResult,
  SendAudioRequest,
  SendContactRequest,
  SendDiceRequest,
  SendDocumentRequest,
  SendLocationRequest,
  SendMessageRequest,
  SendPhotoRequest,
  SendPollRequest,
  SendStickerRequest,
  SendTemplateRequest,
  SendVideoRequest,
  SendVoiceRequest,
  TelegramBotConfig,
  TelegramStats,
  TgChat,
  TgFile,
  TgMessage,
  TgUpdate,
  TgUser,
  WebhookConfig,
  WebhookInfo,
} from "../../types/telegram";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const telegramApi = {
  // Bot management
  addBot: (config: TelegramBotConfig) =>
    invoke<void>("telegram_add_bot", { config }),
  removeBot: (name: string) => invoke<void>("telegram_remove_bot", { name }),
  listBots: () => invoke<BotSummary[]>("telegram_list_bots"),
  validateBot: (name: string) =>
    invoke<TgUser>("telegram_validate_bot", { name }),
  setBotEnabled: (name: string, enabled: boolean) =>
    invoke<void>("telegram_set_bot_enabled", { name, enabled }),
  updateBotToken: (name: string, token: string) =>
    invoke<void>("telegram_update_bot_token", { name, token }),

  // Messaging
  sendMessage: (botName: string, req: SendMessageRequest) =>
    invoke<TgMessage>("telegram_send_message", { botName, req }),
  sendPhoto: (botName: string, req: SendPhotoRequest) =>
    invoke<TgMessage>("telegram_send_photo", { botName, req }),
  sendDocument: (botName: string, req: SendDocumentRequest) =>
    invoke<TgMessage>("telegram_send_document", { botName, req }),
  sendVideo: (botName: string, req: SendVideoRequest) =>
    invoke<TgMessage>("telegram_send_video", { botName, req }),
  sendAudio: (botName: string, req: SendAudioRequest) =>
    invoke<TgMessage>("telegram_send_audio", { botName, req }),
  sendVoice: (botName: string, req: SendVoiceRequest) =>
    invoke<TgMessage>("telegram_send_voice", { botName, req }),
  sendLocation: (botName: string, req: SendLocationRequest) =>
    invoke<TgMessage>("telegram_send_location", { botName, req }),
  sendContact: (botName: string, req: SendContactRequest) =>
    invoke<TgMessage>("telegram_send_contact", { botName, req }),
  sendPoll: (botName: string, req: SendPollRequest) =>
    invoke<TgMessage>("telegram_send_poll", { botName, req }),
  sendDice: (botName: string, req: SendDiceRequest) =>
    invoke<TgMessage>("telegram_send_dice", { botName, req }),
  sendSticker: (botName: string, req: SendStickerRequest) =>
    invoke<TgMessage>("telegram_send_sticker", { botName, req }),
  sendChatAction: (botName: string, chatId: ChatId, action: ChatAction) =>
    invoke<boolean>("telegram_send_chat_action", { botName, chatId, action }),

  // Message management
  editMessageText: (botName: string, req: EditMessageTextRequest) =>
    invoke<TgMessage>("telegram_edit_message_text", { botName, req }),
  editMessageCaption: (botName: string, req: EditMessageCaptionRequest) =>
    invoke<TgMessage>("telegram_edit_message_caption", { botName, req }),
  editMessageReplyMarkup: (
    botName: string,
    req: EditMessageReplyMarkupRequest,
  ) => invoke<TgMessage>("telegram_edit_message_reply_markup", { botName, req }),
  deleteMessage: (botName: string, chatId: ChatId, messageId: number) =>
    invoke<boolean>("telegram_delete_message", { botName, chatId, messageId }),
  forwardMessage: (botName: string, req: ForwardMessageRequest) =>
    invoke<TgMessage>("telegram_forward_message", { botName, req }),
  copyMessage: (botName: string, req: CopyMessageRequest) =>
    invoke<MessageId>("telegram_copy_message", { botName, req }),
  pinMessage: (
    botName: string,
    chatId: ChatId,
    messageId: number,
    disableNotification?: boolean,
  ) =>
    invoke<boolean>("telegram_pin_message", {
      botName,
      chatId,
      messageId,
      disableNotification,
    }),
  unpinMessage: (botName: string, chatId: ChatId, messageId?: number) =>
    invoke<boolean>("telegram_unpin_message", { botName, chatId, messageId }),
  unpinAllMessages: (botName: string, chatId: ChatId) =>
    invoke<boolean>("telegram_unpin_all_messages", { botName, chatId }),
  answerCallbackQuery: (botName: string, req: AnswerCallbackQueryRequest) =>
    invoke<boolean>("telegram_answer_callback_query", { botName, req }),

  // Chat management
  getChat: (botName: string, chatId: ChatId) =>
    invoke<TgChat>("telegram_get_chat", { botName, chatId }),
  getChatMemberCount: (botName: string, chatId: ChatId) =>
    invoke<number>("telegram_get_chat_member_count", { botName, chatId }),
  getChatMember: (botName: string, chatId: ChatId, userId: number) =>
    invoke<ChatMember>("telegram_get_chat_member", { botName, chatId, userId }),
  getChatAdministrators: (botName: string, chatId: ChatId) =>
    invoke<ChatMember[]>("telegram_get_chat_administrators", {
      botName,
      chatId,
    }),
  setChatTitle: (botName: string, chatId: ChatId, title: string) =>
    invoke<boolean>("telegram_set_chat_title", { botName, chatId, title }),
  setChatDescription: (botName: string, chatId: ChatId, description: string) =>
    invoke<boolean>("telegram_set_chat_description", {
      botName,
      chatId,
      description,
    }),
  banChatMember: (botName: string, req: BanChatMemberRequest) =>
    invoke<boolean>("telegram_ban_chat_member", { botName, req }),
  unbanChatMember: (
    botName: string,
    chatId: ChatId,
    userId: number,
    onlyIfBanned?: boolean,
  ) =>
    invoke<boolean>("telegram_unban_chat_member", {
      botName,
      chatId,
      userId,
      onlyIfBanned,
    }),
  restrictChatMember: (botName: string, req: RestrictChatMemberRequest) =>
    invoke<boolean>("telegram_restrict_chat_member", { botName, req }),
  promoteChatMember: (botName: string, req: PromoteChatMemberRequest) =>
    invoke<boolean>("telegram_promote_chat_member", { botName, req }),
  leaveChat: (botName: string, chatId: ChatId) =>
    invoke<boolean>("telegram_leave_chat", { botName, chatId }),
  exportChatInviteLink: (botName: string, chatId: ChatId) =>
    invoke<string>("telegram_export_chat_invite_link", { botName, chatId }),
  createInviteLink: (
    botName: string,
    chatId: ChatId,
    name?: string,
    expireDate?: number,
    memberLimit?: number,
    createsJoinRequest?: boolean,
  ) =>
    invoke<ChatInviteLink>("telegram_create_invite_link", {
      botName,
      chatId,
      name,
      expireDate,
      memberLimit,
      createsJoinRequest,
    }),

  // Files
  getFile: (botName: string, fileId: string) =>
    invoke<TgFile>("telegram_get_file", { botName, fileId }),
  downloadFile: (botName: string, filePath: string) =>
    invoke<number[]>("telegram_download_file", { botName, filePath }),
  uploadFile: (
    botName: string,
    chatId: ChatId,
    fileName: string,
    data: number[],
    caption?: string,
    parseMode?: ParseMode,
  ) =>
    invoke<TgMessage>("telegram_upload_file", {
      botName,
      chatId,
      fileName,
      data,
      caption,
      parseMode,
    }),

  // Webhooks & updates
  getUpdates: (
    botName: string,
    offset?: number,
    limit?: number,
    timeout?: number,
  ) => invoke<TgUpdate[]>("telegram_get_updates", { botName, offset, limit, timeout }),
  setWebhook: (botName: string, config: WebhookConfig) =>
    invoke<boolean>("telegram_set_webhook", { botName, config }),
  deleteWebhook: (botName: string, dropPendingUpdates?: boolean) =>
    invoke<boolean>("telegram_delete_webhook", { botName, dropPendingUpdates }),
  getWebhookInfo: (botName: string) =>
    invoke<WebhookInfo>("telegram_get_webhook_info", { botName }),

  // Notification rules
  addNotificationRule: (rule: NotificationRule) =>
    invoke<void>("telegram_add_notification_rule", { rule }),
  removeNotificationRule: (ruleId: string) =>
    invoke<void>("telegram_remove_notification_rule", { ruleId }),
  listNotificationRules: () =>
    invoke<NotificationRule[]>("telegram_list_notification_rules"),
  setNotificationRuleEnabled: (ruleId: string, enabled: boolean) =>
    invoke<void>("telegram_set_notification_rule_enabled", { ruleId, enabled }),
  processConnectionEvent: (event: ConnectionEvent) =>
    invoke<NotificationResult[]>("telegram_process_connection_event", { event }),

  // Monitoring
  addMonitoringCheck: (check: MonitoringCheck) =>
    invoke<void>("telegram_add_monitoring_check", { check }),
  removeMonitoringCheck: (checkId: string) =>
    invoke<void>("telegram_remove_monitoring_check", { checkId }),
  listMonitoringChecks: () =>
    invoke<MonitoringCheck[]>("telegram_list_monitoring_checks"),
  setMonitoringCheckEnabled: (checkId: string, enabled: boolean) =>
    invoke<void>("telegram_set_monitoring_check_enabled", { checkId, enabled }),
  monitoringSummary: () =>
    invoke<MonitoringSummary>("telegram_monitoring_summary"),
  recordMonitoringResult: (result: MonitoringCheckResult) =>
    invoke<NotificationResult | null>("telegram_record_monitoring_result", {
      result,
    }),

  // Templates
  addTemplate: (template: MessageTemplate) =>
    invoke<void>("telegram_add_template", { template }),
  removeTemplate: (templateId: string) =>
    invoke<void>("telegram_remove_template", { templateId }),
  listTemplates: () => invoke<MessageTemplate[]>("telegram_list_templates"),
  renderTemplate: (templateId: string, variables: Record<string, string>) =>
    invoke<string>("telegram_render_template", { templateId, variables }),
  validateTemplateBody: (body: string) =>
    invoke<string[]>("telegram_validate_template_body", { body }),
  sendTemplate: (req: SendTemplateRequest) =>
    invoke<TgMessage>("telegram_send_template", { req }),

  // Scheduled messages
  scheduleMessage: (msg: ScheduledMessage) =>
    invoke<void>("telegram_schedule_message", { msg }),
  cancelScheduledMessage: (msgId: string) =>
    invoke<void>("telegram_cancel_scheduled_message", { msgId }),
  listScheduledMessages: () =>
    invoke<ScheduledMessage[]>("telegram_list_scheduled_messages"),
  processScheduledMessages: () =>
    invoke<ScheduledProcessResult>("telegram_process_scheduled_messages"),

  // Broadcast
  broadcast: (req: BroadcastRequest) =>
    invoke<BroadcastResult>("telegram_broadcast", { req }),

  // Digests
  addDigest: (config: DigestConfig) =>
    invoke<void>("telegram_add_digest", { config }),
  removeDigest: (digestId: string) =>
    invoke<void>("telegram_remove_digest", { digestId }),
  listDigests: () => invoke<DigestConfig[]>("telegram_list_digests"),

  // Stats & logs
  stats: () => invoke<TelegramStats>("telegram_stats"),
  messageLog: (limit?: number) =>
    invoke<MessageLogEntry[]>("telegram_message_log", { limit }),
  clearMessageLog: () => invoke<void>("telegram_clear_message_log"),
  notificationHistory: () =>
    invoke<NotificationResult[]>("telegram_notification_history"),
  monitoringHistory: () =>
    invoke<MonitoringCheckResult[]>("telegram_monitoring_history"),
};

export type TelegramApi = typeof telegramApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Telegram management hook. Unlike single-connection integrations,
 * Telegram holds a registry of bots (backend keyed by bot name). This hook owns
 * the bot list + shared `isLoading`/`error`, and exposes the full registered
 * command surface via `api`. The `run` wrapper funnels ops through the same
 * loading/error handling; `refreshBots` reloads the bot registry.
 */
export function useTelegram() {
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshBots = useCallback(async (): Promise<BotSummary[]> => {
    try {
      const list = await telegramApi.listBots();
      setBots(list);
      return list;
    } catch (e) {
      setError(errMsg(e));
      return [];
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    bots,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    refreshBots,
    // full registered command surface + shared runner
    api: telegramApi,
    run,
  };
}

export type TelegramManager = ReturnType<typeof useTelegram>;
