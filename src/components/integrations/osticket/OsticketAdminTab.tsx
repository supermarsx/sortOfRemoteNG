// osTicket Administration tab (t42-osticket-c2).
//
// The admin-panel configuration surface for an osTicket helpdesk: Departments,
// Help Topics, Agents/Staff, Teams, SLA Plans, Canned Responses and Custom
// Fields/Forms. One shared connection, seven grouped sections behind an internal
// sub-navigation. Binds all 44 admin `osticket_*` commands through
// `useOsticketAdmin` / `osticketAdminApi`. A category tab per the shell
// contract — mounted only once the shell holds a live connection, so
// `connectionId` is always usable.
//
// Create/update payloads are edited as JSON so the full request struct is
// expressible; the struct fields are snake_case (this crate carries no serde
// rename — see `../../../types/osticket/admin`).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ListChecks,
  Loader2,
  MessageSquareText,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Timer,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { OsticketTabProps } from "./registry";
import { useOsticketAdmin } from "../../../hooks/integration/osticket/useOsticketAdmin";
import type {
  CreateAgentRequest,
  CreateCannedResponseRequest,
  CreateCustomFieldRequest,
  CreateDepartmentRequest,
  CreateSlaRequest,
  CreateTeamRequest,
  CreateTopicRequest,
  OsticketAgent,
  OsticketCannedResponse,
  OsticketCustomField,
  OsticketDepartment,
  OsticketForm,
  OsticketSla,
  OsticketTeam,
  OsticketTopic,
  TeamMember,
  UpdateAgentRequest,
  UpdateCannedResponseRequest,
  UpdateCustomFieldRequest,
  UpdateDepartmentRequest,
  UpdateSlaRequest,
  UpdateTeamRequest,
  UpdateTopicRequest,
} from "../../../types/osticket/admin";

type Admin = ReturnType<typeof useOsticketAdmin>;
type AdminJson = unknown;
type AdminPayload = Record<string, unknown>;

const T = "integrations.osticket.admin";

// ─── Shared primitives (mirrors the sibling NetBox tab style) ───────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-60";
const primaryBtnCls =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

const yesNo = (v: boolean) => (v ? "✓" : "✗");
const numOrDash = (v?: number | null) => (v == null ? "—" : String(v));
const strOrDash = (v?: string | null) => (v && v.length ? v : "—");

/** Side drawer showing a formatted JSON payload (detail / members / agents …). */
const JsonDrawer: React.FC<{
  title: string;
  data: AdminJson;
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
          title={t(`${T}.actions.close`, "Close")}
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

type EditorMode = "create" | "update";

/** JSON payload editor for create / update. */
const JsonEditorModal: React.FC<{
  title: string;
  mode: EditorMode;
  initial: AdminPayload;
  onSubmit: (data: AdminPayload) => void | Promise<void>;
  onClose: () => void;
}> = ({ title, mode, initial, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    let parsed: AdminPayload;
    try {
      parsed = text.trim() ? (JSON.parse(text) as AdminPayload) : {};
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
            {t(
              `${T}.editor.hint`,
              "Edit the JSON payload sent to osTicket. Keys are snake_case.",
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
            {t(`${T}.actions.cancel`, "Cancel")}
          </button>
          <button onClick={submit} className={primaryBtnCls} disabled={busy}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            {mode === "create"
              ? t(`${T}.actions.create`, "Create")
              : t(`${T}.actions.save`, "Save")}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Header row: optional filters + count + refresh + optional "New". */
const SectionBar: React.FC<{
  count?: number;
  isLoading: boolean;
  onRefresh: () => void;
  onNew?: () => void;
  children?: React.ReactNode;
}> = ({ count, isLoading, onRefresh, onNew, children }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
      {children}
      <div className="ml-auto flex items-center gap-2">
        {count != null && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t(`${T}.count`, "{{count}} items", { count })}
          </span>
        )}
        <button onClick={onRefresh} className={btnCls} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t(`${T}.actions.refresh`, "Refresh")}
        </button>
        {onNew && (
          <button onClick={onNew} className={primaryBtnCls}>
            <Plus size={12} />
            {t(`${T}.actions.new`, "New")}
          </button>
        )}
      </div>
    </div>
  );
};

interface TableRow {
  id: number;
  cells: React.ReactNode[];
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
        {t(`${T}.empty`, "No records.")}
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
                      {t(`${T}.actions.edit`, "Edit")}
                    </button>
                  )}
                  {r.onDelete && (
                    <button
                      onClick={r.onDelete}
                      className={btnCls}
                      title={t(`${T}.actions.delete`, "Delete")}
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

interface RowUi {
  drawer: { title: string; data: AdminJson } | null;
  editor: {
    title: string;
    mode: EditorMode;
    initial: AdminPayload;
    submit: (data: AdminPayload) => void | Promise<void>;
  } | null;
}

const emptyUi: RowUi = { drawer: null, editor: null };

const SectionLayout: React.FC<{
  ui: RowUi;
  setUi: React.Dispatch<React.SetStateAction<RowUi>>;
  error: string | null;
  children: React.ReactNode;
  aside?: React.ReactNode;
}> = ({ ui, setUi, error, children, aside }) => (
  <div className="relative flex min-h-0 flex-1">
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p className="border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          {error}
        </p>
      )}
      {children}
    </div>
    {aside}
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
        mode={ui.editor.mode}
        initial={ui.editor.initial}
        onSubmit={ui.editor.submit}
        onClose={() => setUi((s) => ({ ...s, editor: null }))}
      />
    )}
  </div>
);

