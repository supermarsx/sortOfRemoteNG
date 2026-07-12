// Exchange "Org Config, Security & Compliance" tab (t42-exchange-c5).
//
// Binds all 45 org/security/compliance `exchange_*` commands through
// `useExchangeOrgSecurity` / `exchangeOrgSecurityApi`, grouped into six sections:
//   Retention & Holds (9), Journal Rules (6), RBAC & Audit (12), Organization (2),
//   Hygiene & Quarantine (10), Certificates (6).
//
// A category tab per the shell contract — mounted only once the shell holds a live
// connection. Exchange is a SINGLETON service: no `connectionId`; each command runs
// against the one active connection. The tab receives `ExchangeTabProps { summary }`.

import React, { useCallback, useEffect, useState } from "react";
import {
  Award,
  BookLock,
  Building2,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExchangeTabProps } from "../../../types/exchange";
import { useExchangeOrgSecurity } from "../../../hooks/integration/exchange/useExchangeOrgSecurity";

// ─── Shared primitives ─────────────────────────────────────────────────────────

type ExJson = unknown;
type ExPayload = Record<string, unknown>;
type OrgSec = ReturnType<typeof useExchangeOrgSecurity>;

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-60";
const primaryBtnCls =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

/** Display value for a possibly-null scalar. */
function txt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  return String(v);
}

/** Side drawer showing a formatted JSON payload (record detail / config). */
const JsonDrawer: React.FC<{
  title: string;
  data: ExJson;
  onClose: () => void;
}> = ({ title, data, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {title}
        </span>
        <button
          onClick={onClose}
          className={btnCls}
          title={t("integrations.exchange.orgsecurity.actions.close", "Close")}
        >
          <X size={14} />
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-[var(--color-textSecondary)]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

/** JSON payload editor for create / set / parameterized actions. A single submit
 *  button; the caller maps the parsed object to the relevant command. */
const JsonEditorModal: React.FC<{
  title: string;
  hint?: string;
  submitLabel: string;
  initial: ExPayload;
  onSubmit: (data: ExPayload) => void | Promise<void>;
  onClose: () => void;
}> = ({ title, hint, submitLabel, initial, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    let parsed: ExPayload;
    try {
      parsed = text.trim() ? (JSON.parse(text) as ExPayload) : {};
    } catch (e) {
      setParseError((e as Error).message);
      return;
    }
    setParseError(null);
    setBusy(true);
    try {
      await onSubmit(parsed);
    } finally {
      setBusy(false);
    }
  }, [text, onSubmit]);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {title}
          </span>
          <button onClick={onClose} className={btnCls}>
            <X size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <span className="text-xs text-[var(--color-textSecondary)]">
            {hint ??
              t(
                "integrations.exchange.orgsecurity.editor.hint",
                "Edit the JSON payload sent to Exchange.",
              )}
          </span>
          <textarea
            className={`${inputCls} min-h-[16rem] flex-1 font-mono`}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          {parseError && (
            <p className="text-xs text-[var(--color-error,#ef4444)]">
              {parseError}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <button onClick={onClose} className={btnCls} disabled={busy}>
            {t("integrations.exchange.orgsecurity.actions.cancel", "Cancel")}
          </button>
          <button onClick={submit} className={primaryBtnCls} disabled={busy}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Header row: filters (children) + count + refresh + optional "New". */
const SectionBar: React.FC<{
  count?: number;
  isLoading: boolean;
  onRefresh: () => void;
  onNew?: () => void;
  newLabel?: string;
  children?: React.ReactNode;
}> = ({ count, isLoading, onRefresh, onNew, newLabel, children }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
      {children}
      <div className="ml-auto flex items-center gap-2">
        {count != null && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t("integrations.exchange.orgsecurity.count", "{{count}} items", {
              count,
            })}
          </span>
        )}
        <button onClick={onRefresh} className={btnCls} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.exchange.orgsecurity.actions.refresh", "Refresh")}
        </button>
        {onNew && (
          <button onClick={onNew} className={primaryBtnCls}>
            <Plus size={12} />
            {newLabel ??
              t("integrations.exchange.orgsecurity.actions.new", "New")}
          </button>
        )}
      </div>
    </div>
  );
};

interface RowUi {
  drawer: { title: string; data: ExJson } | null;
  editor: {
    title: string;
    hint?: string;
    submitLabel: string;
    initial: ExPayload;
    submit: (data: ExPayload) => void | Promise<void>;
  } | null;
}

const EMPTY_UI: RowUi = { drawer: null, editor: null };

interface TableRow {
  id: string;
  cells: string[];
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  extra?: Array<{ label: string; onClick: () => void }>;
}

const DataTable: React.FC<{ columns: string[]; rows: TableRow[] }> = ({
  columns,
  rows,
}) => {
  const { t } = useTranslation();
  if (rows.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
        {t("integrations.exchange.orgsecurity.empty", "No records.")}
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-[var(--color-surface)]">
          <tr className="text-left text-xs text-[var(--color-textMuted)]">
            {columns.map((c) => (
              <th key={c} className="px-3 py-1.5 font-medium">
                {c}
              </th>
            ))}
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
            >
              {r.cells.map((cell, i) => (
                <td
                  key={i}
                  className="px-3 py-1.5 text-[var(--color-text)]"
                  onClick={r.onView}
                  role={r.onView ? "button" : undefined}
                >
                  {cell}
                </td>
              ))}
              <td className="px-3 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {r.extra?.map((x) => (
                    <button key={x.label} onClick={x.onClick} className={btnCls}>
                      {x.label}
                    </button>
                  ))}
                  {r.onEdit && (
                    <button onClick={r.onEdit} className={btnCls}>
                      {t(
                        "integrations.exchange.orgsecurity.actions.edit",
                        "Edit",
                      )}
                    </button>
                  )}
                  {r.onDelete && (
                    <button
                      onClick={r.onDelete}
                      className={btnCls}
                      title={t(
                        "integrations.exchange.orgsecurity.actions.delete",
                        "Delete",
                      )}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SectionLayout: React.FC<{
  ui: RowUi;
  setUi: React.Dispatch<React.SetStateAction<RowUi>>;
  error: string | null;
  children: React.ReactNode;
}> = ({ ui, setUi, error, children }) => (
  <div className="relative flex min-h-0 flex-1">
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p className="border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          {error}
        </p>
      )}
      {children}
    </div>
    {ui.drawer && (
      <JsonDrawer
        title={ui.drawer.title}
        data={ui.drawer.data}
        onClose={() => setUi((s) => ({ ...s, drawer: null }))}
      />
    )}
    {ui.editor && (
      <JsonEditorModal
        title={ui.editor.title}
        hint={ui.editor.hint}
        submitLabel={ui.editor.submitLabel}
        initial={ui.editor.initial}
        onSubmit={ui.editor.submit}
        onClose={() => setUi((s) => ({ ...s, editor: null }))}
      />
    )}
  </div>
);

