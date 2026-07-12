import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Filter,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExchangeTabProps } from "../../../types/exchange";
import type {
  Connector,
  CreateRemoteDomainRequest,
  CreateTransportRuleRequest,
  EmailAddressPolicy,
  MailQueue,
  MessageTraceRequest,
  RemoteDomain,
  TransportRule,
} from "../../../types/exchange/mailflow";
import {
  useExchangeMailflow,
  type ConnectorScope,
  type ExchangeMailflowView,
  type ExchangeParams,
} from "../../../hooks/integration/exchange/useExchangeMailflow";

// ─── Shared styling ────────────────────────────────────────────────────────────

const INPUT_CLS =
  "exchange-input w-full rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]";
const BTN_PRIMARY =
  "flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60";
const BTN_GHOST = "app-bar-button flex items-center gap-1 px-2 py-1 text-xs";

/** Render an optional scalar cell. */
function cellText(val: unknown): string {
  if (val == null) return "—";
  if (Array.isArray(val)) return val.length ? val.join(", ") : "—";
  if (typeof val === "boolean") return val ? "✓" : "✗";
  if (typeof val === "string" || typeof val === "number") return String(val);
  return "—";
}

/** Parse a JSON object from a textarea; throws with a readable message. */
function parseParams(raw: string): ExchangeParams {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as ExchangeParams;
}

// ─── View metadata ────────────────────────────────────────────────────────────

