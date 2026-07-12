// Jira "Issues, Users & Fields" tab (t42-jira-c1).
//
// The issue-tracking surface: Issues, Comments, Attachments, Worklogs, Users and
// Fields. Binds all 36 c1 `jira_*` commands through `useJiraIssues` /
// `jiraIssuesApi`. A category tab per the shell contract — mounted only once the
// shell holds a live connection, so `connectionId` is always usable. Issue-scoped
// sections (Comments/Attachments/Worklogs) read a shared issue key held at the tab
// level; the Issues section can set it by selecting a row.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Hash,
  Layers,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { JiraTabProps } from "./registry";
import type {
  JiraIssue,
  JiraTransition,
  JiraUser,
} from "../../../types/jira";
import type {
  JiraAttachment,
  JiraComment,
  JiraField,
  JiraWorklog,
} from "../../../types/jira/issues";
import { useJiraIssues } from "../../../hooks/integration/jira/useJiraIssues";

// ─── Shared primitives ─────────────────────────────────────────────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-60";
const primaryBtnCls =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

const tk = (key: string) => `integrations.jira.issues.${key}`;

type Ctx = ReturnType<typeof useJiraIssues>;

/** Side drawer showing a formatted JSON payload (issue detail, changelog,
 *  watchers, current user, a fetched comment/worklog/attachment …). */
const JsonDrawer: React.FC<{
  title: string;
  data: unknown;
  onClose: () => void;
}> = ({ title, data, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {title}
        </span>
        <button onClick={onClose} className={btnCls} title={t(tk("close"), "Close")}>
          <X size={14} />
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-[var(--color-textSecondary)]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

// ─── Form modal ─────────────────────────────────────────────────────────────────

type FieldType = "text" | "textarea" | "password" | "number" | "checkbox" | "select";

interface FieldSpec {
  key: string;
  label: string;
  type?: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | boolean;
}

type FormValues = Record<string, string | boolean>;

/** Small labelled-input form modal. Produces a flat `FormValues` record the
 *  caller shapes into a typed request. Numeric fields come back as strings and
 *  are parsed at the call site. */
const FormModal: React.FC<{
  title: string;
  fields: FieldSpec[];
  submitLabel: string;
  onSubmit: (values: FormValues) => void | Promise<void>;
  onClose: () => void;
}> = ({ title, fields, submitLabel, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<FormValues>(() => {
    const init: FormValues = {};
    for (const f of fields) {
      init[f.key] =
        f.defaultValue ??
        (f.type === "checkbox"
          ? false
          : f.type === "select"
            ? (f.options?.[0]?.value ?? "")
            : "");
    }
    return init;
  });
  const [busy, setBusy] = useState(false);

  const set = useCallback(
    (key: string, v: string | boolean) =>
      setValues((prev) => ({ ...prev, [key]: v })),
    [],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  }, [values, onSubmit]);

  const canSubmit = fields.every(
    (f) =>
      !f.required ||
      (typeof values[f.key] === "string" &&
        (values[f.key] as string).trim() !== ""),
  );

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-full w-full max-w-md flex-col rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {title}
          </span>
          <button onClick={onClose} className={btnCls}>
            <X size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {fields.map((f) =>
            f.type === "checkbox" ? (
              <label
                key={f.key}
                className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]"
              >
                <input
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
                {f.label}
              </label>
            ) : (
              <label
                key={f.key}
                className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]"
              >
                {f.label}
                {f.type === "select" ? (
                  <select
                    className={inputCls}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    className={`${inputCls} min-h-[5rem] font-mono`}
                    placeholder={f.placeholder}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    type={f.type === "password" ? "password" : "text"}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </label>
            ),
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <button onClick={onClose} className={btnCls} disabled={busy}>
            {t(tk("cancel"), "Cancel")}
          </button>
          <button
            onClick={submit}
            className={primaryBtnCls}
            disabled={busy || !canSubmit}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Section chrome ──────────────────────────────────────────────────────────────

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
            {t(tk("count"), "{{count}} items", { count })}
          </span>
        )}
        <button onClick={onRefresh} className={btnCls} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t(tk("refresh"), "Refresh")}
        </button>
        {onNew && (
          <button onClick={onNew} className={primaryBtnCls}>
            <Plus size={12} />
            {newLabel ?? t(tk("new"), "New")}
          </button>
        )}
      </div>
    </div>
  );
};