/** Local sub-tab bar used inside sections that expose several command families. */
const SubTabs = <K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: K; label: string }>;
  active: K;
  onChange: (k: K) => void;
}) => (
  <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1">
    {tabs.map((st) => (
      <button
        key={st.key}
        onClick={() => onChange(st.key)}
        className={`border-b-2 px-2 py-1 text-xs ${
          active === st.key
            ? "border-primary text-[var(--color-text)]"
            : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        }`}
      >
        {st.label}
      </button>
    ))}
  </div>
);

// ─── Retention & Holds ─────────────────────────────────────────────────────────

type RetentionSub = "policies" | "tags" | "dlp" | "holds";

const RetentionSection: React.FC<{ os: OrgSec }> = ({ os }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = os;
  const [sub, setSub] = useState<RetentionSub>("policies");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [holdIdentity, setHoldIdentity] = useState("");
  const [ui, setUi] = useState<RowUi>(EMPTY_UI);

  const loadList = useCallback(async () => {
    const res = await run(() => {
      switch (sub) {
        case "tags":
          return api.listRetentionTags() as unknown as Promise<Array<Record<string, unknown>>>;
        case "dlp":
          return api.listDlpPolicies() as unknown as Promise<Array<Record<string, unknown>>>;
        default:
          return api.listRetentionPolicies() as unknown as Promise<Array<Record<string, unknown>>>;
      }
    });
    if (res) setRows(res);
  }, [run, api, sub]);

  useEffect(() => {
    if (sub !== "holds") void loadList();
    else setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  const view = useCallback(
    async (which: RetentionSub, identity: string) => {
      const res = await run<unknown>(() => {
        if (which === "tags") return api.getRetentionTag(identity);
        if (which === "dlp") return api.getDlpPolicy(identity);
        return api.getRetentionPolicy(identity);
      });
      if (res) setUi((s) => ({ ...s, drawer: { title: identity, data: res } }));
    },
    [run, api],
  );

  const lookupHold = useCallback(async () => {
    if (!holdIdentity.trim()) return;
    const res = await run(() => api.getMailboxHold(holdIdentity.trim()));
    if (res)
      setUi((s) => ({ ...s, drawer: { title: holdIdentity.trim(), data: res } }));
  }, [run, api, holdIdentity]);

  const enableLitigation = useCallback(() => {
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.retention.enableLitigation",
          "Enable litigation hold",
        ),
        hint: t(
          "integrations.exchange.orgsecurity.retention.litigationHint",
          "Set identity; duration (e.g. 2555.00:00:00) and owner are optional.",
        ),
        submitLabel: t(
          "integrations.exchange.orgsecurity.actions.enable",
          "Enable",
        ),
        initial: {
          identity: holdIdentity.trim(),
          duration: null,
          owner: null,
        },
        submit: async (data) => {
          await run(() =>
            api.enableLitigationHold(
              String(data.identity ?? ""),
              (data.duration as string | null) ?? null,
              (data.owner as string | null) ?? null,
            ),
          );
          setUi((x) => ({ ...x, editor: null }));
        },
      },
    }));
  }, [run, api, t, holdIdentity]);

  const disableLitigation = useCallback(async () => {
    if (!holdIdentity.trim()) return;
    await run(() => api.disableLitigationHold(holdIdentity.trim()));
  }, [run, api, holdIdentity]);

  const subTabs: Array<{ key: RetentionSub; label: string }> = [
    {
      key: "policies",
      label: t(
        "integrations.exchange.orgsecurity.retention.policies",
        "Retention policies",
      ),
    },
    {
      key: "tags",
      label: t(
        "integrations.exchange.orgsecurity.retention.tags",
        "Retention tags",
      ),
    },
    {
      key: "dlp",
      label: t("integrations.exchange.orgsecurity.retention.dlp", "DLP policies"),
    },
    {
      key: "holds",
      label: t("integrations.exchange.orgsecurity.retention.holds", "Holds"),
    },
  ];

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SubTabs tabs={subTabs} active={sub} onChange={setSub} />
      {sub === "holds" ? (
        <>
          <SectionBar isLoading={isLoading} onRefresh={lookupHold}>
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.orgsecurity.retention.mailboxIdentity",
                "Mailbox identity",
              )}
              value={holdIdentity}
              onChange={(e) => setHoldIdentity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookupHold()}
            />
            <button onClick={lookupHold} className={btnCls}>
              {t("integrations.exchange.orgsecurity.actions.lookup", "Look up")}
            </button>
            <button onClick={enableLitigation} className={btnCls}>
              {t(
                "integrations.exchange.orgsecurity.retention.enableLitigation",
                "Enable litigation hold",
              )}
            </button>
            <button onClick={disableLitigation} className={btnCls}>
              {t(
                "integrations.exchange.orgsecurity.retention.disableLitigation",
                "Disable litigation hold",
              )}
            </button>
          </SectionBar>
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-textSecondary)]">
            {t(
              "integrations.exchange.orgsecurity.retention.holdsHint",
              "Enter a mailbox identity and look up its hold state.",
            )}
          </div>
        </>
      ) : sub === "tags" ? (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadList}
          />
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.name", "Name"),
              t("integrations.exchange.orgsecurity.fields.type", "Type"),
              t("integrations.exchange.orgsecurity.fields.ageDays", "Age (days)"),
              t("integrations.exchange.orgsecurity.fields.action", "Action"),
              t("integrations.exchange.orgsecurity.fields.enabled", "Enabled"),
            ]}
            rows={rows.map((r, i) => ({
              id: String(r.id ?? r.name ?? i),
              cells: [
                txt(r.name),
                txt(r.tagType),
                txt(r.ageLimitInDays),
                txt(r.retentionAction),
                txt(r.retentionEnabled),
              ],
              onView: () => view("tags", String(r.name ?? r.id ?? "")),
            }))}
          />
        </>
      ) : sub === "dlp" ? (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadList}
          />
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.name", "Name"),
              t("integrations.exchange.orgsecurity.fields.state", "State"),
              t("integrations.exchange.orgsecurity.fields.mode", "Mode"),
            ]}
            rows={rows.map((r, i) => ({
              id: String(r.id ?? r.name ?? i),
              cells: [txt(r.name), txt(r.state), txt(r.mode)],
              onView: () => view("dlp", String(r.name ?? r.id ?? "")),
            }))}
          />
        </>
      ) : (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadList}
          />
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.name", "Name"),
              t("integrations.exchange.orgsecurity.fields.default", "Default"),
              t("integrations.exchange.orgsecurity.fields.tagLinks", "Tag links"),
            ]}
            rows={rows.map((r, i) => ({
              id: String(r.id ?? r.name ?? i),
              cells: [
                txt(r.name),
                txt(r.isDefault),
                String(
                  (r.retentionPolicyTagLinks as unknown[] | undefined)?.length ??
                    0,
                ),
              ],
              onView: () => view("policies", String(r.name ?? r.id ?? "")),
            }))}
          />
        </>
      )}
    </SectionLayout>
  );
};