// ─── Departments ────────────────────────────────────────────────────────────────

const DepartmentsSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [rows, setRows] = useState<OsticketDepartment[]>([]);
  const [ui, setUi] = useState<RowUi>(emptyUi);

  const load = useCallback(async () => {
    const res = await run((id) => api.listDepartments(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useCallback(
    async (deptId: number) => {
      const res = await run((id) => api.getDepartment(id, deptId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Department #${deptId}`, data: res },
        }));
    },
    [run, api],
  );

  const agents = useCallback(
    async (deptId: number) => {
      const res = await run((id) => api.getDepartmentAgents(id, deptId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: t(`${T}.dept.agents`, "Department agents"), data: res },
        }));
    },
    [run, api, t],
  );

  const remove = useCallback(
    async (deptId: number) => {
      await run((id) => api.deleteDepartment(id, deptId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (dept: OsticketDepartment | null) => {
      const isNew = dept == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.dept.new`, "New department")
            : t(`${T}.dept.edit`, "Edit department"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({ name: "", is_active: true, is_public: false } as AdminPayload)
            : (dept as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createDepartment(id, data as unknown as CreateDepartmentRequest),
              );
            else
              await run((id) =>
                api.updateDepartment(
                  id,
                  dept!.id!,
                  data as unknown as UpdateDepartmentRequest,
                ),
              );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      />
      <DataTable
        columns={[
          t(`${T}.fields.name`, "Name"),
          t(`${T}.fields.manager`, "Manager"),
          t(`${T}.fields.sla`, "SLA"),
          t(`${T}.fields.active`, "Active"),
          t(`${T}.fields.public`, "Public"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            strOrDash(r.name),
            numOrDash(r.manager_id),
            numOrDash(r.sla_id),
            yesNo(r.is_active),
            yesNo(r.is_public),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
          extra:
            r.id != null
              ? [
                  {
                    label: t(`${T}.dept.agentsShort`, "Agents"),
                    onClick: () => agents(r.id!),
                  },
                ]
              : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Help Topics ────────────────────────────────────────────────────────────────

const TopicsSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [rows, setRows] = useState<OsticketTopic[]>([]);
  const [ui, setUi] = useState<RowUi>(emptyUi);

  const load = useCallback(async () => {
    const res = await run((id) => api.listTopics(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useCallback(
    async (topicId: number) => {
      const res = await run((id) => api.getTopic(id, topicId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Topic #${topicId}`, data: res },
        }));
    },
    [run, api],
  );

  const remove = useCallback(
    async (topicId: number) => {
      await run((id) => api.deleteTopic(id, topicId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (topic: OsticketTopic | null) => {
      const isNew = topic == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.topic.new`, "New help topic")
            : t(`${T}.topic.edit`, "Edit help topic"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({ name: "", is_active: true, is_public: true } as AdminPayload)
            : (topic as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createTopic(id, data as unknown as CreateTopicRequest),
              );
            else
              await run((id) =>
                api.updateTopic(
                  id,
                  topic!.id!,
                  data as unknown as UpdateTopicRequest,
                ),
              );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      />
      <DataTable
        columns={[
          t(`${T}.fields.name`, "Name"),
          t(`${T}.fields.department`, "Dept"),
          t(`${T}.fields.priority`, "Priority"),
          t(`${T}.fields.sla`, "SLA"),
          t(`${T}.fields.active`, "Active"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            strOrDash(r.name),
            numOrDash(r.dept_id),
            numOrDash(r.priority_id),
            numOrDash(r.sla_id),
            yesNo(r.is_active),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Agents / Staff ─────────────────────────────────────────────────────────────

const AgentsSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [rows, setRows] = useState<OsticketAgent[]>([]);
  const [ui, setUi] = useState<RowUi>(emptyUi);

  const load = useCallback(async () => {
    const res = await run((id) => api.listAgents(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useCallback(
    async (agentId: number) => {
      const res = await run((id) => api.getAgent(id, agentId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: {
            title: res.username ?? `Agent #${agentId}`,
            data: res,
          },
        }));
    },
    [run, api],
  );

  const teams = useCallback(
    async (agentId: number) => {
      const res = await run((id) => api.getAgentTeams(id, agentId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: t(`${T}.agent.teams`, "Agent teams"), data: res },
        }));
    },
    [run, api, t],
  );

  const toggleVacation = useCallback(
    async (agent: OsticketAgent) => {
      if (agent.id == null) return;
      await run((id) => api.setAgentVacation(id, agent.id!, !agent.on_vacation));
      void load();
    },
    [run, api, load],
  );

  const remove = useCallback(
    async (agentId: number) => {
      await run((id) => api.deleteAgent(id, agentId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (agent: OsticketAgent | null) => {
      const isNew = agent == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.agent.new`, "New agent")
            : t(`${T}.agent.edit`, "Edit agent"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({
                username: "",
                firstname: "",
                lastname: "",
                email: "",
                password: "",
                is_active: true,
              } as AdminPayload)
            : (agent as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createAgent(id, data as unknown as CreateAgentRequest),
              );
            else
              await run((id) =>
                api.updateAgent(
                  id,
                  agent!.id!,
                  data as unknown as UpdateAgentRequest,
                ),
              );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      />
      <DataTable
        columns={[
          t(`${T}.fields.username`, "Username"),
          t(`${T}.fields.name`, "Name"),
          t(`${T}.fields.email`, "Email"),
          t(`${T}.fields.active`, "Active"),
          t(`${T}.fields.vacation`, "Vacation"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            strOrDash(r.username),
            `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || "—",
            strOrDash(r.email),
            yesNo(r.is_active),
            yesNo(r.on_vacation),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
          extra:
            r.id != null
              ? [
                  {
                    label: t(`${T}.agent.teamsShort`, "Teams"),
                    onClick: () => teams(r.id!),
                  },
                  {
                    label: r.on_vacation
                      ? t(`${T}.agent.endVacation`, "End vacation")
                      : t(`${T}.agent.setVacation`, "Set vacation"),
                    onClick: () => toggleVacation(r),
                  },
                ]
              : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Teams ──────────────────────────────────────────────────────────────────────

const TeamMembersPanel: React.FC<{
  admin: Admin;
  team: OsticketTeam;
  onClose: () => void;
}> = ({ admin, team, onClose }) => {
  const { t } = useTranslation();
  const { api, run } = admin;
  const [members, setMembers] = useState<TeamMember[]>(team.members ?? []);
  const [staffId, setStaffId] = useState("");

  const reload = useCallback(async () => {
    if (team.id == null) return;
    const res = await run((id) => api.getTeamMembers(id, team.id!));
    if (res) setMembers(res);
  }, [run, api, team.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(async () => {
    const n = Number(staffId.trim());
    if (team.id == null || !Number.isFinite(n)) return;
    await run((id) => api.addTeamMember(id, team.id!, n));
    setStaffId("");
    void reload();
  }, [run, api, team.id, staffId, reload]);

  const remove = useCallback(
    async (sid: number) => {
      if (team.id == null) return;
      await run((id) => api.removeTeamMember(id, team.id!, sid));
      void reload();
    },
    [run, api, team.id, reload],
  );

  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {t(`${T}.team.members`, "Members")} · {team.name ?? `#${team.id}`}
        </span>
        <button onClick={onClose} className={btnCls}>
          <X size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <input
          className={inputCls}
          inputMode="numeric"
          placeholder={t(`${T}.team.staffId`, "Staff ID")}
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} className={primaryBtnCls}>
          <Plus size={12} />
          {t(`${T}.team.addMember`, "Add")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {members.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--color-textSecondary)]">
            {t(`${T}.team.noMembers`, "No members.")}
          </div>
        ) : (
          <ul>
            {members.map((m) => (
              <li
                key={m.staff_id}
                className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text)]"
              >
                <span>
                  {m.name ?? `#${m.staff_id}`}{" "}
                  <span className="text-xs text-[var(--color-textMuted)]">
                    ({m.staff_id})
                  </span>
                </span>
                <button
                  onClick={() => remove(m.staff_id)}
                  className={btnCls}
                  title={t(`${T}.actions.delete`, "Delete")}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const TeamsSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [rows, setRows] = useState<OsticketTeam[]>([]);
  const [ui, setUi] = useState<RowUi>(emptyUi);
  const [membersTeam, setMembersTeam] = useState<OsticketTeam | null>(null);

  const load = useCallback(async () => {
    const res = await run((id) => api.listTeams(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useCallback(
    async (teamId: number) => {
      const res = await run((id) => api.getTeam(id, teamId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `Team #${teamId}`, data: res },
        }));
    },
    [run, api],
  );

  const remove = useCallback(
    async (teamId: number) => {
      await run((id) => api.deleteTeam(id, teamId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (team: OsticketTeam | null) => {
      const isNew = team == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.team.new`, "New team")
            : t(`${T}.team.edit`, "Edit team"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({ name: "", is_active: true, member_ids: [] } as AdminPayload)
            : (team as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createTeam(id, data as unknown as CreateTeamRequest),
              );
            else
              await run((id) =>
                api.updateTeam(
                  id,
                  team!.id!,
                  data as unknown as UpdateTeamRequest,
                ),
              );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout
      ui={ui}
      setUi={setUi}
      error={error}
      aside={
        membersTeam && (
          <TeamMembersPanel
            admin={admin}
            team={membersTeam}
            onClose={() => setMembersTeam(null)}
          />
        )
      }
    >
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      />
      <DataTable
        columns={[
          t(`${T}.fields.name`, "Name"),
          t(`${T}.fields.lead`, "Lead"),
          t(`${T}.fields.members`, "Members"),
          t(`${T}.fields.active`, "Active"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            strOrDash(r.name),
            numOrDash(r.lead_id),
            String(r.members?.length ?? 0),
            yesNo(r.is_active),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
          extra:
            r.id != null
              ? [
                  {
                    label: t(`${T}.team.members`, "Members"),
                    onClick: () => setMembersTeam(r),
                  },
                ]
              : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── SLA Plans ──────────────────────────────────────────────────────────────────

const SlaSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [rows, setRows] = useState<OsticketSla[]>([]);
  const [ui, setUi] = useState<RowUi>(emptyUi);

  const load = useCallback(async () => {
    const res = await run((id) => api.listSla(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const view = useCallback(
    async (slaId: number) => {
      const res = await run((id) => api.getSla(id, slaId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.name ?? `SLA #${slaId}`, data: res },
        }));
    },
    [run, api],
  );

  const remove = useCallback(
    async (slaId: number) => {
      await run((id) => api.deleteSla(id, slaId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (sla: OsticketSla | null) => {
      const isNew = sla == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.sla.new`, "New SLA plan")
            : t(`${T}.sla.edit`, "Edit SLA plan"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({ name: "", grace_period: 24, is_active: true } as AdminPayload)
            : (sla as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createSla(id, data as unknown as CreateSlaRequest),
              );
            else
              await run((id) =>
                api.updateSla(id, sla!.id!, data as unknown as UpdateSlaRequest),
              );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      />
      <DataTable
        columns={[
          t(`${T}.fields.name`, "Name"),
          t(`${T}.fields.gracePeriod`, "Grace (h)"),
          t(`${T}.fields.active`, "Active"),
          t(`${T}.fields.overdueAlerts`, "Overdue alerts"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [
            strOrDash(r.name),
            numOrDash(r.grace_period),
            yesNo(r.is_active),
            yesNo(!r.disable_overdue_alerts),
          ],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Canned Responses ───────────────────────────────────────────────────────────

const CannedSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [rows, setRows] = useState<OsticketCannedResponse[]>([]);
  const [query, setQuery] = useState("");
  const [ui, setUi] = useState<RowUi>(emptyUi);

  const load = useCallback(async () => {
    const res = await run((id) => api.listCannedResponses(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = useCallback(async () => {
    if (!query.trim()) return load();
    const res = await run((id) => api.searchCannedResponses(id, query.trim()));
    if (res) setRows(res);
  }, [run, api, query, load]);

  const view = useCallback(
    async (cannedId: number) => {
      const res = await run((id) => api.getCannedResponse(id, cannedId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.title ?? `Canned #${cannedId}`, data: res },
        }));
    },
    [run, api],
  );

  const remove = useCallback(
    async (cannedId: number) => {
      await run((id) => api.deleteCannedResponse(id, cannedId));
      void load();
    },
    [run, api, load],
  );

  const openEditor = useCallback(
    (canned: OsticketCannedResponse | null) => {
      const isNew = canned == null;
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.canned.new`, "New canned response")
            : t(`${T}.canned.edit`, "Edit canned response"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({ title: "", response: "", is_active: true } as AdminPayload)
            : (canned as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createCannedResponse(
                  id,
                  data as unknown as CreateCannedResponseRequest,
                ),
              );
            else
              await run((id) =>
                api.updateCannedResponse(
                  id,
                  canned!.id!,
                  data as unknown as UpdateCannedResponseRequest,
                ),
              );
            setUi((x) => ({ ...x, editor: null }));
            void load();
          },
        },
      }));
    },
    [run, api, load, t],
  );

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={() => openEditor(null)}
      >
        <input
          className={inputCls}
          placeholder={t(`${T}.canned.search`, "Search title/response")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button onClick={search} className={btnCls}>
          <Search size={12} />
          {t(`${T}.actions.apply`, "Apply")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(`${T}.fields.title`, "Title"),
          t(`${T}.fields.department`, "Dept"),
          t(`${T}.fields.active`, "Active"),
        ]}
        rows={rows.map((r) => ({
          id: r.id ?? 0,
          cells: [strOrDash(r.title), numOrDash(r.dept_id), yesNo(r.is_active)],
          onView: r.id != null ? () => view(r.id!) : undefined,
          onEdit: () => openEditor(r),
          onDelete: r.id != null ? () => remove(r.id!) : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Custom Fields / Forms ──────────────────────────────────────────────────────

type FieldsSub = "forms" | "fields";

const FieldsSection: React.FC<{ admin: Admin }> = ({ admin }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = admin;
  const [sub, setSub] = useState<FieldsSub>("forms");
  const [forms, setForms] = useState<OsticketForm[]>([]);
  const [fields, setFields] = useState<OsticketCustomField[]>([]);
  const [formId, setFormId] = useState("");
  const [ui, setUi] = useState<RowUi>(emptyUi);

  const loadForms = useCallback(async () => {
    const res = await run((id) => api.listForms(id));
    if (res) setForms(res);
  }, [run, api]);

  const loadFields = useCallback(async () => {
    const n = Number(formId.trim());
    if (!Number.isFinite(n)) {
      setFields([]);
      return;
    }
    const res = await run((id) => api.listCustomFields(id, n));
    if (res) setFields(res);
  }, [run, api, formId]);

  useEffect(() => {
    if (sub === "forms") void loadForms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  const viewForm = useCallback(
    async (fid: number) => {
      const res = await run((id) => api.getForm(id, fid));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.title ?? `Form #${fid}`, data: res },
        }));
    },
    [run, api],
  );

  const viewField = useCallback(
    async (fieldId: number) => {
      const res = await run((id) => api.getCustomField(id, fieldId));
      if (res)
        setUi((s) => ({
          ...s,
          drawer: { title: res.label ?? `Field #${fieldId}`, data: res },
        }));
    },
    [run, api],
  );

  const removeField = useCallback(
    async (fieldId: number) => {
      await run((id) => api.deleteCustomField(id, fieldId));
      void loadFields();
    },
    [run, api, loadFields],
  );

  const openFieldEditor = useCallback(
    (field: OsticketCustomField | null) => {
      const isNew = field == null;
      const fid = Number(formId.trim());
      setUi((s) => ({
        ...s,
        editor: {
          title: isNew
            ? t(`${T}.field.new`, "New custom field")
            : t(`${T}.field.edit`, "Edit custom field"),
          mode: isNew ? "create" : "update",
          initial: isNew
            ? ({
                name: "",
                label: "",
                field_type: "text",
                form_id: Number.isFinite(fid) ? fid : 0,
                required: false,
              } as AdminPayload)
            : (field as unknown as AdminPayload),
          submit: async (data) => {
            if (isNew)
              await run((id) =>
                api.createCustomField(
                  id,
                  data as unknown as CreateCustomFieldRequest,
                ),
              );
            else
              await run((id) =>
                api.updateCustomField(
                  id,
                  field!.id!,
                  data as unknown as UpdateCustomFieldRequest,
                ),
              );
            setUi((x) => ({ ...x, editor: null }));
            void loadFields();
          },
        },
      }));
    },
    [run, api, loadFields, formId, t],
  );

  const subTabs: Array<{ key: FieldsSub; label: string }> = [
    { key: "forms", label: t(`${T}.field.forms`, "Forms") },
    { key: "fields", label: t(`${T}.field.customFields`, "Custom fields") },
  ];

  return (
    <SectionLayout ui={ui} setUi={setUi} error={error}>
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

      {sub === "forms" ? (
        <>
          <SectionBar
            count={forms.length}
            isLoading={isLoading}
            onRefresh={loadForms}
          />
          <DataTable
            columns={[
              t(`${T}.fields.title`, "Title"),
              t(`${T}.fields.fieldCount`, "Fields"),
              t(`${T}.fields.instructions`, "Instructions"),
            ]}
            rows={forms.map((r) => ({
              id: r.id ?? 0,
              cells: [
                strOrDash(r.title),
                String(r.fields?.length ?? 0),
                strOrDash(r.instructions),
              ],
              onView: r.id != null ? () => viewForm(r.id!) : undefined,
            }))}
          />
        </>
      ) : (
        <>
          <SectionBar
            count={fields.length}
            isLoading={isLoading}
            onRefresh={loadFields}
            onNew={
              Number.isFinite(Number(formId.trim()))
                ? () => openFieldEditor(null)
                : undefined
            }
          >
            <input
              className={inputCls}
              inputMode="numeric"
              placeholder={t(`${T}.field.formId`, "Form ID")}
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadFields()}
            />
            <button onClick={loadFields} className={btnCls}>
              {t(`${T}.actions.apply`, "Apply")}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t(`${T}.fields.label`, "Label"),
              t(`${T}.fields.name`, "Name"),
              t(`${T}.fields.type`, "Type"),
              t(`${T}.fields.required`, "Required"),
            ]}
            rows={fields.map((r) => ({
              id: r.id ?? 0,
              cells: [
                strOrDash(r.label),
                strOrDash(r.name),
                strOrDash(r.field_type),
                yesNo(r.required),
              ],
              onView: r.id != null ? () => viewField(r.id!) : undefined,
              onEdit: () => openFieldEditor(r),
              onDelete: r.id != null ? () => removeField(r.id!) : undefined,
            }))}
          />
        </>
      )}
    </SectionLayout>
  );
};

// ─── Root tab ──────────────────────────────────────────────────────────────────

type GroupKey =
  | "departments"
  | "topics"
  | "agents"
  | "teams"
  | "sla"
  | "canned"
  | "fields";

const GROUPS: Array<{ key: GroupKey; icon: typeof Building2 }> = [
  { key: "departments", icon: Building2 },
  { key: "topics", icon: Tags },
  { key: "agents", icon: UserCog },
  { key: "teams", icon: Users },
  { key: "sla", icon: Timer },
  { key: "canned", icon: MessageSquareText },
  { key: "fields", icon: ListChecks },
];

const OsticketAdminTab: React.FC<OsticketTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const admin = useOsticketAdmin(connectionId);
  const [group, setGroup] = useState<GroupKey>("departments");

  const groupLabel = useMemo(
    (): Record<GroupKey, string> => ({
      departments: t(`${T}.groups.departments`, "Departments"),
      topics: t(`${T}.groups.topics`, "Help Topics"),
      agents: t(`${T}.groups.agents`, "Agents"),
      teams: t(`${T}.groups.teams`, "Teams"),
      sla: t(`${T}.groups.sla`, "SLA Plans"),
      canned: t(`${T}.groups.canned`, "Canned Responses"),
      fields: t(`${T}.groups.fields`, "Fields & Forms"),
    }),
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-3">
        {GROUPS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setGroup(key)}
            className={`flex items-center gap-1 border-b-2 px-3 py-2 text-sm ${
              group === key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon size={14} />
            {groupLabel[key]}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        {group === "departments" && <DepartmentsSection admin={admin} />}
        {group === "topics" && <TopicsSection admin={admin} />}
        {group === "agents" && <AgentsSection admin={admin} />}
        {group === "teams" && <TeamsSection admin={admin} />}
        {group === "sla" && <SlaSection admin={admin} />}
        {group === "canned" && <CannedSection admin={admin} />}
        {group === "fields" && <FieldsSection admin={admin} />}
      </div>
    </div>
  );
};

export default OsticketAdminTab;
