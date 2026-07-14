// Telegram bot management — folded into Notifications (Behavior) settings.
//
// Telegram is notification/bot configuration for a subsystem the app already
// owns (connection-event notifications, monitoring alerts, digests), so per the
// t42 plan it folds into the Notifications settings surface rather than getting
// a standalone Integrations-hub panel. This section is a collapsible sub-panel
// that binds the full 78-command sorng-telegram surface via `useTelegram()`:
// a bot registry manager on top, then a tabbed management surface (send, message
// ops, chat admin, files, webhooks, notification rules, monitoring, templates,
// scheduled messages, broadcast, digests, logs). Bot tokens are stored as
// secrets through the encrypted integration credential store, never in the
// settings JSON.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Send,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SectionProps } from "./types";
import { SettingsCollapsibleSection } from "../../../ui/settings/SettingsPrimitives";
import { useTelegram } from "../../../../hooks/integration/useTelegram";
import { useIntegrationConfigStore } from "../../../../hooks/integrations/useIntegrationConfigStore";
import type {
  BotSummary,
  ChatId,
  DigestConfig,
  MessageLogEntry,
  MessageTemplate,
  MonitoringCheck,
  NotificationRule,
  ScheduledMessage,
  TelegramBotConfig,
  TelegramStats,
} from "../../../../types/telegram";

// ─── Shared UI helpers ───────────────────────────────────────────────────────

const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

/** Parse a chat-id input: numeric id or `@username` string (mirrors `ChatId`). */
function parseChatId(input: string): ChatId {
  const s = input.trim();
  return /^-?\d+$/.test(s) ? Number(s) : s;
}

const Labeled: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
    <span>{label}</span>
    {children}
  </label>
);

const JsonView: React.FC<{ value: unknown }> = ({ value }) =>
  value == null ? null : (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] text-[var(--color-textSecondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );

/** A "parse JSON body → run command" action, used for the richer request
 *  shapes (rules, monitoring checks, templates, keyboards, …) — the same idiom
 *  the Grafana panel uses for alert-rule JSON. */
const JsonAction: React.FC<{
  title: string;
  placeholder: string;
  runLabel: string;
  disabled?: boolean;
  onRun: (parsed: unknown) => Promise<unknown>;
  initial?: string;
}> = ({ title, placeholder, runLabel, disabled, onRun, initial }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(initial ?? "");
  const [result, setResult] = useState<unknown>(null);

  const run = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      window.alert(t("integrations.telegram.invalidJson", "Invalid JSON"));
      return;
    }
    try {
      await onRun(parsed);
      setResult({ ok: true });
    } catch {
      /* surfaced via mgr.error */
    }
  }, [text, onRun, t]);

  return (
    <div className={card}>
      <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
        {title}
      </h4>
      <textarea
        className={`${field} font-mono`}
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
      />
      <button
        className={`${btn} mt-2`}
        onClick={run}
        disabled={disabled || !text}
      >
        {runLabel}
      </button>
      <JsonView value={result} />
    </div>
  );
};

type Mgr = ReturnType<typeof useTelegram>;

type TabKey =
  | "send"
  | "messages"
  | "chats"
  | "files"
  | "webhooks"
  | "rules"
  | "monitoring"
  | "templates"
  | "scheduled"
  | "broadcast"
  | "digests"
  | "logs";

// ─── Bot registry manager ────────────────────────────────────────────────────

interface BotForm {
  name: string;
  token: string;
  apiBaseUrl: string;
  proxyUrl: string;
  timeoutSeconds: string;
  maxRetries: string;
  rateLimitMs: string;
  enabled: boolean;
}

const emptyBot: BotForm = {
  name: "",
  token: "",
  apiBaseUrl: "",
  proxyUrl: "",
  timeoutSeconds: "30",
  maxRetries: "3",
  rateLimitMs: "50",
  enabled: true,
};