// ─── Journal Rules ─────────────────────────────────────────────────────────────

const JournalSection: React.FC<{ os: OrgSec }> = ({ os }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = os;
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [ui, setUi] = useState<RowUi>(EMPTY_UI);

  const load = useCallback(async () => {
    const res = await run(
      () =>
        api.listJournalRules() as unknown as Promise<Array<Record<string, unknown>>>,
    );
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useCallback(
    async (identity: string) => {
      const res = await run(() => api.getJournalRule(identity));
      if (res)
        setUi((s) => ({ ...s, drawer: { title: identity, data: res } }));
    },
    [run, api],
  );

  const remove = useCallback(
    async (identity: string) => {
      await run(() => api.removeJournalRule(identity));
      void load();
    },
    [run, api, load],
  );

  const setEnabled = useCallback(
    async (identity: string, enabled: boolean) => {
      await run(() =>
        enabled
          ? api.enableJournalRule(identity)
          : api.disableJournalRule(identity),
      );
      void load();
    },
    [run, api, load],
  );

  const openCreate = useCallback(() => {
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.journal.new",
          "New journal rule",
        ),
        submitLabel: t(
          "integrations.exchange.orgsecurity.actions.create",
          "Create",
        ),
        initial: {
          name: "",
          journalEmailAddress: "",
          scope: "global",
          recipient: null,
          enabled: true,
        },
        submit: async (data) => {
          await run(() =>
            api.createJournalRule({
              name: String(data.name ?? ""),
              journalEmailAddress: String(data.journalEmailAddress ?? ""),
              scope:
                (data.scope as "global" | "internal" | "external") ?? "global",
              recipient: (data.recipient as string | null) ?? null,
              enabled: Boolean(data.enabled),
            }),
          );
          setUi((x) => ({ ...x, editor: null }));
          void load();
        },
      },
    }));
  }, [run, api, t, load]);

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={openCreate}
      />
      <DataTable
        columns={[
          t("integrations.exchange.orgsecurity.fields.name", "Name"),
          t("integrations.exchange.orgsecurity.fields.journalEmail", "Journal to"),
          t("integrations.exchange.orgsecurity.fields.scope", "Scope"),
          t("integrations.exchange.orgsecurity.fields.enabled", "Enabled"),
        ]}
        rows={rows.map((r, i) => {
          const name = String(r.name ?? "");
          const enabled = Boolean(r.enabled);
          return {
            id: name || String(i),
            cells: [
              txt(r.name),
              txt(r.journalEmailAddress),
              txt(r.scope),
              txt(r.enabled),
            ],
            onView: () => view(name),
            onDelete: name ? () => remove(name) : undefined,
            extra: name
              ? [
                  {
                    label: enabled
                      ? t(
                          "integrations.exchange.orgsecurity.actions.disable",
                          "Disable",
                        )
                      : t(
                          "integrations.exchange.orgsecurity.actions.enable",
                          "Enable",
                        ),
                    onClick: () => setEnabled(name, !enabled),
                  },
                ]
              : undefined,
          };
        })}
      />
    </SectionLayout>
  );
};