interface TableRow {
  id: string;
  cells: string[];
  onDelete?: () => void;
  deleteTitle?: string;
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
        {t(tk("empty"), "No records.")}
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
                <td key={i} className="px-3 py-1.5 text-[var(--color-text)]">
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
                  {r.onDelete && (
                    <button
                      onClick={r.onDelete}
                      className={btnCls}
                      title={r.deleteTitle ?? t(tk("delete"), "Delete")}
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

interface Overlay {
  drawer: { title: string; data: unknown } | null;
  modal: React.ReactNode | null;
}

const SectionLayout: React.FC<{
  overlay: Overlay;
  setOverlay: React.Dispatch<React.SetStateAction<Overlay>>;
  error: string | null;
  children: React.ReactNode;
}> = ({ overlay, setOverlay, error, children }) => (
  <div className="relative flex min-h-0 flex-1">
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p className="border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          {error}
        </p>
      )}
      {children}
    </div>
    {overlay.modal}
    {overlay.drawer && (
      <JsonDrawer
        title={overlay.drawer.title}
        data={overlay.drawer.data}
        onClose={() => setOverlay((s) => ({ ...s, drawer: null }))}
      />
    )}
  </div>
);

/** Guard rendered by issue-scoped sections when no issue key is entered yet. */
const NoIssue: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-textSecondary)]">
      {t(tk("selectIssueHint"), "Enter an issue key above to manage it.")}
    </div>
  );
};

function useOverlay() {
  const [overlay, setOverlay] = useState<Overlay>({ drawer: null, modal: null });
  const closeModal = useCallback(
    () => setOverlay((s) => ({ ...s, modal: null })),
    [],
  );
  const openDrawer = useCallback(
    (title: string, data: unknown) =>
      setOverlay((s) => ({ ...s, drawer: { title, data } })),
    [],
  );
  return { overlay, setOverlay, closeModal, openDrawer };
}

const str = (v: string | boolean): string => String(v).trim();
const optStr = (v: string | boolean): string | undefined =>
  str(v) === "" ? undefined : str(v);