const BotManager: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const store = useIntegrationConfigStore();
  const [form, setForm] = useState<BotForm>(emptyBot);
  const [tokenEdits, setTokenEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    void mgr.refreshBots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof BotForm>(k: K, v: BotForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const addBot = useCallback(async () => {
    if (!form.name.trim() || !form.token.trim()) return;
    const config: TelegramBotConfig = {
      name: form.name.trim(),
      token: form.token.trim(),
      apiBaseUrl: form.apiBaseUrl.trim() || null,
      timeoutSeconds: form.timeoutSeconds
        ? Number(form.timeoutSeconds)
        : undefined,
      maxRetries: form.maxRetries ? Number(form.maxRetries) : undefined,
      enabled: form.enabled,
      proxyUrl: form.proxyUrl.trim() || null,
      rateLimitMs: form.rateLimitMs ? Number(form.rateLimitMs) : undefined,
    };
    try {
      await mgr.run(() => mgr.api.addBot(config));
      // Persist the non-secret config + token (encrypted, by reference).
      try {
        await store.createInstance({
          integrationKey: "telegram",
          name: config.name,
          host: config.apiBaseUrl ?? undefined,
          fields: {
            proxyUrl: form.proxyUrl,
            timeoutSeconds: form.timeoutSeconds,
            maxRetries: form.maxRetries,
            rateLimitMs: form.rateLimitMs,
            enabled: String(form.enabled),
          },
          secret: config.token,
        });
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        mgr.setError(
          t(
            "integrations.telegram.secretMirrorFailed",
            "Bot was saved in the Telegram backend, but the local credential mirror failed: {{error}}",
            { error: msg },
          ),
        );
      }
      setForm(emptyBot);
      await mgr.refreshBots();
    } catch {
      /* surfaced via mgr.error */
    }
  }, [form, mgr, store, t]);

  const validate = useCallback(
    async (name: string) => {
      try {
        const user = await mgr.run(() => mgr.api.validateBot(name));
        window.alert(
          t("integrations.telegram.validateOk", "Bot OK: @{{u}}").replace(
            "{{u}}",
            user.username ?? user.first_name,
          ),
        );
        await mgr.refreshBots();
      } catch {
        /* surfaced */
      }
    },
    [mgr, t],
  );

  const toggle = useCallback(
    async (b: BotSummary) => {
      try {
        await mgr.run(() => mgr.api.setBotEnabled(b.name, !b.enabled));
        await mgr.refreshBots();
      } catch {
        /* surfaced */
      }
    },
    [mgr],
  );

  const updateToken = useCallback(
    async (name: string) => {
      const token = tokenEdits[name];
      if (!token) return;
      try {
        await mgr.run(() => mgr.api.updateBotToken(name, token));
        const inst = store.instances.find(
          (i) => i.integrationKey === "telegram" && i.name === name,
        );
        if (inst) {
          try {
            await store.updateInstance(inst.id, { secret: token });
          } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error).message;
            mgr.setError(
              t(
                "integrations.telegram.secretMirrorFailed",
                "Bot was saved in the Telegram backend, but the local credential mirror failed: {{error}}",
                { error: msg },
              ),
            );
          }
        }
        setTokenEdits((m) => ({ ...m, [name]: "" }));
        await mgr.refreshBots();
      } catch {
        /* surfaced */
      }
    },
    [mgr, tokenEdits, store, t],
  );

  const remove = useCallback(
    async (name: string) => {
      if (
        !window.confirm(
          t(
            "integrations.telegram.removeBotConfirm",
            "Remove bot {{n}}?",
          ).replace("{{n}}", name),
        )
      )
        return;
      try {
        await mgr.run(() => mgr.api.removeBot(name));
        const inst = store.instances.find(
          (i) => i.integrationKey === "telegram" && i.name === name,
        );
        if (inst) {
          try {
            await store.deleteInstance(inst.id);
          } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error).message;
            mgr.setError(
              t(
                "integrations.telegram.secretDeleteFailed",
                "Bot was removed from the Telegram backend, but deleting the local credential mirror failed: {{error}}",
                { error: msg },
              ),
            );
          }
        }
        await mgr.refreshBots();
      } catch {
        /* surfaced */
      }
    },
    [mgr, store, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.telegram.addBot", "Add bot")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Labeled label={t("integrations.telegram.botName", "Name")}>
            <input
              className={field}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="alerts-bot"
            />
          </Labeled>
          <Labeled
            label={t("integrations.telegram.token", "Bot token (@BotFather)")}
          >
            <input
              className={field}
              type="password"
              value={form.token}
              onChange={(e) => set("token", e.target.value)}
            />
          </Labeled>
          <Labeled
            label={t(
              "integrations.telegram.apiBaseUrl",
              "API base URL (optional)",
            )}
          >
            <input
              className={field}
              value={form.apiBaseUrl}
              onChange={(e) => set("apiBaseUrl", e.target.value)}
              placeholder="https://api.telegram.org"
            />
          </Labeled>
          <Labeled
            label={t("integrations.telegram.proxyUrl", "Proxy URL (optional)")}
          >
            <input
              className={field}
              value={form.proxyUrl}
              onChange={(e) => set("proxyUrl", e.target.value)}
              placeholder="socks5://…"
            />
          </Labeled>
          <Labeled
            label={t("integrations.telegram.timeout", "Timeout (seconds)")}
          >
            <input
              className={field}
              inputMode="numeric"
              value={form.timeoutSeconds}
              onChange={(e) => set("timeoutSeconds", e.target.value)}
            />
          </Labeled>
          <Labeled label={t("integrations.telegram.maxRetries", "Max retries")}>
            <input
              className={field}
              inputMode="numeric"
              value={form.maxRetries}
              onChange={(e) => set("maxRetries", e.target.value)}
            />
          </Labeled>
          <Labeled
            label={t("integrations.telegram.rateLimit", "Rate limit (ms)")}
          >
            <input
              className={field}
              inputMode="numeric"
              value={form.rateLimitMs}
              onChange={(e) => set("rateLimitMs", e.target.value)}
            />
          </Labeled>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            {t("integrations.telegram.enabled", "Enabled")}
          </label>
          <button
            className={btn}
            onClick={addBot}
            disabled={mgr.isLoading || !form.name || !form.token}
          >
            {mgr.isLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            {t("integrations.telegram.addBot", "Add bot")}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className={btn}
          onClick={() => void mgr.refreshBots()}
          disabled={mgr.isLoading}
        >
          <RefreshCw size={12} />
          {t("integrations.telegram.refresh", "Refresh")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {mgr.bots.map((b) => (
          <div key={b.name} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  {b.name}
                </span>{" "}
                <span
                  className={
                    b.connected
                      ? "text-green-500 text-xs"
                      : "text-[var(--color-textMuted)] text-xs"
                  }
                >
                  {b.connected
                    ? t("integrations.telegram.connected", "Connected")
                    : t("integrations.telegram.disconnected", "Not validated")}
                </span>
                <div className="text-[10px] text-[var(--color-textMuted)]">
                  {b.botUser
                    ? `@${b.botUser.username ?? b.botUser.first_name}`
                    : b.apiBase}{" "}
                  · {t("integrations.telegram.sent", "sent")} {b.messagesSent} ·{" "}
                  {t("integrations.telegram.failed", "failed")}{" "}
                  {b.messagesFailed}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  className={btn}
                  onClick={() => void validate(b.name)}
                  disabled={mgr.isLoading}
                >
                  <CheckCircle2 size={12} />
                  {t("integrations.telegram.validate", "Validate")}
                </button>
                <button
                  className={btn}
                  onClick={() => void toggle(b)}
                  disabled={mgr.isLoading}
                >
                  {b.enabled
                    ? t("integrations.telegram.disable", "Disable")
                    : t("integrations.telegram.enable", "Enable")}
                </button>
                <button
                  className={btn}
                  onClick={() => void remove(b.name)}
                  disabled={mgr.isLoading}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                className={field}
                type="password"
                style={{ maxWidth: 260 }}
                placeholder={t("integrations.telegram.newToken", "New token")}
                value={tokenEdits[b.name] ?? ""}
                onChange={(e) =>
                  setTokenEdits((m) => ({ ...m, [b.name]: e.target.value }))
                }
              />
              <button
                className={btn}
                onClick={() => void updateToken(b.name)}
                disabled={!tokenEdits[b.name]}
              >
                {t("integrations.telegram.updateToken", "Update token")}
              </button>
            </div>
          </div>
        ))}
        {mgr.bots.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.telegram.noBots", "No bots configured yet")}
          </span>
        )}
      </div>
    </div>
  );
};