// ─── RBAC & Audit ──────────────────────────────────────────────────────────────

type RbacSub =
  | "roleGroups"
  | "roles"
  | "assignments"
  | "adminAudit"
  | "mailboxAudit";

const RbacSection: React.FC<{ os: OrgSec }> = ({ os }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = os;
  const [sub, setSub] = useState<RbacSub>("roleGroups");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [ui, setUi] = useState<RowUi>(EMPTY_UI);
  // assignments filters
  const [role, setRole] = useState("");
  const [assignee, setAssignee] = useState("");
  // mailbox audit filters
  const [auditMailbox, setAuditMailbox] = useState("");

  const loadRoleGroups = useCallback(async () => {
    const res = await run(
      () => api.listRoleGroups() as unknown as Promise<Array<Record<string, unknown>>>,
    );
    if (res) setRows(res);
  }, [run, api]);

  const loadRoles = useCallback(async () => {
    const res = await run(
      () =>
        api.listManagementRoles() as unknown as Promise<Array<Record<string, unknown>>>,
    );
    if (res) setRows(res);
  }, [run, api]);

  const loadAssignments = useCallback(async () => {
    const res = await run(
      () =>
        api.listRoleAssignments(
          role.trim() || null,
          assignee.trim() || null,
        ) as unknown as Promise<Array<Record<string, unknown>>>,
    );
    if (res) setRows(res);
  }, [run, api, role, assignee]);

  useEffect(() => {
    setRows([]);
    if (sub === "roleGroups") void loadRoleGroups();
    else if (sub === "roles") void loadRoles();
    else if (sub === "assignments") void loadAssignments();
    // adminAudit / mailboxAudit load on explicit search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  const viewRoleGroup = useCallback(
    async (identity: string) => {
      const res = await run(() => api.getRoleGroup(identity));
      if (res)
        setUi((s) => ({ ...s, drawer: { title: identity, data: res } }));
    },
    [run, api],
  );

  const viewRole = useCallback(
    async (identity: string) => {
      const res = await run(() => api.getManagementRole(identity));
      if (res)
        setUi((s) => ({ ...s, drawer: { title: identity, data: res } }));
    },
    [run, api],
  );

  const memberAction = useCallback(
    (group: string, add: boolean) => {
      setUi((s) => ({
        ...s,
        editor: {
          title: add
            ? t(
                "integrations.exchange.orgsecurity.rbac.addMember",
                "Add role-group member",
              )
            : t(
                "integrations.exchange.orgsecurity.rbac.removeMember",
                "Remove role-group member",
              ),
          submitLabel: add
            ? t("integrations.exchange.orgsecurity.actions.add", "Add")
            : t("integrations.exchange.orgsecurity.actions.remove", "Remove"),
          initial: { group, member: "" },
          submit: async (data) => {
            const g = String(data.group ?? group);
            const m = String(data.member ?? "");
            await run(() =>
              add
                ? api.addRoleGroupMember(g, m)
                : api.removeRoleGroupMember(g, m),
            );
            setUi((x) => ({ ...x, editor: null }));
            void loadRoleGroups();
          },
        },
      }));
    },
    [run, api, t, loadRoleGroups],
  );

  const searchAdminAudit = useCallback(() => {
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.rbac.searchAdminAudit",
          "Search admin audit log",
        ),
        submitLabel: t(
          "integrations.exchange.orgsecurity.actions.search",
          "Search",
        ),
        initial: {
          cmdlets: null,
          objectIds: null,
          userIds: null,
          startDate: null,
          endDate: null,
          resultSize: 100,
        },
        submit: async (data) => {
          const res = await run(() =>
            api.searchAdminAuditLog({
              cmdlets: (data.cmdlets as string[] | null) ?? null,
              objectIds: (data.objectIds as string[] | null) ?? null,
              userIds: (data.userIds as string[] | null) ?? null,
              startDate: (data.startDate as string | null) ?? null,
              endDate: (data.endDate as string | null) ?? null,
              resultSize:
                typeof data.resultSize === "number"
                  ? data.resultSize
                  : undefined,
            }),
          );
          setUi((x) => ({ ...x, editor: null }));
          if (res) setRows(res as unknown as Array<Record<string, unknown>>);
        },
      },
    }));
  }, [run, api, t]);

  const adminAuditConfig = useCallback(async () => {
    const res = await run(() => api.getAdminAuditLogConfig());
    if (res !== undefined)
      setUi((s) => ({
        ...s,
        drawer: {
          title: t(
            "integrations.exchange.orgsecurity.rbac.adminAuditConfig",
            "Admin audit log config",
          ),
          data: res,
        },
      }));
  }, [run, api, t]);

  const searchMailboxAudit = useCallback(async () => {
    if (!auditMailbox.trim()) return;
    const res = await run(() =>
      api.searchMailboxAuditLog(auditMailbox.trim()),
    );
    if (res) setRows(res as unknown as Array<Record<string, unknown>>);
  }, [run, api, auditMailbox]);

  const setMailboxAudit = useCallback(
    async (enabled: boolean) => {
      if (!auditMailbox.trim()) return;
      await run(() =>
        enabled
          ? api.enableMailboxAudit(auditMailbox.trim())
          : api.disableMailboxAudit(auditMailbox.trim()),
      );
    },
    [run, api, auditMailbox],
  );

  const subTabs: Array<{ key: RbacSub; label: string }> = [
    {
      key: "roleGroups",
      label: t("integrations.exchange.orgsecurity.rbac.roleGroups", "Role groups"),
    },
    {
      key: "roles",
      label: t("integrations.exchange.orgsecurity.rbac.roles", "Roles"),
    },
    {
      key: "assignments",
      label: t(
        "integrations.exchange.orgsecurity.rbac.assignments",
        "Assignments",
      ),
    },
    {
      key: "adminAudit",
      label: t(
        "integrations.exchange.orgsecurity.rbac.adminAudit",
        "Admin audit",
      ),
    },
    {
      key: "mailboxAudit",
      label: t(
        "integrations.exchange.orgsecurity.rbac.mailboxAudit",
        "Mailbox audit",
      ),
    },
  ];

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SubTabs tabs={subTabs} active={sub} onChange={setSub} />

      {sub === "roleGroups" && (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadRoleGroups}
          />
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.name", "Name"),
              t("integrations.exchange.orgsecurity.fields.members", "Members"),
              t("integrations.exchange.orgsecurity.fields.roles", "Roles"),
            ]}
            rows={rows.map((r, i) => {
              const name = String(r.name ?? "");
              return {
                id: name || String(i),
                cells: [
                  txt(r.name),
                  String((r.members as unknown[] | undefined)?.length ?? 0),
                  String((r.roles as unknown[] | undefined)?.length ?? 0),
                ],
                onView: () => viewRoleGroup(name),
                extra: name
                  ? [
                      {
                        label: t(
                          "integrations.exchange.orgsecurity.actions.add",
                          "Add",
                        ),
                        onClick: () => memberAction(name, true),
                      },
                      {
                        label: t(
                          "integrations.exchange.orgsecurity.actions.remove",
                          "Remove",
                        ),
                        onClick: () => memberAction(name, false),
                      },
                    ]
                  : undefined,
              };
            })}
          />
        </>
      )}

      {sub === "roles" && (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadRoles}
          />
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.name", "Name"),
              t("integrations.exchange.orgsecurity.fields.roleType", "Type"),
              t("integrations.exchange.orgsecurity.fields.parent", "Parent"),
            ]}
            rows={rows.map((r, i) => {
              const name = String(r.name ?? "");
              return {
                id: name || String(i),
                cells: [txt(r.name), txt(r.roleType), txt(r.parent)],
                onView: () => viewRole(name),
              };
            })}
          />
        </>
      )}

      {sub === "assignments" && (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadAssignments}
          >
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.orgsecurity.rbac.roleFilter",
                "Role",
              )}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadAssignments()}
            />
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.orgsecurity.rbac.assigneeFilter",
                "Assignee",
              )}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadAssignments()}
            />
            <button onClick={loadAssignments} className={btnCls}>
              {t("integrations.exchange.orgsecurity.actions.apply", "Apply")}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.name", "Name"),
              t("integrations.exchange.orgsecurity.fields.role", "Role"),
              t("integrations.exchange.orgsecurity.fields.assignee", "Assignee"),
              t("integrations.exchange.orgsecurity.fields.enabled", "Enabled"),
            ]}
            rows={rows.map((r, i) => ({
              id: String(r.name ?? i),
              cells: [
                txt(r.name),
                txt(r.role),
                txt(r.roleAssignee),
                txt(r.enabled),
              ],
              onView: () =>
                setUi((s) => ({
                  ...s,
                  drawer: { title: String(r.name ?? ""), data: r },
                })),
            }))}
          />
        </>
      )}

      {sub === "adminAudit" && (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={searchAdminAudit}
          >
            <button onClick={searchAdminAudit} className={primaryBtnCls}>
              {t("integrations.exchange.orgsecurity.actions.search", "Search")}
            </button>
            <button onClick={adminAuditConfig} className={btnCls}>
              {t(
                "integrations.exchange.orgsecurity.rbac.adminAuditConfig",
                "Config",
              )}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.cmdlet", "Cmdlet"),
              t("integrations.exchange.orgsecurity.fields.object", "Object"),
              t("integrations.exchange.orgsecurity.fields.caller", "Caller"),
              t("integrations.exchange.orgsecurity.fields.succeeded", "OK"),
            ]}
            rows={rows.map((r, i) => ({
              id: String(i),
              cells: [
                txt(r.cmdletName),
                txt(r.objectModified),
                txt(r.caller),
                txt(r.succeeded),
              ],
              onView: () =>
                setUi((s) => ({
                  ...s,
                  drawer: { title: String(r.cmdletName ?? "Entry"), data: r },
                })),
            }))}
          />
        </>
      )}

      {sub === "mailboxAudit" && (
        <>
          <SectionBar
            isLoading={isLoading}
            onRefresh={searchMailboxAudit}
            count={rows.length}
          >
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.orgsecurity.rbac.mailbox",
                "Mailbox",
              )}
              value={auditMailbox}
              onChange={(e) => setAuditMailbox(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchMailboxAudit()}
            />
            <button onClick={searchMailboxAudit} className={primaryBtnCls}>
              {t("integrations.exchange.orgsecurity.actions.search", "Search")}
            </button>
            <button onClick={() => setMailboxAudit(true)} className={btnCls}>
              {t("integrations.exchange.orgsecurity.rbac.enableAudit", "Enable audit")}
            </button>
            <button onClick={() => setMailboxAudit(false)} className={btnCls}>
              {t(
                "integrations.exchange.orgsecurity.rbac.disableAudit",
                "Disable audit",
              )}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.operation", "Operation"),
              t("integrations.exchange.orgsecurity.fields.owner", "Owner"),
              t("integrations.exchange.orgsecurity.fields.loggedBy", "Logged by"),
              t("integrations.exchange.orgsecurity.fields.subject", "Subject"),
            ]}
            rows={rows.map((r, i) => ({
              id: String(i),
              cells: [
                txt(r.operation),
                txt(r.mailboxOwner),
                txt(r.loggedBy),
                txt(r.itemSubject),
              ],
              onView: () =>
                setUi((s) => ({
                  ...s,
                  drawer: { title: String(r.operation ?? "Entry"), data: r },
                })),
            }))}
          />
        </>
      )}
    </SectionLayout>
  );
};