const num = (v: string | boolean): number | undefined => {
  const n = Number(String(v).trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n : undefined;
};

/** Parse an optional JSON blob from a textarea into a field/update map. */
const parseJson = (v: string | boolean): Record<string, unknown> | undefined => {
  const s = str(v);
  if (s === "") return undefined;
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const userLabel = (u: JiraUser | null | undefined): string =>
  u?.displayName ?? u?.name ?? u?.accountId ?? u?.emailAddress ?? "—";

// ─── Issues ──────────────────────────────────────────────────────────────────────

const IssuesSection: React.FC<{
  ctx: Ctx;
  issueKey: string;
  setIssueKey: (k: string) => void;
}> = ({ ctx, issueKey, setIssueKey }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = ctx;
  const [jql, setJql] = useState("order by updated DESC");
  const [rows, setRows] = useState<JiraIssue[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const search = useCallback(async () => {
    const res = await run((id) =>
      api.searchIssues(id, { jql: jql.trim(), maxResults: 50 }),
    );
    if (res) setRows(res.issues);
  }, [run, api, jql]);

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newIssue = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.newIssue"), "Create issue")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            {
              key: "project",
              label: t(tk("issues.projectKey"), "Project key"),
              required: true,
              placeholder: "PROJ",
            },
            {
              key: "issuetype",
              label: t(tk("issues.issueType"), "Issue type"),
              required: true,
              defaultValue: "Task",
            },
            {
              key: "summary",
              label: t(tk("issues.summary"), "Summary"),
              required: true,
            },
            {
              key: "description",
              label: t(tk("issues.description"), "Description"),
              type: "textarea",
            },
          ]}
          onSubmit={async (v) => {
            const res = await run((id) =>
              api.createIssue(id, {
                fields: {
                  project: { key: str(v.project) },
                  issuetype: { name: str(v.issuetype) },
                  summary: str(v.summary),
                  ...(optStr(v.description)
                    ? { description: str(v.description) }
                    : {}),
                },
              }),
            );
            closeModal();
            if (res?.key) setIssueKey(res.key);
            void search();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const bulkCreate = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.bulkCreate"), "Bulk create issues")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            {
              key: "json",
              label: t(
                tk("issues.bulkJson"),
                'issueUpdates JSON — [{ "fields": { … } }]',
              ),
              type: "textarea",
              required: true,
              defaultValue:
                '[{ "fields": { "project": { "key": "PROJ" }, "issuetype": { "name": "Task" }, "summary": "Example" } }]',
            },
          ]}
          onSubmit={async (v) => {
            let list: Array<{ fields: Record<string, unknown> }> = [];
            try {
              const parsed = JSON.parse(str(v.json));
              if (Array.isArray(parsed)) list = parsed;
            } catch {
              ctx.setError(t(tk("issues.badJson"), "Invalid JSON payload."));
              return;
            }
            const res = await run((id) =>
              api.bulkCreateIssues(id, { issueUpdates: list }),
            );
            closeModal();
            if (res) openDrawer(t(tk("issues.bulkResult"), "Bulk create result"), res);
            void search();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const editIssue = (key: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.editIssue"), "Edit issue")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            { key: "summary", label: t(tk("issues.summary"), "Summary") },
            {
              key: "description",
              label: t(tk("issues.description"), "Description"),
              type: "textarea",
            },
            {
              key: "fields",
              label: t(tk("issues.rawFields"), "Extra fields JSON (optional)"),
              type: "textarea",
            },
          ]}
          onSubmit={async (v) => {
            const fields: Record<string, unknown> = {
              ...(parseJson(v.fields) ?? {}),
            };
            if (optStr(v.summary)) fields.summary = str(v.summary);
            if (optStr(v.description)) fields.description = str(v.description);
            await run((id) => api.updateIssue(id, key, { fields }));
            closeModal();
            void search();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const deleteIssue = (key: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.deleteIssue"), "Delete issue")}
          submitLabel={t(tk("delete"), "Delete")}
          fields={[
            {
              key: "deleteSubtasks",
              label: t(tk("issues.deleteSubtasks"), "Also delete subtasks"),
              type: "checkbox",
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.deleteIssue(id, key, Boolean(v.deleteSubtasks)),
            );
            closeModal();
            void search();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const assign = (key: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.assign"), "Assign issue")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            {
              key: "accountId",
              label: t(tk("issues.accountId"), "Account id (blank = unassign)"),
            },
          ]}
          onSubmit={async (v) => {
            await run((id) => api.assignIssue(id, key, optStr(v.accountId)));
            closeModal();
            void search();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const link = (key: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.link"), "Link issues")}
          submitLabel={t(tk("issues.linkAction"), "Link")}
          fields={[
            {
              key: "linkType",
              label: t(tk("issues.linkType"), "Link type"),
              required: true,
              defaultValue: "Relates",
            },
            {
              key: "inwardKey",
              label: t(tk("issues.inwardKey"), "Inward issue key"),
              required: true,
              defaultValue: key,
            },
            {
              key: "outwardKey",
              label: t(tk("issues.outwardKey"), "Outward issue key"),
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.linkIssues(
                id,
                str(v.linkType),
                str(v.inwardKey),
                str(v.outwardKey),
              ),
            );
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const transitions = useCallback(
    async (key: string) => {
      const list = await run((id) => api.getTransitions(id, key));
      if (!list) return;
      setOverlay((s) => ({
        ...s,
        modal: (
          <FormModal
            title={t(tk("issues.transition"), "Transition issue")}
            submitLabel={t(tk("issues.applyTransition"), "Apply")}
            fields={[
              {
                key: "transition",
                label: t(tk("issues.targetStatus"), "Target transition"),
                type: "select",
                options: list.map((tr: JiraTransition) => ({
                  value: tr.id,
                  label: tr.name ?? tr.id,
                })),
              },
            ]}
            onSubmit={async (v) => {
              await run((id) =>
                api.transitionIssue(id, key, {
                  transition: { id: str(v.transition) },
                }),
              );
              closeModal();
              void search();
            }}
            onClose={closeModal}
          />
        ),
      }));
    },
    [run, api, t, closeModal, search, setOverlay],
  );

  const watchers = useCallback(
    async (key: string) => {
      const list = await run((id) => api.getWatchers(id, key));
      if (list) openDrawer(t(tk("issues.watchers"), "Watchers"), list);
    },
    [run, api, openDrawer, t],
  );

  const addWatcher = (key: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("issues.addWatcher"), "Add watcher")}
          submitLabel={t(tk("issues.add"), "Add")}
          fields={[
            {
              key: "accountId",
              label: t(tk("issues.accountId"), "Account id"),
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) => api.addWatcher(id, key, str(v.accountId)));
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const view = useCallback(
    async (key: string) => {
      const res = await run((id) => api.getIssue(id, key, "renderedFields"));
      if (res) openDrawer(`${key}`, res);
    },
    [run, api, openDrawer],
  );

  const changelog = useCallback(
    async (key: string) => {
      const res = await run((id) => api.getIssueChangelog(id, key));
      if (res) openDrawer(t(tk("issues.changelog"), "Changelog"), res);
    },
    [run, api, openDrawer, t],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={search}
        onNew={newIssue}
        newLabel={t(tk("issues.newIssue"), "New issue")}
      >
        <input
          className={`${inputCls} w-80`}
          placeholder={t(tk("issues.jql"), "JQL")}
          value={jql}
          onChange={(e) => setJql(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button onClick={search} className={btnCls}>
          {t(tk("issues.searchAction"), "Search")}
        </button>
        <button onClick={bulkCreate} className={btnCls}>
          <Plus size={12} />
          {t(tk("issues.bulk"), "Bulk")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(tk("issues.key"), "Key"),
          t(tk("issues.summary"), "Summary"),
          t(tk("issues.status"), "Status"),
          t(tk("issues.assignee"), "Assignee"),
        ]}
        rows={rows.map((r) => {
          const f = r.fields as Record<string, any>;
          return {
            id: r.key || r.id,
            cells: [
              r.key,
              String(f?.summary ?? "—"),
              String(f?.status?.name ?? "—"),
              userLabel(f?.assignee),
            ],
            onDelete: () => deleteIssue(r.key),
            extra: [
              { label: t(tk("issues.select"), "Select"), onClick: () => setIssueKey(r.key) },
              { label: t(tk("view"), "View"), onClick: () => view(r.key) },
              { label: t(tk("edit"), "Edit"), onClick: () => editIssue(r.key) },
              {
                label: t(tk("issues.transition"), "Transition"),
                onClick: () => transitions(r.key),
              },
              { label: t(tk("issues.assign"), "Assign"), onClick: () => assign(r.key) },
              { label: t(tk("issues.link"), "Link"), onClick: () => link(r.key) },
              {
                label: t(tk("issues.changelog"), "Changelog"),
                onClick: () => changelog(r.key),
              },
              {
                label: t(tk("issues.watchers"), "Watchers"),
                onClick: () => watchers(r.key),
              },
              {
                label: t(tk("issues.addWatcher"), "Watch"),
                onClick: () => addWatcher(r.key),
              },
            ],
          };
        })}
      />
      {issueKey && (
        <p className="border-t border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-textMuted)]">
          {t(tk("issues.selected"), "Selected issue")}: {issueKey}
        </p>
      )}
    </SectionLayout>
  );
};

// ─── Comments ────────────────────────────────────────────────────────────────────

const CommentsSection: React.FC<{ ctx: Ctx; issueKey: string }> = ({
  ctx,
  issueKey,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = ctx;
  const [rows, setRows] = useState<JiraComment[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    if (!issueKey) return;
    const res = await run((id) => api.listComments(id, issueKey));
    if (res) setRows(res.comments);
  }, [run, api, issueKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("comments.add"), "Add comment")}
          submitLabel={t(tk("comments.post"), "Post")}
          fields={[
            {
              key: "body",
              label: t(tk("comments.body"), "Comment"),
              type: "textarea",
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) => api.addComment(id, issueKey, { body: str(v.body) }));
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const edit = (commentId: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("comments.edit"), "Edit comment")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            {
              key: "body",
              label: t(tk("comments.body"), "Comment"),
              type: "textarea",
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.updateComment(id, issueKey, commentId, { body: str(v.body) }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const view = useCallback(
    async (commentId: string) => {
      const res = await run((id) => api.getComment(id, issueKey, commentId));
      if (res) openDrawer(`${t(tk("comments.title"), "Comment")} ${commentId}`, res);
    },
    [run, api, issueKey, openDrawer, t],
  );

  const remove = useCallback(
    async (commentId: string) => {
      await run((id) => api.deleteComment(id, issueKey, commentId));
      void load();
    },
    [run, api, issueKey, load],
  );

  if (!issueKey) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoIssue />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={add}
        newLabel={t(tk("comments.add"), "Add comment")}
      />
      <DataTable
        columns={[
          t(tk("comments.author"), "Author"),
          t(tk("comments.created"), "Created"),
          t(tk("comments.bodyPreview"), "Body"),
        ]}
        rows={rows.map((r, i) => ({
          id: r.id ?? `c-${i}`,
          cells: [
            userLabel(r.author),
            r.created ?? "—",
            typeof r.body === "string"
              ? r.body.slice(0, 80)
              : JSON.stringify(r.body ?? "").slice(0, 80),
          ],
          onDelete: r.id ? () => remove(r.id!) : undefined,
          extra: r.id
            ? [
                { label: t(tk("view"), "View"), onClick: () => view(r.id!) },
                { label: t(tk("edit"), "Edit"), onClick: () => edit(r.id!) },
              ]
            : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Attachments ─────────────────────────────────────────────────────────────────

const AttachmentsSection: React.FC<{ ctx: Ctx; issueKey: string }> = ({
  ctx,
  issueKey,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = ctx;
  const [rows, setRows] = useState<JiraAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { overlay, setOverlay, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    if (!issueKey) return;
    const res = await run((id) => api.listAttachments(id, issueKey));
    if (res) setRows(res);
  }, [run, api, issueKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFile = useCallback(
    async (file: File) => {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
          // strip the "data:<mime>;base64," prefix — the backend wants raw base64.
          const res = String(reader.result);
          resolve(res.slice(res.indexOf(",") + 1));
        };
        reader.readAsDataURL(file);
      });
      await run((id) =>
        api.addAttachment(id, issueKey, file.name, dataBase64),
      );
      void load();
    },
    [run, api, issueKey, load],
  );

  const view = useCallback(
    async (attachmentId: string) => {
      const res = await run((id) => api.getAttachment(id, attachmentId));
      if (res) openDrawer(t(tk("attachments.title"), "Attachment"), res);
    },
    [run, api, openDrawer, t],
  );

  const remove = useCallback(
    async (attachmentId: string) => {
      await run((id) => api.deleteAttachment(id, attachmentId));
      void load();
    },
    [run, api, load],
  );

  if (!issueKey) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoIssue />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => fileRef.current?.click()}
        newLabel={t(tk("attachments.upload"), "Upload")}
      />
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <DataTable
        columns={[
          t(tk("attachments.filename"), "Filename"),
          t(tk("attachments.size"), "Size"),
          t(tk("attachments.author"), "Author"),
          t(tk("attachments.created"), "Created"),
        ]}
        rows={rows.map((r, i) => ({
          id: r.id ?? `a-${i}`,
          cells: [
            r.filename ?? "—",
            r.size != null ? String(r.size) : "—",
            userLabel(r.author),
            r.created ?? "—",
          ],
          onDelete: r.id ? () => remove(r.id!) : undefined,
          extra: r.id
            ? [{ label: t(tk("view"), "View"), onClick: () => view(r.id!) }]
            : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Worklogs ────────────────────────────────────────────────────────────────────

const WorklogsSection: React.FC<{ ctx: Ctx; issueKey: string }> = ({
  ctx,
  issueKey,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = ctx;
  const [rows, setRows] = useState<JiraWorklog[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    if (!issueKey) return;
    const res = await run((id) => api.listWorklogs(id, issueKey));
    if (res) setRows(res.worklogs);
  }, [run, api, issueKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const worklogFields = (w?: JiraWorklog): FieldSpec[] => [
    {
      key: "timeSpent",
      label: t(tk("worklogs.timeSpent"), "Time spent (e.g. 1h 30m)"),
      required: true,
      defaultValue: w?.timeSpent ?? "",
    },
    {
      key: "comment",
      label: t(tk("worklogs.comment"), "Comment"),
      type: "textarea",
      defaultValue: typeof w?.comment === "string" ? w.comment : "",
    },
    {
      key: "started",
      label: t(tk("worklogs.started"), "Started (ISO 8601, optional)"),
      defaultValue: w?.started ?? "",
    },
  ];

  const add = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("worklogs.add"), "Log work")}
          submitLabel={t(tk("worklogs.log"), "Log")}
          fields={worklogFields()}
          onSubmit={async (v) => {
            await run((id) =>
              api.addWorklog(id, issueKey, {
                timeSpent: str(v.timeSpent),
                comment: optStr(v.comment),
                started: optStr(v.started),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const edit = (w: JiraWorklog) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("worklogs.edit"), "Edit worklog")}
          submitLabel={t(tk("save"), "Save")}
          fields={worklogFields(w)}
          onSubmit={async (v) => {
            await run((id) =>
              api.updateWorklog(id, issueKey, w.id ?? "", {
                timeSpent: str(v.timeSpent),
                comment: optStr(v.comment),
                started: optStr(v.started),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const view = useCallback(
    async (worklogId: string) => {
      const res = await run((id) => api.getWorklog(id, issueKey, worklogId));
      if (res) openDrawer(t(tk("worklogs.title"), "Worklog"), res);
    },
    [run, api, issueKey, openDrawer, t],
  );

  const remove = useCallback(
    async (worklogId: string) => {
      await run((id) => api.deleteWorklog(id, issueKey, worklogId));
      void load();
    },
    [run, api, issueKey, load],
  );

  if (!issueKey) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoIssue />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={add}
        newLabel={t(tk("worklogs.add"), "Log work")}
      />
      <DataTable
        columns={[
          t(tk("worklogs.author"), "Author"),
          t(tk("worklogs.timeSpent"), "Time spent"),
          t(tk("worklogs.started"), "Started"),
        ]}
        rows={rows.map((r, i) => ({
          id: r.id ?? `w-${i}`,
          cells: [userLabel(r.author), r.timeSpent ?? "—", r.started ?? "—"],
          onDelete: r.id ? () => remove(r.id!) : undefined,
          extra: r.id
            ? [
                { label: t(tk("view"), "View"), onClick: () => view(r.id!) },
                { label: t(tk("edit"), "Edit"), onClick: () => edit(r) },
              ]
            : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Users ───────────────────────────────────────────────────────────────────────

const UsersSection: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = ctx;
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [assignable, setAssignable] = useState(false);
  const [rows, setRows] = useState<JiraUser[]>([]);
  const { overlay, setOverlay, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    const res = assignable
      ? await run((id) => api.findAssignableUsers(id, project.trim(), query.trim() || undefined))
      : await run((id) => api.searchUsers(id, query.trim()));
    if (res) setRows(res);
  }, [run, api, query, project, assignable]);

  const myself = useCallback(async () => {
    const res = await run((id) => api.getMyself(id));
    if (res) openDrawer(t(tk("users.myself"), "Current user"), res);
  }, [run, api, openDrawer, t]);

  const view = useCallback(
    async (accountId: string) => {
      const res = await run((id) => api.getUser(id, accountId));
      if (res) openDrawer(t(tk("users.title"), "User"), res);
    },
    [run, api, openDrawer, t],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar count={rows.length} isLoading={isLoading} onRefresh={load}>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={assignable}
            onChange={(e) => setAssignable(e.target.checked)}
          />
          {t(tk("users.assignableOnly"), "Assignable in project")}
        </label>
        {assignable && (
          <input
            className={`${inputCls} w-28`}
            placeholder={t(tk("users.project"), "Project")}
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
        )}
        <input
          className={`${inputCls} w-48`}
          placeholder={t(tk("users.query"), "Search users")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t(tk("users.searchAction"), "Search")}
        </button>
        <button onClick={myself} className={btnCls}>
          {t(tk("users.myself"), "Myself")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(tk("users.displayName"), "Name"),
          t(tk("users.email"), "Email"),
          t(tk("users.accountId"), "Account id"),
          t(tk("users.active"), "Active"),
        ]}
        rows={rows.map((r, i) => ({
          id: r.accountId ?? r.key ?? `u-${i}`,
          cells: [
            userLabel(r),
            r.emailAddress ?? "—",
            r.accountId ?? r.key ?? "—",
            r.active ? "✓" : "✗",
          ],
          extra: r.accountId
            ? [{ label: t(tk("view"), "View"), onClick: () => view(r.accountId!) }]
            : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Fields ──────────────────────────────────────────────────────────────────────

type FieldSub = "fields" | "issueTypes" | "priorities" | "statuses" | "resolutions";

const FieldsSection: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = ctx;
  const [sub, setSub] = useState<FieldSub>("fields");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const { overlay, setOverlay } = useOverlay();

  const load = useCallback(async () => {
    const res = await run((id) => {
      switch (sub) {
        case "issueTypes":
          return api.getAllIssueTypes(id) as Promise<unknown>;
        case "priorities":
          return api.getPriorities(id) as Promise<unknown>;
        case "statuses":
          return api.getStatuses(id) as Promise<unknown>;
        case "resolutions":
          return api.getResolutions(id) as Promise<unknown>;
        case "fields":
        default:
          return api.listFields(id) as Promise<unknown>;
      }
    });
    if (res) setRows(res as Array<Record<string, unknown>>);
  }, [run, api, sub]);

  useEffect(() => {
    void load();
  }, [load]);

  const subTabs: Array<{ key: FieldSub; label: string }> = [
    { key: "fields", label: t(tk("fields.fields"), "Fields") },
    { key: "issueTypes", label: t(tk("fields.issueTypes"), "Issue types") },
    { key: "priorities", label: t(tk("fields.priorities"), "Priorities") },
    { key: "statuses", label: t(tk("fields.statuses"), "Statuses") },
    { key: "resolutions", label: t(tk("fields.resolutions"), "Resolutions") },
  ];

  const columns =
    sub === "fields"
      ? [t(tk("fields.id"), "Id"), t(tk("fields.name"), "Name"), t(tk("fields.custom"), "Custom"), t(tk("fields.schemaType"), "Type")]
      : [t(tk("fields.id"), "Id"), t(tk("fields.name"), "Name"), t(tk("fields.description"), "Description")];

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1">
        {subTabs.map((st) => (
          <button
            key={st.key}
            onClick={() => setSub(st.key)}
            className={`border-b-2 px-2 py-1 text-xs ${
              sub === st.key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>
      <SectionBar count={rows.length} isLoading={isLoading} onRefresh={load} />
      <DataTable
        columns={columns}
        rows={rows.map((r, i) => {
          const rec = r as Record<string, any>;
          if (sub === "fields") {
            const field = r as unknown as JiraField;
            return {
              id: field.id ?? `f-${i}`,
              cells: [
                field.id ?? "—",
                field.name ?? "—",
                field.custom ? "✓" : "✗",
                field.schema?.type ?? "—",
              ],
            };
          }
          return {
            id: String(rec.id ?? rec.name ?? `r-${i}`),
            cells: [
              String(rec.id ?? "—"),
              String(rec.name ?? "—"),
              String(rec.description ?? "—"),
            ],
          };
        })}
      />
    </SectionLayout>
  );
};

// ─── Root tab ────────────────────────────────────────────────────────────────────

type GroupKey = "issues" | "comments" | "attachments" | "worklogs" | "users" | "fields";

const GROUPS: Array<{ key: GroupKey; icon: typeof Hash; label: string }> = [
  { key: "issues", icon: Hash, label: "Issues" },
  { key: "comments", icon: MessageSquare, label: "Comments" },
  { key: "attachments", icon: Paperclip, label: "Attachments" },
  { key: "worklogs", icon: Timer, label: "Worklogs" },
  { key: "users", icon: Users, label: "Users" },
  { key: "fields", icon: FileText, label: "Fields" },
];

const groupIcon: Record<GroupKey, typeof Hash> = {
  issues: Hash,
  comments: MessageSquare,
  attachments: Paperclip,
  worklogs: Timer,
  users: Users,
  fields: Layers,
};

const JiraIssuesTab: React.FC<JiraTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const ctx = useJiraIssues(connectionId);
  const [group, setGroup] = useState<GroupKey>("issues");
  const [issueKey, setIssueKey] = useState("");
  const [issueKeyDraft, setIssueKeyDraft] = useState("");

  const groupLabel: Record<GroupKey, string> = {
    issues: t(tk("groups.issues"), "Issues"),
    comments: t(tk("groups.comments"), "Comments"),
    attachments: t(tk("groups.attachments"), "Attachments"),
    worklogs: t(tk("groups.worklogs"), "Worklogs"),
    users: t(tk("groups.users"), "Users"),
    fields: t(tk("groups.fields"), "Fields"),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Issue-key context (used by Comments / Attachments / Worklogs) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--color-textSecondary)]">
          {t(tk("issueKey"), "Issue key")}
        </span>
        <input
          className={`${inputCls} w-40`}
          placeholder="PROJ-123"
          value={issueKeyDraft}
          onChange={(e) => setIssueKeyDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && issueKeyDraft.trim())
              setIssueKey(issueKeyDraft.trim().toUpperCase());
          }}
        />
        <button
          onClick={() =>
            issueKeyDraft.trim() && setIssueKey(issueKeyDraft.trim().toUpperCase())
          }
          className={btnCls}
          disabled={!issueKeyDraft.trim()}
        >
          {t(tk("useIssue"), "Use")}
        </button>
        {issueKey && (
          <span className="ml-auto text-xs text-[var(--color-textMuted)]">
            {t(tk("activeIssue"), "Active")}: {issueKey}
          </span>
        )}
      </div>

      {/* Group nav */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3">
        {GROUPS.map(({ key }) => {
          const Icon = groupIcon[key];
          return (
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
              {groupLabel[key]}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1">
        {group === "issues" && (
          <IssuesSection ctx={ctx} issueKey={issueKey} setIssueKey={setIssueKey} />
        )}
        {group === "comments" && <CommentsSection ctx={ctx} issueKey={issueKey} />}
        {group === "attachments" && (
          <AttachmentsSection ctx={ctx} issueKey={issueKey} />
        )}
        {group === "worklogs" && <WorklogsSection ctx={ctx} issueKey={issueKey} />}
        {group === "users" && <UsersSection ctx={ctx} />}
        {group === "fields" && <FieldsSection ctx={ctx} />}
      </div>
    </div>
  );
};

export default JiraIssuesTab;