interface ViewMeta {
  key: ExchangeMailflowView;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const VIEWS: ViewMeta[] = [
  {
    key: "transportRules",
    labelKey: "integrations.exchange.mailflow.transportRules.title",
    labelDefault: "Transport Rules",
    icon: ShieldCheck,
  },
  {
    key: "connectors",
    labelKey: "integrations.exchange.mailflow.connectors.title",
    labelDefault: "Connectors",
    icon: ArrowLeftRight,
  },
  {
    key: "messageFlow",
    labelKey: "integrations.exchange.mailflow.messageFlow.title",
    labelDefault: "Message Trace & Queues",
    icon: Search,
  },
  {
    key: "addressing",
    labelKey: "integrations.exchange.mailflow.addressing.title",
    labelDefault: "Address Policies & Lists",
    icon: Filter,
  },
  {
    key: "remoteDomains",
    labelKey: "integrations.exchange.mailflow.remoteDomains.title",
    labelDefault: "Remote Domains",
    icon: ArrowLeftRight,
  },
  {
    key: "transportConfig",
    labelKey: "integrations.exchange.mailflow.transportConfig.title",
    labelDefault: "Transport Config",
    icon: Settings2,
  },
];

// ─── Small building blocks ──────────────────────────────────────────────────────

const Toolbar: React.FC<{
  title: string;
  count?: number;
  onRefresh?: () => void;
  children?: React.ReactNode;
}> = ({ title, count, onRefresh, children }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
      <span className="text-sm font-medium text-[var(--color-text)]">{title}</span>
      {count != null && (
        <span className="text-xs text-[var(--color-textMuted)]">
          {t("integrations.exchange.mailflow.count", "{{count}} items", { count })}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {children}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className={BTN_GHOST}
            title={t("integrations.exchange.mailflow.refresh", "Refresh")}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

const EmptyOr: React.FC<{
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
}> = ({ loading, empty, children }) => {
  const { t } = useTranslation();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  if (empty)
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
        {t("integrations.exchange.mailflow.empty", "No records.")}
      </div>
    );
  return <>{children}</>;
};

/** Read-only key/value detail card for a single fetched record. */
const DetailCard: React.FC<{
  title: string;
  record: Record<string, unknown>;
  onClose: () => void;
}> = ({ title, record, onClose }) => (
  <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-sm font-medium text-[var(--color-text)]">{title}</span>
      <button
        onClick={onClose}
        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      >
        <X size={14} />
      </button>
    </div>
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-3">
      {Object.entries(record).map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <span className="text-[var(--color-textSecondary)]">{k}</span>
          <span className="break-words text-[var(--color-text)]">
            {cellText(v)}
          </span>
        </div>
      ))}
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Rules view
// ═══════════════════════════════════════════════════════════════════════════════

const TransportRulesView: React.FC<{
  state: ReturnType<typeof useExchangeMailflow>;
}> = ({ state }) => {
  const { t } = useTranslation();
  const { transportRules, loading, loadTransportRules, api } = state;
  const [detail, setDetail] = useState<TransportRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateTransportRuleRequest>({ name: "" });
  const [editParamsFor, setEditParamsFor] = useState<string | null>(null);
  const [paramsRaw, setParamsRaw] = useState("{\n  \n}");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void loadTransportRules();
  }, [loadTransportRules]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setLocalError(null);
      try {
        await fn();
        await loadTransportRules();
      } catch (e) {
        setLocalError(typeof e === "string" ? e : (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadTransportRules],
  );

  const submitCreate = useCallback(async () => {
    if (!form.name.trim()) {
      setLocalError(
        t("integrations.exchange.mailflow.transportRules.nameRequired", "Name is required"),
      );
      return;
    }
    await act(async () => {
      await api.createTransportRule(form);
      setCreating(false);
      setForm({ name: "" });
    });
  }, [act, api, form, t]);

  const submitParams = useCallback(async () => {
    if (!editParamsFor) return;
    let params: ExchangeParams;
    try {
      params = parseParams(paramsRaw);
    } catch (e) {
      setLocalError((e as Error).message);
      return;
    }
    await act(async () => {
      await api.updateTransportRule(editParamsFor, params);
      setEditParamsFor(null);
    });
  }, [act, api, editParamsFor, paramsRaw]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        title={t("integrations.exchange.mailflow.transportRules.title", "Transport Rules")}
        count={transportRules.length}
        onRefresh={() => void loadTransportRules()}
      >
        <button
          onClick={() => {
            setCreating(true);
            setForm({ name: "" });
            setLocalError(null);
          }}
          className={BTN_PRIMARY}
        >
          <Plus size={12} />
          {t("integrations.exchange.mailflow.new", "New")}
        </button>
      </Toolbar>

      {localError && (
        <p className="px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          {localError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyOr loading={loading} empty={transportRules.length === 0}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)]">
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.priority", "Priority")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.name", "Name")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.state", "State")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.description", "Description")}
                </th>
                <th className="px-4 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {transportRules.map((r) => (
                <tr
                  key={r.id || r.name}
                  className="border-b border-[var(--color-border)]/50 text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  <td className="px-4 py-1.5">{r.priority}</td>
                  <td className="px-4 py-1.5">{r.name}</td>
                  <td className="px-4 py-1.5">
                    {t(
                      `integrations.exchange.mailflow.ruleState.${r.state}`,
                      r.state,
                    )}
                  </td>
                  <td className="px-4 py-1.5">{cellText(r.description)}</td>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() =>
                          void act(() =>
                            api.getTransportRule(r.id || r.name).then(setDetail),
                          )
                        }
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.view", "View")}
                      >
                        <Search size={13} />
                      </button>
                      <button
                        onClick={() => {
                          setEditParamsFor(r.id || r.name);
                          setParamsRaw("{\n  \n}");
                          setLocalError(null);
                        }}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.editParams", "Edit (params)")}
                      >
                        <Settings2 size={13} />
                      </button>
                      {r.state === "disabled" ? (
                        <button
                          onClick={() =>
                            void act(() => api.enableTransportRule(r.id || r.name))
                          }
                          disabled={busy}
                          className="text-[var(--color-textSecondary)] hover:text-[var(--color-success,#22c55e)]"
                          title={t("integrations.exchange.mailflow.enable", "Enable")}
                        >
                          <CheckCircle2 size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            void act(() => api.disableTransportRule(r.id || r.name))
                          }
                          disabled={busy}
                          className="text-[var(--color-textSecondary)] hover:text-[var(--color-warning,#f59e0b)]"
                          title={t("integrations.exchange.mailflow.disable", "Disable")}
                        >
                          <Ban size={13} />
                        </button>
                      )}
                      <button
                        onClick={() =>
                          void act(() => api.removeTransportRule(r.id || r.name))
                        }
                        disabled={busy}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-error,#ef4444)]"
                        title={t("integrations.exchange.mailflow.delete", "Delete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </EmptyOr>
      </div>

      {detail && (
        <DetailCard
          title={detail.name}
          record={detail as unknown as Record<string, unknown>}
          onClose={() => setDetail(null)}
        />
      )}

      {editParamsFor && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {t("integrations.exchange.mailflow.transportRules.updateTitle", "Update rule")}:{" "}
              {editParamsFor}
            </span>
            <button
              onClick={() => setEditParamsFor(null)}
              className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={14} />
            </button>
          </div>
          <p className="mb-1 text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.exchange.mailflow.paramsHint",
              "JSON object of properties to set.",
            )}
          </p>
          <textarea
            className={`${INPUT_CLS} font-mono`}
            rows={5}
            value={paramsRaw}
            onChange={(e) => setParamsRaw(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => void submitParams()} disabled={busy} className={BTN_PRIMARY}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {t("integrations.exchange.mailflow.apply", "Apply")}
            </button>
            <button onClick={() => setEditParamsFor(null)} className="app-bar-button px-3 py-1.5 text-xs">
              {t("integrations.exchange.mailflow.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      {creating && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {t("integrations.exchange.mailflow.transportRules.createTitle", "Create transport rule")}
            </span>
            <button
              onClick={() => setCreating(false)}
              className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.field.name", "Name")}
              </span>
              <input
                className={INPUT_CLS}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.field.priority", "Priority")}
              </span>
              <input
                className={INPUT_CLS}
                inputMode="numeric"
                value={form.priority ?? ""}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    priority: e.target.value ? Number(e.target.value) : null,
                  }))
                }
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.field.description", "Description")}
              </span>
              <input
                className={INPUT_CLS}
                value={form.description ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value || null }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.transportRules.prependSubject", "Prepend subject")}
              </span>
              <input
                className={INPUT_CLS}
                value={form.prependSubject ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, prependSubject: e.target.value || null }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.transportRules.rejectReason", "Reject reason")}
              </span>
              <input
                className={INPUT_CLS}
                value={form.rejectMessageReason ?? ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, rejectMessageReason: e.target.value || null }))
                }
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void submitCreate()} disabled={busy} className={BTN_PRIMARY}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {t("integrations.exchange.mailflow.create", "Create")}
            </button>
            <button onClick={() => setCreating(false)} className="app-bar-button px-3 py-1.5 text-xs">
              {t("integrations.exchange.mailflow.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Connectors view
// ═══════════════════════════════════════════════════════════════════════════════

const CONNECTOR_SCOPES: Array<{ key: ConnectorScope; labelKey: string; labelDefault: string }> = [
  { key: "send", labelKey: "integrations.exchange.mailflow.connectors.send", labelDefault: "Send" },
  { key: "receive", labelKey: "integrations.exchange.mailflow.connectors.receive", labelDefault: "Receive" },
  { key: "inbound", labelKey: "integrations.exchange.mailflow.connectors.inbound", labelDefault: "Inbound" },
  { key: "outbound", labelKey: "integrations.exchange.mailflow.connectors.outbound", labelDefault: "Outbound" },
];

const ConnectorsView: React.FC<{
  state: ReturnType<typeof useExchangeMailflow>;
}> = ({ state }) => {
  const { t } = useTranslation();
  const { connectors, loading, loadConnectors, api } = state;
  const [scope, setScope] = useState<ConnectorScope>("send");
  const [server, setServer] = useState("");
  const [detail, setDetail] = useState<Connector | null>(null);

  useEffect(() => {
    setDetail(null);
    void loadConnectors(scope, scope === "receive" ? server.trim() || null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, loadConnectors]);

  const canDetail = scope === "send" || scope === "receive";
  const getDetail = useCallback(
    (identity: string) => {
      const p =
        scope === "send"
          ? api.getSendConnector(identity)
          : api.getReceiveConnector(identity);
      void p.then(setDetail).catch(() => setDetail(null));
    },
    [api, scope],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-1">
        {CONNECTOR_SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
              s.key === scope
                ? "bg-primary/15 text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {t(s.labelKey, s.labelDefault)}
          </button>
        ))}
      </div>

      <Toolbar
        title={t(
          `integrations.exchange.mailflow.connectors.${scope}`,
          scope,
        )}
        count={connectors.length}
        onRefresh={() =>
          void loadConnectors(scope, scope === "receive" ? server.trim() || null : null)
        }
      >
        {scope === "receive" && (
          <input
            className="exchange-input w-40 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
            placeholder={t("integrations.exchange.mailflow.serverFilter", "Server (optional)")}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadConnectors("receive", server.trim() || null);
            }}
          />
        )}
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyOr loading={loading} empty={connectors.length === 0}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)]">
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.name", "Name")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.enabled", "Enabled")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.type", "Type")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.connectors.smartHosts", "Smart hosts")}
                </th>
                {canDetail && <th className="px-4 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => (
                <tr
                  key={c.id || c.name}
                  className="border-b border-[var(--color-border)]/50 text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  <td className="px-4 py-1.5">{c.name}</td>
                  <td className="px-4 py-1.5">{c.enabled ? "✓" : "✗"}</td>
                  <td className="px-4 py-1.5">{cellText(c.connectorType)}</td>
                  <td className="px-4 py-1.5">{cellText(c.smartHosts)}</td>
                  {canDetail && (
                    <td className="px-4 py-1.5 text-right">
                      <button
                        onClick={() => getDetail(c.id || c.name)}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.view", "View")}
                      >
                        <Search size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </EmptyOr>
      </div>

      {detail && (
        <DetailCard
          title={detail.name}
          record={detail as unknown as Record<string, unknown>}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Message Trace & Queues view
// ═══════════════════════════════════════════════════════════════════════════════

const MessageFlowView: React.FC<{
  state: ReturnType<typeof useExchangeMailflow>;
}> = ({ state }) => {
  const { t } = useTranslation();
  const {
    traceResults,
    queues,
    loading,
    runMessageTrace,
    runTrackingLog,
    loadQueues,
    loadQueueSummary,
    api,
  } = state;

  const [mode, setMode] = useState<"trace" | "tracking">("trace");
  const [trace, setTrace] = useState<MessageTraceRequest>({});
  const [track, setTrack] = useState({
    sender: "",
    recipient: "",
    start: "",
    end: "",
    server: "",
    resultSize: "",
  });
  const [queueServer, setQueueServer] = useState("");
  const [queueDetail, setQueueDetail] = useState<MailQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void loadQueues(null);
  }, [loadQueues]);

  const queueAct = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setLocalError(null);
      try {
        await fn();
        await loadQueues(queueServer.trim() || null);
      } catch (e) {
        setLocalError(typeof e === "string" ? e : (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadQueues, queueServer],
  );

  const submitSearch = useCallback(() => {
    if (mode === "trace") {
      void runMessageTrace({
        senderAddress: trace.senderAddress?.trim() || null,
        recipientAddress: trace.recipientAddress?.trim() || null,
        messageId: trace.messageId?.trim() || null,
        startDate: trace.startDate || null,
        endDate: trace.endDate || null,
      });
    } else {
      void runTrackingLog({
        sender: track.sender.trim() || null,
        recipient: track.recipient.trim() || null,
        start: track.start || null,
        end: track.end || null,
        server: track.server.trim() || null,
        resultSize: track.resultSize.trim() ? Number(track.resultSize.trim()) : null,
      });
    }
  }, [mode, runMessageTrace, runTrackingLog, trace, track]);

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Search panel */}
      <div className="border-b border-[var(--color-border)] p-4">
        <div className="mb-3 flex items-center gap-1">
          {(["trace", "tracking"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2.5 py-1 text-xs ${
                m === mode
                  ? "bg-primary/15 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              {m === "trace"
                ? t("integrations.exchange.mailflow.messageFlow.traceTab", "Message trace")
                : t("integrations.exchange.mailflow.messageFlow.trackingTab", "Tracking log")}
            </button>
          ))}
        </div>

        {mode === "trace" ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <input
              className={INPUT_CLS}
              placeholder={t("integrations.exchange.mailflow.messageFlow.sender", "Sender")}
              value={trace.senderAddress ?? ""}
              onChange={(e) => setTrace((p) => ({ ...p, senderAddress: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              placeholder={t("integrations.exchange.mailflow.messageFlow.recipient", "Recipient")}
              value={trace.recipientAddress ?? ""}
              onChange={(e) => setTrace((p) => ({ ...p, recipientAddress: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              placeholder={t("integrations.exchange.mailflow.messageFlow.messageId", "Message ID")}
              value={trace.messageId ?? ""}
              onChange={(e) => setTrace((p) => ({ ...p, messageId: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              type="datetime-local"
              value={trace.startDate ?? ""}
              onChange={(e) => setTrace((p) => ({ ...p, startDate: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              type="datetime-local"
              value={trace.endDate ?? ""}
              onChange={(e) => setTrace((p) => ({ ...p, endDate: e.target.value }))}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <input
              className={INPUT_CLS}
              placeholder={t("integrations.exchange.mailflow.messageFlow.sender", "Sender")}
              value={track.sender}
              onChange={(e) => setTrack((p) => ({ ...p, sender: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              placeholder={t("integrations.exchange.mailflow.messageFlow.recipient", "Recipient")}
              value={track.recipient}
              onChange={(e) => setTrack((p) => ({ ...p, recipient: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              placeholder={t("integrations.exchange.mailflow.serverFilter", "Server (optional)")}
              value={track.server}
              onChange={(e) => setTrack((p) => ({ ...p, server: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              type="datetime-local"
              value={track.start}
              onChange={(e) => setTrack((p) => ({ ...p, start: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              type="datetime-local"
              value={track.end}
              onChange={(e) => setTrack((p) => ({ ...p, end: e.target.value }))}
            />
            <input
              className={INPUT_CLS}
              inputMode="numeric"
              placeholder={t("integrations.exchange.mailflow.resultSize", "Result size")}
              value={track.resultSize}
              onChange={(e) => setTrack((p) => ({ ...p, resultSize: e.target.value }))}
            />
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button onClick={submitSearch} disabled={loading} className={BTN_PRIMARY}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            {t("integrations.exchange.mailflow.messageFlow.search", "Search")}
          </button>
        </div>
      </div>

      {/* Results */}
      {traceResults.length > 0 && (
        <div className="border-b border-[var(--color-border)]">
          <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.exchange.mailflow.messageFlow.results", "Results")} (
            {traceResults.length})
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                <th className="px-4 py-1 font-medium">
                  {t("integrations.exchange.mailflow.messageFlow.sender", "Sender")}
                </th>
                <th className="px-4 py-1 font-medium">
                  {t("integrations.exchange.mailflow.messageFlow.recipient", "Recipient")}
                </th>
                <th className="px-4 py-1 font-medium">
                  {t("integrations.exchange.mailflow.messageFlow.subject", "Subject")}
                </th>
                <th className="px-4 py-1 font-medium">
                  {t("integrations.exchange.mailflow.field.status", "Status")}
                </th>
                <th className="px-4 py-1 font-medium">
                  {t("integrations.exchange.mailflow.messageFlow.received", "Received")}
                </th>
              </tr>
            </thead>
            <tbody>
              {traceResults.map((r, i) => (
                <tr
                  key={r.messageId || i}
                  className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]"
                >
                  <td className="px-4 py-1">{r.senderAddress}</td>
                  <td className="px-4 py-1">{r.recipientAddress}</td>
                  <td className="px-4 py-1">{cellText(r.subject)}</td>
                  <td className="px-4 py-1">
                    {t(`integrations.exchange.mailflow.deliveryStatus.${r.status}`, r.status)}
                  </td>
                  <td className="px-4 py-1">{cellText(r.received)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Queues */}
      <Toolbar
        title={t("integrations.exchange.mailflow.messageFlow.queues", "Queues")}
        count={queues.length}
        onRefresh={() => void loadQueues(queueServer.trim() || null)}
      >
        <input
          className="exchange-input w-40 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
          placeholder={t("integrations.exchange.mailflow.serverFilter", "Server (optional)")}
          value={queueServer}
          onChange={(e) => setQueueServer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadQueues(queueServer.trim() || null);
          }}
        />
        <button onClick={() => void loadQueueSummary()} className={BTN_GHOST}>
          {t("integrations.exchange.mailflow.messageFlow.summary", "Summary")}
        </button>
      </Toolbar>

      {localError && (
        <p className="px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">{localError}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyOr loading={false} empty={queues.length === 0}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)]">
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.identity", "Identity")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.status", "Status")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.messageFlow.messageCount", "Messages")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.messageFlow.nextHop", "Next hop")}
                </th>
                <th className="px-4 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr
                  key={q.identity}
                  className="border-b border-[var(--color-border)]/50 text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  <td className="px-4 py-1.5">{q.identity}</td>
                  <td className="px-4 py-1.5">{q.status}</td>
                  <td className="px-4 py-1.5">{q.messageCount}</td>
                  <td className="px-4 py-1.5">{cellText(q.nextHopDomain)}</td>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() =>
                          void api.getQueue(q.identity).then(setQueueDetail).catch(() => {})
                        }
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.view", "View")}
                      >
                        <Search size={13} />
                      </button>
                      <button
                        onClick={() => void queueAct(() => api.retryQueue(q.identity))}
                        disabled={busy}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.messageFlow.retry", "Retry")}
                      >
                        <RefreshCw size={13} />
                      </button>
                      <button
                        onClick={() => void queueAct(() => api.suspendQueue(q.identity))}
                        disabled={busy}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-warning,#f59e0b)]"
                        title={t("integrations.exchange.mailflow.messageFlow.suspend", "Suspend")}
                      >
                        <Ban size={13} />
                      </button>
                      <button
                        onClick={() => void queueAct(() => api.resumeQueue(q.identity))}
                        disabled={busy}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-success,#22c55e)]"
                        title={t("integrations.exchange.mailflow.messageFlow.resume", "Resume")}
                      >
                        <Play size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </EmptyOr>
      </div>

      {queueDetail && (
        <DetailCard
          title={queueDetail.identity}
          record={queueDetail as unknown as Record<string, unknown>}
          onClose={() => setQueueDetail(null)}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Address Policies & Lists view
// ═══════════════════════════════════════════════════════════════════════════════

const AddressingView: React.FC<{
  state: ReturnType<typeof useExchangeMailflow>;
}> = ({ state }) => {
  const { t } = useTranslation();
  const { addressPolicies, acceptedDomains, addressLists, loading, loadAddressing, api } =
    state;
  const [detail, setDetail] = useState<EmailAddressPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void loadAddressing();
  }, [loadAddressing]);

  const apply = useCallback(
    async (identity: string) => {
      setBusy(true);
      setLocalError(null);
      try {
        await api.applyAddressPolicy(identity);
        await loadAddressing();
      } catch (e) {
        setLocalError(typeof e === "string" ? e : (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [api, loadAddressing],
  );

  return (
    <div className="flex h-full flex-col overflow-auto">
      <Toolbar
        title={t("integrations.exchange.mailflow.addressing.title", "Address Policies & Lists")}
        onRefresh={() => void loadAddressing()}
      />
      {localError && (
        <p className="px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">{localError}</p>
      )}

      <EmptyOr
        loading={loading}
        empty={
          addressPolicies.length === 0 &&
          acceptedDomains.length === 0 &&
          addressLists.length === 0
        }
      >
        <div className="flex flex-col gap-4 p-4">
          {/* Email address policies */}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--color-textSecondary)]">
              {t("integrations.exchange.mailflow.addressing.policies", "Email address policies")}
            </h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.field.priority", "Priority")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.field.name", "Name")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.field.enabled", "Enabled")}
                  </th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {addressPolicies.map((p) => (
                  <tr key={p.id || p.name} className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]">
                    <td className="px-2 py-1">{p.priority}</td>
                    <td className="px-2 py-1">{p.name}</td>
                    <td className="px-2 py-1">{p.enabled ? "✓" : "✗"}</td>
                    <td className="px-2 py-1 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() =>
                            void api.getAddressPolicy(p.id || p.name).then(setDetail).catch(() => {})
                          }
                          className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                          title={t("integrations.exchange.mailflow.view", "View")}
                        >
                          <Search size={13} />
                        </button>
                        <button
                          onClick={() => void apply(p.id || p.name)}
                          disabled={busy}
                          className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                          title={t("integrations.exchange.mailflow.addressing.apply", "Apply")}
                        >
                          <Play size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Accepted domains */}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--color-textSecondary)]">
              {t("integrations.exchange.mailflow.addressing.acceptedDomains", "Accepted domains")}
            </h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.field.name", "Name")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.addressing.domainName", "Domain")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.addressing.domainType", "Type")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.addressing.default", "Default")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {acceptedDomains.map((d) => (
                  <tr key={d.name} className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]">
                    <td className="px-2 py-1">{d.name}</td>
                    <td className="px-2 py-1">{d.domainName}</td>
                    <td className="px-2 py-1">
                      {t(
                        `integrations.exchange.mailflow.acceptedDomainType.${d.domainType}`,
                        d.domainType,
                      )}
                    </td>
                    <td className="px-2 py-1">{d.isDefault ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Address lists */}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--color-textSecondary)]">
              {t("integrations.exchange.mailflow.addressing.addressLists", "Address lists")}
            </h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.field.name", "Name")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.addressing.path", "Path")}
                  </th>
                  <th className="px-2 py-1 font-medium">
                    {t("integrations.exchange.mailflow.addressing.recipientFilter", "Recipient filter")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {addressLists.map((l) => (
                  <tr key={l.path || l.name} className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]">
                    <td className="px-2 py-1">{l.name}</td>
                    <td className="px-2 py-1">{l.path}</td>
                    <td className="px-2 py-1">{cellText(l.recipientFilter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </EmptyOr>

      {detail && (
        <DetailCard
          title={detail.name}
          record={detail as unknown as Record<string, unknown>}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Remote Domains view
// ═══════════════════════════════════════════════════════════════════════════════

const RemoteDomainsView: React.FC<{
  state: ReturnType<typeof useExchangeMailflow>;
}> = ({ state }) => {
  const { t } = useTranslation();
  const { remoteDomains, loading, loadRemoteDomains, api } = state;
  const [detail, setDetail] = useState<RemoteDomain | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateRemoteDomainRequest>({ name: "", domainName: "" });
  const [editParamsFor, setEditParamsFor] = useState<string | null>(null);
  const [paramsRaw, setParamsRaw] = useState("{\n  \n}");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void loadRemoteDomains();
  }, [loadRemoteDomains]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setLocalError(null);
      try {
        await fn();
        await loadRemoteDomains();
      } catch (e) {
        setLocalError(typeof e === "string" ? e : (e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadRemoteDomains],
  );

  const submitCreate = useCallback(async () => {
    if (!form.name.trim() || !form.domainName.trim()) {
      setLocalError(
        t(
          "integrations.exchange.mailflow.remoteDomains.required",
          "Name and domain are required",
        ),
      );
      return;
    }
    await act(async () => {
      await api.createRemoteDomain(form);
      setCreating(false);
      setForm({ name: "", domainName: "" });
    });
  }, [act, api, form, t]);

  const submitParams = useCallback(async () => {
    if (!editParamsFor) return;
    let params: ExchangeParams;
    try {
      params = parseParams(paramsRaw);
    } catch (e) {
      setLocalError((e as Error).message);
      return;
    }
    await act(async () => {
      await api.updateRemoteDomain(editParamsFor, params);
      setEditParamsFor(null);
    });
  }, [act, api, editParamsFor, paramsRaw]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        title={t("integrations.exchange.mailflow.remoteDomains.title", "Remote Domains")}
        count={remoteDomains.length}
        onRefresh={() => void loadRemoteDomains()}
      >
        <button
          onClick={() => {
            setCreating(true);
            setForm({ name: "", domainName: "" });
            setLocalError(null);
          }}
          className={BTN_PRIMARY}
        >
          <Plus size={12} />
          {t("integrations.exchange.mailflow.new", "New")}
        </button>
      </Toolbar>

      {localError && (
        <p className="px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">{localError}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <EmptyOr loading={loading} empty={remoteDomains.length === 0}>
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)]">
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.field.name", "Name")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.addressing.domainName", "Domain")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.remoteDomains.autoReply", "Auto-reply")}
                </th>
                <th className="px-4 py-1.5 font-medium">
                  {t("integrations.exchange.mailflow.remoteDomains.tnef", "TNEF")}
                </th>
                <th className="px-4 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {remoteDomains.map((d) => (
                <tr
                  key={d.name}
                  className="border-b border-[var(--color-border)]/50 text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
                >
                  <td className="px-4 py-1.5">{d.name}</td>
                  <td className="px-4 py-1.5">{d.domainName}</td>
                  <td className="px-4 py-1.5">{d.autoReplyEnabled ? "✓" : "✗"}</td>
                  <td className="px-4 py-1.5">{d.tnefEnabled ? "✓" : "✗"}</td>
                  <td className="px-4 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() =>
                          void api.getRemoteDomain(d.name).then(setDetail).catch(() => {})
                        }
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.view", "View")}
                      >
                        <Search size={13} />
                      </button>
                      <button
                        onClick={() => {
                          setEditParamsFor(d.name);
                          setParamsRaw("{\n  \n}");
                          setLocalError(null);
                        }}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                        title={t("integrations.exchange.mailflow.editParams", "Edit (params)")}
                      >
                        <Settings2 size={13} />
                      </button>
                      <button
                        onClick={() => void act(() => api.removeRemoteDomain(d.name))}
                        disabled={busy}
                        className="text-[var(--color-textSecondary)] hover:text-[var(--color-error,#ef4444)]"
                        title={t("integrations.exchange.mailflow.delete", "Delete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </EmptyOr>
      </div>

      {detail && (
        <DetailCard
          title={detail.name}
          record={detail as unknown as Record<string, unknown>}
          onClose={() => setDetail(null)}
        />
      )}

      {editParamsFor && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {t("integrations.exchange.mailflow.remoteDomains.updateTitle", "Update remote domain")}:{" "}
              {editParamsFor}
            </span>
            <button
              onClick={() => setEditParamsFor(null)}
              className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={14} />
            </button>
          </div>
          <textarea
            className={`${INPUT_CLS} font-mono`}
            rows={5}
            value={paramsRaw}
            onChange={(e) => setParamsRaw(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => void submitParams()} disabled={busy} className={BTN_PRIMARY}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {t("integrations.exchange.mailflow.apply", "Apply")}
            </button>
            <button onClick={() => setEditParamsFor(null)} className="app-bar-button px-3 py-1.5 text-xs">
              {t("integrations.exchange.mailflow.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      {creating && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {t("integrations.exchange.mailflow.remoteDomains.createTitle", "Create remote domain")}
            </span>
            <button
              onClick={() => setCreating(false)}
              className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.field.name", "Name")}
              </span>
              <input
                className={INPUT_CLS}
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--color-textSecondary)]">
                {t("integrations.exchange.mailflow.addressing.domainName", "Domain")}
              </span>
              <input
                className={INPUT_CLS}
                value={form.domainName}
                onChange={(e) => setForm((p) => ({ ...p, domainName: e.target.value }))}
                placeholder="contoso.com"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.autoReplyEnabled ?? false}
                onChange={(e) => setForm((p) => ({ ...p, autoReplyEnabled: e.target.checked }))}
              />
              {t("integrations.exchange.mailflow.remoteDomains.autoReply", "Auto-reply")}
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.autoForwardEnabled ?? false}
                onChange={(e) => setForm((p) => ({ ...p, autoForwardEnabled: e.target.checked }))}
              />
              {t("integrations.exchange.mailflow.remoteDomains.autoForward", "Auto-forward")}
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => void submitCreate()} disabled={busy} className={BTN_PRIMARY}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {t("integrations.exchange.mailflow.create", "Create")}
            </button>
            <button onClick={() => setCreating(false)} className="app-bar-button px-3 py-1.5 text-xs">
              {t("integrations.exchange.mailflow.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Config view
// ═══════════════════════════════════════════════════════════════════════════════

const TransportConfigView: React.FC<{
  state: ReturnType<typeof useExchangeMailflow>;
}> = ({ state }) => {
  const { t } = useTranslation();
  const { transportConfig, loading, loadTransportConfig, api } = state;
  const [editing, setEditing] = useState(false);
  const [paramsRaw, setParamsRaw] = useState("{\n  \n}");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    void loadTransportConfig();
  }, [loadTransportConfig]);

  const submit = useCallback(async () => {
    let params: ExchangeParams;
    try {
      params = parseParams(paramsRaw);
    } catch (e) {
      setLocalError((e as Error).message);
      return;
    }
    setBusy(true);
    setLocalError(null);
    setOkMsg(null);
    try {
      const msg = await api.setTransportConfig(params);
      setOkMsg(msg);
      setEditing(false);
      await loadTransportConfig();
    } catch (e) {
      setLocalError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, paramsRaw, loadTransportConfig]);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <Toolbar
        title={t("integrations.exchange.mailflow.transportConfig.title", "Transport Config")}
        onRefresh={() => void loadTransportConfig()}
      >
        <button
          onClick={() => {
            setEditing((v) => !v);
            setParamsRaw("{\n  \n}");
            setLocalError(null);
            setOkMsg(null);
          }}
          className={BTN_GHOST}
        >
          <Settings2 size={12} />
          {t("integrations.exchange.mailflow.transportConfig.edit", "Edit")}
        </button>
      </Toolbar>

      {okMsg && (
        <p className="px-4 py-1.5 text-xs text-[var(--color-success,#22c55e)]">{okMsg}</p>
      )}
      {localError && (
        <p className="px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">{localError}</p>
      )}

      {editing && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <p className="mb-1 text-xs text-[var(--color-textSecondary)]">
            {t(
              "integrations.exchange.mailflow.paramsHint",
              "JSON object of properties to set.",
            )}
          </p>
          <textarea
            className={`${INPUT_CLS} font-mono`}
            rows={6}
            value={paramsRaw}
            onChange={(e) => setParamsRaw(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => void submit()} disabled={busy} className={BTN_PRIMARY}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {t("integrations.exchange.mailflow.apply", "Apply")}
            </button>
            <button onClick={() => setEditing(false)} className="app-bar-button px-3 py-1.5 text-xs">
              {t("integrations.exchange.mailflow.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <EmptyOr loading={loading} empty={!transportConfig}>
          {transportConfig && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-3">
              {Object.entries(transportConfig as unknown as Record<string, unknown>).map(
                ([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <span className="text-[var(--color-textSecondary)]">{k}</span>
                    <span className="break-words text-[var(--color-text)]">{cellText(v)}</span>
                  </div>
                ),
              )}
            </div>
          )}
        </EmptyOr>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Root tab
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Exchange Transport & Mail Flow tab (t42-exchange-c2). A six-group view over
 * Transport Rules, Connectors, Message Trace & Queues, Address Policies & Lists,
 * Remote Domains and Transport Config. All 33 mail-flow commands are reachable
 * here via `useExchangeMailflow`. Exchange is a singleton service, so the tab uses
 * only the connection `summary` from props (no connection id).
 */
const ExchangeMailflowTab: React.FC<ExchangeTabProps> = () => {
  const { t } = useTranslation();
  const state = useExchangeMailflow();
  const [view, setView] = useState<ExchangeMailflowView>("transportRules");

  const body = useMemo(() => {
    switch (view) {
      case "transportRules":
        return <TransportRulesView state={state} />;
      case "connectors":
        return <ConnectorsView state={state} />;
      case "messageFlow":
        return <MessageFlowView state={state} />;
      case "addressing":
        return <AddressingView state={state} />;
      case "remoteDomains":
        return <RemoteDomainsView state={state} />;
      case "transportConfig":
        return <TransportConfigView state={state} />;
      default:
        return null;
    }
  }, [view, state]);

  return (
    <div className="flex h-full flex-col">
      {/* Group selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-1">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = v.key === view;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
                active
                  ? "bg-primary/15 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {t(v.labelKey, v.labelDefault)}
            </button>
          );
        })}
      </div>

      {state.error && (
        <div className="flex items-center justify-between gap-2 bg-[var(--color-error,#ef4444)]/10 px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{state.error}</span>
          <button onClick={state.clearError} className="opacity-70 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
};

export default ExchangeMailflowTab;