// ─── Organization config ───────────────────────────────────────────────────────

const OrganizationSection: React.FC<{ os: OrgSec }> = ({ os }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = os;
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [ui, setUi] = useState<RowUi>(EMPTY_UI);

  const load = useCallback(async () => {
    const res = await run(
      () =>
        api.getOrganizationConfig() as unknown as Promise<Record<string, unknown>>,
    );
    if (res) setConfig(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = useCallback(() => {
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.org.edit",
          "Set organization config",
        ),
        hint: t(
          "integrations.exchange.orgsecurity.org.editHint",
          "Provide only the parameters to change (camelCase keys).",
        ),
        submitLabel: t("integrations.exchange.orgsecurity.actions.save", "Save"),
        initial: {},
        submit: async (data) => {
          await run(() => api.setOrganizationConfig(data));
          setUi((x) => ({ ...x, editor: null }));
          void load();
        },
      },
    }));
  }, [run, api, t, load]);

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar isLoading={isLoading} onRefresh={load}>
        <button onClick={openEdit} className={primaryBtnCls}>
          {t("integrations.exchange.orgsecurity.org.edit", "Set config")}
        </button>
      </SectionBar>
      {config ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {Object.entries(config).map(([k, v]) => (
                <tr
                  key={k}
                  className="border-t border-[var(--color-border)] align-top"
                >
                  <td className="px-3 py-1.5 font-medium text-[var(--color-textSecondary)]">
                    {k}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--color-text)]">
                    {typeof v === "object" && v !== null
                      ? JSON.stringify(v)
                      : txt(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
          {t("integrations.exchange.orgsecurity.empty", "No records.")}
        </div>
      )}
    </SectionLayout>
  );
};

