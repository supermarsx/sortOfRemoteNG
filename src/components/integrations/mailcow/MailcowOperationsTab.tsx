// mailcow — "Queue, Quarantine & Server" sub-tab (t42-mailcow-c2).
//
// Binds all 28 operations commands across six grouped, collapsible sections:
//   Transport maps (5) · Queue (5) · Quarantine (7) · Logs (2) · Status (6) ·
//   Rate limits (3)
// Mounted only when the panel shell is connected, so `connectionId` is always a
// live mailcow connection id — it is passed as the `id` arg to every command.
// The tab owns its own queue/quarantine/transport selection (via its own list
// commands); the shell provides no per-object selection.

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Route,
  Inbox,
  ShieldAlert,
  ScrollText,
  Server,
  Gauge,
  RefreshCw,
  Trash2,
  X,
  Send,
  ShieldCheck,
} from "lucide-react";

import {
  useMailcowOperations,
  type MailcowOperationsManager,
} from "../../../hooks/integration/mailcow/useMailcowOperations";
import type { MailcowTabProps } from "./registry";
import {
  MAILCOW_LOG_TYPES,
  type CreateTransportMapRequest,
  type MailcowContainerStatus,
  type MailcowFail2BanConfig,
  type MailcowLogEntry,
  type MailcowLogType,
  type MailcowQuarantineItem,
  type MailcowQueueItem,
  type MailcowQueueSummary,
  type MailcowRateLimit,
  type MailcowSystemStatus,
  type MailcowTransportMap,
  type SetRateLimitRequest,
} from "../../../types/mailcow/operations";

// ─── Shared styling (mirrors the panel shell + sibling tabs) ────────────────────

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50";
const dangerBtn = `${btnClass} border-red-500/40 text-red-500`;

/** Build the i18n key for an `operations.*` fragment leaf. Pair with an English
 *  default at the call site so a missing key degrades gracefully pre-merge. */
const t9 = (key: string) => `integrations.mailcow.operations.${key}`;

// Common postfix queue names (the API filters by name; free text is allowed).
const QUEUE_NAMES = ["deferred", "active", "hold", "incoming"];

const CREATE_TRANSPORT_TEMPLATE: CreateTransportMapRequest = {
  destination: "",
  next_hop: "",
  username: "",
  password: "",
  active: true,
};

const SET_RATE_LIMIT_TEMPLATE: SetRateLimitRequest = {
  object: "",
  value: "",
  frame: "h",
};

const MailcowOperationsTab: React.FC<MailcowTabProps> = ({ connectionId }) => {
  const mgr = useMailcowOperations();
  const { error, clearError } = mgr;

  return (
    <div className="flex flex-col gap-3 p-3">
      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          <span className="break-all">{error}</span>
          <button onClick={clearError}>
            <X size={12} />
          </button>
        </div>
      )}

      <TransportSection mgr={mgr} id={connectionId} />
      <QueueSection mgr={mgr} id={connectionId} />
      <QuarantineSection mgr={mgr} id={connectionId} />
      <LogsSection mgr={mgr} id={connectionId} />
      <StatusSection mgr={mgr} id={connectionId} />
      <RateLimitsSection mgr={mgr} id={connectionId} />
    </div>
  );
};

// ─── Collapsible titled group ───────────────────────────────────────────────---