// ─── Management tabs (operate on a selected bot) ─────────────────────────────

const SendTab: React.FC<{ mgr: Mgr; bot: string }> = ({ mgr, bot }) => {
  const { t } = useTranslation();
  const [chat, setChat] = useState("");
  const [text, setText] = useState("");
  const [media, setMedia] = useState({ kind: "photo", url: "", caption: "" });
  const [action, setAction] = useState("typing");
  const cid = () => parseChatId(chat);

  const guard = (fn: () => Promise<unknown>) => async () => {
    if (!bot || !chat) return;
    try {
      await mgr.run(fn);
    } catch {
      /* surfaced */
    }
  };

  const sendMedia = guard(async () => {
    const c = cid();
    const caption = media.caption || undefined;
    switch (media.kind) {
      case "photo":
        return mgr.api.sendPhoto(bot, { chatId: c, photo: media.url, caption });
      case "document":
        return mgr.api.sendDocument(bot, {
          chatId: c,
          document: media.url,
          caption,
        });
      case "video":
        return mgr.api.sendVideo(bot, { chatId: c, video: media.url, caption });
      case "audio":
        return mgr.api.sendAudio(bot, { chatId: c, audio: media.url, caption });
      case "voice":
        return mgr.api.sendVoice(bot, { chatId: c, voice: media.url, caption });
      default:
        return mgr.api.sendSticker(bot, { chatId: c, sticker: media.url });
    }
  });

  return (
    <div className="flex flex-col gap-3">
      <Labeled
        label={t("integrations.telegram.chatId", "Chat ID or @username")}
      >
        <input
          className={field}
          value={chat}
          onChange={(e) => setChat(e.target.value)}
          placeholder="-1001234567890"
        />
      </Labeled>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.telegram.textMessage", "Text message")}
        </h4>
        <textarea
          className={field}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className={`${btn} mt-2`}
          onClick={guard(() =>
            mgr.api.sendMessage(bot, { chatId: cid(), text }),
          )}
          disabled={mgr.isLoading || !chat || !text}
        >
          <Send size={12} />
          {t("integrations.telegram.send", "Send")}
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.telegram.media", "Media (file_id / URL)")}
        </h4>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            className={field}
            value={media.kind}
            onChange={(e) => setMedia((m) => ({ ...m, kind: e.target.value }))}
          >
            {["photo", "document", "video", "audio", "voice", "sticker"].map(
              (k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ),
            )}
          </select>
          <input
            className={field}
            value={media.url}
            onChange={(e) => setMedia((m) => ({ ...m, url: e.target.value }))}
            placeholder="file_id or https://…"
          />
          <input
            className={field}
            value={media.caption}
            onChange={(e) =>
              setMedia((m) => ({ ...m, caption: e.target.value }))
            }
            placeholder={t("integrations.telegram.caption", "Caption")}
          />
        </div>
        <button
          className={`${btn} mt-2`}
          onClick={sendMedia}
          disabled={mgr.isLoading || !chat || !media.url}
        >
          <Send size={12} />
          {t("integrations.telegram.send", "Send")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={btn}
          onClick={guard(() => mgr.api.sendDice(bot, { chatId: cid() }))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.sendDice", "Send dice 🎲")}
        </button>
        <select
          className={field}
          style={{ maxWidth: 180 }}
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          {[
            "typing",
            "upload_photo",
            "upload_document",
            "record_video",
            "find_location",
          ].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          className={btn}
          onClick={guard(() =>
            mgr.api.sendChatAction(bot, cid(), action as never),
          )}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.sendChatAction", "Send chat action")}
        </button>
      </div>

      <JsonAction
        title={t(
          "integrations.telegram.sendLocationTitle",
          "Send location (JSON)",
        )}
        placeholder='{"latitude":51.5,"longitude":-0.12}'
        runLabel={t("integrations.telegram.send", "Send")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.sendLocation(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t(
          "integrations.telegram.sendContactTitle",
          "Send contact (JSON)",
        )}
        placeholder='{"phoneNumber":"+15551234567","firstName":"Ada"}'
        runLabel={t("integrations.telegram.send", "Send")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.sendContact(bot, { chatId: cid(), ...(p as object) } as never)
        }
      />
      <JsonAction
        title={t("integrations.telegram.sendPollTitle", "Send poll (JSON)")}
        placeholder='{"question":"Deploy now?","options":["Yes","No"]}'
        runLabel={t("integrations.telegram.send", "Send")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.sendPoll(bot, { chatId: cid(), ...(p as object) } as never)
        }
      />
    </div>
  );
};

const MessagesTab: React.FC<{ mgr: Mgr; bot: string }> = ({ mgr, bot }) => {
  const { t } = useTranslation();
  const [chat, setChat] = useState("");
  const [msgId, setMsgId] = useState("");
  const cid = () => parseChatId(chat);
  const mid = () => Number(msgId);

  const guard = (fn: () => Promise<unknown>) => async () => {
    if (!bot || !chat) return;
    try {
      await mgr.run(fn);
    } catch {
      /* surfaced */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labeled
          label={t("integrations.telegram.chatId", "Chat ID or @username")}
        >
          <input
            className={field}
            value={chat}
            onChange={(e) => setChat(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.telegram.messageId", "Message ID")}>
          <input
            className={field}
            inputMode="numeric"
            value={msgId}
            onChange={(e) => setMsgId(e.target.value)}
          />
        </Labeled>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={btn}
          onClick={guard(() => mgr.api.deleteMessage(bot, cid(), mid()))}
          disabled={mgr.isLoading || !chat || !msgId}
        >
          <Trash2 size={12} />
          {t("integrations.telegram.deleteMessage", "Delete")}
        </button>
        <button
          className={btn}
          onClick={guard(() => mgr.api.pinMessage(bot, cid(), mid()))}
          disabled={mgr.isLoading || !chat || !msgId}
        >
          {t("integrations.telegram.pin", "Pin")}
        </button>
        <button
          className={btn}
          onClick={guard(() => mgr.api.unpinMessage(bot, cid(), mid()))}
          disabled={mgr.isLoading || !chat || !msgId}
        >
          {t("integrations.telegram.unpin", "Unpin")}
        </button>
        <button
          className={btn}
          onClick={guard(() => mgr.api.unpinAllMessages(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.unpinAll", "Unpin all")}
        </button>
      </div>
      <JsonAction
        title={t("integrations.telegram.editText", "Edit message text (JSON)")}
        placeholder='{"messageId":123,"text":"updated"}'
        runLabel={t("integrations.telegram.edit", "Edit")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.editMessageText(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t(
          "integrations.telegram.editCaption",
          "Edit message caption (JSON)",
        )}
        placeholder='{"messageId":123,"caption":"new caption"}'
        runLabel={t("integrations.telegram.edit", "Edit")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.editMessageCaption(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t(
          "integrations.telegram.editReplyMarkup",
          "Edit reply markup (JSON)",
        )}
        placeholder='{"messageId":123,"replyMarkup":{"inline_keyboard":[]}}'
        runLabel={t("integrations.telegram.edit", "Edit")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.editMessageReplyMarkup(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t("integrations.telegram.forward", "Forward message (JSON)")}
        placeholder='{"fromChatId":"@src","messageId":123}'
        runLabel={t("integrations.telegram.forward", "Forward")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.forwardMessage(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t("integrations.telegram.copy", "Copy message (JSON)")}
        placeholder='{"fromChatId":"@src","messageId":123}'
        runLabel={t("integrations.telegram.copy", "Copy")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.copyMessage(bot, { chatId: cid(), ...(p as object) } as never)
        }
      />
      <JsonAction
        title={t(
          "integrations.telegram.answerCallback",
          "Answer callback query (JSON)",
        )}
        placeholder='{"callbackQueryId":"…","text":"Done"}'
        runLabel={t("integrations.telegram.answer", "Answer")}
        disabled={mgr.isLoading || !bot}
        onRun={(p) => mgr.api.answerCallbackQuery(bot, p as never)}
      />
    </div>
  );
};

const ChatsTab: React.FC<{ mgr: Mgr; bot: string }> = ({ mgr, bot }) => {
  const { t } = useTranslation();
  const [chat, setChat] = useState("");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [detail, setDetail] = useState<unknown>(null);
  const cid = () => parseChatId(chat);

  const show = (fn: () => Promise<unknown>) => async () => {
    if (!bot || !chat) return;
    try {
      setDetail(await mgr.run(fn));
    } catch {
      /* surfaced */
    }
  };
  const act = (fn: () => Promise<unknown>) => async () => {
    if (!bot || !chat) return;
    try {
      await mgr.run(fn);
    } catch {
      /* surfaced */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Labeled
          label={t("integrations.telegram.chatId", "Chat ID or @username")}
        >
          <input
            className={field}
            value={chat}
            onChange={(e) => setChat(e.target.value)}
          />
        </Labeled>
        <Labeled label={t("integrations.telegram.userId", "User ID")}>
          <input
            className={field}
            inputMode="numeric"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </Labeled>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={btn}
          onClick={show(() => mgr.api.getChat(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.getChat", "Get chat")}
        </button>
        <button
          className={btn}
          onClick={show(() => mgr.api.getChatMemberCount(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.memberCount", "Member count")}
        </button>
        <button
          className={btn}
          onClick={show(() => mgr.api.getChatAdministrators(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.admins", "Administrators")}
        </button>
        <button
          className={btn}
          onClick={show(() =>
            mgr.api.getChatMember(bot, cid(), Number(userId)),
          )}
          disabled={mgr.isLoading || !chat || !userId}
        >
          {t("integrations.telegram.getMember", "Get member")}
        </button>
        <button
          className={btn}
          onClick={show(() => mgr.api.exportChatInviteLink(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.exportInvite", "Export invite link")}
        </button>
        <button
          className={btn}
          onClick={show(() => mgr.api.createInviteLink(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.createInvite", "Create invite link")}
        </button>
        <button
          className={btn}
          onClick={act(() => mgr.api.leaveChat(bot, cid()))}
          disabled={mgr.isLoading || !chat}
        >
          {t("integrations.telegram.leaveChat", "Leave chat")}
        </button>
        <button
          className={btn}
          onClick={act(() =>
            mgr.api.unbanChatMember(bot, cid(), Number(userId)),
          )}
          disabled={mgr.isLoading || !chat || !userId}
        >
          {t("integrations.telegram.unban", "Unban member")}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <Labeled label={t("integrations.telegram.title", "Chat title")}>
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Labeled>
          <button
            className={btn}
            onClick={act(() => mgr.api.setChatTitle(bot, cid(), title))}
            disabled={mgr.isLoading || !chat || !title}
          >
            {t("integrations.telegram.setTitle", "Set")}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <Labeled
            label={t("integrations.telegram.description", "Chat description")}
          >
            <input
              className={field}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </Labeled>
          <button
            className={btn}
            onClick={act(() => mgr.api.setChatDescription(bot, cid(), desc))}
            disabled={mgr.isLoading || !chat}
          >
            {t("integrations.telegram.setDescription", "Set")}
          </button>
        </div>
      </div>
      <JsonAction
        title={t("integrations.telegram.ban", "Ban member (JSON)")}
        placeholder='{"userId":42,"revokeMessages":true}'
        runLabel={t("integrations.telegram.ban", "Ban")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.banChatMember(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t("integrations.telegram.restrict", "Restrict member (JSON)")}
        placeholder='{"userId":42,"permissions":{"can_send_messages":false}}'
        runLabel={t("integrations.telegram.restrict", "Restrict")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.restrictChatMember(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonAction
        title={t("integrations.telegram.promote", "Promote member (JSON)")}
        placeholder='{"userId":42,"canManageChat":true}'
        runLabel={t("integrations.telegram.promote", "Promote")}
        disabled={mgr.isLoading || !chat}
        onRun={(p) =>
          mgr.api.promoteChatMember(bot, {
            chatId: cid(),
            ...(p as object),
          } as never)
        }
      />
      <JsonView value={detail} />
    </div>
  );
};

const FilesTab: React.FC<{ mgr: Mgr; bot: string }> = ({ mgr, bot }) => {
  const { t } = useTranslation();
  const [fileId, setFileId] = useState("");
  const [filePath, setFilePath] = useState("");
  const [detail, setDetail] = useState<unknown>(null);

  const getFile = async () => {
    if (!bot || !fileId) return;
    try {
      setDetail(await mgr.run(() => mgr.api.getFile(bot, fileId)));
    } catch {
      /* surfaced */
    }
  };
  const download = async () => {
    if (!bot || !filePath) return;
    try {
      const bytes = await mgr.run(() => mgr.api.downloadFile(bot, filePath));
      setDetail({ downloadedBytes: bytes.length });
    } catch {
      /* surfaced */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Labeled label={t("integrations.telegram.fileId", "File ID")}>
          <input
            className={field}
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
          />
        </Labeled>
        <button
          className={btn}
          onClick={getFile}
          disabled={mgr.isLoading || !fileId}
        >
          {t("integrations.telegram.getFile", "Get file info")}
        </button>
      </div>
      <div className="flex items-end gap-2">
        <Labeled
          label={t(
            "integrations.telegram.filePath",
            "File path (from getFile)",
          )}
        >
          <input
            className={field}
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
          />
        </Labeled>
        <button
          className={btn}
          onClick={download}
          disabled={mgr.isLoading || !filePath}
        >
          {t("integrations.telegram.download", "Download")}
        </button>
      </div>
      <JsonAction
        title={t(
          "integrations.telegram.uploadFile",
          "Upload file (JSON: chatId, fileName, data[])",
        )}
        placeholder='{"chatId":123,"fileName":"a.txt","data":[104,105]}'
        runLabel={t("integrations.telegram.upload", "Upload")}
        disabled={mgr.isLoading || !bot}
        onRun={(p) => {
          const o = p as {
            chatId: ChatId;
            fileName: string;
            data: number[];
            caption?: string;
          };
          return mgr.api.uploadFile(
            bot,
            o.chatId,
            o.fileName,
            o.data,
            o.caption,
          );
        }}
      />
      <JsonView value={detail} />
    </div>
  );
};

const WebhooksTab: React.FC<{ mgr: Mgr; bot: string }> = ({ mgr, bot }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<unknown>(null);

  const info = async () => {
    if (!bot) return;
    try {
      setDetail(await mgr.run(() => mgr.api.getWebhookInfo(bot)));
    } catch {
      /* surfaced */
    }
  };
  const updates = async () => {
    if (!bot) return;
    try {
      setDetail(await mgr.run(() => mgr.api.getUpdates(bot)));
    } catch {
      /* surfaced */
    }
  };
  const del = async () => {
    if (!bot) return;
    try {
      await mgr.run(() => mgr.api.deleteWebhook(bot));
      await info();
    } catch {
      /* surfaced */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={info} disabled={mgr.isLoading || !bot}>
          {t("integrations.telegram.webhookInfo", "Webhook info")}
        </button>
        <button
          className={btn}
          onClick={updates}
          disabled={mgr.isLoading || !bot}
        >
          {t("integrations.telegram.getUpdates", "Get updates")}
        </button>
        <button className={btn} onClick={del} disabled={mgr.isLoading || !bot}>
          {t("integrations.telegram.deleteWebhook", "Delete webhook")}
        </button>
      </div>
      <JsonAction
        title={t("integrations.telegram.setWebhook", "Set webhook (JSON)")}
        placeholder='{"url":"https://host/hook","secretToken":"…"}'
        runLabel={t("integrations.telegram.save", "Save")}
        disabled={mgr.isLoading || !bot}
        onRun={(p) => mgr.api.setWebhook(bot, p as never)}
      />
      <JsonView value={detail} />
    </div>
  );
};

const RulesTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<NotificationRule[]>([]);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listNotificationRules()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.telegram.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {r.name} · {r.botName} · {r.eventTypes.join(", ")}
            </span>
            <div className="flex items-center gap-1">
              <button
                className={btn}
                onClick={async () => {
                  try {
                    await mgr.run(() =>
                      mgr.api.setNotificationRuleEnabled(r.id, !r.enabled),
                    );
                    await refresh();
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                {r.enabled
                  ? t("integrations.telegram.disable", "Disable")
                  : t("integrations.telegram.enable", "Enable")}
              </button>
              <button
                className={btn}
                onClick={async () => {
                  try {
                    await mgr.run(() => mgr.api.removeNotificationRule(r.id));
                    await refresh();
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.telegram.noRules", "No notification rules")}
          </span>
        )}
      </div>
      <JsonAction
        title={t(
          "integrations.telegram.addRule",
          "Add notification rule (JSON)",
        )}
        placeholder='{"id":"r1","name":"Disconnects","enabled":true,"botName":"alerts-bot","chatId":123,"eventTypes":["disconnected"],"createdAt":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.add", "Add")}
        disabled={mgr.isLoading}
        onRun={async (p) => {
          await mgr.api.addNotificationRule(p as never);
          await refresh();
        }}
      />
      <JsonAction
        title={t(
          "integrations.telegram.processEvent",
          "Process connection event (JSON) — test rules",
        )}
        placeholder='{"eventType":"disconnected","severity":"warning","host":"srv1","protocol":"ssh","message":"lost","timestamp":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.run", "Run")}
        disabled={mgr.isLoading}
        onRun={(p) => mgr.api.processConnectionEvent(p as never)}
      />
    </div>
  );
};

const MonitoringTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MonitoringCheck[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listMonitoringChecks()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.telegram.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            try {
              setDetail(await mgr.run(() => mgr.api.monitoringSummary()));
            } catch {
              /* surfaced */
            }
          }}
          disabled={mgr.isLoading}
        >
          {t("integrations.telegram.summary", "Summary")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            try {
              setDetail(await mgr.run(() => mgr.api.monitoringHistory()));
            } catch {
              /* surfaced */
            }
          }}
          disabled={mgr.isLoading}
        >
          {t("integrations.telegram.history", "History")}
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((c) => (
          <div key={c.id} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {c.name} · {c.checkType} · {c.status ?? "unknown"}
            </span>
            <div className="flex items-center gap-1">
              <button
                className={btn}
                onClick={async () => {
                  try {
                    await mgr.run(() =>
                      mgr.api.setMonitoringCheckEnabled(c.id, !c.enabled),
                    );
                    await refresh();
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                {c.enabled
                  ? t("integrations.telegram.disable", "Disable")
                  : t("integrations.telegram.enable", "Enable")}
              </button>
              <button
                className={btn}
                onClick={async () => {
                  try {
                    await mgr.run(() => mgr.api.removeMonitoringCheck(c.id));
                    await refresh();
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.telegram.noChecks", "No monitoring checks")}
          </span>
        )}
      </div>
      <JsonAction
        title={t(
          "integrations.telegram.addCheck",
          "Add monitoring check (JSON)",
        )}
        placeholder='{"id":"c1","name":"Ping srv1","enabled":true,"botName":"alerts-bot","chatId":123,"checkType":"ping","intervalSeconds":60,"createdAt":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.add", "Add")}
        disabled={mgr.isLoading}
        onRun={async (p) => {
          await mgr.api.addMonitoringCheck(p as never);
          await refresh();
        }}
      />
      <JsonAction
        title={t(
          "integrations.telegram.recordResult",
          "Record check result (JSON)",
        )}
        placeholder='{"checkId":"c1","checkName":"Ping srv1","status":"down","latencyMs":null,"success":false,"timestamp":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.run", "Run")}
        disabled={mgr.isLoading}
        onRun={(p) => mgr.api.recordMonitoringResult(p as never)}
      />
      <JsonView value={detail} />
    </div>
  );
};

const TemplatesTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MessageTemplate[]>([]);
  const [body, setBody] = useState("");
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listTemplates()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const validate = async () => {
    try {
      setDetail(await mgr.run(() => mgr.api.validateTemplateBody(body)));
    } catch {
      /* surfaced */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.telegram.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((tpl) => (
          <div
            key={tpl.id}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-[var(--color-textSecondary)]">
              {tpl.name}
            </span>
            <div className="flex items-center gap-1">
              <button
                className={btn}
                onClick={async () => {
                  try {
                    setDetail(
                      await mgr.run(() =>
                        mgr.api.renderTemplate(
                          tpl.id,
                          tpl.defaultVariables ?? {},
                        ),
                      ),
                    );
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                {t("integrations.telegram.render", "Render")}
              </button>
              <button
                className={btn}
                onClick={async () => {
                  try {
                    await mgr.run(() => mgr.api.removeTemplate(tpl.id));
                    await refresh();
                  } catch {
                    /* surfaced */
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.telegram.noTemplates", "No templates")}
          </span>
        )}
      </div>
      <div className={card}>
        <h4 className="mb-2 text-xs font-semibold text-[var(--color-text)]">
          {t("integrations.telegram.validateBody", "Validate template body")}
        </h4>
        <textarea
          className={`${field} font-mono`}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hello {{name}}"
        />
        <button
          className={`${btn} mt-2`}
          onClick={validate}
          disabled={mgr.isLoading || !body}
        >
          {t("integrations.telegram.validate", "Validate")}
        </button>
      </div>
      <JsonAction
        title={t("integrations.telegram.addTemplate", "Add template (JSON)")}
        placeholder='{"id":"t1","name":"Greeting","body":"Hi {{name}}","createdAt":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.add", "Add")}
        disabled={mgr.isLoading}
        onRun={async (p) => {
          await mgr.api.addTemplate(p as never);
          await refresh();
        }}
      />
      <JsonAction
        title={t("integrations.telegram.sendTemplate", "Send template (JSON)")}
        placeholder='{"botName":"alerts-bot","chatId":123,"templateId":"t1","variables":{"name":"Ada"}}'
        runLabel={t("integrations.telegram.send", "Send")}
        disabled={mgr.isLoading}
        onRun={(p) => mgr.api.sendTemplate(p as never)}
      />
      <JsonView value={detail} />
    </div>
  );
};

const ScheduledTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ScheduledMessage[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listScheduledMessages()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.telegram.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            try {
              setDetail(
                await mgr.run(() => mgr.api.processScheduledMessages()),
              );
              await refresh();
            } catch {
              /* surfaced */
            }
          }}
          disabled={mgr.isLoading}
        >
          {t("integrations.telegram.processDue", "Process due")}
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((m) => (
          <div key={m.id} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {m.scheduledAt} · {m.botName} · {m.text.slice(0, 40)}
            </span>
            <button
              className={btn}
              onClick={async () => {
                try {
                  await mgr.run(() => mgr.api.cancelScheduledMessage(m.id));
                  await refresh();
                } catch {
                  /* surfaced */
                }
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.telegram.noScheduled", "No scheduled messages")}
          </span>
        )}
      </div>
      <JsonAction
        title={t(
          "integrations.telegram.scheduleMessage",
          "Schedule message (JSON)",
        )}
        placeholder='{"id":"s1","botName":"alerts-bot","chatId":123,"text":"reminder","scheduledAt":"2026-12-01T09:00:00Z","createdAt":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.schedule", "Schedule")}
        disabled={mgr.isLoading}
        onRun={async (p) => {
          await mgr.api.scheduleMessage(p as never);
          await refresh();
        }}
      />
      <JsonView value={detail} />
    </div>
  );
};

const BroadcastTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <JsonAction
      title={t(
        "integrations.telegram.broadcast",
        "Broadcast to many chats (JSON)",
      )}
      placeholder='{"botName":"alerts-bot","chatIds":[123,456],"text":"maintenance tonight"}'
      runLabel={t("integrations.telegram.broadcast", "Broadcast")}
      disabled={mgr.isLoading}
      onRun={(p) => mgr.api.broadcast(p as never)}
    />
  );
};

const DigestsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DigestConfig[]>([]);

  const refresh = useCallback(async () => {
    try {
      setRows(await mgr.run(() => mgr.api.listDigests()));
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
        <RefreshCw size={12} />
        {t("integrations.telegram.refresh", "Refresh")}
      </button>
      <div className="flex flex-col gap-1">
        {rows.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-textSecondary)]">
              {d.name} · {d.schedule} · {d.botName}
            </span>
            <button
              className={btn}
              onClick={async () => {
                try {
                  await mgr.run(() => mgr.api.removeDigest(d.id));
                  await refresh();
                } catch {
                  /* surfaced */
                }
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.telegram.noDigests", "No digests")}
          </span>
        )}
      </div>
      <JsonAction
        title={t("integrations.telegram.addDigest", "Add digest (JSON)")}
        placeholder='{"id":"d1","name":"Daily","enabled":true,"botName":"alerts-bot","chatId":123,"schedule":"daily","include":{},"createdAt":"2026-01-01T00:00:00Z"}'
        runLabel={t("integrations.telegram.add", "Add")}
        disabled={mgr.isLoading}
        onRun={async (p) => {
          await mgr.api.addDigest(p as never);
          await refresh();
        }}
      />
    </div>
  );
};

const LogsTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<TelegramStats | null>(null);
  const [log, setLog] = useState<MessageLogEntry[]>([]);
  const [detail, setDetail] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await mgr.run(() =>
        Promise.all([mgr.api.stats(), mgr.api.messageLog(100)]),
      );
      setStats(s);
      setLog(l);
    } catch {
      /* surfaced */
    }
  }, [mgr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={refresh} disabled={mgr.isLoading}>
          <RefreshCw size={12} />
          {t("integrations.telegram.refresh", "Refresh")}
        </button>
        <button
          className={btn}
          onClick={async () => {
            try {
              setDetail(await mgr.run(() => mgr.api.notificationHistory()));
            } catch {
              /* surfaced */
            }
          }}
          disabled={mgr.isLoading}
        >
          {t(
            "integrations.telegram.notificationHistory",
            "Notification history",
          )}
        </button>
        <button
          className={btn}
          onClick={async () => {
            try {
              await mgr.run(() => mgr.api.clearMessageLog());
              await refresh();
            } catch {
              /* surfaced */
            }
          }}
          disabled={mgr.isLoading}
        >
          {t("integrations.telegram.clearLog", "Clear log")}
        </button>
      </div>
      {stats && (
        <div className={card}>
          <div className="grid grid-cols-2 gap-1 text-xs text-[var(--color-textSecondary)] sm:grid-cols-4">
            <span>
              {t("integrations.telegram.bots", "Bots")}: {stats.configuredBots}
            </span>
            <span>
              {t("integrations.telegram.active", "Active")}: {stats.activeBots}
            </span>
            <span>
              {t("integrations.telegram.rules", "Rules")}:{" "}
              {stats.notificationRules}
            </span>
            <span>
              {t("integrations.telegram.checks", "Checks")}:{" "}
              {stats.monitoringChecks}
            </span>
            <span>
              {t("integrations.telegram.sent", "Sent")}:{" "}
              {stats.totalMessagesSent}
            </span>
            <span>
              {t("integrations.telegram.failed", "Failed")}:{" "}
              {stats.totalMessagesFailed}
            </span>
            <span>
              {t("integrations.telegram.notifications", "Notifs")}:{" "}
              {stats.totalNotificationsSent}
            </span>
            <span>
              {t("integrations.telegram.alerts", "Alerts")}:{" "}
              {stats.totalAlertsSent}
            </span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {log.map((e) => (
          <div key={e.id} className="text-[10px] text-[var(--color-textMuted)]">
            {e.timestamp} · {e.botName} → {e.chatId} · {e.success ? "✓" : "✗"}{" "}
            {e.textPreview}
          </div>
        ))}
      </div>
      <JsonView value={detail} />
    </div>
  );
};

// ─── Section root ────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; fallback: string }[] = [
  { key: "send", label: "integrations.telegram.tabSend", fallback: "Send" },
  {
    key: "messages",
    label: "integrations.telegram.tabMessages",
    fallback: "Messages",
  },
  { key: "chats", label: "integrations.telegram.tabChats", fallback: "Chats" },
  { key: "files", label: "integrations.telegram.tabFiles", fallback: "Files" },
  {
    key: "webhooks",
    label: "integrations.telegram.tabWebhooks",
    fallback: "Webhooks",
  },
  { key: "rules", label: "integrations.telegram.tabRules", fallback: "Rules" },
  {
    key: "monitoring",
    label: "integrations.telegram.tabMonitoring",
    fallback: "Monitoring",
  },
  {
    key: "templates",
    label: "integrations.telegram.tabTemplates",
    fallback: "Templates",
  },
  {
    key: "scheduled",
    label: "integrations.telegram.tabScheduled",
    fallback: "Scheduled",
  },
  {
    key: "broadcast",
    label: "integrations.telegram.tabBroadcast",
    fallback: "Broadcast",
  },
  {
    key: "digests",
    label: "integrations.telegram.tabDigests",
    fallback: "Digests",
  },
  { key: "logs", label: "integrations.telegram.tabLogs", fallback: "Logs" },
];

const TelegramSettingsSection: React.FC<SectionProps> = () => {
  const { t } = useTranslation();
  const mgr = useTelegram();
  const [selectedBot, setSelectedBot] = useState("");
  const [tab, setTab] = useState<TabKey>("send");

  const botNames = useMemo(() => mgr.bots.map((b) => b.name), [mgr.bots]);
  const activeBot = selectedBot || botNames[0] || "";

  return (
    <SettingsCollapsibleSection
      title={t("integrations.telegram.title", "Telegram bots")}
      icon={<Send className="w-4 h-4 text-primary" />}
      defaultOpen={false}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.telegram.intro",
            "Configure Telegram bots for connection-event notifications, monitoring alerts, digests, and manual messaging. Bot tokens are stored encrypted in the OS credential vault, never in the settings file.",
          )}
        </p>

        {mgr.error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400">
            {mgr.error}
            <button className="ml-2 underline" onClick={mgr.clearError}>
              {t("integrations.telegram.dismiss", "Dismiss")}
            </button>
          </div>
        )}

        <BotManager mgr={mgr} />

        <div className="border-t border-[var(--color-border)] pt-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-textSecondary)]">
              {t("integrations.telegram.activeBot", "Manage bot")}:
            </span>
            <select
              className={field}
              style={{ maxWidth: 220 }}
              value={activeBot}
              onChange={(e) => setSelectedBot(e.target.value)}
            >
              {botNames.length === 0 && (
                <option value="">
                  {t("integrations.telegram.noBots", "No bots")}
                </option>
              )}
              {botNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-3 flex flex-wrap gap-1">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`rounded px-2 py-1 text-xs ${
                  tab === tb.key
                    ? "bg-primary text-[var(--color-text)]"
                    : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]"
                }`}
              >
                {t(tb.label, tb.fallback)}
              </button>
            ))}
          </div>

          {tab === "send" && <SendTab mgr={mgr} bot={activeBot} />}
          {tab === "messages" && <MessagesTab mgr={mgr} bot={activeBot} />}
          {tab === "chats" && <ChatsTab mgr={mgr} bot={activeBot} />}
          {tab === "files" && <FilesTab mgr={mgr} bot={activeBot} />}
          {tab === "webhooks" && <WebhooksTab mgr={mgr} bot={activeBot} />}
          {tab === "rules" && <RulesTab mgr={mgr} />}
          {tab === "monitoring" && <MonitoringTab mgr={mgr} />}
          {tab === "templates" && <TemplatesTab mgr={mgr} />}
          {tab === "scheduled" && <ScheduledTab mgr={mgr} />}
          {tab === "broadcast" && <BroadcastTab mgr={mgr} />}
          {tab === "digests" && <DigestsTab mgr={mgr} />}
          {tab === "logs" && <LogsTab mgr={mgr} />}
        </div>
      </div>
    </SettingsCollapsibleSection>
  );
};

export default TelegramSettingsSection;