// ─── Hygiene & Quarantine ──────────────────────────────────────────────────────

type HygieneSub = "content" | "connection" | "sender" | "quarantine";

const HygieneSection: React.FC<{ os: OrgSec }> = ({ os }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = os;
  const [sub, setSub] = useState<HygieneSub>("content");
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [pageSize, setPageSize] = useState("");
  const [qType, setQType] = useState("");
  const [ui, setUi] = useState<RowUi>(EMPTY_UI);

  const loadFilter = useCallback(async () => {
    const res = await run(() => {
      if (sub === "connection")
        return api.getConnectionFilterConfig() as unknown as Promise<
          Record<string, unknown>
        >;
      if (sub === "sender")
        return api.getSenderFilterConfig() as unknown as Promise<Record<string, unknown>>;
      return api.getContentFilterConfig() as unknown as Promise<Record<string, unknown>>;
    });
    if (res) setConfig(res);
  }, [run, api, sub]);

  const loadQuarantine = useCallback(async () => {
    const ps = pageSize.trim() ? Number(pageSize.trim()) : null;
    const res = await run(
      () =>
        api.listQuarantineMessages(
          Number.isFinite(ps as number) ? ps : null,
          qType.trim() || null,
        ) as unknown as Promise<Array<Record<string, unknown>>>,
    );
    if (res) setRows(res);
  }, [run, api, pageSize, qType]);

  useEffect(() => {
    setConfig(null);
    setRows([]);
    if (sub === "quarantine") void loadQuarantine();
    else void loadFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  const openSetFilter = useCallback(() => {
    const which = sub;
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.hygiene.setFilter",
          "Set filter config",
        ),
        hint: t(
          "integrations.exchange.orgsecurity.hygiene.setFilterHint",
          "Provide only the parameters to change (camelCase keys).",
        ),
        submitLabel: t("integrations.exchange.orgsecurity.actions.save", "Save"),
        initial: {},
        submit: async (data) => {
          await run(() => {
            if (which === "connection")
              return api.setConnectionFilterConfig(data);
            if (which === "sender") return api.setSenderFilterConfig(data);
            return api.setContentFilterConfig(data);
          });
          setUi((x) => ({ ...x, editor: null }));
          void loadFilter();
        },
      },
    }));
  }, [run, api, t, sub, loadFilter]);

  const viewQuarantine = useCallback(
    async (identity: string) => {
      const res = await run(() => api.getQuarantineMessage(identity));
      if (res)
        setUi((s) => ({ ...s, drawer: { title: identity, data: res } }));
    },
    [run, api],
  );

  const release = useCallback(
    (identity: string) => {
      setUi((s) => ({
        ...s,
        editor: {
          title: t(
            "integrations.exchange.orgsecurity.hygiene.release",
            "Release quarantine message",
          ),
          submitLabel: t(
            "integrations.exchange.orgsecurity.hygiene.release",
            "Release",
          ),
          initial: { identity, releaseToAll: false },
          submit: async (data) => {
            await run(() =>
              api.releaseQuarantineMessage(
                String(data.identity ?? identity),
                Boolean(data.releaseToAll),
              ),
            );
            setUi((x) => ({ ...x, editor: null }));
            void loadQuarantine();
          },
        },
      }));
    },
    [run, api, t, loadQuarantine],
  );

  const remove = useCallback(
    async (identity: string) => {
      await run(() => api.deleteQuarantineMessage(identity));
      void loadQuarantine();
    },
    [run, api, loadQuarantine],
  );

  const subTabs: Array<{ key: HygieneSub; label: string }> = [
    {
      key: "content",
      label: t(
        "integrations.exchange.orgsecurity.hygiene.content",
        "Content filter",
      ),
    },
    {
      key: "connection",
      label: t(
        "integrations.exchange.orgsecurity.hygiene.connection",
        "Connection filter",
      ),
    },
    {
      key: "sender",
      label: t(
        "integrations.exchange.orgsecurity.hygiene.sender",
        "Sender filter",
      ),
    },
    {
      key: "quarantine",
      label: t(
        "integrations.exchange.orgsecurity.hygiene.quarantine",
        "Quarantine",
      ),
    },
  ];

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SubTabs tabs={subTabs} active={sub} onChange={setSub} />
      {sub === "quarantine" ? (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadQuarantine}
          >
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder={t(
                "integrations.exchange.orgsecurity.hygiene.pageSize",
                "Page size",
              )}
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadQuarantine()}
            />
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.orgsecurity.hygiene.type",
                "Type",
              )}
              value={qType}
              onChange={(e) => setQType(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadQuarantine()}
            />
            <button onClick={loadQuarantine} className={btnCls}>
              {t("integrations.exchange.orgsecurity.actions.apply", "Apply")}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t("integrations.exchange.orgsecurity.fields.subject", "Subject"),
              t("integrations.exchange.orgsecurity.fields.sender", "Sender"),
              t("integrations.exchange.orgsecurity.fields.reason", "Reason"),
              t("integrations.exchange.orgsecurity.fields.direction", "Direction"),
            ]}
            rows={rows.map((r, i) => {
              const identity = String(r.identity ?? "");
              return {
                id: identity || String(i),
                cells: [
                  txt(r.subject),
                  txt(r.sender),
                  txt(r.quarantineReason),
                  txt(r.direction),
                ],
                onView: identity ? () => viewQuarantine(identity) : undefined,
                onDelete: identity ? () => remove(identity) : undefined,
                extra: identity
                  ? [
                      {
                        label: t(
                          "integrations.exchange.orgsecurity.hygiene.release",
                          "Release",
                        ),
                        onClick: () => release(identity),
                      },
                    ]
                  : undefined,
              };
            })}
          />
        </>
      ) : (
        <>
          <SectionBar isLoading={isLoading} onRefresh={loadFilter}>
            <button onClick={openSetFilter} className={primaryBtnCls}>
              {t(
                "integrations.exchange.orgsecurity.hygiene.setFilter",
                "Set config",
              )}
            </button>
          </SectionBar>
          {config ? (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {Object.entries(config).map(([k, v]) => (
                    <tr
                      key={k}
                      className="border-t border-[var(--color-border)] align-top"
                    >
                      <td className="px-3 py-1.5 font-medium text-[var(--color-textSecondary)]">
                        {k}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-text)]">
                        {typeof v === "object" && v !== null
                          ? JSON.stringify(v)
                          : txt(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
              {t("integrations.exchange.orgsecurity.empty", "No records.")}
            </div>
          )}
        </>
      )}
    </SectionLayout>
  );
};