const Group: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen, children }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded border border-[var(--color-border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-[var(--color-text)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-2">
          {children}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Transport maps (5)
// ═══════════════════════════════════════════════════════════════════════════════

const TransportSection: React.FC<{
  mgr: MailcowOperationsManager;
  id: string;
}> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [maps, setMaps] = useState<MailcowTransportMap[] | null>(null);
  const [detail, setDetail] = useState<MailcowTransportMap | null>(null);
  const [transportId, setTransportId] = useState("");
  const [createJson, setCreateJson] = useState(() =>
    JSON.stringify(CREATE_TRANSPORT_TEMPLATE, null, 2),
  );
  const [updateJson, setUpdateJson] = useState(() =>
    JSON.stringify(CREATE_TRANSPORT_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const reload = () =>
    run((a) => a.listTransportMaps(id)).then((m) => m && setMaps(m));

  return (
    <Group
      title={t(t9("transport.title"), "Transport Maps")}
      icon={<Route size={12} />}
      defaultOpen
    >
      <div className="flex flex-wrap items-end gap-1">
        <button className={btnClass} onClick={() => void reload()}>
          <RefreshCw size={12} />
          {t(t9("transport.list"), "List transport maps")}
        </button>
        <input
          className={`${inputClass} max-w-[140px]`}
          type="number"
          value={transportId}
          onChange={(e) => setTransportId(e.target.value)}
          placeholder={t(t9("transport.id"), "transport id")}
        />
        <button
          className={btnClass}
          disabled={!transportId}
          onClick={() =>
            run((a) => a.getTransportMap(id, Number(transportId))).then(
              (d) => d && setDetail(d),
            )
          }
        >
          {t(t9("transport.load"), "Load")}
        </button>
        <button
          className={dangerBtn}
          disabled={!transportId}
          onClick={() =>
            run((a) => a.deleteTransportMap(id, Number(transportId))).then(
              reload,
            )
          }
        >
          <Trash2 size={12} />
          {t(t9("transport.delete"), "Delete")}
        </button>
      </div>

      {maps && (
        <RowList
          items={maps.map((m) => ({
            key: `${m.id}`,
            primary: `${m.id} · ${m.destination}`,
            secondary: `→ ${m.next_hop} ${m.active ? "✓" : "✗"}`,
            onClick: () => {
              setTransportId(`${m.id}`);
              setDetail(m);
            },
          }))}
        />
      )}
      {detail && <Json value={detail} />}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("transport.createReq"), "Create transport (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={7}
            value={createJson}
            onChange={(e) => setCreateJson(e.target.value)}
          />
          <button
            className={`${primaryBtn} mt-1`}
            onClick={() => {
              let req: CreateTransportMapRequest;
              try {
                req = JSON.parse(createJson) as CreateTransportMapRequest;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.createTransportMap(id, req)).then(reload);
            }}
          >
            {t(t9("transport.create"), "Create")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("transport.updateReq"), "Update transport (JSON, by id above)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={7}
            value={updateJson}
            onChange={(e) => setUpdateJson(e.target.value)}
          />
          <button
            className={`${btnClass} mt-1`}
            disabled={!transportId}
            onClick={() => {
              let req: CreateTransportMapRequest;
              try {
                req = JSON.parse(updateJson) as CreateTransportMapRequest;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) =>
                a.updateTransportMap(id, Number(transportId), req),
              ).then(reload);
            }}
          >
            {t(t9("transport.update"), "Apply update")}
          </button>
        </div>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Queue (5)
// ═══════════════════════════════════════════════════════════════════════════════

const QueueSection: React.FC<{
  mgr: MailcowOperationsManager;
  id: string;
}> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [summary, setSummary] = useState<MailcowQueueSummary | null>(null);
  const [items, setItems] = useState<MailcowQueueItem[] | null>(null);
  const [queueName, setQueueName] = useState("deferred");
  const [queueId, setQueueId] = useState("");

  const listQueue = () =>
    run((a) => a.listQueue(id, queueName.trim())).then((q) => q && setItems(q));

  return (
    <Group title={t(t9("queue.title"), "Mail Queue")} icon={<Inbox size={12} />}>
      <div className="flex flex-wrap items-end gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getQueueSummary(id)).then((s) => s && setSummary(s))
          }
        >
          <RefreshCw size={12} />
          {t(t9("queue.summary"), "Queue summary")}
        </button>
      </div>
      {summary && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("queue.active"), "Active")} value={summary.active} />
          <Stat
            label={t(t9("queue.deferred"), "Deferred")}
            value={summary.deferred}
          />
          <Stat label={t(t9("queue.hold"), "Hold")} value={summary.hold} />
          <Stat
            label={t(t9("queue.incoming"), "Incoming")}
            value={summary.incoming}
          />
        </div>
      )}

      <div>
        <label className={labelClass}>
          {t(t9("queue.name"), "Queue (name)")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[180px]`}
            value={queueName}
            onChange={(e) => setQueueName(e.target.value)}
            list="mailcow-queue-names"
          />
          <datalist id="mailcow-queue-names">
            {QUEUE_NAMES.map((q) => (
              <option key={q} value={q} />
            ))}
          </datalist>
          <button
            className={btnClass}
            disabled={!queueName.trim()}
            onClick={() => void listQueue()}
          >
            {t(t9("queue.list"), "List queue")}
          </button>
          <button
            className={btnClass}
            disabled={!queueName.trim()}
            onClick={() =>
              run((a) => a.flushQueue(id, queueName.trim())).then(listQueue)
            }
          >
            <Send size={12} />
            {t(t9("queue.flush"), "Flush")}
          </button>
          <button
            className={dangerBtn}
            disabled={!queueName.trim()}
            onClick={() =>
              run((a) => a.superDeleteQueue(id, queueName.trim())).then(
                listQueue,
              )
            }
          >
            <Trash2 size={12} />
            {t(t9("queue.superDelete"), "Super delete")}
          </button>
        </div>
      </div>

      {items && (
        <RowList
          items={items.map((q, i) => ({
            key: q.queue_id || `${i}`,
            primary: `${q.queue_id} · ${q.sender}`,
            secondary: `→ ${q.recipients} · ${q.reason}`,
            onClick: () => setQueueId(q.queue_id),
          }))}
        />
      )}

      <div>
        <label className={labelClass}>
          {t(t9("queue.itemId"), "Delete single queue item (id)")}
        </label>
        <div className="flex gap-1">
          <input
            className={inputClass}
            value={queueId}
            onChange={(e) => setQueueId(e.target.value)}
            placeholder={t(t9("queue.itemIdPlaceholder"), "queue id")}
          />
          <button
            className={dangerBtn}
            disabled={!queueId.trim()}
            onClick={() =>
              run((a) => a.deleteQueueItem(id, queueId.trim()))
                .then(() => setQueueId(""))
                .then(listQueue)
            }
          >
            <Trash2 size={12} />
            {t(t9("queue.deleteItem"), "Delete item")}
          </button>
        </div>
      </div>
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Quarantine (7)
// ═══════════════════════════════════════════════════════════════════════════════

const QuarantineSection: React.FC<{
  mgr: MailcowOperationsManager;
  id: string;
}> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [items, setItems] = useState<MailcowQuarantineItem[] | null>(null);
  const [detail, setDetail] = useState<MailcowQuarantineItem | null>(null);
  const [quarantineId, setQuarantineId] = useState("");
  const [settings, setSettings] = useState<unknown>(null);
  const [settingsJson, setSettingsJson] = useState("{}");
  const [parseError, setParseError] = useState<string | null>(null);

  const reload = () =>
    run((a) => a.listQuarantine(id)).then((q) => q && setItems(q));

  const qid = () => Number(quarantineId);

  return (
    <Group
      title={t(t9("quarantine.title"), "Quarantine")}
      icon={<ShieldAlert size={12} />}
    >
      <div className="flex flex-wrap items-end gap-1">
        <button className={btnClass} onClick={() => void reload()}>
          <RefreshCw size={12} />
          {t(t9("quarantine.list"), "List quarantine")}
        </button>
        <input
          className={`${inputClass} max-w-[140px]`}
          type="number"
          value={quarantineId}
          onChange={(e) => setQuarantineId(e.target.value)}
          placeholder={t(t9("quarantine.id"), "item id")}
        />
        <button
          className={btnClass}
          disabled={!quarantineId}
          onClick={() =>
            run((a) => a.getQuarantine(id, qid())).then((d) => d && setDetail(d))
          }
        >
          {t(t9("quarantine.load"), "Load")}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!quarantineId}
          onClick={() =>
            run((a) => a.releaseQuarantine(id, qid())).then(reload)
          }
        >
          <Send size={12} />
          {t(t9("quarantine.release"), "Release")}
        </button>
        <button
          className={btnClass}
          disabled={!quarantineId}
          onClick={() => run((a) => a.whitelistSender(id, qid())).then(reload)}
        >
          <ShieldCheck size={12} />
          {t(t9("quarantine.whitelist"), "Whitelist sender")}
        </button>
        <button
          className={dangerBtn}
          disabled={!quarantineId}
          onClick={() =>
            run((a) => a.deleteQuarantine(id, qid())).then(reload)
          }
        >
          <Trash2 size={12} />
          {t(t9("quarantine.delete"), "Delete")}
        </button>
      </div>

      {items && (
        <RowList
          items={items.map((q) => ({
            key: `${q.id}`,
            primary: `${q.id} · ${q.sender}`,
            secondary: `→ ${q.rcpt} · ${q.subject} (${q.score})`,
            onClick: () => {
              setQuarantineId(`${q.id}`);
              setDetail(q);
            },
          }))}
        />
      )}
      {detail && <Json value={detail} />}

      <div>
        <label className={labelClass}>
          {t(t9("quarantine.settings"), "Quarantine settings (JSON)")}
        </label>
        <div className="mb-1 flex gap-1">
          <button
            className={btnClass}
            onClick={() =>
              run((a) => a.getQuarantineSettings(id)).then((s) => {
                setSettings(s ?? null);
                if (s !== undefined) setSettingsJson(JSON.stringify(s, null, 2));
              })
            }
          >
            {t(t9("quarantine.loadSettings"), "Load settings")}
          </button>
          <button
            className={primaryBtn}
            onClick={() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(settingsJson);
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.updateQuarantineSettings(id, parsed));
            }}
          >
            {t(t9("quarantine.saveSettings"), "Save settings")}
          </button>
        </div>
        <textarea
          className={`${inputClass} font-mono`}
          rows={5}
          value={settingsJson}
          onChange={(e) => setSettingsJson(e.target.value)}
        />
        {settings != null && <Json value={settings} />}
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Logs (2)
// ═══════════════════════════════════════════════════════════════════════════════

const LogsSection: React.FC<{
  mgr: MailcowOperationsManager;
  id: string;
}> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [logType, setLogType] = useState<MailcowLogType>("postfix");
  const [count, setCount] = useState("100");
  const [entries, setEntries] = useState<MailcowLogEntry[] | null>(null);

  return (
    <Group
      title={t(t9("logs.title"), "Logs")}
      icon={<ScrollText size={12} />}
    >
      <div className="flex flex-wrap items-end gap-1">
        <select
          className={`${inputClass} max-w-[160px]`}
          value={logType}
          onChange={(e) => setLogType(e.target.value as MailcowLogType)}
        >
          {MAILCOW_LOG_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {lt}
            </option>
          ))}
        </select>
        <input
          className={`${inputClass} max-w-[100px]`}
          type="number"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getLogs(id, logType, Number(count) || 100)).then(
              (e) => e && setEntries(e),
            )
          }
        >
          {t(t9("logs.get"), "Get logs")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getApiLogs(id, Number(count) || 100)).then(
              (e) => e && setEntries(e),
            )
          }
        >
          {t(t9("logs.getApi"), "API logs")}
        </button>
      </div>

      {entries && (
        <pre className="max-h-60 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
          {entries.length === 0
            ? "—"
            : entries
                .map(
                  (e) =>
                    `${e.time} [${e.priority}] ${e.program}: ${e.message}`,
                )
                .join("\n")}
        </pre>
      )}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Status (6)
// ═══════════════════════════════════════════════════════════════════════════════

const StatusSection: React.FC<{
  mgr: MailcowOperationsManager;
  id: string;
}> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [containers, setContainers] = useState<
    MailcowContainerStatus[] | null
  >(null);
  const [system, setSystem] = useState<MailcowSystemStatus | null>(null);
  const [solr, setSolr] = useState<unknown>(null);
  const [rspamd, setRspamd] = useState<unknown>(null);
  const [fail2ban, setFail2ban] = useState<MailcowFail2BanConfig | null>(null);
  const [fail2banJson, setFail2banJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Group
      title={t(t9("status.title"), "Server Status")}
      icon={<Server size={12} />}
    >
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getContainerStatus(id)).then(
              (c) => c && setContainers(c),
            )
          }
        >
          {t(t9("status.containers"), "Containers")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getSystemStatus(id)).then((s) => s && setSystem(s))
          }
        >
          {t(t9("status.system"), "System status")}
        </button>
        <button
          className={btnClass}
          onClick={() => run((a) => a.getSolrStatus(id)).then((s) => setSolr(s ?? null))}
        >
          {t(t9("status.solr"), "Solr status")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getRspamdStats(id)).then((s) => setRspamd(s ?? null))
          }
        >
          {t(t9("status.rspamd"), "Rspamd stats")}
        </button>
      </div>

      {containers && (
        <RowList
          items={containers.map((c) => ({
            key: c.container,
            primary: c.container,
            secondary: `${c.state} · ${c.health || "—"} · ${c.image}`,
          }))}
        />
      )}
      {system && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          <Stat
            label={t(t9("status.containerCount"), "Containers")}
            value={system.containers.length}
          />
          <Stat
            label={t(t9("status.disk"), "Disk")}
            value={system.disk_usage ?? "—"}
          />
          <Stat
            label={t(t9("status.solrState"), "Solr")}
            value={system.solr_status ?? "—"}
          />
        </div>
      )}
      {solr != null && <Json value={solr} />}
      {rspamd != null && <Json value={rspamd} />}

      <div>
        <label className={labelClass}>
          {t(t9("status.fail2ban"), "Fail2ban config (JSON)")}
        </label>
        <div className="mb-1 flex gap-1">
          <button
            className={btnClass}
            onClick={() =>
              run((a) => a.getFail2banConfig(id)).then((c) => {
                if (c) {
                  setFail2ban(c);
                  setFail2banJson(JSON.stringify(c, null, 2));
                }
              })
            }
          >
            {t(t9("status.loadFail2ban"), "Load fail2ban")}
          </button>
          <button
            className={primaryBtn}
            disabled={!fail2banJson.trim()}
            onClick={() => {
              let cfg: MailcowFail2BanConfig;
              try {
                cfg = JSON.parse(fail2banJson) as MailcowFail2BanConfig;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.updateFail2banConfig(id, cfg));
            }}
          >
            {t(t9("status.saveFail2ban"), "Save fail2ban")}
          </button>
        </div>
        <textarea
          className={`${inputClass} font-mono`}
          rows={6}
          value={fail2banJson}
          onChange={(e) => setFail2banJson(e.target.value)}
          placeholder={t(
            t9("status.fail2banHint"),
            "Load to populate, then edit ban_time / max_attempts / whitelist / blacklist",
          )}
        />
        {fail2ban && (
          <div className="mt-1 grid grid-cols-3 gap-1">
            <Stat
              label={t(t9("status.banTime"), "Ban time")}
              value={fail2ban.ban_time}
            />
            <Stat
              label={t(t9("status.maxAttempts"), "Max attempts")}
              value={fail2ban.max_attempts}
            />
            <Stat
              label={t(t9("status.retryWindow"), "Retry window")}
              value={fail2ban.retry_window}
            />
          </div>
        )}
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Rate limits (3)
// ═══════════════════════════════════════════════════════════════════════════════

const RateLimitsSection: React.FC<{
  mgr: MailcowOperationsManager;
  id: string;
}> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [mailbox, setMailbox] = useState("");
  const [limit, setLimit] = useState<MailcowRateLimit | null>(null);
  const [setJson, setSetJson] = useState(() =>
    JSON.stringify(SET_RATE_LIMIT_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Group
      title={t(t9("rateLimits.title"), "Rate Limits")}
      icon={<Gauge size={12} />}
    >
      <div>
        <label className={labelClass}>
          {t(t9("rateLimits.mailbox"), "Mailbox / domain")}
        </label>
        <div className="flex gap-1">
          <input
            className={inputClass}
            value={mailbox}
            onChange={(e) => setMailbox(e.target.value)}
            placeholder="user@example.com"
          />
          <button
            className={btnClass}
            disabled={!mailbox.trim()}
            onClick={() =>
              run((a) => a.getRateLimits(id, mailbox.trim())).then(
                (l) => l && setLimit(l),
              )
            }
          >
            {t(t9("rateLimits.get"), "Get")}
          </button>
          <button
            className={dangerBtn}
            disabled={!mailbox.trim()}
            onClick={() =>
              run((a) => a.deleteRateLimit(id, mailbox.trim())).then(() =>
                setLimit(null),
              )
            }
          >
            <Trash2 size={12} />
            {t(t9("rateLimits.delete"), "Delete")}
          </button>
        </div>
      </div>
      {limit && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          <Stat
            label={t(t9("rateLimits.object"), "Object")}
            value={limit.object}
          />
          <Stat label={t(t9("rateLimits.value"), "Value")} value={limit.value} />
          <Stat label={t(t9("rateLimits.frame"), "Frame")} value={limit.frame} />
        </div>
      )}

      <div>
        <label className={labelClass}>
          {t(t9("rateLimits.setReq"), "Set rate limit (JSON)")}
        </label>
        <textarea
          className={`${inputClass} font-mono`}
          rows={5}
          value={setJson}
          onChange={(e) => setSetJson(e.target.value)}
        />
        <button
          className={`${primaryBtn} mt-1`}
          onClick={() => {
            let req: SetRateLimitRequest;
            try {
              req = JSON.parse(setJson) as SetRateLimitRequest;
            } catch (e) {
              setParseError((e as Error).message);
              return;
            }
            setParseError(null);
            void run((a) => a.setRateLimit(id, req));
          }}
        >
          {t(t9("rateLimits.set"), "Set rate limit")}
        </button>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ─── Small presentational helpers ──────────────────────────────────────────────

const Stat: React.FC<{ label: string; value?: number | string | null }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] px-1.5 py-1">
    <div className="text-[10px] text-[var(--color-textSecondary)]">{label}</div>
    <div className="truncate text-[11px] font-medium text-[var(--color-text)]">
      {value ?? "—"}
    </div>
  </div>
);

interface Row {
  key: string;
  primary: string;
  secondary?: string;
  onClick?: () => void;
}

const RowList: React.FC<{ items: Row[] }> = ({ items }) => (
  <ul className="flex flex-col gap-0.5">
    {items.length === 0 && (
      <li className="px-1 py-1 text-[11px] text-[var(--color-textSecondary)]">
        —
      </li>
    )}
    {items.map((r) => (
      <li key={r.key}>
        <button
          onClick={r.onClick}
          disabled={!r.onClick}
          className="flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border)] px-1.5 py-1 text-left text-[11px] hover:bg-[var(--color-surfaceHover)] disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="font-medium text-[var(--color-text)]">
            {r.primary}
          </span>
          {r.secondary && (
            <span className="truncate text-[var(--color-textSecondary)]">
              {r.secondary}
            </span>
          )}
        </button>
      </li>
    ))}
  </ul>
);

const Json: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="max-h-48 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

export default MailcowOperationsTab;