// ─── Certificates ──────────────────────────────────────────────────────────────

const CertificatesSection: React.FC<{ os: OrgSec }> = ({ os }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = os;
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [server, setServer] = useState("");
  const [ui, setUi] = useState<RowUi>(EMPTY_UI);

  const load = useCallback(async () => {
    const res = await run(
      () =>
        api.listCertificates(server.trim() || null) as unknown as Promise<Array<Record<string, unknown>>>,
    );
    if (res) setRows(res);
  }, [run, api, server]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = useCallback(
    async (thumbprint: string) => {
      const res = await run(() =>
        api.getCertificate(thumbprint, server.trim() || null),
      );
      if (res)
        setUi((s) => ({ ...s, drawer: { title: thumbprint, data: res } }));
    },
    [run, api, server],
  );

  const enable = useCallback(
    (thumbprint: string) => {
      setUi((s) => ({
        ...s,
        editor: {
          title: t(
            "integrations.exchange.orgsecurity.certs.enable",
            "Enable certificate",
          ),
          hint: t(
            "integrations.exchange.orgsecurity.certs.enableHint",
            "Services is a comma-separated list, e.g. IIS,SMTP.",
          ),
          submitLabel: t(
            "integrations.exchange.orgsecurity.actions.enable",
            "Enable",
          ),
          initial: { thumbprint, services: "IIS,SMTP", server: server.trim() || null },
          submit: async (data) => {
            await run(() =>
              api.enableCertificate(
                String(data.thumbprint ?? thumbprint),
                String(data.services ?? ""),
                (data.server as string | null) ?? null,
              ),
            );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, t, server, load],
  );

  const remove = useCallback(
    async (thumbprint: string) => {
      await run(() => api.removeCertificate(thumbprint, server.trim() || null));
      void load();
    },
    [run, api, server, load],
  );

  const importCert = useCallback(() => {
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.certs.import",
          "Import certificate",
        ),
        submitLabel: t(
          "integrations.exchange.orgsecurity.certs.import",
          "Import",
        ),
        initial: { filePath: "", password: null, server: server.trim() || null },
        submit: async (data) => {
          await run(() =>
            api.importCertificate(
              String(data.filePath ?? ""),
              (data.password as string | null) ?? null,
              (data.server as string | null) ?? null,
            ),
          );
          setUi((x) => ({ ...x, editor: null }));
          void load();
        },
      },
    }));
  }, [run, api, t, server, load]);

  const newRequest = useCallback(() => {
    setUi((s) => ({
      ...s,
      editor: {
        title: t(
          "integrations.exchange.orgsecurity.certs.newRequest",
          "New certificate request",
        ),
        hint: t(
          "integrations.exchange.orgsecurity.certs.newRequestHint",
          "domainNames is an array of subject-alternative names.",
        ),
        submitLabel: t(
          "integrations.exchange.orgsecurity.actions.create",
          "Create",
        ),
        initial: {
          subjectName: "",
          domainNames: [],
          server: server.trim() || null,
        },
        submit: async (data) => {
          const res = await run(() =>
            api.newCertificateRequest(
              String(data.subjectName ?? ""),
              (data.domainNames as string[] | undefined) ?? [],
              (data.server as string | null) ?? null,
            ),
          );
          setUi((x) => ({ ...x, editor: null }));
          if (res)
            setUi((x) => ({
              ...x,
              drawer: {
                title: t(
                  "integrations.exchange.orgsecurity.certs.csr",
                  "Certificate request",
                ),
                data: res,
              },
            }));
        },
      },
    }));
  }, [run, api, t, server]);

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={newRequest}
        newLabel={t(
          "integrations.exchange.orgsecurity.certs.newRequest",
          "New request",
        )}
      >
        <input
          className={inputCls}
          placeholder={t(
            "integrations.exchange.orgsecurity.certs.server",
            "Server",
          )}
          value={server}
          onChange={(e) => setServer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t("integrations.exchange.orgsecurity.actions.apply", "Apply")}
        </button>
        <button onClick={importCert} className={btnCls}>
          {t("integrations.exchange.orgsecurity.certs.import", "Import")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t("integrations.exchange.orgsecurity.fields.thumbprint", "Thumbprint"),
          t("integrations.exchange.orgsecurity.fields.subject", "Subject"),
          t("integrations.exchange.orgsecurity.fields.services", "Services"),
          t("integrations.exchange.orgsecurity.fields.valid", "Valid"),
        ]}
        rows={rows.map((r, i) => {
          const thumb = String(r.thumbprint ?? "");
          return {
            id: thumb || String(i),
            cells: [
              txt(r.thumbprint),
              txt(r.subject),
              ((r.services as string[] | undefined) ?? []).join(", ") || "—",
              txt(r.isValid),
            ],
            onView: thumb ? () => view(thumb) : undefined,
            onDelete: thumb ? () => remove(thumb) : undefined,
            extra: thumb
              ? [
                  {
                    label: t(
                      "integrations.exchange.orgsecurity.actions.enable",
                      "Enable",
                    ),
                    onClick: () => enable(thumb),
                  },
                ]
              : undefined,
          };
        })}
      />
    </SectionLayout>
  );
};

// ─── Root tab ──────────────────────────────────────────────────────────────────

type GroupKey =
  | "retention"
  | "journal"
  | "rbac"
  | "organization"
  | "hygiene"
  | "certificates";

const GROUPS: Array<{ key: GroupKey; icon: typeof BookLock }> = [
  { key: "retention", icon: BookLock },
  { key: "journal", icon: ScrollText },
  { key: "rbac", icon: Users },
  { key: "organization", icon: Building2 },
  { key: "hygiene", icon: ShieldCheck },
  { key: "certificates", icon: Award },
];

const ExchangeOrgSecurityTab: React.FC<ExchangeTabProps> = () => {
  const { t } = useTranslation();
  const os = useExchangeOrgSecurity();
  const [group, setGroup] = useState<GroupKey>("retention");

  const label: Record<GroupKey, string> = {
    retention: t(
      "integrations.exchange.orgsecurity.groups.retention",
      "Retention & Holds",
    ),
    journal: t(
      "integrations.exchange.orgsecurity.groups.journal",
      "Journal Rules",
    ),
    rbac: t("integrations.exchange.orgsecurity.groups.rbac", "RBAC & Audit"),
    organization: t(
      "integrations.exchange.orgsecurity.groups.organization",
      "Organization",
    ),
    hygiene: t(
      "integrations.exchange.orgsecurity.groups.hygiene",
      "Hygiene & Quarantine",
    ),
    certificates: t(
      "integrations.exchange.orgsecurity.groups.certificates",
      "Certificates",
    ),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3">
        {GROUPS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setGroup(key)}
            className={`flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              group === key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon size={14} />
            {label[key]}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {group === "retention" && <RetentionSection os={os} />}
        {group === "journal" && <JournalSection os={os} />}
        {group === "rbac" && <RbacSection os={os} />}
        {group === "organization" && <OrganizationSection os={os} />}
        {group === "hygiene" && <HygieneSection os={os} />}
        {group === "certificates" && <CertificatesSection os={os} />}
      </div>
    </div>
  );
};

export default ExchangeOrgSecurityTab;
